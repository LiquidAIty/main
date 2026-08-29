"""Bounded native graph-reference observation at the official MCP boundary.

The native graph authorities keep their own schemas and data.  This module only
extracts stable IDs from explicitly declared tool contracts; it never copies a
graph result or infers graph access from prose.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timezone
from hashlib import sha256
from typing import Any, Callable, Literal
from uuid import uuid4

from mcp.types import CallToolResult

NATIVE_ATTENTION_NODE_LIMIT = 128
NATIVE_ATTENTION_EDGE_LIMIT = 256

Authority = Literal["codegraph", "knowgraph", "thinkgraph", "agentgraph"]
Operation = Literal["read", "write"]
Extractor = Callable[[str, dict[str, Any]], tuple[list[str], list[str]]]
EdgeExtractor = Callable[[str, dict[str, Any]], list[dict[str, Any]]]


@dataclass(frozen=True)
class NativeAttentionContract:
    authority: Authority
    operation: Operation
    extractor: Extractor
    edge_extractor: EdgeExtractor | None = None


def _text(value: Any) -> str:
    return str(value or "").strip()


def _records(payload: dict[str, Any], *keys: str) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for key in keys:
        value = payload.get(key)
        if isinstance(value, list):
            result.extend(item for item in value if isinstance(item, dict))
    return result


def _values(records: list[dict[str, Any]], *keys: str) -> list[str]:
    result: list[str] = []
    for record in records:
        for key in keys:
            value = _text(record.get(key))
            if value:
                result.append(value)
                break
    return result


def _all_values(records: list[dict[str, Any]], *keys: str) -> list[str]:
    """Return every explicitly named value from native result records."""
    result: list[str] = []
    for record in records:
        for key in keys:
            value = _text(record.get(key))
            if value:
                result.append(value)
    return result


def _edge_reference(record: dict[str, Any]) -> dict[str, Any] | None:
    edge_id = _text(record.get("uuid") or record.get("id") or record.get("edge_id"))
    source = _text(
        record.get("source_node_uuid")
        or record.get("source")
        or record.get("from")
        or record.get("a")
    )
    target = _text(
        record.get("target_node_uuid")
        or record.get("target")
        or record.get("to")
        or record.get("b")
    )
    if not edge_id or not source or not target:
        return None
    predicate = _text(
        record.get("name")
        or record.get("type")
        or record.get("edge_type")
        or record.get("predicate")
        or record.get("relation")
    )
    provenance = {
        key: record[key]
        for key in ("group_id", "episodes", "source_description")
        if record.get(key) is not None
    }
    return {
        "id": edge_id,
        "source": source,
        "target": target,
        "predicate": predicate or None,
        **({"provenance": provenance} if provenance else {}),
    }


def _edge_references(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [reference for record in records if (reference := _edge_reference(record))]


def _tabular_records(payload: dict[str, Any]) -> list[dict[str, Any]]:
    """Decode current CBM ``cols``/``rows`` results without interpreting prose."""

    records: list[dict[str, Any]] = []

    def append_rows(
        columns: Any,
        rows: Any,
        *,
        qualified_name_prefix: str = "",
        file_path: str = "",
    ) -> None:
        if not (
            isinstance(columns, list)
            and all(isinstance(column, str) for column in columns)
            and isinstance(rows, list)
        ):
            return
        for row in rows:
            if isinstance(row, dict):
                record = dict(row)
            elif isinstance(row, list):
                record = {
                    column: row[index]
                    for index, column in enumerate(columns)
                    if index < len(row)
                }
            else:
                continue
            name = _text(record.get("name"))
            if (
                qualified_name_prefix
                and name
                and not _text(record.get("qualified_name") or record.get("qn"))
            ):
                record["qualified_name"] = f"{qualified_name_prefix}.{name}"
            if file_path and not _text(record.get("file") or record.get("file_path")):
                record["file_path"] = file_path
            records.append(record)

    columns = payload.get("cols")
    append_rows(columns, payload.get("rows"))
    groups = payload.get("groups")
    if isinstance(groups, list):
        for group in groups:
            if not isinstance(group, dict):
                continue
            append_rows(
                group.get("cols") or columns,
                group.get("rows"),
                qualified_name_prefix=_text(
                    group.get("prefix")
                    or group.get("qn_prefix")
                    or group.get("qualified_name_prefix")
                ),
                file_path=_text(group.get("file") or group.get("file_path")),
            )
    return records


def _extract_codegraph(tool_name: str, payload: dict[str, Any]) -> tuple[list[str], list[str]]:
    table_records = _tabular_records(payload)
    if tool_name == "cbm.search_graph":
        records = [*_records(payload, "results", "semantic_results"), *table_records]
        return _all_values(records, "qualified_name", "qn", "file_path", "file"), []
    if tool_name == "cbm.trace_path":
        records = [*_records(payload, "callers", "callees"), *table_records]
        for key in ("callers", "callees"):
            if isinstance(payload.get(key), dict):
                records.extend(_tabular_records(payload[key]))
        nodes = _all_values(records, "qualified_name", "qn", "file_path", "file")
        if _text(payload.get("function")):
            nodes.insert(0, _text(payload["function"]))
        return nodes, []
    if tool_name == "cbm.search_code":
        records = [*_records(payload, "results"), *table_records]
        raw_matches = payload.get("raw_matches")
        if isinstance(raw_matches, dict):
            records.extend(_tabular_records(raw_matches))
        nodes = _all_values(records, "qualified_name", "qn", "file_path", "file")
        files = payload.get("files")
        if isinstance(files, list):
            nodes.extend(_text(item) for item in files if _text(item))
        return nodes, []
    if tool_name == "cbm.get_code_snippet":
        return _all_values(
            [payload, *table_records],
            "qualified_name", "qn", "file_path", "file",
        ), []
    if tool_name == "cbm.query_graph":
        records = [*_records(payload, "rows", "results"), *table_records]
        return _all_values(records, "qualified_name", "qn", "file_path", "file"), []
    if tool_name in {"cbm.list_projects", "cbm.index_status", "cbm.index_repository", "cbm.delete_project"}:
        projects = _values(_records(payload, "projects"), "name", "project")
        project = _text(payload.get("project") or payload.get("name"))
        if project:
            projects.insert(0, project)
        return projects, []
    if tool_name == "cbm.detect_changes":
        return _values(
            _records(payload, "changed_symbols", "affected_symbols", "symbols"),
            "qualified_name",
        ), []
    if tool_name == "cbm.manage_adr":
        adr_id = _text(payload.get("adr_id") or payload.get("id"))
        return ([adr_id] if adr_id else []), []
    return [], []


def _extract_knowgraph(tool_name: str, payload: dict[str, Any]) -> tuple[list[str], list[str]]:
    nodes: list[str] = []
    edges: list[str] = []
    if tool_name == "graphiti.search_nodes":
        nodes.extend(_values(_records(payload, "nodes"), "uuid"))
    elif tool_name == "graphiti.search_memory_facts":
        facts = _records(payload, "facts")
        nodes.extend(_values(facts, "source_node_uuid"))
        nodes.extend(_values(facts, "target_node_uuid"))
        edges.extend(_values(facts, "uuid"))
    elif tool_name == "graphiti.get_entity_edge":
        nodes.extend(filter(None, (
            _text(payload.get("source_node_uuid")),
            _text(payload.get("target_node_uuid")),
        )))
        edge_id = _text(payload.get("uuid"))
        if edge_id:
            edges.append(edge_id)
    elif tool_name == "graphiti.get_episodes":
        nodes.extend(_values(_records(payload, "episodes"), "uuid"))
    elif tool_name in {"graphiti.get_episode_entities", "graphiti.add_triplet", "graphiti.add_memory"}:
        native_edges = _records(payload, "edges", "facts")
        nodes.extend(_values(_records(payload, "episodes"), "uuid"))
        nodes.extend(_values(_records(payload, "nodes", "entities"), "uuid"))
        nodes.extend(_values(native_edges, "source_node_uuid"))
        nodes.extend(_values(native_edges, "target_node_uuid"))
        edges.extend(_values(native_edges, "uuid"))
    elif tool_name in {"graphiti.build_communities", "graphiti.summarize_saga"}:
        nodes.extend(_values(_records(payload, "communities"), "uuid"))
        top_uuid = _text(payload.get("uuid"))
        if top_uuid:
            nodes.append(top_uuid)
    return nodes, edges


def _extract_knowgraph_edges(tool_name: str, payload: dict[str, Any]) -> list[dict[str, Any]]:
    if tool_name in {"graphiti.search_memory_facts", "graphiti.get_episode_entities", "graphiti.add_triplet", "graphiti.add_memory"}:
        return _edge_references(_records(payload, "facts", "edges", "relationships"))
    if tool_name == "graphiti.get_entity_edge":
        reference = _edge_reference(payload)
        return [reference] if reference else []
    return []


def _extract_thinkgraph(tool_name: str, payload: dict[str, Any]) -> tuple[list[str], list[str]]:
    records = _records(
        payload,
        "memories",
        "answer",
        "supersedes",
        "history",
        "sources",
        "records",
        "nodes",
    )
    nodes = _values(records, "id", "memory_id")
    top_id = _text(
        payload.get("id")
        or payload.get("memory_id")
        or payload.get("nativeId")
        or payload.get("node_id")
    )
    if top_id and tool_name not in {
        "constellation.inspect_edge",
        "constellation.adjust_edge",
        "constellation.classify_edge",
        "constellation.edge_review",
    }:
        nodes.insert(0, top_id)
    for key in ("a", "b", "sourceId", "source_id", "nodeA", "nodeB"):
        value = _text(payload.get(key))
        if value:
            nodes.append(value)
    for key in ("result", "readback"):
        nested = payload.get(key)
        if isinstance(nested, dict):
            value = _text(
                nested.get("id")
                or nested.get("memory_id")
                or nested.get("nativeId")
                or nested.get("node_id")
            )
            if value:
                nodes.append(value)
    edge_ids: list[str] = []
    if tool_name in {
        "constellation.inspect_edge",
        "constellation.adjust_edge",
        "constellation.classify_edge",
        "constellation.edge_review",
    }:
        edge = payload.get("edge")
        edge_id = _text(
            payload.get("edgeId")
            or payload.get("edge_id")
            or (edge.get("id") if isinstance(edge, dict) else None)
            or payload.get("id")
        )
        if edge_id:
            edge_ids.append(edge_id)
    return nodes, edge_ids


def _extract_thinkgraph_edges(_tool_name: str, payload: dict[str, Any]) -> list[dict[str, Any]]:
    # Constellation returns authoritative edge endpoints/type/strength but does
    # not currently assign native edge IDs. Attention must not manufacture one.
    records = _records(payload, "edges")
    edge = payload.get("edge")
    if isinstance(edge, dict):
        records.append(edge)
    return _edge_references(records)


def _contracts() -> dict[str, NativeAttentionContract]:
    contracts: dict[str, NativeAttentionContract] = {
        "cbm.search_graph": NativeAttentionContract("codegraph", "read", _extract_codegraph),
        "cbm.trace_path": NativeAttentionContract("codegraph", "read", _extract_codegraph),
        "cbm.search_code": NativeAttentionContract("codegraph", "read", _extract_codegraph),
        "cbm.get_code_snippet": NativeAttentionContract("codegraph", "read", _extract_codegraph),
        "cbm.query_graph": NativeAttentionContract("codegraph", "read", _extract_codegraph),
        "cbm.list_projects": NativeAttentionContract("codegraph", "read", _extract_codegraph),
        "cbm.index_status": NativeAttentionContract("codegraph", "read", _extract_codegraph),
        "cbm.detect_changes": NativeAttentionContract("codegraph", "read", _extract_codegraph),
        "cbm.index_repository": NativeAttentionContract("codegraph", "write", _extract_codegraph),
        "cbm.delete_project": NativeAttentionContract("codegraph", "write", _extract_codegraph),
        "cbm.manage_adr": NativeAttentionContract("codegraph", "write", _extract_codegraph),
        "cbm.ingest_traces": NativeAttentionContract("codegraph", "write", _extract_codegraph),
        "graphiti.search_nodes": NativeAttentionContract("knowgraph", "read", _extract_knowgraph, _extract_knowgraph_edges),
        "graphiti.search_memory_facts": NativeAttentionContract("knowgraph", "read", _extract_knowgraph, _extract_knowgraph_edges),
        "graphiti.get_entity_edge": NativeAttentionContract("knowgraph", "read", _extract_knowgraph, _extract_knowgraph_edges),
        "graphiti.get_episodes": NativeAttentionContract("knowgraph", "read", _extract_knowgraph, _extract_knowgraph_edges),
        "graphiti.get_episode_entities": NativeAttentionContract("knowgraph", "read", _extract_knowgraph, _extract_knowgraph_edges),
        "graphiti.add_triplet": NativeAttentionContract("knowgraph", "write", _extract_knowgraph, _extract_knowgraph_edges),
        "graphiti.add_memory": NativeAttentionContract("knowgraph", "write", _extract_knowgraph, _extract_knowgraph_edges),
        "graphiti.delete_entity_edge": NativeAttentionContract("knowgraph", "write", _extract_knowgraph),
        "graphiti.delete_episode": NativeAttentionContract("knowgraph", "write", _extract_knowgraph),
        "graphiti.clear_graph": NativeAttentionContract("knowgraph", "write", _extract_knowgraph),
        "graphiti.build_communities": NativeAttentionContract("knowgraph", "write", _extract_knowgraph, _extract_knowgraph_edges),
        "graphiti.summarize_saga": NativeAttentionContract("knowgraph", "write", _extract_knowgraph, _extract_knowgraph_edges),
    }
    for name in (
        "constellation.capabilities",
        "constellation.stats",
        "constellation.context",
        "constellation.inspect",
        "constellation.inspect_edge",
        "constellation.check_duplicate",
        "constellation.edge_types",
        "constellation.collide",
        "constellation.semantic_status",
        "constellation.semantic_context",
        "constellation.reembed_status",
        "constellation.identity_preview",
        "constellation.autonomy_status",
        "constellation.notification_status",
    ):
        contracts[name] = NativeAttentionContract(
            "thinkgraph", "read", _extract_thinkgraph, _extract_thinkgraph_edges
        )
    for name in (
        "constellation.remember",
        "constellation.remember_semantic",
        "constellation.update_memory",
        "constellation.link",
        "constellation.adjust_edge",
        "constellation.classify_edge",
        "constellation.forget",
        "constellation.maintain",
        "constellation.reembed_start",
        "constellation.reembed_cancel",
        "constellation.identity_apply",
        "constellation.edge_review",
        "constellation.adjust_edge_pair",
        "constellation.classify_edge_pair",
        "constellation.inject_message",
    ):
        contracts[name] = NativeAttentionContract(
            "thinkgraph", "write", _extract_thinkgraph, _extract_thinkgraph_edges
        )
    return contracts


NATIVE_ATTENTION_CONTRACTS = _contracts()


def canonical_native_tool_name(tool_name: str) -> str | None:
    """Resolve canonical dotted names, including Hermes-safe MCP aliases, once."""
    name = _text(tool_name)
    if name in NATIVE_ATTENTION_CONTRACTS:
        return name
    if not name.startswith("mcp__"):
        return None
    matches = [
        candidate
        for candidate in NATIVE_ATTENTION_CONTRACTS
        if name.endswith("__" + candidate.replace(".", "_"))
    ]
    return matches[0] if len(matches) == 1 else None


def _decoded(value: Any) -> Any:
    if not isinstance(value, str):
        return value
    try:
        return json.loads(value)
    except (TypeError, ValueError, json.JSONDecodeError):
        return None


def _result_payloads(result: Any) -> list[dict[str, Any]]:
    payloads: list[dict[str, Any]] = []
    if isinstance(result, dict):
        return [result]
    if isinstance(result, CallToolResult):
        structured = result.structuredContent
        if isinstance(structured, dict):
            candidate = _decoded(structured.get("result"))
            if isinstance(candidate, dict):
                payloads.append(candidate)
            elif isinstance(structured.get("result"), dict):
                payloads.append(structured["result"])
            elif structured:
                payloads.append(structured)
        blocks = result.content
    else:
        blocks = result if isinstance(result, list) else []
    for block in blocks:
        candidate = _decoded(getattr(block, "text", None))
        if isinstance(candidate, dict):
            payloads.append(candidate)
    return payloads


def _dedupe_and_cap(values: list[str], limit: int) -> tuple[list[str], bool]:
    unique: list[str] = []
    seen: set[str] = set()
    for value in values:
        normalized = _text(value)
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        unique.append(normalized)
    return unique[:limit], len(unique) > limit


def build_native_attention_event(
    tool_name: str,
    result: Any,
    context: dict[str, Any] | None,
    *,
    arguments: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    canonical_name = canonical_native_tool_name(tool_name)
    contract = NATIVE_ATTENTION_CONTRACTS.get(canonical_name or "")
    if contract is None:
        return None
    payloads = _result_payloads(result)
    if (isinstance(result, CallToolResult) and result.isError) or any(
        payload.get("error") or payload.get("ok") is False for payload in payloads
    ):
        return None
    phase = "completed"
    change = "read" if contract.operation == "read" else "write"
    scope_group_ids: list[str] = []
    node_ids: list[str] = []
    edge_ids: list[str] = []
    edge_references: list[dict[str, Any]] = []
    for payload in payloads:
        nodes, edges = contract.extractor(canonical_name or "", payload)
        node_ids.extend(nodes)
        edge_ids.extend(edges)
        if contract.edge_extractor is not None:
            edge_references.extend(contract.edge_extractor(canonical_name or "", payload))
    if canonical_name == "graphiti.add_memory":
        change = "create"
        # Native queue acceptance is not a write. Only the actual SDK
        # completion result supplies concrete entity/edge identities.
        phase = next((payload["phase"] for payload in payloads
                      if payload.get("phase") in {"pending", "completed", "failed"}), "completed")
    elif canonical_name in {"graphiti.delete_entity_edge", "graphiti.delete_episode"}:
        change = "delete"
        native_id = _text((arguments or {}).get("uuid"))
        # The validated native call succeeded for this exact requested UUID.
        if not payloads or not native_id:
            return None
        (edge_ids if canonical_name == "graphiti.delete_entity_edge" else node_ids).append(native_id)
    elif canonical_name == "graphiti.clear_graph":
        change = "clear"
        groups = (arguments or {}).get("group_ids")
        scope_group_ids = [groups] if isinstance(groups, str) else groups if isinstance(groups, list) else []
        scope_group_ids = [_text(value) for value in scope_group_ids if _text(value)][:128]
        if not payloads or not scope_group_ids:
            return None
    native_node_ids, nodes_truncated = _dedupe_and_cap(
        node_ids, NATIVE_ATTENTION_NODE_LIMIT
    )
    native_edge_ids, edges_truncated = _dedupe_and_cap(
        edge_ids, NATIVE_ATTENTION_EDGE_LIMIT
    )
    native_edges: list[dict[str, Any]] = []
    seen_edge_ids: set[str] = set()
    for reference in edge_references:
        edge_id = _text(reference.get("id"))
        source = _text(reference.get("source"))
        target = _text(reference.get("target"))
        if not edge_id or not source or not target or edge_id in seen_edge_ids:
            continue
        seen_edge_ids.add(edge_id)
        native_edges.append(reference)
    if len(native_edges) > NATIVE_ATTENTION_EDGE_LIMIT:
        edges_truncated = True
        native_edges = native_edges[:NATIVE_ATTENTION_EDGE_LIMIT]
    native_edge_ids, edge_id_refs_truncated = _dedupe_and_cap(
        [*native_edge_ids, *(str(edge["id"]) for edge in native_edges)],
        NATIVE_ATTENTION_EDGE_LIMIT,
    )
    edges_truncated = edges_truncated or edge_id_refs_truncated
    completed_without_ids = canonical_name == "graphiti.add_memory" and any(
        payload.get("phase") == "completed" for payload in payloads
    )
    if (not native_node_ids and not native_edge_ids and phase not in {"pending", "failed"}
            and change != "clear" and not completed_without_ids):
        return None
    normalized_references = {
        "nativeNodeIds": native_node_ids,
        "nativeEdgeIds": native_edge_ids,
        "nativeEdges": native_edges,
    }
    normalized = {
        "authority": contract.authority,
        "operation": contract.operation,
        "toolName": canonical_name,
        **normalized_references,
    }
    identity = context if isinstance(context, dict) else {}
    return {
        "eventId": f"native-attention:{uuid4()}",
        "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "projectId": _text(identity.get("projectId")) or None,
        "deckId": _text(identity.get("deckId")) or None,
        "conversationId": _text(identity.get("conversationId")) or None,
        "runId": _text(identity.get("parentRunId")) or None,
        "cardId": _text(identity.get("mainCardId")) or None,
        **({"nativeChildId": _text(identity["nativeChildId"])} if identity.get("nativeChildId") else {}),
        **({"nativeRunId": _text(identity["nativeRunId"])} if identity.get("nativeRunId") else {}),
        "phase": phase,
        "change": change,
        **({"scopeGroupIds": scope_group_ids} if scope_group_ids else {}),
        **normalized,
        "resultHash": sha256(
            json.dumps(
                normalized_references,
                ensure_ascii=False,
                sort_keys=True,
                separators=(",", ":"),
            ).encode("utf-8")
        ).hexdigest(),
        "truncated": nodes_truncated or edges_truncated,
    }
