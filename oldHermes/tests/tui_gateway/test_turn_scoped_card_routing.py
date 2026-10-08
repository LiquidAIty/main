from __future__ import annotations

import contextlib
import threading
from types import SimpleNamespace

import pytest

from tui_gateway import methods_prompt, prompt_turn
from tui_gateway.method_ctx import rebind


def _tool(name: str) -> dict:
    return {
        "type": "function",
        "function": {
            "name": name,
            "description": name,
            "parameters": {"type": "object", "properties": {}},
        },
    }


def test_turn_tool_selection_is_exact_and_restores_native_agent_state() -> None:
    tools = [_tool("unmanaged"), _tool("card__read"), _tool("card__write")]
    agent = SimpleNamespace(
        tools=tools,
        valid_tool_names={"unmanaged", "card__read", "card__write"},
        _cached_system_prompt="cached",
        _cached_system_prompt_static="static",
    )

    snapshot, exposed = prompt_turn._apply_turn_tool_selection(
        agent,
        ["card__read", "card__write"],
        ["card__read"],
    )

    assert [item["function"]["name"] for item in agent.tools] == [
        "unmanaged", "card__read",
    ]
    assert agent.valid_tool_names == {"unmanaged", "card__read"}
    assert exposed == ["card__read", "unmanaged"]
    assert agent._cached_system_prompt is None
    assert agent._cached_system_prompt_static is None

    prompt_turn._restore_turn_tool_selection(agent, snapshot)

    assert agent.tools == tools
    assert agent.valid_tool_names == {"unmanaged", "card__read", "card__write"}
    assert agent._cached_system_prompt == "cached"
    assert agent._cached_system_prompt_static == "static"


def test_turn_tool_selection_rejects_unavailable_choice_without_mutation() -> None:
    tools = [_tool("unmanaged"), _tool("card__read")]
    agent = SimpleNamespace(
        tools=tools,
        valid_tool_names={"unmanaged", "card__read"},
        _cached_system_prompt="cached",
        _cached_system_prompt_static="static",
    )

    with pytest.raises(ValueError, match="turn_tool_selection_unavailable:card__write"):
        prompt_turn._apply_turn_tool_selection(
            agent,
            ["card__read", "card__write"],
            ["card__write"],
        )

    assert agent.tools is tools
    assert agent.valid_tool_names == {"unmanaged", "card__read"}
    assert agent._cached_system_prompt == "cached"
    assert agent._cached_system_prompt_static == "static"


def test_observable_turn_evidence_keeps_only_current_tool_calls_and_results() -> None:
    prior = [{"role": "user", "content": "earlier"}]
    result = {
        "messages": [
            *prior,
            {"role": "assistant", "content": "I will inspect it.", "tool_calls": [{
                "id": "call-1",
                "function": {"name": "card__read", "arguments": '{"id":"n-1"}'},
            }]},
            {
                "role": "tool",
                "tool_call_id": "call-1",
                "name": "card__read",
                "content": {"nativeId": "n-1"},
            },
            {"role": "assistant", "content": "Done."},
        ]
    }
    state = SimpleNamespace(result=result, history=prior)

    evidence, complete, error = prompt_turn._observable_turn_evidence(state)

    assert complete is True
    assert error is None
    assert evidence == [
        {
            "kind": "tool_call",
            "toolCallId": "call-1",
            "name": "card__read",
            "arguments": '{"id":"n-1"}',
        },
        {
            "kind": "tool_result",
            "toolCallId": "call-1",
            "name": "card__read",
            "content": {"nativeId": "n-1"},
        },
    ]


def test_observable_turn_evidence_refuses_changed_history() -> None:
    state = SimpleNamespace(
        history=[{"role": "user", "content": "original"}],
        result={"messages": [{"role": "user", "content": "changed"}]},
    )

    assert prompt_turn._observable_turn_evidence(state) == (
        [], False, "execution_evidence_history_changed",
    )


def test_failed_turn_scoped_model_switch_restores_partial_commit(monkeypatch) -> None:
    restored: list[dict] = []
    errors: list[dict] = []
    snapshot = {"model": "saved-model", "provider": "saved-provider"}
    session = {
        "history_lock": threading.RLock(),
        "running": True,
        "agent": object(),
    }

    def fail_after_snapshot(*_args, **_kwargs):
        session["one_turn_model_restore"] = snapshot
        raise RuntimeError("reasoning configuration failed")
    noop = lambda *_args, **_kwargs: None
    run_after_ready = rebind(methods_prompt._run_after_agent_ready, {
        "_wait_agent_for_prompt": lambda *_args: None,
        "_session_profile_runtime_scope": lambda _session: contextlib.nullcontext(),
        "_apply_model_switch": fail_after_snapshot,
        "_restore_agent_model_runtime": (
            lambda _agent, value: restored.append(value)
        ),
        "_restart_slash_worker": noop,
        "_persist_live_session_runtime": noop,
        "_persist_live_session_system_prompt": noop,
        "_clear_inflight_turn": noop,
        "_emit_terminal_turn_error": (
            lambda *_args, **kwargs: errors.append(kwargs)
        ),
        "_run_prompt_submit": lambda *_args, **_kwargs: pytest.fail(
            "turn must not start after the model switch failed"
        ),
    })

    run_after_ready(
        "request-one",
        "session-one",
        session,
        "do the work",
        "user",
        None,
        model_once={
            "provider": "openrouter",
            "model": "configured/model",
            "reasoning_effort": "high",
        },
    )

    assert restored == [snapshot]
    assert "one_turn_model_restore" not in session
    assert session["running"] is False
    assert errors and errors[0]["error_surface"]["code"] == "model_once_failed"
