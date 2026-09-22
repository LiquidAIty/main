from __future__ import annotations

import hashlib
import hmac
import importlib.util
import json
from pathlib import Path

import pytest


PLUGIN_DIR = Path(__file__).resolve().parents[1]


def _load_plugin():
    path = PLUGIN_DIR / "__init__.py"
    spec = importlib.util.spec_from_file_location("card_tools_plugin", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def plugin():
    return _load_plugin()


@pytest.fixture(autouse=True)
def _clear_environment(monkeypatch):
    for name in (
        "CARD_TOOLS_MANAGED",
        "CARD_TOOLS_HOST_URL",
        "HERMES_DASHBOARD_SESSION_TOKEN",
    ):
        monkeypatch.delenv(name, raising=False)


class RegistrationContext:
    def __init__(self):
        self.tools = []
        self.hooks = []
        self.prompt_sections = []

    def register_tool(self, **kwargs):
        self.tools.append(kwargs)

    def register_hook(self, name, callback):
        self.hooks.append((name, callback))

    def register_system_prompt_section(self, name, content, **kwargs):
        self.prompt_sections.append((name, content, kwargs))


def _configure_roster(plugin, monkeypatch, entries):
    profile_home = Path("profiles") / "orchestrator"
    roster = []
    titles = {}
    for stable_profile, title in entries:
        target_home = Path("profiles") / stable_profile
        roster.append((stable_profile, target_home))
        titles[target_home] = title
    monkeypatch.setattr(plugin, "_process_profile_home", lambda: profile_home)
    monkeypatch.setattr(
        plugin,
        "_resolve_bot_roster",
        lambda actual_home: roster if actual_home == profile_home else [],
    )
    monkeypatch.setattr(
        plugin,
        "_read_profile_meta",
        lambda target_home: {"bot_title": titles[target_home]},
    )
    return profile_home, titles


def test_registers_exact_materialized_tools(plugin, monkeypatch):
    tools = [{
        "canonicalName": "card.create",
        "hermesName": "card__card_create",
        "description": "Create a saved Card.",
        "inputSchema": {"type": "object", "properties": {"title": {"type": "string"}}},
    }]
    monkeypatch.setattr(plugin, "_load_tools", lambda: tools)
    _configure_roster(plugin, monkeypatch, [("builder_profile", "Builder")])
    context = RegistrationContext()

    plugin.register(context)

    assert len(context.tools) == 1
    assert {key: value for key, value in context.tools[0].items() if key != "handler"} == {
        "name": "card__card_create",
        "toolset": "card-tools",
        "schema": {
            "name": "card__card_create",
            "description": "Create a saved Card.",
            "parameters": tools[0]["inputSchema"],
        },
        "description": "Create a saved Card.",
    }
    assert [name for name, _callback in context.hooks] == ["pre_tool_call"]
    assert context.hooks[0][1](
        tool_name="message_agent",
        args={"target": "@builder", "message": "Inspect this."},
    ) == {"action": "modify", "args": {"target": "builder_profile"}}
    assert len(context.prompt_sections) == 1
    section_name, render, options = context.prompt_sections[0]
    assert section_name == "card-tools.visible-card-targets"
    assert options == {"max_chars": 4_000}
    assert render({}) == (
        "Use `message_agent` with one of these exact visible saved-Card addresses:\n"
        "- `@Builder`"
    )


def test_visible_titles_translate_case_insensitively_with_optional_at(plugin, monkeypatch):
    profile_home, _titles = _configure_roster(
        plugin,
        monkeypatch,
        [("profile_builder_7", "Builder"), ("profile_signal_9", "Signal")],
    )

    for target in ("Builder", "builder", "@BUILDER", "  @Builder  "):
        assert plugin._rewrite_message_agent_target(
            profile_home,
            tool_name="message_agent",
            args={"target": target, "message": "Inspect this."},
        ) == {"action": "modify", "args": {"target": "profile_builder_7"}}


def test_visible_title_hook_is_bounded_to_message_agent_and_exact_roster(plugin, monkeypatch):
    profile_home, _titles = _configure_roster(
        plugin,
        monkeypatch,
        [("profile_builder_7", "Builder")],
    )

    assert plugin._rewrite_message_agent_target(
        profile_home,
        tool_name="card__card_create",
        args={"target": "Builder"},
    ) is None
    for target in (
        "profile_builder_7",
        "Unknown",
        "@Unknown",
        "peer/agent",
        "Builder@another-machine",
        "@@Builder",
    ):
        assert plugin._rewrite_message_agent_target(
            profile_home,
            tool_name="message_agent",
            args={"target": target, "message": "Hello"},
        ) is None


@pytest.mark.parametrize("bad_title", [
    "",
    "World Signals",
    "Signal!",
    "@Signal",
    "Sígnal",
    "a" * 65,
])
def test_malformed_visible_title_fails_closed_for_the_whole_projection(
    plugin,
    monkeypatch,
    bad_title,
):
    profile_home, _titles = _configure_roster(
        plugin,
        monkeypatch,
        [("valid_profile", "Valid"), ("invalid_profile", bad_title)],
    )

    assert plugin._visible_card_targets(profile_home) == []
    assert plugin._visible_card_targets_prompt(profile_home) == ""
    assert plugin._rewrite_message_agent_target(
        profile_home,
        tool_name="message_agent",
        args={"target": "@Valid", "message": "Hello"},
    ) is None


def test_duplicate_visible_titles_fail_closed_case_insensitively(plugin, monkeypatch):
    profile_home, _titles = _configure_roster(
        plugin,
        monkeypatch,
        [("profile_one", "Signal"), ("profile_two", "sIgNaL")],
    )

    assert plugin._visible_card_targets(profile_home) == []
    assert plugin._rewrite_message_agent_target(
        profile_home,
        tool_name="message_agent",
        args={"target": "Signal", "message": "Hello"},
    ) is None


def test_prompt_lists_only_exact_visible_titles_and_no_internal_ids(plugin, monkeypatch):
    profile_home, _titles = _configure_roster(
        plugin,
        monkeypatch,
        [("profile_builder_7", "Builder"), ("profile_world_9", "WorldSignals")],
    )

    prompt = plugin._visible_card_targets_prompt(profile_home)

    assert "@Builder" in prompt
    assert "@WorldSignals" in prompt
    assert "profile_builder_7" not in prompt
    assert "profile_world_9" not in prompt


def test_title_changes_are_read_live_by_prompt_and_translation(plugin, monkeypatch):
    profile_home, titles = _configure_roster(
        plugin,
        monkeypatch,
        [("stable_profile", "Signal")],
    )
    target_home = Path("profiles") / "stable_profile"

    assert "@Signal" in plugin._visible_card_targets_prompt(profile_home)
    titles[target_home] = "WorldSignals"

    prompt = plugin._visible_card_targets_prompt(profile_home)
    assert "@WorldSignals" in prompt
    assert "@Signal`" not in prompt
    assert plugin._rewrite_message_agent_target(
        profile_home,
        tool_name="message_agent",
        args={"target": "Signal", "message": "Hello"},
    ) is None
    assert plugin._rewrite_message_agent_target(
        profile_home,
        tool_name="message_agent",
        args={"target": "@worldsignals", "message": "Hello"},
    ) == {"action": "modify", "args": {"target": "stable_profile"}}


def test_empty_or_unreadable_roster_has_no_aliases_or_prompt(plugin, monkeypatch):
    profile_home, _titles = _configure_roster(plugin, monkeypatch, [])

    assert plugin._visible_card_targets(profile_home) == []
    assert plugin._visible_card_targets_prompt(profile_home) == ""
    monkeypatch.setattr(
        plugin,
        "_resolve_bot_roster",
        lambda _profile_home: (_ for _ in ()).throw(RuntimeError("unavailable")),
    )
    assert plugin._visible_card_targets(profile_home) == []
    assert plugin._rewrite_message_agent_target(
        profile_home,
        tool_name="message_agent",
        args={"target": "Builder", "message": "Hello"},
    ) is None


def test_handler_posts_one_signed_request_and_returns_native_output(plugin, monkeypatch):
    monkeypatch.setenv("CARD_TOOLS_MANAGED", "1")
    monkeypatch.setenv("CARD_TOOLS_HOST_URL", "http://127.0.0.1:4000/api/hermes-card-tools")
    monkeypatch.setenv("HERMES_DASHBOARD_SESSION_TOKEN", "gateway-secret")
    monkeypatch.setattr(plugin.secrets, "token_hex", lambda _size: "a" * 32)
    monkeypatch.setattr(plugin.time, "time", lambda: 1_000)
    calls = []

    def post_once(url, envelope):
        calls.append((url, envelope))
        return 200, {"ok": True, "output": '{"ok":true,"cardId":"new"}'}

    monkeypatch.setattr(plugin, "_post_once", post_once)
    result = plugin._handler("card__card_create")(
        {"title": "New Card"},
        task_id="stored-main",
    )
    assert result == '{"ok":true,"cardId":"new"}'
    assert len(calls) == 1
    url, envelope = calls[0]
    assert url == "http://127.0.0.1:4000/api/hermes-card-tools"
    payload = json.loads(envelope["payload"])
    assert payload == {
        "version": 1,
        "expiresAt": 1_300,
        "nonce": "a" * 32,
        "sourceStoredSessionId": "stored-main",
        "tool": "card__card_create",
        "arguments": {"title": "New Card"},
    }
    assert envelope["keyId"] == hashlib.sha256(b"gateway-secret").hexdigest()
    assert envelope["signature"] == hmac.new(
        b"gateway-secret", envelope["payload"].encode("utf-8"), hashlib.sha256,
    ).hexdigest()


def test_handler_fails_closed_without_managed_runtime(plugin):
    result = json.loads(plugin._handler("card__card_create")({}, task_id="stored-main"))
    assert result == {"ok": False, "error": "managed_card_runtime_required"}


def test_configuration_rejects_duplicate_names(plugin, tmp_path):
    config = tmp_path / "tools.json"
    tool = {
        "canonicalName": "card.create",
        "hermesName": "card__card_create",
        "description": "Create",
        "inputSchema": {"type": "object"},
    }
    config.write_text(json.dumps({"tools": [tool, tool]}), encoding="utf-8")
    with pytest.raises(ValueError, match="configuration_invalid"):
        plugin._load_tools(config)


def test_non_loopback_transport_is_rejected(plugin):
    with pytest.raises(ValueError, match="loopback"):
        plugin._post_once(
            "https://example.com/tool",
            {"keyId": "a", "payload": "{}", "signature": "b"},
        )
