# Entity: Graph Navigation Context
# Relationship: Validates, bounds, pre-renders, and atomically swaps the visible Think/Know/Code navigation map used by the dashboard and pre-LLM hook.
"""Atomic in-process JSON navigation map shared by the dashboard and pre-LLM hook."""

from __future__ import annotations

import hashlib
import json
import math
import re
import threading
from typing import Any


SCHEMA_VERSION = "liquidaity.navigation-map.v1"
LAYER_ORDER = ("thinkgraph", "knowgraph", "codegraph")
MAX_NODES = 512
MAX_RELATIONSHIPS = 1_024
MAX_CONTEXT_CHARS = 9_500

_PUBLISH_LOCK = threading.Lock()
_PROFILE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")
_EMPTY_STATUS = {
    "available": False,
    "projectId": "",
    "layers": [],
    "nodes": 0,
    "relationships": 0,
    "focused": False,
    "sha256": "",
    "bytes": 0,
    "estimatedTokens": 0,
}
_SNAPSHOTS: dict[str, tuple[str, dict[str, Any]]] = {}


def _profile(value: Any) -> str:
    profile = str(value or "").strip().lower()
    if not _PROFILE.fullmatch(profile):
        raise ValueError("navigation_map_profile_invalid")
    return profile


def _text(value: Any, field: str, maximum: int) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > maximum:
        raise ValueError(f"navigation_map_{field}_invalid")
    return value


def _canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _normalized_map(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != {
        "schemaVersion", "projectId", "layers", "revision", "nodes", "relationships", "focus"
    }:
        raise ValueError("navigation_map_contract_invalid")
    if value.get("schemaVersion") != SCHEMA_VERSION:
        raise ValueError("navigation_map_schema_invalid")
    project_id = _text(value.get("projectId"), "project", 256)
    revision = _text(value.get("revision"), "revision", 2_048)
    raw_layers = value.get("layers")
    if not isinstance(raw_layers, list) or any(layer not in LAYER_ORDER for layer in raw_layers):
        raise ValueError("navigation_map_layers_invalid")
    if len(set(raw_layers)) != len(raw_layers):
        raise ValueError("navigation_map_layers_invalid")
    layers = [layer for layer in LAYER_ORDER if layer in raw_layers]

    raw_nodes = value.get("nodes")
    if not isinstance(raw_nodes, list) or len(raw_nodes) > MAX_NODES:
        raise ValueError("navigation_map_nodes_invalid")
    nodes: list[list[Any]] = []
    pointer_ids: set[tuple[str, str]] = set()
    for raw_node in raw_nodes:
        if not isinstance(raw_node, list) or len(raw_node) != 3:
            raise ValueError("navigation_map_node_invalid")
        name = _text(raw_node[0], "node_name", 256)
        kind = raw_node[1]
        if kind not in {"Entity", "File"}:
            raise ValueError("navigation_map_node_kind_invalid")
        raw_pointers = raw_node[2]
        if not isinstance(raw_pointers, list) or not 1 <= len(raw_pointers) <= len(LAYER_ORDER):
            raise ValueError("navigation_map_node_pointers_invalid")
        pointers: list[list[str]] = []
        for raw_pointer in raw_pointers:
            if not isinstance(raw_pointer, list) or len(raw_pointer) != 2:
                raise ValueError("navigation_map_pointer_invalid")
            authority = raw_pointer[0]
            if authority not in layers:
                raise ValueError("navigation_map_pointer_authority_invalid")
            provider_id = _text(raw_pointer[1], "pointer_id", 1_024)
            identity = (authority, provider_id)
            if identity in pointer_ids:
                raise ValueError("navigation_map_pointer_duplicate")
            pointer_ids.add(identity)
            pointers.append([authority, provider_id])
        pointers.sort(key=lambda pointer: LAYER_ORDER.index(pointer[0]))
        nodes.append([name, kind, pointers])

    raw_relationships = value.get("relationships")
    if not isinstance(raw_relationships, list) or len(raw_relationships) > MAX_RELATIONSHIPS:
        raise ValueError("navigation_map_relationships_invalid")
    relationships: list[list[Any]] = []
    relationship_ids: set[tuple[str, str]] = set()
    for raw_relationship in raw_relationships:
        if not isinstance(raw_relationship, list) or len(raw_relationship) != 5:
            raise ValueError("navigation_map_relationship_invalid")
        authority, raw_id, source, raw_predicate, target = raw_relationship
        if authority not in layers:
            raise ValueError("navigation_map_relationship_authority_invalid")
        provider_id = _text(raw_id, "relationship_id", 1_024)
        predicate = _text(raw_predicate, "relationship_predicate", 256)
        if (
            isinstance(source, bool) or not isinstance(source, int)
            or isinstance(target, bool) or not isinstance(target, int)
            or not 0 <= source < len(nodes) or not 0 <= target < len(nodes)
        ):
            raise ValueError("navigation_map_relationship_endpoint_invalid")
        identity = (authority, provider_id)
        if identity in relationship_ids:
            raise ValueError("navigation_map_relationship_duplicate")
        relationship_ids.add(identity)
        relationships.append([authority, provider_id, source, predicate, target])

    raw_focus = value.get("focus")
    focus = None
    if raw_focus is not None:
        if not isinstance(raw_focus, list) or len(raw_focus) != 4:
            raise ValueError("navigation_map_focus_invalid")
        node_index, raw_thinks, raw_knows, raw_code_nodes = raw_focus
        if (
            isinstance(node_index, bool) or not isinstance(node_index, int)
            or not 0 <= node_index < len(nodes)
            or not isinstance(raw_thinks, list) or len(raw_thinks) > 2
            or not isinstance(raw_knows, list) or len(raw_knows) > 2
            or not isinstance(raw_code_nodes, list) or len(raw_code_nodes) > 64
        ):
            raise ValueError("navigation_map_focus_invalid")
        if (
            (raw_thinks and "thinkgraph" not in layers)
            or (raw_knows and "knowgraph" not in layers)
            or (raw_code_nodes and "codegraph" not in layers)
        ):
            raise ValueError("navigation_map_focus_hidden_layer")
        thinks: list[list[str]] = []
        for raw_think in raw_thinks:
            if not isinstance(raw_think, list) or len(raw_think) != 3:
                raise ValueError("navigation_map_focus_think_invalid")
            thinks.append([
                _text(raw_think[0], "focus_think_id", 1_024),
                _text(raw_think[1], "focus_think_title", 256),
                _text(raw_think[2], "focus_think_text", 4_000),
            ])
        knows: list[list[str]] = []
        for raw_know in raw_knows:
            if not isinstance(raw_know, list) or len(raw_know) != 5:
                raise ValueError("navigation_map_focus_know_invalid")
            knows.append([
                _text(raw_know[0], "focus_know_id", 1_024),
                _text(raw_know[1], "focus_know_title", 256),
                _text(raw_know[2], "focus_know_observation", 4_000),
                _text(raw_know[3], "focus_know_interpretation", 4_000),
                str(raw_know[4] or "")[:2_048] if isinstance(raw_know[4], str) else "",
            ])
        code_nodes: list[int] = []
        for raw_index in raw_code_nodes:
            if (
                isinstance(raw_index, bool) or not isinstance(raw_index, int)
                or not 0 <= raw_index < len(nodes)
                or nodes[raw_index][1] != "File"
                or raw_index in code_nodes
            ):
                raise ValueError("navigation_map_focus_code_invalid")
            code_nodes.append(raw_index)
        focus = [node_index, thinks, knows, code_nodes]

    return {
        "schemaVersion": SCHEMA_VERSION,
        "projectId": project_id,
        "layers": layers,
        "revision": revision,
        "nodes": nodes,
        "relationships": relationships,
        "focus": focus,
    }


def publish_navigation_map(value: Any, profile: str) -> dict[str, Any]:
    """Validate and atomically replace the one pre-rendered context snapshot."""

    normalized = _normalized_map(value)
    identity_json = _canonical_json(normalized)
    sha256 = hashlib.sha256(identity_json.encode("utf-8")).hexdigest()
    document = {**normalized, "sha256": sha256}
    rendered = _canonical_json(document)
    context = "\n".join((
        "### Shared Entity/Relationship Navigation Map",
        (
            "This is the exact graph projection configured in the LiquidAIty UI. "
            "nodes=[name,kind,[[authority,providerId],...]]; "
            "relationships=[authority,providerRelationshipId,sourceNodeIndex,predicate,targetNodeIndex]. "
            "focus=[openNodeIndex,thinks,knows,relatedCodeNodeIndexes] when one node is open. "
            "Hidden graph sources are absent. Use granted Engraphis, Graphiti, CBM, or AGE tools "
            "with these pointers for deeper reads. When one node is open, focus may include at most two "
            "visible Think bodies, two visible Know observations/interpretations, and related visible Code pointers."
        ),
        rendered,
    ))
    if len(context) > MAX_CONTEXT_CHARS:
        raise ValueError("navigation_map_context_limit_exceeded")
    status = {
        "available": True,
        "projectId": normalized["projectId"],
        "layers": list(normalized["layers"]),
        "nodes": len(normalized["nodes"]),
        "relationships": len(normalized["relationships"]),
        "focused": normalized["focus"] is not None,
        "sha256": sha256,
        "bytes": len(rendered.encode("utf-8")),
        "estimatedTokens": math.ceil(len(context.encode("utf-8")) / 4),
    }
    profile = _profile(profile)
    with _PUBLISH_LOCK:
        _SNAPSHOTS[profile] = (context, status)
    return dict(status)


def clear_navigation_map(profile: str) -> dict[str, Any]:
    profile = _profile(profile)
    with _PUBLISH_LOCK:
        _SNAPSHOTS.pop(profile, None)
    return dict(_EMPTY_STATUS)


def navigation_context(profile: str) -> str:
    """Hot path: one atomic tuple read, no lock, I/O, parsing, or serialization."""

    return _SNAPSHOTS.get(_profile(profile), ("", _EMPTY_STATUS))[0]


def navigation_status(profile: str) -> dict[str, Any]:
    return dict(_SNAPSHOTS.get(_profile(profile), ("", _EMPTY_STATUS))[1])
