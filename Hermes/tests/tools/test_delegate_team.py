"""Focused contracts for LiquidAIty's durable Team delegate_task role."""

from __future__ import annotations

import json


class _Parent:
    _delegate_depth = 0
    session_id = "session-team-1"


def _prepare(monkeypatch, delegate_tool):
    monkeypatch.setattr(delegate_tool, "is_spawn_paused", lambda: False)
    monkeypatch.setattr(delegate_tool, "_get_max_spawn_depth", lambda: 2)
    monkeypatch.setattr(delegate_tool, "_load_config", lambda: {})


def test_team_routes_to_auto_kanban_before_temporary_child_construction(monkeypatch):
    from hermes_cli import kanban_team
    from tools import delegate_tool

    _prepare(monkeypatch, delegate_tool)
    captured = {}

    def submit_team(**kwargs):
        captured.update(kwargs)
        return {"ok": True, "role": "team", "task_id": "t_team"}

    monkeypatch.setattr(kanban_team, "submit_team", submit_team)
    monkeypatch.setattr(
        delegate_tool,
        "_resolve_delegation_credentials",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            AssertionError("Team must branch before temporary-child credentials")
        ),
    )

    parent = _Parent()
    payload = json.loads(delegate_tool.delegate_task(
        goal="Audit the exact native lifecycle.",
        context="Return one synthesized report with evidence.",
        role="team",
        parent_agent=parent,
    ))

    assert payload == {"ok": True, "role": "team", "task_id": "t_team"}
    assert captured == {
        "goal": "Audit the exact native lifecycle.",
        "context": "Return one synthesized report with evidence.",
        "parent_agent": parent,
    }


def test_team_rejects_batch_schema_and_images(monkeypatch):
    from tools import delegate_tool

    _prepare(monkeypatch, delegate_tool)
    parent = _Parent()

    batch = json.loads(delegate_tool.delegate_task(
        goal="One durable mission", tasks=[], role="team", parent_agent=parent,
    ))
    schema = json.loads(delegate_tool.delegate_task(
        goal="One durable mission", output_schema={"type": "object"}, role="team", parent_agent=parent,
    ))
    images = json.loads(delegate_tool.delegate_task(
        goal="One durable mission", images=["image.png"], role="team", parent_agent=parent,
    ))

    assert "exactly one goal/context" in batch["error"]
    assert "does not accept output_schema" in schema["error"]
    assert "does not accept images" in images["error"]


def test_team_worker_cannot_start_nested_delegation(monkeypatch):
    from tools import delegate_tool

    monkeypatch.setenv("HERMES_KANBAN_TEAM_WORKER", "1")
    payload = json.loads(delegate_tool.delegate_task(
        goal="Try to escape the depth-one recipe.", role="leaf", parent_agent=_Parent(),
    ))
    assert "cannot delegate nested team, leaf, or orchestrator" in payload["error"]


def test_schema_exposes_persistent_roles_only_at_top_level():
    from tools.delegate_tool import _build_dynamic_schema_overrides

    parameters = _build_dynamic_schema_overrides()["parameters"]
    assert parameters["properties"]["role"]["enum"] == ["team"]
    assert "role" not in parameters["properties"]["tasks"]["items"]["properties"]
    removed_profile_fields = {"target_" + "profile", "data" + "Anchors"}
    assert removed_profile_fields.isdisjoint(parameters["properties"])
