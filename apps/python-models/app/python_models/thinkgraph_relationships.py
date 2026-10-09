"""ThinkGraph relationship vocabulary and Jev-governed edge admission.

Engraphis remains the one store owner. This module classifies and persists only
the durable ThinkGraph relationships admitted by Jev.
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import json
import math
import os
import re
from typing import Any, Callable

import httpx

from engraphis.core.interfaces import Edge, Node, SearchFilter

from .engraphis import (
    bounded_graph_snapshot,
    canonical_entity_id,
    existing_entity_for_name,
    THINKGRAPH_INTAKE_LOCK,
    jev_edge_provenance,
    latest_endpoint_think,
    get_service,
    project_id,
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

JEV_MODEL = "typesafe/jev-1.13"
JEV_ENDPOINT = "https://openrouter.ai/api/alpha/decisions"
THINKGRAPH_CONTROL_OUTCOMES: tuple[str, ...] = ()
THINKGRAPH_JEV_ABSTAIN = "NONE"
_MAX_JEV_RELATIONSHIP_CONCURRENCY = 4
# Preserve the existing shared project-vocabulary ceiling used by both graph
# writers. ThinkGraph no longer spends any of those labels on admission outcomes.
JEV_CHOICE_OPTION_MAXIMUM = 255
PROJECT_RELATIONSHIP_VOCABULARY_MAXIMUM = 252
PROJECT_RELATIONSHIP_VOCABULARY_VERSION = (
    "project.relationship-vocabulary.v1"
)
_PROJECT_RELATIONSHIP_VOCABULARY_SETTING = (
    "jev_relationship_vocabulary"
)
_RELATIONSHIP_LABEL_PATTERN = re.compile(
    r"^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+){0,2}$"
)


class JevRelationshipError(RuntimeError):
    """A durable-edge Jev classification failed or explicitly abstained."""


class ThinkGraphIntakeError(RuntimeError):
    """The completed-pair intake could not start or persist its source memory."""


def normalize_relationship_label(value: Any) -> str:
    """Normalize one bounded predicate label without interpreting its meaning."""
    normalized = re.sub(r"[\s-]+", "_", str(value or "").strip()).upper()
    normalized = re.sub(r"_+", "_", normalized).strip("_")
    if not _RELATIONSHIP_LABEL_PATTERN.fullmatch(normalized):
        return ""
    return normalized


def relationship_vocabulary_hash(labels: tuple[str, ...] | list[str]) -> str:
    return hashlib.sha256(
        json.dumps(tuple(labels), separators=(",", ":")).encode("utf-8")
    ).hexdigest()


def _workspace_settings(store: Any, workspace_id: str) -> dict[str, Any]:
    row = store.conn.execute(
        "SELECT settings FROM workspaces WHERE id=?", (workspace_id,),
    ).fetchone()
    if row is None:
        raise ThinkGraphIntakeError("thinkgraph_workspace_unavailable")
    try:
        value = json.loads(str(row["settings"] or "{}"))
    except (TypeError, ValueError, json.JSONDecodeError) as error:
        raise ThinkGraphIntakeError(
            "thinkgraph_workspace_settings_invalid"
        ) from error
    if not isinstance(value, dict):
        raise ThinkGraphIntakeError("thinkgraph_workspace_settings_invalid")
    return value


def project_relationship_vocabulary(
    store: Any,
    workspace_id: str,
) -> tuple[str, ...]:
    """Read the seed 20 plus this project's Jev-promoted predicates."""
    settings = _workspace_settings(store, workspace_id)
    configured = settings.get(_PROJECT_RELATIONSHIP_VOCABULARY_SETTING)
    if configured is None:
        raw_labels: list[Any] = []
    elif isinstance(configured, dict) and isinstance(configured.get("labels"), list):
        raw_labels = configured["labels"]
    else:
        raise ThinkGraphIntakeError(
            "thinkgraph_relationship_vocabulary_invalid"
        )
    labels = list(SHARED_JEV_RELATIONSHIPS)
    for raw in raw_labels:
        label = normalize_relationship_label(raw)
        if not label:
            raise ThinkGraphIntakeError(
                "thinkgraph_relationship_vocabulary_invalid"
            )
        if label not in labels:
            labels.append(label)
    # Legacy vocabularies remain readable even when an older build allowed
    # more labels than one current Choice can carry.  Classification fails
    # explicitly at the provider boundary; durable graph data is never hidden
    # or deleted to make a request fit.
    return tuple(labels)


def _promote_project_relationship_label(
    store: Any,
    *,
    workspace_id: str,
    label: str,
) -> tuple[tuple[str, ...], bool]:
    """Append one Jev-winning predicate inside the caller's graph transaction."""
    normalized = normalize_relationship_label(label)
    if not normalized or normalized != label:
        raise ThinkGraphIntakeError(
            "thinkgraph_relationship_label_invalid"
        )
    current = project_relationship_vocabulary(store, workspace_id)
    if normalized in current:
        return current, False
    if len(current) >= PROJECT_RELATIONSHIP_VOCABULARY_MAXIMUM:
        raise ThinkGraphIntakeError(
            "thinkgraph_relationship_vocabulary_ceiling"
        )
    updated = (*current, normalized)
    settings = _workspace_settings(store, workspace_id)
    settings[_PROJECT_RELATIONSHIP_VOCABULARY_SETTING] = {
        "version": PROJECT_RELATIONSHIP_VOCABULARY_VERSION,
        "labels": list(updated),
    }
    store.conn.execute(
        "UPDATE workspaces SET settings=? WHERE id=?",
        (
            json.dumps(settings, ensure_ascii=False, separators=(",", ":")),
            workspace_id,
        ),
    )
    return updated, True


def relationship_choice_plan(
    relationship_proposal: str,
    vocabulary: tuple[str, ...],
    control_outcomes: tuple[str, ...] = THINKGRAPH_CONTROL_OUTCOMES,
) -> dict[str, Any]:
    """Offer the current vocabulary plus at most one structurally valid candidate."""
    normalized = normalize_relationship_label(relationship_proposal)
    at_maximum = len(vocabulary) >= PROJECT_RELATIONSHIP_VOCABULARY_MAXIMUM
    if normalized in vocabulary:
        status = "reused_canonical"
        candidate = ""
    elif not normalized:
        status = "invalid_novel_label"
        candidate = ""
    elif at_maximum:
        status = "novel_blocked_at_ceiling"
        candidate = ""
    else:
        status = "novel_candidate"
        candidate = normalized
    choices = (
        *vocabulary,
        *((candidate,) if candidate else ()),
        *control_outcomes,
    )
    if len(choices) > JEV_CHOICE_OPTION_MAXIMUM:
        raise ThinkGraphIntakeError(
            "thinkgraph_relationship_choice_capacity_exceeded"
        )
    return {
        "raw_proposal": str(relationship_proposal or ""),
        "normalized_proposal": normalized,
        "proposal_status": status,
        "novel_candidate": candidate,
        "vocabulary": vocabulary,
        "vocabulary_hash": relationship_vocabulary_hash(vocabulary),
        "vocabulary_at_maximum": at_maximum,
        "choices": choices,
    }


def relationship_vocabulary_state(labels: tuple[str, ...]) -> dict[str, Any]:
    return {
        "version": PROJECT_RELATIONSHIP_VOCABULARY_VERSION,
        "hash": relationship_vocabulary_hash(labels),
        "labels": list(labels),
        "count": len(labels),
        "maximum": PROJECT_RELATIONSHIP_VOCABULARY_MAXIMUM,
        "atMaximum": len(labels) >= PROJECT_RELATIONSHIP_VOCABULARY_MAXIMUM,
    }


def read_project_relationship_vocabulary(project: str) -> dict[str, Any]:
    """Read the one durable vocabulary shared by this project's graph twins."""
    service = get_service()
    with THINKGRAPH_INTAKE_LOCK:
        workspace_id = service.store.get_or_create_workspace(project_id(project))
        labels = project_relationship_vocabulary(service.store, workspace_id)
        return relationship_vocabulary_state(labels)
def promote_project_relationship_label(
    project: str,
    label: str,
) -> dict[str, Any]:
    """Promote one already-winning label through the shared Engraphis project seam."""
    service = get_service()
    with THINKGRAPH_INTAKE_LOCK:
        workspace_id = service.store.get_or_create_workspace(project_id(project))
        with service.store._write_operation(
            "project_jev_relationship_vocabulary", commit=True,
        ):
            labels, promoted = _promote_project_relationship_label(
                service.store,
                workspace_id=workspace_id,
                label=label,
            )
        return {
            **relationship_vocabulary_state(labels),
            "label": label,
            "promoted": promoted,
        }


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def text_hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()
def source_pair(payload: dict[str, Any]) -> dict[str, Any]:
    return {
        key: payload[key]
        for key in (
            "projectId", "deckId", "conversationId", "runId", "cardId",
            "hermesSessionId", "completedAt",
        )
        if payload.get(key)
    } | {
        "user_sha256": text_hash(payload["userMessage"]),
        "main_sha256": text_hash(payload["mainResponse"]),
    }


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


def _jev_provenance(
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


def _current_jev_pair_edges(
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


def _upsert_canonical_endpoint(
    store: Any,
    *,
    workspace_id: str,
    name: str,
) -> tuple[str, bool]:
    existing = existing_entity_for_name(
        store,
        workspace_id=workspace_id,
        name=name,
    )
    if existing is not None:
        return str(existing["id"]), False
    written_id = store.upsert_entity(
        Node(
            id="",
            name=name,
            ntype="person_or_concept",
            workspace_id=workspace_id,
            repo_id=None,
        ),
        commit=False,
    )
    canonical_id = canonical_entity_id(store, written_id) or written_id
    return canonical_id, canonical_id == written_id


def apply_accepted_decision(
    store: Any,
    *,
    workspace_id: str,
    payload: dict[str, Any],
    memory_id: str,
    relationship: dict[str, str],
    decision: dict[str, Any],
) -> dict[str, Any]:
    """Persist one Jev winner; the Card's free-form phrase is provenance only."""
    winner = str(decision.get("winner") or "")
    vocabulary = project_relationship_vocabulary(store, workspace_id)
    if winner not in vocabulary or winner == THINKGRAPH_JEV_ABSTAIN:
        raise ThinkGraphIntakeError(
            "thinkgraph_relationship_winner_not_canonical"
        )
    source_id, source_created = _upsert_canonical_endpoint(
        store,
        workspace_id=workspace_id,
        name=relationship["source"],
    )
    target_id, target_created = _upsert_canonical_endpoint(
        store,
        workspace_id=workspace_id,
        name=relationship["target"],
    )
    if not source_id or not target_id or source_id == target_id:
        raise ThinkGraphIntakeError("thinkgraph_relationship_endpoints_invalid")
    current = _current_jev_pair_edges(
        store,
        workspace_id=workspace_id,
        source_id=source_id,
        target_id=target_id,
    )
    provenance = _jev_provenance(
        decision,
        payload,
        memory_id=memory_id,
        natural_relationship=relationship["relation"],
    )
    replaced_ids: list[str] = []
    edge_weight = winner_probability(decision)
    if len(current) == 1 and current[0].relation == winner:
        existing = current[0]
        previous = (
            existing.provenance if isinstance(existing.provenance, dict) else {}
        )
        history = list(previous.get("jev_history") or [])
        if isinstance(previous.get("jev"), dict):
            history.append(deepcopy(previous["jev"]))
        provenance["jev_history"] = history
        edge_id = store.upsert_edge(
            Edge(
                id=existing.id,
                src=source_id,
                dst=target_id,
                relation=winner,
                weight=edge_weight,
                workspace_id=workspace_id,
                repo_id=None,
                valid_from=existing.valid_from,
                ingested_at=existing.ingested_at,
                provenance=provenance,
            ),
            commit=False,
        )
        status = "updated"
    else:
        for edge in current:
            store.invalidate_edge(edge.id, commit=False)
            replaced_ids.append(edge.id)
        edge_id = store.upsert_edge(
            Edge(
                id="",
                src=source_id,
                dst=target_id,
                relation=winner,
                weight=edge_weight,
                workspace_id=workspace_id,
                repo_id=None,
                provenance=provenance,
            ),
            commit=False,
        )
        status = "superseded" if replaced_ids else "written"
    return {
        **decision,
        "status": status,
        "edge_id": edge_id,
        "replaced_edge_ids": replaced_ids,
        "source": source_id,
        "target": target_id,
        "new_subjects": [
            {"canonicalName": name, "engraphisEntityId": entity_id}
            for name, entity_id, created in (
                (relationship["source"], source_id, source_created),
                (relationship["target"], target_id, target_created),
            )
            if created
        ],
        "relation": winner,
        "label_confidence": edge_weight,
        "relationship_strength": edge_weight,
    }
