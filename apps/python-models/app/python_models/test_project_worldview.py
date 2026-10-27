"""Focused Project WorldView capability persistence contracts."""

# Graph + less = more: less code that does the same work as more code is more useful.
# Entity names the feature; Relationship explains why this file belongs and what it contributes.
# Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
# Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
# Entity: WorldView
# Relationship: Verifies Main capability writes preserve user authority, validate identifiers and bounded reasons, and return the effective Project database result.

from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime, timezone

import pytest

from app.python_models.project_worldview import (
    ProjectWorldviewError,
    set_main_project_worldview_capability,
)


class Cursor:
    def __init__(self, rows):
        self.rows = rows
        self.executed = None

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return None

    def execute(self, sql, params):
        self.executed = (sql, params)

    def fetchall(self):
        return self.rows

    def fetchone(self):
        return self.rows[0] if self.rows else None


class Connection:
    def __init__(self, rows):
        self.cursor_value = Cursor(rows)

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return None

    def cursor(self, **_kwargs):
        return self.cursor_value


def connector(rows):
    @contextmanager
    def open_connection():
        yield Connection(rows)

    return open_connection


def test_main_write_changes_only_main_fields_and_user_choice_wins_readback():
    connection = Connection([{
        "capability_id": "weather",
        "main_enabled": True,
        "main_reason": "Current research needs weather context.",
        "user_enabled": False,
        "last_origin": "main",
        "updated_at": datetime(2026, 9, 27, tzinfo=timezone.utc),
    }])

    @contextmanager
    def open_connection():
        yield connection

    result = set_main_project_worldview_capability(
        "project-a",
        "weather",
        True,
        "Current research needs weather context.",
        connector=open_connection,
    )

    sql, params = connection.cursor_value.executed
    assert "main_enabled=EXCLUDED.main_enabled" in sql
    assert "main_reason=EXCLUDED.main_reason" in sql
    assert "user_enabled=" not in sql.split("DO UPDATE SET", 1)[1]
    assert params == (
        "project-a",
        "weather",
        True,
        "Current research needs weather context.",
    )
    assert result == {
        "schemaVersion": "project-worldview.v1",
        "projectId": "project-a",
        "capability": {
            "capabilityId": "weather",
            "enabled": False,
            "controlledBy": "user",
            "lastOrigin": "main",
            "mainReason": "Current research needs weather context.",
            "updatedAt": "2026-09-27T00:00:00+00:00",
        },
    }


@pytest.mark.parametrize(
    ("enabled", "reason", "error"),
    [
        (1, "Relevant", "project_worldview_enabled_invalid"),
        (True, "", "project_worldview_main_reason_required"),
        (True, "x" * 1001, "project_worldview_main_reason_too_long"),
    ],
)
def test_main_write_rejects_widened_or_unbounded_values(enabled, reason, error):
    with pytest.raises(ProjectWorldviewError, match=error):
        set_main_project_worldview_capability(
            "project-a",
            "weather",
            enabled,
            reason,
            connector=connector([]),
        )


@pytest.mark.parametrize("value", ["", "Bad Source", "UPPER", "../weather"])
def test_invalid_capability_identity_is_rejected(value):
    with pytest.raises(ProjectWorldviewError, match="project_worldview_capability_id_invalid"):
        set_main_project_worldview_capability(
            "project-a",
            value,
            True,
            "Current Project layer choice.",
            connector=connector([]),
        )
