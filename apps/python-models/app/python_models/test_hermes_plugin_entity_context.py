"""Contract proof for provider-owned Entity context in the Hermes plugin."""

# Entity: Hermes Plugin
# Relationship: Verifies Main, Builder, ThinkGraph, and KnowGraph read the current Project Entity map from Python rails instead of a UI-published cache.

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


def test_plugin_reads_project_entity_map_from_python_rails(monkeypatch) -> None:
    plugin = _load_plugin()
    calls: list[tuple[str, str, dict[str, Any], float]] = []

    class Context:
        profile_name = "main"

        @staticmethod
        def get_config(name: str, default: str) -> str:
            return "project-one" if name == "project_id" else default

        @staticmethod
        def call_mcp(*_args, **_kwargs):
            raise AssertionError("Project scope must not borrow a GPT connector tool")

    def post(origin: str, path: str, payload: dict[str, Any], *, timeout: float):
        calls.append((origin, path, payload, timeout))
        return {
            "ok": True,
            "projectId": "project-one",
            "context": "### Current Project Entity Map\n{}",
        }

    monkeypatch.setattr(plugin, "_post_json", post)

    assert plugin._PROJECT_ENTITY_MAP_PROFILES == frozenset({
        "main", "builder", "thinkgraph", "knowgraph",
    })
    assert plugin._project_entity_map_context(Context()).startswith(
        "### Current Project Entity Map"
    )
    assert calls == [(
        "http://127.0.0.1:8003",
        "/project/entity-map/read",
        {"projectId": "project-one"},
        30,
    )]


def test_plugin_schedules_thinkgraph_only_after_successful_persisted_turn(
    monkeypatch,
) -> None:
    plugin = _load_plugin()
    hooks: dict[str, Any] = {}
    scheduled: list[tuple[str | None, Any]] = []

    class Context:
        profile_name = "main"

        @staticmethod
        def get_config(name: str, default: Any) -> Any:
            return default

        @staticmethod
        def register_tool(**_kwargs: Any) -> None:
            return None

        @staticmethod
        def register_hook(name: str, callback: Any) -> None:
            hooks[name] = callback

        @staticmethod
        def spawn_task(coro: Any, *, name: str | None = None) -> None:
            scheduled.append((name, coro))

    monkeypatch.setattr(plugin, "_completed_pair_row_ids", lambda _session: (41, 42))
    context = Context()
    plugin.register(context)

    assert set(hooks) == {"pre_llm_call", "on_session_end"}
    for outcome in ({}, {"completed": False}, {"completed": True, "failed": True},
                    {"completed": True, "interrupted": True}):
        hooks["on_session_end"](session_id="main-session", **outcome)
    assert scheduled == []
    hooks["on_session_end"](
        session_id="main-session",
        completed=True,
    )

    assert scheduled[0][0] == "liquidaity-thinkgraph:main-session"
    scheduled[0][1].close()


def test_automatic_thinkgraph_requires_saved_wire(monkeypatch):
    from app.python_models import saved_cards, thinkgraph_automatic

    deck = {"nodes": [
        {"id": "main", "runtime": {"kind": "hermes", "mode": "main", "profile": "main"}},
        {"id": "card_thinkgraph", "_cardRevisionId": "saved-revision",
         "runtime": {"kind": "hermes", "profile": "thinkgraph"}},
    ], "edges": []}
    monkeypatch.setattr(saved_cards, "load_deck", lambda *_args: {"deck": deck})
    saved = [
        {"role": "user", "target": {"cardId": "main", "profile": "main"}},
        {"role": "assistant", "speaker": {"cardId": "main", "profile": "main"}},
    ]
    import pytest
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
    plugin._process_completed_turn(
        Context(), "session-one", user_row_id=41, assistant_row_id=42,
    )
    assert calls == [("/thinkgraph/completed-pair/process", {
        "projectId": "project-one", "profile": "main", "sessionId": "session-one",
        "userRowId": 41, "assistantRowId": 42,
    })]
