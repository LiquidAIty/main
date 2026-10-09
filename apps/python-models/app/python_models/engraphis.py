"""Engraphis-backed ThinkGraph service and exact read primitives.

Python rails owns one Engraphis service. Workspace binding comes from the
authenticated project; neither tool callers nor the browser choose another
database or tenant. Relationship admission, completed-pair settlement, Smart
operations, graph Focus, and presentation projection live with their direct
owners instead of this store seam.
"""
from __future__ import annotations

import atexit
from copy import deepcopy
from enum import Enum
import hashlib
import json
import math
from pathlib import Path
import re
import threading
from typing import Any

from engraphis.core.interfaces import MemoryType, SearchFilter

DATABASE = Path(__file__).resolve().parents[4] / "db" / "thinkgraph.sqlite"
MODEL = "local:sentence-transformers/all-MiniLM-L6-v2"
MODEL_REVISION = "1110a243fdf4706b3f48f1d95db1a4f5529b4d41"
_service = None
SERVICE_LOCK = threading.RLock()
THINKGRAPH_INTAKE_LOCK = threading.RLock()
THINK_INCIDENCE_KIND = "structured_extractor"


def project_id(value: str) -> str:
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9_-]+", value):
        raise ValueError("thinkgraph_project_id_invalid")
    return value


def get_service():
    global _service
    with SERVICE_LOCK:
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
    with SERVICE_LOCK:
        if _service is not None:
            _service.close()
            _service = None


atexit.register(close_engine)


def graph_revision(store: Any, workspace_id: str) -> int:
    row = store.conn.execute(
        "SELECT generation FROM graph_index_state WHERE workspace_id=?",
        (workspace_id,),
    ).fetchone()
    return int(row["generation"] if row is not None else 0)

def _observation_time(value: Any) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError, OverflowError):
        return 0.0
    return parsed if math.isfinite(parsed) else 0.0


def newest_think_sort_key(item: dict[str, Any]) -> tuple[float, str]:
    return (
        -_observation_time(item.get("ingested_at", item.get("ingestedAt"))),
        str(item.get("memory_id") or item.get("id") or ""),
    )

def _entity_row(store: Any, entity_id: str) -> dict[str, Any] | None:
    row = store.conn.execute(
        "SELECT id, name, etype, canonical_id FROM entities WHERE id=?",
        (entity_id,),
    ).fetchone()
    return dict(row) if row is not None else None


def canonical_entity_id(store: Any, entity_id: str) -> str:
    row = _entity_row(store, entity_id)
    return str(row.get("canonical_id") or row["id"]) if row else ""


def existing_entity_for_name(
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


def jev_edge_provenance(edge: Any) -> dict[str, Any] | None:
    provenance = edge.provenance if isinstance(edge.provenance, dict) else {}
    value = provenance.get("jev")
    return value if isinstance(value, dict) else None


def validated_think_metadata(memory: Any) -> dict[str, Any] | None:
    memory_type = (
        memory.mtype.value if isinstance(memory.mtype, Enum) else str(memory.mtype)
    )
    if memory_type != MemoryType.EPISODIC.value:
        return None
    metadata = memory.metadata if isinstance(memory.metadata, dict) else {}
    origin = metadata.get("thinkgraph_origin")
    if not isinstance(origin, dict) or origin.get("authority") != "thinkgraph":
        return None
    structured = metadata.get("structured_extraction")
    if not isinstance(structured, dict):
        return None
    value = structured.get("think")
    if not isinstance(value, dict):
        return None
    summary = value.get("summary")
    entities = value.get("entities", structured.get("entities"))
    relationships = value.get("relationships", structured.get("relations"))
    if (
        not isinstance(summary, str)
        or not summary.strip()
        or not isinstance(entities, list)
        or not entities
        or any(not isinstance(item, str) or not item.strip() for item in entities)
        or not isinstance(relationships, list)
        or not relationships
        or any(
            not isinstance(item, dict)
            or set(item) != {"source", "relation", "target"}
            or any(
                not isinstance(item[key], str) or not item[key].strip()
                for key in ("source", "relation", "target")
            )
            for item in relationships
        )
    ):
        return None
    return {
        "summary": summary,
        "entities": deepcopy(entities),
        "relationships": deepcopy(relationships),
    }


def public_think_metadata(value: Any) -> dict[str, Any]:
    """Return Engraphis Think metadata without a retired per-Think judgment."""
    metadata = deepcopy(value) if isinstance(value, dict) else {}
    metadata.pop("needs_evidence", None)
    return metadata


def _bounded_snapshot_entities(
    store: Any,
    *,
    workspace_id: str,
    ids: list[str],
    flt: SearchFilter,
    edge_limit: int,
) -> tuple[
    list[dict[str, Any]], list[Any], dict[str, str], bool, bool,
]:
    edge_source_limit = max(128, edge_limit * 4)
    raw_edges = [] if edge_limit <= 0 else list(
        store.neighbors(ids, flt=flt, limit=edge_source_limit)
    )
    eligible_edges = sorted([
        edge for edge in raw_edges if jev_edge_provenance(edge) is not None
    ], key=lambda edge: (
        str(edge.id), str(edge.src), str(edge.dst), str(edge.relation),
    ))
    edges = eligible_edges[:edge_limit]
    edge_source_limit_hit = len(raw_edges) >= edge_source_limit
    edge_result_limit_hit = len(eligible_edges) > edge_limit
    neighbor_ids = list(dict.fromkeys([
        *ids,
        *(canonical_entity_id(store, edge.src) or edge.src for edge in edges),
        *(canonical_entity_id(store, edge.dst) or edge.dst for edge in edges),
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
    return nodes, edges, names, edge_source_limit_hit, edge_result_limit_hit


def _bounded_snapshot_thinks(
    store: Any,
    *,
    workspace_id: str,
    ids: list[str],
    flt: SearchFilter,
    think_limit: int,
) -> tuple[list[dict[str, Any]], bool, bool]:
    if think_limit <= 0:
        return [], False, False
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
    thinks: list[dict[str, Any]] = []
    for row in incidences:
        memory = memories.get(str(row["memory_id"]))
        if memory is None:
            continue
        think = validated_think_metadata(memory)
        if think is None or row.get("source_kind") != THINK_INCIDENCE_KIND:
            continue
        thinks.append({
            "entity_id": canonical_by_member.get(
                str(row["entity_id"]), str(row["entity_id"])
            ),
            "memory_id": memory.id,
            "title": memory.title,
            "content": memory.content,
            "summary": think["summary"],
            "keywords": list(memory.keywords)[:16],
            "relations": deepcopy(think["relationships"]),
            "valid_from": memory.valid_from,
            "valid_to": memory.valid_to,
            "valid_to_recorded_at": memory.valid_to_recorded_at,
            "ingested_at": memory.ingested_at,
            "expired_at": memory.expired_at,
        })
    thinks = sorted(thinks, key=newest_think_sort_key)
    think_result_limit_hit = len(thinks) > think_limit
    return thinks[:think_limit], think_source_limit_hit, think_result_limit_hit


def _bounded_snapshot_incident_edges(
    store: Any,
    edges: list[Any],
    names: dict[str, str],
) -> list[dict[str, Any]]:
    incident_edges: list[dict[str, Any]] = []
    for edge in edges:
        jev = jev_edge_provenance(edge)
        if jev is None:
            continue
        source_id = canonical_entity_id(store, edge.src) or edge.src
        target_id = canonical_entity_id(store, edge.dst) or edge.dst
        incident_edges.append({
            "id": edge.id,
            "source_id": source_id,
            "source_name": names.get(source_id, edge.src),
            "target_id": target_id,
            "target_name": names.get(target_id, edge.dst),
            "relation": edge.relation,
            "relationship_strength": jev.get("relationship_strength", edge.weight),
            "label_confidence": jev.get("label_confidence"),
            "distribution": deepcopy(jev.get("distribution") or {}),
        })
    return incident_edges


def bounded_graph_snapshot(
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
        canonical_id = canonical_entity_id(store, str(value)) if value else ""
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
    (
        nodes, edges, names, edge_source_limit_hit, edge_result_limit_hit,
    ) = _bounded_snapshot_entities(
        store,
        workspace_id=workspace_id,
        ids=ids,
        flt=flt,
        edge_limit=edge_limit,
    )
    thinks, think_source_limit_hit, think_result_limit_hit = _bounded_snapshot_thinks(
        store,
        workspace_id=workspace_id,
        ids=ids,
        flt=flt,
        think_limit=think_limit,
    )
    incident_edges = _bounded_snapshot_incident_edges(store, edges, names)
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


def latest_endpoint_think(
    store: Any,
    *,
    workspace_id: str,
    canonical_id: str,
) -> dict[str, Any] | None:
    """Read exactly one newest direct ThinkGraph Think for one endpoint."""
    values = endpoint_thinks(
        store,
        workspace_id=workspace_id,
        canonical_id=canonical_id,
        limit=1,
    )
    return values[0] if values else None


def endpoint_thinks(
    store: Any,
    *,
    workspace_id: str,
    canonical_id: str,
    limit: int,
) -> list[dict[str, Any]]:
    """Read newest Thinks through Engraphis's own memory/entity incidence."""

    if not isinstance(limit, int) or isinstance(limit, bool) or not 1 <= limit <= 24:
        raise ValueError("think_endpoint_limit_invalid")
    canonical_id = canonical_entity_id(store, canonical_id) or canonical_id
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
        "AND me.source_kind=? "
        "AND me.valid_to IS NULL AND me.expired_at IS NULL "
        "AND m.valid_to IS NULL AND m.expired_at IS NULL "
        "ORDER BY COALESCE(m.ingested_at,me.ingested_at,0) DESC, m.id DESC "
        "LIMIT ?",
        (workspace_id, *member_ids, THINK_INCIDENCE_KIND, limit),
    ).fetchall()
    entity = _entity_row(store, canonical_id) or {}
    result: list[dict[str, Any]] = []
    for row in rows:
        memory = store.get_memory(str(row["id"]))
        if memory is None:
            continue
        think = validated_think_metadata(memory)
        if think is None:
            continue
        result.append({
            "entity_id": canonical_id,
            "canonical_name": str(entity.get("name") or ""),
            "memory_id": memory.id,
            "title": memory.title,
            "content": memory.content,
            "summary": think["summary"],
            "keywords": list(memory.keywords)[:16],
            "relations": deepcopy(think["relationships"]),
            "ingested_at": memory.ingested_at,
            "valid_from": memory.valid_from,
            "valid_to": memory.valid_to,
        })
    return result


def read_subject_directory(project: str) -> dict[str, Any]:
    """Return every canonical project subject header without Think bodies or edges."""

    service = get_service()
    project = project_id(project)
    with SERVICE_LOCK:
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
            "revision": f"{graph_revision(service.store, workspace_id)}:{revision}",
            "subjects": subjects,
        }
