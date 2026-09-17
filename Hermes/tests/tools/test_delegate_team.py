"""Focused contracts for LiquidAIty's two persistent delegate_task roles."""

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
    assert "cannot delegate nested team, profile, leaf, or orchestrator" in payload["error"]


def test_schema_exposes_persistent_roles_only_at_top_level():
    from tools.delegate_tool import _build_dynamic_schema_overrides

    parameters = _build_dynamic_schema_overrides()["parameters"]
    assert parameters["properties"]["role"]["enum"] == ["team", "profile"]
    assert "role" not in parameters["properties"]["tasks"]["items"]["properties"]
    assert parameters["properties"]["dataAnchors"]["maxItems"] == 16


def test_profile_calls_exactly_one_host_authorized_profile(monkeypatch):
    from tools import delegate_tool

    _prepare(monkeypatch, delegate_tool)
    calls = []

    def requester(method, params):
        calls.append((method, params))
        return {
            "nativeChildId": params["nativeChildId"],
            "targetProfile": params["targetProfile"],
            "runId": "child-run",
            "result": "Graph result",
        }

    parent = _Parent()
    parent._host_execution_requester = requester
    parent._host_execution_context_id = "root-context"
    parent._host_execution_session_id = "native-session"
    parent._host_profile_targets = [{
        "profile": "graph-agent", "title": "Graph Agent", "description": "",
    }]
    anchors = [{
        "authority": "ThinkGraph",
        "nativeId": "memory-project-frame",
        "reason": "Use the accepted project frame",
        "priority": 10,
        "boundedExpansion": 1,
        "resultLimit": 8,
    }]
    result = json.loads(delegate_tool.delegate_task(
        goal="Inspect the selected native graph.",
        context="Return bounded provenance.",
        role="profile",
        target_profile="graph-agent",
        data_anchors=anchors,
        parent_agent=parent,
    ))

    assert result["targetProfile"] == "graph-agent"
    assert result["runId"] == "child-run"
    assert calls[0][0] == "session/delegate_profile"
    assert calls[0][1]["parentExecutionContextId"] == "root-context"
    assert calls[0][1]["goal"] == "Inspect the selected native graph."
    assert calls[0][1]["context"] == "Return bounded provenance."
    assert calls[0][1]["dataAnchors"] == anchors
    assert calls[0][1]["nativeChildId"].startswith("profile-")

    forged = json.loads(delegate_tool.delegate_task(
        goal="Try an unconnected profile.",
        role="profile",
        target_profile="forged",
        parent_agent=parent,
    ))
    assert "not authorized" in forged["error"]
    assert len(calls) == 1


def test_profile_fails_closed_without_host_context(monkeypatch):
    from tools import delegate_tool

    _prepare(monkeypatch, delegate_tool)
    parent = _Parent()
    parent._host_profile_targets = [{"profile": "builder"}]
    result = json.loads(delegate_tool.delegate_task(
        goal="Use the existing Builder profile.",
        role="profile",
        target_profile="builder",
        parent_agent=parent,
    ))
    assert result["error"] == "Profile delegation host context is unavailable."


def test_run_agent_forwards_profile_fields_and_background(monkeypatch):
    import run_agent
    from tools import delegate_tool

    captured = {}

    def fake_delegate_task(**kwargs):
        captured.update(kwargs)
        return "{}"

    monkeypatch.setattr(delegate_tool, "delegate_task", fake_delegate_task)
    run_agent.AIAgent._dispatch_delegate_task(
        _Parent(),
        {
            "goal": "Inspect the graph",
            "role": "profile",
            "target_profile": "graph-agent",
            "dataAnchors": [{"nativeId": "n1"}],
            "background": True,
        },
    )
    assert captured["target_profile"] == "graph-agent"
    assert captured["data_anchors"] == [{"nativeId": "n1"}]
    assert captured["background"] is True
