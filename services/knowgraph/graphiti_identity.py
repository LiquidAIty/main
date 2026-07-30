"""Canonical authenticated-project namespace for Graphiti."""

from __future__ import annotations

import re

GRAPHITI_PROJECT_GROUP_PREFIX = "liquidaity-"
_PROJECT_ID = re.compile(r"^[A-Za-z0-9_-]+$")


def graphiti_project_group_id(project_id: str) -> str:
    """Return Graphiti's legal, deterministic namespace for one project."""
    value = str(project_id or "").strip()
    if not value or not _PROJECT_ID.fullmatch(value):
        raise ValueError("graphiti_project_id_invalid")
    return f"{GRAPHITI_PROJECT_GROUP_PREFIX}{value}"
