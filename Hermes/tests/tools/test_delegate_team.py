"""LiquidAIty's bounded native Team doorway on the stock delegate tool."""

from __future__ import annotations

import json


class _Parent:
    _delegate_depth = 0
    session_id = "session-team-1"


def test_team_routes_directly_to_auto_kanban_without_temporary_children(monkeypatch):
    from hermes_cli import kanban_team
    from tools import delegate_tool

    captured = {}

    def submit_team(**kwargs):
        captured.update(kwargs)
        return {"ok": True, "role": "team", "task_id": "t_team"}

    monkeypatch.setattr(delegate_tool, "is_spawn_paused", lambda: False)
    monkeypatch.setattr(delegate_tool, "_get_max_spawn_depth", lambda: 2)
    monkeypatch.setattr(delegate_tool, "_load_config", lambda: {})
    monkeypatch.setattr(kanban_team, "submit_team", submit_team)
    monkeypatch.setattr(
        delegate_tool,
        "_resolve_delegation_credentials",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            AssertionError("Team must branch before temporary child credentials")
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


def test_team_accepts_only_one_top_level_goal_and_no_schema(monkeypatch):
    from tools import delegate_tool

    monkeypatch.setattr(delegate_tool, "is_spawn_paused", lambda: False)
    monkeypatch.setattr(delegate_tool, "_get_max_spawn_depth", lambda: 2)
    monkeypatch.setattr(delegate_tool, "_load_config", lambda: {})
    parent = _Parent()

    batch = json.loads(delegate_tool.delegate_task(
        goal="One durable mission",
        tasks=[],
        role="team",
        parent_agent=parent,
    ))
    schema = json.loads(delegate_tool.delegate_task(
        goal="One durable mission",
        output_schema={"type": "object"},
        role="team",
        parent_agent=parent,
    ))

    assert "exactly one goal/context" in batch["error"]
    assert "does not accept output_schema" in schema["error"]


def test_team_worker_cannot_start_any_nested_delegation(monkeypatch):
    from tools import delegate_tool

    monkeypatch.setenv("HERMES_KANBAN_TEAM_WORKER", "1")
    payload = json.loads(delegate_tool.delegate_task(
        goal="Try to escape the depth-one recipe.",
        role="leaf",
        parent_agent=_Parent(),
    ))
    assert "cannot delegate nested team, leaf, or orchestrator" in payload["error"]


def test_native_schema_keeps_compatibility_roles_but_team_is_top_level_only():
    from tools.delegate_tool import _build_dynamic_schema_overrides

    parameters = _build_dynamic_schema_overrides()["parameters"]
    assert parameters["properties"]["role"]["enum"] == [
        "leaf", "orchestrator", "team",
    ]
    assert parameters["properties"]["tasks"]["items"]["properties"]["role"]["enum"] == [
        "leaf", "orchestrator",
    ]
