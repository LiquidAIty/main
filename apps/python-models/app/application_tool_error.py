"""Shared typed failure for application-owned Card and Canvas tools."""

# Entity: Tool Catalog
# Relationship: This file defines the typed failure contract raised by code-owned operations and converted by the canonical dispatcher into structured tool errors.


class ApplicationToolError(Exception):
    pass
