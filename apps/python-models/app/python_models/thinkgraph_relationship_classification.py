"""Source-pair provenance and Jev classification for ThinkGraph relationships."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from copy import deepcopy
from datetime import datetime, timezone
import json
import math
import os
from typing import Any, Callable

import httpx
from engraphis.core.interfaces import SearchFilter

from .engraphis import (
    bounded_graph_snapshot,
    existing_entity_for_name,
    jev_edge_provenance,
    latest_endpoint_think,
)
from .jev_edge_ontology import (
    SHARED_JEV_RELATIONSHIPS,
    SHARED_JEV_RELATIONSHIP_CRITERIA,
    SHARED_JEV_RELATIONSHIP_SCHEMA_HASH,
)
from .jev_validation import (
    validate_rounded_choice_winner,
    validate_rounded_probability_distribution,
)
from .thinkgraph_completed_pair_preparation import source_pair, text_hash
from .thinkgraph_relationship_vocabulary import (
    JEV_CHOICE_OPTION_MAXIMUM,
    PROJECT_RELATIONSHIP_VOCABULARY_VERSION,
    ThinkGraphIntakeError,
    relationship_vocabulary_hash,
)


JEV_MODEL = "typesafe/jev-1.13"
JEV_ENDPOINT = "https://openrouter.ai/api/alpha/decisions"
THINKGRAPH_JEV_ABSTAIN = "NONE"
_MAX_JEV_RELATIONSHIP_CONCURRENCY = 4


class JevRelationshipError(RuntimeError):
    """A durable-edge Jev classification failed or explicitly abstained."""


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _source_event_reference(payload: dict[str, Any]) -> dict[str, Any]:
    if payload.get("eventType") == "explicit_memory":
        return {
            key: payload[key]
            for key in ("eventType", "projectId", "toolName", "runId", "cardId")
            if payload.get(key)
        } | {
            "title_sha256": text_hash(str(payload.get("title") or "")),
            "content_sha256": text_hash(str(payload.get("content") or "")),
            "reason_sha256": text_hash(str(payload.get("reason") or "")),
        }
    return {"eventType": "completed_user_main_pair", **source_pair(payload)}


def winner_probability(decision: dict[str, Any]) -> float:
    """Return the one Jev number used by edge and node visual physics."""
    winner = str(decision.get("winner") or "")
    distribution = decision.get("distribution")
    value = (
        distribution.get(winner)
        if isinstance(distribution, dict) and winner
        else decision.get("label_confidence")
    )
    try:
        return max(0.0, min(1.0, float(value)))
    except (TypeError, ValueError, OverflowError):
        return 0.0


def relationship_choices(
    relationship_vocabulary: tuple[str, ...],
) -> tuple[str, ...]:
    choices = (*relationship_vocabulary, THINKGRAPH_JEV_ABSTAIN)
    if len(choices) > JEV_CHOICE_OPTION_MAXIMUM:
        raise JevRelationshipError(
            "thinkgraph_relationship_choice_capacity_exceeded"
        )
    return choices


def _validate_relationship_decision(
    value: Any,
    *,
    choices: tuple[str, ...],
) -> dict[str, Any]:
    """Validate one injected Jev result before any Engraphis graph write."""
    if not isinstance(value, dict):
        raise JevRelationshipError("jev_relationship_response_invalid")
    try:
        winner = str(value["winner"])
        distribution = validate_rounded_probability_distribution(
            value["distribution"], choices,
        )
        validate_rounded_choice_winner(winner, distribution)
        confidence = float(value["confidence"])
        if not math.isfinite(confidence) or not 0.0 <= confidence <= 1.0:
            raise ValueError("confidence")
    except (KeyError, TypeError, ValueError, OverflowError) as error:
        raise JevRelationshipError(
            "jev_relationship_response_invalid"
        ) from error
    return {
        **deepcopy(value),
        "winner": winner,
        "distribution": distribution,
        "confidence": confidence,
        "label_confidence": distribution[winner],
        "relationship_strength": distribution[winner],
        "choice_options": list(choices),
    }


def _bounded_relationship_context(
    store: Any,
    *,
    workspace_id: str,
    source_id: str = "",
    target_id: str = "",
    source_name: str = "",
    target_name: str = "",
    prior_think_snapshot: dict[str, dict[str, Any] | None] | None = None,
) -> dict[str, Any]:
    """Read bounded Engraphis context without creating either proposed endpoint."""
    snapshot = bounded_graph_snapshot(
        store,
        workspace_id=workspace_id,
        entity_ids=[source_id, target_id],
        edge_limit=24,
        think_limit=0,
    )
    snapshot.pop("thinks", None)
    latest_prior_thinks: list[dict[str, Any]] = []
    for endpoint, engraphis_entity_id in (("A", source_id), ("B", target_id)):
        if not engraphis_entity_id:
            think = None
        elif prior_think_snapshot is None:
            think = latest_endpoint_think(
                store,
                workspace_id=workspace_id,
                canonical_id=engraphis_entity_id,
            )
        else:
            think = deepcopy(prior_think_snapshot.get(engraphis_entity_id))
        if think is not None:
            latest_prior_thinks.append({"endpoint": endpoint, **think})
    snapshot["latest_prior_thinks"] = latest_prior_thinks
    snapshot["source"] = {
        "engraphis_entity_id": source_id or None,
        "name": source_name,
    }
    snapshot["target"] = {
        "engraphis_entity_id": target_id or None,
        "name": target_name,
    }
    snapshot["prior_pair_edges"] = [
        edge for edge in snapshot["incident_edges"]
        if source_id and target_id
        and edge["source_id"] == source_id
        and edge["target_id"] == target_id
    ][:4]
    return snapshot


def _turn_start_prior_think_snapshot(
    store: Any,
    *,
    workspace_id: str,
    relationships: list[dict[str, str]],
) -> dict[str, dict[str, Any] | None]:
    """Freeze prior endpoint Thinks before the current Think can exist."""
    focus_ids: list[str] = []
    for relationship in relationships:
        for name in (relationship["source"], relationship["target"]):
            existing = existing_entity_for_name(
                store,
                workspace_id=workspace_id,
                name=name,
            )
            if existing is not None:
                focus_ids.append(str(existing["id"]))
    return {
        engraphis_entity_id: latest_endpoint_think(
            store,
            workspace_id=workspace_id,
            canonical_id=engraphis_entity_id,
        )
        for engraphis_entity_id in dict.fromkeys(focus_ids)
    }


def classify_relationship(
    source: str,
    target: str,
    payload: dict[str, Any],
    supporting_think: str,
    graph_context: dict[str, Any],
    relationship_proposal: str,
    *,
    relationship_vocabulary: tuple[str, ...],
) -> dict[str, Any]:
    """Ask TypeSafe Jev, not the saved Card, for one canonical edge label."""
    api_key = os.environ.get("OPENROUTER_API_KEY", "").strip()
    if not api_key:
        raise JevRelationshipError("jev_openrouter_key_unavailable")
    choices = relationship_choices(relationship_vocabulary)
    criteria = {
        label: SHARED_JEV_RELATIONSHIP_CRITERIA.get(
            label,
            f"The proposed directed relationship is best represented by {label}.",
        )
        for label in relationship_vocabulary
    }
    criteria[THINKGRAPH_JEV_ABSTAIN] = (
        "The completed pair and proposal do not support any durable directed "
        "relationship in the supplied project vocabulary."
    )
    body = {
        "model": JEV_MODEL,
        "state": {
            "description": (
                "One completed observable User/Main pair, one model-authored "
                "free-form directed relationship proposal, and bounded existing "
                "ThinkGraph context. Classify A -> B into the current project "
                "vocabulary or abstain."
            ),
            "source_node_a": source,
            "target_node_b": target,
            "direction": "A -> B",
            "current_event": (
                f"USER:\n{payload['userMessage']}\n\n"
                f"MAIN:\n{payload['mainResponse']}"
            ),
            "thinkgraph_card_freeform_relationship_proposal": (
                relationship_proposal
            ),
            "supporting_think": supporting_think,
            "bounded_local_graph": graph_context,
            "current_project_relationship_vocabulary": list(
                relationship_vocabulary
            ),
        },
        "questions": {
            "relationship": {
                "type": "choice",
                "instructions": (
                    "Classify the saved ThinkGraph Card's free-form A -> B "
                    "proposal. Choose exactly one supplied canonical project "
                    "predicate only when the completed pair supports it; otherwise "
                    "choose NONE. The Card's wording is evidence, never a canonical "
                    "label or fallback. Use bounded graph context only for "
                    "normalization continuity. Do not invent, rename, reverse, or "
                    "add endpoints or relationships."
                ),
                "criteria": criteria,
            }
        },
    }
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
        raise JevRelationshipError("jev_relationship_timeout") from error
    except (httpx.HTTPError, json.JSONDecodeError, ValueError) as error:
        raise JevRelationshipError("jev_relationship_unavailable") from error
    if not isinstance(response, dict):
        raise JevRelationshipError("jev_relationship_response_invalid")
    try:
        answer = response["answers"]["relationship"]
        if not isinstance(answer, dict) or answer.get("type") != "choice":
            raise ValueError("answer type")
        decision = {
            "decision_id": str(response.get("id") or ""),
            "winner": answer["choice"],
            "distribution": answer["probabilities"],
            "confidence": answer["confidence"],
            "provider": str(response.get("provider") or ""),
            "requested_model": JEV_MODEL,
            "resolved_model": str(response.get("model") or ""),
            "usage": (
                deepcopy(response.get("usage"))
                if isinstance(response.get("usage"), dict) else {}
            ),
        }
    except (KeyError, TypeError, ValueError) as error:
        raise JevRelationshipError(
            "jev_relationship_response_invalid"
        ) from error
    return {
        **_validate_relationship_decision(decision, choices=choices),
        "vocabulary_version": PROJECT_RELATIONSHIP_VOCABULARY_VERSION,
        "vocabulary_hash": relationship_vocabulary_hash(
            relationship_vocabulary
        ),
        "vocabulary_count": len(relationship_vocabulary),
    }


def classify_relationships(
    store: Any,
    *,
    workspace_id: str,
    payload: dict[str, Any],
    summary: str,
    relationships: list[dict[str, str]],
    classifier: Callable[..., dict[str, Any]],
    relationship_vocabulary: tuple[str, ...],
) -> list[dict[str, Any]]:
    """Obtain every Jev decision before the Engraphis graph can be mutated."""
    choices = relationship_choices(relationship_vocabulary)
    prior_thinks = _turn_start_prior_think_snapshot(
        store,
        workspace_id=workspace_id,
        relationships=relationships,
    )
    work: list[dict[str, Any]] = []
    for index, relationship in enumerate(relationships):
        source_row = existing_entity_for_name(
            store,
            workspace_id=workspace_id,
            name=relationship["source"],
        )
        target_row = existing_entity_for_name(
            store,
            workspace_id=workspace_id,
            name=relationship["target"],
        )
        source_id = str(source_row["id"]) if source_row else ""
        target_id = str(target_row["id"]) if target_row else ""
        work.append({
            "index": index,
            "relationship": relationship,
            "context": _bounded_relationship_context(
                store,
                workspace_id=workspace_id,
                source_id=source_id,
                target_id=target_id,
                source_name=relationship["source"],
                target_name=relationship["target"],
                prior_think_snapshot=prior_thinks,
            ),
        })
    if not work:
        raise ThinkGraphIntakeError("thinkgraph_card_relationship_required")
    decisions: list[dict[str, Any] | None] = [None] * len(work)
    errors: list[Exception | None] = [None] * len(work)

    def decide(item: dict[str, Any]) -> dict[str, Any]:
        relationship = item["relationship"]
        value = classifier(
            relationship["source"],
            relationship["target"],
            payload,
            summary,
            item["context"],
            relationship["relation"],
            relationship_vocabulary=relationship_vocabulary,
        )
        return _validate_relationship_decision(value, choices=choices)

    with ThreadPoolExecutor(
        max_workers=min(_MAX_JEV_RELATIONSHIP_CONCURRENCY, len(work)),
        thread_name_prefix="thinkgraph-jev",
    ) as executor:
        future_items = {executor.submit(decide, item): item for item in work}
        for future in as_completed(future_items):
            item = future_items[future]
            try:
                decisions[item["index"]] = future.result()
            except Exception as error:
                errors[item["index"]] = error

    for error in errors:
        if error is None:
            continue
        if isinstance(error, JevRelationshipError):
            raise error
        raise JevRelationshipError("jev_relationship_unavailable") from error
    validated = [decision for decision in decisions if decision is not None]
    if len(validated) != len(relationships):
        raise JevRelationshipError("jev_relationship_unavailable")
    if any(
        decision["winner"] == THINKGRAPH_JEV_ABSTAIN
        for decision in validated
    ):
        raise JevRelationshipError("jev_relationship_abstained")
    return validated


def jev_provenance(
    decision: dict[str, Any],
    payload: dict[str, Any],
    *,
    memory_id: str,
    natural_relationship: str,
) -> dict[str, Any]:
    jev = {
        "question_schema_version": "thinkgraph.relationship-choice.v5",
        "vocabulary_version": decision.get(
            "vocabulary_version", PROJECT_RELATIONSHIP_VOCABULARY_VERSION,
        ),
        "vocabulary_hash": decision.get(
            "vocabulary_hash", SHARED_JEV_RELATIONSHIP_SCHEMA_HASH,
        ),
        "vocabulary_count": int(
            decision.get("vocabulary_count") or len(SHARED_JEV_RELATIONSHIPS)
        ),
        "decision_id": str(decision.get("decision_id") or ""),
        "provider": str(decision.get("provider") or ""),
        "requested_model": str(decision.get("requested_model") or JEV_MODEL),
        "resolved_model": str(decision.get("resolved_model") or ""),
        "evaluated_at": _utc_now(),
        "winner": decision["winner"],
        "distribution": deepcopy(decision["distribution"]),
        "provider_confidence": decision["confidence"],
        "label_confidence": winner_probability(decision),
        "relationship_strength": winner_probability(decision),
        "natural_relationship": natural_relationship,
        "source_event": _source_event_reference(payload),
        "usage": deepcopy(decision.get("usage") or {}),
    }
    return {
        "source": "jev_relationship_classifier",
        "memory_id": memory_id,
        "memory_ids": [memory_id],
        "confidence": jev["label_confidence"],
        "jev": jev,
    }


def current_jev_pair_edges(
    store: Any,
    *,
    workspace_id: str,
    source_id: str,
    target_id: str,
) -> list[Any]:
    return sorted(
        (
            edge for edge in store.neighbors(
                [source_id],
                flt=SearchFilter(workspace_id=workspace_id),
                limit=256,
            )
            if edge.src == source_id
            and edge.dst == target_id
            and jev_edge_provenance(edge) is not None
        ),
        key=lambda edge: edge.id,
    )
