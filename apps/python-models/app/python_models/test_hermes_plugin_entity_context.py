"""Contract proof for the plugin's retained hooks and removed context injection."""

# Entity: Hermes Plugin
# Relationship: Verifies automatic map injection is absent for all four Cards while Main's post-turn ThinkGraph hook stays intact.

from __future__ import annotations

import importlib.util
from pathlib import Path
import sys
from typing import Any


def _load_plugin() -> Any:
    plugin_root = Path(__file__).resolve().parents[4] / "apps" / "hermes-liquidaity-plugin"
    name = "_liquidaity_plugin_entity_context_test"
    spec = importlib.util.spec_from_file_location(
        name,
        plugin_root / "__init__.py",
        submodule_search_locations=[str(plugin_root)],
    )
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def test_graph_map_injection_is_absent_for_all_four_profiles():
    import yaml
    plugin = _load_plugin()

    class Context:
        def __init__(self, profile):
            self.profile_name = profile
            self.hooks = {}
            self.tools = []

        def get_config(self, name, default):
            return "project-one" if name == "project_id" else default

        def register_tool(self, **_kwargs):
            self.tools.append(_kwargs["name"])

        def register_hook(self, name, callback):
            self.hooks[name] = callback

    for profile in ("main", "builder", "thinkgraph", "knowgraph"):
        context = Context(profile)
        plugin.register(context)
        assert set(context.hooks) == {"post_llm_call"}
        assert set(context.tools) == {"card_python", "taskgraph_start"}
    manifest = yaml.safe_load(Path(plugin.__file__).with_name("plugin.yaml").read_text(encoding="utf-8"))
    assert manifest["provides_hooks"] == ["post_llm_call"]


def test_post_llm_hook_schedules_only_its_supplied_pair_without_database_reads(monkeypatch):
    import asyncio
    from types import SimpleNamespace
    plugin = _load_plugin()
    monkeypatch.setitem(sys.modules, "agent.message_content",
                        SimpleNamespace(flatten_message_text=lambda value: value))
    hooks = {}
    scheduled = []
    calls = []

    class Context:
        profile_name = "main"

        def get_config(self, name, default):
            return "project-one" if name == "project_id" else default

        def register_tool(self, **_kwargs):
            pass

        def register_hook(self, name, callback):
            hooks[name] = callback

        def spawn_task(self, coro, *, name=None):
            scheduled.append((name, coro))

    context = Context()
    plugin.register(context)
    assert set(hooks) == {"post_llm_call"}
    assert not hasattr(plugin, "_completed_pair_row_ids")
    monkeypatch.setattr(plugin, "_post_json",
                        lambda origin, path, payload, **kwargs: calls.append((path, payload)) or {"ok": True})
    hooks["post_llm_call"](session_id="session-one", turn_id="turn-one",
        user_message="  Forecast versus backtest?\n", assistant_response="Exact final answer.",
        conversation_history=[{"role": "user", "content": "Never select this unrelated question."}])
    assert len(scheduled) == 1
    assert calls == []  # The callback does not wait for extraction or transport.
    assert scheduled[0][0] == "liquidaity-thinkgraph:turn-one"
    asyncio.run(scheduled[0][1])
    path, payload = calls[0]
    assert path == "/thinkgraph/completed-pair/process"
    assert payload["userMessage"] == "  Forecast versus backtest?\n"
    assert payload["assistantResponse"] == "Exact final answer."
    assert payload["turnId"] == "turn-one"
    assert payload["sessionId"] == "session-one"
    assert payload["projectId"] == "project-one"
    assert "userRowIds" not in payload and "assistantRowId" not in payload
    hooks["post_llm_call"](session_id="session-one", turn_id="turn-two",
                          user_message="Question", assistant_response="")
    context.profile_name = "thinkgraph"
    hooks["post_llm_call"](session_id="child", turn_id="child-turn",
                          user_message="Question", assistant_response="Answer")
    assert len(scheduled) == 1


def test_automatic_thinkgraph_requires_saved_wire(monkeypatch):
    from app.python_models import saved_cards, thinkgraph_automatic

    deck = {"nodes": [
        {"id": "main", "kind": "agent", "runtimeOptions": {"orchestrator": True},
         "runtime": {"kind": "hermes", "mode": "main", "profile": "main"}},
        {"id": "card_thinkgraph", "kind": "agent", "_cardRevisionId": "saved-revision",
         "runtimeOptions": {}, "runtime": {"kind": "hermes", "mode": "delegate", "profile": "thinkgraph"}},
    ], "edges": []}
    monkeypatch.setattr(saved_cards, "load_deck", lambda *_args: {"deck": deck})
    saved = [
        {"role": "user", "target": {"cardId": "main", "profile": "main"}},
        {"role": "assistant", "speaker": {"cardId": "main", "profile": "main"}},
    ]
    import pytest
    with pytest.raises(thinkgraph_automatic.AutomaticThinkGraphError, match="saved_thinkgraph_connection_unavailable"):
        thinkgraph_automatic._saved_authority("project-one", saved)
    deck["edges"] = [{"source": "card_thinkgraph", "target": "main", "edgeType": "flow"}]
    assert thinkgraph_automatic._saved_authority("project-one", saved)["thinkGraphRevisionId"] == "saved-revision"
    deck["edges"][0]["enabled"] = False
    with pytest.raises(thinkgraph_automatic.AutomaticThinkGraphError, match="saved_thinkgraph_connection_unavailable"):
        thinkgraph_automatic._saved_authority("project-one", saved)


def test_completed_turn_calls_saved_thinkgraph_path_without_auxiliary_model(monkeypatch):
    plugin = _load_plugin()
    calls = []

    class Context:
        profile_name = "main"

        @staticmethod
        def get_config(name, default):
            return "project-one" if name == "project_id" else default

        @property
        def llm(self):
            raise AssertionError("The hook must not replace the saved ThinkGraph Card")

    def post(origin, path, payload, *, timeout):
        calls.append((path, payload))
        return {"ok": True, "status": "completed"}

    monkeypatch.setattr(plugin, "_post_json", post)
    plugin._run_completed_turn(Context(), {
        "projectId": "project-one", "profile": "main", "sessionId": "session-one",
        "turnId": "turn-one", "userMessage": "Question", "assistantResponse": "Answer",
    })
    assert calls == [("/thinkgraph/completed-pair/process", {
        "projectId": "project-one", "profile": "main", "sessionId": "session-one",
        "turnId": "turn-one", "userMessage": "Question", "assistantResponse": "Answer",
    })]
