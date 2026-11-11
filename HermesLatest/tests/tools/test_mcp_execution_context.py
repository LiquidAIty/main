"""Opt-in MCP provenance uses actual caller context, never model arguments or ambient IDs."""
import asyncio
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from tools import mcp_tool_handlers as handlers
from tools.approval_context import (
    get_current_observability_context,
    reset_current_observability_context,
    set_current_observability_context,
)


@pytest.mark.parametrize("opt_in", [True, False, None])
def test_execution_reference_crosses_thread_only_for_opted_in_connection(monkeypatch, opt_in):
    session = SimpleNamespace(call_tool=AsyncMock(return_value=SimpleNamespace(
        content=[SimpleNamespace(type="text", text="saved")], isError=False,
        structuredContent=None,
    )))
    server = SimpleNamespace(session=session, _config={"include_execution_context": opt_in},
                             _rpc_lock=asyncio.Lock(), _pending_call_context=None)
    monkeypatch.setattr(handlers, "_trust_gate_check", lambda *args: None)
    monkeypatch.setattr(handlers, "_check_circuit_breaker", lambda *args: None)
    monkeypatch.setattr(handlers, "_acquire_call_server", lambda *args: (server, None))
    monkeypatch.setattr(handlers, "_tool_is_read_only", lambda *args: False)
    monkeypatch.setattr("hermes_cli.profiles.get_active_profile_name", lambda: "quant-analyst")
    # Deliberately do not propagate ContextVars into the transport thread.
    with ThreadPoolExecutor(max_workers=1) as pool:
        def dispatch(_name, _server, _op, call, *_args, **_kwargs):
            def execute():
                assert not any(get_current_observability_context().values())
                return asyncio.run(call())
            return pool.submit(execute).result(timeout=10)
        monkeypatch.setattr(handlers, "_dispatch", dispatch)
        token = set_current_observability_context(
            session_id="session-real", turn_id="turn-real", tool_call_id="call-real")
        try:
            result = handlers._make_tool_handler("first-party", "save", 10)({"value": 3})
        finally:
            reset_current_observability_context(token)
    assert "saved" in result
    kwargs = session.call_tool.call_args.kwargs
    assert kwargs["arguments"] == {"value": 3}
    if opt_in is True:
        assert kwargs["meta"] == {"hermes.execution": {
            "profile": "quant-analyst", "sessionId": "session-real",
            "turnId": "turn-real", "toolCallId": "call-real",
        }}
    else:
        assert "meta" not in kwargs
    assert not any(get_current_observability_context().values())


def test_context_reader_never_substitutes_environment_ids(monkeypatch):
    monkeypatch.setenv("HERMES_SESSION_ID", "unrelated-session")
    token = set_current_observability_context(turn_id="turn-only")
    try:
        assert get_current_observability_context() == {
            "session_id": "", "turn_id": "turn-only", "tool_call_id": "",
        }
    finally:
        reset_current_observability_context(token)
