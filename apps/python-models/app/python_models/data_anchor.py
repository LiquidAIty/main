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
import sqlite3
from typing import Any, Callable

from app.python_models.internal_mcp import call_read_tools_via_mcp


_REPO_ROOT = Path(__file__).resolve().parents[4]
_DEFAULT_THINKGRAPH_DB = _REPO_ROOT / "db" / "thinkgraph-engraphis-v2.sqlite"
_ANCHOR_BODY_LIMIT = 12_000
_GRAPH_SEED_LIMIT = 48_000
_KNOWGRAPH_RESULT_LIMIT = 24
_CODEGRAPH_PROJECT = "C-Projects-LiquidAIty-main"
_SKILL_GRAPH_LABELS = {
    "Skill", "SkillAttempt", "FailedAttempt", "Decision", "Guardrail",
    "QueryPattern", "SkillSection",
}


class DataAnchorError(ValueError):
    """Typed failure before a provider can receive an ungrounded request."""


def _iso(value: Any) -> str:
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(float(value), tz=timezone.utc).isoformat().replace("+00:00", "Z")
    return "current"


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
    """Read one current project-scoped Engraphis record without opening Store."""
    path = Path(
        db_path
        or os.environ.get("THINKGRAPH_ENGRAPHIS_DB")
        or _DEFAULT_THINKGRAPH_DB
    ).resolve()
    if not path.is_file():
        raise DataAnchorError("data_anchor_thinkgraph_unavailable")
    uri = f"{path.as_uri()}?mode=ro"
    try:
        with sqlite3.connect(uri, uri=True, timeout=5) as connection:
            connection.row_factory = sqlite3.Row
            row = connection.execute(
                """
                SELECT m.id, m.mtype, m.title, m.content, m.metadata,
                       m.provenance, m.valid_from, m.valid_to, m.ingested_at
                FROM memories AS m
                JOIN workspaces AS w ON w.id = m.workspace_id
                JOIN repos AS r ON r.id = m.repo_id
                WHERE w.name = ?
                  AND r.name = 'thinkgraph'
                  AND m.valid_to IS NULL
                  AND (
                    m.id = ?
                    OR (
                      json_valid(m.metadata)
                      AND json_extract(m.metadata, '$.canonicalId') = ?
                    )
                  )
                ORDER BY m.ingested_at DESC
                LIMIT 1
                """,
                (project_id, native_id, native_id),
            ).fetchone()
    except sqlite3.Error as error:
        raise DataAnchorError("data_anchor_thinkgraph_read_failed") from error
    if row is None:
        return None
    metadata = _json_value(row["metadata"])
    canonical_id = (
        str(metadata.get("canonicalId") or "").strip()
        if isinstance(metadata, dict)
        else ""
    ) or str(row["id"])
    return {
        "authority": "ThinkGraph",
        "nativeId": canonical_id,
        "recordId": str(row["id"]),
        "type": str(row["mtype"] or ""),
        "title": str(row["title"] or ""),
        "content": str(row["content"] or "")[:_ANCHOR_BODY_LIMIT],
        "metadata": metadata if isinstance(metadata, dict) else {},
        "provenance": _json_value(row["provenance"]),
        "asOf": _iso(row["ingested_at"]),
        "readOperation": "engraphis.exact_id",
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
    driver_factory: Callable[[], Any] | None = None,
) -> dict[str, Any] | None:
    """Read one project-scoped Neo4j object and a bounded current neighborhood."""
    if bounded_expansion < 0 or bounded_expansion > 3:
        raise DataAnchorError("data_anchor_expansion_invalid")
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
                  AND NONE(label IN labels(n) WHERE label IN $excludedLabels)
                RETURN coalesce(toString(n.uuid), elementId(n)) AS nativeId,
                       labels(n) AS labels, properties(n) AS properties
                LIMIT 1
                """,
                nativeId=native_id,
                scopeIds=scope_ids,
                excludedLabels=sorted(_SKILL_GRAPH_LABELS),
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
                      AND NONE(label IN labels(a) WHERE label IN $excludedLabels)
                      AND NONE(label IN labels(b) WHERE label IN $excludedLabels)
                    RETURN coalesce(toString(r.uuid), elementId(r)) AS nativeId,
                           [type(r)] AS labels, properties(r) AS properties,
                           [{nativeId: coalesce(toString(a.uuid), elementId(a)),
                             labels: labels(a), properties: properties(a)},
                            {nativeId: coalesce(toString(b.uuid), elementId(b)),
                             labels: labels(b), properties: properties(b)}] AS endpointNodes
                    LIMIT 1
                    """,
                    nativeId=native_id,
                    scopeIds=scope_ids,
                    excludedLabels=sorted(_SKILL_GRAPH_LABELS),
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
                              WHERE toString(node.group_id) IN $scopeIds
                                AND NONE(label IN labels(node) WHERE label IN $excludedLabels))
                      AND ALL(rel IN relationships(path)
                              WHERE toString(rel.group_id) IN $scopeIds)
                    RETURN [node IN nodes(path) | {{
                               nativeId: coalesce(toString(node.uuid), elementId(node)),
                               labels: labels(node), properties: properties(node)}}] AS nodes,
                           [rel IN relationships(path) | {{
                               nativeId: coalesce(toString(rel.uuid), elementId(rel)),
                               type: type(rel), properties: properties(rel)}}] AS relationships
                    LIMIT $limit
                    """,
                    nativeId=native_id,
                    scopeIds=scope_ids,
                    excludedLabels=sorted(_SKILL_GRAPH_LABELS),
                    limit=_KNOWGRAPH_RESULT_LIMIT,
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
    neighborhood = _json_safe(paths)[:_KNOWGRAPH_RESULT_LIMIT]
    return {
        "authority": "KnowGraph",
        "nativeId": str(center.get("nativeId") or native_id),
        "type": str(labels[0] if labels else "Neo4jObject"),
        "title": str(properties.get("name") or properties.get("title") or native_id),
        "content": json.dumps(
            {"properties": properties, "neighborhood": neighborhood},
            ensure_ascii=False,
            separators=(",", ":"),
            default=str,
        )[:_ANCHOR_BODY_LIMIT],
        "properties": properties,
        "relationshipEvidence": neighborhood,
        "provenance": {
            key: properties.get(key)
            for key in ("group_id", "source", "source_description", "created_at", "valid_at")
            if properties.get(key) is not None
        },
        "asOf": _now_iso(),
        "readOperation": "neo4j.project_scoped_exact",
    }


def read_codegraph_exact(
    project_id: str,
    deck_id: str,
    card_id: str,
    native_id: str,
    *,
    bounded_expansion: int = 0,
    mcp_reader: Callable[..., list[dict[str, Any]]] = call_read_tools_via_mcp,
) -> dict[str, Any] | None:
    """Read one qualified current symbol through the official MCP/CBM seam."""
    if bounded_expansion < 0 or bounded_expansion > 3:
        raise DataAnchorError("data_anchor_expansion_invalid")
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
        key: relationships.get(key, [])
        for key in ("callers", "callees")
        if isinstance(relationships.get(key), list)
    }
    return {
        "authority": "CodeGraph",
        "nativeId": qualified_name,
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
    }


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


def resolve_data_anchors(
    project_id: str,
    anchors: list[dict[str, Any]],
    *,
    deck_id: str = "",
    card_id: str = "",
    search_text: str = "",
    thinkgraph_db_path: str | Path | None = None,
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
            )
        elif authority == "CodeGraph":
            record = read_codegraph_exact(
                project_id,
                deck_id,
                card_id,
                native_id,
                bounded_expansion=anchor["boundedExpansion"],
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
        references.append({
            "authority": record["authority"],
            "nativeId": record["nativeId"],
            "reason": anchor["reason"],
            "asOf": record["asOf"],
            "required": anchor["required"],
            "readOperation": record.get("readOperation") or "exact_read",
        })
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
            references.append({
                "authority": record["authority"],
                "nativeId": record["nativeId"],
                "reason": record["selectionReason"],
                "asOf": record["asOf"],
                "required": hook.get("required") is True,
                "readOperation": record.get("readOperation") or "exact_read",
                "provenance": record.get("provenance") or {},
                "truncated": result["truncated"],
            })
    if anchors and not rendered:
        rendered.append(
            "### Data Anchor Resolution\nNo optional current native graph object was resolved."
        )
    graph_seed = "\n\n".join(rendered)
    if len(graph_seed.encode("utf-8")) > _GRAPH_SEED_LIMIT:
        raise DataAnchorError("data_anchor_seed_limit_exceeded")
    return graph_seed, references
