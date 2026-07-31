"""Bounded read-only projection across canonical graph authorities.

AgentGraph owns reference passing and lineage. Unified resolves source graphs for
display, but never persists their records inside ThinkGraph or AgentGraph.
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

from app.python_models import agentgraph
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
MAX_GRAPH_VIEW_REFERENCES = 128
MAX_GRAPH_CONTEXT_CHARACTERS = 32_000
MAX_GRAPH_CONTEXT_FIELD_CHARACTERS = 1_000
MAX_DELIVERED_RECORD_CHARACTERS = 4_000
_GRAPH_AUTHORITIES = frozenset(AUTHORITY)


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


def _compact_value(value: Any, *, depth: int = 0) -> Any:
    """Bound native record detail without copying an unbounded tool payload."""
    if depth >= 3:
        return _flat(value)[:MAX_GRAPH_CONTEXT_FIELD_CHARACTERS]
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, str):
        return _flat(value)[:MAX_GRAPH_CONTEXT_FIELD_CHARACTERS]
    if isinstance(value, list):
        return [_compact_value(item, depth=depth + 1) for item in value[:20]]
    if isinstance(value, dict):
        return {
            str(key)[:128]: _compact_value(value[key], depth=depth + 1)
            for key in sorted(value, key=lambda item: str(item))[:40]
        }
    return _flat(value)[:MAX_GRAPH_CONTEXT_FIELD_CHARACTERS]


def _canonical_node_id(authority: str, source: dict[str, Any]) -> str:
    props = dict(source.get("properties") or {})
    return str(
        source.get("source_id")
        or source.get("canonicalId")
        or props.get("qualified_name")
        or props.get("uuid")
        or source.get("name")
        or source.get("id")
        or ""
    ).strip()


def _node_aliases(authority: str, source: dict[str, Any]) -> set[str]:
    props = dict(source.get("properties") or {})
    aliases = {
        _canonical_node_id(authority, source),
        str(source.get("id") or "").strip(),
        str(source.get("source_id") or "").strip(),
        str(source.get("canonicalId") or "").strip(),
        str(source.get("name") or "").strip(),
        str(props.get("qualified_name") or "").strip(),
        str(props.get("uuid") or "").strip(),
    }
    canonical = _canonical_node_id(authority, source)
    if authority == "codegraph" and canonical:
        aliases.add(f"code:{canonical}")
        aliases.add(f"codegraph:{canonical}")
    return {alias for alias in aliases if alias}


def _raw_edge_endpoints(raw: dict[str, Any]) -> tuple[str, str]:
    return (
        str(raw.get("source") or raw.get("from") or "").strip(),
        str(raw.get("target") or raw.get("to") or "").strip(),
    )


def _native_revision(
    authority: str,
    source: dict[str, Any],
    authority_revision: str | None,
) -> str | None:
    props = dict(source.get("properties") or {})
    value = (
        source.get("revision")
        or source.get("updatedAt")
        or source.get("updated_at")
        or source.get("valid_at")
        or props.get("revision")
        or props.get("updated_at")
        or props.get("updatedAt")
        or props.get("valid_at")
        or authority_revision
    )
    return str(value).strip() if value is not None and str(value).strip() else None


def _record_representation(
    *,
    authority: str,
    kind: str,
    native_id: str,
    source: dict[str, Any],
    native_revision: str | None,
    source_id: str | None = None,
    target_id: str | None = None,
    predicate: str | None = None,
) -> tuple[str, str]:
    props = dict(source.get("properties") or {})
    if kind == "node":
        bounded = {
            "authority": authority,
            "kind": "node",
            "nativeId": native_id,
            "type": str(source.get("type") or source.get("kind") or source.get("label") or "Record"),
            "label": str(source.get("title") or source.get("name") or source.get("label") or native_id),
            **({"nativeRevision": native_revision} if native_revision else {}),
            "properties": _compact_value(props),
            "provenance": _compact_value(source.get("provenance") or {}),
        }
    else:
        bounded = {
            "authority": authority,
            "kind": "edge",
            "nativeId": native_id,
            "sourceId": source_id,
            "targetId": target_id,
            "predicate": predicate or "RELATED_TO",
            **({"nativeRevision": native_revision} if native_revision else {}),
            "properties": _compact_value(props),
            "provenance": _compact_value(source.get("provenance") or {}),
        }
    representation = json.dumps(
        bounded,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    if len(representation) > MAX_DELIVERED_RECORD_CHARACTERS:
        raise ValueError(
            "delivered_graph_record_too_large: "
            f"{authority}:{native_id} "
            f"({len(representation)}>{MAX_DELIVERED_RECORD_CHARACTERS})"
        )
    return representation, hashlib.sha256(representation.encode()).hexdigest()


def compile_delivered_context_manifest(
    *,
    project_id: str,
    conversation_id: str,
    receiving_role: str,
    views: list[dict[str, Any]],
    raw_nodes: dict[str, list[dict[str, Any]]],
    raw_edges: dict[str, list[dict[str, Any]]],
    authority_revisions: dict[str, str | None] | None = None,
) -> dict[str, Any]:
    """Resolve GraphView pointers into the exact bounded records delivered.

    Source graphs remain authoritative. This manifest exists only as the
    deterministic pre-run representation shared by model context and UI.
    """
    authority_revisions = authority_revisions or {}
    node_by_alias: dict[str, dict[str, dict[str, Any]]] = {
        authority: {} for authority in AUTHORITY
    }
    canonical_by_endpoint: dict[str, dict[str, str]] = {
        authority: {} for authority in AUTHORITY
    }
    for authority in AUTHORITY:
        for source in raw_nodes.get(authority) or []:
            canonical = _canonical_node_id(authority, source)
            if not canonical:
                continue
            for alias in _node_aliases(authority, source):
                node_by_alias[authority].setdefault(alias, source)
                canonical_by_endpoint[authority].setdefault(alias, canonical)

    edge_by_alias: dict[str, dict[str, dict[str, Any]]] = {
        authority: {} for authority in AUTHORITY
    }
    edge_identity: dict[int, tuple[str, str, str, str]] = {}
    for authority in AUTHORITY:
        for raw in raw_edges.get(authority) or []:
            source_ref, target_ref = _raw_edge_endpoints(raw)
            source_id = canonical_by_endpoint[authority].get(source_ref, source_ref)
            target_id = canonical_by_endpoint[authority].get(target_ref, target_ref)
            predicate = str(raw.get("predicate") or raw.get("type") or "RELATED_TO")
            native_id = str(
                raw.get("id")
                or f"{source_id}|{predicate}|{target_id}"
            ).strip()
            aliases = {
                native_id,
                f"{source_id}|{predicate}|{target_id}",
                f"{source_ref}|{predicate}|{target_ref}",
            }
            for alias in aliases:
                if alias:
                    edge_by_alias[authority].setdefault(alias, raw)
            edge_identity[id(raw)] = (native_id, source_id, target_id, predicate)

    records: list[dict[str, Any]] = []
    record_index: dict[tuple[str, str, str], int] = {}
    unresolved: list[dict[str, Any]] = []
    external_references: list[dict[str, Any]] = []

    def append_record(
        *,
        authority: str,
        kind: str,
        native_id: str,
        source: dict[str, Any],
        required: bool,
        selected_by: str,
        source_id: str | None = None,
        target_id: str | None = None,
        predicate: str | None = None,
    ) -> None:
        identity = (authority, kind, native_id)
        existing_index = record_index.get(identity)
        if existing_index is not None:
            if required:
                records[existing_index]["required"] = True
            return
        native_revision = _native_revision(
            authority,
            source,
            authority_revisions.get(authority),
        )
        representation, representation_hash = _record_representation(
            authority=authority,
            kind=kind,
            native_id=native_id,
            source=source,
            native_revision=native_revision,
            source_id=source_id,
            target_id=target_id,
            predicate=predicate,
        )
        record_index[identity] = len(records)
        records.append(
            {
                "authority": authority,
                "kind": kind,
                "nativeId": native_id,
                "nativeRevision": native_revision,
                "sourceId": source_id,
                "targetId": target_id,
                "predicate": predicate,
                "required": required,
                "deliveryOrder": len(records),
                "selectedBy": selected_by,
                "representation": representation,
                "representationHash": representation_hash,
                "characters": len(representation),
                "bytes": len(representation.encode("utf-8")),
            }
        )

    for view in views:
        references = sorted(
            enumerate(view.get("references") or []),
            key=lambda item: (
                int(item[1].get("deliveryOrder"))
                if isinstance(item[1].get("deliveryOrder"), int)
                else item[0],
                str(item[1].get("referenceType") or ""),
                str(item[1].get("referenceId") or ""),
            ),
        )
        for _index, reference in references:
            authority = str(reference.get("referenceType") or "").strip()
            reference_id = str(reference.get("referenceId") or "").strip()
            required = bool(reference.get("required"))
            selected_by = str(view.get("viewId") or "")
            if authority not in _GRAPH_AUTHORITIES:
                external_references.append(
                    {
                        "referenceId": reference_id,
                        "referenceType": authority,
                        "required": required,
                        "selectedBy": selected_by,
                    }
                )
                continue
            requested_kind = str(reference.get("recordKind") or "").strip()
            node = node_by_alias[authority].get(reference_id)
            edge = edge_by_alias[authority].get(reference_id)
            if requested_kind == "node":
                edge = None
            elif requested_kind == "edge":
                node = None
            elif node is not None and edge is not None:
                raise ValueError(
                    f"graph_reference_kind_ambiguous: {authority}:{reference_id}"
                )
            if node is not None:
                append_record(
                    authority=authority,
                    kind="node",
                    native_id=_canonical_node_id(authority, node),
                    source=node,
                    required=required,
                    selected_by=selected_by,
                )
                continue
            if edge is not None:
                native_id, source_id, target_id, predicate = edge_identity[id(edge)]
                for endpoint_id in (source_id, target_id):
                    endpoint = node_by_alias[authority].get(endpoint_id)
                    if endpoint is None:
                        raise ValueError(
                            f"graph_edge_endpoint_unavailable: {authority}:{native_id}:{endpoint_id}"
                        )
                    append_record(
                        authority=authority,
                        kind="node",
                        native_id=_canonical_node_id(authority, endpoint),
                        source=endpoint,
                        required=required,
                        selected_by=selected_by,
                    )
                append_record(
                    authority=authority,
                    kind="edge",
                    native_id=native_id,
                    source=edge,
                    required=required,
                    selected_by=selected_by,
                    source_id=source_id,
                    target_id=target_id,
                    predicate=predicate,
                )
                continue
            missing = {
                "referenceId": reference_id,
                "referenceType": authority,
                "recordKind": requested_kind or None,
                "required": required,
                "selectedBy": selected_by,
                "reason": "native_record_unavailable",
            }
            unresolved.append(missing)
            if required:
                raise ValueError(
                    f"required_graph_reference_unavailable: {authority}:{reference_id}"
                )

    identity_payload = [
        (
            record["authority"],
            record["kind"],
            record["nativeId"],
            record["representationHash"],
            record["required"],
            record["deliveryOrder"],
        )
        for record in records
    ]
    manifest_hash = hashlib.sha256(
        json.dumps(identity_payload, separators=(",", ":")).encode()
    ).hexdigest()
    return {
        "schemaVersion": "delivered-context-manifest.v1",
        "authority": "agentgraph",
        "projectId": project_id,
        "conversationId": conversation_id,
        "receivingRole": receiving_role,
        "graphViewIds": [str(view.get("viewId") or "") for view in views],
        "records": records,
        "unresolvedReferences": unresolved,
        "externalReferences": external_references,
        "recordCount": len(records),
        "nodeCount": sum(1 for record in records if record["kind"] == "node"),
        "edgeCount": sum(1 for record in records if record["kind"] == "edge"),
        "characters": sum(int(record["characters"]) for record in records),
        "bytes": sum(int(record["bytes"]) for record in records),
        "manifestHash": manifest_hash,
    }


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
    active_view_ids: tuple[str, ...] = ()
    knowgraph_scope: str | None = None
    think_limit: int = 5000
    know_limit: int = 50000
    code_limit: int = 50000


def _graph_view_identity(view: dict[str, Any]) -> dict[str, Any]:
    """Expose AgentGraph view identity plus stable references only."""
    return {
        key: view.get(key)
        for key in (
            "schemaVersion",
            "viewId",
            "authority",
            "status",
            "projectId",
            "conversationId",
            "correlationId",
            "displayLabel",
            "producingRole",
            "receivingRole",
            "parentViewId",
            "note",
            "createdAt",
            "updatedAt",
        )
        if view.get(key) is not None
    } | {
        "references": list(view.get("references") or []),
        "referenceCount": len(view.get("references") or []),
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
    """Resolve an explicit ordered selection of AgentGraph reference views.

    The caller carries identities only. Python enforces scope, target role, and
    lifecycle before reference identities are rendered for a model.
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
        agentgraph.list_graph_views(
            project_id=request.project_id,
            conversation_id=request.conversation_id,
            limit=50,
        ).get("views") or []
    )
    requested_view_ids = list(request.active_view_ids) or (
        [request.active_view_id] if request.active_view_id else []
    )
    selected_full_views = select_persisted_graph_views(
        persisted_graph_views,
        requested_view_ids,
        project_id=request.project_id,
        conversation_id=request.conversation_id,
        receiving_roles={request.role},
    )
    graph_views = graph_view_identities(persisted_graph_views)
    selected_views = graph_view_identities(selected_full_views)
    selected_view_id = (
        str(selected_full_views[0].get("viewId") or "")
        if len(selected_full_views) == 1
        else None
    )
    know_started = time.perf_counter()
    know: dict[str, Any] = {"nodes": [], "relationships": []}
    code: dict[str, Any] = {"nodes": [], "edges": [], "projectId": None}
    if selected_full_views:
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
                "revision": graph_payload.get("revision"),
                "resolved_project_id": graph_payload.get("resolved_project_id"),
            }
        except Exception as error:  # one authority may fail without fabricating records
            warnings.append({"authority": "knowgraph", "code": "authority_unavailable", "detail": str(error)})
    know_ms = (time.perf_counter() - know_started) * 1000
    code_started = time.perf_counter()
    if selected_full_views:
        try:
            code_project = str(
                os.getenv("LIQUIDAITY_CODEGRAPH_PROJECT") or "C-Projects-main"
            ).strip()
            if not code_project:
                raise ValueError("codegraph_project_unavailable")
            code = read_codegraph_json("/api/layout", {"project": code_project, "max_nodes": limits["codegraph"]})
            code["projectId"] = code_project
        except Exception as error:
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

    manifest = compile_delivered_context_manifest(
        project_id=request.project_id,
        conversation_id=request.conversation_id,
        receiving_role=request.role,
        views=selected_full_views,
        raw_nodes=raw_nodes,
        raw_edges=raw_edges,
        authority_revisions={
            "thinkgraph": str(think.get("revision") or "").strip() or None,
            "knowgraph": str(know.get("revision") or "").strip() or None,
            "codegraph": str(code.get("generation") or code.get("revision") or "").strip() or None,
        },
    )

    nodes: list[dict[str, Any]] = []
    numeric_by_key: dict[tuple[str, str], int] = {}
    for record in manifest["records"]:
        if record["kind"] != "node":
            continue
        authority = str(record["authority"])
        canonical = str(record["nativeId"])
        decoded = json.loads(str(record["representation"]))
        props = dict(decoded.get("properties") or {})
        cluster = str(decoded.get("type") or "records")
        numeric = len(nodes) + 1
        numeric_by_key[(authority, canonical)] = numeric
        position = _position(authority, canonical, cluster)
        nodes.append({
            "id": numeric,
            **position,
            "label": str(decoded.get("type") or "Record"),
            "name": str(decoded.get("label") or canonical),
            "size": 5.0,
            "color": AUTHORITY[authority]["color"],
            "authority": authority,
            "source_id": canonical,
            "properties": {
                **props,
                "deliveryOrder": record["deliveryOrder"],
                "representationHash": record["representationHash"],
                "required": record["required"],
            },
            "provenance": decoded.get("provenance") or {},
            "project_id": request.project_id,
            "conversation_id": request.conversation_id,
            "source_graph": AUTHORITY[authority]["label"],
            "cluster": cluster,
        })

    cross_started = time.perf_counter()
    edges: list[dict[str, Any]] = []
    for record in manifest["records"]:
        if record["kind"] != "edge":
            continue
        authority = str(record["authority"])
        source = numeric_by_key.get((authority, str(record["sourceId"])))
        target = numeric_by_key.get((authority, str(record["targetId"])))
        if source is None or target is None:
            raise ValueError(
                f"delivered_graph_edge_endpoint_missing: {authority}:{record['nativeId']}"
            )
        edges.append({
            "id": f"{authority}:{record['nativeId']}",
            "source": source,
            "target": target,
            "type": str(record["predicate"] or "RELATED_TO"),
            "cross_authority": False,
            "delivery_order": record["deliveryOrder"],
            "representation_hash": record["representationHash"],
            "required": record["required"],
        })
    if not selected_full_views:
        warnings.append({
            "authority": "agentgraph",
            "code": "no_active_context_manifest",
            "detail": "Unified is empty until a GraphView is explicitly selected.",
        })
    warnings.extend(
        {
            "authority": str(reference.get("referenceType") or "agentgraph"),
            "code": "optional_reference_unavailable",
            "detail": str(reference.get("referenceId") or ""),
        }
        for reference in manifest["unresolvedReferences"]
    )
    cross_ms = (time.perf_counter() - cross_started) * 1000

    serialization_started = time.perf_counter()
    configuration = {
        "projectId": request.project_id,
        "conversationId": request.conversation_id,
        "role": request.role,
        "activeGraphViewId": selected_view_id,
        "activeGraphViewIds": requested_view_ids,
        "knowgraphScope": request.knowgraph_scope,
        "limits": limits,
    }
    configuration_hash = hashlib.sha256(json.dumps(configuration, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    content_identity = {
        "configurationHash": configuration_hash,
        "selectedGraphViewIds": [view.get("viewId") for view in selected_views],
        "manifestHash": manifest["manifestHash"],
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
        "manifest": manifest,
        "lifecycle": lifecycle,
        "nodes": nodes,
        "edges": edges,
        "regions": [{"id": key, **value} for key, value in AUTHORITY.items()],
        "counts": {
            "available": {key: len(raw_nodes[key]) for key in AUTHORITY},
            "selected": {
                key: sum(
                    1
                    for record in manifest["records"]
                    if record["authority"] == key
                )
                for key in AUTHORITY
            },
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
        "activeGraphViewIds": list(request.active_view_ids),
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


# ---------------------------------------------------------------------------
# Compact model representation: the text a model invocation consumes, derived
# deterministically from the SAME projection the Unified surface renders.
# The projection decides membership; this layer only renders that membership
# efficiently. An AgentGraph view is already a bounded reference selection; this
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


def _new_render_state() -> dict[str, Any]:
    return {"referenceCount": 0}


def _render_view_lines(view: dict[str, Any], state: dict[str, Any]) -> list[str]:
    """Serialize only AgentGraph pointer identities for on-demand resolution."""
    references = list(view.get("references") or [])
    if len(references) > MAX_GRAPH_VIEW_REFERENCES:
        raise ValueError(
            "graph_view_reference_limit_exceeded: "
            f"{len(references)}>{MAX_GRAPH_VIEW_REFERENCES}"
        )
    lines: list[str] = [
        f"view: {view.get('viewId')} | authority: agentgraph | project: {view.get('projectId')} | "
        f"conversation: {view.get('conversationId')} | status: {view.get('status')} | "
        f"references: {len(references)}"
    ]
    if _flat(view.get("displayLabel")):
        lines.append(
            f"label: {_bounded_field(view.get('displayLabel'), field='displayLabel')}"
        )
    for reference in references:
        state["referenceCount"] += 1
        lines.append(
            "- "
            f"{reference.get('referenceType')} -> {reference.get('referenceId')}"
            + (" [required]" if reference.get("required") else "")
        )
    if _flat(view.get("note")):
        lines.append(f"note: {_bounded_field(view.get('note'), field='note')}")
    return lines


def render_model_context(projection: dict[str, Any], role_views: list[dict[str, Any]]) -> dict[str, Any]:
    """Render the exact record representations materialized in Unified."""
    manifest = dict(projection.get("manifest") or {})
    records = list(manifest.get("records") or [])
    sections: dict[str, list[str]] = {
        "header": [
            "[DELIVERED_GRAPH_CONTEXT]",
            f"manifest: {manifest.get('manifestHash')} | projection: {projection.get('projectionId')} | "
            f"project: {projection.get('projectId')} | conversation: {projection.get('conversationId')} | "
            f"role: {projection.get('receivingRole')} | records: {len(records)}",
        ],
        "records": [
            f"- order={record.get('deliveryOrder')} required={str(bool(record.get('required'))).lower()} "
            f"hash={record.get('representationHash')} {record.get('representation')}"
            for record in records
        ],
        "unresolved": [
            "UNRESOLVED OPTIONAL REFERENCES:",
            *[
                f"- {reference.get('referenceType')}:{reference.get('referenceId')}"
                for reference in manifest.get("unresolvedReferences") or []
            ],
        ] if manifest.get("unresolvedReferences") else [],
        "retrieval": [
            "Records not listed above are not in this model-visible graph context. "
            "Use the card's saved native graph tools to retrieve more context when needed.",
        ],
    }
    ordered = ["header", "records", "unresolved", "retrieval"]
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
    view_measurements = {
        str(view.get("viewId")): {
            "references": len(view.get("references") or []),
            "characters": sum(
                int(record.get("characters") or 0)
                for record in records
                if record.get("selectedBy") == view.get("viewId")
            ),
            "estimatedTokens": _estimated_tokens(
                "".join(
                    str(record.get("representation") or "")
                    for record in records
                    if record.get("selectedBy") == view.get("viewId")
                )
            ),
        }
        for view in role_views
    }
    measurements = {
        "characters": len(text),
        "estimatedTokens": _estimated_tokens(text),
        "sections": section_measurements,
        "views": view_measurements,
        "projectionCounts": {
            authority: sum(
                1 for record in records if record.get("authority") == authority
            )
            for authority in AUTHORITY
        },
        "manifestHash": manifest.get("manifestHash"),
        "recordCount": len(records),
        "nodeCount": sum(1 for record in records if record.get("kind") == "node"),
        "edgeCount": sum(1 for record in records if record.get("kind") == "edge"),
        "graphViewCount": len(role_views),
        "graphReferenceCount": sum(len(view.get("references") or []) for view in role_views),
        "limits": {
            "selectedGraphViews": MAX_SELECTED_GRAPH_VIEWS,
            "graphViewReferences": MAX_GRAPH_VIEW_REFERENCES,
            "fieldCharacters": MAX_GRAPH_CONTEXT_FIELD_CHARACTERS,
            "recordCharacters": MAX_DELIVERED_RECORD_CHARACTERS,
            "contextCharacters": MAX_GRAPH_CONTEXT_CHARACTERS,
        },
    }
    return {"text": text, "measurements": measurements}


def render_graph_views(views: list[dict[str, Any]]) -> dict[str, Any]:
    """Render AgentGraph reference views without copying source records."""
    lines: list[str] = ["[LIQUIDAITY_GRAPH_CONTEXT]"]
    total_references = 0
    per_view: dict[str, dict[str, int]] = {}
    render_state = _new_render_state()
    for view in views:
        before_references = int(render_state["referenceCount"])
        view_lines = _render_view_lines(view, render_state)
        lines.extend(view_lines)
        rendered_references = int(render_state["referenceCount"]) - before_references
        total_references += rendered_references
        per_view[str(view.get("viewId"))] = {
            "references": rendered_references,
            "estimatedTokens": _estimated_tokens("\n".join(view_lines)),
        }
    lines.append(
        "Resolve these stable references through their named canonical tools; "
        "the referenced payloads are not embedded in AgentGraph."
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
            "references": total_references,
            "graphViewCount": len(views),
            "graphReferenceCount": total_references,
        },
    }


def build_graph_view_delivery(
    *,
    project_id: str,
    conversation_id: str,
    receiving_role: str,
    graph_view_ids: list[str] | tuple[str, ...],
    graph: ThinkGraphEngraphis | None = None,
    read_json: Callable[[str, dict[str, Any]], dict[str, Any]] = _get_json,
    read_codegraph_json: Callable[[str, dict[str, Any]], dict[str, Any]] = _get_codegraph_json,
) -> dict[str, Any]:
    """Compile exact selected GraphViews once for assignment delivery/readback."""
    request = UnifiedContextRequest(
        project_id=project_id,
        conversation_id=conversation_id,
        role=receiving_role,
        active_view_ids=tuple(graph_view_ids),
    )
    projection = build_unified_context(
        request,
        graph=graph,
        read_json=read_json,
        read_codegraph_json=read_codegraph_json,
    )
    selected = list(projection.get("graphViews") or [])
    rendered = render_model_context(projection, selected)
    return {
        "ok": True,
        "projectionId": projection.get("projectionId"),
        "activeGraphViewId": projection.get("activeGraphViewId"),
        "graphViews": selected,
        "manifest": projection.get("manifest") or {},
        "nodes": projection.get("nodes") or [],
        "edges": projection.get("edges") or [],
        "modelContext": rendered["text"],
        "measurements": rendered["measurements"],
        "warnings": projection.get("warnings") or [],
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
    persisted = list(
        agentgraph.list_graph_views(
            project_id=request.project_id,
            conversation_id=request.conversation_id,
            limit=50,
        ).get("views") or []
    )
    role_views = select_persisted_graph_views(
        persisted,
        list(request.active_view_ids) or (
            [request.active_view_id] if request.active_view_id else []
        ),
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
        "manifest": rebuilt.get("manifest") or {},
        "graphViews": graph_view_identities(role_views),
        "warnings": rebuilt.get("warnings") or [],
    }
