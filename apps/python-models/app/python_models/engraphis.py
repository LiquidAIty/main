"""ThinkGraph through Engraphis's public Python service and native MCP tools.

Python rails owns the service. Workspace binding comes from the authenticated
project; neither tool callers nor the browser choose another database or tenant.
"""
from __future__ import annotations

import atexit
import asyncio
from concurrent.futures import ThreadPoolExecutor, as_completed
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
from typing import Any, Callable, Literal

import httpx
from pydantic import BaseModel, ConfigDict, Field, model_validator

from engraphis.core.interfaces import Edge, Node, SearchFilter

DATABASE = Path(__file__).resolve().parents[4] / "db" / "thinkgraph.sqlite"
MODEL = "local:sentence-transformers/all-MiniLM-L6-v2"
MODEL_REVISION = "1110a243fdf4706b3f48f1d95db1a4f5529b4d41"
READ_TOOLS = frozenset(['engraphis_code_impact', 'engraphis_code_path', 'engraphis_conflict_review', 'engraphis_context_savings', 'engraphis_discover_actions', 'engraphis_execute_read', 'engraphis_export_code_graph', 'engraphis_export_receipts', 'engraphis_get_memory', 'engraphis_recall_context', 'engraphis_recall_proactive', 'engraphis_receipts', 'engraphis_search_code', 'engraphis_stats', 'engraphis_timeline', 'engraphis_verify_receipts', 'engraphis_why'])
WRITE_TOOLS = frozenset(['engraphis_answer', 'engraphis_check_update', 'engraphis_consolidate', 'engraphis_correct', 'engraphis_end_session', 'engraphis_execute_action', 'engraphis_forget', 'engraphis_index_repo', 'engraphis_ingest', 'engraphis_ingest_postgres_schema', 'engraphis_link', 'engraphis_link_symbol', 'engraphis_pin', 'engraphis_proactive_context', 'engraphis_promote', 'engraphis_recall', 'engraphis_recall_grounded', 'engraphis_record_event', 'engraphis_remember', 'engraphis_remember_many', 'engraphis_retire', 'engraphis_secure_erase', 'engraphis_session', 'engraphis_start_session', 'engraphis_update_memory'])
_service = None
_lock = threading.RLock()
_intake_lock = threading.RLock()
_intake_local = threading.local()

JEV_MODEL = "typesafe/jev-1.13"
JEV_ENDPOINT = "https://openrouter.ai/api/alpha/decisions"
MAX_JEV_CONCURRENCY = 4
SEMANTIC_ADMISSION_MINIMUM = 0.60
THINKGRAPH_RELATIONSHIPS = (
    "ASSUMES", "QUESTIONS", "PREDICTS", "IMPLIES", "REFINES",
    "CONTRADICTS", "DEPENDS_ON", "ALTERNATIVE_TO", "CORRECTS",
    "EXPLAINS", "MOTIVATES", "GENERALIZES", "SPECIALIZES", "NONE",
    "OTHER_RELATION", "INSUFFICIENT_CONTEXT", "INVALID_NODE_PAIR",
)
THINKGRAPH_RELATIONSHIP_SCHEMA_VERSION = "thinkgraph.relationships.v2"
THINKGRAPH_RELATIONSHIP_SCHEMA_HASH = hashlib.sha256(
    json.dumps(THINKGRAPH_RELATIONSHIPS, separators=(",", ":")).encode("utf-8")
).hexdigest()

_RELATIONSHIP_CRITERIA = {
    "ASSUMES": "A takes B as true or necessary without establishing it.",
    "QUESTIONS": "A asks about, doubts, or opens an unresolved issue concerning B.",
    "PREDICTS": "A forecasts that B will occur or become true.",
    "IMPLIES": "A provides a logical or practical basis from which B follows.",
    "REFINES": "A makes B more precise, detailed, bounded, or implementable.",
    "CONTRADICTS": "A and B make materially incompatible claims or requirements.",
    "DEPENDS_ON": "A requires B as a prerequisite, input, or enabling condition.",
    "ALTERNATIVE_TO": "A is a distinct substitute or competing option for B.",
    "CORRECTS": "A explicitly repairs an error or outdated statement in B.",
    "EXPLAINS": "A gives the reason, mechanism, or interpretation for B.",
    "MOTIVATES": "A supplies the goal, need, or rationale that prompts B.",
    "GENERALIZES": "A states a broader rule or category that includes B.",
    "SPECIALIZES": "A is a narrower instance, case, or application of B.",
    "NONE": "A and B are both present but no useful semantic relationship is supported.",
    "OTHER_RELATION": "A and B have a useful semantic relationship not represented by another option.",
    "INSUFFICIENT_CONTEXT": "The supplied completed pair does not support deciding how A relates to B.",
    "INVALID_NODE_PAIR": (
        "In the meaning of the completed pair, at least one proposed endpoint does not denote "
        "a durable reusable ThinkGraph concept; it is instead discourse/request framing, "
        "sentence residue, generic filler, or another non-conceptual span."
    ),
}


class JevRelationshipError(RuntimeError):
    """A real Jev decision could not be obtained or validated."""


class ThinkGraphIntakeError(RuntimeError):
    """The completed-pair intake could not start or persist its source memory."""


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _text_hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _native_time(value: Any) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError, OverflowError):
        return 0.0
    return parsed if math.isfinite(parsed) else 0.0


def _newest_note_key(item: dict[str, Any]) -> tuple[float, str]:
    return (
        -_native_time(item.get("ingested_at", item.get("ingestedAt"))),
        str(item.get("memory_id") or item.get("id") or ""),
    )


def _source_pair(payload: dict[str, Any]) -> dict[str, Any]:
    return {
        key: payload[key]
        for key in (
            "projectId", "deckId", "conversationId", "runId", "cardId",
            "nativeSessionRef", "completedAt",
        )
        if payload.get(key)
    } | {
        "user_sha256": _text_hash(payload["userMessage"]),
        "main_sha256": _text_hash(payload["mainResponse"]),
    }


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


def _note_metadata(memory: Any) -> dict[str, Any] | None:
    metadata = memory.metadata if isinstance(memory.metadata, dict) else {}
    value = metadata.get("thinkgraph_note")
    return value if isinstance(value, dict) else None


def _bounded_graph_snapshot(
    store: Any,
    *,
    workspace_id: str,
    entity_ids: list[str],
    edge_limit: int = 24,
    note_limit: int = 24,
) -> dict[str, Any]:
    """Read direct Notes and one-hop live Jev semantics for the supplied endpoints."""
    ids: list[str] = []
    for value in entity_ids:
        canonical_id = _canonical_entity_id(store, str(value)) if value else ""
        if canonical_id and canonical_id not in ids:
            ids.append(canonical_id)
        if len(ids) >= 8:
            break
    if not ids:
        return {"nodes": [], "notes": [], "incident_edges": []}
    flt = SearchFilter(workspace_id=workspace_id)
    edges = [] if edge_limit <= 0 else [
        edge for edge in store.neighbors(ids, flt=flt, limit=max(128, edge_limit * 4))
        if _jev_edge(edge) is not None
    ][:edge_limit]
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
    notes: list[dict[str, Any]] = []
    if note_limit > 0:
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
        incidences = store.list_memory_entities(
            flt, entity_ids=focus_members, limit=max(note_limit * 8, 128),
        )
        memories = store.get_memories(
            list(dict.fromkeys(str(row["memory_id"]) for row in incidences))
        )
        for row in incidences:
            memory = memories.get(str(row["memory_id"]))
            if memory is None:
                continue
            note_meta = _note_metadata(memory)
            if note_meta is None:
                continue
            notes.append({
                "entity_id": canonical_by_member.get(
                    str(row["entity_id"]), str(row["entity_id"])
                ),
                "memory_id": memory.id,
                "title": memory.title,
                "content": memory.content[:1_200],
                "keywords": list(memory.keywords)[:16],
                "kind": note_meta.get("kind"),
                "properties": list(note_meta.get("properties") or [])[:16],
                "concepts": list(note_meta.get("concepts") or [])[:16],
                "propositions": list(note_meta.get("propositions") or [])[:16],
                "relationship_observations": list(
                    note_meta.get("relationship_observations") or []
                )[:16],
                "valid_from": memory.valid_from,
                "valid_to": memory.valid_to,
                "valid_to_recorded_at": memory.valid_to_recorded_at,
                "ingested_at": memory.ingested_at,
                "expired_at": memory.expired_at,
            })
        notes = sorted(notes, key=_newest_note_key)[:note_limit]
    incident_edges = []
    for edge in edges:
        jev = _jev_edge(edge)
        if jev is None:
            continue
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
    return {"nodes": nodes, "notes": notes, "incident_edges": incident_edges}


def _bounded_relationship_context(
    store: Any,
    *,
    workspace_id: str,
    source_id: str = "",
    target_id: str = "",
    source_name: str = "",
    target_name: str = "",
    prior_thought_snapshot: dict[str, dict[str, Any] | None] | None = None,
) -> dict[str, Any]:
    snapshot = _bounded_graph_snapshot(
        store, workspace_id=workspace_id,
        entity_ids=[source_id, target_id], edge_limit=24, note_limit=0,
    )
    snapshot.pop("notes", None)
    latest_prior_thoughts: list[dict[str, Any]] = []
    for endpoint, native_id in (("A", source_id), ("B", target_id)):
        if not native_id:
            thought = None
        elif prior_thought_snapshot is None:
            thought = _latest_endpoint_thought(
                store,
                workspace_id=workspace_id,
                canonical_id=native_id,
            )
        else:
            # A supplied turn-start snapshot is authoritative for this turn.
            # A missing/null entry deliberately means no prior Thought; never
            # refill it with a live lookup after the current Thought may exist.
            thought = deepcopy(prior_thought_snapshot.get(native_id))
        if thought is not None:
            latest_prior_thoughts.append({"endpoint": endpoint, **thought})
    snapshot["latest_prior_thoughts"] = latest_prior_thoughts
    snapshot["source"] = {
        "native_id": source_id or None,
        "name": source_name,
    }
    snapshot["target"] = {
        "native_id": target_id or None,
        "name": target_name,
    }
    snapshot["prior_pair_edges"] = [
        edge for edge in snapshot["incident_edges"]
        if source_id and target_id
        and edge["source_id"] == source_id and edge["target_id"] == target_id
    ][:4]
    return snapshot


def _latest_endpoint_thought(
    store: Any,
    *,
    workspace_id: str,
    canonical_id: str,
) -> dict[str, Any] | None:
    """Read exactly one newest direct ThinkGraph Thought for one endpoint."""
    canonical_id = _canonical_entity_id(store, canonical_id) or canonical_id
    member_rows = store.conn.execute(
        "SELECT id FROM entities WHERE workspace_id=? "
        "AND (id=? OR canonical_id=?) ORDER BY id LIMIT 128",
        (workspace_id, canonical_id, canonical_id),
    ).fetchall()
    member_ids = [str(row["id"]) for row in member_rows]
    if not member_ids:
        return None
    marks = ",".join("?" for _ in member_ids)
    row = store.conn.execute(
        "SELECT m.id FROM memory_entities me "
        "JOIN memories m ON m.id=me.memory_id "
        f"WHERE me.workspace_id=? AND me.entity_id IN ({marks}) "
        "AND me.source_kind='thinkgraph_note' "
        "AND me.valid_to IS NULL AND me.expired_at IS NULL "
        "AND m.valid_to IS NULL AND m.expired_at IS NULL "
        "ORDER BY COALESCE(m.ingested_at,me.ingested_at,0) DESC, m.id DESC "
        "LIMIT 1",
        (workspace_id, *member_ids),
    ).fetchone()
    if row is None:
        return None
    memory = store.get_memory(str(row["id"]))
    if memory is None:
        return None
    note = _note_metadata(memory)
    if note is None:
        return None
    entity = _entity_row(store, canonical_id) or {}
    return {
        "native_id": canonical_id,
        "canonical_name": str(entity.get("name") or ""),
        "memory_id": memory.id,
        "kind": note.get("kind"),
        "content": memory.content[:1_200],
        "keywords": list(memory.keywords)[:16],
        "properties": list(note.get("properties") or [])[:16],
        "concepts": list(note.get("concepts") or [])[:16],
        "propositions": list(note.get("propositions") or [])[:16],
        "relationship_observations": list(
            note.get("relationship_observations") or []
        )[:16],
        "ingested_at": memory.ingested_at,
        "valid_from": memory.valid_from,
        "valid_to": memory.valid_to,
    }


def _bounded_structured_graph_shape(
    store: Any,
    *,
    workspace_id: str,
    entity_ids: list[str],
) -> dict[str, Any]:
    """Expose bounded topology to the structured writer without Thought bodies."""
    snapshot = _bounded_graph_snapshot(
        store,
        workspace_id=workspace_id,
        entity_ids=entity_ids,
        edge_limit=24,
        note_limit=0,
    )
    return {
        "scope": "active_endpoints_plus_direct_live_jev_neighbors",
        "nodes": [{
            "nativeId": node["id"],
            "canonicalName": node["name"],
            "nodeType": node["type"],
            "activeEndpoint": node["focus"],
        } for node in snapshot["nodes"]],
        "edges": [{
            "source": {
                "nativeId": edge["source_id"],
                "canonicalName": edge["source_name"],
            },
            "target": {
                "nativeId": edge["target_id"],
                "canonicalName": edge["target_name"],
            },
            "canonicalRelationship": edge["relation"],
            "relationshipStrength": edge["relationship_strength"],
        } for edge in snapshot["incident_edges"]],
    }


def _turn_start_prior_thought_snapshot(
    store: Any,
    *,
    workspace_id: str,
    opportunities: list[dict[str, Any]],
) -> dict[str, dict[str, Any] | None]:
    """Freeze bounded prior Thoughts before this turn can append a Thought."""
    focus_ids: list[str] = []
    for opportunity in opportunities:
        for endpoint in (opportunity["source"], opportunity["target"]):
            existing = _existing_entity_for_name(
                store,
                workspace_id=workspace_id,
                name=endpoint["name"],
                entity_type=endpoint["type"],
            )
            if existing is not None:
                focus_ids.append(str(existing["id"]))
    focus_ids = list(dict.fromkeys(focus_ids))
    if not focus_ids:
        return {}
    shape = _bounded_structured_graph_shape(
        store,
        workspace_id=workspace_id,
        entity_ids=focus_ids,
    )
    bounded_ids = list(dict.fromkeys([
        *focus_ids,
        *(str(node["nativeId"]) for node in shape["nodes"]),
    ]))
    return {
        native_id: _latest_endpoint_thought(
            store,
            workspace_id=workspace_id,
            canonical_id=native_id,
        )
        for native_id in bounded_ids
    }


def _bounded_jev_text(text: str, source: str, target: str) -> str:
    """Use Engraphis's chunker only when a pair exceeds Jev's safe state budget."""
    from engraphis.backends.extractor import ChunkingExtractor
    from engraphis.core.context import RegexTokenCounter

    counter = RegexTokenCounter()
    if counter(text) <= 26_000:
        return text
    chunker = ChunkingExtractor(
        target_tokens=4_800,
        overlap_tokens=64,
        max_chunks=12,
        token_counter=counter,
        token_counter_identity=counter.identity,
    )
    chunks = chunker.extract(text)
    names = (source.casefold(), target.casefold())
    selected = [
        fact.content for fact in chunks
        if any(name and name in fact.content.casefold() for name in names)
    ]
    if not selected:
        selected = [fact.content for fact in chunks[:5]]
    return "\n\n[ENGRAPHIS CHUNK]\n\n".join(selected[:5])


def _validate_jev_response(response: dict[str, Any]) -> dict[str, Any]:
    try:
        answer = response["answers"]["relationship"]
        if answer.get("type") != "choice":
            raise ValueError("answer type")
        winner = str(answer["choice"])
        if winner not in THINKGRAPH_RELATIONSHIPS:
            raise ValueError("winner")
        raw = answer["probabilities"]
        if not isinstance(raw, dict) or set(raw) != set(THINKGRAPH_RELATIONSHIPS):
            raise ValueError("probability keys")
        probabilities = {name: float(raw[name]) for name in THINKGRAPH_RELATIONSHIPS}
        if any(not math.isfinite(value) or value < 0 or value > 1
               for value in probabilities.values()):
            raise ValueError("probability values")
        total = sum(probabilities.values())
        if total <= 0:
            raise ValueError("probability total")
        probabilities = {name: value / total for name, value in probabilities.items()}
    except (KeyError, TypeError, ValueError, OverflowError) as error:
        raise JevRelationshipError("jev_relationship_response_invalid") from error
    strength = max(0.0, min(1.0,
        1.0
        - probabilities["NONE"]
        - probabilities["INSUFFICIENT_CONTEXT"]
        - probabilities["INVALID_NODE_PAIR"]
    ))
    return {
        "winner": winner,
        "distribution": probabilities,
        "label_confidence": probabilities[winner],
        "relationship_strength": strength,
        "provider": str(response.get("provider") or ""),
        "requested_model": JEV_MODEL,
        "resolved_model": str(response.get("model") or ""),
        "usage": response.get("usage") if isinstance(response.get("usage"), dict) else {},
    }


def classify_relationship(
    source: str,
    target: str,
    payload: dict[str, Any],
    proposition: str = "",
    graph_context: dict[str, Any] | None = None,
    relationship_proposal: str = "",
) -> dict[str, Any]:
    """Ask real Jev one bounded Choice question and strictly validate its answer."""
    api_key = os.environ.get("OPENROUTER_API_KEY", "").strip()
    if not api_key:
        raise JevRelationshipError("jev_openrouter_key_unavailable")
    if payload.get("eventType") == "explicit_memory":
        event_text = (
            f"TITLE:\n{payload.get('title', '')}\n\n"
            f"CONTENT:\n{payload.get('content', '')}\n\n"
            f"REASON OR INSTRUCTION:\n{payload.get('reason', '')}"
        )
        event_kind = "explicit ThinkGraph memory write"
    else:
        event_text = (
            f"USER:\n{payload['userMessage']}\n\n"
            f"MAIN:\n{payload['mainResponse']}"
        )
        event_kind = "completed observable User/Main pair"
    event_text = _bounded_jev_text(event_text, source, target)
    state: dict[str, Any] = {
        "description": (
            f"One {event_kind}, one directed ThinkGraph entity pair, and a bounded "
            "one-hop topology snapshot from the existing graph, plus at most the newest "
            "prior Thought directly attached to each existing endpoint. Jointly judge "
            "whether both endpoints are durable concepts and, only then, how A relates to B."
        ),
        "source_node_a": source,
        "target_node_b": target,
        "direction": "A -> B",
        "current_event": event_text,
        "bounded_local_graph": graph_context or {
            "nodes": [], "latest_prior_thoughts": [], "incident_edges": [],
        },
    }
    if relationship_proposal:
        state["thinkgraph_card_freeform_relationship_proposal"] = relationship_proposal
    if proposition:
        state["supporting_structured_fact"] = proposition
    body = {
        "model": JEV_MODEL,
        "state": state,
        "questions": {
            "relationship": {
                "type": "choice",
                "instructions": (
                    "Make one joint endpoint-validity and directed-relationship decision for "
                    "source_node_a -> target_node_b using the current event and bounded local "
                    "graph context. latest_prior_thoughts contains zero or one prior temporal "
                    "Thought per existing endpoint; use it only to understand current endpoint "
                    "meaning, never to infer more pairs or rewrite history. Both endpoints must "
                    "be durable, reusable ThinkGraph concepts "
                    "worth preserving in continuing project cognition. If either endpoint is "
                    "semantically discourse/request framing, sentence residue, generic filler, or "
                    "otherwise does not denote a reusable concept in this context, choose "
                    "INVALID_NODE_PAIR. Judge this from the pair's meaning and graph context, not "
                    "capitalization, keywords, stopwords, or another surface string rule. Do not "
                    "silently rename a rejected proposal into a different endpoint. Distinguish a "
                    "literal textual relationship or mere co-occurrence from a durable reusable "
                    "ThinkGraph relationship. If both endpoints are valid but no meaningful durable "
                    "directed relationship is supported, choose NONE. If context is inadequate, "
                    "choose INSUFFICIENT_CONTEXT. Otherwise choose the best canonical relationship. "
                    "A saved ThinkGraph Card free-form relationship proposal, when present, is "
                    "semantic evidence rather than a preselected answer. Do not infer unrelated "
                    "graph regions."
                ),
                "criteria": _RELATIONSHIP_CRITERIA,
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
    except (httpx.HTTPError, json.JSONDecodeError, ValueError) as error:
        raise JevRelationshipError("jev_relationship_unavailable") from error
    if not isinstance(response, dict):
        raise JevRelationshipError("jev_relationship_response_invalid")
    return _validate_jev_response(response)


def _jev_provenance(
    decision: dict[str, Any],
    payload: dict[str, Any],
    memory_ids: list[str],
    *,
    stage: str,
    proposition_memory_id: str = "",
) -> dict[str, Any]:
    jev = {
        "question_schema_version": "thinkgraph.relationship-choice.v2",
        "vocabulary_version": THINKGRAPH_RELATIONSHIP_SCHEMA_VERSION,
        "vocabulary_hash": THINKGRAPH_RELATIONSHIP_SCHEMA_HASH,
        "provider": decision["provider"],
        "requested_model": decision["requested_model"],
        "resolved_model": decision["resolved_model"],
        "evaluated_at": _utc_now(),
        "winner": decision["winner"],
        "distribution": decision["distribution"],
        "label_confidence": decision["label_confidence"],
        "relationship_strength": decision["relationship_strength"],
        "source_event": _source_event_reference(payload),
        "stage": stage,
    }
    if proposition_memory_id:
        jev["proposition_memory_id"] = proposition_memory_id
    return {
        "source": "jev_relationship_classifier",
        "memory_id": memory_ids[0] if memory_ids else "",
        "memory_ids": list(dict.fromkeys(mid for mid in memory_ids if mid)),
        "confidence": decision["label_confidence"],
        "jev": jev,
    }


def _decision_is_accepted(decision: dict[str, Any]) -> bool:
    return (
        decision.get("winner") not in {
            "NONE", "INSUFFICIENT_CONTEXT", "INVALID_NODE_PAIR",
        }
        and float(decision.get("relationship_strength") or 0.0)
        >= SEMANTIC_ADMISSION_MINIMUM
    )


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
            and _jev_edge(edge) is not None
        ),
        key=lambda edge: edge.id,
    )


def _upsert_canonical_endpoint(
    store: Any,
    *,
    workspace_id: str,
    name: str,
    entity_type: str,
) -> tuple[str, bool]:
    existing = _existing_entity_for_name(
        store,
        workspace_id=workspace_id,
        name=name,
        entity_type=entity_type,
    )
    if existing is not None:
        return str(existing["id"]), False
    written_id = store.upsert_entity(
        Node(
            id="",
            name=name,
            ntype=entity_type,
            workspace_id=workspace_id,
            repo_id=None,
        ),
        commit=False,
    )
    canonical_id = _canonical_entity_id(store, written_id) or written_id
    return canonical_id, canonical_id == written_id


def _apply_accepted_decision(
    store: Any,
    *,
    source_id: str = "",
    target_id: str = "",
    source_name: str,
    target_name: str,
    source_type: str = "person_or_concept",
    target_type: str = "person_or_concept",
    workspace_id: str,
    repo_id: str | None,
    payload: dict[str, Any],
    memory_ids: list[str],
    source_note_memory_ids: list[str] | None = None,
    target_note_memory_ids: list[str] | None = None,
    decision: dict[str, Any],
    stage: str,
    proposition_memory_id: str = "",
    commit: bool = True,
) -> dict[str, Any]:
    if not _decision_is_accepted(decision):
        return {
            "status": "no_edge",
            "source": source_id,
            "target": target_id,
            **decision,
        }
    with store._write_operation("thinkgraph_jev_edge", commit=commit):
        source_id = source_id or _upsert_canonical_endpoint(
            store,
            workspace_id=workspace_id,
            name=source_name,
            entity_type=source_type,
        )[0]
        target_id = target_id or _upsert_canonical_endpoint(
            store,
            workspace_id=workspace_id,
            name=target_name,
            entity_type=target_type,
        )[0]
        if not source_id or not target_id or source_id == target_id:
            raise ThinkGraphIntakeError("thinkgraph_relationship_endpoints_invalid")

        shared_memory_ids = list(dict.fromkeys(mid for mid in memory_ids if mid))
        source_note_memory_ids = list(dict.fromkeys(
            mid for mid in (source_note_memory_ids or []) if mid
        ))
        target_note_memory_ids = list(dict.fromkeys(
            mid for mid in (target_note_memory_ids or []) if mid
        ))
        for memory_id in shared_memory_ids:
            store.link_memory_entity(
                memory_id=memory_id,
                entity_id=source_id,
                workspace_id=workspace_id,
                repo_id=repo_id,
                source_kind=stage,
                confidence=1.0,
                provenance={"source": "jev_relationship_classifier"},
                commit=False,
            )
            store.link_memory_entity(
                memory_id=memory_id,
                entity_id=target_id,
                workspace_id=workspace_id,
                repo_id=repo_id,
                source_kind=stage,
                confidence=1.0,
                provenance={"source": "jev_relationship_classifier"},
                commit=False,
            )
        for memory_id in source_note_memory_ids:
            store.link_memory_entity(
                memory_id=memory_id,
                entity_id=source_id,
                workspace_id=workspace_id,
                repo_id=repo_id,
                source_kind="thinkgraph_note",
                confidence=1.0,
                provenance={"source": "thinkgraph"},
                commit=False,
            )
        for memory_id in target_note_memory_ids:
            store.link_memory_entity(
                memory_id=memory_id,
                entity_id=target_id,
                workspace_id=workspace_id,
                repo_id=repo_id,
                source_kind="thinkgraph_note",
                confidence=1.0,
                provenance={"source": "thinkgraph"},
                commit=False,
            )

        current = _current_jev_pair_edges(
            store,
            workspace_id=workspace_id,
            source_id=source_id,
            target_id=target_id,
        )
        prior_ids = list(dict.fromkeys(
            memory_id
            for edge in current
            for memory_id in _edge_memory_ids(edge)
        ))
        all_memory_ids = list(dict.fromkeys([
            *prior_ids,
            *shared_memory_ids,
            *source_note_memory_ids,
            *target_note_memory_ids,
        ]))
        provenance = _jev_provenance(
            decision,
            payload,
            all_memory_ids,
            stage=stage,
            proposition_memory_id=proposition_memory_id,
        )
        winner = str(decision["winner"])
        replaced_ids: list[str] = []
        if len(current) == 1 and current[0].relation == winner:
            existing = current[0]
            prior_provenance = (
                existing.provenance if isinstance(existing.provenance, dict) else {}
            )
            history = list(prior_provenance.get("jev_history") or [])
            prior_jev = prior_provenance.get("jev")
            if isinstance(prior_jev, dict):
                history.append(deepcopy(prior_jev))
            provenance["jev_history"] = history
            edge_id = store.upsert_edge(
                Edge(
                    id=existing.id,
                    src=source_id,
                    dst=target_id,
                    relation=winner,
                    weight=decision["relationship_strength"],
                    workspace_id=workspace_id,
                    repo_id=repo_id,
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
                    weight=decision["relationship_strength"],
                    workspace_id=workspace_id,
                    repo_id=repo_id,
                    provenance=provenance,
                ),
                commit=False,
            )
            status = "superseded" if replaced_ids else "written"
        return {
            "status": status,
            "edge_id": edge_id,
            "replaced_edge_ids": replaced_ids,
            "source": source_id,
            "target": target_id,
            **decision,
        }


class _IntakeLocalGraphStore:
    """Store-shaped native-feed sink with no database and no persistent identity."""

    def __init__(self) -> None:
        self.nodes: dict[str, dict[str, str]] = {}
        self.opportunities: list[dict[str, Any]] = []

    def upsert_entity(self, node: Any, **_kwargs: Any) -> str:
        entity_id = f"intake_entity_{len(self.nodes):04d}"
        self.nodes[entity_id] = {
            "name": str(node.name),
            "type": str(node.ntype or "person_or_concept"),
        }
        return entity_id

    def neighbors(self, *_args: Any, **_kwargs: Any) -> list[Any]:
        return []

    def upsert_edge(self, edge: Any, **_kwargs: Any) -> str:
        opportunity_id = f"intake_edge_{len(self.opportunities):04d}"
        self.opportunities.append({
            "id": opportunity_id,
            "source": deepcopy(self.nodes[edge.src]),
            "target": deepcopy(self.nodes[edge.dst]),
            "native_relation": str(edge.relation),
            "native_weight": float(edge.weight),
            "provenance": deepcopy(
                edge.provenance if isinstance(edge.provenance, dict) else {}
            ),
        })
        return opportunity_id

    def add_edge_support(
        self,
        edge_id: str,
        provenance: dict[str, Any],
        **_kwargs: Any,
    ) -> None:
        for opportunity in self.opportunities:
            if opportunity["id"] != edge_id:
                continue
            existing = opportunity["provenance"]
            memory_ids = [
                *list(existing.get("memory_ids") or []),
                *list(provenance.get("memory_ids") or []),
            ]
            for value in (existing.get("memory_id"), provenance.get("memory_id")):
                if value:
                    memory_ids.append(value)
            existing["memory_ids"] = list(dict.fromkeys(map(str, memory_ids)))
            return


def _enumerate_native_regex_opportunities(
    service: Any,
    *,
    content: str,
    title: str,
    workspace_id: str,
    provenance: dict[str, Any],
) -> tuple[Any, _IntakeLocalGraphStore]:
    """Use RegexGraphExtractor.extract plus native feed without touching the real Store."""
    from engraphis.backends.graph_extractor import RegexGraphExtractor, feed

    extractor = service.engine.graph_extractor
    if not isinstance(extractor, RegexGraphExtractor):
        raise ThinkGraphIntakeError("thinkgraph_regex_extractor_unavailable")
    extraction = extractor.extract(content, title=title)
    local = _IntakeLocalGraphStore()
    feed(
        local,
        content,
        title=title,
        workspace_id=workspace_id,
        repo_id=None,
        extractor=extractor,
        extraction=extraction,
        provenance=provenance,
        commit=False,
    )
    return extraction, local


def _decision_failure(error: Exception) -> str:
    text = str(error).strip()
    return text if text else type(error).__name__


def _classify_opportunities(
    store: Any,
    *,
    workspace_id: str,
    payload: dict[str, Any],
    opportunities: list[dict[str, Any]],
    classifier: Callable[..., dict[str, Any]],
    propositions: dict[int, str] | None = None,
    relationship_proposals: dict[int, str] | None = None,
    prior_thought_snapshot: dict[str, dict[str, Any] | None] | None = None,
) -> list[dict[str, Any]]:
    """Build bounded contexts first, then run at most four Jev calls concurrently."""
    work: list[dict[str, Any]] = []
    for index, opportunity in enumerate(opportunities):
        source = opportunity["source"]
        target = opportunity["target"]
        existing_source = _existing_entity_for_name(
            store,
            workspace_id=workspace_id,
            name=source["name"],
            entity_type=source["type"],
        )
        existing_target = _existing_entity_for_name(
            store,
            workspace_id=workspace_id,
            name=target["name"],
            entity_type=target["type"],
        )
        source_id = str(existing_source["id"]) if existing_source else ""
        target_id = str(existing_target["id"]) if existing_target else ""
        work.append({
            "index": index,
            "opportunity": opportunity,
            "source_id": source_id,
            "target_id": target_id,
            "context": _bounded_relationship_context(
                store,
                workspace_id=workspace_id,
                source_id=source_id,
                target_id=target_id,
                source_name=source["name"],
                target_name=target["name"],
                prior_thought_snapshot=prior_thought_snapshot,
            ),
            "proposition": str((propositions or {}).get(index) or ""),
            "relationship_proposal": str(
                (relationship_proposals or {}).get(index) or ""
            ),
        })

    results: list[dict[str, Any]] = [
        {"status": "jev_failed", "error": "jev_relationship_unavailable"}
        for _ in work
    ]
    if not work:
        return results

    def decide(item: dict[str, Any]) -> dict[str, Any]:
        return classifier(
            item["opportunity"]["source"]["name"],
            item["opportunity"]["target"]["name"],
            payload,
            item["proposition"],
            item["context"],
            item["relationship_proposal"],
        )

    with ThreadPoolExecutor(
        max_workers=min(MAX_JEV_CONCURRENCY, len(work)),
        thread_name_prefix="thinkgraph-jev",
    ) as executor:
        future_items = {executor.submit(decide, item): item for item in work}
        for future in as_completed(future_items):
            item = future_items[future]
            try:
                results[item["index"]] = {
                    "status": "decided",
                    "decision": future.result(),
                    "source_id": item["source_id"],
                    "target_id": item["target_id"],
                    "context": item["context"],
                }
            except Exception as error:
                results[item["index"]] = {
                    "status": "jev_failed",
                    "error": _decision_failure(error),
                    "source_id": item["source_id"],
                    "target_id": item["target_id"],
                }
    return results


def _persist_opportunity_decisions(
    store: Any,
    *,
    workspace_id: str,
    payload: dict[str, Any],
    pair_memory_id: str,
    stage: str,
    opportunities: list[dict[str, Any]],
    decisions: list[dict[str, Any]],
    source_note_memory_ids: dict[int, list[str]] | None = None,
    target_note_memory_ids: dict[int, list[str]] | None = None,
) -> dict[str, Any]:
    relationships: list[dict[str, Any]] = []
    failures: list[dict[str, Any]] = []
    changed_nodes: list[str] = []
    changed_edges: list[str] = []
    heat: dict[str, float] = {}
    for index, (opportunity, classified) in enumerate(zip(opportunities, decisions)):
        source = opportunity["source"]
        target = opportunity["target"]
        if classified["status"] != "decided":
            failures.append({
                "index": index,
                "source": source["name"],
                "target": target["name"],
                "error": classified["error"],
            })
            continue
        decision = classified["decision"]
        if not _decision_is_accepted(decision):
            relationships.append({
                "opportunity_index": index,
                "status": "no_edge",
                "source_name": source["name"],
                "target_name": target["name"],
                **decision,
            })
            continue
        provenance = opportunity.get("provenance") or {}
        memory_ids = list(provenance.get("memory_ids") or [])
        if provenance.get("memory_id"):
            memory_ids.insert(0, provenance["memory_id"])
        memory_ids = list(dict.fromkeys([
            pair_memory_id,
            *(str(value) for value in memory_ids if value),
        ]))
        try:
            written = _apply_accepted_decision(
                store,
                source_id=classified.get("source_id") or "",
                target_id=classified.get("target_id") or "",
                source_name=source["name"],
                target_name=target["name"],
                source_type=source["type"],
                target_type=target["type"],
                workspace_id=workspace_id,
                repo_id=None,
                payload=payload,
                memory_ids=memory_ids,
                source_note_memory_ids=(source_note_memory_ids or {}).get(index),
                target_note_memory_ids=(target_note_memory_ids or {}).get(index),
                decision=decision,
                stage=stage,
            )
            written["opportunity_index"] = index
            relationships.append(written)
            changed_nodes.extend((written["source"], written["target"]))
            changed_edges.append(written["edge_id"])
            changed_edges.extend(written.get("replaced_edge_ids") or [])
            strength = float(written["relationship_strength"])
            heat[written["source"]] = heat.get(written["source"], 0.0) + strength
            heat[written["target"]] = heat.get(written["target"], 0.0) + strength
        except Exception as error:
            failures.append({
                "index": index,
                "source": source["name"],
                "target": target["name"],
                "error": _decision_failure(error),
            })
    return {
        "relationships": relationships,
        "failures": failures,
        "changedNodeIds": list(dict.fromkeys(changed_nodes)),
        "changedEdgeIds": list(dict.fromkeys(changed_edges)),
        "turnHeat": heat,
    }


def _active_enrichment_targets(
    store: Any,
    *,
    relationships: list[dict[str, Any]],
    preexisting_ids: set[str],
) -> list[dict[str, str]]:
    """Project accepted canonical endpoints as explicit turn-scoped Card targets."""
    targets: dict[str, dict[str, str]] = {}
    for relationship in relationships:
        if relationship.get("status") not in {"written", "updated", "superseded"}:
            continue
        for endpoint in ("source", "target"):
            native_id = str(relationship.get(endpoint) or "")
            canonical_id = _canonical_entity_id(store, native_id) or native_id
            row = _entity_row(store, canonical_id)
            if row is None:
                raise ThinkGraphIntakeError("thinkgraph_active_target_invalid")
            targets.setdefault(canonical_id, {
                "nativeId": canonical_id,
                "canonicalName": str(row["name"]),
                "status": "EXISTING" if canonical_id in preexisting_ids else "NEW",
            })
    return list(targets.values())


def _install_graph_feeder(service: Any) -> None:
    if getattr(service.engine, "_liquidaity_native_graph_feeder", None) is not None:
        return
    native = service.engine.graph_feeder
    service.engine._liquidaity_native_graph_feeder = native

    def feeder(store: Any, content: str, **kwargs: Any) -> dict[str, int]:
        context = getattr(_intake_local, "context", None)
        if isinstance(context, dict) and context.get("suppress_graph"):
            return {"entities": 0, "relations": 0}
        local = _IntakeLocalGraphStore()
        native(local, content, **kwargs)
        if not local.opportunities:
            return {"entities": 0, "relations": 0}
        workspace_id = str(kwargs.get("workspace_id") or "")
        row = store.conn.execute(
            "SELECT name FROM workspaces WHERE id=?", (workspace_id,)
        ).fetchone()
        explicit = getattr(_intake_local, "explicit_event", None)
        payload = {
            "eventType": "explicit_memory",
            "projectId": str(row["name"] if row is not None else workspace_id),
            "toolName": str((explicit or {}).get("toolName") or "engraphis_memory_write"),
            "runId": str((explicit or {}).get("runId") or ""),
            "cardId": str((explicit or {}).get("cardId") or ""),
            "title": str(kwargs.get("title") or (explicit or {}).get("title") or ""),
            "content": content,
            "reason": str((explicit or {}).get("reason") or ""),
        }
        decisions = _classify_opportunities(
            store,
            workspace_id=workspace_id,
            payload=payload,
            opportunities=local.opportunities,
            classifier=classify_relationship,
        )
        memory_id = str((kwargs.get("provenance") or {}).get("memory_id") or "")
        result = _persist_opportunity_decisions(
            store,
            workspace_id=workspace_id,
            payload=payload,
            pair_memory_id=memory_id,
            stage="explicit_memory",
            opportunities=local.opportunities,
            decisions=decisions,
        )
        return {
            "entities": len(result["changedNodeIds"]),
            "relations": len(result["changedEdgeIds"]),
        }

    service.engine.graph_feeder = feeder


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
                extractor="none", graph_extractor="regex",
                retention_supervisor="none", allow_automatic_critical_retention=False,
            )
            _install_graph_feeder(service)
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


class ThinkGraphKind(str, Enum):
    CLAIM = "CLAIM"
    DECISION = "DECISION"
    QUESTION = "QUESTION"
    PREDICTION = "PREDICTION"
    CONSTRAINT = "CONSTRAINT"
    CORRECTION = "CORRECTION"
    PROPOSAL = "PROPOSAL"
    PREFERENCE = "PREFERENCE"
    PROCEDURE = "PROCEDURE"
    OBSERVATION = "OBSERVATION"


class _StructuredModel(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        str_strip_whitespace=True,
        use_enum_values=True,
    )


class ThinkGraphNoteProperty(_StructuredModel):
    name: str = Field(min_length=1, max_length=128)
    value: str = Field(min_length=1, max_length=1_000)


class ThinkGraphNodeNote(_StructuredModel):
    kind: ThinkGraphKind
    summary: str = Field(min_length=1, max_length=4_000)
    keywords: list[str] = Field(default_factory=list, max_length=16)
    properties: list[ThinkGraphNoteProperty] = Field(default_factory=list, max_length=16)
    concepts: list[str] = Field(default_factory=list, max_length=16)
    propositions: list[str] = Field(default_factory=list, max_length=16)
    relationship_observations: list[str] = Field(default_factory=list, max_length=16)
    importance: float = Field(default=0.0, ge=0.0, le=1.0)


class ThinkGraphStructuredRelation(_StructuredModel):
    source: str = Field(min_length=1, max_length=256)
    relation: str = Field(
        min_length=1,
        max_length=512,
        description=(
            "A concise, directional, semantically meaningful free-form description of how "
            "source relates to target, grounded in this fact. Omit the relation instead of "
            "using generic filler. Do not choose a canonical ThinkGraph edge label."
        ),
    )
    target: str = Field(min_length=1, max_length=256)


class ThinkGraphStructuredFact(_StructuredModel):
    """Native llm_structured fact fields plus its supported custom-schema depth."""

    content: str = Field(min_length=1, max_length=100_000)
    title: str = Field(default="", max_length=1_000)
    mtype: Literal["semantic", "episodic", "procedural", "working"] = "semantic"
    importance: float = Field(default=0.0, ge=0.0, le=1.0)
    keywords: list[str] = Field(default_factory=list, max_length=16)
    entities: list[str] = Field(default_factory=list, max_length=20)
    relations: list[ThinkGraphStructuredRelation] = Field(default_factory=list, max_length=10)
    kind: ThinkGraphKind = ThinkGraphKind.OBSERVATION
    properties: list[ThinkGraphNoteProperty] = Field(default_factory=list, max_length=16)
    concepts: list[str] = Field(default_factory=list, max_length=16)
    propositions: list[str] = Field(default_factory=list, max_length=16)
    relationship_observations: list[str] = Field(default_factory=list, max_length=16)


class _ProjectedNodeEnrichment(_StructuredModel):
    native_node_id: str = Field(min_length=1, max_length=128)
    notes: list[ThinkGraphNodeNote] = Field(min_length=1, max_length=12)


class _ProjectedNewNode(_StructuredModel):
    canonical_name: str = Field(min_length=1, max_length=256)
    notes: list[ThinkGraphNodeNote] = Field(min_length=1, max_length=12)


class _ProjectedPairEndpoint(_StructuredModel):
    native_node_id: str = Field(default="", max_length=128)
    canonical_name: str = Field(default="", max_length=256)

    @model_validator(mode="after")
    def exactly_one_identity(self) -> "_ProjectedPairEndpoint":
        if bool(self.native_node_id) == bool(self.canonical_name):
            raise ValueError("pair_endpoint_requires_exactly_one_identity")
        return self


class _ProjectedPairing(_StructuredModel):
    source: _ProjectedPairEndpoint
    target: _ProjectedPairEndpoint
    direction: Literal["source_to_target"]
    supporting_proposition: str = Field(min_length=1, max_length=4_000)
    relationship_proposal: str = Field(min_length=1, max_length=512)


class _ProjectedStructuredOutput(_StructuredModel):
    pair_summary: str = Field(default="", max_length=4_000)
    node_enrichments: list[_ProjectedNodeEnrichment] = Field(
        default_factory=list, max_length=128
    )
    new_nodes: list[_ProjectedNewNode] = Field(default_factory=list, max_length=128)
    pairings: list[_ProjectedPairing] = Field(default_factory=list, max_length=120)


def _remember_without_graph(service: Any, **kwargs: Any) -> dict[str, Any]:
    previous = getattr(_intake_local, "context", None)
    _intake_local.context = {"suppress_graph": True}
    try:
        return service.remember(**kwargs)
    finally:
        _intake_local.context = previous


def _clean_concept(value: str) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()[:256]


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


def _native_structured_extractor(llm: Any) -> Any:
    from engraphis.backends.extractor import StructuredLLMExtractor

    extractor_type = StructuredLLMExtractor.with_schema(ThinkGraphStructuredFact)
    return extractor_type(llm)


def _llm_structured_contract(
    pair_text: str,
    context: dict[str, Any],
) -> tuple[dict[str, Any], str]:
    extractor = _native_structured_extractor(
        _SavedCardStructuredResult({}, "schema-only")
    )
    context_text = json.dumps(context, ensure_ascii=False, sort_keys=True)
    return extractor._output_schema(), extractor._build_prompt(pair_text, context_text)


def _extract_saved_card_facts(
    value: Any,
    *,
    pair_text: str,
    context: dict[str, Any],
    card_run: dict[str, str],
) -> list[Any]:
    extractor = _native_structured_extractor(
        _SavedCardStructuredResult(
            _strict_card_json(value),
            card_run.get("resolvedModel") or card_run.get("profile") or "saved-card",
        )
    )
    facts = extractor.extract(
        pair_text,
        context=json.dumps(context, ensure_ascii=False, sort_keys=True),
    )
    if not facts or any(
        isinstance(fact.metadata, dict) and fact.metadata.get("extraction_fallback")
        for fact in facts
    ):
        raise ThinkGraphIntakeError("thinkgraph_card_llm_structured_invalid")
    return facts


def _project_structured_facts(facts: list[Any]) -> _ProjectedStructuredOutput:
    from engraphis.core.store import normalize_entity_name

    notes_by_entity: dict[str, dict[str, Any]] = {}
    pairings: list[_ProjectedPairing] = []
    seen_pairs: set[tuple[str, str, str]] = set()
    summaries: list[str] = []
    for fact in facts:
        metadata = fact.metadata if isinstance(fact.metadata, dict) else {}
        extra = metadata.get("structured_extraction")
        extra = extra if isinstance(extra, dict) else {}
        entities = [
            _clean_concept(value)
            for value in metadata.get("entities", [])
            if _clean_concept(value)
        ]
        relations = [
            relation for relation in metadata.get("relations", [])
            if isinstance(relation, dict)
        ]
        for relation in relations:
            entities.extend((
                _clean_concept(relation.get("source", "")),
                _clean_concept(relation.get("target", "")),
            ))
        entities = list(dict.fromkeys(value for value in entities if value))
        raw_kind = extra.get("kind", ThinkGraphKind.OBSERVATION)
        if isinstance(raw_kind, Enum):
            raw_kind = raw_kind.value
        try:
            kind = ThinkGraphKind(str(raw_kind))
        except ValueError:
            kind = ThinkGraphKind.OBSERVATION
        relation_observations = [
            str(value).strip()
            for value in extra.get("relationship_observations", [])
            if str(value).strip()
        ]
        for relation in relations:
            source = _clean_concept(relation.get("source", ""))
            label = _clean_concept(relation.get("relation", ""))
            target = _clean_concept(relation.get("target", ""))
            if source and label and target:
                relation_observations.append(f"{source} {label} {target}")
                identity = (source.casefold(), target.casefold(), fact.content.casefold())
                if identity not in seen_pairs:
                    seen_pairs.add(identity)
                    pairings.append(_ProjectedPairing(
                        source=_ProjectedPairEndpoint(canonical_name=source),
                        target=_ProjectedPairEndpoint(canonical_name=target),
                        direction="source_to_target",
                        supporting_proposition=str(fact.content)[:4_000],
                        relationship_proposal=label,
                    ))
        note = ThinkGraphNodeNote(
            kind=kind,
            summary=str(fact.content),
            keywords=list(fact.keywords)[:16],
            properties=list(extra.get("properties") or [])[:16],
            concepts=list(dict.fromkeys([
                *(str(value).strip() for value in extra.get("concepts", [])
                  if str(value).strip()),
                *entities,
            ]))[:16],
            propositions=list(extra.get("propositions") or [fact.content])[:16],
            relationship_observations=list(dict.fromkeys(relation_observations))[:16],
            importance=float(fact.importance or 0.0),
        )
        summaries.append(str(fact.content))
        for entity in entities:
            key = normalize_entity_name(entity)
            target = notes_by_entity.setdefault(key, {"name": entity, "notes": []})
            target["notes"].append(note)
    return _ProjectedStructuredOutput(
        pair_summary="\n\n".join(summaries)[:4_000],
        new_nodes=[
            _ProjectedNewNode(canonical_name=value["name"], notes=value["notes"])
            for value in notes_by_entity.values()
            if value["notes"]
        ],
        pairings=pairings,
    )


def _note_data(note: ThinkGraphNodeNote) -> dict[str, Any]:
    return note.model_dump(mode="json")


def _render_note(note: ThinkGraphNodeNote) -> str:
    value = _note_data(note)
    lines = [f"KIND: {value['kind']}", "", value["summary"]]
    for label, key in (
        ("KEYWORDS", "keywords"),
        ("PROPERTIES", "properties"),
        ("CONCEPTS", "concepts"),
        ("PROPOSITIONS", "propositions"),
        ("RELATIONSHIP OBSERVATIONS", "relationship_observations"),
    ):
        items = value[key]
        if not items:
            continue
        lines.extend(("", f"{label}:"))
        for item in items:
            if isinstance(item, dict):
                lines.append(f"- {item['name']}: {item['value']}")
            else:
                lines.append(f"- {item}")
    return "\n".join(lines)


def _save_note_memory(
    service: Any,
    *,
    project: str,
    entity_id: str = "",
    entity_name: str,
    note: ThinkGraphNodeNote,
    card_run: dict[str, str],
) -> str:
    logical = _note_data(note)
    kind_value = note.kind.value if isinstance(note.kind, Enum) else str(note.kind)
    note_metadata = {
        **deepcopy(logical),
        "entity_name": entity_name,
    }
    if entity_id:
        note_metadata["entity_id"] = entity_id
    metadata = {
        "thinkgraph_note": note_metadata,
        "thinkgraph_origin": {
            "authority": "thinkgraph",
            "writer": "saved_thinkgraph_card",
            "card_id": card_run["cardId"],
            "card_revision_id": card_run["revisionId"],
            "run_id": card_run["runId"],
            "profile": card_run["profile"],
            "native_session_ref": card_run["nativeSessionRef"],
            "resolved_model": card_run["resolvedModel"],
        },
    }
    saved = _remember_without_graph(
        service,
        content=_render_note(note),
        workspace=project,
        mtype="semantic",
        title=f"{kind_value}: {entity_name}",
        importance=note.importance,
        keywords=list(note.keywords),
        metadata=metadata,
        source="agent",
        trusted=True,
        kind="thinkgraph_note",
        resolve_conflicts=False,
        _local_agent_operator=True,
        _ingress="http",
    )
    return str(saved["id"])


def _persist_note(
    service: Any,
    *,
    project: str,
    workspace_id: str,
    entity_id: str,
    entity_name: str,
    note: ThinkGraphNodeNote,
    card_run: dict[str, str],
) -> str:
    memory_id = _save_note_memory(
        service,
        project=project,
        entity_id=entity_id,
        entity_name=entity_name,
        note=note,
        card_run=card_run,
    )
    service.store.link_memory_entity(
        memory_id=memory_id,
        entity_id=entity_id,
        workspace_id=workspace_id,
        repo_id=None,
        source_kind="thinkgraph_note",
        confidence=1.0,
        provenance={"source": "thinkgraph"},
    )
    return memory_id


def _invalidate_current_jev_pair(
    store: Any,
    *,
    workspace_id: str,
    source_id: str,
    target_id: str,
) -> list[str]:
    closed: list[str] = []
    with store._write_operation("thinkgraph_jev_edge_close", commit=True):
        for edge in _current_jev_pair_edges(
            store,
            workspace_id=workspace_id,
            source_id=source_id,
            target_id=target_id,
        ):
            store.invalidate_edge(edge.id, commit=False)
            closed.append(edge.id)
    return closed


def _top_turn_heat(heat: dict[str, float]) -> list[dict[str, Any]]:
    return [
        {"nativeId": native_id, "turnHeat": round(float(value), 6)}
        for native_id, value in sorted(
            heat.items(), key=lambda item: (-float(item[1]), item[0])
        )[:5]
    ]


def _validate_completed_pair_payload(payload: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise ValueError("thinkgraph_completed_pair_payload_invalid")
    allowed = {
        "projectId", "deckId", "conversationId", "runId", "cardId",
        "nativeSessionRef", "completedAt", "userMessage", "mainResponse",
    }
    if set(payload) - allowed:
        raise ValueError("thinkgraph_completed_pair_payload_invalid")
    cleaned = dict(payload)
    for key in allowed:
        if key in cleaned and not isinstance(cleaned[key], str):
            raise ValueError("thinkgraph_completed_pair_payload_invalid")
    cleaned["projectId"] = project_id(str(cleaned.get("projectId") or ""))
    cleaned["userMessage"] = str(cleaned.get("userMessage") or "")
    cleaned["mainResponse"] = str(cleaned.get("mainResponse") or "")
    if not cleaned["userMessage"].strip() or not cleaned["mainResponse"].strip():
        raise ValueError("thinkgraph_completed_pair_text_required")
    return cleaned


def begin_completed_pair(
    payload: dict[str, Any],
    *,
    classifier: Callable[..., dict[str, Any]] = classify_relationship,
) -> dict[str, Any]:
    """Resolve source novelty, then admit only native-feed pairs accepted by Jev."""
    payload = _validate_completed_pair_payload(payload)
    project = payload["projectId"]
    pair_text = f"USER:\n{payload['userMessage']}\n\nMAIN:\n{payload['mainResponse']}"
    service = get_service()
    with _intake_lock:
        workspace_id = service.store.get_or_create_workspace(project)
        revision_before = _graph_revision(service.store, workspace_id)
        preexisting_ids = {
            str(row["canonical_id"])
            for row in service.store.conn.execute(
                "SELECT DISTINCT COALESCE(canonical_id,id) AS canonical_id "
                "FROM entities WHERE workspace_id=?",
                (workspace_id,),
            ).fetchall()
        }
        try:
            saved = _remember_without_graph(
                service,
                content=pair_text,
                workspace=project,
                mtype="episodic",
                title="Completed User/Main pair",
                metadata={"thinkgraph_completed_pair": {
                    "source_pair": _source_pair(payload),
                    "intake": "native_regex_jev_then_saved_thinkgraph_card",
                }},
                source="agent",
                trusted=True,
                kind="thinkgraph_completed_pair",
                resolve_conflicts=True,
                _local_agent_operator=True,
                _ingress="http",
            )
        except Exception as error:
            raise ThinkGraphIntakeError(
                "thinkgraph_completed_pair_store_failed"
            ) from error

        intake_operation = str(saved.get("op") or "")
        if intake_operation == "noop":
            return {
                "ok": True,
                "projectId": project,
                "pairMemoryId": str(saved["id"]),
                "intakeOperation": intake_operation,
                "enrichmentRequired": False,
                "revision": revision_before,
                "revisionChanged": False,
                "fast": {
                    "status": "duplicate_noop",
                    "opportunityCount": 0,
                    "relationships": [],
                    "failures": [],
                    "changedNodeIds": [],
                    "changedEdgeIds": [],
                    "turnHeat": {},
                    "topActiveNodes": [],
                },
            }
        if intake_operation not in {"add", "invalidate", "relate"}:
            raise ThinkGraphIntakeError(
                "thinkgraph_completed_pair_resolution_invalid"
            )

        _extraction, local = _enumerate_native_regex_opportunities(
            service,
            content=pair_text,
            title="Completed User/Main pair",
            workspace_id=workspace_id,
            provenance={
                "source": "completed_user_main_pair",
                "memory_id": saved["id"],
            },
        )
        turn_start_prior_thought_snapshot = _turn_start_prior_thought_snapshot(
            service.store,
            workspace_id=workspace_id,
            opportunities=local.opportunities,
        )
        decisions = _classify_opportunities(
            service.store,
            workspace_id=workspace_id,
            payload=payload,
            opportunities=local.opportunities,
            classifier=classifier,
            prior_thought_snapshot=turn_start_prior_thought_snapshot,
        )
        persisted = _persist_opportunity_decisions(
            service.store,
            workspace_id=workspace_id,
            payload=payload,
            pair_memory_id=str(saved["id"]),
            stage="fast_regex",
            opportunities=local.opportunities,
            decisions=decisions,
        )
        revision = _graph_revision(service.store, workspace_id)
        accepted = [
            item for item in persisted["relationships"]
            if item["status"] in {"written", "updated", "superseded"}
        ]
        active_targets = _active_enrichment_targets(
            service.store,
            relationships=accepted,
            preexisting_ids=preexisting_ids,
        )
        changed_node_ids = persisted["changedNodeIds"]
        structured_graph_shape = _bounded_structured_graph_shape(
            service.store,
            workspace_id=workspace_id,
            entity_ids=[target["nativeId"] for target in active_targets],
        )
        # Newly admitted nodes have no prior Thought. Keep explicit nulls for
        # every node exposed to the Card so settled Jev cannot later re-query a
        # node and mistake this turn's current Thought for historical context.
        for node in structured_graph_shape["nodes"]:
            turn_start_prior_thought_snapshot.setdefault(
                str(node["nativeId"]), None,
            )
        fast = {
            "status": (
                "completed" if not persisted["failures"]
                else "completed_with_pair_failures"
            ),
            "opportunityCount": len(local.opportunities),
            "relationships": persisted["relationships"],
            "failures": persisted["failures"],
            "changedNodeIds": changed_node_ids,
            "changedEdgeIds": persisted["changedEdgeIds"],
            "turnHeat": persisted["turnHeat"],
            "topActiveNodes": _top_turn_heat(persisted["turnHeat"]),
            "activeEnrichmentTargets": active_targets,
        }
        target_names = {
            target["nativeId"]: target["canonicalName"] for target in active_targets
        }
        current_turn_relationships = [{
            "source": {
                "nativeId": relationship["source"],
                "canonicalName": target_names[relationship["source"]],
            },
            "target": {
                "nativeId": relationship["target"],
                "canonicalName": target_names[relationship["target"]],
            },
            "canonicalRelationship": relationship["winner"],
            "relationshipStrength": relationship["relationship_strength"],
        } for relationship in accepted]
        enrichment_input = {
            "exact_user_message": payload["userMessage"],
            "exact_main_response": payload["mainResponse"],
            "current_turn_enrichment_targets": [
                {
                    **target,
                    "structuredNoteRule": (
                        "CREATE_FIRST_CURRENT_PAIR_THOUGHT"
                        if target["status"] == "NEW"
                        else "APPEND_CURRENT_PAIR_THOUGHT"
                    ),
                }
                for target in active_targets
            ],
            "current_graph_shape": structured_graph_shape,
            "current_turn_accepted_relationships": current_turn_relationships,
        }
        enrichment_schema, enrichment_prompt = _llm_structured_contract(
            pair_text,
            enrichment_input,
        )
        return {
            "ok": True,
            "projectId": project,
            "pairMemoryId": str(saved["id"]),
            "intakeOperation": intake_operation,
            "enrichmentRequired": True,
            "revision": revision,
            "revisionChanged": revision != revision_before,
            "fast": fast,
            "enrichmentMode": "llm_structured",
            "enrichmentSchema": enrichment_schema,
            "enrichmentPrompt": enrichment_prompt,
            "enrichmentInput": enrichment_input,
            "turnStartPriorThoughtSnapshot": turn_start_prior_thought_snapshot,
        }


_TURN_START_THOUGHT_FIELDS = {
    "native_id", "canonical_name", "memory_id", "kind", "content",
    "keywords", "properties", "concepts", "propositions",
    "relationship_observations", "ingested_at", "valid_from", "valid_to",
}


def _validate_turn_start_prior_thought_snapshot(
    value: Any,
) -> dict[str, dict[str, Any] | None]:
    if not isinstance(value, dict) or len(value) > 128:
        raise ValueError("thinkgraph_prior_thought_snapshot_invalid")
    snapshot: dict[str, dict[str, Any] | None] = {}
    for raw_native_id, raw_thought in value.items():
        if not isinstance(raw_native_id, str) or not raw_native_id:
            raise ValueError("thinkgraph_prior_thought_snapshot_invalid")
        if raw_thought is None:
            snapshot[raw_native_id] = None
            continue
        if (
            not isinstance(raw_thought, dict)
            or set(raw_thought) != _TURN_START_THOUGHT_FIELDS
            or raw_thought.get("native_id") != raw_native_id
            or not isinstance(raw_thought.get("canonical_name"), str)
            or not str(raw_thought.get("memory_id") or "").startswith("mem_")
            or not isinstance(raw_thought.get("content"), str)
            or not all(isinstance(raw_thought.get(key), list) for key in (
                "keywords", "properties", "concepts", "propositions",
                "relationship_observations",
            ))
        ):
            raise ValueError("thinkgraph_prior_thought_snapshot_invalid")
        snapshot[raw_native_id] = deepcopy(raw_thought)
    return snapshot


def _validate_settle_payload(
    payload: dict[str, Any],
) -> tuple[
    dict[str, Any], str, dict[str, float], list[dict[str, str]],
    dict[str, dict[str, Any] | None], Any, dict[str, str]
]:
    if not isinstance(payload, dict):
        raise ValueError("thinkgraph_completed_pair_payload_invalid")
    completed_keys = {
        "projectId", "deckId", "conversationId", "runId", "cardId",
        "nativeSessionRef", "completedAt", "userMessage", "mainResponse",
    }
    extras = {
        "pairMemoryId", "fastTurnHeat", "fastActiveTargets", "structuredOutput",
        "turnStartPriorThoughtSnapshot", "cardRun",
    }
    if set(payload) - completed_keys - extras:
        raise ValueError("thinkgraph_completed_pair_payload_invalid")
    completed = _validate_completed_pair_payload({
        key: payload[key] for key in completed_keys if key in payload
    })
    pair_memory_id = str(payload.get("pairMemoryId") or "")
    if not pair_memory_id.startswith("mem_"):
        raise ValueError("thinkgraph_pair_memory_id_invalid")
    raw_heat = payload.get("fastTurnHeat") or {}
    if not isinstance(raw_heat, dict):
        raise ValueError("thinkgraph_turn_heat_invalid")
    heat: dict[str, float] = {}
    for native_id, raw_value in raw_heat.items():
        value = float(raw_value)
        if not native_id or not math.isfinite(value) or value < 0:
            raise ValueError("thinkgraph_turn_heat_invalid")
        heat[str(native_id)] = value
    raw_targets = payload.get("fastActiveTargets")
    if not isinstance(raw_targets, list):
        raise ValueError("thinkgraph_active_targets_invalid")
    active_targets: list[dict[str, str]] = []
    seen_targets: set[str] = set()
    for raw_target in raw_targets:
        if not isinstance(raw_target, dict) or set(raw_target) != {
            "nativeId", "canonicalName", "status",
        }:
            raise ValueError("thinkgraph_active_targets_invalid")
        native_id = str(raw_target.get("nativeId") or "")
        canonical_name = _clean_concept(str(raw_target.get("canonicalName") or ""))
        status = str(raw_target.get("status") or "")
        if (
            not native_id or not canonical_name or status not in {"NEW", "EXISTING"}
            or native_id in seen_targets or native_id not in heat
        ):
            raise ValueError("thinkgraph_active_targets_invalid")
        seen_targets.add(native_id)
        active_targets.append({
            "nativeId": native_id,
            "canonicalName": canonical_name,
            "status": status,
        })
    if seen_targets != set(heat):
        raise ValueError("thinkgraph_active_targets_invalid")
    prior_thought_snapshot = _validate_turn_start_prior_thought_snapshot(
        payload.get("turnStartPriorThoughtSnapshot")
    )
    structured_output = payload.get("structuredOutput")
    if not isinstance(structured_output, (str, dict, list)):
        raise ValueError("thinkgraph_card_output_invalid_json")
    raw_run = payload.get("cardRun")
    if not isinstance(raw_run, dict):
        raise ValueError("thinkgraph_card_run_invalid")
    allowed_run = {
        "runId", "cardId", "revisionId", "profile", "nativeSessionRef",
        "resolvedModel",
    }
    if set(raw_run) - allowed_run:
        raise ValueError("thinkgraph_card_run_invalid")
    card_run = {key: str(raw_run.get(key) or "") for key in allowed_run}
    if any(not card_run[key] for key in allowed_run):
        raise ValueError("thinkgraph_card_run_invalid")
    return (
        completed, pair_memory_id, heat, active_targets,
        prior_thought_snapshot, structured_output, card_run,
    )


def _canonical_row_in_workspace(
    store: Any,
    *,
    workspace_id: str,
    native_id: str,
) -> dict[str, Any]:
    row = store.conn.execute(
        "SELECT id, name, etype, canonical_id FROM entities "
        "WHERE workspace_id=? AND id=?",
        (workspace_id, native_id),
    ).fetchone()
    if row is None:
        raise ThinkGraphIntakeError("thinkgraph_card_native_node_invalid")
    canonical_id = str(row["canonical_id"] or row["id"])
    canonical = _entity_row(store, canonical_id)
    if canonical is None:
        raise ThinkGraphIntakeError("thinkgraph_card_native_node_invalid")
    return canonical


def settle_completed_pair(
    payload: dict[str, Any],
    *,
    classifier: Callable[..., dict[str, Any]] = classify_relationship,
) -> dict[str, Any]:
    """Apply validated saved-ThinkGraph-Card Notes and Jev-gated pairings."""
    (
        completed, pair_memory_id, heat, active_targets,
        prior_thought_snapshot, card_output, card_run,
    ) = _validate_settle_payload(payload)
    project = completed["projectId"]
    service = get_service()
    with _intake_lock:
        store = service.store
        workspace_id = store.get_or_create_workspace(project)
        pair_memory = store.get_memory(pair_memory_id)
        expected_source = _source_pair(completed)
        pair_metadata = (
            pair_memory.metadata.get("thinkgraph_completed_pair", {})
            if pair_memory is not None and isinstance(pair_memory.metadata, dict)
            else {}
        )
        if (
            pair_memory is None
            or pair_memory.workspace_id != workspace_id
            or pair_metadata.get("source_pair") != expected_source
        ):
            raise ThinkGraphIntakeError("thinkgraph_completed_pair_scope_mismatch")
        for target in active_targets:
            row = _canonical_row_in_workspace(
                store,
                workspace_id=workspace_id,
                native_id=target["nativeId"],
            )
            if (
                str(row["id"]) != target["nativeId"]
                or str(row["name"]) != target["canonicalName"]
            ):
                raise ThinkGraphIntakeError("thinkgraph_active_target_scope_mismatch")
        for native_id, thought in prior_thought_snapshot.items():
            row = _canonical_row_in_workspace(
                store,
                workspace_id=workspace_id,
                native_id=native_id,
            )
            if str(row["id"]) != native_id:
                raise ThinkGraphIntakeError(
                    "thinkgraph_prior_thought_snapshot_scope_mismatch"
                )
            if thought is None:
                continue
            memory = store.get_memory(str(thought["memory_id"]))
            incidence = store.conn.execute(
                "SELECT 1 FROM memory_entities me "
                "JOIN entities e ON e.id=me.entity_id "
                "WHERE me.workspace_id=? AND me.memory_id=? "
                "AND me.source_kind='thinkgraph_note' "
                "AND (e.id=? OR e.canonical_id=?) LIMIT 1",
                (workspace_id, thought["memory_id"], native_id, native_id),
            ).fetchone()
            if (
                memory is None
                or memory.workspace_id != workspace_id
                or incidence is None
                or thought["canonical_name"] != str(row["name"])
            ):
                raise ThinkGraphIntakeError(
                    "thinkgraph_prior_thought_snapshot_scope_mismatch"
                )
        revision_before = _graph_revision(store, workspace_id)
        structured_context = {
            "exact_user_message": completed["userMessage"],
            "exact_main_response": completed["mainResponse"],
            "current_turn_enrichment_targets": active_targets,
        }
        facts = _extract_saved_card_facts(
            card_output,
            pair_text=(
                f"USER:\n{completed['userMessage']}\n\n"
                f"MAIN:\n{completed['mainResponse']}"
            ),
            context=structured_context,
            card_run=card_run,
        )
        output = _project_structured_facts(facts)

        from engraphis.core.store import normalize_entity_name

        declared_nodes: dict[str, _ProjectedNewNode] = {}
        for proposed in output.new_nodes:
            clean = _clean_concept(proposed.canonical_name)
            key = normalize_entity_name(clean)
            if not clean or not key or key in declared_nodes:
                raise ThinkGraphIntakeError("thinkgraph_card_new_node_invalid")
            declared_nodes[key] = proposed.model_copy(
                update={"canonical_name": clean}
            )

        for target in active_targets:
            key = normalize_entity_name(target["canonicalName"])
            if key not in declared_nodes:
                raise ThinkGraphIntakeError(
                    "thinkgraph_card_active_node_thought_required"
                )

        endpoint_cache: dict[tuple[str, str], dict[str, str]] = {}

        def endpoint(value: _ProjectedPairEndpoint) -> dict[str, str]:
            cache_key = (value.native_node_id, value.canonical_name)
            if cache_key in endpoint_cache:
                return endpoint_cache[cache_key]
            if value.native_node_id:
                row = _canonical_row_in_workspace(
                    store,
                    workspace_id=workspace_id,
                    native_id=value.native_node_id,
                )
                result = {
                    "id": str(row["id"]),
                    "name": str(row["name"]),
                    "type": str(row["etype"] or "person_or_concept"),
                    "new_key": "",
                }
            else:
                clean = _clean_concept(value.canonical_name)
                key = normalize_entity_name(clean)
                if not clean or key not in declared_nodes:
                    raise ThinkGraphIntakeError(
                        "thinkgraph_card_pair_endpoint_undeclared"
                    )
                existing = _existing_entity_for_name(
                    store,
                    workspace_id=workspace_id,
                    name=clean,
                )
                result = {
                    "id": str(existing["id"]) if existing else "",
                    "name": str(existing["name"]) if existing else clean,
                    "type": str(existing["etype"] or "person_or_concept")
                    if existing else "person_or_concept",
                    "new_key": key,
                }
            endpoint_cache[cache_key] = result
            return result

        enrichment_notes: dict[str, list[ThinkGraphNodeNote]] = {}
        entity_names: dict[str, str] = {}
        for enrichment in output.node_enrichments:
            row = _canonical_row_in_workspace(
                store,
                workspace_id=workspace_id,
                native_id=enrichment.native_node_id,
            )
            native_id = str(row["id"])
            entity_names[native_id] = str(row["name"])
            enrichment_notes.setdefault(native_id, []).extend(enrichment.notes)

        new_node_existing_ids: dict[str, str] = {}
        for key, proposed in declared_nodes.items():
            existing = _existing_entity_for_name(
                store,
                workspace_id=workspace_id,
                name=proposed.canonical_name,
            )
            if existing is None:
                continue
            native_id = str(existing["id"])
            new_node_existing_ids[key] = native_id
            entity_names[native_id] = str(existing["name"])
            enrichment_notes.setdefault(native_id, []).extend(proposed.notes)

        opportunities: list[dict[str, Any]] = []
        propositions: dict[int, str] = {}
        relationship_proposals: dict[int, str] = {}
        endpoint_keys: list[tuple[dict[str, str], dict[str, str]]] = []
        seen_pairings: set[tuple[str, str, str, str]] = set()
        for pairing in output.pairings:
            source = endpoint(pairing.source)
            target = endpoint(pairing.target)
            source_key = source["id"] or f"new:{source['new_key']}"
            target_key = target["id"] or f"new:{target['new_key']}"
            if source_key == target_key:
                raise ThinkGraphIntakeError("thinkgraph_card_pair_self_reference")
            identity = (
                source_key,
                target_key,
                pairing.relationship_proposal.casefold(),
                pairing.supporting_proposition.casefold(),
            )
            if identity in seen_pairings:
                raise ThinkGraphIntakeError("thinkgraph_card_pair_duplicate")
            seen_pairings.add(identity)
            index = len(opportunities)
            opportunities.append({
                "id": f"card_pair_{index:04d}",
                "source": {"name": source["name"], "type": source["type"]},
                "target": {"name": target["name"], "type": target["type"]},
                "native_relation": pairing.relationship_proposal,
                "native_weight": 0.0,
                "provenance": {},
            })
            endpoint_keys.append((source, target))
            propositions[index] = pairing.supporting_proposition
            relationship_proposals[index] = pairing.relationship_proposal

        decisions = _classify_opportunities(
            store,
            workspace_id=workspace_id,
            payload=completed,
            opportunities=opportunities,
            classifier=classifier,
            propositions=propositions,
            relationship_proposals=relationship_proposals,
            prior_thought_snapshot=prior_thought_snapshot,
        )

        note_memory_ids: list[str] = []
        failures: list[dict[str, Any]] = []

        # A genuinely new graph node is born only as node + Note + accepted edge.
        # Save its structured memory first, then let _apply_accepted_decision create
        # both endpoints/edge and attach the staged Note incidences inside one native
        # Store transaction. A staged memory whose graph write later fails remains
        # ordinary Engraphis structured memory, never a node-attached ThinkGraph Note.
        accepted_new_keys = {
            endpoint_value["new_key"]
            for index, classified in enumerate(decisions)
            if classified["status"] == "decided"
            and _decision_is_accepted(classified["decision"])
            for endpoint_value in endpoint_keys[index]
            if endpoint_value["new_key"]
            and endpoint_value["new_key"] not in new_node_existing_ids
        }
        staged_note_ids_by_new_key: dict[str, list[str]] = {}
        blocked_new_keys: set[str] = set()
        for key in sorted(accepted_new_keys):
            proposed = declared_nodes[key]
            staged: list[str] = []
            for note in proposed.notes:
                try:
                    staged.append(_save_note_memory(
                        service,
                        project=project,
                        entity_name=proposed.canonical_name,
                        note=note,
                        card_run=card_run,
                    ))
                except Exception as error:
                    failures.append({
                        "stage": "new_node_note",
                        "canonicalName": proposed.canonical_name,
                        "error": _decision_failure(error),
                    })
                    blocked_new_keys.add(key)
                    break
            if not staged:
                blocked_new_keys.add(key)
            staged_note_ids_by_new_key[key] = staged

        for index, (source, target) in enumerate(endpoint_keys):
            blocked = {
                value["new_key"] for value in (source, target)
                if value["new_key"] in blocked_new_keys
            }
            if blocked:
                prior = decisions[index]
                decisions[index] = {
                    "status": "persistence_blocked",
                    "error": "new_node_note_failed",
                    "source_id": prior.get("source_id", ""),
                    "target_id": prior.get("target_id", ""),
                }

        source_note_memory_ids = {
            index: staged_note_ids_by_new_key.get(source["new_key"], [])
            for index, (source, _target) in enumerate(endpoint_keys)
            if source["new_key"] and source["new_key"] not in blocked_new_keys
        }
        target_note_memory_ids = {
            index: staged_note_ids_by_new_key.get(target["new_key"], [])
            for index, (_source, target) in enumerate(endpoint_keys)
            if target["new_key"] and target["new_key"] not in blocked_new_keys
        }

        for native_id, notes in enrichment_notes.items():
            for note in notes:
                try:
                    memory_id = _persist_note(
                        service,
                        project=project,
                        workspace_id=workspace_id,
                        entity_id=native_id,
                        entity_name=entity_names[native_id],
                        note=note,
                        card_run=card_run,
                    )
                except Exception as error:
                    failures.append({
                        "stage": "node_note",
                        "nativeId": native_id,
                        "error": _decision_failure(error),
                    })
                    continue
                note_memory_ids.append(memory_id)
                heat[native_id] = heat.get(native_id, 0.0) + 1.0

        card_persisted = _persist_opportunity_decisions(
            store,
            workspace_id=workspace_id,
            payload=completed,
            pair_memory_id=pair_memory_id,
            stage="thinkgraph_card",
            opportunities=opportunities,
            decisions=decisions,
            source_note_memory_ids=source_note_memory_ids,
            target_note_memory_ids=target_note_memory_ids,
        )
        failures.extend(card_persisted["failures"])
        changed_node_ids = list(card_persisted["changedNodeIds"])
        changed_edge_ids = list(card_persisted["changedEdgeIds"])
        for native_id, value in card_persisted["turnHeat"].items():
            heat[native_id] = heat.get(native_id, 0.0) + float(value)

        written_pair_indices = {
            int(item["opportunity_index"])
            for item in card_persisted["relationships"]
            if item["status"] in {"written", "updated", "superseded"}
        }
        written_new_keys: set[str] = set()
        for index in written_pair_indices:
            source, target = endpoint_keys[index]
            if source["new_key"]:
                written_new_keys.add(source["new_key"])
            if target["new_key"]:
                written_new_keys.add(target["new_key"])

        for key in sorted(written_new_keys):
            if key in new_node_existing_ids:
                continue
            proposed = declared_nodes[key]
            row = _existing_entity_for_name(
                store,
                workspace_id=workspace_id,
                name=proposed.canonical_name,
            )
            if row is None:
                failures.append({
                    "stage": "new_node_note",
                    "canonicalName": proposed.canonical_name,
                    "error": "accepted_endpoint_not_persisted",
                })
                continue
            native_id = str(row["id"])
            entity_names[native_id] = str(row["name"])
            staged = staged_note_ids_by_new_key.get(key, [])
            note_memory_ids.extend(staged)
            heat[native_id] = heat.get(native_id, 0.0) + float(len(staged))
            changed_node_ids.append(native_id)

        # Notes never trigger edge maintenance. Only an explicit structured
        # A -> B proposal can update, supersede, or close that exact live pair.
        relation_by_index = {
            int(item["opportunity_index"]): item
            for item in card_persisted["relationships"]
        }
        for index, classified in enumerate(decisions):
            source, target = endpoint_keys[index]
            source_row = (
                _canonical_row_in_workspace(
                    store, workspace_id=workspace_id, native_id=source["id"]
                ) if source["id"] else _existing_entity_for_name(
                    store, workspace_id=workspace_id, name=source["name"]
                )
            )
            target_row = (
                _canonical_row_in_workspace(
                    store, workspace_id=workspace_id, native_id=target["id"]
                ) if target["id"] else _existing_entity_for_name(
                    store, workspace_id=workspace_id, name=target["name"]
                )
            )
            if source_row is None or target_row is None:
                continue
            source_id = str(source_row["id"])
            target_id = str(target_row["id"])
            if classified["status"] != "decided":
                continue
            decision = classified["decision"]
            if _decision_is_accepted(decision):
                continue
            closed = _invalidate_current_jev_pair(
                store,
                workspace_id=workspace_id,
                source_id=source_id,
                target_id=target_id,
            )
            if closed:
                changed_edge_ids.extend(closed)
                changed_node_ids.extend((source_id, target_id))
                current = relation_by_index.get(index)
                if current is not None:
                    current["status"] = "closed"
                    current["closed_edge_ids"] = closed

        revision = _graph_revision(store, workspace_id)
        changed_node_ids = list(dict.fromkeys(changed_node_ids))
        changed_edge_ids = list(dict.fromkeys(changed_edge_ids))
        affected_ids = set(changed_node_ids)
        return {
            "ok": True,
            "projectId": project,
            "pairMemoryId": pair_memory_id,
            "revision": revision,
            "revisionChanged": revision != revision_before,
            "status": "completed" if not failures else "completed_with_failures",
            "cardRun": card_run,
            "pairSummary": output.pair_summary,
            "noteMemoryIds": note_memory_ids,
            "relationships": card_persisted["relationships"],
            "failures": failures,
            "changedNodeIds": changed_node_ids,
            "changedEdgeIds": changed_edge_ids,
            "affectedNodeIds": sorted(affected_ids),
            "turnHeat": heat,
            "topActiveNodes": _top_turn_heat(heat),
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


def _native_tools_from_registrations() -> list[dict]:
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


async def native_tools() -> list[dict]:
    return _native_tools_from_registrations()


_OPERATION_DEFINITIONS: tuple[Any, ...] | None = None
_OPERATION_DEFINITIONS_LOCK = threading.Lock()


def operation_definitions() -> list[Any]:
    """Contribute native Engraphis contracts without routing through MCP discovery."""

    global _OPERATION_DEFINITIONS
    if _OPERATION_DEFINITIONS is not None:
        return list(_OPERATION_DEFINITIONS)
    with _OPERATION_DEFINITIONS_LOCK:
        if _OPERATION_DEFINITIONS is not None:
            return list(_OPERATION_DEFINITIONS)
        try:
            native_contracts = _native_tools_from_registrations()
        except BaseException as error:
            raise RuntimeError("engraphis_operation_definitions_unavailable") from error

        from app.python_models.tool_registry import OperationDefinition

        definitions = []
        for item in native_contracts:
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
            ))
        _OPERATION_DEFINITIONS = tuple(definitions)
        return list(_OPERATION_DEFINITIONS)


async def invoke_tool(project: str, name: str, arguments: dict) -> dict:
    # Native FastMCP synchronous tools execute on their caller's thread. Keep
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
    previous_event = getattr(_intake_local, "explicit_event", None)
    if name != "engraphis_link" and name in WRITE_TOOLS:
        exact_content = arguments.get("content")
        if exact_content is None and "memories" in arguments:
            exact_content = json.dumps(
                arguments["memories"], ensure_ascii=False, sort_keys=True
            )
        _intake_local.explicit_event = {
            "toolName": name,
            "title": str(arguments.get("title") or ""),
            "content": str(exact_content or ""),
            "reason": str(
                arguments.get("retention_reason")
                or arguments.get("reason")
                or ""
            ),
        }
    try:
        response = await server.call_tool(name, arguments)
    finally:
        _intake_local.explicit_event = previous_event
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


def inspect(project: str, native_id: str) -> dict:
    service = get_service()
    project = project_id(project)
    if not native_id.startswith("mem_"):
        entity = service.graph_entity(
            native_id,
            workspace=project,
            include_weak_cooccurrence=False,
        )
        evidence_by_id = {
            str(item["memory_id"]): dict(item)
            for item in entity.get("evidence") or []
            if item.get("memory_id")
        }
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
            memory_ids = list(dict.fromkeys(
                [*evidence_by_id, *(str(row["memory_id"]) for row in incidences)]
            ))
            memories = service.store.get_memories(memory_ids)
            for memory_id, memory in memories.items():
                current = evidence_by_id.get(memory_id)
                if current is not None:
                    current["metadata"] = deepcopy(memory.metadata)
                    continue
                if _note_metadata(memory) is None:
                    continue
                evidence_by_id[memory_id] = {
                    "memory_id": memory.id,
                    "title": memory.title,
                    "excerpt": memory.content[:500],
                    "memory_type": (
                        memory.mtype.value
                        if isinstance(memory.mtype, Enum) else str(memory.mtype)
                    ),
                    "source_kind": "thinkgraph_note",
                    "confidence": 1.0,
                    "valid_from": memory.valid_from,
                    "valid_to": memory.valid_to,
                    "valid_to_recorded_at": memory.valid_to_recorded_at,
                    "ingested_at": memory.ingested_at,
                    "expired_at": memory.expired_at,
                    "provenance": deepcopy(memory.provenance),
                    "metadata": deepcopy(memory.metadata),
                }
        entity["evidence"] = sorted(evidence_by_id.values(), key=_newest_note_key)
        return {"entity": entity}
    result = service.inspect(native_id, workspace=project)
    result["memory"]["metadata"] = service.store.get_memory(native_id).metadata
    # Preserve directional composite identities from the native link store.
    # The public inspector has already authorized the neighboring records.
    neighbors = {link["id"] for link in result["links"]}
    result["nativeLinks"] = [link for link in service.store.get_links(native_id)
        if (link["b"] if link["a"] == native_id else link["a"]) in neighbors]
    return result


def private_operation(project: str, operation: str, arguments: dict) -> dict:
    """Application operations outside model tool grants."""
    from .thinkgraph import validate_cognition
    project = project_id(project)
    native_id = str(arguments.get("nativeId") or "")
    if operation == "retire":
        with _lock:
            return get_service().retire(native_id, workspace=project,
                reason="Removed in ThinkGraph", actor="user")
    if operation == "delete_workspace":
        if arguments != {"confirmed": True}:
            raise ValueError("thinkgraph_workspace_delete_requires_confirmation")
        with _lock:
            return get_service().delete_workspace(project)
    result = inspect(project, native_id)
    if operation == "inspect":
        return result
    if "memory" not in result:
        raise ValueError("native_thinkgraph_question_required")
    native_id = result["memory"]["id"]
    if operation != "attach_answer":
        raise ValueError("thinkgraph_operation_unavailable")
    with _lock:
        service = get_service()
        record = service.store.get_memory(native_id)
        cognition = dict(record.metadata.get("cognition") or {})
        if cognition.get("memoryCategory") != "question":
            raise ValueError("native_thinkgraph_question_required")
        evidence = arguments["evidence"]
        refs = list(cognition.get("answerRefs", []))
        if evidence not in refs:
            refs.append(evidence)
        cognition.update(answerRefs=refs, questionStatus=arguments["status"])
        record.metadata = {**record.metadata, "cognition": validate_cognition(cognition, project)}
        service.store.add_memory(record)
        return inspect(project, native_id)


def projection(project: str, native_id: str | None = None) -> dict:
    service = get_service()
    project = project_id(project)
    # Engraphis supplies the scene. This adapter only adds display field aliases
    # and resolves evidence IDs returned by the engine.
    scene = service.graph_scene(workspace=project, level="complete", presentation="quality",
        include_memory_nodes=False, include_weak_cooccurrence=False)
    scene_member_ids = list(dict.fromkeys(
        member
        for node in scene["nodes"]
        for member in node.get("member_ids", [node["id"]])
    ))
    native_edges = {
        edge.id: edge for edge in service.store.neighbors(scene_member_ids)
    } if scene_member_ids else {}
    semantic_mass = {node["id"]: 0.0 for node in scene["nodes"]}
    for edge in scene["edges"]:
        edge_ids = edge.get("underlying_edge_ids") or [edge.get("id")]
        jev_edges = [
            native_edges[edge_id]
            for edge_id in edge_ids
            if edge_id in native_edges
            and isinstance(native_edges[edge_id].provenance, dict)
            and isinstance(native_edges[edge_id].provenance.get("jev"), dict)
        ]
        if not jev_edges:
            continue
        chosen = max(
            jev_edges,
            key=lambda item: float(item.provenance["jev"].get("relationship_strength") or 0.0),
        )
        jev = deepcopy(chosen.provenance["jev"])
        strength = max(0.0, min(1.0, float(jev["relationship_strength"])))
        edge.update({
            "relation": chosen.relation,
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
    # The engine's stored memory/entity incidences also cover isolated entities.
    # Hydrate these existing links; do not infer evidence from labels or text here.
    entity_members = {node["id"]: node.get("member_ids", [node["id"]]) for node in scene["nodes"]}
    incidences = service.store.list_memory_entities(entity_ids=list(dict.fromkeys(
        member for members in entity_members.values() for member in members)))
    entity_evidence = {node_id: list(dict.fromkeys(
        row["memory_id"] for row in incidences if row["entity_id"] in members))
        for node_id, members in entity_members.items()}
    evidence_groups = [edge.get("support_memory_ids", []) for edge in scene["edges"]]
    evidence_groups.extend(entity_evidence.values())
    for memory_ids in evidence_groups:
        for mid in memory_ids:
            if mid not in supporting:
                memory = inspect(project, mid)["memory"]
                supporting[mid] = {"id": mid, "title": memory["title"],
                    "summary": memory.get("summary") or memory["content"],
                    "provenance": memory.get("provenance", {}),
                    "metadata": memory.get("metadata", {}),
                    "validFrom": memory.get("valid_from"),
                    "validTo": memory.get("valid_to"),
                    "validToRecordedAt": memory.get("valid_to_recorded_at"),
                    "ingestedAt": memory.get("ingested_at"),
                    "expiredAt": memory.get("expired_at")}
                if native_id:
                    # Full text belongs to selection, not the initial graph download.
                    supporting[mid]["content"] = memory["content"]
    nodes = []
    for node in scene["nodes"]:
        # Node Thought display is owned by memory/entity incidence. Edge support
        # may include Notes belonging to the opposite endpoint and remains on the
        # edge inspector; it must not become this node's latest Thought.
        evidence_ids = list(dict.fromkeys(entity_evidence[node["id"]]))
        evidence_ids.sort(
            key=lambda memory_id: _newest_note_key(supporting[memory_id])
            if memory_id in supporting else (0.0, memory_id)
        )
        latest_thought_id = next((
            memory_id for memory_id in evidence_ids
            if memory_id in supporting
            and isinstance(supporting[memory_id].get("metadata"), dict)
            and isinstance(
                supporting[memory_id]["metadata"].get("thinkgraph_note"), dict
            )
        ), "")
        visible_evidence_ids = (
            [latest_thought_id] if latest_thought_id else evidence_ids[:1]
        )
        nodes.append({
            **node,
            "canonicalId": node["id"],
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
                    for memory_id in visible_evidence_ids
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
            "embedding": {"state": "ready" if service.stats(workspace=project).get("embedding", {}).get("ready") else "unavailable"},
            "runtime": {"engine": "engraphis", "version": "1.7.1"}}
