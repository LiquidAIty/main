"""Read-only Jev focus ranking for a bounded cross-authority neighborhood."""
from __future__ import annotations

import hashlib
import json
import math
import os
from typing import Any

import httpx

from .jev_validation import (
    validate_rounded_choice_winner,
    validate_rounded_probability_distribution,
)
from .thinkgraph_relationships import (
    JEV_ENDPOINT,
    JEV_MODEL,
)


class JevGraphError(RuntimeError):
    """One read-only Jev graph decision failed with a typed public status."""

    def __init__(self, status: str, error_code: str) -> None:
        if status not in {"unavailable", "timeout", "invalid", "error"}:
            raise ValueError("jev_graph_status_invalid")
        self.status = status
        self.error_code = error_code
        super().__init__(error_code)


def _focus_choice_id(authority: str, entity_id: str) -> str:
    """Identify one provider entity inside a single read-only JevFocus Choice."""

    identity = f"{authority}\0{entity_id}".encode("utf-8")
    return f"focus_{hashlib.sha256(identity).hexdigest()[:24]}"


def _focus_text(
    value: Any,
    *,
    maximum: int,
    required: bool = True,
) -> str:
    if not isinstance(value, str) or len(value) > maximum:
        raise JevGraphError("invalid", "jev_focus_request_invalid")
    if required and not value.strip():
        raise JevGraphError("invalid", "jev_focus_request_invalid")
    return value


def _focus_description(value: Any) -> str | None:
    if value is None:
        return None
    return _focus_text(value, maximum=2_000, required=False)


def _focus_exact_keys(
    value: dict[str, Any],
    required: set[str],
    optional: set[str] | None = None,
) -> None:
    keys = set(value)
    if not required.issubset(keys) or not keys.issubset(required | (optional or set())):
        raise JevGraphError("invalid", "jev_focus_request_invalid")


def _validated_focus_center(
    value: Any,
) -> tuple[dict[str, Any], set[tuple[str, str]]]:
    if not isinstance(value, dict):
        raise JevGraphError("invalid", "jev_focus_request_invalid")
    _focus_exact_keys(value, {"visualId", "title", "providerMembers"})
    center_visual_id = _focus_text(value.get("visualId"), maximum=512)
    center_title = _focus_text(value.get("title"), maximum=256)
    raw_members = value.get("providerMembers")
    if (
        not isinstance(raw_members, list)
        or not 1 <= len(raw_members) <= 16
        or any(not isinstance(member, dict) for member in raw_members)
    ):
        raise JevGraphError("invalid", "jev_focus_request_invalid")
    center_members: list[dict[str, Any]] = []
    center_member_keys: set[tuple[str, str]] = set()
    for raw_member in raw_members:
        _focus_exact_keys(raw_member, {"authority", "entityId", "title"}, {"description"})
        authority = _focus_text(raw_member.get("authority"), maximum=32)
        entity_id = _focus_text(raw_member.get("entityId"), maximum=512)
        if authority not in {"ThinkGraph", "KnowGraph"}:
            raise JevGraphError("invalid", "jev_focus_request_invalid")
        member_key = (authority, entity_id)
        if member_key in center_member_keys:
            raise JevGraphError("invalid", "jev_focus_request_invalid")
        center_member_keys.add(member_key)
        member = {
            "authority": authority,
            "entityId": entity_id,
            "title": _focus_text(raw_member.get("title"), maximum=256),
        }
        if "description" in raw_member:
            member["description"] = _focus_description(raw_member.get("description"))
        center_members.append(member)
    return {
        "visualId": center_visual_id,
        "title": center_title,
        "providerMembers": center_members,
    }, center_member_keys


def _validated_focus_candidates(
    value: Any,
    *,
    center_visual_id: str,
    center_member_keys: set[tuple[str, str]],
) -> list[dict[str, Any]]:
    if (
        not isinstance(value, list)
        or not 1 <= len(value) <= 12
        or any(not isinstance(candidate, dict) for candidate in value)
    ):
        raise JevGraphError("invalid", "jev_focus_request_invalid")
    candidates: list[dict[str, Any]] = []
    candidate_keys: set[tuple[str, str]] = set()
    relationship_keys: set[tuple[str, str]] = set()
    for raw_candidate in value:
        _focus_exact_keys(
            raw_candidate,
            {
                "visualId", "authority", "entityId", "title", "description",
                "incidentRelationships",
            },
        )
        visual_id = _focus_text(raw_candidate.get("visualId"), maximum=512)
        authority = _focus_text(raw_candidate.get("authority"), maximum=32)
        entity_id = _focus_text(raw_candidate.get("entityId"), maximum=512)
        if (
            authority not in {"ThinkGraph", "KnowGraph"}
            or visual_id == center_visual_id
            or (authority, entity_id) in center_member_keys
            or (authority, entity_id) in candidate_keys
        ):
            raise JevGraphError("invalid", "jev_focus_request_invalid")
        candidate_keys.add((authority, entity_id))
        relationships = raw_candidate.get("incidentRelationships")
        if (
            not isinstance(relationships, list)
            or not 1 <= len(relationships) <= 24
            or any(not isinstance(relationship, dict) for relationship in relationships)
        ):
            raise JevGraphError("invalid", "jev_focus_request_invalid")
        validated_relationships: list[dict[str, Any]] = []
        for relationship in relationships:
            _focus_exact_keys(
                relationship,
                {
                    "edgeId", "relationshipId", "sourceVisualId", "sourceId",
                    "sourceTitle", "targetVisualId", "targetId", "targetTitle",
                    "predicate", "direction", "relationshipWeight",
                },
            )
            relationship_id = _focus_text(
                relationship.get("relationshipId"), maximum=512,
            )
            relationship_key = (authority, relationship_id)
            if relationship_key in relationship_keys:
                raise JevGraphError("invalid", "jev_focus_request_invalid")
            relationship_keys.add(relationship_key)
            source_visual_id = _focus_text(
                relationship.get("sourceVisualId"), maximum=512,
            )
            target_visual_id = _focus_text(
                relationship.get("targetVisualId"), maximum=512,
            )
            source_id = _focus_text(relationship.get("sourceId"), maximum=512)
            target_id = _focus_text(relationship.get("targetId"), maximum=512)
            direction = _focus_text(relationship.get("direction"), maximum=16)
            outgoing = (
                source_visual_id == center_visual_id
                and target_visual_id == visual_id
                and (authority, source_id) in center_member_keys
                and target_id == entity_id
                and direction == "outgoing"
            )
            incoming = (
                source_visual_id == visual_id
                and target_visual_id == center_visual_id
                and source_id == entity_id
                and (authority, target_id) in center_member_keys
                and direction == "incoming"
            )
            if not (outgoing or incoming):
                raise JevGraphError("invalid", "jev_focus_request_invalid")
            weight = relationship.get("relationshipWeight")
            if weight is not None:
                if isinstance(weight, bool) or not isinstance(weight, (int, float)):
                    raise JevGraphError("invalid", "jev_focus_request_invalid")
                weight = float(weight)
                if not math.isfinite(weight) or not 0.0 <= weight <= 1.0:
                    raise JevGraphError("invalid", "jev_focus_request_invalid")
            validated_relationships.append({
                "edgeId": _focus_text(relationship.get("edgeId"), maximum=512),
                "relationshipId": relationship_id,
                "sourceVisualId": source_visual_id,
                "sourceId": source_id,
                "sourceTitle": _focus_text(relationship.get("sourceTitle"), maximum=256),
                "targetVisualId": target_visual_id,
                "targetId": target_id,
                "targetTitle": _focus_text(relationship.get("targetTitle"), maximum=256),
                "predicate": _focus_text(relationship.get("predicate"), maximum=256),
                "direction": direction,
                "relationshipWeight": weight,
            })
        candidates.append({
            "visualId": visual_id,
            "authority": authority,
            "entityId": entity_id,
            "title": _focus_text(raw_candidate.get("title"), maximum=256),
            "description": _focus_description(raw_candidate.get("description")),
            "incidentRelationships": validated_relationships,
        })
    return candidates


def _validated_focus_request(
    payload: dict[str, Any],
) -> tuple[str, dict[str, Any], list[dict[str, Any]]]:
    """Validate the bounded client projection without reading either provider graph."""

    if not isinstance(payload, dict):
        raise JevGraphError("invalid", "jev_focus_request_invalid")
    _focus_exact_keys(
        payload,
        {"schemaVersion", "sourceRevision", "projectId", "center", "candidates"},
    )
    if payload.get("schemaVersion") != "jev-focus.request.v1":
        raise JevGraphError("invalid", "jev_focus_request_invalid")
    source_revision = _focus_text(payload.get("sourceRevision"), maximum=512)
    _focus_text(payload.get("projectId"), maximum=256)

    center, center_member_keys = _validated_focus_center(payload.get("center"))
    center_visual_id = str(center["visualId"])

    candidates = _validated_focus_candidates(
        payload.get("candidates"),
        center_visual_id=center_visual_id,
        center_member_keys=center_member_keys,
    )
    return source_revision, center, candidates


def _validate_jev_focus_response(
    response: dict[str, Any],
    choice_ids: tuple[str, ...],
) -> tuple[str, dict[str, float], float]:
    """Return Jev's complete, unmodified probability distribution."""

    try:
        raw_decision_id = response["id"]
        if not isinstance(raw_decision_id, str):
            raise ValueError("decision")
        decision_id = raw_decision_id.strip()
        answer = response["answers"]["focus"]
        if not decision_id or not isinstance(answer, dict):
            raise ValueError("decision")
        if answer.get("type") != "choice":
            raise ValueError("answer type")
        winner = str(answer["choice"])
        if winner not in choice_ids:
            raise ValueError("winner")
        raw = answer["probabilities"]
        if not isinstance(raw, dict) or set(raw) != set(choice_ids):
            raise ValueError("probability keys")
        if any(isinstance(raw[choice_id], bool) for choice_id in choice_ids):
            raise ValueError("probability values")
        probabilities = validate_rounded_probability_distribution(raw, choice_ids)
        validate_rounded_choice_winner(winner, probabilities)
        confidence = float(answer["confidence"])
        if not math.isfinite(confidence) or not 0.0 <= confidence <= 1.0:
            raise ValueError("confidence")
    except (KeyError, TypeError, ValueError, OverflowError) as error:
        raise JevGraphError("invalid", "jev_focus_response_invalid") from error
    return decision_id, probabilities, confidence


def _focus_options(
    candidates: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], tuple[str, ...]]:
    options: list[dict[str, Any]] = []
    choice_ids: list[str] = []
    for candidate in candidates:
        choice_id = _focus_choice_id(
            str(candidate["authority"]), str(candidate["entityId"]),
        )
        choice_ids.append(choice_id)
        relationships = [{
            "relationship_id": relationship["relationshipId"],
            "source_id": relationship["sourceId"],
            "source_title": relationship["sourceTitle"],
            "target_id": relationship["targetId"],
            "target_title": relationship["targetTitle"],
            "predicate": relationship["predicate"],
            "direction_from_center": relationship["direction"],
        } for relationship in candidate["incidentRelationships"]]
        options.append({
            "choice_id": choice_id,
            "authority": candidate["authority"],
            "entity_id": candidate["entityId"],
            "title": candidate["title"],
            "description": candidate["description"],
            "incident_relationships": relationships,
        })
    return options, tuple(choice_ids)


def _request_jev_focus(
    center: dict[str, Any],
    options: list[dict[str, Any]],
) -> dict[str, Any]:
    api_key = os.environ.get("OPENROUTER_API_KEY", "").strip()
    if not api_key:
        raise JevGraphError(
            "unavailable", "jev_focus_openrouter_key_unavailable"
        )
    criteria = {
        option["choice_id"]: (
            "Rank this exact connected provider entity by how useful its supplied stored "
            "content and real incident relationships are for understanding the fixed center."
        )
        for option in options
    }
    body = {
        "model": JEV_MODEL,
        "state": {
            "description": (
                "One fixed user-selected graph subject and at most twelve directly connected "
                "provider entity candidates with bounded stored content and real relationships."
            ),
            "fixed_center": {
                "visual_id": center["visualId"],
                "title": center["title"],
                "provider_members": [{
                    "authority": member["authority"],
                    "entity_id": member["entityId"],
                    "title": member["title"],
                    **({"description": member["description"]}
                       if "description" in member else {}),
                } for member in center["providerMembers"]],
            },
            "connected_subject_options": options,
        },
        "questions": {
            "focus": {
                "type": "choice",
                "instructions": (
                    "The user is exploring the fixed center. The center is not a candidate. "
                    "Rank the supplied connected subjects by how useful they are for "
                    "understanding the center, using only their supplied provider content and "
                    "real relationships. Prioritize direct explanatory relevance over generic "
                    "popularity, graph degree, on-screen distance, or persisted edge weights. "
                    "Retain contrary or qualifying context when useful. Return a full "
                    "probability distribution across every opaque choice id. Do not invent "
                    "facts, nodes, edges, permissions, or probabilities. This is relative "
                    "focus relevance, not truth."
                ),
                "criteria": criteria,
            }
        },
    }
    if len(
        json.dumps(body, ensure_ascii=False, default=str).encode("utf-8")
    ) > 240_000:
        raise JevGraphError("invalid", "jev_focus_input_limit")
    try:
        with httpx.Client(timeout=45.0, follow_redirects=False) as client:
            result = client.post(
                JEV_ENDPOINT,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json=body,
            )
            result.raise_for_status()
            response = result.json()
    except httpx.TimeoutException as error:
        raise JevGraphError("timeout", "jev_focus_timeout") from error
    except httpx.HTTPError as error:
        raise JevGraphError("unavailable", "jev_focus_unavailable") from error
    except (json.JSONDecodeError, ValueError) as error:
        raise JevGraphError("invalid", "jev_focus_response_invalid") from error
    except Exception as error:
        raise JevGraphError("error", "jev_focus_request_error") from error
    if not isinstance(response, dict):
        raise JevGraphError("invalid", "jev_focus_response_invalid")
    return response


def _focus_result(
    *,
    source_revision: str,
    candidates: list[dict[str, Any]],
    choice_ids: tuple[str, ...],
    response: dict[str, Any],
) -> dict[str, Any]:
    decision_id, distribution, confidence = _validate_jev_focus_response(
        response, choice_ids,
    )
    ranked_indexes = sorted(
        range(len(candidates)),
        key=lambda index: (
            -distribution[choice_ids[index]],
            str(candidates[index]["authority"]),
            str(candidates[index]["entityId"]),
        ),
    )
    rank_by_index = {
        candidate_index: rank
        for rank, candidate_index in enumerate(ranked_indexes, start=1)
    }
    selected_visual_ids: set[str] = set()
    for candidate_index in ranked_indexes:
        visual_id = str(candidates[candidate_index]["visualId"])
        if visual_id in selected_visual_ids:
            continue
        if len(selected_visual_ids) >= 8:
            break
        selected_visual_ids.add(visual_id)
    response_candidates = [{
        **candidate,
        "choiceId": choice_ids[index],
        "probability": distribution[choice_ids[index]],
        "rank": rank_by_index[index],
        "selected": candidate["visualId"] in selected_visual_ids,
    } for index, candidate in enumerate(candidates)]
    return {
        "schemaVersion": "jev-focus.v1",
        "sourceRevision": source_revision,
        "status": "success",
        "decisionId": decision_id,
        "errorCode": None,
        "distribution": distribution,
        "confidence": confidence,
        "candidates": response_candidates,
    }


def decide_graph_focus(payload: dict[str, Any]) -> dict[str, Any]:
    """Run one read-only Choice over bounded connected provider entities."""

    source_revision, center, candidates = _validated_focus_request(payload)
    options, choice_ids = _focus_options(candidates)
    response = _request_jev_focus(center, options)
    return _focus_result(
        source_revision=source_revision,
        candidates=candidates,
        choice_ids=choice_ids,
        response=response,
    )
