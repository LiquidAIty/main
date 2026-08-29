"""Read-only native graph Data Anchor resolution before model dispatch.

The resolver opens native authorities in read-only mode and returns current
objects plus stable native identities. It never writes, recalls embeddings,
copies a graph, or turns a reference into synthetic data.
"""

from __future__ import annotations

from datetime import datetime, timezone
import json
import os
from pathlib import Path
from typing import Any, Callable

from app.python_models.internal_mcp import call_read_tools_via_mcp
from app.python_models.constellation import (
    ConstellationProcess,
    constellation_inspect,
)


_REPO_ROOT = Path(__file__).resolve().parents[4]
_ANCHOR_BODY_LIMIT = 12_000
_GRAPH_SEED_LIMIT = 48_000
_KNOWGRAPH_RESULT_LIMIT = 24
_CODEGRAPH_PROJECT = "C-Projects-LiquidAIty-main"


class DataAnchorError(ValueError):
    """Typed failure before a provider can receive an ungrounded request."""


def _json_value(value: Any) -> Any:
    if not isinstance(value, str) or not value.strip():
        return value
    try:
        return json.loads(value)
    except (TypeError, ValueError, json.JSONDecodeError):
        return value


def _json_safe(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, dict):
        return {str(key): _json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_json_safe(item) for item in value]
    iso_format = getattr(value, "iso_format", None)
    if callable(iso_format):
        return iso_format()
    return str(value)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def read_thinkgraph_exact(
    project_id: str,
    native_id: str,
    *,
    db_path: str | Path | None = None,
) -> dict[str, Any] | None:
    """Read one current project-scoped Constellation memory by native ID."""
    client: ConstellationProcess | None = None
    try:
        if db_path is None:
            native = constellation_inspect(
                project_id,
                {"nativeId": native_id, "maxDepth": 0, "budget": 12000},
            )
        else:
            path = Path(db_path).resolve()
            if not path.is_file():
                raise DataAnchorError("data_anchor_thinkgraph_unavailable")
            client = ConstellationProcess(project_id, database_path=path)
            native = client.request(
                "inspect",
                {"nativeId": native_id, "maxDepth": 0, "budget": 12000},
            )
    except Exception as error:
        raise DataAnchorError("data_anchor_thinkgraph_read_failed") from error
    finally:
        if client is not None:
            client.close()
    nodes = native.get("nodes") if isinstance(native, dict) else None
    inspected = native.get("inspectedNode") if isinstance(native, dict) else None
    row = inspected if isinstance(inspected, dict) else next(
        (
            item for item in (nodes or [])
            if isinstance(item, dict) and str(item.get("id") or "") == native_id
        ),
        None,
    )
    if row is None:
        return None
    tags = _json_value(row.get("tags"))
    tags = tags if isinstance(tags, list) else []
    if f"liquidaity-project:{project_id}" not in {str(tag) for tag in tags}:
        return None
    canonical_id = str(row["id"])
    title = str(row.get("l0") or row.get("content") or canonical_id)
    content = str(row.get("l2") or row.get("l1") or row.get("content") or title)
    return {
        "authority": "ThinkGraph",
        "nativeId": canonical_id,
        "nativeKind": "node",
        "recordId": canonical_id,
        "type": str(row.get("node_type") or "ConstellationMemory"),
        "title": title,
        "content": content[:_ANCHOR_BODY_LIMIT],
        "metadata": {
            "tags": tags,
            "level": row.get("level"),
            "distance": row.get("distance"),
        },
        "provenance": {
            "engine": native.get("engine"),
            "engineVersion": native.get("engineVersion"),
            "engineRevision": native.get("engineRevision"),
        },
        "asOf": "current",
        "readOperation": "constellation.inspect",
    }


def _neo4j_rows(result: Any) -> list[dict[str, Any]]:
    if hasattr(result, "data"):
        data = result.data()
        return [dict(row) for row in data]
    return [
        row.data() if hasattr(row, "data") else dict(row)
        for row in result
    ]


def read_knowgraph_exact(
    project_id: str,
    native_id: str,
    *,
    bounded_expansion: int = 0,
    result_limit: int = _KNOWGRAPH_RESULT_LIMIT,
    driver_factory: Callable[[], Any] | None = None,
) -> dict[str, Any] | None:
    """Read one project-scoped Neo4j object and a bounded current neighborhood."""
    if bounded_expansion < 0 or bounded_expansion > 3:
        raise DataAnchorError("data_anchor_expansion_invalid")
    if result_limit < 1 or result_limit > _KNOWGRAPH_RESULT_LIMIT:
        raise DataAnchorError("data_anchor_result_limit_invalid")
    uri = os.environ.get("NEO4J_URI", "").strip()
    user = os.environ.get("NEO4J_USER", "").strip()
    password = os.environ.get("NEO4J_PASSWORD", "").strip()
    database = os.environ.get("NEO4J_DATABASE", "neo4j").strip() or "neo4j"
    if driver_factory is None:
        if not uri or not user or not password:
            raise DataAnchorError("data_anchor_knowgraph_unavailable")
        try:
            from neo4j import GraphDatabase
        except ImportError as error:
            raise DataAnchorError("data_anchor_knowgraph_driver_unavailable") from error
        driver_factory = lambda: GraphDatabase.driver(uri, auth=(user, password))

    scope_ids = [project_id, f"liquidaity-{project_id}"]
    driver = driver_factory()
    try:
        with driver.session(database=database) as session:
            center_rows = _neo4j_rows(session.run(
                """
                MATCH (n)
                WHERE (elementId(n) = $nativeId OR toString(n.uuid) = $nativeId)
                  AND toString(n.group_id) IN $scopeIds
                RETURN coalesce(toString(n.uuid), elementId(n)) AS nativeId,
                       labels(n) AS labels, properties(n) AS properties
                LIMIT 1
                """,
                nativeId=native_id,
                scopeIds=scope_ids,
            ))
            relationship_center = False
            if not center_rows:
                center_rows = _neo4j_rows(session.run(
                    """
                    MATCH (a)-[r]->(b)
                    WHERE (elementId(r) = $nativeId OR toString(r.uuid) = $nativeId)
                      AND toString(a.group_id) IN $scopeIds
                      AND toString(b.group_id) IN $scopeIds
                      AND toString(r.group_id) IN $scopeIds
                    RETURN coalesce(toString(r.uuid), elementId(r)) AS nativeId,
                           [type(r)] AS labels, properties(r) AS properties,
                           coalesce(toString(a.uuid), elementId(a)) AS sourceNativeId,
                           coalesce(toString(b.uuid), elementId(b)) AS targetNativeId,
                           [{nativeId: coalesce(toString(a.uuid), elementId(a)),
                             labels: labels(a), properties: properties(a)},
                            {nativeId: coalesce(toString(b.uuid), elementId(b)),
                             labels: labels(b), properties: properties(b)}] AS endpointNodes
                    LIMIT 1
                    """,
                    nativeId=native_id,
                    scopeIds=scope_ids,
                ))
                relationship_center = bool(center_rows)
            if not center_rows:
                return None

            center = _json_safe(center_rows[0])
            paths: list[dict[str, Any]] = []
            if bounded_expansion and not relationship_center:
                paths = _neo4j_rows(session.run(
                    f"""
                    MATCH (center)
                    WHERE (elementId(center) = $nativeId OR toString(center.uuid) = $nativeId)
                      AND toString(center.group_id) IN $scopeIds
                    MATCH path=(center)-[*1..{bounded_expansion}]-(other)
                    WHERE ALL(node IN nodes(path)
                              WHERE toString(node.group_id) IN $scopeIds)
                      AND ALL(rel IN relationships(path)
                              WHERE toString(rel.group_id) IN $scopeIds)
                    RETURN [node IN nodes(path) | {{
                               nativeId: coalesce(toString(node.uuid), elementId(node)),
                               labels: labels(node), properties: properties(node)}}] AS nodes,
                           [rel IN relationships(path) | {{
                               nativeId: coalesce(toString(rel.uuid), elementId(rel)),
                               type: type(rel), properties: properties(rel),
                               sourceNativeId: coalesce(toString(startNode(rel).uuid), elementId(startNode(rel))),
                               targetNativeId: coalesce(toString(endNode(rel).uuid), elementId(endNode(rel)))}}] AS relationships
                    LIMIT $limit
                    """,
                    nativeId=native_id,
                    scopeIds=scope_ids,
                    limit=result_limit,
                ))
    except Exception as error:
        if isinstance(error, DataAnchorError):
            raise
        raise DataAnchorError("data_anchor_knowgraph_read_failed") from error
    finally:
        close = getattr(driver, "close", None)
        if callable(close):
            close()

    properties = center.get("properties") if isinstance(center.get("properties"), dict) else {}
    labels = center.get("labels") if isinstance(center.get("labels"), list) else []
    neighborhood = _json_safe(paths)[:result_limit]
    return {
        "authority": "KnowGraph",
        "nativeId": str(center.get("nativeId") or native_id),
        "nativeKind": "edge" if relationship_center else "node",
        "type": str(labels[0] if labels else "Neo4jObject"),
        "title": str(properties.get("name") or properties.get("title") or native_id),
        "content": json.dumps(
            {"properties": properties, "neighborhood": neighborhood},
            ensure_ascii=False,
            separators=(",", ":"),
            default=str,
        )[:_ANCHOR_BODY_LIMIT],
        "properties": properties,
        "endpointNodes": center.get("endpointNodes") if relationship_center else [],
        "sourceNativeId": str(center.get("sourceNativeId") or ""),
        "targetNativeId": str(center.get("targetNativeId") or ""),
        "relationshipEvidence": neighborhood,
        "provenance": {
            key: properties.get(key)
            for key in ("group_id", "source", "source_description", "created_at", "valid_at")
            if properties.get(key) is not None
        },
        "asOf": _now_iso(),
        "readOperation": "neo4j.project_scoped_exact",
        "resultLimit": result_limit,
        "truncated": bool(bounded_expansion and len(paths) >= result_limit),
    }


def read_codegraph_exact(
    project_id: str,
    deck_id: str,
    card_id: str,
    native_id: str,
    *,
    bounded_expansion: int = 0,
    result_limit: int = 24,
    mcp_reader: Callable[..., list[dict[str, Any]]] = call_read_tools_via_mcp,
) -> dict[str, Any] | None:
    """Read one qualified current symbol through the official MCP/CBM seam."""
    if bounded_expansion < 0 or bounded_expansion > 3:
        raise DataAnchorError("data_anchor_expansion_invalid")
    if result_limit < 1 or result_limit > 24:
        raise DataAnchorError("data_anchor_result_limit_invalid")
    if not deck_id or not card_id:
        raise DataAnchorError("data_anchor_codegraph_context_missing")
    calls: list[tuple[str, dict[str, Any]]] = [
        ("cbm.index_status", {"project": _CODEGRAPH_PROJECT}),
        ("cbm.get_code_snippet", {
            "project": _CODEGRAPH_PROJECT,
            "qualified_name": native_id,
            "include_neighbors": False,
        }),
    ]
    if bounded_expansion:
        calls.append(("cbm.trace_path", {
            "project": _CODEGRAPH_PROJECT,
            "function_name": native_id,
            "direction": "both",
            "depth": bounded_expansion,
            "mode": "calls",
            "include_tests": False,
            "limit": result_limit,
            "format": "json",
        }))
    try:
        results = mcp_reader(
            project_id=project_id,
            deck_id=deck_id,
            card_id=card_id,
            calls=calls,
        )
    except Exception as error:
        raise DataAnchorError("data_anchor_codegraph_read_failed") from error
    if len(results) != len(calls):
        raise DataAnchorError("data_anchor_codegraph_result_invalid")
    status, snippet = results[0], results[1]
    if status.get("status") != "ready" or status.get("project") != _CODEGRAPH_PROJECT:
        raise DataAnchorError("data_anchor_codegraph_not_ready")
    qualified_name = str(snippet.get("qualified_name") or "").strip()
    source = str(snippet.get("source") or "")
    if qualified_name != native_id or not source.strip():
        return None
    file_path = str(snippet.get("file_path") or "").replace("\\", "/")
    repo_prefix = str(_REPO_ROOT).replace("\\", "/").rstrip("/") + "/"
    if file_path.lower().startswith(repo_prefix.lower()):
        file_path = file_path[len(repo_prefix):]
    relationships = results[2] if len(results) > 2 else {}
    evidence = {
        key: _codegraph_trace_records(relationships.get(key))
        for key in ("callers", "callees")
        if _codegraph_trace_records(relationships.get(key))
    }
    return {
        "authority": "CodeGraph",
        "nativeId": qualified_name,
        "nativeKind": "node",
        "type": str(snippet.get("label") or "Symbol"),
        "title": str(snippet.get("name") or qualified_name.rsplit(".", 1)[-1]),
        "content": source[:_ANCHOR_BODY_LIMIT],
        "properties": {
            "project": status["project"],
            "status": status["status"],
            "nodes": status.get("nodes"),
            "edges": status.get("edges"),
            "file": file_path,
            "startLine": snippet.get("start_line"),
            "endLine": snippet.get("end_line"),
            "signature": snippet.get("signature"),
            "fingerprint": snippet.get("fp"),
        },
        "relationshipEvidence": evidence,
        "provenance": {
            "project": _CODEGRAPH_PROJECT,
            "repositoryRoot": str(_REPO_ROOT).replace("\\", "/"),
            "qualifiedSymbol": qualified_name,
        },
        "asOf": _now_iso(),
        "readOperation": "cbm.get_code_snippet",
        "truncated": bool(relationships.get("truncated") is True),
    }


def _codegraph_trace_records(value: Any) -> list[dict[str, Any]]:
    """Normalize native CBM JSON trace rows without interpreting their meaning."""
    if isinstance(value, list):
        return [dict(item) for item in value if isinstance(item, dict)]
    if not isinstance(value, dict):
        return []
    columns = value.get("cols")
    groups = value.get("groups")
    if not isinstance(columns, list) or not isinstance(groups, list):
        return []
    records: list[dict[str, Any]] = []
    for group in groups:
        if not isinstance(group, dict):
            continue
        prefix = str(group.get("qn_prefix") or "").strip()
        rows = group.get("rows")
        if not isinstance(rows, list):
            continue
        for row in rows:
            if not isinstance(row, list) or len(row) != len(columns):
                continue
            record = {str(columns[index]): item for index, item in enumerate(row)}
            name = str(record.get("name") or "").strip()
            if name:
                record["qualified_name"] = f"{prefix}.{name}" if prefix else name
            records.append(record)
    return records


def _payload_records(payload: dict[str, Any], key: str) -> list[dict[str, Any]]:
    current: Any = payload
    for _ in range(3):
        if not isinstance(current, dict):
            return []
        records = current.get(key)
        if isinstance(records, list):
            return [dict(item) for item in records if isinstance(item, dict)]
        nested = current.get("result")
        if isinstance(nested, dict):
            current = nested
            continue
        break
    return []


def _string_values(value: Any) -> list[str]:
    if isinstance(value, str):
        return [value.strip()] if value.strip() else []
    if not isinstance(value, list):
        return []
    return [str(item).strip() for item in value if str(item).strip()]


def _episode_ids(item: dict[str, Any]) -> list[str]:
    values: list[str] = []
    for key in ("episode_uuids", "episodes", "source_episode_uuids"):
        raw = item.get(key)
        if isinstance(raw, list):
            for value in raw:
                if isinstance(value, dict):
                    text = str(value.get("uuid") or "").strip()
                else:
                    text = str(value or "").strip()
                if text:
                    values.append(text)
        elif isinstance(raw, str) and raw.strip():
            values.append(raw.strip())
    return list(dict.fromkeys(values))


def _knowgraph_node_record(
    item: dict[str, Any],
    *,
    query: str,
    centered: bool,
    result_index: int,
) -> dict[str, Any] | None:
    native_id = str(item.get("uuid") or item.get("nativeId") or "").strip()
    if not native_id:
        return None
    name = str(item.get("name") or item.get("title") or native_id).strip()
    aliases = _string_values(item.get("aliases"))
    exact_alias = query.casefold() in {name.casefold(), *(alias.casefold() for alias in aliases)}
    labels = _string_values(item.get("labels") or item.get("entity_types"))
    properties = _json_safe(item)
    episode_ids = _episode_ids(item)
    return {
        "authority": "KnowGraph",
        "nativeId": native_id,
        "nativeKind": "node",
        "type": labels[0] if labels else str(item.get("type") or "Entity"),
        "title": name,
        "content": json.dumps(properties, ensure_ascii=False, separators=(",", ":"))[:_ANCHOR_BODY_LIMIT],
        "properties": properties,
        "relationshipEvidence": [],
        "provenance": {"episodeUuids": episode_ids},
        "asOf": str(item.get("updated_at") or item.get("created_at") or _now_iso()),
        "readOperation": "graphiti.search_nodes",
        "selectionReason": (
            "exact entity identity or alias match"
            if exact_alias else
            "bounded graph-proximity result" if centered else
            "semantic entity result"
        ),
        "_rank": (1 if exact_alias else 4 if centered else 5, result_index),
    }


def _knowgraph_fact_record(
    item: dict[str, Any],
    *,
    centered: bool,
    result_index: int,
) -> dict[str, Any] | None:
    native_id = str(item.get("uuid") or item.get("nativeId") or "").strip()
    if not native_id:
        return None
    source_id = str(item.get("source_node_uuid") or "").strip()
    target_id = str(item.get("target_node_uuid") or "").strip()
    properties = _json_safe(item)
    episode_ids = _episode_ids(item)
    valid_at = str(item.get("valid_at") or "").strip()
    invalid_at = str(item.get("invalid_at") or "").strip()
    return {
        "authority": "KnowGraph",
        "nativeId": native_id,
        "nativeKind": "edge",
        "type": str(item.get("name") or item.get("edge_type") or "Fact"),
        "title": str(item.get("fact") or item.get("name") or native_id)[:500],
        "content": json.dumps(properties, ensure_ascii=False, separators=(",", ":"))[:_ANCHOR_BODY_LIMIT],
        "properties": properties,
        "relationshipEvidence": [{
            "sourceNodeUuid": source_id,
            "targetNodeUuid": target_id,
            "validAt": valid_at or None,
            "invalidAt": invalid_at or None,
        }],
        "provenance": {"episodeUuids": episode_ids},
        "asOf": str(item.get("created_at") or _now_iso()),
        "readOperation": "graphiti.search_memory_facts",
        "selectionReason": (
            "bounded fact near the strongest anchor" if centered else "semantic fact result"
        ),
        "_rank": (2 if not centered else 3, result_index, 0 if valid_at and not invalid_at else 1),
    }


def search_knowgraph_hybrid(
    project_id: str,
    deck_id: str,
    card_id: str,
    query: str,
    *,
    exact_records: list[dict[str, Any]] | None = None,
    entity_types: list[str] | None = None,
    edge_types: list[str] | None = None,
    valid_at_after: str = "",
    valid_at_before: str = "",
    invalid_at_after: str = "",
    invalid_at_before: str = "",
    max_nodes: int = 8,
    max_facts: int = 8,
    bounded_expansion: int = 1,
    mcp_reader: Callable[..., list[dict[str, Any]]] = call_read_tools_via_mcp,
) -> dict[str, Any]:
    """Resolve one bounded hybrid KnowGraph search through the official MCP host."""
    query = str(query or "").strip()
    if not query:
        raise DataAnchorError("data_anchor_knowgraph_search_query_required")
    if not deck_id or not card_id:
        raise DataAnchorError("data_anchor_knowgraph_context_missing")
    if not 1 <= max_nodes <= 20 or not 1 <= max_facts <= 20:
        raise DataAnchorError("data_anchor_knowgraph_limit_invalid")
    if not 0 <= bounded_expansion <= 3:
        raise DataAnchorError("data_anchor_expansion_invalid")

    node_args: dict[str, Any] = {"query": query, "max_nodes": max_nodes}
    fact_args: dict[str, Any] = {"query": query, "max_facts": max_facts}
    if entity_types:
        node_args["entity_types"] = list(entity_types)
    if edge_types:
        fact_args["edge_types"] = list(edge_types)
    for key, value in (
        ("valid_at_after", valid_at_after),
        ("valid_at_before", valid_at_before),
        ("invalid_at_after", invalid_at_after),
        ("invalid_at_before", invalid_at_before),
    ):
        if value:
            fact_args[key] = value

    initial = mcp_reader(
        project_id=project_id,
        deck_id=deck_id,
        card_id=card_id,
        calls=[
            ("graphiti.search_nodes", node_args),
            ("graphiti.search_memory_facts", fact_args),
        ],
        concurrent=True,
    )
    if len(initial) != 2:
        raise DataAnchorError("data_anchor_knowgraph_search_result_invalid")
    node_rows = _payload_records(initial[0], "nodes")
    fact_rows = _payload_records(initial[1], "facts")

    records: list[dict[str, Any]] = []
    for index, record in enumerate(exact_records or []):
        current = dict(record)
        current["selectionReason"] = str(
            current.pop("_selectionReason", "explicit native reference")
        )
        current["_rank"] = (0, index)
        records.append(current)
    for index, item in enumerate(node_rows):
        record = _knowgraph_node_record(item, query=query, centered=False, result_index=index)
        if record is not None:
            records.append(record)
    for index, item in enumerate(fact_rows):
        record = _knowgraph_fact_record(item, centered=False, result_index=index)
        if record is not None:
            records.append(record)

    strongest_node_id = next((
        record["nativeId"] for record in records
        if record.get("type") not in {"Fact", "RELATIONSHIP"}
        and record.get("readOperation") != "graphiti.search_memory_facts"
    ), "")
    centered_node_rows: list[dict[str, Any]] = []
    centered_fact_rows: list[dict[str, Any]] = []
    if bounded_expansion and strongest_node_id:
        centered_node_args = {**node_args, "center_node_uuid": strongest_node_id}
        centered_fact_args = {**fact_args, "center_node_uuid": strongest_node_id}
        centered = mcp_reader(
            project_id=project_id,
            deck_id=deck_id,
            card_id=card_id,
            calls=[
                ("graphiti.search_nodes", centered_node_args),
                ("graphiti.search_memory_facts", centered_fact_args),
            ],
            concurrent=True,
        )
        if len(centered) != 2:
            raise DataAnchorError("data_anchor_knowgraph_centered_result_invalid")
        centered_node_rows = _payload_records(centered[0], "nodes")
        centered_fact_rows = _payload_records(centered[1], "facts")
        for index, item in enumerate(centered_node_rows):
            record = _knowgraph_node_record(item, query=query, centered=True, result_index=index)
            if record is not None:
                records.append(record)
        for index, item in enumerate(centered_fact_rows):
            record = _knowgraph_fact_record(item, centered=True, result_index=index)
            if record is not None:
                records.append(record)

    records.sort(key=lambda item: item.get("_rank", (9,)))
    deduplicated: list[dict[str, Any]] = []
    seen: set[str] = set()
    for record in records:
        native_id = str(record.get("nativeId") or "")
        if not native_id or native_id in seen:
            continue
        seen.add(native_id)
        deduplicated.append(record)

    episode_ids = list(dict.fromkeys(
        episode_id
        for record in deduplicated
        for episode_id in _string_values((record.get("provenance") or {}).get("episodeUuids"))
    ))
    episodes_by_id: dict[str, dict[str, Any]] = {}
    if episode_ids:
        episode_results = mcp_reader(
            project_id=project_id,
            deck_id=deck_id,
            card_id=card_id,
            calls=[("graphiti.get_episodes", {
                "max_episodes": min(50, max(len(episode_ids), 10)),
                "include_body": False,
                "body_preview_chars": 300,
                "max_response_chars": 20_000,
            })],
        )
        if len(episode_results) != 1:
            raise DataAnchorError("data_anchor_knowgraph_provenance_result_invalid")
        episodes_by_id = {
            str(item.get("uuid") or ""): _json_safe(item)
            for item in _payload_records(episode_results[0], "episodes")
            if str(item.get("uuid") or "") in set(episode_ids)
        }
    for record in deduplicated:
        provenance = record.get("provenance") or {}
        ids = _string_values(provenance.get("episodeUuids"))
        record["provenance"] = {
            "episodeUuids": ids,
            "episodes": [episodes_by_id[value] for value in ids if value in episodes_by_id],
        }
        record.pop("_rank", None)

    truncated = any((
        len(node_rows) >= max_nodes,
        len(fact_rows) >= max_facts,
        len(centered_node_rows) >= max_nodes,
        len(centered_fact_rows) >= max_facts,
        len(deduplicated) > _KNOWGRAPH_RESULT_LIMIT,
    ))
    bounded = deduplicated[:_KNOWGRAPH_RESULT_LIMIT]
    return {
        "query": query,
        "records": bounded,
        "truncated": truncated,
        "bounds": {
            "maxNodes": max_nodes,
            "maxFacts": max_facts,
            "maxExpansionDepth": bounded_expansion,
            "maxCombinedResults": _KNOWGRAPH_RESULT_LIMIT,
        },
    }


def _render_anchor(anchor: dict[str, Any], record: dict[str, Any]) -> str:
    properties = record.get("properties") or {
        "type": record["type"],
        "title": record["title"],
        "metadata": record.get("metadata") or {},
    }
    return "\n".join([
        f"### Data Anchor: {record['authority']} / {record['nativeId']}",
        f"Selection reason (guidance, not verified fact): {anchor['reason']}",
        f"Verified native read as of: {record['asOf']}",
        f"Native read operation: {record.get('readOperation') or 'exact_read'}",
        f"Verified native provenance: {json.dumps(record.get('provenance') or {}, ensure_ascii=False, separators=(',', ':'), default=str)}",
        f"Verified native properties: {json.dumps(properties, ensure_ascii=False, separators=(',', ':'), default=str)}",
        *(
            [f"Verified relationship evidence: {json.dumps(record['relationshipEvidence'], ensure_ascii=False, separators=(',', ':'), default=str)}"]
            if record.get("relationshipEvidence") else []
        ),
        "Verified native content:",
        record["content"],
    ]).strip()


def _materialized_reference(
    anchor: dict[str, Any],
    record: dict[str, Any],
    *,
    truncated: bool,
) -> dict[str, Any]:
    """Expose one truthful selection projection from the native read result."""

    properties = record.get("properties")
    properties = properties if isinstance(properties, dict) else {}
    metadata = record.get("metadata")
    metadata = metadata if isinstance(metadata, dict) else {}
    provenance = record.get("provenance")
    provenance = provenance if isinstance(provenance, dict) else {}

    def first_text(keys: tuple[str, ...], *sources: dict[str, Any]) -> str:
        for source in sources:
            for key in keys:
                value = str(source.get(key) or "").strip()
                if value:
                    return value
        return ""

    source_path = first_text(
        ("file", "filePath", "file_path", "sourcePath", "path"),
        properties,
        metadata,
        provenance,
    )
    source_url = first_text(
        ("url", "sourceUrl", "source_url", "sourceUri", "source_uri"),
        properties,
        metadata,
        provenance,
    )
    content = record.get("content")
    content_text = (
        content
        if isinstance(content, str)
        else json.dumps(content, ensure_ascii=False, separators=(",", ":"), default=str)
    )
    selection_scope = {
        "boundedExpansion": int(anchor.get("boundedExpansion", 0)),
        **(
            {"resultLimit": int(anchor["resultLimit"])}
            if anchor.get("resultLimit") is not None
            else {}
        ),
        **(
            {
                "searchDynamicInput": True,
                "maxNodes": int(anchor.get("maxNodes", 8)),
                "maxFacts": int(anchor.get("maxFacts", 8)),
            }
            if anchor.get("searchDynamicInput") is True
            else {}
        ),
    }
    return {
        "authority": record["authority"],
        "nativeId": record["nativeId"],
        "nativeKind": record.get("nativeKind", "node"),
        "label": str(record.get("title") or record["nativeId"]),
        "reason": anchor["reason"],
        "asOf": record["asOf"],
        "required": anchor.get("required") is True,
        "readOperation": record.get("readOperation") or "exact_read",
        "provenance": provenance,
        "selectionScope": selection_scope,
        "materializedContentBytes": len(content_text.encode("utf-8")),
        **({"sourcePath": source_path} if source_path else {}),
        **({"sourceUrl": source_url} if source_url else {}),
        "truncated": truncated,
    }


def empty_graph_projection(project_id: str) -> dict[str, Any]:
    return {
        "schemaVersion": "native-card-context.v1",
        "authority": "",
        "projectId": project_id,
        "nodes": [],
        "edges": [],
        "counts": {"nodes": 0, "edges": 0},
    }


def _projection_node(
    authority: str,
    native_id: str,
    *,
    labels: Any = None,
    properties: Any = None,
    title: str = "",
    provenance: Any = None,
) -> dict[str, Any]:
    safe_properties = properties if isinstance(properties, dict) else {}
    safe_labels = [str(label) for label in labels] if isinstance(labels, list) else []
    label = str(
        title
        or safe_properties.get("name")
        or safe_properties.get("title")
        or safe_properties.get("fact")
        or native_id
    )
    return {
        "id": native_id,
        "canonicalId": native_id,
        "label": label,
        "title": label,
        "type": safe_labels[0] if safe_labels else str(safe_properties.get("type") or "NativeObject"),
        "labels": safe_labels,
        "authority": authority,
        "mentionCount": 1,
        "properties": _json_safe(safe_properties),
        "provenance": _json_safe(provenance) if isinstance(provenance, dict) else {},
    }


def _record_graph_projection(project_id: str, record: dict[str, Any]) -> dict[str, Any]:
    """Project only native node/edge identities actually returned by a read."""
    authority = str(record.get("authority") or "")
    native_id = str(record.get("nativeId") or "").strip()
    nodes: dict[str, dict[str, Any]] = {}
    edges: dict[str, dict[str, Any]] = {}

    def add_node(item: dict[str, Any], *, fallback_title: str = "") -> None:
        item_id = str(item.get("nativeId") or item.get("uuid") or "").strip()
        if not item_id or item_id in nodes:
            return
        nodes[item_id] = _projection_node(
            authority,
            item_id,
            labels=item.get("labels"),
            properties=item.get("properties") if isinstance(item.get("properties"), dict) else item,
            title=str(item.get("title") or item.get("name") or fallback_title),
            provenance=record.get("provenance"),
        )

    def add_edge(item: dict[str, Any]) -> None:
        edge_id = str(item.get("nativeId") or item.get("uuid") or "").strip()
        source = str(
            item.get("sourceNativeId")
            or item.get("sourceNodeUuid")
            or item.get("source_node_uuid")
            or ""
        ).strip()
        target = str(
            item.get("targetNativeId")
            or item.get("targetNodeUuid")
            or item.get("target_node_uuid")
            or ""
        ).strip()
        if not edge_id or not source or not target or edge_id in edges:
            return
        edges[edge_id] = {
            "id": edge_id,
            "source": source,
            "target": target,
            "predicate": str(item.get("type") or item.get("name") or item.get("edge_type") or "RELATED"),
            "mentionCount": 1,
            "properties": _json_safe(item.get("properties") or item),
            "provenance": _json_safe(record.get("provenance") or {}),
        }

    if record.get("nativeKind") == "edge":
        for endpoint in record.get("endpointNodes") or []:
            if isinstance(endpoint, dict):
                add_node(endpoint)
        evidence = record.get("relationshipEvidence") or []
        source_id = str(record.get("sourceNativeId") or "").strip()
        target_id = str(record.get("targetNativeId") or "").strip()
        if isinstance(evidence, list) and evidence and isinstance(evidence[0], dict):
            source_id = source_id or str(evidence[0].get("sourceNodeUuid") or "").strip()
            target_id = target_id or str(evidence[0].get("targetNodeUuid") or "").strip()
        add_edge({
            "nativeId": native_id,
            "sourceNativeId": source_id,
            "targetNativeId": target_id,
            "type": record.get("type"),
            "properties": record.get("properties"),
        })
    elif native_id:
        add_node({
            "nativeId": native_id,
            "labels": [record.get("type")] if record.get("type") else [],
            "properties": record.get("properties") or record.get("metadata") or {},
            "title": record.get("title"),
        })

    for path in record.get("relationshipEvidence") or []:
        if not isinstance(path, dict):
            continue
        for item in path.get("nodes") or []:
            if isinstance(item, dict):
                add_node(item)
        for item in path.get("relationships") or []:
            if isinstance(item, dict):
                add_edge(item)

    limit = max(1, min(int(record.get("resultLimit") or _KNOWGRAPH_RESULT_LIMIT), _KNOWGRAPH_RESULT_LIMIT))
    bounded_nodes = list(nodes.values())[:limit]
    node_ids = {node["id"] for node in bounded_nodes}
    bounded_edges = [
        edge for edge in edges.values()
        if edge["source"] in node_ids and edge["target"] in node_ids
    ][:limit]
    return {
        "schemaVersion": "native-card-context.v1",
        "authority": authority.lower(),
        "projectId": project_id,
        "nodes": bounded_nodes,
        "edges": bounded_edges,
        "counts": {"nodes": len(bounded_nodes), "edges": len(bounded_edges)},
    }


def _merge_graph_projection(target: dict[str, Any], incoming: dict[str, Any]) -> None:
    node_ids = {str(node.get("id") or "") for node in target["nodes"]}
    edge_ids = {str(edge.get("id") or "") for edge in target["edges"]}
    target["nodes"].extend(
        node for node in incoming["nodes"] if str(node.get("id") or "") not in node_ids
    )
    target["edges"].extend(
        edge for edge in incoming["edges"] if str(edge.get("id") or "") not in edge_ids
    )
    authorities = {
        str(value).lower()
        for value in (target.get("authority"), incoming.get("authority"))
        if str(value or "").strip()
    }
    target["authority"] = authorities.pop() if len(authorities) == 1 else "mixed"
    target["counts"] = {"nodes": len(target["nodes"]), "edges": len(target["edges"])}


def resolve_data_anchors(
    project_id: str,
    anchors: list[dict[str, Any]],
    *,
    deck_id: str = "",
    card_id: str = "",
    search_text: str = "",
    thinkgraph_db_path: str | Path | None = None,
    graph_projection: dict[str, Any] | None = None,
) -> tuple[str, list[dict[str, Any]]]:
    """Resolve ordered anchors and return model text plus native references."""
    rendered: list[str] = []
    references: list[dict[str, Any]] = []
    resolved_identities: set[tuple[str, str]] = set()
    exact_knowgraph_records: list[dict[str, Any]] = []
    search_hooks: list[dict[str, Any]] = []
    for anchor in anchors:
        authority = anchor["authority"]
        if anchor.get("searchDynamicInput") is True:
            search_hooks.append(anchor)
        native_id = str(anchor.get("nativeId") or "").strip()
        if not native_id:
            continue
        if authority == "ThinkGraph":
            if anchor["boundedExpansion"] != 0:
                raise DataAnchorError("data_anchor_expansion_not_supported:ThinkGraph")
            record = read_thinkgraph_exact(
                project_id,
                native_id,
                db_path=thinkgraph_db_path,
            )
        elif authority == "KnowGraph":
            record = read_knowgraph_exact(
                project_id,
                native_id,
                bounded_expansion=anchor["boundedExpansion"],
                result_limit=int(anchor.get("resultLimit", _KNOWGRAPH_RESULT_LIMIT)),
            )
        elif authority == "CodeGraph":
            record = read_codegraph_exact(
                project_id,
                deck_id,
                card_id,
                native_id,
                bounded_expansion=anchor["boundedExpansion"],
                result_limit=int(anchor.get("resultLimit", 24)),
            )
        else:
            raise DataAnchorError(f"data_anchor_resolver_unavailable:{authority}")
        if record is None:
            if anchor["required"]:
                raise DataAnchorError("data_anchor_required_not_found")
            continue
        identity = (record["authority"], record["nativeId"])
        if identity in resolved_identities:
            continue
        resolved_identities.add(identity)
        rendered.append(_render_anchor(anchor, record))
        if graph_projection is not None:
            _merge_graph_projection(
                graph_projection,
                _record_graph_projection(project_id, record),
            )
        references.append(_materialized_reference(
            anchor,
            record,
            truncated=record.get("truncated") is True,
        ))
        if authority == "KnowGraph":
            exact_record = dict(record)
            exact_record["_selectionReason"] = anchor["reason"]
            exact_knowgraph_records.append(exact_record)

    for hook in search_hooks:
        result = search_knowgraph_hybrid(
            project_id,
            deck_id,
            card_id,
            search_text,
            exact_records=exact_knowgraph_records,
            entity_types=list(hook.get("entityTypes") or []),
            edge_types=list(hook.get("edgeTypes") or []),
            valid_at_after=str(hook.get("validAtAfter") or ""),
            valid_at_before=str(hook.get("validAtBefore") or ""),
            invalid_at_after=str(hook.get("invalidAtAfter") or ""),
            invalid_at_before=str(hook.get("invalidAtBefore") or ""),
            max_nodes=int(hook.get("maxNodes", 8)),
            max_facts=int(hook.get("maxFacts", 8)),
            bounded_expansion=int(hook.get("boundedExpansion", 1)),
        )
        search_records = list(result["records"])
        novel_records = [
            record for record in search_records
            if (record["authority"], record["nativeId"]) not in resolved_identities
        ]
        if not search_records and hook.get("required") is True:
            raise DataAnchorError("data_anchor_required_search_empty")
        rendered.append("\n".join([
            "### KnowGraph Hybrid Search",
            f"Search request: {result['query']}",
            f"Selection purpose: {hook['reason']}",
            f"Bounds: {json.dumps(result['bounds'], separators=(',', ':'))}",
            f"Truncated: {'yes' if result['truncated'] else 'no'}",
            *(
                [] if search_records else
                ["No current project-scoped KnowGraph entity or fact matched this optional search."]
            ),
        ]).strip())
        for record in novel_records:
            identity = (record["authority"], record["nativeId"])
            resolved_identities.add(identity)
            rendered.append(_render_anchor(
                {"reason": f"{hook['reason']} — {record['selectionReason']}"},
                record,
            ))
            references.append(_materialized_reference(
                {**hook, "reason": record["selectionReason"]},
                record,
                truncated=result["truncated"],
            ))
            if graph_projection is not None:
                _merge_graph_projection(
                    graph_projection,
                    _record_graph_projection(project_id, record),
                )
    if anchors and not rendered:
        rendered.append(
            "### Data Anchor Resolution\nNo optional current native graph object was resolved."
        )
    graph_seed = "\n\n".join(rendered)
    if len(graph_seed.encode("utf-8")) > _GRAPH_SEED_LIMIT:
        raise DataAnchorError("data_anchor_seed_limit_exceeded")
    return graph_seed, references
