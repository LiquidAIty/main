"""Bounded, read-only context projection across the three graph authorities.

Unified is a projection, never a fourth graph.  Python owns selection, canonical
identity, lineage and placement; the UI and agent runtime receive the same
serialized Graph View records from this payload.
"""
from __future__ import annotations

from dataclasses import dataclass
from copy import deepcopy
import hashlib
import json
import math
import os
import time
import threading
from typing import Any, Callable
from urllib.parse import urlencode
from urllib.request import urlopen

from app.python_models.thinkgraph_engraphis import ThinkGraphEngraphis, get_thinkgraph


AUTHORITY = {
    "thinkgraph": {"label": "ThinkGraph", "color": "#4AE2DF", "z": 120.0},
    "knowgraph": {"label": "KnowGraph", "color": "#B8C8D2", "z": 0.0},
    "codegraph": {"label": "CodeGraph", "color": "#5EA8FF", "z": -120.0},
}
_INFLIGHT: dict[str, dict[str, Any]] = {}
_INFLIGHT_LOCK = threading.Lock()
SELECTABLE_GRAPH_VIEW_STATUSES = {"candidate", "attached", "active", "returned"}
MAX_SELECTED_GRAPH_VIEWS = 6
MAX_REASONING_STATE_RECORDS = 48
MAX_GRAPH_EVIDENCE_RECORDS = 64
MAX_GRAPH_EVIDENCE_RELATIONSHIPS = 96
MAX_GRAPH_VIEW_PROVENANCE_REFS = 24
MAX_GRAPH_CONTEXT_CHARACTERS = 32_000
MAX_GRAPH_CONTEXT_FIELD_CHARACTERS = 1_000


def _bounded(value: int, low: int, high: int) -> int:
    return max(low, min(high, int(value)))


def _get_json(path: str, params: dict[str, Any], *, backend_url: str | None = None) -> dict[str, Any]:
    base = (backend_url or os.getenv("LIQUIDAITY_BACKEND_URL") or "http://127.0.0.1:4000").rstrip("/")
    with urlopen(f"{base}{path}?{urlencode(params, doseq=True)}", timeout=90) as response:  # noqa: S310 - configured local backend
        return json.loads(response.read().decode("utf-8"))


def _get_codegraph_json(path: str, params: dict[str, Any]) -> dict[str, Any]:
    return _get_json(path, params, backend_url=os.getenv("CODEGRAPH_UI_URL") or "http://127.0.0.1:9749")


def _refs(value: Any) -> list[str]:
    if isinstance(value, str):
        return [part for part in value.replace(",", " ").replace("|", " ").split() if part]
    if isinstance(value, list):
        return [ref for item in value for ref in _refs(item)]
    return []


def _position(authority: str, canonical_id: str, cluster: str) -> dict[str, float]:
    """Stable authority-region placement derived only from canonical identity."""
    seed = hashlib.sha256(f"{authority}|{cluster}|{canonical_id}".encode()).digest()
    angle = int.from_bytes(seed[:8], "big") / (2**64) * math.tau
    radius = 28.0 + (int.from_bytes(seed[8:12], "big") / (2**32)) * 155.0
    cluster_seed = hashlib.sha256(f"{authority}|{cluster}".encode()).digest()
    cluster_angle = int.from_bytes(cluster_seed[:8], "big") / (2**64) * math.tau
    cluster_radius = 45.0
    return {
        "x": math.cos(cluster_angle) * cluster_radius + math.cos(angle) * radius,
        "y": math.sin(cluster_angle) * cluster_radius + math.sin(angle) * radius,
        "z": AUTHORITY[authority]["z"] + ((seed[12] % 9) - 4) * 2.0,
    }


@dataclass(frozen=True)
class UnifiedContextRequest:
    project_id: str
    conversation_id: str
    role: str = "main_chat"
    active_view_id: str | None = None
    knowgraph_scope: str | None = None
    think_limit: int = 5000
    know_limit: int = 50000
    code_limit: int = 50000


def _graph_view_identity(view: dict[str, Any]) -> dict[str, Any]:
    """Expose persisted identity and lifecycle without transporting membership."""
    return {
        key: view.get(key)
        for key in (
            "schemaVersion",
            "viewId",
            "authority",
            "status",
            "projectId",
            "conversationId",
            "goalId",
            "episodeId",
            "jobId",
            "runId",
            "invocationId",
            "producingRole",
            "receivingRole",
            "parentViewId",
            "omittedNeighborCount",
            "createdAt",
            "updatedAt",
        )
        if view.get(key) is not None
    } | {
        "recordCount": len(view.get("records") or []),
        "relationshipCount": len(view.get("includedRelationships") or []),
    }


def graph_view_identities(views: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [_graph_view_identity(view) for view in views]


def select_persisted_graph_views(
    persisted: list[dict[str, Any]],
    requested_view_ids: list[str],
    *,
    project_id: str,
    conversation_id: str,
    receiving_roles: set[str],
) -> list[dict[str, Any]]:
    """Resolve an explicit ordered selection from persisted Graph Views.

    The caller carries identities only. Python enforces scope, target role, and
    lifecycle before any full view is rendered for a model.
    """
    requested = [str(view_id).strip() for view_id in requested_view_ids if str(view_id).strip()]
    if len(requested) > MAX_SELECTED_GRAPH_VIEWS:
        raise ValueError(f"graph_view_selection_limit_exceeded: {MAX_SELECTED_GRAPH_VIEWS}")
    if len(set(requested)) != len(requested):
        raise ValueError("graph_view_ids_duplicate")
    by_id = {str(view.get("viewId") or ""): view for view in persisted}
    missing = [view_id for view_id in requested if view_id not in by_id]
    if missing:
        raise ValueError(f"graph_view_unknown: {', '.join(missing)}")
    selected: list[dict[str, Any]] = []
    for view_id in requested:
        view = by_id[view_id]
        if (
            str(view.get("projectId") or "") != project_id
            or str(view.get("conversationId") or "") != conversation_id
        ):
            raise ValueError(f"graph_view_scope_mismatch: {view_id}")
        if str(view.get("receivingRole") or "") not in receiving_roles:
            raise ValueError(f"graph_view_role_mismatch: {view_id}")
        status = str(view.get("status") or "")
        if status not in SELECTABLE_GRAPH_VIEW_STATUSES:
            raise ValueError(f"graph_view_lifecycle_invalid: {view_id} ({status or 'missing'})")
        selected.append(view)
    return selected


def transition_persisted_graph_views(
    graph: ThinkGraphEngraphis,
    *,
    project_id: str,
    conversation_id: str,
    view_ids: list[str],
    status: str,
    invocation_id: str | None = None,
    runtime: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    """Transition exact persisted views without transporting their contents."""
    if status not in {"active", "consumed", "failed"}:
        raise ValueError(f"graph_view_transition_status_invalid: {status}")
    persisted = list(graph.graph_views(project_id, conversation_id).get("views") or [])
    selected = select_persisted_graph_views(
        persisted,
        view_ids,
        project_id=project_id,
        conversation_id=conversation_id,
        receiving_roles={"main_chat", "coder"},
    )
    updated: list[dict[str, Any]] = []
    for view in selected:
        source_status = str(view.get("status") or "")
        if status in {"consumed", "failed"} and source_status != "active":
            raise ValueError(
                f"graph_view_transition_invalid: {view.get('viewId')} ({source_status}->{status})"
            )
        next_view = {
            **view,
            "status": status,
            "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
        if invocation_id:
            next_view["invocationId"] = invocation_id
        if runtime is not None:
            next_view["runtime"] = runtime
        graph.persist_graph_view(next_view)
        updated.append(_graph_view_identity(next_view))
    return updated


def _build_unified_context(
    request: UnifiedContextRequest,
    *,
    graph: ThinkGraphEngraphis | None = None,
    read_json: Callable[[str, dict[str, Any]], dict[str, Any]] = _get_json,
    read_codegraph_json: Callable[[str, dict[str, Any]], dict[str, Any]] = _get_codegraph_json,
) -> dict[str, Any]:
    if not request.project_id.strip() or not request.conversation_id.strip():
        raise ValueError("project_id_and_conversation_id_required")
    graph = graph or get_thinkgraph()
    limits = {
        "thinkgraph": _bounded(request.think_limit, 1, 5000),
        "knowgraph": _bounded(request.know_limit, 1, 50000),
        "codegraph": _bounded(request.code_limit, 1, 50000),
    }
    warnings: list[dict[str, str]] = []
    started = time.perf_counter()
    think_started = time.perf_counter()
    think = graph.projection(request.project_id, limit=limits["thinkgraph"])
    think_ms = (time.perf_counter() - think_started) * 1000
    persisted_graph_views = list(
        graph.graph_views(request.project_id, request.conversation_id).get("views") or []
    )
    selected_full_views = select_persisted_graph_views(
        persisted_graph_views,
        [request.active_view_id] if request.active_view_id else [],
        project_id=request.project_id,
        conversation_id=request.conversation_id,
        receiving_roles={request.role},
    )
    graph_views = graph_view_identities(persisted_graph_views)
    selected_views = graph_view_identities(selected_full_views)
    selected_view_id = request.active_view_id
    know_started = time.perf_counter()
    try:
        graph_payload = read_json(
            "/api/knowgraph/graph",
            {"projectId": request.knowgraph_scope or request.project_id},
        )
        know = {
            "nodes": list(graph_payload.get("nodes") or []),
            "relationships": list(
                graph_payload.get("relationships") or []
            ),
        }
    except Exception as error:  # one authority may fail without fabricating records
        know = {"nodes": [], "relationships": []}
        warnings.append({"authority": "knowgraph", "code": "authority_unavailable", "detail": str(error)})
    know_ms = (time.perf_counter() - know_started) * 1000
    code_started = time.perf_counter()
    try:
        code_project = str(
            os.getenv("LIQUIDAITY_CODEGRAPH_PROJECT") or "C-Projects-main"
        ).strip()
        if not code_project:
            raise ValueError("codegraph_project_unavailable")
        code = read_codegraph_json("/api/layout", {"project": code_project, "max_nodes": limits["codegraph"]})
        code["projectId"] = code_project
    except Exception as error:
        code = {"nodes": [], "edges": [], "projectId": None}
        warnings.append({"authority": "codegraph", "code": "authority_unavailable", "detail": str(error)})
    code_ms = (time.perf_counter() - code_started) * 1000

    raw_nodes: dict[str, list[dict[str, Any]]] = {
        "thinkgraph": list(think.get("nodes") or []),
        "knowgraph": list(know.get("nodes") or []),
        "codegraph": list(code.get("nodes") or []),
    }
    raw_edges = {
        "thinkgraph": list(think.get("edges") or []),
        "knowgraph": list(know.get("relationships") or []),
        "codegraph": list(code.get("edges") or []),
    }

    chosen = raw_nodes

    nodes: list[dict[str, Any]] = []
    numeric_by_key: dict[tuple[str, str], int] = {}
    pending_refs: dict[tuple[int, str, str], None] = {}
    for authority in AUTHORITY:
        for source in chosen[authority]:
            canonical = str(source.get("source_id") or source.get("canonicalId") or (source.get("properties") or {}).get("qualified_name") or source.get("name") or source.get("id") or "")
            props = dict(source.get("properties") or {})
            if authority == "knowgraph":
                for field in ("community_id", "frequency", "influence", "bridge_importance", "supporting_statement_ids", "source_document_refs"):
                    if source.get(field) is not None:
                        props.setdefault(field, source.get(field))
            cluster = str(props.get("cluster") or source.get("type") or source.get("label") or "records")
            numeric = len(nodes) + 1
            numeric_by_key[(authority, canonical)] = numeric
            numeric_by_key[(authority, str(source.get("id") or canonical))] = numeric
            if authority == "codegraph":
                numeric_by_key[(authority, f"code:{canonical}")] = numeric
            for key, target_authority in (("knowgraph_ref", "knowgraph"), ("knowGraphRef", "knowgraph"), ("codegraph_ref", "codegraph"), ("codeGraphRef", "codegraph"), ("secondary_ref", "codegraph")):
                for ref in _refs(props.get(key) if key in props else source.get(key)):
                    pending_refs.setdefault((numeric, target_authority, ref), None)
            record_type = str(source.get("type") or source.get("kind") or source.get("label") or "Record")
            supplied_position = all(isinstance(source.get(axis), (int, float)) for axis in ("x", "y", "z"))
            position = ({axis: float(source[axis]) for axis in ("x", "y", "z")} if supplied_position else _position(authority, canonical, cluster))
            nodes.append({
                "id": numeric,
                **position,
                "label": record_type,
                "name": str(source.get("title") or source.get("name") or source.get("label") or canonical),
                "size": float(source.get("size") or 5.0),
                "color": str(source.get("color") or AUTHORITY[authority]["color"]),
                "authority": authority,
                "source_id": canonical,
                "file_path": source.get("file_path"),
                "properties": props,
                "provenance": source.get("provenance") or {},
                "project_id": source.get("projectId") or request.project_id,
                "conversation_id": source.get("conversationId") or request.conversation_id,
                "run_id": source.get("runId") or props.get("run_id"),
                "status": props.get("status") or source.get("currentState"),
                "trust": source.get("trustState") or props.get("trust_state"),
                "source_graph": AUTHORITY[authority]["label"],
                "cluster": cluster,
            })

    cross_started = time.perf_counter()
    edges: list[dict[str, Any]] = []
    for authority in AUTHORITY:
        for raw in raw_edges[authority]:
            source_ref = str(raw.get("source") or raw.get("from") or "")
            target_ref = str(raw.get("target") or raw.get("to") or "")
            source = numeric_by_key.get((authority, source_ref))
            target = numeric_by_key.get((authority, target_ref))
            if source and target:
                raw_edge_id = str(raw.get("id") or f"{source_ref}:{target_ref}")
                edges.append({"id": f"{authority}:{raw_edge_id}", "source": source, "target": target, "type": str(raw.get("predicate") or raw.get("type") or "RELATED_TO"), "cross_authority": False})
    missing_refs: set[tuple[str, str]] = set()
    for source, target_authority, ref in pending_refs:
        target = numeric_by_key.get((target_authority, ref))
        if target:
            edges.append({"id": f"cross:{source}:{target}:{ref}", "source": source, "target": target, "type": "REFERENCES", "cross_authority": True})
        else:
            missing_refs.add((target_authority, ref))
    warnings.extend({"authority": authority, "code": "referenced_record_not_in_projection", "detail": ref} for authority, ref in sorted(missing_refs))
    for authority in AUTHORITY:
        if not chosen[authority]:
            warnings.append({"authority": authority, "code": "empty_authority_view", "detail": f"The {authority} authority returned no records for this configuration."})
    cross_ms = (time.perf_counter() - cross_started) * 1000

    serialization_started = time.perf_counter()
    configuration = {
        "projectId": request.project_id,
        "conversationId": request.conversation_id,
        "role": request.role,
        "activeGraphViewId": selected_view_id,
        "knowgraphScope": request.knowgraph_scope,
        "limits": limits,
    }
    configuration_hash = hashlib.sha256(json.dumps(configuration, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    content_identity = {
        "configurationHash": configuration_hash,
        "selectedGraphViewIds": [view.get("viewId") for view in selected_views],
        "nodes": [(node["authority"], node["source_id"]) for node in nodes],
        "edges": [(edge["source"], edge["target"], edge["type"], edge["cross_authority"]) for edge in edges],
    }
    content_hash = hashlib.sha256(json.dumps(content_identity, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    projection_id = f"unified:{content_hash[:24]}"
    knowgraph_scope_id = str(know.get("resolved_project_id") or request.knowgraph_scope or "").strip() or None
    codegraph_project_id = str(code.get("projectId") or "").strip() or None
    identity = {
        "applicationProjectId": request.project_id,
        "thinkGraphWorkspaceId": request.project_id,
        "knowGraphScopeId": knowgraph_scope_id,
        "codeGraphProjectId": codegraph_project_id,
        "conversationId": request.conversation_id,
        "activeGraphViewId": selected_view_id,
        "receivingRole": request.role,
        "projectionId": projection_id,
    }
    for mapping, value in identity.items():
        if value is None:
            warnings.append({"authority": "identity", "code": "missing_authority_mapping", "detail": mapping})
    lifecycle = {
        "available": [view["viewId"] for view in graph_views],
        "selected": [view["viewId"] for view in selected_views],
        "attached": [view["viewId"] for view in graph_views if view.get("status") in {"attached", "active", "consumed", "returned"}],
        "delivered": [],
        "consumed": [view["viewId"] for view in graph_views if view["status"] == "consumed"],
        "returned": [view["viewId"] for view in graph_views if view["status"] == "returned"],
        "superseded": [view["viewId"] for view in graph_views if view["status"] == "superseded"],
    }
    serialization_ms = (time.perf_counter() - serialization_started) * 1000
    result = {
        "schemaVersion": "unified.context.v1",
        "authority": "bounded_projection",
        "projectId": request.project_id,
        "conversationId": request.conversation_id,
        "receivingRole": request.role,
        "projectionId": projection_id,
        "identity": identity,
        "configurationHash": configuration_hash,
        "contentHash": content_hash,
        "activeGraphViewId": selected_view_id,
        "graphViews": selected_views,
        "availableGraphViews": graph_views,
        "authorityGraphViews": selected_views,
        "lifecycle": lifecycle,
        "nodes": nodes,
        "edges": edges,
        "regions": [{"id": key, **value} for key, value in AUTHORITY.items()],
        "counts": {
            "available": {key: len(raw_nodes[key]) for key in AUTHORITY},
            "selected": {key: len(chosen[key]) for key in AUTHORITY},
            "nodes": len(nodes),
            "edges": len(edges),
            "crossAuthorityEdges": sum(1 for edge in edges if edge["cross_authority"]),
        },
        "limits": limits,
        "warnings": warnings,
        "cache": {"reused": False, "freshness": "resolved_from_authorities", "ageSeconds": 0.0},
        "timingsMs": {
            "thinkgraph": round(think_ms, 3),
            "knowgraph": round(know_ms, 3),
            "codegraph": round(code_ms, 3),
            "crossAuthority": round(cross_ms, 3),
            "serialization": round(serialization_ms, 3),
            "total": round((time.perf_counter() - started) * 1000, 3),
        },
    }
    return result


def build_unified_context(
    request: UnifiedContextRequest,
    *,
    graph: ThinkGraphEngraphis | None = None,
    read_json: Callable[[str, dict[str, Any]], dict[str, Any]] = _get_json,
    read_codegraph_json: Callable[[str, dict[str, Any]], dict[str, Any]] = _get_codegraph_json,
) -> dict[str, Any]:
    """Single-flight authority resolution with honest immutable replay metadata."""
    request_identity = {
        "projectId": request.project_id,
        "conversationId": request.conversation_id,
        "role": request.role,
        "activeGraphViewId": request.active_view_id,
        "knowgraphScope": request.knowgraph_scope,
        "thinkLimit": request.think_limit,
        "knowLimit": request.know_limit,
        "codeLimit": request.code_limit,
    }
    key = hashlib.sha256(json.dumps(request_identity, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    with _INFLIGHT_LOCK:
        state = _INFLIGHT.get(key)
        if state is None:
            state = {"event": threading.Event(), "result": None, "error": None, "followers": 0}
            _INFLIGHT[key] = state
            leader = True
        else:
            state["followers"] += 1
            leader = False
    if not leader:
        if not state["event"].wait(timeout=120):
            raise TimeoutError("unified_context_join_timeout")
        if state["error"] is not None:
            raise RuntimeError(str(state["error"]))
        joined = deepcopy(state["result"])
        joined["cache"] = {"reused": True, "freshness": "joined_inflight", "ageSeconds": 0.0}
        joined["timingsMs"] = {**joined.get("timingsMs", {}), "joinedInflight": 0.0}
        return joined
    try:
        result = _build_unified_context(
            request,
            graph=graph,
            read_json=read_json,
            read_codegraph_json=read_codegraph_json,
        )
        state["result"] = deepcopy(result)
        return result
    except Exception as error:
        state["error"] = error
        raise
    finally:
        state["event"].set()
        # Followers already hold this state object. Remove the registry entry now
        # so only genuinely overlapping requests join this authority resolution.
        with _INFLIGHT_LOCK:
            if _INFLIGHT.get(key) is state:
                _INFLIGHT.pop(key, None)


def build_graph_object_context(
    project_id: str,
    conversation_id: str,
    references: list[dict[str, Any]],
    *,
    graph: ThinkGraphEngraphis | None = None,
    read_json: Callable[[str, dict[str, Any]], dict[str, Any]] = _get_json,
    read_codegraph_json: Callable[[str, dict[str, Any]], dict[str, Any]] = _get_codegraph_json,
) -> dict[str, Any]:
    """Resolve compact object identities against the current project authorities.

    The caller supplies identity only. Membership, properties, relationships,
    provenance, and stale-state checks are resolved from the canonical projection.
    """
    if not project_id.strip() or not conversation_id.strip():
        raise ValueError("project_id_and_conversation_id_required")
    if not references or len(references) > 5:
        raise ValueError("selected_graph_object_refs_must_contain_1_to_5_items")
    projection = build_unified_context(
        UnifiedContextRequest(project_id=project_id, conversation_id=conversation_id, role="main_chat"),
        graph=graph,
        read_json=read_json,
        read_codegraph_json=read_codegraph_json,
    )
    nodes_by_identity = {
        (str(node.get("authority")), str(node.get("source_id"))): node
        for node in projection.get("nodes") or []
    }
    nodes_by_id = {int(node["id"]): node for node in projection.get("nodes") or []}
    edges = list(projection.get("edges") or [])
    seen: set[tuple[str, str]] = set()
    resolved: list[dict[str, Any]] = []
    sections: list[str] = ["[LIQUIDAITY_SELECTED_PROJECT_OBJECTS]"]
    for reference in references:
        authority = str(reference.get("authority") or "").strip()
        canonical_id = str(reference.get("canonicalId") or "").strip()
        selected_through = str(reference.get("selectedThrough") or "").strip()
        source_authority = str(reference.get("sourceAuthority") or "").strip()
        projection_id = str(reference.get("projectionId") or "").strip()
        if authority not in AUTHORITY or selected_through not in {*AUTHORITY, "unified"} or not canonical_id:
            raise ValueError("selected_graph_object_ref_invalid")
        if selected_through == "unified" and source_authority != authority:
            raise ValueError("unified_source_authority_required")
        if projection_id and projection_id != projection.get("projectionId"):
            raise ValueError(f"graph_object_projection_superseded:{projection_id}")
        identity = (authority, canonical_id)
        if identity in seen:
            continue
        seen.add(identity)
        node = nodes_by_identity.get(identity)
        if node is None:
            raise ValueError(f"graph_object_not_visible:{authority}:{canonical_id}")
        direct_edges = [edge for edge in edges if edge.get("source") == node["id"] or edge.get("target") == node["id"]][:8]
        relationships: list[dict[str, str]] = []
        for edge in direct_edges:
            other_id = int(edge["target"] if edge.get("source") == node["id"] else edge["source"])
            other = nodes_by_id.get(other_id)
            if not other:
                continue
            relationships.append({
                "type": str(edge.get("type") or "RELATED_TO"),
                "authority": str(other.get("authority") or ""),
                "canonicalId": str(other.get("source_id") or ""),
                "label": _flat(other.get("name")),
            })
        provenance = node.get("provenance") if isinstance(node.get("provenance"), dict) else {}
        properties = node.get("properties") if isinstance(node.get("properties"), dict) else {}
        provenance_refs = []
        for value in [
            *provenance.values(),
            properties.get("source_document_refs"),
            properties.get("supporting_statement_ids"),
            node.get("file_path"),
        ]:
            for ref in _refs(value):
                if ref not in provenance_refs:
                    provenance_refs.append(ref)
        record = {
            "authority": authority,
            "canonicalId": canonical_id,
            "type": str(node.get("label") or "Record"),
            "label": _flat(node.get("name")),
            "status": node.get("status"),
            "trust": node.get("trust"),
            "relationships": relationships,
            "provenanceRefs": provenance_refs[:8],
        }
        resolved.append(record)
        sections.append(f"{AUTHORITY[authority]['label']} {record['type']} — {canonical_id}")
        sections.append(f"- label: {record['label']}")
        if record["status"]:
            sections.append(f"- status: {_flat(record['status'])}")
        if record["trust"]:
            sections.append(f"- trust: {_flat(record['trust'])}")
        for relationship in relationships:
            sections.append(
                f"- {relationship['type']} -> {relationship['label']} "
                f"({relationship['authority']}:{relationship['canonicalId']})"
            )
        if provenance_refs:
            sections.append(f"- provenance: {', '.join(provenance_refs[:8])}")
    text = "\n".join(sections)
    return {
        "schemaVersion": "graph-object-context.v1",
        "projectId": project_id,
        "conversationId": conversation_id,
        "modelContext": text,
        "resolved": resolved,
        "measurements": {
            "objects": len(resolved),
            "relationships": sum(len(record["relationships"]) for record in resolved),
            "characters": len(text),
            "estimatedTokens": max(1, math.ceil(len(text) / 4)),
        },
    }


# ---------------------------------------------------------------------------
# Compact model representation: the text a model invocation consumes, derived
# deterministically from the SAME projection the Unified surface renders.
# The projection decides membership; this layer only renders that membership
# efficiently. The persisted Graph View is already a bounded selection; this
# final doorway additionally fails closed if its aggregate evidence or text
# exceeds the provider-bound limits. Repeated repository evidence is identified
# by normalized file identity plus source range, not by display-text equality.
# ---------------------------------------------------------------------------
_REASONING_STATE_TYPES = ("Goal", "Task", "Decision", "Question", "RunRecord", "Finding")


def _flat(text: Any) -> str:
    return " ".join(str(text or "").split())


def _estimated_tokens(text: str) -> int:
    return max(1, math.ceil(len(text) / 4)) if text else 0


def _bounded_field(value: Any, *, field: str) -> str:
    text = _flat(value)
    if len(text) > MAX_GRAPH_CONTEXT_FIELD_CHARACTERS:
        raise ValueError(
            f"graph_context_field_limit_exceeded: {field} "
            f"({len(text)}>{MAX_GRAPH_CONTEXT_FIELD_CHARACTERS})"
        )
    return text


def _normalized_file_range(record: dict[str, Any]) -> tuple[str, str] | None:
    """Return a stable repository-evidence identity when the record has one."""
    properties = record.get("properties")
    sources = [record, properties if isinstance(properties, dict) else {}]
    file_value: Any = None
    for source in sources:
        for key in ("filePath", "file_path", "sourcePath", "source_path", "file", "path"):
            if source.get(key):
                file_value = source[key]
                break
        if file_value:
            break
    if not file_value:
        return None
    normalized_file = str(file_value).strip().replace("\\", "/")
    while "//" in normalized_file:
        normalized_file = normalized_file.replace("//", "/")
    normalized_file = normalized_file.casefold()

    range_value: Any = None
    for source in sources:
        for key in ("sourceRange", "source_range", "range"):
            if source.get(key) is not None:
                range_value = source[key]
                break
        if range_value is not None:
            break
    if isinstance(range_value, dict):
        range_value = json.dumps(range_value, sort_keys=True, separators=(",", ":"))
    elif range_value is None:
        start = next(
            (
                source.get(key)
                for source in sources
                for key in ("startLine", "start_line", "lineStart", "line_start")
                if source.get(key) is not None
            ),
            "",
        )
        end = next(
            (
                source.get(key)
                for source in sources
                for key in ("endLine", "end_line", "lineEnd", "line_end")
                if source.get(key) is not None
            ),
            start,
        )
        range_value = f"{start}:{end}" if start != "" else ""
    return normalized_file, _flat(range_value)


def _new_render_state() -> dict[str, Any]:
    return {
        "recordCount": 0,
        "relationshipCount": 0,
        "seenFileRanges": set(),
        "seenFiles": set(),
        "duplicateFileRangeCount": 0,
    }


def _render_view_lines(view: dict[str, Any], state: dict[str, Any]) -> list[str]:
    """Compact per-view lines — the ONE serialization of a persisted Graph View
    for model delivery, shared by the doorway and model-context renderers."""
    lines: list[str] = []
    omitted = int(view.get("omittedNeighborCount") or 0)
    records = list(view.get("records") or [])
    relationships = list(view.get("includedRelationships") or [])
    lines.append(
        f"view: {view.get('viewId')} | authority: {view.get('authority')} | project: {view.get('projectId')} | "
        f"conversation: {view.get('conversationId')} | status: {view.get('status')} | records: {len(records)}"
        + (f" ({omitted} more available beyond this view)" if omitted else "")
    )
    if _flat(view.get("query")):
        lines.append(f"query: {_bounded_field(view.get('query'), field='query')}")
    for record in records:
        file_range = _normalized_file_range(record)
        if file_range is not None:
            state["seenFiles"].add(file_range[0])
            if file_range in state["seenFileRanges"]:
                state["duplicateFileRangeCount"] += 1
                continue
            state["seenFileRanges"].add(file_range)
        state["recordCount"] += 1
        if state["recordCount"] > MAX_GRAPH_EVIDENCE_RECORDS:
            raise ValueError(
                "graph_context_record_limit_exceeded: "
                f"{state['recordCount']}>{MAX_GRAPH_EVIDENCE_RECORDS}"
            )
        canonical = str(record.get("canonicalId") or "")
        summary = _bounded_field(record.get("summary") or "", field="record.summary")
        lines.append(f"- {summary} ({canonical})" if summary else f"- ({canonical})")
    for relationship in relationships:
        state["relationshipCount"] += 1
        if state["relationshipCount"] > MAX_GRAPH_EVIDENCE_RELATIONSHIPS:
            raise ValueError(
                "graph_context_relationship_limit_exceeded: "
                f"{state['relationshipCount']}>{MAX_GRAPH_EVIDENCE_RELATIONSHIPS}"
            )
        lines.append(
            f"- {relationship.get('source')} -{relationship.get('type') or 'RELATED_TO'}-> {relationship.get('target')}"
        )
    refs = sorted({_flat(ref) for ref in (view.get("provenanceRefs") or []) if _flat(ref)})
    if len(refs) > MAX_GRAPH_VIEW_PROVENANCE_REFS:
        raise ValueError(
            "graph_context_provenance_limit_exceeded: "
            f"{len(refs)}>{MAX_GRAPH_VIEW_PROVENANCE_REFS}"
        )
    if refs:
        lines.append(
            "provenance: "
            + "; ".join(_bounded_field(ref, field="provenanceRef") for ref in refs)
        )
    return lines


def render_model_context(projection: dict[str, Any], role_views: list[dict[str, Any]]) -> dict[str, Any]:
    """Bounded, target-specific model text + per-section token counts.

    Membership comes from persisted structures only: the ThinkGraph reasoning
    state (structural record types) and the persisted Graph Views addressed to
    this role. The broad display projection is referenced by identity and
    counts — its node/edge dump NEVER enters a prompt (a full CBM layout is
    ~180k tokens of relationship lines). Everything beyond this bounded context
    is reachable through the bounded retrieval tools."""
    nodes = list(projection.get("nodes") or [])
    counts = projection.get("counts") or {}
    selected_counts = counts.get("selected") or {}
    sections: dict[str, list[str]] = {}

    sections["header"] = [
        "[LIQUIDAITY_GRAPH_CONTEXT]",
        f"projection: {projection.get('projectionId')} | project: {projection.get('projectId')} | conversation: {projection.get('conversationId')} | role: {projection.get('receivingRole')}",
        "records visible in Unified (retrieve via tools, never assumed loaded): "
        + ", ".join(f"{authority}={int(selected_counts.get(authority) or 0)}" for authority in AUTHORITY),
    ]

    reasoning_lines: list[str] = []
    reasoning_order = {name: index for index, name in enumerate(_REASONING_STATE_TYPES)}
    reasoning_nodes = sorted(
        (node for node in nodes if node.get("authority") == "thinkgraph" and str(node.get("label")) in reasoning_order),
        key=lambda node: (reasoning_order[str(node.get("label"))], str(node.get("name"))),
    )
    omitted_reasoning_count = max(0, len(reasoning_nodes) - MAX_REASONING_STATE_RECORDS)
    for node in reasoning_nodes[:MAX_REASONING_STATE_RECORDS]:
        props = node.get("properties") or {}
        name = _bounded_field(node.get("name"), field="reasoning.name")
        description = _bounded_field(
            props.get("description") or "",
            field="reasoning.description",
        )
        status = str(node.get("status") or "").strip()
        line = f"- {node.get('label')}: {name}"
        if description and description != name:
            line += f" — {description}"
        if status:
            line += f" [{status}]"
        line += f" ({node.get('source_id')})"
        reasoning_lines.append(line)
    if omitted_reasoning_count:
        reasoning_lines.append(
            f"- {omitted_reasoning_count} additional reasoning records omitted by "
            f"the {MAX_REASONING_STATE_RECORDS}-record provider-context limit"
        )
    sections["reasoning_state"] = (["REASONING STATE (ThinkGraph):"] + reasoning_lines) if reasoning_lines else []

    view_measurements: dict[str, dict[str, int]] = {}
    view_lines: list[str] = []
    render_state = _new_render_state()
    for view in role_views:
        before_records = int(render_state["recordCount"])
        before_relationships = int(render_state["relationshipCount"])
        lines = _render_view_lines(view, render_state)
        view_lines.extend(lines)
        view_measurements[str(view.get("viewId"))] = {
            "records": int(render_state["recordCount"]) - before_records,
            "relationships": int(render_state["relationshipCount"]) - before_relationships,
            "characters": len("\n".join(lines)),
            "estimatedTokens": _estimated_tokens("\n".join(lines)),
        }
    sections["graph_views"] = (
        [f"ROLE GRAPH VIEWS ({len(role_views)}):"] + view_lines
        if role_views
        else ["ROLE GRAPH VIEWS: none persisted for this role — use the retrieval tools for records beyond the reasoning state."]
    )

    warning_codes = sorted({str(warning.get("code")) for warning in projection.get("warnings") or []})
    sections["warnings"] = (
        [f"WARNINGS: {len(projection.get('warnings') or [])} ({', '.join(warning_codes)})"] if warning_codes else []
    )

    sections["retrieval"] = [
        "RETRIEVAL: full records and anything beyond this view are available through the bounded tools — "
        "read_thinkgraph_scope (reasoning records), retrieve_knowgraph_context (evidence and sources), "
        "and the Coder runtime's native Codebase Memory MCP catalog (repository structure). "
        "Reference records by the canonical ids shown above.",
    ]

    ordered = ["header", "reasoning_state", "graph_views", "warnings", "retrieval"]
    text = "\n".join(line for key in ordered for line in sections[key] if sections[key])
    if len(text) > MAX_GRAPH_CONTEXT_CHARACTERS:
        raise ValueError(
            "graph_context_character_limit_exceeded: "
            f"{len(text)}>{MAX_GRAPH_CONTEXT_CHARACTERS}"
        )
    section_measurements = {
        key: {"characters": len("\n".join(sections[key])), "estimatedTokens": _estimated_tokens("\n".join(sections[key]))}
        for key in ordered
    }
    measurements = {
        "characters": len(text),
        "estimatedTokens": _estimated_tokens(text),
        "sections": section_measurements,
        "views": view_measurements,
        "projectionCounts": {authority: int(selected_counts.get(authority) or 0) for authority in AUTHORITY},
        "reasoningStateRecords": min(len(reasoning_nodes), MAX_REASONING_STATE_RECORDS),
        "omittedReasoningStateRecords": omitted_reasoning_count,
        "graphViewCount": len(role_views),
        "graphEvidenceCount": int(render_state["recordCount"]) + int(render_state["relationshipCount"]),
        "uniqueFiles": len(render_state["seenFiles"]),
        "uniqueSourceRanges": len(render_state["seenFileRanges"]),
        "duplicateFileRangeCount": int(render_state["duplicateFileRangeCount"]),
        "limits": {
            "selectedGraphViews": MAX_SELECTED_GRAPH_VIEWS,
            "reasoningStateRecords": MAX_REASONING_STATE_RECORDS,
            "graphEvidenceRecords": MAX_GRAPH_EVIDENCE_RECORDS,
            "graphEvidenceRelationships": MAX_GRAPH_EVIDENCE_RELATIONSHIPS,
            "provenanceRefsPerView": MAX_GRAPH_VIEW_PROVENANCE_REFS,
            "fieldCharacters": MAX_GRAPH_CONTEXT_FIELD_CHARACTERS,
            "contextCharacters": MAX_GRAPH_CONTEXT_CHARACTERS,
        },
    }
    return {"text": text, "measurements": measurements}


def render_graph_views(views: list[dict[str, Any]]) -> dict[str, Any]:
    """Faithful compact rendering of persisted Graph View records (doorway
    delivery). Every record and relationship in the views is preserved; only
    transport/UI overhead is removed. Shares the one per-view serializer."""
    lines: list[str] = ["[LIQUIDAITY_GRAPH_CONTEXT]"]
    total_records = 0
    total_relationships = 0
    per_view: dict[str, dict[str, int]] = {}
    render_state = _new_render_state()
    for view in views:
        before_records = int(render_state["recordCount"])
        before_relationships = int(render_state["relationshipCount"])
        view_lines = _render_view_lines(view, render_state)
        lines.extend(view_lines)
        rendered_records = int(render_state["recordCount"]) - before_records
        rendered_relationships = int(render_state["relationshipCount"]) - before_relationships
        total_records += rendered_records
        total_relationships += rendered_relationships
        per_view[str(view.get("viewId"))] = {
            "records": rendered_records,
            "relationships": rendered_relationships,
            "estimatedTokens": _estimated_tokens("\n".join(view_lines)),
        }
    lines.append(
        "These compact canonical references are the exact filtered graph views supplied to this invocation. "
        "Reference records by the canonical ids above; retrieve full records through the bounded graph tools."
    )
    text = "\n".join(lines)
    if len(text) > MAX_GRAPH_CONTEXT_CHARACTERS:
        raise ValueError(
            "graph_context_character_limit_exceeded: "
            f"{len(text)}>{MAX_GRAPH_CONTEXT_CHARACTERS}"
        )
    return {
        "text": text,
        "measurements": {
            "characters": len(text),
            "estimatedTokens": _estimated_tokens(text),
            "views": per_view,
            "records": total_records,
            "relationships": total_relationships,
            "graphViewCount": len(views),
            "graphEvidenceCount": total_records + total_relationships,
            "uniqueFiles": len(render_state["seenFiles"]),
            "uniqueSourceRanges": len(render_state["seenFileRanges"]),
            "duplicateFileRangeCount": int(render_state["duplicateFileRangeCount"]),
        },
    }


def build_model_context(
    projection_id: str,
    request: UnifiedContextRequest,
    *,
    graph: ThinkGraphEngraphis | None = None,
    read_json: Callable[[str, dict[str, Any]], dict[str, Any]] = _get_json,
    read_codegraph_json: Callable[[str, dict[str, Any]], dict[str, Any]] = _get_codegraph_json,
) -> dict[str, Any]:
    """Resolve the projection through its persistent authorities: rebuild
    deterministically from the same configuration and require content-hash
    equality with the id the client saw (display integrity). The model context
    itself is bounded and target-specific — persisted role-addressed Graph
    Views plus the ThinkGraph reasoning state — never the display projection's
    node/edge dump. The graphs are the store; a mismatch means they moved
    since the human looked, which fails honestly."""
    rebuilt = build_unified_context(
        request,
        graph=graph,
        read_json=read_json,
        read_codegraph_json=read_codegraph_json,
    )
    if str(rebuilt.get("projectionId")) != str(projection_id):
        raise ValueError(f"projection_superseded: current is {rebuilt.get('projectionId')}")
    resolved_graph = graph or get_thinkgraph()
    persisted = list(
        resolved_graph.graph_views(request.project_id, request.conversation_id).get("views") or []
    )
    role_views = select_persisted_graph_views(
        persisted,
        [request.active_view_id] if request.active_view_id else [],
        project_id=request.project_id,
        conversation_id=request.conversation_id,
        receiving_roles={request.role},
    )
    rendered = render_model_context(rebuilt, role_views)
    return {
        "ok": True,
        "projectionId": str(projection_id),
        "identity": rebuilt.get("identity") or {},
        "activeGraphViewId": rebuilt.get("activeGraphViewId"),
        "modelContext": rendered["text"],
        "measurements": rendered["measurements"],
        "graphViews": graph_view_identities(role_views),
        "warnings": rebuilt.get("warnings") or [],
    }
