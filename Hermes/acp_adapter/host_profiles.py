"""Trusted ACP host configuration and native child execution attribution.

LIQUIDAITY VENDOR PATCH
=======================
This module is the contained implementation described in
``../LIQUIDAITY_VENDOR_PATCHES.md``.  It intentionally uses native Hermes
concepts (toolsets, tools, sessions, and native subagents) so the
extension remains suitable for an upstream contribution.

ACP 0.9 flattens request ``_meta`` members into handler keyword arguments.
Only the namespaced ``_meta.hermes.sessionConfig`` member is read here.  Model
tool arguments never enter this parser, and credentials are not part of the
accepted contract.
"""

from __future__ import annotations

import copy
import re
from contextlib import contextmanager
from contextvars import ContextVar
from typing import Any, Mapping


_MAX_LIST_ITEMS = 128
_MAX_NAME_CHARS = 256
_MAX_PROMPT_CHARS = 65_536
_META_KEY = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
_SESSION_FIELDS = {
    "enabledToolsets",
    "enabledTools",
    "executionContextId",
    "hostSessionKey",
    "systemPrompt",
    "toolCallMeta",
}


class HostSessionConfigError(ValueError):
    """Raised when trusted ACP host metadata is malformed or over-broad."""


_ACTIVE_TOOL_CALL_META: ContextVar[dict[str, str] | None] = ContextVar(
    "hermes_host_tool_call_meta", default=None
)


def _bounded_text(value: Any, field: str, *, limit: int, required: bool = False) -> str:
    if value is None:
        value = ""
    if not isinstance(value, str):
        raise HostSessionConfigError(f"hermes_host_config_{field}_must_be_string")
    text = value.strip()
    if required and not text:
        raise HostSessionConfigError(f"hermes_host_config_{field}_required")
    if len(text) > limit:
        raise HostSessionConfigError(f"hermes_host_config_{field}_too_long")
    return text


def _bounded_string_list(value: Any, field: str) -> list[str]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise HostSessionConfigError(f"hermes_host_config_{field}_must_be_list")
    if len(value) > _MAX_LIST_ITEMS:
        raise HostSessionConfigError(f"hermes_host_config_{field}_too_many")
    result: list[str] = []
    seen: set[str] = set()
    for item in value:
        text = _bounded_text(item, field, limit=_MAX_NAME_CHARS, required=True)
        if text not in seen:
            seen.add(text)
            result.append(text)
    return result


def parse_host_session_config(metadata_kwargs: Mapping[str, Any]) -> dict[str, Any] | None:
    """Parse ``_meta.hermes.sessionConfig`` flattened by ACP 0.9.

    The ACP SDK deliberately flattens each top-level ``_meta`` member into the
    handler's ``**kwargs``.  Requiring the ``hermes`` namespace prevents an
    ordinary request field from impersonating trusted host configuration.
    """

    hermes_meta = metadata_kwargs.get("hermes")
    if hermes_meta is None:
        return None
    if not isinstance(hermes_meta, dict):
        raise HostSessionConfigError("hermes_host_metadata_must_be_object")
    raw = hermes_meta.get("sessionConfig")
    if raw is None:
        return None
    if not isinstance(raw, dict):
        raise HostSessionConfigError("hermes_host_session_config_must_be_object")
    unknown = sorted(set(raw) - _SESSION_FIELDS)
    if unknown:
        raise HostSessionConfigError(f"hermes_host_session_config_unknown_field:{unknown[0]}")
    execution_context_id = _bounded_text(
        raw.get("executionContextId"), "executionContextId", limit=128
    )
    raw_tool_meta = raw.get("toolCallMeta") or {}
    if not isinstance(raw_tool_meta, dict):
        raise HostSessionConfigError("hermes_host_config_tool_call_meta_must_be_object")
    if len(raw_tool_meta) > 1:
        raise HostSessionConfigError("hermes_host_config_tool_call_meta_too_many")
    normalized_tool_meta: dict[str, str] = {}
    for raw_key, raw_value in raw_tool_meta.items():
        key = _bounded_text(raw_key, "toolCallMeta.key", limit=256, required=True)
        if not _META_KEY.fullmatch(key):
            raise HostSessionConfigError("hermes_host_config_tool_call_meta_key_invalid")
        value = _bounded_text(
            raw_value,
            f"toolCallMeta.{key}",
            limit=128,
            required=True,
        )
        normalized_tool_meta[key] = value
    if normalized_tool_meta and execution_context_id not in normalized_tool_meta.values():
        raise HostSessionConfigError("hermes_host_config_execution_context_mismatch")
    return {
        "enabledToolsets": _bounded_string_list(raw.get("enabledToolsets"), "enabledToolsets"),
        "enabledTools": _bounded_string_list(raw.get("enabledTools"), "enabledTools"),
        "executionContextId": execution_context_id,
        "hostSessionKey": _bounded_text(
            raw.get("hostSessionKey"), "hostSessionKey", limit=512
        ),
        "systemPrompt": _bounded_text(
            raw.get("systemPrompt"), "systemPrompt", limit=_MAX_PROMPT_CHARS
        ),
        "toolCallMeta": normalized_tool_meta,
    }


def attach_host_session_config(agent: Any, config: dict[str, Any] | None) -> None:
    """Attach validated host state without rebuilding the agent tool surface."""

    normalized = copy.deepcopy(config) if config is not None else None
    setattr(agent, "_host_session_config", normalized)
    setattr(agent, "_host_execution_context_id", (
        str(normalized.get("executionContextId") or "") if normalized else ""
    ))
    setattr(agent, "_host_tool_call_meta", (
        dict(normalized.get("toolCallMeta") or {}) if normalized else {}
    ))
    if normalized is not None:
        # Native Hermes appends this field to its effective system prompt at
        # model-call time. It keeps the host-selected role session-scoped and
        # non-persistent while Hermes retains prompt assembly ownership.
        setattr(agent, "ephemeral_system_prompt", normalized.get("systemPrompt") or None)


def attach_host_execution_requester(agent: Any, requester: Any, session_id: str) -> None:
    """Attach the generic ACP extension back-channel used by native children."""

    setattr(agent, "_host_execution_requester", requester)
    setattr(agent, "_host_execution_session_id", str(session_id or ""))


def allocate_host_child_execution(parent_agent: Any, child: Any) -> bool:
    """Allocate trusted host execution state before a native child may run."""

    requester = getattr(parent_agent, "_host_execution_requester", None)
    raw_parent_context_id = getattr(parent_agent, "_host_execution_context_id", "")
    raw_session_id = getattr(parent_agent, "_host_execution_session_id", "")
    parent_context_id = (
        raw_parent_context_id.strip() if isinstance(raw_parent_context_id, str) else ""
    )
    session_id = raw_session_id.strip() if isinstance(raw_session_id, str) else ""
    if not parent_context_id and not session_id:
        return False
    if not callable(requester) or not parent_context_id or not session_id:
        raise HostSessionConfigError("hermes_host_child_execution_context_unavailable")
    native_child_id = str(getattr(child, "_subagent_id", "") or "")
    if not native_child_id:
        raise HostSessionConfigError("hermes_host_native_child_id_missing")
    child_provider = str(getattr(child, "provider", "") or "").strip()
    child_model = str(getattr(child, "model", "") or "").strip()
    if bool(child_provider) != bool(child_model):
        raise HostSessionConfigError("hermes_host_child_model_configuration_incomplete")
    response = requester("session/create_execution_context", {
        "sessionId": session_id,
        "parentExecutionContextId": parent_context_id,
        "nativeChildId": native_child_id,
        **({"provider": child_provider, "model": child_model} if child_provider else {}),
    })
    if not isinstance(response, dict):
        raise HostSessionConfigError("hermes_host_child_execution_response_invalid")
    context_id = _bounded_text(
        response.get("executionContextId"), "childExecutionContextId", limit=128, required=True
    )
    tool_meta = response.get("toolCallMeta")
    if (
        not isinstance(tool_meta, dict)
        or len(tool_meta) != 1
        or context_id not in tool_meta.values()
        or not all(_META_KEY.fullmatch(str(key)) for key in tool_meta)
    ):
        raise HostSessionConfigError("hermes_host_child_execution_meta_invalid")
    setattr(child, "_host_execution_context_id", context_id)
    setattr(child, "_host_tool_call_meta", dict(tool_meta))
    attach_host_execution_requester(child, requester, session_id)
    return True


def finish_host_child_execution(
    child: Any,
    state: str,
    error_summary: str | None = None,
    usage: Mapping[str, Any] | None = None,
) -> None:
    requester = getattr(child, "_host_execution_requester", None)
    raw_context_id = getattr(child, "_host_execution_context_id", "")
    context_id = raw_context_id.strip() if isinstance(raw_context_id, str) else ""
    if not callable(requester) or not context_id:
        return
    safe_usage = {
        key: usage[key]
        for key in (
            "durationMs", "providerInputTokens", "providerOutputTokens", "totalCostUsd"
        )
        if isinstance(usage, Mapping) and usage.get(key) is not None
    }
    configuration = {
        "provider": str(getattr(child, "provider", "") or "").strip(),
        "model": str(getattr(child, "model", "") or "").strip(),
        "fallbackOccurred": bool(
            getattr(child, "_host_model_fallback_occurred", False)
        ),
        "fallbackReason": str(
            getattr(child, "_host_model_fallback_reason", "") or ""
        )[:2048],
    }
    requester("session/finish_execution_context", {
        "executionContextId": context_id,
        "state": state if state in {"completed", "failed", "cancelled"} else "failed",
        **({"errorSummary": str(error_summary)[:2048]} if error_summary else {}),
        **({"usage": safe_usage} if safe_usage else {}),
        "configuration": configuration,
    })


@contextmanager
def host_execution_scope(agent: Any):
    meta = getattr(agent, "_host_tool_call_meta", None)
    token = _ACTIVE_TOOL_CALL_META.set(dict(meta) if isinstance(meta, dict) else None)
    try:
        yield
    finally:
        _ACTIVE_TOOL_CALL_META.reset(token)


def current_host_tool_call_meta() -> dict[str, str] | None:
    meta = _ACTIVE_TOOL_CALL_META.get()
    return dict(meta) if meta else None


def initial_toolsets(config: dict[str, Any] | None) -> list[str]:
    """Return host-granted native toolsets safe before MCP registration."""

    if config is None:
        return ["hermes-acp"]
    return [
        name
        for name in config.get("enabledToolsets", [])
        if not str(name).startswith("mcp-")
    ]


def _merge_definitions(*groups: list[dict[str, Any]]) -> list[dict[str, Any]]:
    merged: list[dict[str, Any]] = []
    seen: set[str] = set()
    for group in groups:
        for definition in group:
            name = str((definition.get("function") or {}).get("name") or "")
            if name and name not in seen:
                seen.add(name)
                merged.append(definition)
    return merged


def _explicit_tool_definitions(names: list[str]) -> list[dict[str, Any]]:
    if not names:
        return []
    from tools.registry import registry

    definitions = registry.get_definitions(set(names), quiet=True)
    resolved = {
        str((definition.get("function") or {}).get("name") or "")
        for definition in definitions
    }
    missing = [name for name in names if name not in resolved]
    if missing:
        raise HostSessionConfigError(f"hermes_host_config_tool_unavailable:{missing[0]}")
    return definitions


def _blocked_exact_tools(disabled_toolsets: Any) -> set[str]:
    """Resolve Hermes' stored deny toolsets before adding exact host tools."""

    from toolsets import TOOLSETS

    blocked: set[str] = set()
    if not isinstance(disabled_toolsets, (list, tuple, set)):
        return blocked
    for name in disabled_toolsets:
        definition = TOOLSETS.get(str(name))
        if isinstance(definition, dict):
            blocked.update(str(tool) for tool in definition.get("tools") or [])
    return blocked


def apply_host_session_config(agent: Any, config: dict[str, Any] | None) -> None:
    """Publish one host-scoped tool/profile surface atomically on ``agent``."""

    attach_host_session_config(agent, config)
    if config is None:
        return

    from model_tools import get_tool_definitions

    toolsets = list(config.get("enabledToolsets") or [])
    explicit_names = list(config.get("enabledTools") or [])
    disabled_toolsets = getattr(agent, "disabled_toolsets", None)
    definitions = get_tool_definitions(
        enabled_toolsets=toolsets,
        disabled_toolsets=disabled_toolsets,
        quiet_mode=True,
    )
    blocked_explicit = [
        name for name in explicit_names if name in _blocked_exact_tools(disabled_toolsets)
    ]
    if blocked_explicit:
        raise HostSessionConfigError(
            f"hermes_host_config_tool_blocked:{blocked_explicit[0]}"
        )
    definitions = _merge_definitions(definitions, _explicit_tool_definitions(explicit_names))

    # Memory-provider tools are injected only when the trusted host selected
    # the native memory surface.  This prevents provider defaults from widening
    # a host-scoped profile whose selected toolsets intentionally omit memory.
    if "memory" in toolsets or "memory" in explicit_names:
        try:
            from agent.memory_manager import inject_memory_provider_tools

            agent.tools = list(definitions)
            agent.valid_tool_names = {
                str((item.get("function") or {}).get("name") or "")
                for item in definitions
            }
            inject_memory_provider_tools(agent)
            definitions = list(agent.tools or [])
        except Exception:
            pass

    valid_names = {
        str((item.get("function") or {}).get("name") or "")
        for item in definitions
        if str((item.get("function") or {}).get("name") or "")
    }
    agent.enabled_toolsets = toolsets
    agent.tools = definitions
    agent.valid_tool_names = valid_names
    invalidate = getattr(agent, "_invalidate_system_prompt", None)
    if callable(invalidate):
        invalidate()
