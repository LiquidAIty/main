"""Bounded, non-history decision context for one saved Card Run."""
from __future__ import annotations

import math
from typing import Any


_REFERENCE_ID_FIELDS = (
    "engraphisMemoryId", "engraphisEntityId", "engraphisRelationshipId",
    "graphitiEpisodeId", "graphitiEntityId", "graphitiRelationshipId", "cbmQualifiedName",
)
_ATTACHMENT_METADATA_FIELDS = ("id", "name", "filename", "mediaType",
    "mimeType", "size", "sizeBytes",
    "width", "height", "source", "url", "sha256", "schemaVersion",
)


def _bounded_metadata(value: Any, *, depth: int = 0) -> Any:
    """Preserve small provenance values exactly; reject blobs and deep structures."""

    if depth > 3:
        raise ValueError("metadata depth")
    if value is None or isinstance(value, (bool, int)):
        return value
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ValueError("metadata number")
        return value
    if isinstance(value, str):
        if len(value) > 2_048 or value.lstrip().lower().startswith("data:"):
            raise ValueError("metadata text")
        return value
    if isinstance(value, list):
        if len(value) > 32:
            raise ValueError("metadata list")
        return [_bounded_metadata(item, depth=depth + 1) for item in value]
    if isinstance(value, dict):
        if len(value) > 32 or any(
            not isinstance(key, str) or not key or len(key) > 128
            for key in value
        ):
            raise ValueError("metadata object")
        return {key: _bounded_metadata(item, depth=depth + 1) for key, item in value.items()}
    raise ValueError("metadata value")


def _text(value: Any, *, maximum: int, required: bool = True) -> str:
    if not isinstance(value, str) or len(value) > maximum or (required and not value.strip()):
        raise ValueError("text")
    return value


def _bounded_strings(value: Any, *, maximum_count: int = 32) -> list[str]:
    if not isinstance(value, list) or len(value) > maximum_count:
        raise ValueError("string list")
    result: list[str] = []
    seen: set[str] = set()
    for raw in value:
        item = _text(raw, maximum=128)
        if item in seen:
            raise ValueError("string list")
        seen.add(item)
        result.append(item)
    return result


def _reference_context(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for record in records:
        if not isinstance(record, dict):
            continue
        item = {
            key: record[key]
            for key in _REFERENCE_ID_FIELDS
            if isinstance(record.get(key), str) and str(record[key]).strip()
        }
        if not item:
            continue
        provenance = record.get("provenance")
        if isinstance(provenance, dict):
            try:
                item["provenance"] = _bounded_metadata(provenance)
            except ValueError:
                pass
        for key in ("sourcePath", "sourceUrl", "readOperation"):
            if isinstance(record.get(key), str) and str(record[key]).strip():
                try:
                    item[key] = _bounded_metadata(record[key])
                except ValueError:
                    pass
        result.append(item)
    return result


def _attachment_context(attachments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for attachment in attachments:
        if not isinstance(attachment, dict):
            continue
        metadata: dict[str, Any] = {}
        for key in _ATTACHMENT_METADATA_FIELDS:
            value = attachment.get(key)
            if isinstance(value, str):
                if len(value) > 2_048 or value.lstrip().lower().startswith("data:"):
                    continue
                metadata[key] = value
            elif isinstance(value, (bool, int)):
                metadata[key] = value
            elif isinstance(value, float) and math.isfinite(value):
                metadata[key] = value
        result.append(metadata)
    return result


def selection_context(
    *,
    current_request: str,
    instructions: str,
    output_contract: str,
    graph_records: list[dict[str, Any]],
    attachments: list[dict[str, Any]],
    estimated_visible_tokens: int,
) -> dict[str, Any]:
    """Project only the authorized, non-history decision context."""

    if (
        not isinstance(estimated_visible_tokens, int)
        or isinstance(estimated_visible_tokens, bool)
        or estimated_visible_tokens < 0
    ):
        raise ValueError("estimated visible tokens")
    return {
        "current_request": _text(current_request, maximum=180_000),
        "saved_instructions": _text(instructions, maximum=120_000, required=False),
        "saved_output_contract": _text(
            output_contract, maximum=60_000, required=False,
        ),
        "selected_graph_references": _reference_context(graph_records),
        "attachment_metadata": _attachment_context(attachments),
        "estimated_visible_tokens": estimated_visible_tokens,
    }
