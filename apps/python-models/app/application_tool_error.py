"""Shared typed failure for application-owned Card and Canvas tools."""

# Entity: Application Tools
# Relationship: Defines the typed failure contract that code-owned application operations raise and the canonical dispatcher converts into structured tool errors.


class ApplicationToolError(Exception):
    pass
