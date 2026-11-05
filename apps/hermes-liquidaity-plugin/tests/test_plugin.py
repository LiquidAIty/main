# Entity: Hermes Plugin
# Relationship: Verifies plugin registration and helper contracts against a fake PluginContext without claiming loaded Hermes discovery or lifecycle execution.
# Entity: TaskGraphs
# Relationship: Verifies the plugin's declared taskgraph tool mapping and bounded admission helper behavior without substituting for a real Hermes ledger run.

from __future__ import annotations

import importlib.util
import hashlib
import json
from pathlib import Path
import sys
import time
from types import SimpleNamespace

import hermes_yaml as yaml


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "liquidaity_plugin",
    ROOT / "__init__.py",
    submodule_search_locations=[str(ROOT)],
)
assert SPEC and SPEC.loader
plugin = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = plugin
SPEC.loader.exec_module(plugin)
card_runtime = sys.modules["liquidaity_plugin.card_script_runtime"]


class Context:
    profile_name = "main"

    def __init__(self):
        self.hooks = {}
        self.tasks = []
        self.tools = []
        self.spawned = []
        self.dispatched = []
        self.config = {}
        self.llm = SimpleNamespace(complete_structured=self.complete_structured)

    def register_hook(self, name, callback):
        self.hooks[name] = callback

    def register_auxiliary_task(self, key, **kwargs):
        self.tasks.append((key, kwargs))

    def register_tool(self, **kwargs):
        self.tools.append(kwargs)

    def spawn_task(self, coro, *, name=None):
        self.spawned.append((coro, name))
        close = getattr(coro, "close", None)
        if callable(close):
            close()
        return SimpleNamespace()

    def get_config(self, key, default=None):
        return self.config.get(key, default)

    def call_mcp(self, server, tool, arguments, timeout):
        assert (server, tool, arguments, timeout) == ("liquidaity", "main.context", {}, 15)
        return {"ok": True, "result": {"ok": True, "context": {"projectId": "trading"}}}

    def dispatch_tool(self, name, arguments, **kwargs):
        self.dispatched.append((name, arguments, kwargs))
        return json.dumps({
            "ok": True,
            "task_id": "t_team_root",
            "status": "triage",
            "subscribed": False,
        })

    def complete_structured(self, **kwargs):
        assert kwargs["task"] == "thinkgraph"
        assert kwargs["json_schema"]["type"] == "object"
        return SimpleNamespace(
            parsed={"facts": []}, provider="openai-codex", model="gpt-5.6-luna",
        )


def card_script_config(*, tools=None, source=None):
    source = source or (
        'CARD_SCRIPT = {"mode":"tool_recipe"}\n'
        'from hermes_tools import input, output\n'
        'output.emit({"answer": input.value})'
    )
    tool_names = tools or {}
    return {
        "version": 1,
        "source": source,
        "source_hash": hashlib.sha256(source.encode("utf-8")).hexdigest(),
        "compiled_hash": "a" * 64,
        "mode": "tool_recipe",
        "input_schema": {
            "type": "object",
            "properties": {"value": {"type": "string"}},
            "required": ["value"],
        },
        "output_schema": {
            "type": "object",
            "properties": {"answer": {"type": "string"}},
            "required": ["answer"],
        },
        "tool_names": tool_names,
        "tool_states": {name: 1 for name in tool_names},
        "timeout_seconds": 30,
        "max_tool_calls": 1,
        "max_output_bytes": 1_000,
    }


def test_manifest_and_registration_use_only_official_hook_tool_and_auxiliary_surfaces():
    manifest = yaml.safe_load((ROOT / "plugin.yaml").read_text(encoding="utf-8"))
    assert manifest["name"] == "liquidaity"
    assert manifest["requires_plugins"] == ["holographic"]
    assert manifest["provides_hooks"] == ["pre_llm_call", "on_session_end"]
    assert manifest["provides_tools"] == ["card_python", "taskgraph_start"]
    context = Context()
    plugin.register(context)
    assert set(context.hooks) == {"pre_llm_call", "on_session_end"}
    assert context.tasks[0][0] == "thinkgraph"
    assert context.tools[0]["name"] == "card_python"
    assert context.tools[0]["check_fn"]() is False
    assert context.tools[1]["name"] == "taskgraph_start"
    assert context.tools[1]["check_fn"]() is False


def test_taskgraph_tool_is_categorized_and_admits_team_through_public_dispatch():
    context = Context()
    context.profile_name = "team"
    context.config["task_mode"] = "team"
    plugin.register(context)
    tool = next(item for item in context.tools if item["name"] == "taskgraph_start")

    assert tool["check_fn"]() is True
    assert tool["schema"]["description"].startswith("Category: coordination/taskgraph")
    result = json.loads(tool["handler"](
        {"mission": "Research one bounded claim."},
        session_id="team-bot-session",
        turn_id="turn-one",
        tool_call_id="call-one",
    ))
    repeated = json.loads(tool["handler"](
        {"mission": "Research one bounded claim."},
        session_id="team-bot-session",
        turn_id="turn-one",
        tool_call_id="call-one",
    ))

    assert result == {
        "ok": True,
        "status": "accepted",
        "mode": "team",
        "rootTaskId": "t_team_root",
        "subscribed": False,
        "message": "Hermes accepted the taskgraph root; do not poll or resubmit.",
    }
    assert repeated == result
    assert [call[0] for call in context.dispatched] == ["kanban_create", "kanban_create"]
    first_args = context.dispatched[0][1]
    second_args = context.dispatched[1][1]
    assert first_args["body"] == "Research one bounded claim."
    assert first_args["workspace_kind"] == "scratch"
    assert first_args["project"] == ""
    assert first_args["idempotency_key"].startswith("liquidaity-taskgraph:")
    assert second_args["idempotency_key"] == first_args["idempotency_key"]


def test_pre_llm_navigation_map_is_precomputed_in_memory_and_profile_bounded():
    runtime = plugin._navigation_runtime()
    runtime.clear_navigation_map("main")
    context = Context()
    plugin.register(context)
    assert context.hooks["pre_llm_call"](session_id="s", user_message="hello") is None
    status = runtime.publish_navigation_map({
        "schemaVersion": "liquidaity.navigation-map.v1",
        "projectId": "trading",
        "layers": ["thinkgraph", "knowgraph", "codegraph"],
        "revision": "think:know:code",
        "nodes": [
            ["Rocket Lab", "Entity", [["thinkgraph", "eng-1"], ["knowgraph", "neo-1"]]],
            ["client/main.ts", "File", [["codegraph", "client/main.ts"]]],
        ],
        "relationships": [["codegraph", "calls-1", 1, "CALLS", 0]],
        "focus": [0, [["think-1", "Launch cadence", "Cadence affects revenue."]],
                  [["know-1", "Launch record", "Electron launched.", "Cadence is demonstrated.", "https://example.test"]], [1]],
    }, "main")
    result = context.hooks["pre_llm_call"](session_id="s", user_message="hello")
    assert result and "Shared Entity/Relationship Navigation Map" in result["context"]
    assert status["focused"] is True and status["nodes"] == 2
    started = time.perf_counter_ns()
    for _ in range(100_000):
        assert runtime.navigation_context("main") is result["context"]
    average_ns = (time.perf_counter_ns() - started) / 100_000
    assert average_ns < 50_000
    context.profile_name = "trading"
    assert context.hooks["pre_llm_call"](session_id="s", user_message="hello") is None
    runtime.clear_navigation_map("main")


def test_dashboard_api_and_native_hook_share_the_same_process_cache():
    dashboard_manifest = json.loads(
        (ROOT / "dashboard" / "manifest.json").read_text(encoding="utf-8")
    )
    assert dashboard_manifest["api"] == "plugin_api.py"
    api_spec = importlib.util.spec_from_file_location(
        "liquidaity_dashboard_api", ROOT / "dashboard" / "plugin_api.py"
    )
    assert api_spec and api_spec.loader
    api = importlib.util.module_from_spec(api_spec)
    api_spec.loader.exec_module(api)
    assert api._runtime() is plugin._navigation_runtime()


def test_completed_turn_reads_main_context_calls_plugin_llm_and_settles_with_engraphis(monkeypatch):
    calls = []

    def post(_origin, path, payload, *, timeout):
        calls.append((path, payload, timeout))
        if path.endswith("/prepare"):
            return {
                "ok": True,
                "status": "ready",
                "pairReference": "pair-one",
                "instructions": "Extract Thinks.",
                "input": [{"type": "text", "text": "all chunks"}],
                "jsonSchema": {"type": "object"},
            }
        return {"ok": True, "status": "completed"}

    monkeypatch.setattr(plugin, "_post_json", post)
    plugin._process_completed_turn(
        Context(),
        "session-one",
        user_row_id=11,
        assistant_row_id=12,
    )
    assert calls[0] == (
        "/thinkgraph/completed-pair/prepare",
        {
            "projectId": "trading",
            "profile": "main",
            "sessionId": "session-one",
            "userRowId": 11,
            "assistantRowId": 12,
        },
        30,
    )
    assert calls[1][0] == "/thinkgraph/completed-pair/settle"
    assert calls[1][1]["structuredOutput"] == {"facts": []}


def test_non_main_incomplete_and_interrupted_turns_do_not_start_work(monkeypatch):
    context = Context()
    plugin.register(context)
    hook = context.hooks["on_session_end"]
    hook(session_id="s", completed=False, interrupted=False)
    hook(session_id="s", completed=True, interrupted=True)
    context.profile_name = "builder"
    hook(session_id="s", completed=True, interrupted=False)
    assert context.spawned == []


def test_completed_main_turn_uses_supervised_task_with_captured_profile_context(monkeypatch):
    context = Context()
    plugin.register(context)
    captured = []

    def to_thread(function, *args):
        captured.append((function, args))

        async def run():
            return None

        return run()

    monkeypatch.setattr(plugin.asyncio, "to_thread", to_thread)
    monkeypatch.setattr(plugin, "_completed_pair_row_ids", lambda _session: (21, 22))
    context.hooks["on_session_end"](
        session_id="session-main",
        completed=True,
        interrupted=False,
    )

    assert len(context.spawned) == 1
    assert context.spawned[0][1] == "liquidaity-thinkgraph:session-main"
    assert captured == [(
        plugin._run_completed_turn,
        (context, "session-main", "main", "http://127.0.0.1:8003", 21, 22),
    )]


def test_card_python_uses_profile_projected_recipe_and_official_plugin_tool(monkeypatch):
    context = Context()
    context.config["card_script"] = card_script_config()
    monkeypatch.setattr(plugin, "hermes_python_runtime_available", lambda: True)
    monkeypatch.setattr(
        card_runtime,
        "execute_card_script",
        lambda _ctx, _config, arguments, **_kwargs: {"answer": arguments["value"]},
    )
    plugin.register(context)
    tool = context.tools[0]
    assert tool["check_fn"]() is True
    assert tool["schema"]["parameters"] == context.config["card_script"]["input_schema"]
    assert tool["handler"]({"value": "worked"}, session_id="session-one") == '{"answer":"worked"}'


def test_card_python_runs_in_hermes_python_and_nests_through_plugin_mcp():
    context = Context()
    context.call_mcp = lambda server, tool, arguments, timeout: {
        "ok": True,
        "result": {"server": server, "tool": tool, "arguments": arguments, "timeout": timeout},
    }
    source = '''CARD_SCRIPT = {"mode": "tool_recipe"}
from hermes_tools import SCRIPT, input, output, tools
tools.trading.get_state = SCRIPT
state = tools.call("trading.get_state", symbol=input.value)
output.emit({"answer": state["arguments"]["symbol"]})
'''
    config = card_runtime.normalize_card_script(card_script_config(
        tools={"trading.get_state": "trading.get_state"}, source=source,
    ))
    assert config is not None
    assert card_runtime.execute_card_script(
        context,
        config,
        {"value": "worked"},
        session_id="session-one",
    ) == {"answer": "worked"}


def test_card_python_rejects_tampered_arbitrary_python():
    source = '''CARD_SCRIPT = {"mode": "tool_recipe"}
import os
from hermes_tools import output
output.emit({"answer": os.getcwd()})
'''
    try:
        card_runtime.normalize_card_script(card_script_config(source=source))
    except card_runtime.CardScriptError as error:
        assert str(error) == "card_script_source_grammar_invalid"
    else:
        raise AssertionError("arbitrary Python bypassed the plugin execution grammar")
