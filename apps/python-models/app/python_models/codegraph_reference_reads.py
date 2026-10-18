"""Exact repository-symbol reads from the official Codebase Memory authority."""
# Entity: CodeGraph
# Relationship: Reads one exact qualified symbol and optional bounded call neighborhood through authenticated CBM tools, preserving source coordinates and native provenance.

from __future__ import annotations

import hashlib
import re
from pathlib import Path
from typing import Any
from urllib.parse import quote

from app.python_models import saved_cards
from app.python_models.data_anchor_contract import (
    ANCHOR_BODY_LIMIT,
    MAX_GRAPH_REFERENCE_RESULTS,
    DataAnchorError,
    utc_now_text,
)
from app.python_models.materializer_read_tools import call_materializer_read_tools


_REPO_ROOT = Path(__file__).resolve().parents[4]
_CODEGRAPH_PROJECT = "C-Projects-LiquidAIty-main"
_CODEGRAPH_DECK_ID = "deck_builder"
_CODEGRAPH_CARD_ID = "builder"
_MAX_CODEGRAPH_ROWS = 1_000
_CODEGRAPH_RELATIONSHIP_TYPES = (
    "CALLS", "IMPORTS", "DEFINES", "DEFINES_METHOD", "TESTS", "TESTS_FILE",
    "USAGE", "CALL_REFERENCE", "HTTP_CALLS", "DATA_FLOWS", "HANDLES",
    "IMPLEMENTS", "INHERITS", "CONFIGURES", "WRITES",
)
_EXCLUDED_SOURCE_PARTS = frozenset({
    ".git", ".nx", ".pytest_cache", ".venv", "__pycache__", "dist",
    "node_modules", "vendor", "venv",
})
_FEATURE_ENTITY = re.compile(
    r"^\s*(?:#|//|\*)\s*Entity:\s*(.+?)\s*(?:\*/)?$",
)
_FEATURE_RELATIONSHIP = re.compile(
    r"^\s*(?:#|//|\*)\s*Relationship:\s*(.+?)\s*(?:\*/)?$",
)


def read_codegraph_exact(
    project_id: str,
    deck_id: str,
    card_id: str,
    requested_qualified_name: str,
    *,
    bounded_expansion: int = 0,
    result_limit: int = MAX_GRAPH_REFERENCE_RESULTS,
    include_tests: bool = False,
) -> dict[str, Any] | None:
    """Read one qualified current symbol through the official MCP/CBM seam."""

    if bounded_expansion < 0 or bounded_expansion > 3:
        raise DataAnchorError("data_anchor_expansion_invalid")
    if result_limit < 1 or result_limit > MAX_GRAPH_REFERENCE_RESULTS:
        raise DataAnchorError("data_anchor_result_limit_invalid")
    if not deck_id or not card_id:
        raise DataAnchorError("data_anchor_codegraph_context_missing")
    calls: list[tuple[str, dict[str, Any]]] = [
        ("cbm.get_code_snippet", {
            "project": _CODEGRAPH_PROJECT,
            "qualified_name": requested_qualified_name,
            "include_neighbors": False,
            "format": "json",
        }),
    ]
    if bounded_expansion:
        calls.append(("cbm.trace_path", {
            "project": _CODEGRAPH_PROJECT,
            "function_name": requested_qualified_name,
            "direction": "both",
            "depth": bounded_expansion,
            "mode": "calls",
            "include_tests": include_tests,
            "limit": result_limit,
            "format": "json",
        }))
    try:
        results = call_materializer_read_tools(
            project_id=project_id,
            deck_id=deck_id,
            card_id=card_id,
            calls=calls,
        )
    except Exception as error:
        raise DataAnchorError("data_anchor_codegraph_read_failed") from error
    if len(results) != len(calls):
        raise DataAnchorError("data_anchor_codegraph_result_invalid")
    snippet = results[0]
    qualified_name = str(snippet.get("qualified_name") or "").strip()
    source = str(snippet.get("source") or "")
    if qualified_name != requested_qualified_name or not source.strip():
        return None
    file_path = str(snippet.get("file_path") or "").replace("\\", "/")
    repo_prefix = str(_REPO_ROOT).replace("\\", "/").rstrip("/") + "/"
    if file_path.lower().startswith(repo_prefix.lower()):
        file_path = file_path[len(repo_prefix):]
    relationships = results[1] if len(results) > 1 else {}
    evidence = {
        key: _codegraph_trace_records(relationships.get(key))
        for key in ("callers", "callees")
        if _codegraph_trace_records(relationships.get(key))
    }
    return {
        "graphSystem": "cbm",
        "cbmQualifiedName": qualified_name,
        "recordKind": "symbol",
        "type": str(snippet.get("label") or "Symbol"),
        "title": str(snippet.get("name") or qualified_name.rsplit(".", 1)[-1]),
        "content": source[:ANCHOR_BODY_LIMIT],
        "properties": {
            "project": _CODEGRAPH_PROJECT,
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
        "asOf": utc_now_text(),
        "readOperation": "cbm.get_code_snippet",
        "truncated": bool(relationships.get("truncated") is True),
    }


def _codegraph_trace_records(value: Any) -> list[dict[str, Any]]:
    """Normalize CBM JSON trace rows without interpreting their meaning."""

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


def read_codegraph_view(payload: dict[str, Any]) -> dict[str, Any]:
    """Read one fixed-purpose browser CodeGraph view through saved Builder grants."""

    if not isinstance(payload, dict):
        raise ValueError("codegraph_read_payload_invalid")
    project_id = str(payload.get("projectId") or "").strip()
    deck_id = str(payload.get("deckId") or "").strip()
    card_id = str(payload.get("cardId") or "").strip()
    mode = str(payload.get("mode") or "").strip()
    if not project_id:
        raise ValueError("codegraph_project_required")
    if deck_id != _CODEGRAPH_DECK_ID or card_id != _CODEGRAPH_CARD_ID:
        raise ValueError("codegraph_saved_scope_invalid")
    if mode not in {"projection", "file", "source"}:
        raise ValueError("codegraph_read_mode_invalid")

    context = _saved_builder_context(project_id, deck_id, card_id)
    if mode == "projection":
        return _read_codegraph_projection(context)
    if mode == "file":
        return _read_codegraph_file(context, str(payload.get("filePath") or "").strip())
    return _read_codegraph_source(
        context,
        str(payload.get("qualifiedName") or "").strip(),
    )


def _saved_builder_context(
    project_id: str,
    deck_id: str,
    card_id: str,
) -> dict[str, Any]:
    try:
        loaded = saved_cards.load_deck(project_id, deck_id)
    except Exception as error:
        raise DataAnchorError("codegraph_saved_deck_unavailable") from error
    deck = loaded.get("deck")
    if not isinstance(deck, dict):
        raise DataAnchorError("codegraph_saved_deck_invalid")
    cards = [
        card for card in deck.get("nodes") or []
        if isinstance(card, dict)
        and card.get("id") == card_id
        and card.get("enabled") is not False
        and isinstance(card.get("runtime"), dict)
        and card["runtime"].get("kind") == "hermes"
        and card["runtime"].get("profile") == "builder"
    ]
    if len(cards) != 1:
        raise DataAnchorError("codegraph_saved_builder_unavailable")
    card = cards[0]
    runtime_options = card.get("runtimeOptions")
    tools = {
        str(value).strip() for value in (
            runtime_options.get("tools") if isinstance(runtime_options, dict) else []
        ) or []
        if isinstance(value, str) and value.strip()
    }
    meta = loaded.get("meta") if isinstance(loaded.get("meta"), dict) else {}
    return {
        "projectId": str(loaded.get("projectId") or project_id),
        "deckId": deck_id,
        "cardId": card_id,
        "cardRevisionId": str(card.get("_cardRevisionId") or ""),
        "cardRevision": card.get("_cardRevision"),
        "deckRevision": str(meta.get("deckRevision") or ""),
        "tools": tools,
    }


def _scope(context: dict[str, Any]) -> dict[str, Any]:
    return {
        key: context.get(key)
        for key in (
            "projectId", "deckId", "cardId", "cardRevisionId", "cardRevision",
            "deckRevision",
        )
    } | {"cbmProject": _CODEGRAPH_PROJECT}


def _missing_grants(
    context: dict[str, Any],
    required: set[str],
    *,
    mode: str,
) -> dict[str, Any] | None:
    missing = sorted(required - set(context["tools"]))
    if not missing:
        return None
    return {
        "schemaVersion": "codegraph.read.v1",
        "status": "unavailable",
        "mode": mode,
        "scope": _scope(context),
        "projection": None,
        "selectedSymbol": None,
        "freshness": {"status": "unverified", "coverage": None},
        "truncated": False,
        "errors": [
            {
                "purpose": "authorization",
                "operation": tool,
                "code": "codegraph_saved_tool_not_granted",
            }
            for tool in missing
        ],
    }


def _provider_failure(
    context: dict[str, Any],
    *,
    mode: str,
    operation: str,
    code: str,
) -> dict[str, Any]:
    return {
        "schemaVersion": "codegraph.read.v1",
        "status": "unavailable",
        "mode": mode,
        "scope": _scope(context),
        "projection": None,
        "selectedSymbol": None,
        "freshness": {"status": "unverified", "coverage": None},
        "truncated": False,
        "errors": [{"purpose": mode, "operation": operation, "code": code}],
    }


def _call_codegraph_reads(
    context: dict[str, Any],
    calls: list[tuple[str, dict[str, Any]]],
) -> list[dict[str, Any]]:
    return call_materializer_read_tools(
        project_id=context["projectId"],
        deck_id=context["deckId"],
        card_id=context["cardId"],
        calls=calls,
        concurrent=True,
        deadline_seconds=30,
    )


def _eligible_source_path(value: str) -> bool:
    path = value.replace("\\", "/").strip("/")
    if path == "vite.config.ts":
        return True
    parts = path.split("/")
    if not parts or parts[0] not in {"apps", "client", "services"}:
        return False
    if any(part in _EXCLUDED_SOURCE_PARTS for part in parts):
        return False
    if parts[-1] == "__init__.py":
        return False
    return Path(parts[-1]).suffix in {".py", ".ts", ".tsx"}


def _grouped_search_records(payload: dict[str, Any]) -> list[dict[str, Any]]:
    columns = payload.get("cols")
    groups = payload.get("groups")
    if not isinstance(columns, list) or not isinstance(groups, list):
        return []
    records: list[dict[str, Any]] = []
    for group in groups:
        if not isinstance(group, dict) or not isinstance(group.get("rows"), list):
            continue
        prefix = str(group.get("qn_prefix") or "").strip()
        file_path = str(group.get("file") or "").replace("\\", "/")
        for row in group["rows"]:
            if not isinstance(row, list) or len(row) != len(columns):
                continue
            record = {str(columns[index]): value for index, value in enumerate(row)}
            name = str(record.get("name") or "").strip()
            record["qualified_name"] = f"{prefix}.{name}" if prefix else name
            record["file_path"] = file_path
            records.append(record)
    return records


def _feature_contributions(payloads: list[dict[str, Any]]) -> list[dict[str, Any]]:
    contributions: dict[tuple[str, str, str], dict[str, Any]] = {}
    for payload in payloads:
        columns = payload.get("cols")
        rows = payload.get("rows")
        if not isinstance(columns, list) or not isinstance(rows, list):
            continue
        try:
            file_index = columns.index("file")
            source_index = columns.index("source")
        except ValueError:
            continue
        for row in rows:
            if not isinstance(row, list) or len(row) != len(columns):
                continue
            file_path = str(row[file_index] or "").replace("\\", "/")
            source = row[source_index]
            if not _eligible_source_path(file_path) or not isinstance(source, dict):
                continue
            text = str(source.get("source") or "")
            source_start = int(source.get("source_start") or 1)
            lines = text.splitlines()
            for offset, line in enumerate(lines[:-1]):
                entity = _FEATURE_ENTITY.match(line)
                if not entity:
                    continue
                entity_line = source_start + offset
                if entity_line > 80:
                    continue
                relationship = _FEATURE_RELATIONSHIP.match(lines[offset + 1])
                if not relationship:
                    continue
                feature = entity.group(1).strip()
                statement = relationship.group(1).strip()
                if not feature or not statement:
                    continue
                key = (file_path, feature, statement)
                contributions[key] = {
                    "filePath": file_path,
                    "feature": feature,
                    "relationship": statement,
                    "entityLine": entity_line,
                    "relationshipLine": entity_line + 1,
                }
    return [contributions[key] for key in sorted(contributions)]


def _feature_id(name: str) -> str:
    return "feature:" + quote(name, safe="")


def _read_codegraph_projection(context: dict[str, Any]) -> dict[str, Any]:
    required = {"cbm.search_graph", "cbm.search_code"}
    denied = _missing_grants(context, required, mode="projection")
    if denied:
        return denied
    search_common = {
        "project": _CODEGRAPH_PROJECT,
        "pattern": "Entity:",
        "mode": "full",
        "context": 4,
        "regex": False,
        "limit": 600,
        "result_limit": 600,
        "raw_limit": 600,
        "match_limit": 20,
        "source_max_lines": 40,
        "max_output_tokens": 120_000,
        "format": "json",
    }
    file_page_size = 250
    calls: list[tuple[str, dict[str, Any]]] = [
        ("cbm.search_graph", {
            "project": _CODEGRAPH_PROJECT,
            "label": "File",
            "limit": file_page_size,
            "offset": offset,
            "max_output_tokens": 32_000,
            "format": "json",
        })
        for offset in (0, file_page_size, file_page_size * 2)
    ] + [
        ("cbm.search_code", {**search_common, "path_filter": "apps/"}),
        ("cbm.search_code", {**search_common, "path_filter": "client/"}),
        ("cbm.search_code", {**search_common, "path_filter": "services/"}),
        ("cbm.search_code", {**search_common, "path_filter": "vite.config.ts"}),
    ]
    try:
        results = _call_codegraph_reads(context, calls)
    except Exception:
        return _provider_failure(
            context,
            mode="projection",
            operation="cbm.search_graph",
            code="codegraph_provider_unavailable",
        )
    if len(results) != len(calls):
        return _provider_failure(
            context,
            mode="projection",
            operation="cbm.search_graph",
            code="codegraph_result_invalid",
        )
    file_results = results[:3]
    successful_file_results = [result for result in file_results if not result.get("error")]
    if not successful_file_results:
        return _provider_failure(
            context,
            mode="projection",
            operation="cbm.search_graph",
            code=str(file_results[0].get("error") or "codegraph_result_invalid"),
        )
    file_records = [
        record
        for result in successful_file_results
        for record in _grouped_search_records(result)
        if record.get("label") == "File"
        and _eligible_source_path(str(record.get("file_path") or ""))
    ]
    files_by_path = {
        str(record["file_path"]): record
        for record in file_records
    }
    annotation_results = [result for result in results[3:] if not result.get("error")]
    contributions = _feature_contributions(annotation_results)
    contributions_by_path: dict[str, list[dict[str, Any]]] = {}
    feature_members: dict[str, set[str]] = {}
    for contribution in contributions:
        path = contribution["filePath"]
        if path not in files_by_path:
            continue
        contributions_by_path.setdefault(path, []).append(contribution)
        feature_members.setdefault(contribution["feature"], set()).add(path)

    nodes: list[dict[str, Any]] = []
    for feature in sorted(feature_members):
        members = sorted(feature_members[feature])
        nodes.append({
            "id": _feature_id(feature),
            "label": feature,
            "type": "Feature",
            "etype": "Feature",
            "authority": "codegraph",
            "properties": {
                "recordKind": "feature",
                "featureName": feature,
                "memberFilePaths": members,
                "memberCount": len(members),
                "sourceAuthority": "inline-source-comments",
            },
        })
    for path in sorted(files_by_path):
        record = files_by_path[path]
        file_contributions = contributions_by_path.get(path, [])
        nodes.append({
            "id": record["qualified_name"],
            "label": Path(path).name,
            "title": path,
            "type": "File",
            "etype": "File",
            "authority": "codegraph",
            "properties": {
                "recordKind": "file",
                "filePath": path,
                "qualifiedName": record["qualified_name"],
                "features": sorted({item["feature"] for item in file_contributions}),
                "contributions": file_contributions,
                "structuralAuthority": "cbm",
            },
        })
    edges: list[dict[str, Any]] = []
    for contribution in contributions:
        file_record = files_by_path.get(contribution["filePath"])
        if not file_record:
            continue
        feature_node_id = _feature_id(contribution["feature"])
        file_node_id = str(file_record["qualified_name"])
        edges.append({
            "id": f"feature-membership:{feature_node_id}:{file_node_id}",
            "source": feature_node_id,
            "target": file_node_id,
            "predicate": "FEATURE_CONTRIBUTION",
            "layer": "source-annotation",
            "properties": {
                "recordKind": "feature-membership",
                "relationship": contribution["relationship"],
                "filePath": contribution["filePath"],
                "entityLine": contribution["entityLine"],
                "relationshipLine": contribution["relationshipLine"],
                "sourceAuthority": "inline-source-comments",
            },
        })

    revision_material = "\n".join(
        f"{item['filePath']}\t{item['feature']}\t{item['relationship']}"
        for item in contributions
    )
    revision = hashlib.sha256(revision_material.encode("utf-8")).hexdigest()
    errors: list[dict[str, str]] = []
    for index, result in enumerate(results):
        if result.get("error"):
            errors.append({
                "purpose": "structure" if index < 3 else "feature-annotations",
                "operation": calls[index][0],
                "code": str(result["error"]),
            })
    truncated = bool(file_results[-1].get("has_more")) or any(
        bool(result.get("has_more"))
        for result in annotation_results
    )
    if truncated:
        errors.append({
            "purpose": "projection",
            "operation": "cbm.search_graph",
            "code": "codegraph_provider_result_truncated",
        })
    projection = {
        "schemaVersion": "codegraph.projection.v1",
        "authority": "codegraph",
        "projectId": context["projectId"],
        "revision": revision,
        "counts": {"nodes": len(nodes), "edges": len(edges)},
        "nodes": nodes,
        "edges": edges,
        "metadata": {
            "structuralAuthority": "cbm",
            "featureAuthority": "inline-source-comments",
            "eligibleFileCount": len(file_records),
            "classifiedFileCount": len(contributions_by_path),
            "featureCount": len(feature_members),
            "contributionCount": len(edges),
            "revisionPurpose": "presentation-staleness-only",
        },
    }
    return {
        "schemaVersion": "codegraph.read.v1",
        "status": "partial" if errors else "ready",
        "mode": "projection",
        "scope": _scope(context),
        "projection": projection,
        "selectedSymbol": None,
        "freshness": {"status": "unverified", "coverage": None},
        "truncated": truncated,
        "errors": errors,
    }


def _valid_selected_file(value: str) -> str:
    path = value.replace("\\", "/").strip("/")
    if not _eligible_source_path(path) or ".." in path.split("/") or "'" in path:
        raise ValueError("codegraph_file_path_invalid")
    return path


def _query_rows(payload: dict[str, Any]) -> list[dict[str, Any]]:
    columns = payload.get("columns")
    rows = payload.get("rows")
    if not isinstance(columns, list) or not isinstance(rows, list):
        return []
    return [
        {str(columns[index]): value for index, value in enumerate(row)}
        for row in rows
        if isinstance(row, list) and len(row) == len(columns)
    ]


def _structural_node(record: dict[str, Any], prefix: str) -> dict[str, Any] | None:
    qualified_name = str(record.get(f"{prefix}_qualified_name") or "").strip()
    if not qualified_name:
        return None
    kind = str(record.get(f"{prefix}_kind") or "Symbol").strip() or "Symbol"
    file_path = str(record.get(f"{prefix}_file_path") or "").replace("\\", "/")
    name = str(record.get(f"{prefix}_name") or qualified_name.rsplit(".", 1)[-1])
    start_line = record.get(f"{prefix}_start_line")
    end_line = record.get(f"{prefix}_end_line")
    return {
        "id": qualified_name,
        "label": Path(file_path).name if kind == "File" and file_path else name,
        "title": file_path or qualified_name,
        "type": kind,
        "etype": "File" if kind == "File" else "Symbol",
        "authority": "codegraph",
        "properties": {
            "recordKind": "file" if kind == "File" else "symbol",
            "qualifiedName": qualified_name,
            "filePath": file_path,
            "symbolKind": kind,
            "startLine": int(start_line) if str(start_line).isdigit() else None,
            "endLine": int(end_line) if str(end_line).isdigit() else None,
            "structuralAuthority": "cbm",
        },
    }


def _coverage_freshness(payload: dict[str, Any]) -> str:
    paths = payload.get("paths")
    if not isinstance(paths, dict):
        return "unverified"
    columns = paths.get("cols")
    rows = paths.get("rows")
    if not isinstance(columns, list) or not isinstance(rows, list):
        return "unverified"
    try:
        freshness_index = columns.index("freshness")
    except ValueError:
        return "unverified"
    values = {
        str(row[freshness_index] or "").strip()
        for row in rows
        if isinstance(row, list) and len(row) == len(columns)
    }
    if values == {"current"}:
        return "current"
    if "metadata_changed" in values:
        return "metadata_changed"
    return "partial" if values else "unverified"


def _read_codegraph_file(context: dict[str, Any], requested_path: str) -> dict[str, Any]:
    required = {"cbm.query_graph", "cbm.check_index_coverage"}
    denied = _missing_grants(context, required, mode="file")
    if denied:
        return denied
    file_path = _valid_selected_file(requested_path)
    relationship_types = ", ".join(f"'{value}'" for value in _CODEGRAPH_RELATIONSHIP_TYPES)
    query = (
        "MATCH (source)-[relationship]->(target) "
        f"WHERE (source.file_path = '{file_path}' OR target.file_path = '{file_path}') "
        f"AND type(relationship) IN [{relationship_types}] "
        "RETURN source.qualified_name AS source_qualified_name, "
        "source.name AS source_name, source.label AS source_kind, "
        "source.file_path AS source_file_path, source.start_line AS source_start_line, "
        "source.end_line AS source_end_line, type(relationship) AS predicate, "
        "target.qualified_name AS target_qualified_name, target.name AS target_name, "
        "target.label AS target_kind, target.file_path AS target_file_path, "
        "target.start_line AS target_start_line, target.end_line AS target_end_line "
        "ORDER BY source_qualified_name, predicate, target_qualified_name "
        f"LIMIT {_MAX_CODEGRAPH_ROWS}"
    )
    calls = [
        ("cbm.query_graph", {
            "project": _CODEGRAPH_PROJECT,
            "query": query,
            "max_rows": _MAX_CODEGRAPH_ROWS,
            "max_output_tokens": 120_000,
            "format": "json",
        }),
        ("cbm.check_index_coverage", {
            "project": _CODEGRAPH_PROJECT,
            "paths": [file_path],
            "path_limit": 10,
            "diagnostics": "full",
            "format": "json",
        }),
    ]
    try:
        results = _call_codegraph_reads(context, calls)
    except Exception:
        return _provider_failure(
            context, mode="file", operation="cbm.query_graph",
            code="codegraph_provider_unavailable",
        )
    if len(results) != len(calls) or results[0].get("error"):
        return _provider_failure(
            context, mode="file", operation="cbm.query_graph",
            code=str(results[0].get("error") if results else "codegraph_result_invalid"),
        )
    records = _query_rows(results[0])
    nodes_by_id: dict[str, dict[str, Any]] = {}
    edges_by_id: dict[str, dict[str, Any]] = {}
    for record in records:
        source = _structural_node(record, "source")
        target = _structural_node(record, "target")
        predicate = str(record.get("predicate") or "").strip()
        if not source or not target or not predicate:
            continue
        nodes_by_id[source["id"]] = source
        nodes_by_id[target["id"]] = target
        edge_id = f"cbm:{predicate}:{source['id']}:{target['id']}"
        edges_by_id[edge_id] = {
            "id": edge_id,
            "source": source["id"],
            "target": target["id"],
            "predicate": predicate,
            "layer": "cbm-structure",
            "properties": {
                "recordKind": "structural-relationship",
                "structuralAuthority": "cbm",
                "selectedFilePath": file_path,
            },
        }
    if not nodes_by_id:
        return {
            "schemaVersion": "codegraph.read.v1",
            "status": "not_found",
            "mode": "file",
            "scope": _scope(context),
            "projection": None,
            "selectedSymbol": None,
            "freshness": {"status": "unverified", "coverage": results[1]},
            "truncated": False,
            "errors": [],
        }
    coverage_error = results[1].get("error")
    freshness = "unverified" if coverage_error else _coverage_freshness(results[1])
    truncated = bool(results[0].get("truncated") or results[0].get("has_more"))
    errors = []
    if coverage_error:
        errors.append({
            "purpose": "coverage",
            "operation": "cbm.check_index_coverage",
            "code": str(coverage_error),
        })
    if truncated:
        errors.append({
            "purpose": "structure",
            "operation": "cbm.query_graph",
            "code": "codegraph_provider_result_truncated",
        })
    projection = {
        "schemaVersion": "codegraph.projection.v1",
        "authority": "codegraph",
        "projectId": context["projectId"],
        "revision": f"file:{file_path}",
        "counts": {"nodes": len(nodes_by_id), "edges": len(edges_by_id)},
        "nodes": [nodes_by_id[key] for key in sorted(nodes_by_id)],
        "edges": [edges_by_id[key] for key in sorted(edges_by_id)],
        "metadata": {
            "structuralAuthority": "cbm",
            "selectedFilePath": file_path,
        },
    }
    status = "ready" if freshness == "current" and not errors else "partial"
    return {
        "schemaVersion": "codegraph.read.v1",
        "status": status,
        "mode": "file",
        "scope": _scope(context),
        "projection": projection,
        "selectedSymbol": None,
        "freshness": {"status": freshness, "coverage": None if coverage_error else results[1]},
        "truncated": truncated,
        "errors": errors,
    }


def _read_codegraph_source(
    context: dict[str, Any],
    qualified_name: str,
) -> dict[str, Any]:
    required = {"cbm.get_code_snippet", "cbm.trace_path"}
    denied = _missing_grants(context, required, mode="source")
    if denied:
        return denied
    if not qualified_name.startswith(_CODEGRAPH_PROJECT + "."):
        raise ValueError("codegraph_qualified_name_invalid")
    try:
        selected = read_codegraph_exact(
            context["projectId"],
            context["deckId"],
            context["cardId"],
            qualified_name,
            bounded_expansion=2,
            result_limit=MAX_GRAPH_REFERENCE_RESULTS,
            include_tests=True,
        )
    except Exception:
        return _provider_failure(
            context, mode="source", operation="cbm.get_code_snippet",
            code="codegraph_source_unavailable",
        )
    return {
        "schemaVersion": "codegraph.read.v1",
        "status": "ready" if selected else "not_found",
        "mode": "source",
        "scope": _scope(context),
        "projection": None,
        "selectedSymbol": selected,
        "freshness": {"status": "unverified", "coverage": None},
        "truncated": bool(selected and selected.get("truncated") is True),
        "errors": [],
    }
