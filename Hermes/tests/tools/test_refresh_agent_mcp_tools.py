"""Tests for the shared MCP agent-tool refresh helper and discovery-wait bound.

``refresh_agent_mcp_tools`` is the single rebuild path used by the TUI
``reload.mcp`` RPC, the gateway reload, and the late-binding refresh thread —
so a slow MCP server that connects after the agent's one-time tool snapshot is
picked up everywhere identically.  These assert the *contracts* those callers
rely on (name-based diff, in-place mutation, agent-scoped filtering) rather than
freezing any particular tool list.
"""

import threading
import types
import copy
import hashlib

import pytest

from tools import mcp_tool


def _tool(name):
    return {"type": "function", "function": {"name": name, "description": "", "parameters": {}}}


def _agent(tool_names, *, enabled=None, disabled=None):
    a = types.SimpleNamespace()
    a.tools = [_tool(n) for n in tool_names]
    a.valid_tool_names = set(tool_names)
    a.enabled_toolsets = enabled
    a.disabled_toolsets = disabled
    return a


@pytest.fixture
def host_surface(monkeypatch):
    from tools.registry import registry
    from acp_adapter.host_profiles import parse_host_session_config
    monkeypatch.setattr(registry, "_tools", dict(registry._tools))
    def unused(*args, **kwargs):
        raise AssertionError("No tool execution in refresh tests")
    delegate = _tool("delegate_task")["function"]
    delegate["parameters"] = {"type": "object", "properties": {
        "role": {"type": "string", "enum": ["leaf", "profile"]}}}
    registry.register(name="delegate_task", toolset="delegation", schema=delegate,
                      handler=unused, override=True)
    for name in ("host_read", "host_write", "host_other", "execute_host_script"):
        registry.register(name=name, toolset="host-refresh-test", schema=_tool(name)["function"],
                          handler=unused, override=True)
    source = 'from hermes_tools import output\noutput.emit({})\n'
    config = parse_host_session_config({"hermes": {"sessionConfig": {
        "enabledToolsets": ["delegation"], "enabledTools": ["host_write"],
        "hostSessionKey": "main-profile", "systemPrompt": "Preserve this prompt",
        "delegationRoles": ["profile"], "profileTargets": [
            {"profile": "graph", "title": "Graph", "description": ""}],
        "hostScript": {"version": 1, "source": source,
            "sourceHash": hashlib.sha256(source.encode()).hexdigest(), "compiledHash": "b" * 64,
            "mode": "tool_recipe", "inputSchema": {"type": "object", "properties": {
                "query": {"type": "string"}}, "required": ["query"]},
            "outputSchema": {"type": "object"}, "toolAliases": {"read": "host_read"},
            "fallbackToolAliases": {"read": "host_read", "write": "host_write"},
            "toolStates": {"read": 1, "write": 2}, "timeoutSeconds": 5,
            "maxToolCalls": 1, "maxOutputBytes": 1024},
    }}})
    return config


def test_refresh_retains_exact_host_script_and_profile_targets(host_surface):
    from acp_adapter.host_profiles import apply_host_session_config
    agent = _agent([], enabled=[])
    apply_host_session_config(agent, host_surface)
    before = copy.deepcopy(agent.tools)
    assert agent.valid_tool_names == {"delegate_task", "host_write", "execute_host_script"}
    mcp_tool.refresh_agent_mcp_tools(agent)
    assert agent.tools == before
    assert agent.valid_tool_names == {"delegate_task", "host_write", "execute_host_script"}
    # A stale schema with the same tool name must also be repaired.
    agent.tools[-1]["function"]["parameters"] = {}
    mcp_tool.refresh_agent_mcp_tools(agent)
    assert agent.tools == before


def test_refresh_isolates_host_profiles_and_restores_terminal(host_surface):
    from acp_adapter.host_profiles import apply_cli_host_session_config, clear_cli_host_session_config
    other = _agent([], enabled=[])
    second = copy.deepcopy(host_surface)
    second.pop("hostScript")
    second.update(enabledTools=["host_other"], enabledToolsets=[], delegationRoles=[])
    apply_cli_host_session_config(other, second)
    main = _agent([], enabled=[])
    apply_cli_host_session_config(main, host_surface)
    mcp_tool.refresh_agent_mcp_tools(main)
    mcp_tool.refresh_agent_mcp_tools(other)
    assert other.valid_tool_names == {"host_other"}
    assert "host_other" not in main.valid_tool_names
    assert clear_cli_host_session_config(main)
    mcp_tool.refresh_agent_mcp_tools(main)
    assert main.tools == []


def test_refresh_preserves_exact_script_failure_fallback(host_surface):
    from acp_adapter.host_profiles import apply_host_session_config, host_execution_scope, activate_host_script_fallback
    agent = _agent([], enabled=[])
    apply_host_session_config(agent, host_surface)
    with host_execution_scope(agent):
        activate_host_script_fallback()
    expected = copy.deepcopy(agent.tools)
    mcp_tool.refresh_agent_mcp_tools(agent)
    assert {t["function"]["name"]: t for t in agent.tools} == {
        t["function"]["name"]: t for t in expected}
    assert agent.valid_tool_names == {"delegate_task", "host_read", "host_write"}


def test_refresh_adds_late_landing_tools(monkeypatch):
    """A server that registers after build → its tools land in the snapshot."""
    agent = _agent(["read_file", "terminal"])

    new_defs = [_tool(n) for n in ("read_file", "terminal", "mcp_granola_get_account_info")]
    monkeypatch.setattr(mcp_tool, "get_tool_definitions", lambda **kw: new_defs, raising=False)
    # get_tool_definitions is imported inside the helper from model_tools, so patch there too.
    import model_tools
    monkeypatch.setattr(model_tools, "get_tool_definitions", lambda **kw: new_defs)

    added = mcp_tool.refresh_agent_mcp_tools(agent)

    assert added == {"mcp_granola_get_account_info"}
    assert "mcp_granola_get_account_info" in agent.valid_tool_names
    assert len(agent.tools) == 3


def test_refresh_preserves_memory_provider_and_context_engine_tools(monkeypatch):
    """B1 regression: a rebuild must NOT drop post-build-injected tools.

    get_tool_definitions() returns only the registry-derived tools. agent_init
    appends memory-provider tools (mem0/honcho/…) and context-engine tools
    (lcm_*) directly onto agent.tools AFTER that. A naive
    `agent.tools = get_tool_definitions()` would silently delete them on every
    refresh. The helper must re-inject them.
    """
    # Agent already carries: a built-in, a memory-provider tool, a context tool.
    agent = _agent(["read_file", "memory_search", "lcm_grep"])

    # Provider exposes its schemas; context compressor exposes lcm_*.
    agent._memory_manager = types.SimpleNamespace(
        get_all_tool_schemas=lambda: [
            {"name": "memory_search", "description": "", "parameters": {}}
        ]
    )
    agent.context_compressor = types.SimpleNamespace(
        get_tool_schemas=lambda: [
            {"name": "lcm_grep", "description": "", "parameters": {}}
        ]
    )
    agent._context_engine_tool_names = {"lcm_grep"}

    import model_tools
    # The registry now ALSO has a newly-connected MCP tool, but does NOT contain
    # the memory/context tools (they're never in get_tool_definitions output).
    monkeypatch.setattr(
        model_tools, "get_tool_definitions",
        lambda **kw: [_tool("read_file"), _tool("mcp_new_server_tool")],
    )

    added = mcp_tool.refresh_agent_mcp_tools(agent)

    # The new MCP tool landed AND the injected families survived.
    assert "mcp_new_server_tool" in agent.valid_tool_names
    assert "memory_search" in agent.valid_tool_names   # not clobbered
    assert "lcm_grep" in agent.valid_tool_names         # not clobbered
    assert added == {"mcp_new_server_tool"}


def test_refresh_does_not_reinject_disabled_memory_provider_tools(monkeypatch):
    """A refresh removes stale provider tools when memory becomes disabled."""
    agent = _agent(
        ["read_file", "memory_search"],
        enabled=["all"],
        disabled=["memory"],
    )
    agent._memory_manager = types.SimpleNamespace(
        get_all_tool_schemas=lambda: [
            {"name": "memory_search", "description": "", "parameters": {}}
        ]
    )

    import model_tools
    monkeypatch.setattr(
        model_tools,
        "get_tool_definitions",
        lambda **kw: [_tool("read_file")],
    )

    mcp_tool.refresh_agent_mcp_tools(agent)

    assert "memory_search" not in agent.valid_tool_names
    assert all(t["function"]["name"] != "memory_search" for t in agent.tools)


def test_refresh_respects_context_engine_toolset_gate(monkeypatch):
    """#5544: context-engine tools must NOT be re-injected on a restricted
    toolset. A platform with enabled_toolsets that excludes context_engine
    must not get lcm_* leaked back in by a refresh."""
    agent = _agent(["read_file"], enabled=["coding"])  # context_engine NOT enabled
    agent.context_compressor = types.SimpleNamespace(
        get_tool_schemas=lambda: [{"name": "lcm_grep", "description": "", "parameters": {}}]
    )
    agent._context_engine_tool_names = set()

    import model_tools
    monkeypatch.setattr(
        model_tools, "get_tool_definitions",
        lambda **kw: [_tool("read_file"), _tool("mcp_new_tool")],
    )

    mcp_tool.refresh_agent_mcp_tools(agent)

    assert "mcp_new_tool" in agent.valid_tool_names  # MCP tool still lands
    assert "lcm_grep" not in agent.valid_tool_names   # gated out (#5544)


def test_refreshed_tool_is_callable_through_valid_tool_names_guard(monkeypatch):
    """The whole point: a late tool, once refreshed, passes the name guard the
    run loop uses to accept/reject tool calls (agent.valid_tool_names)."""
    agent = _agent(["read_file"])

    import model_tools
    monkeypatch.setattr(
        model_tools, "get_tool_definitions",
        lambda **kw: [_tool("read_file"), _tool("mcp_granola_list_meetings")],
    )

    # Before refresh the run loop would reject the call ("Tool does not exist").
    assert "mcp_granola_list_meetings" not in agent.valid_tool_names

    mcp_tool.refresh_agent_mcp_tools(agent)

    # After refresh the same guard accepts it AND it's in the tools= payload.
    assert "mcp_granola_list_meetings" in agent.valid_tool_names
    assert any(t["function"]["name"] == "mcp_granola_list_meetings" for t in agent.tools)


def test_refresh_is_thread_safe_under_concurrent_calls(monkeypatch):
    """Concurrent refreshes keep tools / valid_tool_names coherent.

    The registry alternates between two DIFFERENT tool sets every call, so the
    write path (publish) runs repeatedly rather than short-circuiting on the
    no-change early return — this actually exercises the lock. The invariant:
    a reader of ``valid_tool_names`` must always match ``agent.tools``, and the
    final published pair must be one of the two valid sets (never a mix).
    """
    agent = _agent(["a"])

    import itertools
    set_a = [_tool("a"), _tool("b")]
    set_b = [_tool("a"), _tool("c")]
    flip = itertools.cycle([set_a, set_b])
    flip_lock = threading.Lock()

    def _gtd(**kw):
        with flip_lock:
            return list(next(flip))

    import model_tools
    monkeypatch.setattr(model_tools, "get_tool_definitions", _gtd)

    errors = []

    def _worker():
        try:
            for _ in range(50):
                mcp_tool.refresh_agent_mcp_tools(agent)
                # Coherence invariant: the name set must match the tool list
                # at every observation, never a torn cross-attribute state.
                names = {t["function"]["name"] for t in agent.tools}
                assert agent.valid_tool_names == names
                assert names in ({"a", "b"}, {"a", "c"})
        except Exception as exc:  # pragma: no cover - failure path
            errors.append(exc)

    threads = [threading.Thread(target=_worker) for _ in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=10)

    assert not errors
    assert agent.valid_tool_names in ({"a", "b"}, {"a", "c"})


# ── discovery-wait bound (mcp_discovery_timeout config) ──────────────────────


def test_resolve_discovery_timeout_explicit_wins(monkeypatch):
    from hermes_cli import mcp_startup

    assert mcp_startup._resolve_discovery_timeout(2.5) == 2.5


def test_wait_returns_instantly_when_no_discovery_thread(monkeypatch):
    """The common case (no MCP / discovery done) pays ~0s regardless of bound."""
    import time
    from hermes_cli import mcp_startup

    monkeypatch.setattr(mcp_startup, "_mcp_discovery_thread", None)
    import hermes_cli.config as cfg
    monkeypatch.setattr(cfg, "load_config", lambda: {"mcp_discovery_timeout": 999.0})

    t0 = time.time()
    mcp_startup.wait_for_mcp_discovery()
    assert time.time() - t0 < 0.2  # never blocks on the bound when nothing's pending
