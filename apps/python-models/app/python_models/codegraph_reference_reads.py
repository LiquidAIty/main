"""Exact repository-symbol reads from the official Codebase Memory authority."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from app.python_models.data_anchor_contract import (
    ANCHOR_BODY_LIMIT,
    MAX_GRAPH_REFERENCE_RESULTS,
    DataAnchorError,
    utc_now_text,
)
from app.python_models.materializer_read_tools import call_materializer_read_tools


_REPO_ROOT = Path(__file__).resolve().parents[4]
_CODEGRAPH_PROJECT = "C-Projects-LiquidAIty-main"


def read_codegraph_exact(
    project_id: str,
    deck_id: str,
    card_id: str,
    requested_qualified_name: str,
    *,
    bounded_expansion: int = 0,
    result_limit: int = MAX_GRAPH_REFERENCE_RESULTS,
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
            "include_tests": False,
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
