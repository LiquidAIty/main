"""The codex_app_server runtime hands Hermes' composed system prompt to the codex thread (#74712, #26035).

The standard loop sends ``_cached_system_prompt + ephemeral_system_prompt`` as its system message; the
codex early-return used to send only cwd + raw user text, so SOUL.md / memory / channel_overrides were
composed and then silently dropped.
"""

import json
import threading
from types import SimpleNamespace

import pytest

from agent import codex_runtime
from agent.transports import codex_app_server_session as sess_mod


class _FakeClient:
    def __init__(self, **_kw):
        self.requests = []
        self.closed = 0

    def close(self):
        self.closed += 1

    def initialize(self, **_kw):
        return {}

    def request(self, method, params=None, timeout=None):
        self.requests.append((method, params))
        return {"thread": {"id": "t1"}}


def _agent(**overrides):
    base = dict(_codex_session=None, session_cwd="/tmp", tool_progress_callback=None,
                _cached_system_prompt="SOUL: you are Hermes", ephemeral_system_prompt="Always start with ZZZ")
    base.update(overrides)
    return SimpleNamespace(**base)


def test_runtime_sends_composed_prompt_once_per_thread(monkeypatch):
    """Composition mirrors turn_context (prompt + blank line + ephemeral); sent on thread/start
    exactly once even though _ensure_codex_session runs on every turn."""
    client = _FakeClient()
    monkeypatch.setattr(sess_mod, "CodexAppServerClient", lambda **kw: client)
    agent = _agent()
    for _ in range(3):  # three turns reuse one session
        codex_runtime._ensure_codex_session(agent)
        agent._codex_session.ensure_started()
    starts = [p for (m, p) in client.requests if m == "thread/start"]
    assert len(starts) == 1
    assert starts[0]["developerInstructions"] == "SOUL: you are Hermes\n\nAlways start with ZZZ"


def test_runtime_omits_prompt_when_agent_has_none(monkeypatch):
    """No cached prompt and no ephemeral additions → no developerInstructions field at all."""
    client = _FakeClient()
    monkeypatch.setattr(sess_mod, "CodexAppServerClient", lambda **kw: client)
    agent = _agent(_cached_system_prompt=None, ephemeral_system_prompt=None)
    codex_runtime._ensure_codex_session(agent)
    agent._codex_session.ensure_started()
    (_, params), = [(m, p) for (m, p) in client.requests if m == "thread/start"]
    assert "developerInstructions" not in params


def test_runtime_retires_thread_when_prompt_composition_changes(monkeypatch):
    """TUI/Desktop ``/personality`` mutates the live agent's ephemeral prompt in place; the next turn must
    retire the thread started with the old composition and start one carrying the new developerInstructions."""
    client = _FakeClient()
    monkeypatch.setattr(sess_mod, "CodexAppServerClient", lambda **kw: client)
    agent = _agent()
    codex_runtime._ensure_codex_session(agent)
    agent._codex_session.ensure_started()
    agent.ephemeral_system_prompt = "Personality: pirate"
    codex_runtime._ensure_codex_session(agent)
    agent._codex_session.ensure_started()
    starts = [p["developerInstructions"] for (m, p) in client.requests if m == "thread/start"]
    assert starts == ["SOUL: you are Hermes\n\nAlways start with ZZZ", "SOUL: you are Hermes\n\nPersonality: pirate"]
    assert client.closed == 1  # the stale thread's client was closed, not leaked


@pytest.mark.parametrize("roster,expected", [(None, False), ([], False), (["knowgraph"], True)])
def test_codex_projects_message_agent_only_for_an_authorized_roster(
    monkeypatch, roster, expected,
):
    from tools import bot_mode_dm

    agent = _agent(_dynamic_tools=[], _bot_mode_roster=roster)
    monkeypatch.setattr(
        bot_mode_dm,
        "message_agent_authorized",
        lambda value: bool(value._bot_mode_roster),
    )

    projected, canonical_names = codex_runtime._dynamic_tools_configuration(agent)
    message_tools = [item for item in projected if item["name"] == "message_agent"]

    assert bool(message_tools) is expected
    assert ("message_agent" in canonical_names) is expected
    if expected:
        function = bot_mode_dm.message_agent_tool_schema()["function"]
        assert message_tools == [{
            "type": "function",
            "name": "message_agent",
            "canonicalName": "message_agent",
            "description": function["description"],
            "inputSchema": function["parameters"],
        }]


def test_codex_message_agent_uses_the_exact_hermes_inline_owner(monkeypatch):
    from agent import inline_tool_executors
    from tools import bot_mode_dm

    calls = []
    agent = _agent(_dynamic_tools=[], _bot_mode_roster=["knowgraph"])
    monkeypatch.setattr(bot_mode_dm, "message_agent_authorized", lambda _agent: True)
    monkeypatch.setitem(
        inline_tool_executors.INLINE_TOOL_EXECUTORS,
        "message_agent",
        lambda actual_agent, arguments, context: calls.append(
            (actual_agent, arguments, context.effective_task_id, context.tool_call_id),
        ) or json.dumps({"status": "queued", "delivery_id": "delivery-one"}),
    )
    projected, canonical_names = codex_runtime._dynamic_tools_configuration(agent)
    executor = codex_runtime._dynamic_tool_executor(
        agent, canonical_names, "task-one",
    )

    result = executor(
        "message_agent",
        {"target": "knowgraph", "message": "Research Rocket Lab."},
        "call-one",
        threading.Event(),
    )

    assert any(item["name"] == "message_agent" for item in projected)
    assert calls == [(
        agent,
        {"target": "knowgraph", "message": "Research Rocket Lab."},
        "task-one",
        "call-one",
    )]
    assert result["success"] is True
    assert json.loads(result["contentItems"][0]["text"])["delivery_id"] == "delivery-one"


def test_codex_rejects_a_card_tool_named_message_agent(monkeypatch):
    from tools import bot_mode_dm

    agent = _agent(_dynamic_tools=[{
        "type": "function",
        "name": "message_agent",
        "canonical_name": "application.message_agent",
        "description": "invalid collision",
        "input_schema": {"type": "object", "properties": {}},
    }], _bot_mode_roster=["knowgraph"])
    monkeypatch.setattr(bot_mode_dm, "message_agent_authorized", lambda _agent: True)

    with pytest.raises(ValueError, match="dynamic_tool_name_collision:message_agent"):
        codex_runtime._dynamic_tools_configuration(agent)
