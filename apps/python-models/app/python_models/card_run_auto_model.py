from __future__ import annotations

from typing import Any

from app.python_models import card_run_jev
from app.python_models.card_run_selection_context import _bounded_strings, _text
from app.python_models.saved_card_contract import CardDomainError


MAX_MODEL_CANDIDATES = 32
_MODEL_CANDIDATE_FIELDS = {"id", "provider", "accessMode", "modelKey",
    "providerModelId", "label",
    "eligible", "contextWindow", "supportsTools", "inputModalities",
    "reasoningEfforts", "taskFit",
}


class AutoModelSelectionError(CardDomainError):
    """A Run with Auto Model enabled could not select an authorized model."""

    def __init__(self, decision: dict[str, Any]) -> None:
        self.decision = decision
        self.auto_tools_decision: dict[str, Any] | None = None
        super().__init__(str(decision.get("errorCode") or "auto_model_selection_failed"))


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
            card_run_jev._question_id("model", str(candidate["id"])): candidate
            for candidate in compatible
        }
        choice_ids = tuple(choice_to_candidate)
        body = {
            "model": card_run_jev.JEV_MODEL,
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
            response = card_run_jev._post_jev(
                card_run_jev._bounded_body(body, "auto_model_input_limit"),
                prefix="auto_model_jev",
            )
            if not isinstance(response.get("answers"), dict) or set(
                response["answers"]
            ) != {question_id}:
                raise ValueError("answers")
            decision_id = card_run_jev._decision_id(response)
            selected_choice, confidence = card_run_jev._choice_answer(
                response, question_id, choice_ids,
            )
            selected = choice_to_candidate[selected_choice]
            selected_id = str(selected["id"])
        except card_run_jev._JevSelectionError as error:
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
