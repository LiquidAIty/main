"""Process-scoped exact tool selection for one saved Hermes Card terminal."""

from __future__ import annotations

from dataclasses import dataclass
import json
import os
from pathlib import Path
import re
from typing import Mapping


_CONFIG_ENV = "HERMES_AGENT_TERMINAL_CONFIG"
_TOOLSET_NAME = "agent-terminal"
_MCP_TOOL_NAME = re.compile(r"mcp__[A-Za-z0-9_]+__[A-Za-z0-9_]+$")
_FORBIDDEN_PROFILES = {"main", "liquidaity-main", "builder", "default"}
_FORBIDDEN_CARD_IDS = {"card_main_chat", "builder"}
_MAX_ITEMS = 256


@dataclass(frozen=True)
class AgentTerminalConfig:
    card_id: str
    profile: str
    profile_home: str
    toolsets: tuple[str, ...]
    native_tools: tuple[str, ...]
    mcp_tools: tuple[str, ...]


def _path_key(value: str) -> str:
    return os.path.normcase(str(Path(value).expanduser().resolve(strict=False)))


def _required_text(value: object, field: str) -> str:
    if not isinstance(value, str) or not (text := value.strip()) or len(text) > 512:
        raise ValueError(f"agent_terminal_config_{field}_invalid")
    return text


def _string_list(value: object, field: str) -> tuple[str, ...]:
    if not isinstance(value, list) or len(value) > _MAX_ITEMS:
        raise ValueError(f"agent_terminal_config_{field}_invalid")
    result = tuple(_required_text(item, field) for item in value)
    if len(set(result)) != len(result):
        raise ValueError(f"agent_terminal_config_{field}_duplicate")
    return result


def validate_agent_terminal_config(
    raw: str | Mapping[str, object],
    *,
    active_profile: str | None = None,
    active_profile_home: str | None = None,
) -> AgentTerminalConfig:
    """Validate the serializable process selector used by the terminal launcher."""

    if isinstance(raw, str):
        try:
            decoded = json.loads(raw)
        except (TypeError, json.JSONDecodeError) as error:
            raise ValueError("agent_terminal_config_invalid") from error
    else:
        decoded = raw
    if not isinstance(decoded, Mapping) or set(decoded) != {
        "cardId", "profile", "profileHome", "toolsets", "nativeTools", "mcpTools",
    }:
        raise ValueError("agent_terminal_config_invalid")

    config = AgentTerminalConfig(
        card_id=_required_text(decoded["cardId"], "card_id"),
        profile=_required_text(decoded["profile"], "profile"),
        profile_home=_required_text(decoded["profileHome"], "profile_home"),
        toolsets=_string_list(decoded["toolsets"], "toolsets"),
        native_tools=_string_list(decoded["nativeTools"], "native_tools"),
        mcp_tools=_string_list(decoded["mcpTools"], "mcp_tools"),
    )
    if config.card_id in _FORBIDDEN_CARD_IDS:
        raise ValueError("agent_terminal_card_forbidden")
    if config.profile.casefold() in _FORBIDDEN_PROFILES:
        raise ValueError("agent_terminal_profile_forbidden")
    if set(config.native_tools) & set(config.mcp_tools):
        raise ValueError("agent_terminal_config_tool_duplicate")
    if any(not _MCP_TOOL_NAME.fullmatch(name) for name in config.mcp_tools):
        raise ValueError("agent_terminal_config_mcp_tools_invalid")
    if any(name in {"all", "*"} for name in config.toolsets):
        raise ValueError("agent_terminal_config_toolsets_invalid")
    if active_profile is not None and config.profile != active_profile:
        raise ValueError("agent_terminal_profile_mismatch")
    if active_profile_home is not None and _path_key(config.profile_home) != _path_key(active_profile_home):
        raise ValueError("agent_terminal_profile_home_mismatch")
    return config


def register_agent_terminal(ctx) -> None:
    """Register the exact saved Card selection only when this process opts in."""

    raw = os.environ.get(_CONFIG_ENV)
    if raw is None:
        return
    active_home = os.environ.get("HERMES_HOME", "").strip()
    if not active_home:
        raise ValueError("agent_terminal_profile_home_missing")
    config = validate_agent_terminal_config(
        raw,
        active_profile=ctx.profile_name,
        active_profile_home=active_home,
    )

    from tools.registry import registry
    from toolsets import create_custom_toolset, validate_toolset

    missing_native = sorted(set(config.native_tools) - set(registry.get_all_tool_names()))
    if missing_native:
        raise ValueError(f"agent_terminal_native_tool_not_registered:{missing_native[0]}")
    unknown_toolsets = sorted(name for name in config.toolsets if not validate_toolset(name))
    if unknown_toolsets:
        raise ValueError(f"agent_terminal_toolset_not_registered:{unknown_toolsets[0]}")

    create_custom_toolset(
        _TOOLSET_NAME,
        "Process-scoped exact saved Card tool selection.",
        tools=[*config.native_tools, *config.mcp_tools],
        includes=list(config.toolsets),
    )
