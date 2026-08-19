"""Focused no-provider proof for the contained ACP host-profile extension."""

from __future__ import annotations

import copy
import sys
from types import SimpleNamespace

import pytest

from acp_adapter.host_profiles import (
    HostSessionConfigError,
    apply_host_session_config,
    parse_host_session_config,
    profile_child_prompt,
    profile_tool_config,
    resolve_delegate_profile,
)


def _definition(name: str) -> dict:
    return {
        "type": "function",
        "function": {
            "name": name,
            "description": name,
            "parameters": {"type": "object", "properties": {}},
        },
    }


def _metadata() -> dict:
    return {
        "hermes": {
            "sessionConfig": {
                "enabledToolsets": ["memory", "mcp-main"],
                "enabledTools": ["delegate_task"],
                "delegateProfiles": [{
                    "id": "card_coder",
                    "title": "Coder",
                    "systemPrompt": "Use the saved Coder boundary.",
                    "model": "gpt-5.6-terra",
                    "enabledToolsets": ["terminal", "mcp-coder"],
                    "enabledTools": ["terminal"],
                    "skills": ["repository-coder"],
                }],
            }
        }
    }


def test_parser_accepts_only_namespaced_bounded_noncredential_configuration() -> None:
    assert parse_host_session_config({}) is None
    parsed = parse_host_session_config(_metadata())
    assert parsed is not None
    assert parsed["delegateProfiles"][0]["id"] == "card_coder"
    assert parsed["delegateProfiles"][0]["enabledTools"] == ["terminal"]

    forged = _metadata()
    forged["hermes"]["sessionConfig"]["delegateProfiles"][0]["apiKey"] = "secret"
    with pytest.raises(
        HostSessionConfigError,
        match="hermes_host_config_delegate_profile_unknown_field:apiKey",
    ):
        parse_host_session_config(forged)


def test_host_surface_is_exact_and_delegate_profile_is_model_selectable_only_by_id(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    definitions = {
        "memory": _definition("memory"),
        "mcp-main-tool": _definition("mcp-main-tool"),
        "delegate_task": _definition("delegate_task"),
    }
    definitions["delegate_task"]["function"]["parameters"]["properties"]["tasks"] = {
        "type": "array",
        "items": {
            "type": "object",
            "properties": {"goal": {"type": "string"}},
            "required": ["goal"],
        },
    }

    def get_tool_definitions(*, enabled_toolsets, disabled_toolsets, quiet_mode):
        assert isinstance(disabled_toolsets, list)
        assert quiet_mode is True
        selected = []
        if "memory" in enabled_toolsets:
            selected.append(copy.deepcopy(definitions["memory"]))
        if "mcp-main" in enabled_toolsets:
            selected.append(copy.deepcopy(definitions["mcp-main-tool"]))
        return selected

    registry = SimpleNamespace(
        get_definitions=lambda names, quiet=True: [
            copy.deepcopy(definitions[name]) for name in names if name in definitions
        ]
    )
    monkeypatch.setitem(
        sys.modules,
        "model_tools",
        SimpleNamespace(get_tool_definitions=get_tool_definitions),
    )
    monkeypatch.setitem(sys.modules, "tools.registry", SimpleNamespace(registry=registry))
    # Avoid provider-memory injection in this registry-only unit proof.
    monkeypatch.setitem(
        sys.modules,
        "agent.memory_manager",
        SimpleNamespace(inject_memory_provider_tools=lambda _agent: None),
    )

    agent = SimpleNamespace(disabled_toolsets=[], invalidations=0)
    agent._invalidate_system_prompt = lambda: setattr(
        agent, "invalidations", agent.invalidations + 1
    )
    config = parse_host_session_config(_metadata())
    apply_host_session_config(agent, config)

    assert agent.valid_tool_names == {"memory", "mcp-main-tool", "delegate_task"}
    delegate = next(
        item for item in agent.tools if item["function"]["name"] == "delegate_task"
    )
    properties = delegate["function"]["parameters"]["properties"]
    assert properties["profile"]["enum"] == ["card_coder"]
    assert properties["tasks"]["items"]["required"] == ["goal", "profile"]
    assert agent.invalidations == 1

    profile, error = resolve_delegate_profile(agent, "card_coder")
    assert error is None
    assert profile is not None
    assert profile["model"] == "gpt-5.6-terra"
    assert profile_tool_config(profile) == {
        "enabledToolsets": ["terminal", "mcp-coder"],
        "enabledTools": ["terminal"],
        "delegateProfiles": [],
    }
    assert profile_child_prompt(profile, "Task context").startswith(
        "Use the saved Coder boundary."
    )

    unknown, error = resolve_delegate_profile(agent, "forged")
    assert unknown is None
    assert error == "Unknown delegate profile 'forged'."

    blocked = SimpleNamespace(disabled_toolsets=["memory"])
    with pytest.raises(
        HostSessionConfigError,
        match="hermes_host_config_tool_blocked:memory",
    ):
        apply_host_session_config(blocked, {
            "enabledToolsets": [],
            "enabledTools": ["memory"],
            "delegateProfiles": [],
        })


def test_profile_is_required_only_when_the_trusted_host_published_profiles() -> None:
    plain = SimpleNamespace()
    assert resolve_delegate_profile(plain, None) == (None, None)
    assert resolve_delegate_profile(plain, "card_coder") == (
        None,
        "No trusted host delegate profiles are configured for this session.",
    )

    configured = SimpleNamespace(
        _host_delegate_profiles={"card_coder": {"id": "card_coder"}}
    )
    assert resolve_delegate_profile(configured, None) == (
        None,
        "A trusted delegate profile is required for this session.",
    )
