"""Bounded Jev selection for one saved Card Run.

This module owns no Card, model catalog, or tool authority.  It receives the
already-validated current Run candidates, asks Jev at most once per enabled
selection, and returns only the selected surface plus a bounded decision
summary suitable for the existing Run row.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
from typing import Any

import httpx

from app.python_models.jev_validation import (
    validate_rounded_choice_winner,
    validate_rounded_probability_distribution,
)
from app.python_models.saved_card_contract import CardDomainError


JEV_MODEL = "typesafe/jev-1.13"
JEV_ENDPOINT = "https://openrouter.ai/api/alpha/decisions"
JEV_TIMEOUT_SECONDS = 45.0
MAX_DECISION_BYTES = 240_000
MAX_TOOL_QUESTIONS = 128
MAX_MODEL_CANDIDATES = 32

_MODEL_CANDIDATE_FIELDS = {
    "id", "provider", "accessMode", "modelKey", "providerModelId", "label",
    "eligible", "contextWindow", "supportsTools", "inputModalities",
    "reasoningEfforts", "taskFit",
}
_REFERENCE_ID_FIELDS = (
    "engraphisMemoryId", "engraphisEntityId", "engraphisRelationshipId",
    "graphitiEpisodeId", "graphitiEntityId", "graphitiRelationshipId",
    "cbmQualifiedName",
)
_ATTACHMENT_METADATA_FIELDS = (
    "id", "name", "filename", "mediaType", "mimeType", "size", "sizeBytes",
    "width", "height", "source", "url", "sha256", "schemaVersion",
)


def _bounded_metadata(value: Any, *, depth: int = 0) -> Any:
    """Preserve small provenance values exactly; reject blobs and deep structures."""

    if depth > 3:
        raise ValueError("metadata depth")
    if value is None or isinstance(value, bool):
        return value
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ValueError("metadata number")
        return value
    if isinstance(value, str):
        if len(value) > 2_048 or value.lstrip().lower().startswith("data:"):
            raise ValueError("metadata text")
        return value
    if isinstance(value, list):
        if len(value) > 32:
            raise ValueError("metadata list")
        return [_bounded_metadata(item, depth=depth + 1) for item in value]
    if isinstance(value, dict):
        if len(value) > 32 or any(
            not isinstance(key, str) or not key or len(key) > 128
            for key in value
        ):
            raise ValueError("metadata object")
        return {
            key: _bounded_metadata(item, depth=depth + 1)
            for key, item in value.items()
        }
    raise ValueError("metadata value")


class AutoModelSelectionError(CardDomainError):
    """A Run with Auto Model enabled could not select an authorized model."""

    def __init__(self, decision: dict[str, Any]) -> None:
        self.decision = decision
        self.auto_tools_decision: dict[str, Any] | None = None
        super().__init__(str(decision.get("errorCode") or "auto_model_selection_failed"))


class _JevSelectionError(RuntimeError):
    def __init__(self, status: str, error_code: str) -> None:
        self.status = status
        self.error_code = error_code
        super().__init__(error_code)


def _text(value: Any, *, maximum: int, required: bool = True) -> str:
    if not isinstance(value, str) or len(value) > maximum:
        raise ValueError("text")
    if required and not value.strip():
        raise ValueError("text")
    return value


def _bounded_strings(value: Any, *, maximum_count: int = 32) -> list[str]:
    if not isinstance(value, list) or len(value) > maximum_count:
        raise ValueError("string list")
    result: list[str] = []
    seen: set[str] = set()
    for raw in value:
        item = _text(raw, maximum=128)
        if item in seen:
            raise ValueError("string list")
        seen.add(item)
        result.append(item)
    return result


def _reference_context(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for record in records:
        if not isinstance(record, dict):
            continue
        item = {
            key: record[key]
            for key in _REFERENCE_ID_FIELDS
            if isinstance(record.get(key), str) and str(record[key]).strip()
        }
        if not item:
            continue
        provenance = record.get("provenance")
        if isinstance(provenance, dict):
            try:
                item["provenance"] = _bounded_metadata(provenance)
            except ValueError:
                pass
        for key in ("sourcePath", "sourceUrl", "readOperation"):
            if isinstance(record.get(key), str) and str(record[key]).strip():
                try:
                    item[key] = _bounded_metadata(record[key])
                except ValueError:
                    pass
        result.append(item)
    return result


def _attachment_context(attachments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for attachment in attachments:
        if not isinstance(attachment, dict):
            continue
        metadata: dict[str, Any] = {}
        for key in _ATTACHMENT_METADATA_FIELDS:
            value = attachment.get(key)
            if isinstance(value, str):
                if len(value) > 2_048 or value.lstrip().lower().startswith("data:"):
                    continue
                metadata[key] = value
            elif isinstance(value, bool) or value is None:
                metadata[key] = value
            elif isinstance(value, int):
                metadata[key] = value
            elif isinstance(value, float) and math.isfinite(value):
                metadata[key] = value
        result.append(metadata)
    return result


def selection_context(
    *,
    current_request: str,
    instructions: str,
    output_contract: str,
    graph_records: list[dict[str, Any]],
    attachments: list[dict[str, Any]],
    estimated_visible_tokens: int,
) -> dict[str, Any]:
    """Project only the authorized, non-history decision context."""

    if (
        not isinstance(estimated_visible_tokens, int)
        or isinstance(estimated_visible_tokens, bool)
        or estimated_visible_tokens < 0
    ):
        raise ValueError("estimated visible tokens")
    return {
        "current_request": _text(current_request, maximum=180_000),
        "saved_instructions": _text(instructions, maximum=120_000, required=False),
        "saved_output_contract": _text(
            output_contract, maximum=60_000, required=False,
        ),
        "selected_graph_references": _reference_context(graph_records),
        "attachment_metadata": _attachment_context(attachments),
        "estimated_visible_tokens": estimated_visible_tokens,
    }


def _question_id(prefix: str, identity: str) -> str:
    digest = hashlib.sha256(identity.encode("utf-8")).hexdigest()[:24]
    return f"{prefix}_{digest}"


def _bounded_body(body: dict[str, Any], error_code: str) -> dict[str, Any]:
    encoded = json.dumps(body, ensure_ascii=False, separators=(",", ":"), default=str)
    if len(encoded.encode("utf-8")) > MAX_DECISION_BYTES:
        raise _JevSelectionError("invalid", error_code)
    return body


def _post_jev(body: dict[str, Any], *, prefix: str) -> dict[str, Any]:
    api_key = os.environ.get("OPENROUTER_API_KEY", "").strip()
    if not api_key:
        raise _JevSelectionError("unavailable", f"{prefix}_openrouter_key_unavailable")
    try:
        with httpx.Client(timeout=JEV_TIMEOUT_SECONDS, follow_redirects=False) as client:
            response = client.post(
                JEV_ENDPOINT,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json=body,
            )
            response.raise_for_status()
            value = response.json()
    except httpx.TimeoutException as error:
        raise _JevSelectionError("unavailable", f"{prefix}_timeout") from error
    except httpx.HTTPError as error:
        raise _JevSelectionError("unavailable", f"{prefix}_unavailable") from error
    except (json.JSONDecodeError, ValueError) as error:
        raise _JevSelectionError("invalid", f"{prefix}_response_invalid") from error
    except Exception as error:
        raise _JevSelectionError("unavailable", f"{prefix}_request_error") from error
    if not isinstance(value, dict):
        raise _JevSelectionError("invalid", f"{prefix}_response_invalid")
    return value


def _decision_id(response: dict[str, Any]) -> str:
    value = response.get("id")
    if not isinstance(value, str) or not value.strip() or len(value) > 256:
        raise ValueError("decision id")
    return value.strip()


def _choice_answer(
    response: dict[str, Any],
    question_id: str,
    choice_ids: tuple[str, ...],
) -> tuple[str, float]:
    answer = response["answers"][question_id]
    if not isinstance(answer, dict) or answer.get("type") != "choice":
        raise ValueError("answer")
    winner = str(answer["choice"])
    probabilities = validate_rounded_probability_distribution(
        answer["probabilities"], choice_ids,
    )
    validate_rounded_choice_winner(winner, probabilities)
    confidence = answer["confidence"]
    if isinstance(confidence, bool):
        raise ValueError("confidence")
    confidence = float(confidence)
    if not math.isfinite(confidence) or not 0.0 <= confidence <= 1.0:
        raise ValueError("confidence")
    return winner, round(confidence * 100.0, 2)


def _auto_tools_unavailable(
    baseline_tool_ids: list[str], error_code: str,
) -> tuple[list[str], dict[str, Any]]:
    return list(baseline_tool_ids), {
        "schemaVersion": "auto-tools-decision.v1",
        "status": "unavailable",
        "candidateCount": len(baseline_tool_ids),
        "selectedToolIds": list(baseline_tool_ids),
        "selectedConfidencePercentages": {},
        "decisionId": None,
        "errorCode": error_code,
    }


def select_auto_tools(
    *,
    baseline_tool_ids: list[str],
    tool_contracts: list[dict[str, Any]],
    context: dict[str, Any],
) -> tuple[list[str], dict[str, Any]]:
    """Ask one USE/OMIT Choice per exact ordinary baseline tool."""

    if not baseline_tool_ids:
        return [], {
            "schemaVersion": "auto-tools-decision.v1",
            "status": "selected",
            "candidateCount": 0,
            "selectedToolIds": [],
            "selectedConfidencePercentages": {},
            "decisionId": None,
            "errorCode": None,
        }
    if len(baseline_tool_ids) > MAX_TOOL_QUESTIONS:
        return _auto_tools_unavailable(
            baseline_tool_ids, "auto_tools_question_limit",
        )
    by_id = {
        str(contract.get("canonicalId") or ""): contract
        for contract in tool_contracts
        if isinstance(contract, dict)
    }
    if (
        len(set(baseline_tool_ids)) != len(baseline_tool_ids)
        or len(tool_contracts) != len(baseline_tool_ids)
        or set(by_id) != set(baseline_tool_ids)
        or any(not tool_id or len(tool_id) > 512 for tool_id in baseline_tool_ids)
    ):
        return _auto_tools_unavailable(
            baseline_tool_ids, "auto_tools_contract_invalid",
        )
    question_ids = {
        tool_id: _question_id("tool", tool_id) for tool_id in baseline_tool_ids
    }
    body = {
        "model": JEV_MODEL,
        "state": {
            **context,
            "ordinary_tool_candidates": [by_id[tool_id] for tool_id in baseline_tool_ids],
        },
        "questions": {
            question_ids[tool_id]: {
                "type": "choice",
                "instructions": (
                    "Choose USE only when this exact granted ordinary tool is useful for the "
                    "current request and supplied context. Otherwise choose OMIT. Do not invent "
                    "capabilities, widen grants, or treat prior conversation as context."
                ),
                "criteria": {
                    "USE": f"Present the exact ordinary tool {tool_id} to the model.",
                    "OMIT": f"Do not present the exact ordinary tool {tool_id} to the model.",
                },
            }
            for tool_id in baseline_tool_ids
        },
    }
    try:
        response = _post_jev(
            _bounded_body(body, "auto_tools_input_limit"),
            prefix="auto_tools_jev",
        )
        if not isinstance(response.get("answers"), dict) or set(
            response["answers"]
        ) != set(question_ids.values()):
            raise ValueError("answers")
        decision_id = _decision_id(response)
        selected: list[str] = []
        confidence_percentages: dict[str, float] = {}
        for tool_id in baseline_tool_ids:
            winner, confidence = _choice_answer(
                response, question_ids[tool_id], ("USE", "OMIT"),
            )
            if winner == "USE":
                selected.append(tool_id)
                confidence_percentages[tool_id] = confidence
    except _JevSelectionError as error:
        return _auto_tools_unavailable(baseline_tool_ids, error.error_code)
    except (KeyError, TypeError, ValueError, OverflowError):
        return _auto_tools_unavailable(
            baseline_tool_ids, "auto_tools_jev_response_invalid",
        )
    return selected, {
        "schemaVersion": "auto-tools-decision.v1",
        "status": "selected",
        "candidateCount": len(baseline_tool_ids),
        "selectedToolIds": selected,
        "selectedConfidencePercentages": confidence_percentages,
        "decisionId": decision_id,
        "errorCode": None,
    }


def _model_decision(
    *,
    status: str,
    saved_model_id: str,
    candidate_count: int,
    selected_model_id: str | None = None,
    confidence_percentage: float | None = None,
    decision_id: str | None = None,
    error_code: str | None = None,
) -> dict[str, Any]:
    return {
        "schemaVersion": "auto-model-decision.v1",
        "status": status,
        "savedModelId": saved_model_id,
        "candidateCount": candidate_count,
        "selectedModelId": selected_model_id,
        "selectedConfidencePercentage": confidence_percentage,
        "decisionId": decision_id,
        "errorCode": error_code,
    }


def _validated_model_candidates(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list) or len(value) > MAX_MODEL_CANDIDATES:
        raise ValueError("model candidates")
    result: list[dict[str, Any]] = []
    seen: set[str] = set()
    for raw in value:
        if not isinstance(raw, dict) or set(raw) != _MODEL_CANDIDATE_FIELDS:
            raise ValueError("model candidate")
        candidate = {
            "id": _text(raw["id"], maximum=768),
            "provider": _text(raw["provider"], maximum=128),
            "accessMode": _text(raw["accessMode"], maximum=128),
            "modelKey": _text(raw["modelKey"], maximum=256),
            "providerModelId": _text(raw["providerModelId"], maximum=256),
            "label": _text(raw["label"], maximum=256),
            "eligible": raw["eligible"],
            "contextWindow": raw["contextWindow"],
            "supportsTools": raw["supportsTools"],
            "inputModalities": _bounded_strings(raw["inputModalities"]),
            "reasoningEfforts": _bounded_strings(raw["reasoningEfforts"]),
            "taskFit": _text(raw["taskFit"], maximum=500),
        }
        if (
            candidate["eligible"] is not True
            or not isinstance(candidate["supportsTools"], bool)
            or isinstance(candidate["contextWindow"], bool)
            or not isinstance(candidate["contextWindow"], int)
            or candidate["contextWindow"] <= 0
            or candidate["id"] != (
                f'{candidate["provider"]}:{candidate["accessMode"]}:'
                f'{candidate["modelKey"]}'
            )
            or candidate["id"] in seen
        ):
            raise ValueError("model candidate")
        seen.add(str(candidate["id"]))
        result.append(candidate)
    return result


def select_auto_model(
    *,
    saved_provider: dict[str, Any],
    raw_candidates: Any,
    context: dict[str, Any],
    tools_required: bool,
    images_required: bool,
    reasoning_effort: str,
) -> tuple[dict[str, str], dict[str, Any]]:
    """Choose only from exact backend-authored compatible model records."""

    saved = {
        key: _text(saved_provider.get(key), maximum=256)
        for key in ("provider", "accessMode", "modelKey", "providerModelId")
    }
    saved_model_id = f'{saved["provider"]}:{saved["accessMode"]}:{saved["modelKey"]}'
    try:
        candidates = _validated_model_candidates(raw_candidates)
    except (KeyError, TypeError, ValueError) as error:
        decision = _model_decision(
            status="invalid", saved_model_id=saved_model_id, candidate_count=0,
            error_code="auto_model_candidates_invalid",
        )
        raise AutoModelSelectionError(decision) from error
    estimated_tokens = int(context["estimated_visible_tokens"])
    compatible = [
        candidate for candidate in candidates
        if candidate["provider"] == saved["provider"]
        and candidate["accessMode"] == saved["accessMode"]
        and candidate["contextWindow"] >= estimated_tokens
        and (not tools_required or candidate["supportsTools"] is True)
        and "text" in candidate["inputModalities"]
        and (not images_required or "image" in candidate["inputModalities"])
        and (
            not reasoning_effort
            or reasoning_effort in candidate["reasoningEfforts"]
        )
    ]
    if not compatible:
        decision = _model_decision(
            status="unavailable", saved_model_id=saved_model_id,
            candidate_count=0,
            error_code="auto_model_compatible_candidates_unavailable",
        )
        raise AutoModelSelectionError(decision)
    if len(compatible) == 1:
        selected = compatible[0]
        decision = _model_decision(
            status="deterministic", saved_model_id=saved_model_id,
            candidate_count=1, selected_model_id=str(selected["id"]),
        )
    else:
        question_id = "model"
        choice_to_candidate = {
            _question_id("model", str(candidate["id"])): candidate
            for candidate in compatible
        }
        choice_ids = tuple(choice_to_candidate)
        body = {
            "model": JEV_MODEL,
            "state": {
                **context,
                "compatible_model_candidates": compatible,
            },
            "questions": {
                question_id: {
                    "type": "choice",
                    "instructions": (
                        "Choose the exact supplied compatible model that best fits the current "
                        "request, saved instructions, output contract, bounded references, and "
                        "authored task-fit facts. Do not invent another model or capability."
                    ),
                    "criteria": {
                        choice_id: (
                            "Select this exact configured compatible model record when it best "
                            "fits the supplied Run context."
                        )
                        for choice_id in choice_ids
                    },
                }
            },
        }
        try:
            response = _post_jev(
                _bounded_body(body, "auto_model_input_limit"),
                prefix="auto_model_jev",
            )
            if not isinstance(response.get("answers"), dict) or set(
                response["answers"]
            ) != {question_id}:
                raise ValueError("answers")
            decision_id = _decision_id(response)
            selected_choice, confidence = _choice_answer(
                response, question_id, choice_ids,
            )
            selected = choice_to_candidate[selected_choice]
            selected_id = str(selected["id"])
        except _JevSelectionError as error:
            decision = _model_decision(
                status=error.status, saved_model_id=saved_model_id,
                candidate_count=len(compatible), error_code=error.error_code,
            )
            raise AutoModelSelectionError(decision) from error
        except (KeyError, TypeError, ValueError, OverflowError) as error:
            decision = _model_decision(
                status="invalid", saved_model_id=saved_model_id,
                candidate_count=len(compatible),
                error_code="auto_model_jev_response_invalid",
            )
            raise AutoModelSelectionError(decision) from error
        decision = _model_decision(
            status="selected", saved_model_id=saved_model_id,
            candidate_count=len(compatible), selected_model_id=selected_id,
            confidence_percentage=confidence, decision_id=decision_id,
        )
    return {
        "provider": str(selected["provider"]),
        "accessMode": str(selected["accessMode"]),
        "modelKey": str(selected["modelKey"]),
        "providerModelId": str(selected["providerModelId"]),
    }, decision
