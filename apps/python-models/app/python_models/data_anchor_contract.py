"""Shared limits and value normalization for selected graph references."""

from __future__ import annotations

from datetime import datetime, timezone
import json
from typing import Any


ANCHOR_BODY_LIMIT = 12_000
GRAPH_CONTEXT_BYTE_LIMIT = 48_000
MAX_GRAPH_REFERENCE_RESULTS = 24


class DataAnchorError(ValueError):
    """Typed failure while resolving selected provider graph references."""


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
