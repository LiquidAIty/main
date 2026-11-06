"""CBM file-edge queries and exact symbol reads for CodeGraph."""
# Entity: CodeGraph
# Relationship: This file reads source annotations and file text; CBM set queries own structural traversal and return directed file relationships for the selected file set.
# Entity: Builder Card
# Relationship: This file fixes in-app CodeGraph reads to the persisted Builder Card identity, revision, deck, and exact saved CBM grants.
# Entity: Tool Catalog
# Relationship: This file checks each required CBM operation against Builder's saved tool ceiling before opening the authenticated graph-read session.
# Entity: Project Knowledge Graph
# Relationship: This file projects source categories, exact symbols, Files, and structural edges for the shared graph workspace and MCP pointer reads without replacing CBM as structural authority.

from __future__ import annotations

import hashlib
import json
import re
from itertools import islice
from pathlib import Path
from typing import Any
from urllib.parse import quote

from app.python_models import saved_cards
from app.python_models.graph_read_contract import (
    GRAPH_RECORD_BODY_LIMIT,
    MAX_GRAPH_READ_RESULTS,
    GraphReadError,
    utc_now_text,
)
from app.python_models.graph_read_client import call_graph_read_tools


_REPO_ROOT = Path(__file__).resolve().parents[4]
_CODEGRAPH_PROJECT = "C-Projects-LiquidAIty-main"
_CODEGRAPH_DECK_ID = "deck_builder"
_CODEGRAPH_CARD_ID = "builder"
_CBM_PAGE_SIZE = 200
_MAX_FILE_SOURCE_CHARS = 256_000
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
    result_limit: int = MAX_GRAPH_READ_RESULTS,
    include_tests: bool = False,
) -> dict[str, Any] | None:
    """Read one qualified current symbol through the official MCP/CBM seam."""

    if bounded_expansion < 0 or bounded_expansion > 3:
        raise GraphReadError("graph_read_expansion_invalid")
    if result_limit < 1 or result_limit > MAX_GRAPH_READ_RESULTS:
        raise GraphReadError("graph_read_result_limit_invalid")
    if not deck_id or not card_id:
        raise GraphReadError("codegraph_context_missing")
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
        results = call_graph_read_tools(
            project_id=project_id,
            deck_id=deck_id,
            card_id=card_id,
            calls=calls,
        )
    except Exception as error:
        raise GraphReadError("codegraph_read_failed") from error
    if len(results) != len(calls):
        raise GraphReadError("codegraph_result_invalid")
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
        "content": source[:GRAPH_RECORD_BODY_LIMIT],
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

    context = {"projectId": project_id, "deckId": deck_id, "cardId": card_id}
    if mode == "projection":
        context = _saved_builder_context(project_id, deck_id, card_id)
        return _read_codegraph_projection(context)
    if "qualifiedName" in payload:
        raise ValueError("codegraph_symbol_selection_not_supported")
    file_path = str(payload.get("filePath") or "").strip()
    if mode == "source":
        return _read_codegraph_file_source(context, file_path)
    file_paths = payload.get("filePaths")
    if file_path or not isinstance(file_paths, list) or not file_paths \
            or any(not isinstance(path, str) or not path.strip() for path in file_paths):
        raise ValueError("codegraph_file_paths_required")
    context = _saved_builder_context(project_id, deck_id, card_id)
    return _read_codegraph_files(context, file_paths)


def _saved_builder_context(
    project_id: str,
    deck_id: str,
    card_id: str,
) -> dict[str, Any]:
    try:
        loaded = saved_cards.load_deck(project_id, deck_id)
    except Exception as error:
        raise GraphReadError("codegraph_saved_deck_unavailable") from error
    deck = loaded.get("deck")
    if not isinstance(deck, dict):
        raise GraphReadError("codegraph_saved_deck_invalid")
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
        raise GraphReadError("codegraph_saved_builder_unavailable")
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
        "fileSource": None,
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
        "fileSource": None,
        "freshness": {"status": "unverified", "coverage": None},
        "truncated": False,
        "errors": [{"purpose": mode, "operation": operation, "code": code}],
    }


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


def _feature_contributions(file_paths: list[str]) -> tuple[list[dict[str, Any]], list[dict[str, str]]]:
    """Read the declared category and contribution from exact repository files."""
    contributions: dict[tuple[str, str, str], dict[str, Any]] = {}
    errors: list[dict[str, str]] = []
    root = _REPO_ROOT.resolve()
    for file_path in file_paths:
        try:
            source_path = (root / file_path).resolve(strict=True)
            relative = source_path.relative_to(root).as_posix()
            if ".." in file_path.replace("\\", "/").split("/") or not _eligible_source_path(relative):
                raise ValueError("codegraph_source_path_outside_scope")
            with source_path.open(encoding="utf-8-sig") as source:
                lines = list(islice(source, 81))
        except (OSError, ValueError):
            errors.append({"purpose": "feature-annotations", "operation": "source-header",
                           "code": "codegraph_source_header_unavailable", "filePath": file_path})
            continue
        for offset, line in enumerate(lines[:-1]):
            entity = _FEATURE_ENTITY.match(line)
            relationship = _FEATURE_RELATIONSHIP.match(lines[offset + 1])
            if not entity or not relationship:
                continue
            feature, statement = entity.group(1).strip(), relationship.group(1).strip()
            if not feature or not statement:
                continue
            contributions[(file_path, feature, statement)] = {
                "filePath": file_path, "feature": feature, "relationship": statement,
                "entityLine": offset + 1, "relationshipLine": offset + 2,
            }
    return [contributions[key] for key in sorted(contributions)], errors


def _feature_id(name: str) -> str:
    return "feature:" + quote(name, safe="")


def _category_source_paths(context: dict[str, Any]) -> list[str]:
    """Ask CBM for authored category declarations, never walk the repository."""
    paths: set[str] = set()
    offset = 0
    while True:
        results = call_graph_read_tools(
            project_id=context["projectId"], deck_id=context["deckId"], card_id=context["cardId"],
            calls=[("cbm.search_code", {
                "project": _CODEGRAPH_PROJECT, "pattern": "Entity:",
                "path_filter": r"^(apps|client|services)/|^vite\.config\.ts$",
                "mode": "files", "format": "json", "result_limit": 200,
                "result_offset": offset, "raw_limit": 0, "max_output_tokens": 16000,
            })],
        )
        result = results[0] if len(results) == 1 else {}
        if result.get("error") or not isinstance(result.get("files"), list):
            raise GraphReadError("codegraph_categories_unavailable")
        paths.update(path for value in result["files"] if isinstance(value, str)
                     and (path := _repository_path(value)) and _eligible_source_path(path))
        if not result.get("has_more"):
            return sorted(paths)
        following = result.get("next_offset")
        if type(following) is not int or following <= offset:
            raise GraphReadError("codegraph_category_cursor_not_advancing")
        offset = following


def _read_codegraph_projection(context: dict[str, Any]) -> dict[str, Any]:
    denied = _missing_grants(context, {"cbm.search_code"}, mode="projection")
    if denied:
        return denied
    try:
        file_paths = _category_source_paths(context)
    except Exception:
        return _provider_failure(context, mode="projection", operation="cbm.search_code",
                                 code="codegraph_categories_unavailable")
    contributions, header_errors = _feature_contributions(file_paths)
    contributions_by_path: dict[str, list[dict[str, Any]]] = {}
    feature_members: dict[str, set[str]] = {}
    for contribution in contributions:
        path = contribution["filePath"]
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
    edges: list[dict[str, Any]] = []

    revision_material = "\n".join(
        f"{item['filePath']}\t{item['feature']}\t{item['relationship']}"
        for item in contributions
    )
    revision = hashlib.sha256(revision_material.encode("utf-8")).hexdigest()
    errors: list[dict[str, str]] = list(header_errors)
    projection = {
        "schemaVersion": "codegraph.projection.v1",
        "authority": "codegraph",
        "projectId": context["projectId"],
        "revision": revision,
        "counts": {"nodes": len(nodes), "edges": len(edges)},
        "nodes": nodes,
        "edges": edges,
        "metadata": {
            "discoveryAuthority": "cbm.search_code",
            "featureAuthority": "inline-source-comments",
            "eligibleFileCount": len(file_paths),
            "classifiedFileCount": len(contributions_by_path),
            "featureCount": len(feature_members),
            "contributionCount": len(contributions),
            "revisionPurpose": "presentation-staleness-only",
        },
    }
    return {
        "schemaVersion": "codegraph.read.v1",
        "status": "unavailable" if errors and not feature_members else "partial" if errors else "ready",
        "mode": "projection",
        "scope": _scope(context),
        "projection": projection,
        "fileSource": None,
        "freshness": {"status": "current", "coverage": None},
        "truncated": False,
        "errors": errors,
    }


def _repository_path(value: str) -> str:
    path = value.replace("\\\\", "/")
    prefix = _REPO_ROOT.as_posix().rstrip("/") + "/"
    if path.lower().startswith(prefix.lower()):
        path = path[len(prefix):]
    if not path or path.startswith("/") or ":" in path or ".." in path.split("/"):
        return ""
    return path


def _valid_selected_file(value: str) -> str:
    path = value.replace("\\", "/").strip("/")
    if not _eligible_source_path(path) or ".." in path.split("/") or "'" in path:
        raise ValueError("codegraph_file_path_invalid")
    return path


def _read_codegraph_files(context: dict[str, Any], requested_paths: list[str]) -> dict[str, Any]:
    """CBM traverses the selected set; Python projects its file-level rows only."""
    denied = _missing_grants(context, {"cbm.query_graph"}, mode="file")
    if denied:
        return denied
    file_paths = sorted({_valid_selected_file(path) for path in requested_paths})
    selected = set(file_paths)
    literals = json.dumps(file_paths)
    pending = []
    for direction, pattern in (
        ("outgoing", "(a)-[r:CALLS|IMPORTS]->(b)"),
        ("incoming", "(b)-[r:CALLS|IMPORTS]->(a)"),
    ):
        pending.append((direction, {
            "project": _CODEGRAPH_PROJECT,
            "query": (
                f"MATCH (a) WHERE a.file_path IN {literals} "
                f"OPTIONAL MATCH {pattern} "
                "RETURN DISTINCT a.file_path AS selected, b.file_path AS neighbor, type(r) AS predicate"
            ),
            "format": "json", "max_rows": _CBM_PAGE_SIZE, "max_output_tokens": 24_000,
        }))
    pairs: set[tuple[str, str, str]] = set()
    observed_files: set[str] = set()
    errors: list[dict[str, str]] = []
    cursors: set[tuple[str, str]] = set()
    truncated = False
    # Only provider result-page transport repeats. CBM owns all graph traversal
    # and file aggregation, irrespective of how many selected files or symbols exist.
    while pending:
        try:
            results = call_graph_read_tools(
                project_id=context["projectId"], deck_id=context["deckId"], card_id=context["cardId"],
                calls=[("cbm.query_graph", arguments) for _, arguments in pending],
                concurrent=True, deadline_seconds=30,
            )
        except Exception:
            return _provider_failure(context, mode="file", operation="cbm.query_graph",
                                     code="codegraph_connections_unavailable")
        if len(results) != len(pending):
            errors.append({"purpose": "connections", "operation": "cbm.query_graph", "code": "codegraph_result_invalid"})
        following = []
        for (direction, arguments), result in zip(pending, results):
            if result.get("error"):
                errors.append({"purpose": "connections", "operation": "cbm.query_graph", "code": str(result["error"])})
                continue
            if result.get("columns") != ["selected", "neighbor", "predicate"] or not isinstance(result.get("rows"), list):
                errors.append({"purpose": "connections", "operation": "cbm.query_graph", "code": "codegraph_result_invalid"})
                continue
            for row in result["rows"]:
                if not isinstance(row, list) or len(row) != 3 or not isinstance(row[0], str):
                    errors.append({"purpose": "connections", "operation": "cbm.query_graph", "code": "codegraph_result_invalid"})
                    continue
                origin = _repository_path(row[0])
                if origin not in selected:
                    errors.append({"purpose": "connections", "operation": "cbm.query_graph", "code": "codegraph_result_scope_invalid"})
                    continue
                observed_files.add(origin)
                if row[1] in (None, "") and row[2] in (None, ""):
                    continue  # CBM found this file but no matching edge for this symbol.
                if not isinstance(row[1], str) or row[2] not in {"CALLS", "IMPORTS"}:
                    errors.append({"purpose": "connections", "operation": "cbm.query_graph", "code": "codegraph_result_invalid"})
                    continue
                neighbor = _repository_path(row[1])
                if not neighbor or neighbor.startswith("<") or neighbor == origin:
                    continue
                source, target = (origin, neighbor) if direction == "outgoing" else (neighbor, origin)
                pairs.add((source, target, row[2]))
            cursor = result.get("next_cursor") or result.get("next")
            if result.get("has_more") and isinstance(cursor, str) and cursor:
                if (direction, cursor) in cursors:
                    errors.append({"purpose": "connections", "operation": "cbm.query_graph", "code": "codegraph_cursor_not_advancing"})
                    truncated = True
                else:
                    cursors.add((direction, cursor))
                    following.append((direction, {**arguments, "cursor": cursor}))
            elif result.get("has_more") or result.get("truncated"):
                truncated = True
        pending = following
    for missing in sorted(selected - observed_files):
        errors.append({"purpose": "connections", "operation": "cbm.query_graph",
                       "code": "codegraph_file_not_indexed", "filePath": missing})
    paths = selected | {endpoint for source, target, _ in pairs for endpoint in (source, target)}
    contributions, _ = _feature_contributions([path for path in sorted(paths) if _eligible_source_path(path)])
    by_path: dict[str, list[dict[str, Any]]] = {}
    for contribution in contributions:
        by_path.setdefault(contribution["filePath"], []).append(contribution)
    complete = not errors and not truncated
    nodes = [{"id": "source-file:" + path, "label": Path(path).name, "title": path,
              "type": "File", "etype": "File", "authority": "codegraph", "properties": {
                  "recordKind": "file", "filePath": path, "sourceReference": "source-file:" + path,
                  "sourceAuthority": "repository-file", "structuralAuthority": "cbm",
                  "features": sorted({item["feature"] for item in by_path.get(path, [])}),
                  "contributions": by_path.get(path, []),
                  **({"structuralLoaded": True, "structuralComplete": complete} if path in selected else {}),
              }} for path in sorted(paths)]
    edges = [{
        "id": f"cbm:{predicate}:{source}:{target}",
        "source": "source-file:" + source, "target": "source-file:" + target,
        "predicate": predicate, "layer": "cbm-structure", "properties": {
            "recordKind": "structural-relationship", "structuralAuthority": "cbm",
            "evidence": f"cbm.query_graph:{predicate}:file-pairs",
        },
    } for source, target, predicate in sorted(pairs)]
    return {
        "schemaVersion": "codegraph.read.v1", "status": "ready" if complete else "partial", "mode": "file",
        "scope": _scope(context), "fileSource": None,
        "projection": {
            "schemaVersion": "codegraph.projection.v1", "authority": "codegraph", "projectId": context["projectId"],
            "revision": "connections:" + hashlib.sha256(json.dumps([file_paths, sorted(pairs)]).encode()).hexdigest(),
            "counts": {"nodes": len(nodes), "edges": len(edges)}, "nodes": nodes, "edges": edges,
            "metadata": {"structuralAuthority": "cbm", "selectedFilePaths": file_paths},
        },
        "freshness": {"status": "unverified", "coverage": None}, "truncated": truncated, "errors": errors,
    }


def _read_codegraph_file_source(context: dict[str, Any], file_path: str) -> dict[str, Any]:
    try:
        file_path = _valid_selected_file(file_path)
        root = _REPO_ROOT.resolve()
        source_path = (root / file_path).resolve(strict=True)
        source_path.relative_to(root)
        with source_path.open(encoding="utf-8-sig") as source_file:
            content = source_file.read(_MAX_FILE_SOURCE_CHARS + 1)
    except (OSError, ValueError, UnicodeError):
        return _provider_failure(context, mode="source", operation="source-file",
                                 code="codegraph_repository_source_unavailable")
    truncated = len(content) > _MAX_FILE_SOURCE_CHARS
    if truncated:
        content = content[:_MAX_FILE_SOURCE_CHARS]
    selected = {
        "graphSystem": "repository",
        "sourceReference": "source-file:" + file_path,
        "recordKind": "file", "type": "File", "title": Path(file_path).name,
        "content": content,
        "properties": {"project": _CODEGRAPH_PROJECT, "file": file_path,
                       "startLine": 1, "endLine": len(content.splitlines())},
        "provenance": {"project": _CODEGRAPH_PROJECT, "filePath": file_path,
                       "contentAuthority": "repository-file"},
        "asOf": utc_now_text(),
        "readOperation": "repository-file",
        "truncated": truncated,
    }
    return {
        "schemaVersion": "codegraph.read.v1", "status": "partial" if truncated else "ready",
        "mode": "source", "scope": _scope(context), "projection": None, "fileSource": selected,
        "freshness": {"status": "unverified", "coverage": None}, "truncated": truncated, "errors": [],
    }
