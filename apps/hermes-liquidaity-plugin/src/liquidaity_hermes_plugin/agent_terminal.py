"""Process-scoped exact tool selection for one saved Hermes Card terminal."""

from __future__ import annotations

from dataclasses import dataclass
import json
import os
from pathlib import Path
import re
import urllib.request
import urllib.error
from urllib.parse import urlsplit
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
    endpoint = os.environ.get("HERMES_AGENT_TERMINAL_URL", "")
    token = os.environ.get("HERMES_AGENT_TERMINAL_TOKEN", "")
    address = urlsplit(endpoint)
    if (address.scheme != "http" or address.hostname != "127.0.0.1"
            or not address.path.startswith("/api/agent-terminals/internal/")
            or not re.fullmatch(r"[a-f0-9]{64}", token)):
        raise ValueError("agent_terminal_execution_endpoint_invalid")

    def request(operation, payload):
        call = urllib.request.Request(endpoint + "/" + operation,
            data=json.dumps(payload).encode("utf-8"), method="POST",
            headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"})
        try:
            with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(call, timeout=55) as response:
                raw_response = response.read(8 * 1024 * 1024 + 1)
        except urllib.error.HTTPError as error:
            body = json.loads(error.read(8192).decode("utf-8"))
            raise RuntimeError(str(body.get("error") or "agent_terminal_execution_failed")) from error
        if len(raw_response) > 8 * 1024 * 1024:
            raise RuntimeError("agent_terminal_execution_response_too_large")
        return json.loads(raw_response)

    def prepare(*, message, session_id, model, provider):
        prepared = request("begin", {"message": message, "nativeSessionId": session_id,
                                     "model": model, "provider": provider})
        try:
            from tools.mcp_tool import register_mcp_servers, get_registered_mcp_server_names
            configs = {}
            for descriptor in prepared["mcpServers"]:
                name = descriptor["name"]
                pairs = lambda values: {entry["name"]: entry["value"] for entry in values}
                configs[name] = ({"url": descriptor["url"], "headers": pairs(descriptor.get("headers", []))}
                    if descriptor.get("url") else {"command": descriptor["command"],
                        "args": descriptor.get("args", []), "env": pairs(descriptor.get("env", []))})
            register_mcp_servers(configs, replace_changed=True)
            if set(configs) - set(get_registered_mcp_server_names()):
                raise RuntimeError("agent_terminal_saved_mcp_unavailable")
            prepared["requester"] = lambda method, params: request("host", {"method": method, "params": params})
            observation.clear()
            observation.update(session_id=session_id, usage={}, script={"invoked": False, "receipt": None, "fallback": None})
            return prepared
        except Exception as error:
            request("finish", {"executionContextId": prepared["executionContextId"], "error": str(error)})
            raise

    def finish(*, prepared, result, error):
        # The native result owns completion/failure. Do not synthesize output.
        reports = list(observation.get("usage", {}).values())
        complete = bool(reports) and all(report is not None for report in reports)
        usage = {target: sum(report[source] for report in reports) if complete else None
                 for target, source in (("providerInputTokens", "input_tokens"),
                     ("providerOutputTokens", "output_tokens"), ("providerCachedTokens", "cache_read_tokens"),
                     ("providerReasoningTokens", "reasoning_tokens"))}
        try:
            request("finish", {"executionContextId": prepared["executionContextId"],
                "result": {key: result[key] for key in ("final_response", "completed", "failed", "error")
                           if key in result} if isinstance(result, dict) else None,
                "usage": usage, "scriptExecution": observation.get("script"), "error": error})
        finally:
            observation.clear()

    # Native observers only report measured execution; they never authorize it.
    observation = {}
    def observe_api(*, api_request_id="", session_id="", usage=None, **_):
        if not session_id or session_id != observation.get("session_id"):
            return
        fields = ("input_tokens", "output_tokens", "cache_read_tokens", "reasoning_tokens")
        valid = api_request_id and isinstance(usage, dict) and all(
            type(usage.get(field)) is int and usage[field] >= 0 for field in fields)
        observation["usage"][api_request_id] = {field: usage[field] for field in fields} if valid else None

    def observe_script(*, session_id="", tool_name="", result=None, **_):
        if (session_id != observation.get("session_id") or tool_name != "execute_host_script"
                or not observation):
            return
        if isinstance(result, str):
            try:
                result = json.loads(result)
            except ValueError:
                result = None
        observation["script"] = {"invoked": True,
            **{field: result.get(field) if isinstance(result, dict) else None for field in ("receipt", "fallback")}}

    ctx.register_cli_turn_lifecycle(prepare, finish)
    ctx.register_hook("pre_api_request", observe_api)
    ctx.register_hook("post_api_request", observe_api)
    ctx.register_hook("pre_tool_call", observe_script)
    ctx.register_hook("post_tool_call", observe_script)
