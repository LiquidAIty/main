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
from urllib.request import Request

from app.python_models.thinkgraph_engraphis import ThinkGraphEngraphis, get_thinkgraph
from app.python_models.thinkgraph_context import resolve_thinkgraph_context


AUTHORITY = {
    "thinkgraph": {"label": "ThinkGraph", "color": "#4AE2DF", "z": 120.0},
    "knowgraph": {"label": "KnowGraph", "color": "#B8C8D2", "z": 0.0},
    "codegraph": {"label": "CodeGraph", "color": "#5EA8FF", "z": -120.0},
}
_INFLIGHT: dict[str, dict[str, Any]] = {}
_INFLIGHT_LOCK = threading.Lock()


def _bounded(value: int, low: int, high: int) -> int:
    return max(low, min(high, int(value)))


def _get_json(path: str, params: dict[str, Any], *, backend_url: str | None = None) -> dict[str, Any]:
    base = (backend_url or os.getenv("LIQUIDAITY_BACKEND_URL") or "http://127.0.0.1:4000").rstrip("/")
    with urlopen(f"{base}{path}?{urlencode(params, doseq=True)}", timeout=90) as response:  # noqa: S310 - configured local backend
        return json.loads(response.read().decode("utf-8"))


def _post_json(path: str, payload: dict[str, Any], *, backend_url: str | None = None) -> dict[str, Any]:
    base = (backend_url or os.getenv("LIQUIDAITY_BACKEND_URL") or "http://127.0.0.1:4000").rstrip("/")
    request = Request(f"{base}{path}", data=json.dumps(payload).encode("utf-8"), headers={"Content-Type": "application/json"}, method="POST")
    with urlopen(request, timeout=90) as response:  # noqa: S310 - configured local backend
        return json.loads(response.read().decode("utf-8"))


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
    think_limit: int = 120
    know_limit: int = 120
    code_limit: int = 90
    expansion_depth: int = 0


def _build_unified_context(
    request: UnifiedContextRequest,
    *,
    graph: ThinkGraphEngraphis | None = None,
    read_json: Callable[[str, dict[str, Any]], dict[str, Any]] = _get_json,
    post_json: Callable[[str, dict[str, Any]], dict[str, Any]] = _post_json,
) -> dict[str, Any]:
    if not request.project_id.strip() or not request.conversation_id.strip():
        raise ValueError("project_id_and_conversation_id_required")
    graph = graph or get_thinkgraph()
    limits = {
        "thinkgraph": _bounded(request.think_limit, 1, 80),
        "knowgraph": _bounded(request.know_limit, 1, 80),
        "codegraph": _bounded(request.code_limit, 1, 80),
    }
    if request.role == "hermes":
        limits["codegraph"] = min(limits["codegraph"], 20)
    elif request.role == "coder":
        limits["knowgraph"] = min(limits["knowgraph"], 20)
    warnings: list[dict[str, str]] = []
    started = time.perf_counter()
    think_started = time.perf_counter()
    think_context = resolve_thinkgraph_context(
        graph,
        project_id=request.project_id,
        conversation_id=request.conversation_id,
        receiving_role=request.role,
        active_view_id=request.active_view_id,
        limit=limits["thinkgraph"],
        extra_hops=request.expansion_depth,
    )
    think_ms = (time.perf_counter() - think_started) * 1000
    warnings.extend(think_context.get("warnings") or [])
    think = {"nodes": think_context.get("nodes") or [], "edges": think_context.get("edges") or [], "revision": think_context.get("revision")}
    graph_views = list(think_context.get("availableViews") or [])
    source_view = dict(think_context.get("view") or {})
    selected_view_id = source_view.get("parentViewId") or request.active_view_id
    selected_views = [source_view] if source_view else []
    selected_know_refs = sorted({
        ref
        for view in selected_views
        for ref in [*view["includedCanonicalNodeIds"], *view["provenanceRefs"]]
        if str(ref).startswith(("know:", "analysis:", "topic:", "gap:", "community:"))
    })
    for node in think.get("nodes", []):
        props = node.get("properties") or {}
        selected_know_refs.extend(_refs(props.get("knowgraph_ref") or node.get("knowGraphRef")))
    selected_know_refs = sorted(set(selected_know_refs))
    know_started = time.perf_counter()
    try:
        know = read_json("/api/knowgraph/analysis/context-projection", {
            "projectId": request.knowgraph_scope or request.project_id,
            "refs": selected_know_refs,
            "limit": str(limits["knowgraph"]),
            "conversationId": request.conversation_id,
            "role": request.role,
        })
        warnings.extend(know.get("warnings") or [])
    except Exception as error:  # one authority may fail without fabricating records
        know = {"nodes": [], "relationships": []}
        warnings.append({"authority": "knowgraph", "code": "authority_unavailable", "detail": str(error)})
    know_ms = (time.perf_counter() - know_started) * 1000
    code_refs = sorted({
        str(ref).removeprefix("code:")
        for view in selected_views
        for ref in [*view["includedCanonicalNodeIds"], *view["provenanceRefs"]]
        if str(ref).startswith("code:")
    })
    for node in think.get("nodes", []):
        props = node.get("properties") or {}
        code_refs.extend(str(ref).removeprefix("code:") for ref in _refs(props.get("codegraph_ref") or node.get("codeGraphRef")))
        code_refs.extend(str(ref).removeprefix("code:") for ref in _refs(props.get("secondary_ref")))
    code_refs = sorted(set(code_refs))
    code_query = " ".join([*code_refs, *(view.get("query") or "" for view in selected_views)]).strip() or "active unified context"
    code_started = time.perf_counter()
    try:
        if request.role == "hermes" and not code_refs:
            code_response = {"ok": True, "result": {"results": []}, "graphView": None}
        else:
            code_response = post_json("/api/coder/mcp-bridge/codegraph_search", {
            "query": code_query,
            "canonicalRefs": code_refs,
            "limit": min(limits["codegraph"], max(8, len(code_refs) * 4)) if code_refs else limits["codegraph"],
            "projectId": request.project_id,
            "conversationId": request.conversation_id,
            "requestingRole": request.role,
            "producingRole": "codegraph",
            "receivingRole": request.role,
            "parentViewId": selected_view_id,
            "note": "Read-only CBM context projection for Unified.",
            })
        if code_response.get("ok") is False:
            raise RuntimeError(code_response.get("error") or "codegraph_unavailable")
        results = list((code_response.get("result") or {}).get("results") or [])
        code = {
            "nodes": [{
                "id": item.get("qualified_name"),
                "label": item.get("name") or item.get("qualified_name"),
                "type": item.get("label") or "Symbol",
                "degree": item.get("degree") or 0,
                "properties": {"file_path": item.get("file_path"), "rank": item.get("rank")},
                "provenance": {"filePath": item.get("file_path"), "cbmProject": code_response.get("cbmProject")},
            } for item in results if item.get("qualified_name")],
            "edges": list((code_response.get("graphView") or {}).get("includedRelationships") or []),
            "graphView": code_response.get("graphView"),
            "projectId": code_response.get("cbmProject"),
        }
    except Exception as error:
        code = {"nodes": [], "edges": [], "projectId": None}
        warnings.append({"authority": "codegraph", "code": "authority_unavailable", "detail": str(error)})
    code_ms = (time.perf_counter() - code_started) * 1000

    authority_views = {
        "thinkgraph": source_view,
        "knowgraph": dict(know.get("view") or {}),
        "codegraph": dict(code.get("graphView") or {}),
    }

    included_by_authority = {
        authority: set((authority_views[authority] or {}).get("includedCanonicalNodeIds") or [])
        for authority in AUTHORITY
    }

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
    pending_refs: list[tuple[int, str, str]] = []
    for authority in AUTHORITY:
        for source in chosen[authority]:
            canonical = str(source.get("canonicalId") or source.get("id") or "")
            props = dict(source.get("properties") or {})
            cluster = str(props.get("cluster") or source.get("type") or source.get("label") or "records")
            numeric = len(nodes) + 1
            numeric_by_key[(authority, canonical)] = numeric
            if authority == "codegraph":
                numeric_by_key[(authority, f"code:{canonical}")] = numeric
            for key, target_authority in (("knowgraph_ref", "knowgraph"), ("knowGraphRef", "knowgraph"), ("codegraph_ref", "codegraph"), ("codeGraphRef", "codegraph"), ("secondary_ref", "codegraph")):
                for ref in _refs(props.get(key) if key in props else source.get(key)):
                    pending_refs.append((numeric, target_authority, ref))
            derived_types = {"DerivedAnalysis", "Topic", "Gap", "Community", "Gateway", "AnalysisTopic", "AnalysisGap"}
            epistemic = str(props.get("epistemic_level") or (
                "reasoning" if authority == "thinkgraph"
                else "derived_analysis" if authority == "knowgraph" and str(source.get("type")) in derived_types
                else "source_backed" if authority == "knowgraph"
                else "repository_truth"
            ))
            nodes.append({
                "id": numeric,
                **_position(authority, canonical, cluster),
                "label": str(source.get("type") or source.get("kind") or "Record"),
                "name": str(source.get("title") or source.get("label") or canonical),
                "size": max(5.0, min(16.0, 5.0 + math.log2(int(source.get("degree") or 0) + 2) * 1.8)),
                "color": AUTHORITY[authority]["color"],
                "authority": authority,
                "source_id": canonical,
                "properties": props,
                "provenance": source.get("provenance") or {},
                "project_id": source.get("projectId") or request.project_id,
                "conversation_id": source.get("conversationId") or request.conversation_id,
                "run_id": source.get("runId") or props.get("run_id"),
                "status": props.get("status") or source.get("currentState"),
                "trust": source.get("trustState") or props.get("trust_state"),
                "source_graph": AUTHORITY[authority]["label"],
                "epistemic_level": epistemic,
                "cluster": cluster,
                "selection_state": "selected" if canonical in included_by_authority[authority] else "available",
                "graph_view_id": (authority_views[authority] or {}).get("viewId") if canonical in included_by_authority[authority] else None,
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
                edges.append({"id": str(raw.get("id") or f"{source_ref}:{target_ref}"), "source": source, "target": target, "type": str(raw.get("predicate") or raw.get("type") or "RELATED_TO"), "cross_authority": False})
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
        "expansionDepth": request.expansion_depth,
    }
    configuration_hash = hashlib.sha256(json.dumps(configuration, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    content_identity = {
        "configurationHash": configuration_hash,
        "authorityViewIds": [view.get("viewId") for view in authority_views.values() if view],
        "nodes": [(node["authority"], node["source_id"], node["epistemic_level"]) for node in nodes],
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
    delivery_views = []
    for authority in AUTHORITY:
        authority_view = authority_views[authority]
        if not authority_view:
            continue
        delivery_views.append({
            **authority_view,
            "status": "candidate",
            "receivingRole": request.role,
            "note": "; ".join(filter(None, [str(authority_view.get("note") or "").strip(), f"combinedProjectionId={projection_id}", f"configurationHash={configuration_hash}"])),
        })
    lifecycle = {
        "available": [view["viewId"] for view in graph_views] + [view["viewId"] for view in delivery_views],
        "selected": [view["viewId"] for view in delivery_views],
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
        "graphViews": delivery_views,
        "availableGraphViews": graph_views,
        "authorityGraphViews": delivery_views,
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
    post_json: Callable[[str, dict[str, Any]], dict[str, Any]] = _post_json,
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
        "expansionDepth": request.expansion_depth,
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
        result = _build_unified_context(request, graph=graph, read_json=read_json, post_json=post_json)
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
