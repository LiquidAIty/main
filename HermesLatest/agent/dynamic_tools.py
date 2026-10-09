"""Per-turn Dynamic Tool presentation shared by Hermes provider transports.

Definitions are supplied by the current prompt submission.  Standard Hermes
providers receive ordinary function schemas and dispatch through the signed MCP
callback; Codex App Server receives the same definitions through its Dynamic
Tools protocol.  Neither path registers global tools or retains turn authority.
"""

from __future__ import annotations

import copy
import json
from dataclasses import dataclass
from typing import Any, Callable


@dataclass
class DynamicToolScope:
    tools: list[dict[str, Any]]
    valid_tool_names: set[str]


def dynamic_tools_configuration(agent: Any) -> tuple[list[dict], dict[str, str]]:
    definitions = getattr(agent, "_dynamic_tools", None)
    if not isinstance(definitions, list):
        return [], {}
    projected: list[dict] = []
    canonical_names: dict[str, str] = {}
    for value in definitions:
        if not isinstance(value, dict):
            raise ValueError("dynamic_tool_definition_invalid")
        name = str(value.get("name") or "")
        canonical_name = str(value.get("canonical_name") or "")
        schema = value.get("input_schema")
        if (
            value.get("type") != "function"
            or not name
            or not canonical_name
            or not isinstance(schema, dict)
            or name in canonical_names
        ):
            raise ValueError("dynamic_tool_definition_invalid")
        canonical_names[name] = canonical_name
        projected.append({
            "type": "function",
            "name": name,
            "canonicalName": canonical_name,
            "description": str(value.get("description") or ""),
            "inputSchema": copy.deepcopy(schema),
        })
    return projected, canonical_names


def _standard_definition(value: dict[str, Any]) -> dict[str, Any]:
    return {
        "type": "function",
        "function": {
            "name": value["name"],
            "description": value["description"],
            "parameters": copy.deepcopy(value["inputSchema"]),
        },
    }


def install_turn_dynamic_tools(
    agent: Any,
    definitions: list[dict] | None,
    *,
    endpoint: str | None,
    authorization: str | None,
    card_script: dict[str, Any] | None,
) -> DynamicToolScope:
    """Install one turn's exact schemas and return the state needed to restore them."""

    from agent.card_script_tool import card_script_tool_definition, normalize_card_script

    script = normalize_card_script(card_script)
    effective = [copy.deepcopy(item) for item in list(definitions or [])]
    if script is not None:
        effective.append(card_script_tool_definition(script))
    prior = DynamicToolScope(
        tools=list(getattr(agent, "tools", None) or []),
        valid_tool_names=set(getattr(agent, "valid_tool_names", None) or set()),
    )
    agent._dynamic_tools = effective
    agent._dynamic_tool_endpoint = endpoint if effective else None
    agent._dynamic_tool_authorization = authorization if effective else None
    agent._card_script = script
    projected, canonical_names = dynamic_tools_configuration(agent)
    duplicates = prior.valid_tool_names & set(canonical_names)
    if duplicates:
        raise ValueError(f"dynamic_tool_name_collision:{sorted(duplicates)[0]}")
    agent.tools = [*prior.tools, *(_standard_definition(item) for item in projected)]
    agent.valid_tool_names = prior.valid_tool_names | set(canonical_names)
    return prior


def clear_turn_dynamic_tools(agent: Any, prior: DynamicToolScope | None) -> None:
    if prior is not None:
        agent.tools = prior.tools
        agent.valid_tool_names = prior.valid_tool_names
    agent._dynamic_tools = []
    agent._dynamic_tool_endpoint = None
    agent._dynamic_tool_authorization = None
    agent._card_script = None


def dynamic_tool_executor(agent: Any, canonical_names: dict[str, str]):
    """One executor for transport callbacks and the ordinary agent loop."""

    if not canonical_names:
        return None
    from agent.card_script_tool import (
        CARD_SCRIPT_CANONICAL_NAME,
        execute_card_script_tool,
    )

    local_names = {
        name for name, canonical in canonical_names.items()
        if canonical == CARD_SCRIPT_CANONICAL_NAME
    }
    remote_names = {
        name: canonical for name, canonical in canonical_names.items()
        if canonical != CARD_SCRIPT_CANONICAL_NAME
    }
    remote = None
    if remote_names:
        authorization = str(getattr(agent, "_dynamic_tool_authorization", "") or "")
        endpoint = str(getattr(agent, "_dynamic_tool_endpoint", "") or "")
        if authorization and endpoint:
            from agent.transports.dynamic_tools_mcp import build_dynamic_tool_executor

            remote = build_dynamic_tool_executor(
                endpoint=endpoint,
                authorization=authorization,
                canonical_names=remote_names,
            )

    def execute(name: str, arguments: dict[str, Any], call_id: str, interrupt_event) -> dict[str, Any]:
        if name in local_names:
            return execute_card_script_tool(agent, arguments, call_id, interrupt_event)
        if name not in remote_names:
            raise ValueError("dynamic_tool_not_selected")
        if remote is None:
            return {
                "success": False,
                "contentItems": [{
                    "type": "inputText",
                    "text": json.dumps({"error": "dynamic_tool_authorization_unavailable"}),
                }],
            }
        return remote(name, arguments, call_id, interrupt_event)

    return execute


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


def inline_dynamic_tool_executor(agent: Any, function_name: str) -> Callable | None:
    _projected, canonical_names = dynamic_tools_configuration(agent)
    if function_name not in canonical_names:
        return None
    executor = dynamic_tool_executor(agent, canonical_names)
    if executor is None:
        return None

    def run(_agent: Any, arguments: dict[str, Any], context: Any) -> str:
        return _ordinary_result(executor(
            function_name,
            arguments,
            str(getattr(context, "tool_call_id", "") or ""),
            _CurrentInterrupt(),
        ))

    return run


__all__ = [
    "DynamicToolScope",
    "clear_turn_dynamic_tools",
    "dynamic_tool_executor",
    "dynamic_tools_configuration",
    "inline_dynamic_tool_executor",
    "install_turn_dynamic_tools",
]
