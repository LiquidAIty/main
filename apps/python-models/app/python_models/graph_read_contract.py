"""Shared limits and value normalization for live provider graph reads."""

# Entity: Project Knowledge Graph
# Relationship: This file centralizes bounded graph-read limits, typed provider failures, canonical JSON, safe value conversion, and UTC timestamp formatting for the live graph UI.

from __future__ import annotations

from datetime import datetime, timezone
import json
from typing import Any


GRAPH_RECORD_BODY_LIMIT = 12_000
GRAPH_CONTEXT_BYTE_LIMIT = 48_000
MAX_GRAPH_READ_RESULTS = 24


class GraphReadError(ValueError):
    """Typed failure while reading one provider-owned graph record or projection."""


def canonical_json(value: Any) -> str:
    return json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    )


def json_safe(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, dict):
        return {str(key): json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [json_safe(item) for item in value]
    isoformat = getattr(value, "isoformat", None)
    if callable(isoformat):
        return isoformat()
    return str(value)


def utc_now_text() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
