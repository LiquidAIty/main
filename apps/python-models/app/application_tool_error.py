"""Shared typed failure for application-owned Card and Canvas tools."""

# Graph + less = more: less code that does the same work as more code is more useful.
# Entity names the feature; Relationship explains why this file belongs and what it contributes.
# Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
# Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
# Entity: Tool Catalog
# Relationship: This file defines the typed failure contract raised by code-owned operations and converted by the canonical dispatcher into structured tool errors.


class ApplicationToolError(Exception):
    pass
