"""ThinkGraph through Engraphis's public Python service and MCP tools.
Python rails owns the service. Workspace binding comes from the authenticated
project; neither tool callers nor the browser choose another database or tenant.
"""
from __future__ import annotations

import atexit
import asyncio
from copy import deepcopy
from datetime import datetime, timezone
from enum import Enum
import hashlib
import json
import math
import os
from pathlib import Path
import re
import threading
from typing import Any

import httpx

from engraphis.core.interfaces import MemoryType, Scope, SearchFilter

from .jev_edge_ontology import (
    SHARED_JEV_RELATIONSHIPS,
)
from .jev_validation import (
    validate_rounded_choice_winner,
    validate_rounded_probability_distribution,
    validate_rounded_weighted_score,
)

DATABASE = Path(__file__).resolve().parents[4] / "db" / "thinkgraph.sqlite"
MODEL = "local:sentence-transformers/all-MiniLM-L6-v2"
MODEL_REVISION = "1110a243fdf4706b3f48f1d95db1a4f5529b4d41"
READ_TOOLS = frozenset(['engraphis_code_impact', 'engraphis_code_path', 'engraphis_conflict_review', 'engraphis_context_savings', 'engraphis_discover_actions', 'engraphis_execute_read', 'engraphis_export_code_graph', 'engraphis_export_receipts', 'engraphis_get_memory', 'engraphis_recall_context', 'engraphis_recall_proactive', 'engraphis_receipts', 'engraphis_search_code', 'engraphis_stats', 'engraphis_timeline', 'engraphis_verify_receipts', 'engraphis_why'])
WRITE_TOOLS = frozenset(['engraphis_answer', 'engraphis_check_update', 'engraphis_consolidate', 'engraphis_correct', 'engraphis_end_session', 'engraphis_execute_action', 'engraphis_forget', 'engraphis_index_repo', 'engraphis_ingest', 'engraphis_ingest_postgres_schema', 'engraphis_link', 'engraphis_link_symbol', 'engraphis_pin', 'engraphis_proactive_context', 'engraphis_promote', 'engraphis_recall', 'engraphis_recall_grounded', 'engraphis_record_event', 'engraphis_remember', 'engraphis_remember_many', 'engraphis_retire', 'engraphis_secure_erase', 'engraphis_session', 'engraphis_start_session', 'engraphis_update_memory'])
_service = None
_lock = threading.RLock()
_intake_lock = threading.RLock()

JEV_MODEL = "typesafe/jev-1.13"
JEV_ENDPOINT = "https://openrouter.ai/api/alpha/decisions"
THINKGRAPH_CONTROL_OUTCOMES: tuple[str, ...] = ()
THINKGRAPH_JEV_CHOICES = SHARED_JEV_RELATIONSHIPS + THINKGRAPH_CONTROL_OUTCOMES
_TRUSTED_STRUCTURED_GRAPH_KEYS = frozenset(
    ("entities", "relations", "structured_extraction")
)
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

class JevGraphError(RuntimeError):
    """One read-only Jev graph decision failed with a typed public status."""

    def __init__(self, status: str, error_code: str) -> None:
        if status not in {"unavailable", "timeout", "invalid", "error"}:
            raise ValueError("jev_graph_status_invalid")
        self.status = status
        self.error_code = error_code
        super().__init__(error_code)


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


def _project_relationship_vocabulary(
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
    current = _project_relationship_vocabulary(store, workspace_id)
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


def _relationship_vocabulary_state(labels: tuple[str, ...]) -> dict[str, Any]:
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
    with _intake_lock:
        workspace_id = service.store.get_or_create_workspace(project_id(project))
        labels = _project_relationship_vocabulary(service.store, workspace_id)
        return _relationship_vocabulary_state(labels)


def read_subject_directory(project: str) -> dict[str, Any]:
    """Return every canonical project subject header without Think bodies or edges."""

    service = get_service()
    project = project_id(project)
    with _lock:
        row = service.store.conn.execute(
            "SELECT id FROM workspaces WHERE name=?", (project,),
        ).fetchone()
        if row is None:
            empty_revision = hashlib.sha256(b"[]").hexdigest()
            return {
                "complete": True, "count": 0, "revision": empty_revision,
                "subjects": [],
            }
        workspace_id = str(row["id"])
        rows = service.store.conn.execute(
            "SELECT id, name, etype, COALESCE(canonical_id,id) AS canonical_id "
            "FROM entities WHERE workspace_id=? AND repo_id IS NULL ORDER BY id",
            (workspace_id,),
        ).fetchall()
        by_canonical: dict[str, dict[str, str]] = {}
        for raw in rows:
            canonical_id = str(raw["canonical_id"] or raw["id"])
            canonical = _entity_row(service.store, canonical_id)
            if canonical is None:
                return {
                    "complete": False, "count": len(rows), "revision": "invalid",
                    "subjects": [],
                }
            by_canonical[canonical_id] = {
                "engraphisEntityId": canonical_id,
                "canonicalName": str(canonical.get("name") or ""),
                "entityKind": str(canonical.get("etype") or ""),
            }
        subjects = sorted(
            by_canonical.values(),
            key=lambda item: (item["canonicalName"], item["engraphisEntityId"]),
        )
        revision = hashlib.sha256(
            json.dumps(
                subjects, ensure_ascii=False, sort_keys=True, separators=(",", ":")
            ).encode("utf-8")
        ).hexdigest()
        return {
            "complete": True,
            "count": len(subjects),
            "revision": f"{_graph_revision(service.store, workspace_id)}:{revision}",
            "subjects": subjects,
        }


def promote_project_relationship_label(
    project: str,
    label: str,
) -> dict[str, Any]:
    """Promote one already-winning label through the shared Engraphis project seam."""
    service = get_service()
    with _intake_lock:
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
            **_relationship_vocabulary_state(labels),
            "label": label,
            "promoted": promoted,
        }


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _text_hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _observation_time(value: Any) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError, OverflowError):
        return 0.0
    return parsed if math.isfinite(parsed) else 0.0


def _newest_think_key(item: dict[str, Any]) -> tuple[float, str]:
    return (
        -_observation_time(item.get("ingested_at", item.get("ingestedAt"))),
        str(item.get("memory_id") or item.get("id") or ""),
    )


def _source_pair(payload: dict[str, Any]) -> dict[str, Any]:
    return {
        key: payload[key]
        for key in (
            "projectId", "deckId", "conversationId", "runId", "cardId",
            "hermesSessionId", "completedAt",
        )
        if payload.get(key)
    } | {
        "user_sha256": _text_hash(payload["userMessage"]),
        "main_sha256": _text_hash(payload["mainResponse"]),
    }


def _validate_source_response_fit(value: Any, run_id: str) -> dict[str, Any]:
    """Validate one response-scoped assessment without recomputing its numbers."""

    if not isinstance(value, dict):
        raise ValueError("thinkgraph_source_response_fit_invalid")
    allowed = {
        "schemaVersion", "metric", "rubricVersion", "status", "runId",
        "cardRevisionId", "idfSha256", "outputSha256",
        "executionEvidenceSha256", "executionEvidenceComplete",
        "executionEvidenceError", "actualProvider", "actualModel",
        "exposedToolsSha256",
        "requestedModel", "scale", "evaluatedAt", "failureReason",
        "requestCount", "questionCount", "timingMs", "rawScore",
        "normalizedScore100", "probabilities", "confidence", "provider",
        "resolvedModel", "decisionId", "usage",
    }
    if set(value) - allowed:
        raise ValueError("thinkgraph_source_response_fit_invalid")
    result = deepcopy(value)
    if (
        result.get("schemaVersion") != "request-fulfillment-assessment.v1"
        or result.get("metric") != "request_fulfillment"
        or result.get("rubricVersion") != "request-fulfillment.v1"
        or result.get("status") not in {"scored", "unavailable"}
        or str(result.get("runId") or "") != run_id
    ):
        raise ValueError("thinkgraph_source_response_fit_invalid")
    for field in (
        "idfSha256", "outputSha256", "executionEvidenceSha256",
        "exposedToolsSha256",
    ):
        if field in result and not re.fullmatch(r"[a-f0-9]{64}", str(result[field])):
            raise ValueError("thinkgraph_source_response_fit_invalid")
    if len(json.dumps(result, ensure_ascii=False).encode("utf-8")) > 100_000:
        raise ValueError("thinkgraph_source_response_fit_invalid")
    if result["status"] == "scored":
        probabilities = result.get("probabilities")
        if not isinstance(probabilities, dict) or set(probabilities) != {
            "0", "1", "2", "3", "4"
        }:
            raise ValueError("thinkgraph_source_response_fit_invalid")
        try:
            normalized = float(result["normalizedScore100"])
            confidence = float(result["confidence"])
            values = validate_rounded_probability_distribution(
                probabilities, ("0", "1", "2", "3", "4"),
            )
            raw_score = validate_rounded_weighted_score(
                result["rawScore"], values, ("0", "1", "2", "3", "4"),
            )
        except (KeyError, TypeError, ValueError, OverflowError) as error:
            raise ValueError("thinkgraph_source_response_fit_invalid") from error
        required_text = (
            "cardRevisionId", "idfSha256", "outputSha256",
            "executionEvidenceSha256", "exposedToolsSha256",
            "actualProvider", "actualModel",
            "requestedModel", "evaluatedAt", "provider", "resolvedModel",
            "decisionId",
        )
        scale = result.get("scale")
        if (
            not math.isfinite(raw_score) or not 0.0 <= raw_score <= 4.0
            or not math.isclose(normalized, raw_score * 25.0, rel_tol=0.0, abs_tol=0.000001)
            or not math.isfinite(confidence) or not 0.0 <= confidence <= 1.0
            or any(not math.isfinite(item) or not 0.0 <= item <= 1.0 for item in values.values())
            or any(not str(result.get(field) or "").strip() for field in required_text)
            or scale != {"minimum": 0.0, "maximum": 4.0}
            or result.get("executionEvidenceComplete") is not True
            or result.get("executionEvidenceError") is not None
            or "failureReason" in result
            or result.get("requestCount") != 1
            or result.get("questionCount") != 1
            or not isinstance(result.get("usage"), dict)
        ):
            raise ValueError("thinkgraph_source_response_fit_invalid")
    else:
        if (
            not str(result.get("failureReason") or "")
            or not isinstance(result.get("executionEvidenceComplete"), bool)
        ):
            raise ValueError("thinkgraph_source_response_fit_invalid")
        for field in ("rawScore", "normalizedScore100", "probabilities", "confidence"):
            if field in result:
                raise ValueError("thinkgraph_source_response_fit_invalid")
    return result


def _edge_memory_ids(edge: Any) -> list[str]:
    provenance = edge.provenance if isinstance(edge.provenance, dict) else {}
    values = [provenance.get("memory_id")]
    if isinstance(provenance.get("memory_ids"), list):
        values.extend(provenance["memory_ids"])
    return list(dict.fromkeys(str(value) for value in values if value))


def _source_event_reference(payload: dict[str, Any]) -> dict[str, Any]:
    if payload.get("eventType") == "explicit_memory":
        return {
            key: payload[key]
            for key in ("eventType", "projectId", "toolName", "runId", "cardId")
            if payload.get(key)
        } | {
            "title_sha256": _text_hash(str(payload.get("title") or "")),
            "content_sha256": _text_hash(str(payload.get("content") or "")),
            "reason_sha256": _text_hash(str(payload.get("reason") or "")),
        }
    return {"eventType": "completed_user_main_pair", **_source_pair(payload)}


def _entity_row(store: Any, entity_id: str) -> dict[str, Any] | None:
    row = store.conn.execute(
        "SELECT id, name, etype, canonical_id FROM entities WHERE id=?",
        (entity_id,),
    ).fetchone()
    return dict(row) if row is not None else None


def _canonical_entity_id(store: Any, entity_id: str) -> str:
    row = _entity_row(store, entity_id)
    return str(row.get("canonical_id") or row["id"]) if row else ""


def _existing_entity_for_name(
    store: Any,
    *,
    workspace_id: str,
    name: str,
    entity_type: str = "person_or_concept",
) -> dict[str, Any] | None:
    from engraphis.core.store import normalize_entity_name

    row = store.conn.execute(
        "SELECT id, name, etype, canonical_id FROM entities "
        "WHERE workspace_id=? AND repo_id IS NULL AND normalized_name=? "
        "AND etype=? ORDER BY id LIMIT 1",
        (workspace_id, normalize_entity_name(name), entity_type),
    ).fetchone()
    if row is None:
        return None
    record = dict(row)
    canonical_id = str(record.get("canonical_id") or record["id"])
    canonical = _entity_row(store, canonical_id)
    return canonical or {**record, "id": canonical_id}


def _jev_edge(edge: Any) -> dict[str, Any] | None:
    provenance = edge.provenance if isinstance(edge.provenance, dict) else {}
    value = provenance.get("jev")
    return value if isinstance(value, dict) else None


def _think_metadata(memory: Any) -> dict[str, Any] | None:
    metadata = memory.metadata if isinstance(memory.metadata, dict) else {}
    origin = metadata.get("thinkgraph_origin")
    if not isinstance(origin, dict) or origin.get("authority") != "thinkgraph":
        return None
    return deepcopy(origin)


def _public_think_metadata(value: Any) -> dict[str, Any]:
    """Return Engraphis Think metadata without a retired per-Think judgment."""
    metadata = deepcopy(value) if isinstance(value, dict) else {}
    metadata.pop("needs_evidence", None)
    return metadata


def _bounded_graph_snapshot(
    store: Any,
    *,
    workspace_id: str,
    entity_ids: list[str],
    edge_limit: int = 24,
    think_limit: int = 24,
) -> dict[str, Any]:
    """Read direct Thinks and one-hop live Jev semantics for the supplied endpoints."""
    ids: list[str] = []
    for value in entity_ids:
        canonical_id = _canonical_entity_id(store, str(value)) if value else ""
        if canonical_id and canonical_id not in ids:
            ids.append(canonical_id)
        if len(ids) >= 8:
            break
    if not ids:
        return {
            "nodes": [], "thinks": [], "incident_edges": [],
            "truncated": False, "incomplete": False,
            "limits": {
                "edge_limit": edge_limit, "think_limit": think_limit,
                "edge_source_limit_hit": False,
                "think_source_limit_hit": False,
            },
        }
    flt = SearchFilter(workspace_id=workspace_id)
    edge_source_limit = max(128, edge_limit * 4)
    raw_edges = [] if edge_limit <= 0 else list(
        store.neighbors(ids, flt=flt, limit=edge_source_limit)
    )
    eligible_edges = sorted([
        edge for edge in raw_edges if str(edge.relation) != "co_occurs"
    ], key=lambda edge: (
        str(edge.id), str(edge.src), str(edge.dst), str(edge.relation),
    ))
    edges = eligible_edges[:edge_limit]
    edge_source_limit_hit = len(raw_edges) >= edge_source_limit
    edge_result_limit_hit = len(eligible_edges) > edge_limit
    neighbor_ids = list(dict.fromkeys([
        *ids,
        *(_canonical_entity_id(store, edge.src) or edge.src for edge in edges),
        *(_canonical_entity_id(store, edge.dst) or edge.dst for edge in edges),
    ]))[:64]
    marks = ",".join("?" for _ in neighbor_ids)
    rows = store.conn.execute(
        f"SELECT id, name, etype, canonical_id FROM entities "
        f"WHERE workspace_id=? AND id IN ({marks}) ORDER BY id",
        (workspace_id, *neighbor_ids),
    ).fetchall()
    names = {str(row["id"]): str(row["name"] or "") for row in rows}
    nodes = [{
        "id": str(row["id"]), "name": str(row["name"] or ""),
        "type": str(row["etype"] or ""),
        "canonical_id": str(row["canonical_id"] or row["id"]),
        "focus": str(row["id"]) in ids,
    } for row in rows]
    thinks: list[dict[str, Any]] = []
    think_source_limit_hit = False
    think_result_limit_hit = False
    if think_limit > 0:
        focus_marks = ",".join("?" for _ in ids)
        member_rows = store.conn.execute(
            f"SELECT id, COALESCE(canonical_id,id) AS canonical_id FROM entities "
            f"WHERE workspace_id=? AND (id IN ({focus_marks}) "
            f"OR canonical_id IN ({focus_marks})) "
            "ORDER BY id LIMIT 128",
            (workspace_id, *ids, *ids),
        ).fetchall()
        canonical_by_member = {
            str(row["id"]): str(row["canonical_id"]) for row in member_rows
        }
        focus_members = [
            member for member, canonical in canonical_by_member.items()
            if canonical in ids
        ]
        think_source_limit = max(think_limit * 8, 128)
        incidences = store.list_memory_entities(
            flt, entity_ids=focus_members, limit=think_source_limit,
        )
        think_source_limit_hit = len(incidences) >= think_source_limit
        memories = store.get_memories(
            list(dict.fromkeys(str(row["memory_id"]) for row in incidences))
        )
        for row in incidences:
            memory = memories.get(str(row["memory_id"]))
            if memory is None:
                continue
            if _think_metadata(memory) is None:
                continue
            structured = (
                memory.metadata.get("structured_extraction")
                if isinstance(memory.metadata, dict) else {}
            )
            relations = (
                structured.get("relations")
                if isinstance(structured, dict) else []
            )
            thinks.append({
                "entity_id": canonical_by_member.get(
                    str(row["entity_id"]), str(row["entity_id"])
                ),
                "memory_id": memory.id,
                "title": memory.title,
                "content": memory.content,
                "summary": memory.content,
                "keywords": list(memory.keywords)[:16],
                "relations": deepcopy(relations) if isinstance(relations, list) else [],
                "valid_from": memory.valid_from,
                "valid_to": memory.valid_to,
                "valid_to_recorded_at": memory.valid_to_recorded_at,
                "ingested_at": memory.ingested_at,
                "expired_at": memory.expired_at,
            })
        thinks = sorted(thinks, key=_newest_think_key)
        think_result_limit_hit = len(thinks) > think_limit
        thinks = thinks[:think_limit]
    incident_edges = []
    for edge in edges:
        jev = _jev_edge(edge) or {}
        incident_edges.append({
            "id": edge.id,
            "source_id": _canonical_entity_id(store, edge.src) or edge.src,
            "source_name": names.get(
                _canonical_entity_id(store, edge.src) or edge.src, edge.src
            ),
            "target_id": _canonical_entity_id(store, edge.dst) or edge.dst,
            "target_name": names.get(
                _canonical_entity_id(store, edge.dst) or edge.dst, edge.dst
            ),
            "relation": edge.relation,
            "relationship_strength": jev.get("relationship_strength", edge.weight),
            "label_confidence": jev.get("label_confidence"),
            "distribution": deepcopy(jev.get("distribution") or {}),
        })
    truncated = edge_result_limit_hit or think_result_limit_hit
    incomplete = truncated or edge_source_limit_hit or think_source_limit_hit
    return {
        "nodes": nodes,
        "thinks": thinks,
        "incident_edges": incident_edges,
        "truncated": truncated,
        "incomplete": incomplete,
        "limits": {
            "edge_limit": edge_limit,
            "think_limit": think_limit,
            "edge_source_limit_hit": edge_source_limit_hit,
            "think_source_limit_hit": think_source_limit_hit,
        },
    }


def _latest_endpoint_think(
    store: Any,
    *,
    workspace_id: str,
    canonical_id: str,
) -> dict[str, Any] | None:
    """Read exactly one newest direct ThinkGraph Think for one endpoint."""
    values = _endpoint_thinks(
        store,
        workspace_id=workspace_id,
        canonical_id=canonical_id,
        limit=1,
    )
    return values[0] if values else None


def _endpoint_thinks(
    store: Any,
    *,
    workspace_id: str,
    canonical_id: str,
    limit: int,
) -> list[dict[str, Any]]:
    """Read newest Thinks through Engraphis's own memory/entity incidence."""

    if not isinstance(limit, int) or isinstance(limit, bool) or not 1 <= limit <= 24:
        raise ValueError("think_endpoint_limit_invalid")
    canonical_id = _canonical_entity_id(store, canonical_id) or canonical_id
    member_rows = store.conn.execute(
        "SELECT id FROM entities WHERE workspace_id=? "
        "AND (id=? OR canonical_id=?) ORDER BY id LIMIT 128",
        (workspace_id, canonical_id, canonical_id),
    ).fetchall()
    member_ids = [str(row["id"]) for row in member_rows]
    if not member_ids:
        return []
    marks = ",".join("?" for _ in member_ids)
    rows = store.conn.execute(
        "SELECT DISTINCT m.id FROM memory_entities me "
        "JOIN memories m ON m.id=me.memory_id "
        f"WHERE me.workspace_id=? AND me.entity_id IN ({marks}) "
        "AND me.valid_to IS NULL AND me.expired_at IS NULL "
        "AND m.valid_to IS NULL AND m.expired_at IS NULL "
        "ORDER BY COALESCE(m.ingested_at,me.ingested_at,0) DESC, m.id DESC "
        "LIMIT ?",
        (workspace_id, *member_ids, limit),
    ).fetchall()
    entity = _entity_row(store, canonical_id) or {}
    result: list[dict[str, Any]] = []
    for row in rows:
        memory = store.get_memory(str(row["id"]))
        if memory is None:
            continue
        think = _think_metadata(memory)
        if think is None:
            continue
        structured = (
            memory.metadata.get("structured_extraction")
            if isinstance(memory.metadata, dict) else {}
        )
        relations = (
            structured.get("relations")
            if isinstance(structured, dict) else []
        )
        result.append({
            "entity_id": canonical_id,
            "canonical_name": str(entity.get("name") or ""),
            "memory_id": memory.id,
            "title": memory.title,
            "content": memory.content,
            "summary": memory.content,
            "keywords": list(memory.keywords)[:16],
            "relations": deepcopy(relations) if isinstance(relations, list) else [],
            "ingested_at": memory.ingested_at,
            "valid_from": memory.valid_from,
            "valid_to": memory.valid_to,
        })
    return result


def _subject_directory_for_project(project: str) -> dict[str, Any]:
    from app.python_models.data_anchor import build_canonical_subject_directory

    return build_canonical_subject_directory(project)


def _projection_subject_directory(project: str) -> dict[str, Any] | None:
    """Attach one current cross-authority identity snapshot when both owners read."""

    from app.python_models.data_anchor import DataAnchorError

    try:
        return _subject_directory_for_project(project)
    except DataAnchorError:
        # ThinkGraph remains independently readable when KnowGraph is unavailable.
        # Joined then fails closed because it has no complete authority snapshot.
        return None


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

    center_value = payload.get("center")
    if not isinstance(center_value, dict):
        raise JevGraphError("invalid", "jev_focus_request_invalid")
    _focus_exact_keys(center_value, {"visualId", "title", "providerMembers"})
    center_visual_id = _focus_text(center_value.get("visualId"), maximum=512)
    center_title = _focus_text(center_value.get("title"), maximum=256)
    raw_members = center_value.get("providerMembers")
    if (
        not isinstance(raw_members, list)
        or not 1 <= len(raw_members) <= 16
        or any(not isinstance(member, dict) for member in raw_members)
    ):
        raise JevGraphError("invalid", "jev_focus_request_invalid")
    center_members: list[dict[str, Any]] = []
    center_member_keys: set[tuple[str, str]] = set()
    for raw_member in raw_members:
        _focus_exact_keys(
            raw_member,
            {"authority", "entityId", "title"},
            {"description"},
        )
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

    raw_candidates = payload.get("candidates")
    if (
        not isinstance(raw_candidates, list)
        or not 1 <= len(raw_candidates) <= 12
        or any(not isinstance(candidate, dict) for candidate in raw_candidates)
    ):
        raise JevGraphError("invalid", "jev_focus_request_invalid")
    candidates: list[dict[str, Any]] = []
    candidate_keys: set[tuple[str, str]] = set()
    relationship_keys: set[tuple[str, str]] = set()
    for raw_candidate in raw_candidates:
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
                "sourceTitle": _focus_text(
                    relationship.get("sourceTitle"), maximum=256,
                ),
                "targetVisualId": target_visual_id,
                "targetId": target_id,
                "targetTitle": _focus_text(
                    relationship.get("targetTitle"), maximum=256,
                ),
                "predicate": _focus_text(
                    relationship.get("predicate"), maximum=256,
                ),
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
    return source_revision, {
        "visualId": center_visual_id,
        "title": center_title,
        "providerMembers": center_members,
    }, candidates


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


def decide_graph_focus(payload: dict[str, Any]) -> dict[str, Any]:
    """Run one read-only Choice over bounded connected provider entities."""

    source_revision, center, candidates = _validated_focus_request(payload)
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

    decision_id, distribution, confidence = _validate_jev_focus_response(
        response, tuple(choice_ids),
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


def _winner_probability(decision: dict[str, Any]) -> float:
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












def project_id(value: str) -> str:
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9_-]+", value):
        raise ValueError("thinkgraph_project_id_invalid")
    return value


def get_service():
    global _service
    with _lock:
        if _service is None:
            from engraphis.service import MemoryService
            from engraphis.mcp_server import set_service
            DATABASE.parent.mkdir(parents=True, exist_ok=True)
            service = MemoryService.create(
                str(DATABASE), embed_model=MODEL, embed_revision=MODEL_REVISION,
                require_immutable_models=True, require_exact_backends=True,
                extractor="none", graph_extractor="none",
                retention_supervisor="none", allow_automatic_critical_retention=False,
            )
            set_service(service)
            _service = service
        return _service


def close_engine():
    global _service
    with _lock:
        if _service is not None:
            _service.close()
            _service = None


atexit.register(close_engine)


def _graph_revision(store: Any, workspace_id: str) -> int:
    row = store.conn.execute(
        "SELECT generation FROM graph_index_state WHERE workspace_id=?",
        (workspace_id,),
    ).fetchone()
    return int(row["generation"] if row is not None else 0)


def _strict_card_json(value: Any) -> Any:
    if isinstance(value, str):
        raw = value.strip()
        if raw.startswith("```json") and raw.endswith("```"):
            raw = raw[7:-3].strip()
        try:
            return json.loads(raw)
        except (TypeError, ValueError) as error:
            raise ThinkGraphIntakeError(
                "thinkgraph_card_output_invalid_json"
            ) from error
    return value


class _SavedCardStructuredResult:
    """LLM protocol bridge: the saved Card already performed the model call."""

    provider = "codex-app-server"

    def __init__(self, value: Any, model: str) -> None:
        self.value = value
        self.model = model

    def extract_json(self, _prompt: str, _schema: dict[str, Any]) -> Any:
        return self.value


def _engraphis_structured_extractor(llm: Any) -> Any:
    from engraphis.backends.extractor import StructuredLLMExtractor

    return StructuredLLMExtractor(llm)


def _llm_structured_contract(
    pair_text: str,
    context: dict[str, Any],
) -> tuple[dict[str, Any], str]:
    extractor = _engraphis_structured_extractor(
        _SavedCardStructuredResult({}, "schema-only")
    )
    context_text = json.dumps(context, ensure_ascii=False, sort_keys=True)
    prompt = extractor._build_prompt(pair_text, context_text)
    prompt += (
        "\nUse Engraphis structured extraction. Each returned Engraphis fact is "
        "one LiquidAIty Think. The fact's content is the Think body. Preserve each "
        "fact's title, content, memory type, importance, keywords, entities, "
        "and relationships. Extract the fewest independently reusable facts supported "
        "by the completed exchange. Preserve necessary context and uncertainty without "
        "repeating conversational setup or turning every reasoning clause into a relationship.\n"
    )
    return extractor._output_schema(), prompt


def _extract_saved_card_facts(
    value: Any,
    *,
    pair_text: str,
    context: dict[str, Any],
    card_run: dict[str, str],
) -> list[Any]:
    extractor = _engraphis_structured_extractor(
        _SavedCardStructuredResult(
            _strict_card_json(value),
            card_run.get("resolvedModel") or card_run.get("profile") or "saved-card",
        )
    )
    return extractor.extract(
        pair_text,
        context=json.dumps(context, ensure_ascii=False, sort_keys=True),
    )


def _pair_reference(payload: dict[str, Any]) -> str:
    encoded = json.dumps(
        _source_pair(payload), ensure_ascii=False, sort_keys=True,
        separators=(",", ":"),
    )
    return f"pair_{_text_hash(encoded)}"


def _existing_source_pair_thinks(
    store: Any,
    *,
    workspace_id: str,
    pair_reference: str,
) -> list[Any]:
    rows = store.conn.execute(
        "SELECT id FROM memories WHERE workspace_id=? "
        "AND valid_to IS NULL AND expired_at IS NULL "
        "ORDER BY COALESCE(ingested_at,0) DESC, id DESC",
        (workspace_id,),
    ).fetchall()
    matches: list[tuple[int, Any]] = []
    for row in rows:
        memory = store.get_memory(str(row["id"]))
        origin = _think_metadata(memory) if memory is not None else None
        if origin is not None and origin.get("completed_pair_reference") == pair_reference:
            raw_index = origin.get("fact_index")
            fact_index = raw_index if isinstance(raw_index, int) and raw_index >= 0 else 1_000_000
            matches.append((fact_index, memory))
    return [memory for _index, memory in sorted(
        matches,
        key=lambda item: (item[0], str(item[1].id)),
    )]


def _save_extracted_facts(
    service: Any,
    *,
    workspace_id: str,
    completed: dict[str, Any],
    facts: list[Any],
    card_run: dict[str, str],
    pair_reference: str,
) -> list[dict[str, Any]]:
    source_pair = _source_pair(completed)
    results: list[dict[str, Any]] = []
    for fact_index, fact in enumerate(facts):
        extracted_metadata = (
            deepcopy(fact.metadata) if isinstance(fact.metadata, dict) else {}
        )
        extraction_activity = extracted_metadata.pop("llm_extraction", None)
        metadata = {
            **extracted_metadata,
            "thinkgraph_origin": {
                "authority": "thinkgraph",
                "writer": "saved_thinkgraph_card",
                "card_id": card_run["cardId"],
                "card_revision_id": card_run["revisionId"],
                "run_id": card_run["runId"],
                "profile": card_run["profile"],
                "hermes_session_id": card_run["hermesSessionId"],
                "resolved_model": card_run["resolvedModel"],
                "completed_pair_reference": pair_reference,
                "fact_index": fact_index,
                "fact_count": len(facts),
                "source_pair": source_pair,
                **({"extraction": extraction_activity}
                   if isinstance(extraction_activity, dict) else {}),
            },
            "provenance": {
                "source": "saved_thinkgraph_card",
                "trusted": True,
                "review_state": "approved",
                "trust_origin": "saved_card_runtime",
            },
        }
        trusted_graph_keys = frozenset(
            key for key in _TRUSTED_STRUCTURED_GRAPH_KEYS
            if key in extracted_metadata
        )
        results.append(service.engine.remember_with_resolution(
            str(fact.content),
            workspace_id=workspace_id,
            mtype=fact.mtype or MemoryType.SEMANTIC,
            scope=Scope.WORKSPACE,
            title=str(fact.title or ""),
            importance=float(fact.importance),
            keywords=list(fact.keywords),
            metadata=metadata,
            resolve_conflicts=True,
            _trusted_graph_keys=trusted_graph_keys,
        ))
    return results


def _validate_completed_pair_payload(payload: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise ValueError("thinkgraph_completed_pair_payload_invalid")
    allowed = {
        "projectId", "deckId", "conversationId", "runId", "cardId",
        "hermesSessionId", "completedAt", "userMessage", "mainResponse",
        "sourceResponseFit",
    }
    if set(payload) - allowed:
        raise ValueError("thinkgraph_completed_pair_payload_invalid")
    cleaned = dict(payload)
    for key in allowed - {"sourceResponseFit"}:
        if key in cleaned and not isinstance(cleaned[key], str):
            raise ValueError("thinkgraph_completed_pair_payload_invalid")
    cleaned["projectId"] = project_id(str(cleaned.get("projectId") or ""))
    cleaned["userMessage"] = str(cleaned.get("userMessage") or "")
    cleaned["mainResponse"] = str(cleaned.get("mainResponse") or "")
    if not cleaned["userMessage"].strip() or not cleaned["mainResponse"].strip():
        raise ValueError("thinkgraph_completed_pair_text_required")
    if "sourceResponseFit" in cleaned:
        cleaned["sourceResponseFit"] = _validate_source_response_fit(
            cleaned["sourceResponseFit"], str(cleaned.get("runId") or "")
        )
    return cleaned


def prepare_completed_pair(payload: dict[str, Any]) -> dict[str, Any]:
    """Prepare one saved-Card extraction without pre-writing a second Memory."""
    payload = _validate_completed_pair_payload(payload)
    project = payload["projectId"]
    pair_text = f"USER:\n{payload['userMessage']}\n\nMAIN:\n{payload['mainResponse']}"
    service = get_service()
    with _intake_lock:
        workspace_id = service.store.get_or_create_workspace(project)
        revision_before = _graph_revision(service.store, workspace_id)
        pair_reference = _pair_reference(payload)
        existing = _existing_source_pair_thinks(
            service.store,
            workspace_id=workspace_id,
            pair_reference=pair_reference,
        )
        if existing:
            return {
                "ok": True,
                "projectId": project,
                "thinkMemoryIds": [memory.id for memory in existing],
                "pairReference": pair_reference,
                "intakeOperation": "noop",
                "structuredExtractionRequired": False,
                "revision": revision_before,
                "revisionChanged": False,
                "preparation": {
                    "status": "duplicate_noop",
                },
            }
        subject_directory = _subject_directory_for_project(project)
        enrichment_input = {
            "exact_user_message": payload["userMessage"],
            "exact_main_response": payload["mainResponse"],
            "canonical_subject_directory": subject_directory,
        }
        enrichment_schema, enrichment_prompt = _llm_structured_contract(
            pair_text,
            enrichment_input,
        )
        return {
            "ok": True,
            "projectId": project,
            "pairReference": pair_reference,
            "intakeOperation": "pending",
            "structuredExtractionRequired": True,
            "revision": revision_before,
            "revisionChanged": False,
            "preparation": {"status": "completed_without_graph_mutation"},
            "enrichmentMode": "llm_structured",
            "enrichmentSchema": enrichment_schema,
            "enrichmentPrompt": enrichment_prompt,
            "enrichmentInput": enrichment_input,
            "canonicalSubjectDirectory": subject_directory,
        }


def _validate_settle_payload(
    payload: dict[str, Any],
) -> tuple[dict[str, Any], str, Any, dict[str, str]]:
    if not isinstance(payload, dict):
        raise ValueError("thinkgraph_completed_pair_payload_invalid")
    completed_keys = {
        "projectId", "deckId", "conversationId", "runId", "cardId",
        "hermesSessionId", "completedAt", "userMessage", "mainResponse",
        "sourceResponseFit",
    }
    extras = {"pairReference", "structuredOutput", "cardRun"}
    if set(payload) - completed_keys - extras:
        raise ValueError("thinkgraph_completed_pair_payload_invalid")
    completed = _validate_completed_pair_payload({
        key: payload[key] for key in completed_keys if key in payload
    })
    pair_reference = str(payload.get("pairReference") or "")
    if pair_reference != _pair_reference(completed):
        raise ValueError("thinkgraph_pair_reference_invalid")
    structured_output = payload.get("structuredOutput")
    if not isinstance(structured_output, (str, dict, list)):
        raise ValueError("thinkgraph_card_output_invalid_json")
    raw_run = payload.get("cardRun")
    if not isinstance(raw_run, dict):
        raise ValueError("thinkgraph_card_run_invalid")
    allowed_run = {
        "runId", "cardId", "revisionId", "profile", "hermesSessionId",
        "resolvedModel",
    }
    if set(raw_run) - allowed_run:
        raise ValueError("thinkgraph_card_run_invalid")
    card_run = {key: str(raw_run.get(key) or "") for key in allowed_run}
    if any(not card_run[key] for key in allowed_run):
        raise ValueError("thinkgraph_card_run_invalid")
    return completed, pair_reference, structured_output, card_run


def settle_completed_pair(payload: dict[str, Any]) -> dict[str, Any]:
    """Store the saved Card's Engraphis facts through Engraphis itself."""
    completed, pair_reference, card_output, card_run = _validate_settle_payload(payload)
    project = completed["projectId"]
    service = get_service()
    with _intake_lock:
        store = service.store
        workspace_id = store.get_or_create_workspace(project)
        revision_before = _graph_revision(store, workspace_id)
        existing = _existing_source_pair_thinks(
            store,
            workspace_id=workspace_id,
            pair_reference=pair_reference,
        )
        if existing:
            return {
                "ok": True,
                "projectId": project,
                "pairReference": pair_reference,
                "thinkMemoryIds": [memory.id for memory in existing],
                "intakeOperation": "noop",
                "revision": revision_before,
                "revisionChanged": False,
                "status": "completed",
                "cardRun": card_run,
                "relationships": [],
                "changedNodeIds": [],
                "changedEdgeIds": [],
                "affectedNodeIds": [],
            }
        facts = _extract_saved_card_facts(
            card_output,
            pair_text=(
                f"USER:\n{completed['userMessage']}\n\n"
                f"MAIN:\n{completed['mainResponse']}"
            ),
            context={
                "exact_user_message": completed["userMessage"],
                "exact_main_response": completed["mainResponse"],
            },
            card_run=card_run,
        )
        try:
            results = _save_extracted_facts(
                service,
                workspace_id=workspace_id,
                completed=completed,
                facts=facts,
                card_run=card_run,
                pair_reference=pair_reference,
            )
        except Exception as error:
            raise ThinkGraphIntakeError("thinkgraph_fact_store_failed") from error
        memory_ids = list(dict.fromkeys(
            str(result.get("id") or "") for result in results
            if str(result.get("id") or "")
        ))
        memories = store.get_memories(memory_ids)
        if any(
            memory_id not in memories
            or _think_metadata(memories[memory_id]) is None
            for memory_id in memory_ids
        ):
            raise ThinkGraphIntakeError("thinkgraph_fact_store_failed")
        incidences = store.list_memory_entities(
            SearchFilter(workspace_id=workspace_id),
            memory_ids=memory_ids,
        ) if memory_ids else []
        changed_node_ids = list(dict.fromkeys(
            str(row.get("entity_id") or "") for row in incidences
            if str(row.get("entity_id") or "")
        ))
        edge_rows = []
        if memory_ids:
            marks = ",".join("?" for _ in memory_ids)
            edge_rows = store.conn.execute(
                "SELECT DISTINCT e.id, e.src, e.dst, e.relation "
                "FROM edge_supports s JOIN edges e ON e.id=s.edge_id "
                f"WHERE s.memory_id IN ({marks}) ORDER BY e.id",
                memory_ids,
            ).fetchall()
        relationships = [{
            "id": str(row["id"]),
            "source": str(row["src"]),
            "target": str(row["dst"]),
            "relation": str(row["relation"]),
        } for row in edge_rows]
        changed_edge_ids = [item["id"] for item in relationships]
        revision = _graph_revision(store, workspace_id)
        return {
            "ok": True,
            "projectId": project,
            "pairReference": pair_reference,
            "thinkMemoryIds": memory_ids,
            "intakeOperations": [str(result.get("op") or "") for result in results],
            "revision": revision,
            "revisionChanged": revision != revision_before,
            "status": "completed",
            "cardRun": card_run,
            "relationships": relationships,
            "changedNodeIds": changed_node_ids,
            "changedEdgeIds": changed_edge_ids,
            "affectedNodeIds": sorted(changed_node_ids),
        }


def _registered_tool_catalog():
    """Project FastMCP's static registrations without entering an event loop.

    FastMCP.list_tools() is an async wrapper around the synchronous registered
    ToolManager.  Operation metadata is also needed by synchronous authorization
    code that may already be running inside an MCP event loop, so nesting
    asyncio.run() there is invalid.  Build the same public MCP Tool models from
    the pinned FastMCP registrations instead.
    """

    from engraphis.mcp_server import classic_mcp, smart_mcp
    from mcp.types import Tool as McpTool

    def public_tools(server):
        return [McpTool(
            name=tool.name,
            title=tool.title,
            description=tool.description,
            inputSchema=tool.parameters,
            outputSchema=tool.output_schema,
            annotations=tool.annotations,
            icons=tool.icons,
            _meta=tool.meta,
        ) for tool in server._tool_manager.list_tools()]

    catalog = {tool.name: (smart_mcp, tool) for tool in public_tools(smart_mcp)}
    # The individually named interface keeps the full argument set for shared names.
    catalog.update({tool.name: (classic_mcp, tool) for tool in public_tools(classic_mcp)})
    return catalog


async def _tool_catalog():
    return _registered_tool_catalog()


def _engraphis_tools_from_registrations() -> list[dict]:
    result = []
    for _, tool in _registered_tool_catalog().values():
        item = tool.model_dump(exclude_none=True)
        schema = item["inputSchema"]
        schema.get("properties", {}).pop("workspace", None)
        if "workspace" in schema.get("required", []):
            schema["required"].remove("workspace")
        schema["additionalProperties"] = False
        if tool.name == "engraphis_recall_context":
            item["annotations"].update(readOnlyHint=True, idempotentHint=True)
        result.append(item)
    return result


async def engraphis_tools() -> list[dict]:
    return _engraphis_tools_from_registrations()


_OPERATION_DEFINITIONS: tuple[Any, ...] | None = None
_OPERATION_DEFINITIONS_LOCK = threading.Lock()


def operation_definitions() -> list[Any]:
    """Contribute Engraphis contracts without routing through MCP discovery."""

    global _OPERATION_DEFINITIONS
    if _OPERATION_DEFINITIONS is not None:
        return list(_OPERATION_DEFINITIONS)
    with _OPERATION_DEFINITIONS_LOCK:
        if _OPERATION_DEFINITIONS is not None:
            return list(_OPERATION_DEFINITIONS)
        try:
            engraphis_contracts = _engraphis_tools_from_registrations()
        except BaseException as error:
            raise RuntimeError("engraphis_operation_definitions_unavailable") from error

        from app.python_models.tool_registry import OperationDefinition

        definitions = []
        for item in engraphis_contracts:
            name = str(item.get("name") or "").strip()
            access = "read" if name in READ_TOOLS else "write" if name in WRITE_TOOLS else ""
            if not name or not access:
                raise RuntimeError(f"engraphis_operation_access_missing:{name}")

            async def dispatch(*, _name: str = name, **arguments: Any) -> Any:
                from app import mcp_host

                return await mcp_host._dispatch_tool(_name, arguments)

            definitions.append(OperationDefinition(
                canonical_id=name,
                description=str(item.get("description") or name),
                parameters_schema=deepcopy(item["inputSchema"]),
                handler=dispatch,
                available=True,
                publishers=frozenset({"internal-plugin", "external-mcp"}),
                access=access,
                namespace="engraphis",
                external_source_id="main_mcp",
                output_schema=deepcopy(item.get("outputSchema")),
                title=str(
                    item.get("title")
                    or (item.get("annotations") or {}).get("title")
                    or name
                ),
                annotations=deepcopy(item.get("annotations") or {}),
            ))
        _OPERATION_DEFINITIONS = tuple(definitions)
        return list(_OPERATION_DEFINITIONS)


async def invoke_tool(project: str, name: str, arguments: dict) -> dict:
    # FastMCP synchronous tools execute on their caller's thread. Keep
    # embedding and SQLite work off Python rails' shared HTTP event loop.
    return await asyncio.to_thread(_invoke_tool_sync, project, name, arguments)


def _invoke_tool_sync(project: str, name: str, arguments: dict) -> dict:
    with _lock:
        return asyncio.run(_invoke_tool(project, name, arguments))


async def _invoke_tool(project: str, name: str, arguments: dict) -> dict:
    catalog = await _tool_catalog()
    if name not in catalog:
        raise ValueError("thinkgraph_tool_unavailable")
    project = project_id(project)
    if "workspace" in arguments:
        raise ValueError("thinkgraph_scope_is_owned_by_project")
    server, tool = catalog[name]
    arguments = dict(arguments)
    if "workspace" in tool.inputSchema.get("properties", {}):
        arguments["workspace"] = project
    if name in {"engraphis_execute_read", "engraphis_execute_action"}:
        from engraphis.mcp_server import _resolve_capability
        capability = _resolve_capability(arguments.get("capability_id"), arguments.get("schema_digest"))
        if capability is not None and "workspace" in capability.input_schema.get("properties", {}):
            nested = dict(arguments.get("arguments") or {})
            if "workspace" in nested and nested["workspace"] != project:
                raise ValueError("thinkgraph_scope_is_owned_by_project")
            nested["workspace"] = project
            arguments["arguments"] = nested
    service = get_service()
    if name == "engraphis_recall_context":
        from engraphis.mcp_server import _apply_response_budget
        max_response_tokens = arguments.pop("max_response_tokens", None)
        result = service.recall(response_mode="compact", record_receipt=False,
                                reinforce=False, **arguments)
        if not result.get("semantic_support") or result.get("degraded_mode"):
            raise RuntimeError("thinkgraph_semantic_search_unavailable")
        by_id = {record["id"]: record for record in result.pop("memories", [])}
        result["sources"] = [{**source, **{key: by_id.get(source["id"], {}).get(key)
            for key in ("title", "provenance")}} for source in result.pop("packed_sources", [])]
        return _apply_response_budget(result, max_response_tokens)
    response = await server.call_tool(name, arguments)
    content = response.content if hasattr(response, "content") else response[0] if isinstance(response, tuple) else response
    if getattr(response, "isError", False):
        raise ValueError(" ".join(getattr(block, "text", "") for block in content))
    for block in content:
        if getattr(block, "type", None) == "text":
            if block.text.startswith("Error:"):
                raise ValueError(block.text)
            data = json.loads(block.text)
            if isinstance(data, dict):
                if data.get("ok") is False or data.get("error"):
                    raise ValueError(json.dumps(data))
                return data
    raise RuntimeError("thinkgraph_result_invalid")


def inspect(project: str, id_field: str, identifier: str) -> dict:
    service = get_service()
    project = project_id(project)
    if id_field == "engraphisEntityId":
        entity = service.graph_entity(
            identifier,
            workspace=project,
            include_weak_cooccurrence=False,
        )
        evidence_by_id: dict[str, dict[str, Any]] = {}
        member_ids = [str(value) for value in entity.get("member_ids") or []]
        if member_ids:
            workspace_row = service.store.conn.execute(
                "SELECT id FROM workspaces WHERE name=?", (project,)
            ).fetchone()
            workspace_id = str(workspace_row["id"]) if workspace_row is not None else ""
            incidences = service.store.list_memory_entities(
                SearchFilter(workspace_id=workspace_id),
                entity_ids=member_ids,
                limit=512,
            )
            direct = list(incidences)
            memory_ids = list(dict.fromkeys(
                str(row["memory_id"]) for row in direct
            ))
            memories = service.store.get_memories(memory_ids)
            for row in direct:
                memory_id = str(row["memory_id"])
                memory = memories.get(memory_id)
                if memory is None or _think_metadata(memory) is None:
                    continue
                evidence_by_id[memory_id] = {
                    "memory_id": memory.id,
                    "title": memory.title,
                    "excerpt": memory.content[:500],
                    "memory_type": (
                        memory.mtype.value
                        if isinstance(memory.mtype, Enum) else str(memory.mtype)
                    ),
                    "source_kind": str(row.get("source_kind") or ""),
                    "confidence": float(row.get("confidence") or 0.0),
                    "valid_from": memory.valid_from,
                    "valid_to": memory.valid_to,
                    "valid_to_recorded_at": memory.valid_to_recorded_at,
                    "ingested_at": memory.ingested_at,
                    "expired_at": memory.expired_at,
                    "provenance": deepcopy(memory.provenance),
                    "metadata": _public_think_metadata(memory.metadata),
                }
        entity["evidence"] = sorted(evidence_by_id.values(), key=_newest_think_key)
        return {"entity": entity}
    if id_field != "engraphisMemoryId":
        raise ValueError("engraphis_reference_type_invalid")
    result = service.inspect(identifier, workspace=project)
    result["memory"]["metadata"] = _public_think_metadata(
        service.store.get_memory(identifier).metadata
    )
    # Preserve directional composite identities from the Engraphis link store.
    # The public inspector has already authorized the neighboring records.
    neighbors = {link["id"] for link in result["links"]}
    result["relationships"] = [link for link in service.store.get_links(identifier)
        if (link["b"] if link["a"] == identifier else link["a"]) in neighbors]
    return result


def private_operation(project: str, operation: str, arguments: dict) -> dict:
    """Application operations outside model tool grants."""
    project = project_id(project)
    if operation == "retire":
        if set(arguments) != {"memoryId"}:
            raise ValueError("engraphis_memory_reference_invalid")
        memory_id = str(arguments.get("memoryId") or "")
        with _lock:
            return get_service().retire(memory_id, workspace=project,
                reason="Removed in ThinkGraph", actor="user")
    if operation == "delete_workspace":
        if arguments != {"confirmed": True}:
            raise ValueError("thinkgraph_workspace_delete_requires_confirmation")
        with _lock:
            return get_service().delete_workspace(project)
    if operation == "inspect":
        if set(arguments) == {"entityId"}:
            return inspect(
                project, "engraphisEntityId", str(arguments.get("entityId") or ""),
            )
        if set(arguments) == {"memoryId"}:
            return inspect(
                project, "engraphisMemoryId", str(arguments.get("memoryId") or ""),
            )
        raise ValueError("engraphis_reference_invalid")
    raise ValueError("thinkgraph_operation_unavailable")


def _bounded_entity_projection(
    service: Any,
    *,
    project: str,
    entity_id: str,
) -> dict[str, Any]:
    """Project one exact entity plus at most 24 direct Engraphis relationships."""

    store = service.store
    workspace = store.conn.execute(
        "SELECT id FROM workspaces WHERE name=?", (project,),
    ).fetchone()
    workspace_id = str(workspace["id"]) if workspace is not None else ""
    snapshot = _bounded_graph_snapshot(
        store,
        workspace_id=workspace_id,
        entity_ids=[entity_id],
        edge_limit=24,
        think_limit=0,
    ) if workspace_id else {
        "nodes": [], "incident_edges": [], "truncated": False,
        "incomplete": False,
        "limits": {
            "edge_limit": 24, "think_limit": 0,
            "edge_source_limit_hit": False,
            "think_source_limit_hit": False,
        },
    }
    ordered_entities = sorted(
        snapshot["nodes"],
        key=lambda node: (not bool(node.get("focus")), str(node.get("id") or "")),
    )
    latest_thinks: list[dict[str, Any]] = []
    for node in ordered_entities:
        latest_thinks.extend(_endpoint_thinks(
            store,
            workspace_id=workspace_id,
            canonical_id=str(node["id"]),
            limit=2,
        ))
    think_limit_hit = len(latest_thinks) > 24
    latest_thinks = latest_thinks[:24]
    think_by_entity: dict[str, list[dict[str, Any]]] = {}
    for think in latest_thinks:
        think_by_entity.setdefault(str(think["entity_id"]), []).append(think)

    nodes: list[dict[str, Any]] = []
    for engraphis_entity in ordered_entities:
        entity_id = str(engraphis_entity["id"])
        title = str(engraphis_entity.get("name") or entity_id)
        thinks = think_by_entity.get(entity_id, [])
        evidence = []
        for think in thinks:
            evidence.append({
                "id": think["memory_id"],
                "title": think["title"],
                "summary": think["content"],
                "content": think["content"],
                "metadata": {
                    "relations": deepcopy(think["relations"]),
                },
                "validFrom": think.get("valid_from"),
                "validTo": think.get("valid_to"),
                "ingestedAt": think.get("ingested_at"),
            })
        nodes.append({
            "id": entity_id,
            "canonicalId": str(engraphis_entity.get("canonical_id") or entity_id),
            "canonicalName": title,
            "entityKind": str(engraphis_entity.get("type") or "Concept"),
            "label": title,
            "title": title,
            "type": str(engraphis_entity.get("type") or "Concept"),
            "authority": "engraphis",
            "projectId": project,
            "member_ids": [entity_id],
            "focus": bool(engraphis_entity.get("focus")),
            "mentionCount": len(evidence),
            "properties": {
                "nodeType": str(engraphis_entity.get("type") or "Concept"),
                "focus": bool(engraphis_entity.get("focus")),
                "evidence": evidence,
            },
        })

    edges: list[dict[str, Any]] = []
    for engraphis_relationship in snapshot["incident_edges"]:
        strength_value = engraphis_relationship.get("relationship_strength")
        try:
            strength = float(strength_value)
        except (TypeError, ValueError, OverflowError):
            strength = None
        if strength is not None and not math.isfinite(strength):
            strength = None
        relation = str(engraphis_relationship.get("relation") or "")
        label = relation
        if strength is not None:
            label = f"{relation} · {strength:.2f}".replace(" 0.", " .")
        jev = {
            "distribution": deepcopy(engraphis_relationship.get("distribution") or {}),
            "label_confidence": engraphis_relationship.get("label_confidence"),
            "relationship_strength": strength,
        }
        edge = {
            "id": str(engraphis_relationship["id"]),
            "source": str(engraphis_relationship["source_id"]),
            "target": str(engraphis_relationship["target_id"]),
            "predicate": relation,
            "relation": relation,
            "label": label,
            "directed": True,
            "properties": {
                "directed": True,
                "relationship_strength": strength,
                "label_confidence": engraphis_relationship.get("label_confidence"),
                "jev": jev,
            },
        }
        if strength is not None:
            edge.update({
                "relationship_strength": strength,
                "label_confidence": engraphis_relationship.get("label_confidence"),
                "strength": strength,
                "spring_strength": 0.035 + (0.17 * strength),
                "rest_length": max(14.0, min(34.0, 26.0 - (12.0 * strength))),
            })
        edges.append(edge)

    incomplete = bool(snapshot.get("incomplete")) or think_limit_hit
    truncated = bool(snapshot.get("truncated")) or think_limit_hit
    bounds = {
        "scope": "direct-engraphis-neighborhood",
        "neighborLimit": 24,
        "edgeLimit": 24,
        "thinkLimit": 24,
        "edgeSourceLimitHit": bool(
            snapshot.get("limits", {}).get("edge_source_limit_hit")
        ),
        "thinkLimitHit": think_limit_hit,
    }
    revision = hashlib.sha256(
        json.dumps([nodes, edges, bounds], sort_keys=True).encode("utf-8")
    ).hexdigest()
    scene = {
        "nodes": deepcopy(nodes),
        "edges": deepcopy(edges),
        "links": deepcopy(edges),
        "meta": {
            "truncated": truncated,
            "incomplete": incomplete,
            "bounds": bounds,
        },
    }
    return {
        "schemaVersion": "thinkgraph.engraphis.v1",
        "authority": "engraphis",
        "projectId": project,
        "revision": revision,
        "nodes": nodes,
        "edges": edges,
        "scene": scene,
        "counts": {"nodes": len(nodes), "edges": len(edges)},
        "truncated": truncated,
        "incomplete": incomplete,
        "bounds": bounds,
        "embedding": {
            "state": "ready"
            if service.stats(workspace=project).get("embedding", {}).get("ready")
            else "unavailable"
        },
        "runtime": {"engine": "engraphis", "version": "1.7.4"},
    }


def projection(project: str, entity_id: str | None = None) -> dict:
    service = get_service()
    project = project_id(project)
    if entity_id:
        return _bounded_entity_projection(
            service,
            project=project,
            entity_id=str(entity_id),
        )
    # Engraphis supplies the scene. This adapter only adds display field aliases
    # and resolves evidence IDs returned by the engine.
    scene = service.graph_scene(workspace=project, level="complete", presentation="quality",
        include_memory_nodes=False, include_weak_cooccurrence=False)
    scene_member_ids = list(dict.fromkeys(
        member
        for node in scene["nodes"]
        for member in node.get("member_ids", [node["id"]])
    ))
    engraphis_edges = {
        edge.id: edge for edge in service.store.neighbors(scene_member_ids)
    } if scene_member_ids else {}
    semantic_mass = {node["id"]: 0.0 for node in scene["nodes"]}
    for edge in scene["edges"]:
        edge_ids = edge.get("underlying_edge_ids") or [edge.get("id")]
        jev_edges = [
            engraphis_edges[edge_id]
            for edge_id in edge_ids
            if edge_id in engraphis_edges
            and isinstance(engraphis_edges[edge_id].provenance, dict)
            and isinstance(engraphis_edges[edge_id].provenance.get("jev"), dict)
        ]
        if not jev_edges:
            continue
        chosen = max(
            jev_edges,
            key=lambda item: _winner_probability(item.provenance["jev"]),
        )
        jev = deepcopy(chosen.provenance["jev"])
        strength = _winner_probability(jev)
        jev["label_confidence"] = strength
        jev["relationship_strength"] = strength
        probability_text = f"{strength:.2f}".removeprefix("0")
        edge.update({
            "relation": chosen.relation,
            "label": f"{chosen.relation} · {probability_text}",
            # The renderer normally hides relation labels until a deep
            # zoom. ThinkGraph semantic edges are product content, so these
            # presentation hints keep the existing renderer contract while
            # making the Jev label and direction readable at the fitted view.
            "label_min_scale": 0.35,
            "directional_arrow_length": 3.0,
            "directional_arrow_rel_pos": 0.9,
            "relationship_strength": strength,
            "label_confidence": float(jev["label_confidence"]),
            "strength": strength,
            "spring_strength": 0.035 + (0.17 * strength),
            "rest_length": max(14.0, min(34.0, 26.0 - (12.0 * strength))),
            "jev": jev,
        })
        if edge.get("source") in semantic_mass:
            semantic_mass[edge["source"]] += strength
        if edge.get("target") in semantic_mass:
            semantic_mass[edge["target"]] += strength
    for node in scene["nodes"]:
        mass = semantic_mass[node["id"]]
        node["semantic_mass"] = mass
        if mass > 0:
            # Local diminishing scale: an unrelated node entering the graph must not
            # resize every mature constellation through a graph-global denominator.
            node["gravity_mass"] = 1.0 + (4.0 * math.log1p(mass))
            node["visual_radius"] = 2.5 + (3.0 * math.log1p(mass))
    supporting = {}
    # Hydrate Engraphis's stored memory/entity incidences without inventing links.
    entity_members = {node["id"]: node.get("member_ids", [node["id"]]) for node in scene["nodes"]}
    incidences = service.store.list_memory_entities(entity_ids=list(dict.fromkeys(
        member for members in entity_members.values() for member in members)))
    direct_incidence_ids = list(dict.fromkeys(
        str(row["memory_id"]) for row in incidences
    ))
    direct_memories = service.store.get_memories(direct_incidence_ids)
    valid_think_ids = {
        memory_id for memory_id, memory in direct_memories.items()
        if _think_metadata(memory) is not None
    }
    entity_thinks = {node_id: list(dict.fromkeys(
        row["memory_id"] for row in incidences
        if row["entity_id"] in members
        and row["memory_id"] in valid_think_ids))
        for node_id, members in entity_members.items()}
    evidence_groups = [edge.get("support_memory_ids", []) for edge in scene["edges"]]
    evidence_groups.extend(entity_thinks.values())
    for memory_ids in evidence_groups:
        for mid in memory_ids:
            if mid not in supporting:
                memory = inspect(project, "engraphisMemoryId", mid)["memory"]
                supporting[mid] = {"id": mid, "title": memory["title"],
                    "summary": memory.get("summary") or memory["content"],
                    "provenance": memory.get("provenance", {}),
                    "metadata": memory.get("metadata", {}),
                    "validFrom": memory.get("valid_from"),
                    "validTo": memory.get("valid_to"),
                    "validToRecordedAt": memory.get("valid_to_recorded_at"),
                    "ingestedAt": memory.get("ingested_at"),
                    "expiredAt": memory.get("expired_at")}
                if entity_id:
                    # Full text belongs to selection, not the initial graph download.
                    supporting[mid]["content"] = memory["content"]
    nodes = []
    for node in scene["nodes"]:
        # Node Think display follows Engraphis's own evidence incidence.
        evidence_ids = list(dict.fromkeys(entity_thinks[node["id"]]))
        evidence_ids.sort(
            key=lambda memory_id: _newest_think_key(supporting[memory_id])
            if memory_id in supporting else (0.0, memory_id)
        )
        nodes.append({
            **node,
            "canonicalId": node["id"],
            "canonicalName": node["label"],
            "entityKind": node["type"],
            "title": node["label"],
            "type": node["type"],
            "authority": "engraphis",
            "projectId": project,
            "mentionCount": node.get("support_count", 0),
            "properties": {
                **node.get("properties", {}),
                "x": node["x"],
                "y": node["y"],
                "nodeType": node["type"],
                "communityId": node.get("community_id"),
                "semantic_mass": node.get("semantic_mass", 0.0),
                "gravity_mass": node.get("gravity_mass"),
                "visual_radius": node.get("visual_radius"),
                "evidence": [
                    supporting[memory_id]
                    for memory_id in evidence_ids
                    if memory_id in supporting
                ],
            },
        })
    edges = [{
        **e,
        "predicate": e["relation"], "mentionCount": e.get("support_count", 0),
        "properties": {**e.get("properties", {}), "layer": e.get("layer"), "strength": e.get("strength"),
            "relationship_strength": e.get("relationship_strength"),
            "label_confidence": e.get("label_confidence"),
            "jev": e.get("jev"),
            "directed": e.get("directed", True),
            "evidence": [supporting[mid] for mid in e.get("support_memory_ids", []) if mid in supporting]},
    } for e in scene["edges"]]
    revision = hashlib.sha256(json.dumps([nodes, edges], sort_keys=True).encode()).hexdigest()
    return {"schemaVersion": "thinkgraph.engraphis.v1", "authority": "engraphis", "projectId": project,
            "revision": revision, "nodes": nodes, "edges": edges, "scene": scene,
            "counts": {"nodes": len(nodes), "edges": len(edges)},
            "truncated": scene["meta"]["truncated"],
            "canonicalSubjectDirectory": _projection_subject_directory(project),
            "embedding": {"state": "ready" if service.stats(workspace=project).get("embedding", {}).get("ready") else "unavailable"},
            "runtime": {"engine": "engraphis", "version": "1.7.4"}}
