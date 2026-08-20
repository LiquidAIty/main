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
from typing import Any


_REPO_ROOT = Path(__file__).resolve().parents[4]
_DEFAULT_THINKGRAPH_DB = _REPO_ROOT / "db" / "thinkgraph-engraphis-v2.sqlite"
_ANCHOR_BODY_LIMIT = 12_000
_GRAPH_SEED_LIMIT = 48_000


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
    }


def _render_anchor(anchor: dict[str, Any], record: dict[str, Any]) -> str:
    properties = {
        "type": record["type"],
        "title": record["title"],
        "metadata": record["metadata"],
        "provenance": record["provenance"],
    }
    return "\n".join([
        f"### Data Anchor: {record['authority']} / {record['nativeId']}",
        f"Selection reason (guidance, not verified fact): {anchor['reason']}",
        f"Verified native read as of: {record['asOf']}",
        f"Verified native properties: {json.dumps(properties, ensure_ascii=False, separators=(',', ':'))}",
        "Verified native content:",
        record["content"],
    ]).strip()


def resolve_data_anchors(
    project_id: str,
    anchors: list[dict[str, Any]],
    *,
    thinkgraph_db_path: str | Path | None = None,
) -> tuple[str, list[dict[str, Any]]]:
    """Resolve ordered anchors and return model text plus native references."""
    rendered: list[str] = []
    references: list[dict[str, Any]] = []
    for anchor in anchors:
        authority = anchor["authority"]
        if anchor["boundedExpansion"] != 0:
            raise DataAnchorError("data_anchor_expansion_not_supported")
        if authority != "ThinkGraph":
            if anchor["required"]:
                raise DataAnchorError(f"data_anchor_resolver_unavailable:{authority}")
            continue
        record = read_thinkgraph_exact(
            project_id,
            anchor["nativeId"],
            db_path=thinkgraph_db_path,
        )
        if record is None:
            if anchor["required"]:
                raise DataAnchorError("data_anchor_required_not_found")
            continue
        rendered.append(_render_anchor(anchor, record))
        references.append({
            "authority": record["authority"],
            "nativeId": record["nativeId"],
            "reason": anchor["reason"],
            "asOf": record["asOf"],
            "required": anchor["required"],
        })
    if anchors and not rendered:
        raise DataAnchorError("data_anchor_resolution_empty")
    graph_seed = "\n\n".join(rendered)
    if len(graph_seed.encode("utf-8")) > _GRAPH_SEED_LIMIT:
        raise DataAnchorError("data_anchor_seed_limit_exceeded")
    return graph_seed, references
