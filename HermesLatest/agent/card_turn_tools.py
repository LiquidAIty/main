"""Per-turn presentation for profile-owned MCP tools and saved Card Scripts."""

from __future__ import annotations

import copy
import json
from dataclasses import dataclass
from typing import Any, Callable


@dataclass
class TurnToolScope:
    tools: list[dict[str, Any]]
    valid_tool_names: set[str]


def normalize_turn_mcp_tool_selection(value: Any) -> dict[str, list[str]] | None:
    """Validate an exact per-turn subset of tools already loaded from MCP profiles."""

    if value is None:
        return None
    if not isinstance(value, dict) or len(value) > 32:
        raise ValueError("turn_mcp_tool_selection_invalid")
    normalized: dict[str, list[str]] = {}
    for raw_server, raw_tools in value.items():
        server = str(raw_server or "")
        if not server or server != server.strip() or len(server) > 128:
            raise ValueError("turn_mcp_tool_selection_invalid")
        if not isinstance(raw_tools, list) or len(raw_tools) > 256:
            raise ValueError("turn_mcp_tool_selection_invalid")
        tools = [str(tool or "") for tool in raw_tools]
        if any(not tool or tool != tool.strip() or len(tool) > 256 for tool in tools):
            raise ValueError("turn_mcp_tool_selection_invalid")
        if len(tools) != len(set(tools)):
            raise ValueError("turn_mcp_tool_selection_invalid")
        normalized[server] = tools
    return normalized


def _definition_name(definition: Any) -> str:
    if not isinstance(definition, dict):
        return ""
    function = definition.get("function")
    return str(function.get("name") or "") if isinstance(function, dict) else ""


def _standard_definition(value: dict[str, Any]) -> dict[str, Any]:
    schema = value.get("inputSchema", value.get("input_schema"))
    if not isinstance(schema, dict):
        raise ValueError("card_script_input_schema_invalid")
    return {
        "type": "function",
        "function": {
            "name": value["name"],
            "description": value["description"],
            "parameters": copy.deepcopy(schema),
        },
    }


def install_turn_mcp_tool_selection(
    agent: Any,
    selection: dict[str, list[str]] | None,
) -> TurnToolScope | None:
    """Narrow selected MCP servers for one turn without changing profile configuration."""

    normalized = normalize_turn_mcp_tool_selection(selection)
    if normalized is None:
        return None
    from tools import mcp_tool
    from tools.mcp_tool_schema import mcp_prefixed_tool_name

    prior = TurnToolScope(
        tools=list(getattr(agent, "tools", None) or []),
        valid_tool_names=set(getattr(agent, "valid_tool_names", None) or set()),
    )
    with mcp_tool._lock:
        server_by_tool = dict(mcp_tool._mcp_tool_server_names)
    selected_registry_names = {
        mcp_prefixed_tool_name(server, tool)
        for server, tools in normalized.items()
        for tool in tools
    }
    missing = sorted(selected_registry_names - prior.valid_tool_names)
    if missing:
        raise ValueError(f"turn_mcp_tool_unavailable:{missing[0]}")
    selected_servers = set(normalized)
    retained_names = {
        name for name in prior.valid_tool_names
        if server_by_tool.get(name) not in selected_servers
        or name in selected_registry_names
    }
    agent.tools = [
        definition for definition in prior.tools
        if _definition_name(definition) in retained_names
    ]
    agent.valid_tool_names = retained_names
    return prior


def clear_turn_mcp_tool_selection(agent: Any, prior: TurnToolScope | None) -> None:
    if prior is not None:
        agent.tools = prior.tools
        agent.valid_tool_names = prior.valid_tool_names


def install_turn_card_script(
    agent: Any,
    value: dict[str, Any] | None,
) -> TurnToolScope | None:
    """Expose one saved Script while keeping nested calls on profile-owned MCP tools."""

    from agent.card_script_tool import (
        CARD_SCRIPT_TOOL_NAME,
        card_script_tool_definition,
        normalize_card_script,
    )
    from tools import mcp_tool
    from tools.mcp_tool_schema import mcp_prefixed_tool_name

    script = normalize_card_script(value)
    if script is None:
        return None
    prior = TurnToolScope(
        tools=list(getattr(agent, "tools", None) or []),
        valid_tool_names=set(getattr(agent, "valid_tool_names", None) or set()),
    )
    if CARD_SCRIPT_TOOL_NAME in prior.valid_tool_names:
        raise ValueError("card_script_tool_name_collision")
    resolved_names = {
        canonical: mcp_prefixed_tool_name("liquidaity", tool_name)
        for canonical, tool_name in script["tool_names"].items()
    }
    with mcp_tool._lock:
        server_by_tool = dict(mcp_tool._mcp_tool_server_names)
    unavailable = sorted(
        name for name in resolved_names.values()
        if name not in prior.valid_tool_names or server_by_tool.get(name) != "liquidaity"
    )
    if unavailable:
        raise ValueError(f"card_script_profile_tool_unavailable:{unavailable[0]}")
    fallback_names = set(resolved_names.values())
    fallback_tools = [
        definition for definition in prior.tools
        if _definition_name(definition) in fallback_names
    ]
    if {_definition_name(definition) for definition in fallback_tools} != fallback_names:
        raise ValueError("card_script_profile_tool_definition_missing")
    script = {**script, "tool_names": resolved_names}
    agent._card_script = script
    agent._card_script_nested_tool_calls = 0
    agent._card_script_fallback_tools = fallback_tools
    agent._card_script_fallback_names = fallback_names
    agent.tools = [*prior.tools, _standard_definition(card_script_tool_definition(script))]
    agent.valid_tool_names = prior.valid_tool_names | {CARD_SCRIPT_TOOL_NAME}
    return prior


def clear_turn_card_script(agent: Any, prior: TurnToolScope | None) -> None:
    if prior is not None:
        agent.tools = prior.tools
        agent.valid_tool_names = prior.valid_tool_names
    agent._card_script = None
    agent._card_script_nested_tool_calls = 0
    agent._card_script_fallback_tools = []
    agent._card_script_fallback_names = set()


def _ordinary_result(result: dict[str, Any]) -> str:
    items = result.get("contentItems") if isinstance(result, dict) else None
    if isinstance(items, list) and len(items) == 1 and isinstance(items[0], dict):
        if items[0].get("type") == "inputText":
            return str(items[0].get("text") or "")
    return json.dumps(result, ensure_ascii=False, separators=(",", ":"))


class _CurrentInterrupt:
    def is_set(self) -> bool:
        try:
            from tools.interrupt import is_interrupted

            return bool(is_interrupted())
        except Exception:
            return False


def inline_card_script_executor(agent: Any, function_name: str) -> Callable | None:
    from agent.card_script_tool import CARD_SCRIPT_TOOL_NAME, execute_card_script_tool

    if function_name != CARD_SCRIPT_TOOL_NAME or getattr(agent, "_card_script", None) is None:
        return None

    def run_script(_agent: Any, arguments: dict[str, Any], context: Any) -> str:
        return _ordinary_result(execute_card_script_tool(
            agent,
            arguments,
            str(getattr(context, "tool_call_id", "") or ""),
            _CurrentInterrupt(),
        ))

    return run_script


__all__ = [
    "TurnToolScope",
    "clear_turn_card_script",
    "clear_turn_mcp_tool_selection",
    "inline_card_script_executor",
    "install_turn_card_script",
    "install_turn_mcp_tool_selection",
    "normalize_turn_mcp_tool_selection",
]
