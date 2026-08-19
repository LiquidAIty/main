"""Trusted ACP host configuration for session and delegate tool surfaces.

LIQUIDAITY VENDOR PATCH
=======================
This module is the contained implementation described in
``../LIQUIDAITY_VENDOR_PATCHES.md``.  It intentionally uses native Hermes
concepts (toolsets, tools, models, prompts, and delegate profiles) so the
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


_PROFILE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
_MAX_PROFILES = 32
_MAX_LIST_ITEMS = 128
_MAX_NAME_CHARS = 256
_MAX_PROMPT_CHARS = 65_536
_SESSION_FIELDS = {
    "enabledToolsets",
    "enabledTools",
    "delegateProfiles",
    "executionContextId",
    "toolCallMeta",
}
_PROFILE_FIELDS = {
    "id",
    "title",
    "description",
    "systemPrompt",
    "model",
    "enabledToolsets",
    "enabledTools",
    "skills",
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


def _normalize_profile(value: Any, index: int) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise HostSessionConfigError("hermes_host_config_delegate_profile_must_be_object")
    unknown = sorted(set(value) - _PROFILE_FIELDS)
    if unknown:
        raise HostSessionConfigError(
            f"hermes_host_config_delegate_profile_unknown_field:{unknown[0]}"
        )
    profile_id = _bounded_text(
        value.get("id"), f"delegateProfiles[{index}].id", limit=128, required=True
    )
    if not _PROFILE_ID.fullmatch(profile_id):
        raise HostSessionConfigError("hermes_host_config_delegate_profile_id_invalid")
    return {
        "id": profile_id,
        "title": _bounded_text(
            value.get("title"), f"delegateProfiles[{index}].title", limit=_MAX_NAME_CHARS
        ),
        "description": _bounded_text(
            value.get("description"),
            f"delegateProfiles[{index}].description",
            limit=2_048,
        ),
        "systemPrompt": _bounded_text(
            value.get("systemPrompt"),
            f"delegateProfiles[{index}].systemPrompt",
            limit=_MAX_PROMPT_CHARS,
        ),
        "model": _bounded_text(
            value.get("model"), f"delegateProfiles[{index}].model", limit=_MAX_NAME_CHARS
        ),
        "enabledToolsets": _bounded_string_list(
            value.get("enabledToolsets"), f"delegateProfiles[{index}].enabledToolsets"
        ),
        "enabledTools": _bounded_string_list(
            value.get("enabledTools"), f"delegateProfiles[{index}].enabledTools"
        ),
        "skills": _bounded_string_list(
            value.get("skills"), f"delegateProfiles[{index}].skills"
        ),
    }


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
    profiles_raw = raw.get("delegateProfiles") or []
    if not isinstance(profiles_raw, list):
        raise HostSessionConfigError("hermes_host_config_delegate_profiles_must_be_list")
    if len(profiles_raw) > _MAX_PROFILES:
        raise HostSessionConfigError("hermes_host_config_delegate_profiles_too_many")
    profiles = [_normalize_profile(value, index) for index, value in enumerate(profiles_raw)]
    ids = [profile["id"] for profile in profiles]
    if len(ids) != len(set(ids)):
        raise HostSessionConfigError("hermes_host_config_delegate_profile_duplicate")
    execution_context_id = _bounded_text(
        raw.get("executionContextId"), "executionContextId", limit=128
    )
    raw_tool_meta = raw.get("toolCallMeta") or {}
    if not isinstance(raw_tool_meta, dict):
        raise HostSessionConfigError("hermes_host_config_tool_call_meta_must_be_object")
    if set(raw_tool_meta) - {"liquidaity/execution"}:
        raise HostSessionConfigError("hermes_host_config_tool_call_meta_unknown_field")
    execution_meta = _bounded_text(
        raw_tool_meta.get("liquidaity/execution"),
        "toolCallMeta.liquidaity/execution",
        limit=128,
    )
    if execution_meta and execution_meta != execution_context_id:
        raise HostSessionConfigError("hermes_host_config_execution_context_mismatch")
    return {
        "enabledToolsets": _bounded_string_list(raw.get("enabledToolsets"), "enabledToolsets"),
        "enabledTools": _bounded_string_list(raw.get("enabledTools"), "enabledTools"),
        "delegateProfiles": profiles,
        "executionContextId": execution_context_id,
        "toolCallMeta": (
            {"liquidaity/execution": execution_meta} if execution_meta else {}
        ),
    }


def attach_host_session_config(agent: Any, config: dict[str, Any] | None) -> None:
    """Attach validated host state without rebuilding the agent tool surface."""

    normalized = copy.deepcopy(config) if config is not None else None
    setattr(agent, "_host_session_config", normalized)
    profiles = normalized.get("delegateProfiles", []) if normalized else []
    setattr(agent, "_host_delegate_profiles", {profile["id"]: profile for profile in profiles})

    setattr(agent, "_host_execution_context_id", (
        str(normalized.get("executionContextId") or "") if normalized else ""
    ))
    setattr(agent, "_host_tool_call_meta", (
        dict(normalized.get("toolCallMeta") or {}) if normalized else {}
    ))


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
    delegate_profile_id = str(getattr(child, "_host_delegate_profile_id", "") or "")
    response = requester("session/create_execution_context", {
        "sessionId": session_id,
        "parentExecutionContextId": parent_context_id,
        "nativeChildId": native_child_id,
        **({"delegateProfileId": delegate_profile_id} if delegate_profile_id else {}),
    })
    if not isinstance(response, dict):
        raise HostSessionConfigError("hermes_host_child_execution_response_invalid")
    context_id = _bounded_text(
        response.get("executionContextId"), "childExecutionContextId", limit=128, required=True
    )
    tool_meta = response.get("toolCallMeta")
    if not isinstance(tool_meta, dict) or tool_meta.get("liquidaity/execution") != context_id:
        raise HostSessionConfigError("hermes_host_child_execution_meta_invalid")
    setattr(child, "_host_execution_context_id", context_id)
    setattr(child, "_host_tool_call_meta", {"liquidaity/execution": context_id})
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
    requester("session/finish_execution_context", {
        "executionContextId": context_id,
        "state": state if state in {"completed", "failed", "cancelled"} else "failed",
        **({"errorSummary": str(error_summary)[:2048]} if error_summary else {}),
        **({"usage": safe_usage} if safe_usage else {}),
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
    """Return non-MCP toolsets safe to resolve before ACP registers servers."""

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


def _profile_schema(definition: dict[str, Any], profiles: list[dict[str, Any]]) -> dict[str, Any]:
    if str((definition.get("function") or {}).get("name") or "") != "delegate_task":
        return definition
    decorated = copy.deepcopy(definition)
    function = decorated.setdefault("function", {})
    parameters = function.setdefault("parameters", {})
    properties = parameters.setdefault("properties", {})
    profile_ids = [profile["id"] for profile in profiles]
    labels = [
        f"{profile['id']} ({profile.get('title') or profile.get('description') or 'delegate'})"
        for profile in profiles
    ]
    profile_field = {
        "type": "string",
        "enum": profile_ids,
        "description": (
            "Trusted host-defined delegate profile. Required for spawn when profiles are listed: "
            + "; ".join(labels)
        ),
    }
    properties["profile"] = profile_field
    tasks = properties.get("tasks")
    if isinstance(tasks, dict):
        items = tasks.get("items")
        if isinstance(items, dict):
            task_properties = items.setdefault("properties", {})
            task_properties["profile"] = copy.deepcopy(profile_field)
            required = list(items.get("required") or [])
            if "profile" not in required:
                required.append("profile")
            items["required"] = required
    return decorated


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

    profiles = list(config.get("delegateProfiles") or [])
    definitions = [_profile_schema(item, profiles) for item in definitions]
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


def resolve_delegate_profile(agent: Any, profile_id: Any) -> tuple[dict[str, Any] | None, str | None]:
    """Resolve a model-selected id against the trusted host profile registry."""

    profiles = getattr(agent, "_host_delegate_profiles", None)
    if not isinstance(profiles, dict) or not profiles:
        if profile_id is None or not str(profile_id).strip():
            return None, None
        return None, "No trusted host delegate profiles are configured for this session."
    selected = str(profile_id or "").strip()
    if not selected:
        return None, "A trusted delegate profile is required for this session."
    profile = profiles.get(selected)
    if not isinstance(profile, dict):
        return None, f"Unknown delegate profile '{selected}'."
    return copy.deepcopy(profile), None


def profile_child_prompt(profile: dict[str, Any] | None, task_prompt: str) -> str:
    """Mechanically combine a host profile prompt/skill list with task context."""

    if not profile:
        return task_prompt
    sections: list[str] = []
    system_prompt = str(profile.get("systemPrompt") or "").strip()
    if system_prompt:
        sections.append(system_prompt)
    skills = [str(value).strip() for value in profile.get("skills") or [] if str(value).strip()]
    if skills:
        sections.append("Host-selected Hermes skills: " + ", ".join(skills))
    sections.append(task_prompt)
    return "\n\n".join(section for section in sections if section)


def profile_tool_config(profile: dict[str, Any] | None) -> dict[str, Any] | None:
    """Project a trusted delegate profile into the common tool-surface shape."""

    if not profile:
        return None
    return {
        "enabledToolsets": list(profile.get("enabledToolsets") or []),
        "enabledTools": list(profile.get("enabledTools") or []),
        "delegateProfiles": [],
    }
