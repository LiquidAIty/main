from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime, timezone

import pytest

from app.python_models.project_worldview import (
    ProjectWorldviewError,
    resolve_project_worldview,
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


def test_absent_project_rows_preserve_existing_capability_availability():
    result = resolve_project_worldview(
        "project-a",
        ["web_search", "weather", "web_search"],
        connector=connector([]),
    )

    assert result == {
        "schemaVersion": "project-worldview.v1",
        "projectId": "project-a",
        "defaultEnabled": True,
        "candidateCapabilities": ["web_search", "weather"],
        "enabledCapabilities": ["web_search", "weather"],
        "excludedCapabilities": [],
        "overrides": [],
    }


def test_user_override_precedes_main_and_off_is_a_hard_candidate_ceiling():
    result = resolve_project_worldview(
        "project-a",
        ["web_search", "weather", "aircraft"],
        connector=connector([
            {
                "capability_id": "weather",
                "main_enabled": True,
                "main_reason": "Research task",
                "user_enabled": False,
                "last_origin": "user",
                "updated_at": datetime(2026, 9, 27, tzinfo=timezone.utc),
            },
            {
                "capability_id": "aircraft",
                "main_enabled": False,
                "main_reason": "Not relevant to this Project",
                "user_enabled": None,
                "last_origin": "main",
                "updated_at": datetime(2026, 9, 27, tzinfo=timezone.utc),
            },
        ]),
    )

    assert result["enabledCapabilities"] == ["web_search"]
    assert result["excludedCapabilities"] == ["weather", "aircraft"]
    assert result["overrides"][0] == {
        "capabilityId": "weather",
        "enabled": False,
        "controlledBy": "user",
        "lastOrigin": "user",
        "mainReason": "Research task",
        "updatedAt": "2026-09-27T00:00:00+00:00",
    }


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
        resolve_project_worldview(
            "project-a",
            [value],
            connector=connector([]),
        )
