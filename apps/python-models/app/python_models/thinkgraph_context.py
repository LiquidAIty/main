"""ThinkGraph-owned bounded view resolution for agent context exchange."""
from __future__ import annotations

import hashlib
import json
import math
from typing import Any

from app.python_models.thinkgraph_engraphis import ThinkGraphEngraphis


def _decode(value: Any, fallback: Any) -> Any:
    try:
        return json.loads(value) if isinstance(value, str) and value else fallback
    except json.JSONDecodeError:
        return fallback


def resolve_thinkgraph_context(
    graph: ThinkGraphEngraphis,
    *,
    project_id: str,
    conversation_id: str,
    receiving_role: str,
    active_view_id: str | None,
    limit: int,
    extra_hops: int = 0,
) -> dict[str, Any]:
    limit = max(1, min(int(limit), 80))
    projection = graph.projection(project_id, limit=500)
    persisted_views = []
    for node in projection.get("nodes", []):
        if node.get("type") != "GraphView":
            continue
        props = node.get("properties") or {}
        persisted_views.append({
            "viewId": props.get("view_id") or str(node.get("canonicalId") or "").removeprefix("graph-view:"),
            "status": props.get("status") or "candidate",
            "authority": props.get("view_authority") or "thinkgraph",
            "receivingRole": props.get("receiving_role") or "",
            "includedCanonicalNodeIds": _decode(props.get("included_node_ids_json"), []),
            "rootCanonicalNodeIds": _decode(props.get("root_node_ids_json"), []),
            "provenanceRefs": _decode(props.get("provenance_refs_json"), []),
            "query": props.get("query") or "",
            "hopDepth": int(props.get("hop_depth") or 0),
            "updatedAt": props.get("updated_at") or node.get("updatedAt") or node.get("createdAt"),
        })
    source = next((view for view in persisted_views if view["viewId"] == active_view_id and view["authority"] == "thinkgraph"), None)
    if source is None:
        source = next((view for view in persisted_views if view["authority"] == "thinkgraph" and view["receivingRole"] == receiving_role and view["status"] == "candidate"), None)
    if source is None:
        source = next((view for view in persisted_views if view["status"] in {"attached", "active"}), None)
    selected_ids = set(source["includedCanonicalNodeIds"] if source else [])
    included = set(selected_ids)
    frontier = set(selected_ids)
    resolved_hops = min(4, int(source["hopDepth"] if source else 0) + max(0, int(extra_hops)))
    for _ in range(resolved_hops):
        next_ids = set()
        for edge in projection.get("edges", []):
            if edge.get("source") in frontier:
                next_ids.add(str(edge.get("target")))
            if edge.get("target") in frontier:
                next_ids.add(str(edge.get("source")))
        included.update(next_ids)
        frontier = next_ids
    candidates = [node for node in projection.get("nodes", []) if not included or str(node.get("canonicalId") or node.get("id")) in included]
    candidates.sort(key=lambda node: (0 if str(node.get("canonicalId") or node.get("id")) in selected_ids else 1, -int(node.get("degree") or 0), str(node.get("canonicalId") or node.get("id"))))
    nodes = candidates[:limit]
    ids = {str(node.get("canonicalId") or node.get("id")) for node in nodes}
    edges = [edge for edge in projection.get("edges", []) if edge.get("source") in ids and edge.get("target") in ids]
    content = {"source": source["viewId"] if source else None, "nodes": sorted(ids), "edges": sorted((edge.get("source"), edge.get("predicate"), edge.get("target")) for edge in edges)}
    view_id = f"thinkgraph:{hashlib.sha256(json.dumps(content, sort_keys=True).encode()).hexdigest()[:24]}"
    records = []
    for rank, node in enumerate(nodes, start=1):
        props = node.get("properties") or {}
        description = str(props.get("description") or node.get("label") or node.get("title") or node.get("id"))
        summary = f"{node.get('title') or node.get('label')}: {description}"[:480]
        provenance_refs = sorted({str(value) for value in (node.get("provenance") or {}).values() if isinstance(value, str) and value})[:12]
        records.append({"canonicalId": str(node.get("canonicalId") or node.get("id")), "summary": summary, "selectionReason": "Selected by the ThinkGraph bounded reasoning view", "rank": rank, "provenanceRefs": provenance_refs, "estimatedCharacters": len(summary), "estimatedTokens": max(1, math.ceil(len(summary) / 4))})
    view = {
        "schemaVersion": "graph-view.v1", "viewId": view_id, "authority": "thinkgraph", "status": "candidate",
        "projectId": project_id, "conversationId": conversation_id, "producingRole": "thinkgraph", "receivingRole": receiving_role,
        "rootCanonicalNodeIds": list(source["rootCanonicalNodeIds"] if source else [])[:20], "includedCanonicalNodeIds": [record["canonicalId"] for record in records],
        "records": records, "includedRelationships": [{"id": str(edge.get("id")), "source": str(edge.get("source")), "target": str(edge.get("target")), "type": str(edge.get("predicate") or "RELATED_TO")} for edge in edges],
        "query": source["query"] if source else "Current project reasoning", "filter": {"nodeTypes": [], "trustStates": []}, "hopDepth": resolved_hops,
        "provenanceRefs": list(source["provenanceRefs"] if source else []), "parentViewId": source["viewId"] if source else None,
        "omittedNeighborCount": max(0, len(candidates) - len(nodes)), "createdAt": source["updatedAt"] if source else "1970-01-01T00:00:00Z", "updatedAt": source["updatedAt"] if source else "1970-01-01T00:00:00Z",
    }
    warnings = []
    if not nodes:
        warnings.append({"authority": "thinkgraph", "code": "empty_authority_view", "detail": "No ThinkGraph records matched the selected view."})
    if len(candidates) > len(nodes):
        warnings.append({"authority": "thinkgraph", "code": "authority_view_truncated", "detail": f"{len(candidates) - len(nodes)} records omitted by limit {limit}."})
    return {"schemaVersion": "thinkgraph.context.v1", "authority": "thinkgraph", "projectId": project_id, "revision": projection.get("revision"), "view": view, "availableViews": persisted_views, "nodes": nodes, "edges": edges, "warnings": warnings, "counts": {"available": len(candidates), "selected": len(nodes), "edges": len(edges)}}
