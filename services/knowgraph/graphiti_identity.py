"""Canonical authenticated-project namespace for Graphiti."""
# Graph + less = more: less code that does the same work as more code is more useful.
# Entity names the feature; Relationship explains why this file belongs and what it contributes.
# Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
# Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
# Entity: KnowGraph
# Relationship: This file contributes validated Project identifiers and deterministic Graphiti group namespaces to KnowGraph ingestion and deletion.

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
