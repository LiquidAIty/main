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
import hashlib
import json
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
    "hostScript",
    "delegationRoles",
    "team",
}


class HostSessionConfigError(ValueError):
    """Raised when trusted ACP host metadata is malformed or over-broad."""


_ACTIVE_TOOL_CALL_META: ContextVar[dict[str, str] | None] = ContextVar(
    "hermes_host_tool_call_meta", default=None
)
_ACTIVE_HOST_SCRIPT: ContextVar[dict[str, Any] | None] = ContextVar(
    "hermes_host_script", default=None
)
_ACTIVE_HOST_AGENT: ContextVar[Any | None] = ContextVar(
    "hermes_host_agent", default=None
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


def _host_script(value: Any) -> dict[str, Any] | None:
    if value is None:
        return None
    if not isinstance(value, dict):
        raise HostSessionConfigError("hermes_host_config_host_script_must_be_object")
    allowed = {
        "version", "source", "sourceHash", "compiledHash", "mode", "inputSchema",
        "outputSchema", "toolAliases", "timeoutSeconds", "maxToolCalls",
        "maxOutputBytes", "fallbackToolAliases", "toolStates",
    }
    unknown = sorted(set(value) - allowed)
    if unknown:
        raise HostSessionConfigError(
            f"hermes_host_config_host_script_unknown_field:{unknown[0]}"
        )
    version = value.get("version")
    if not isinstance(version, int) or isinstance(version, bool) or version < 1:
        raise HostSessionConfigError(
            "hermes_host_config_host_script_version_invalid"
        )
    source = value.get("source")
    if not isinstance(source, str):
        raise HostSessionConfigError(
            "hermes_host_config_hostScript.source_must_be_string"
        )
    if not source.strip():
        raise HostSessionConfigError("hermes_host_config_hostScript.source_required")
    if len(source) > 32_768:
        raise HostSessionConfigError("hermes_host_config_hostScript.source_too_long")
    source_hash = _bounded_text(
        value.get("sourceHash"), "hostScript.sourceHash", limit=64, required=True
    )
    if not re.fullmatch(r"[0-9a-f]{64}", source_hash) or not secrets_compare_hash(
        source_hash, hashlib.sha256(source.encode("utf-8")).hexdigest()
    ):
        raise HostSessionConfigError("hermes_host_config_host_script_hash_mismatch")
    compiled_hash = _bounded_text(
        value.get("compiledHash"), "hostScript.compiledHash", limit=64, required=True
    )
    if not re.fullmatch(r"[0-9a-f]{64}", compiled_hash):
        raise HostSessionConfigError("hermes_host_config_host_script_compiled_hash_invalid")
    mode = _bounded_text(value.get("mode"), "hostScript.mode", limit=32, required=True)
    if mode != "tool_recipe":
        raise HostSessionConfigError("hermes_host_config_host_script_mode_invalid")
    input_schema = value.get("inputSchema")
    output_schema = value.get("outputSchema")
    if not all(
        isinstance(schema, dict) and schema.get("type") == "object"
        for schema in (input_schema, output_schema)
    ):
        raise HostSessionConfigError("hermes_host_config_host_script_schema_invalid")
    if len(json.dumps([input_schema, output_schema], separators=(",", ":"))) > 32_768:
        raise HostSessionConfigError("hermes_host_config_host_script_schema_too_large")
    def normalize_aliases(raw: Any, field: str) -> dict[str, str]:
        if not isinstance(raw, dict) or len(raw) > _MAX_LIST_ITEMS:
            raise HostSessionConfigError(
                f"hermes_host_config_host_script_{field}_invalid"
            )
        normalized: dict[str, str] = {}
        for raw_alias, raw_native in raw.items():
            alias = _bounded_text(raw_alias, "hostScript.alias", limit=256, required=True)
            native = _bounded_text(raw_native, "hostScript.nativeTool", limit=256, required=True)
            if not re.fullmatch(r"[A-Za-z0-9_.-]+", alias) or not re.fullmatch(
                r"[A-Za-z0-9_.-]+", native
            ):
                raise HostSessionConfigError("hermes_host_config_host_script_alias_invalid")
            normalized[alias] = native
        return normalized

    normalized_aliases = normalize_aliases(value.get("toolAliases"), "aliases")
    fallback_aliases = normalize_aliases(
        value.get("fallbackToolAliases"), "fallback_aliases"
    )
    raw_states = value.get("toolStates")
    if not isinstance(raw_states, dict) or len(raw_states) > _MAX_LIST_ITEMS:
        raise HostSessionConfigError("hermes_host_config_host_script_tool_states_invalid")
    tool_states: dict[str, int] = {}
    for raw_name, raw_mode in raw_states.items():
        name = _bounded_text(raw_name, "hostScript.toolState", limit=256, required=True)
        if (
            not re.fullmatch(r"[A-Za-z0-9_.-]+", name)
            or not isinstance(raw_mode, int)
            or isinstance(raw_mode, bool)
            or raw_mode not in {0, 1, 2, 3}
        ):
            raise HostSessionConfigError("hermes_host_config_host_script_tool_state_invalid")
        tool_states[name] = raw_mode
    if set(fallback_aliases) != set(tool_states):
        raise HostSessionConfigError("hermes_host_config_host_script_tool_state_scope_invalid")
    expected_script_aliases = {
        name for name, mode_value in tool_states.items() if mode_value in {1, 3}
    }
    if set(normalized_aliases) != expected_script_aliases or any(
        fallback_aliases[name] != native for name, native in normalized_aliases.items()
    ):
        raise HostSessionConfigError("hermes_host_config_host_script_alias_scope_invalid")
    timeout = value.get("timeoutSeconds", 15)
    max_calls = value.get("maxToolCalls", 6)
    max_output = value.get("maxOutputBytes", 20_000)
    if not isinstance(timeout, int) or not 1 <= timeout <= 60:
        raise HostSessionConfigError("hermes_host_config_host_script_timeout_invalid")
    if not isinstance(max_calls, int) or not 1 <= max_calls <= 32:
        raise HostSessionConfigError("hermes_host_config_host_script_max_calls_invalid")
    if not isinstance(max_output, int) or not 256 <= max_output <= 50_000:
        raise HostSessionConfigError("hermes_host_config_host_script_max_output_invalid")
    return {
        "version": version,
        "source": source,
        "sourceHash": source_hash,
        "compiledHash": compiled_hash,
        "mode": mode,
        "inputSchema": copy.deepcopy(input_schema),
        "outputSchema": copy.deepcopy(output_schema),
        "toolAliases": normalized_aliases,
        "fallbackToolAliases": fallback_aliases,
        "toolStates": tool_states,
        "timeoutSeconds": timeout,
        "maxToolCalls": max_calls,
        "maxOutputBytes": max_output,
    }


def secrets_compare_hash(left: str, right: str) -> bool:
    import secrets

    return secrets.compare_digest(left.encode("ascii"), right.encode("ascii"))


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
        "hostScript": _host_script(raw.get("hostScript")),
        "delegationRoles": _delegation_roles(raw.get("delegationRoles")),
        "team": _team_policy(raw.get("team")),
    }


def _delegation_roles(value: Any) -> list[str] | None:
    if value is None:
        return None
    roles = _bounded_string_list(value, "delegationRoles")
    unknown = [role for role in roles if role not in {"leaf", "orchestrator", "team"}]
    if unknown:
        raise HostSessionConfigError(
            f"hermes_host_config_delegation_role_invalid:{unknown[0]}"
        )
    return roles


def _team_model(value: Any, field: str) -> dict[str, str]:
    if not isinstance(value, dict) or set(value) != {"provider", "model"}:
        raise HostSessionConfigError(f"hermes_host_config_team_{field}_invalid")
    return {
        "provider": _bounded_text(
            value.get("provider"), f"team.{field}.provider", limit=256, required=True
        ),
        "model": _bounded_text(
            value.get("model"), f"team.{field}.model", limit=256, required=True
        ),
    }


def _team_policy(value: Any) -> dict[str, Any] | None:
    """Validate one Card/session-scoped native Team policy.

    LIQUIDAITY VENDOR PATCH: this is bounded execution configuration supplied
    by the trusted ACP host. It contains no Card identity or credentials and
    never edits Hermes' shared config or SQLite execution truth.
    """

    if value is None:
        return None
    allowed = {"mode", "maxWorkers", "retryLimit", "worker", "lead"}
    if not isinstance(value, dict) or set(value) != allowed:
        raise HostSessionConfigError("hermes_host_config_team_invalid")
    max_workers = value.get("maxWorkers")
    retry_limit = value.get("retryLimit")
    if (
        value.get("mode") != "auto"
        or not isinstance(max_workers, int)
        or isinstance(max_workers, bool)
        or max_workers not in {2, 3, 4}
        or not isinstance(retry_limit, int)
        or isinstance(retry_limit, bool)
        or not 0 <= retry_limit <= 4
    ):
        raise HostSessionConfigError("hermes_host_config_team_invalid")
    return {
        "mode": "auto",
        "maxWorkers": max_workers,
        "retryLimit": retry_limit,
        "worker": _team_model(value.get("worker"), "worker"),
        "lead": _team_model(value.get("lead"), "lead"),
    }


def _project_delegation_roles(
    definitions: list[dict[str, Any]],
    roles: list[str] | None,
) -> list[dict[str, Any]]:
    """Narrow only the host session's view of native ``delegate_task``."""

    if roles is None:
        return definitions
    projected = copy.deepcopy(definitions)
    if not roles:
        return [
            definition for definition in projected
            if str((definition.get("function") or {}).get("name") or "")
            != "delegate_task"
        ]
    for definition in projected:
        function = definition.get("function") if isinstance(definition, dict) else None
        if not isinstance(function, dict) or function.get("name") != "delegate_task":
            continue
        parameters = function.get("parameters")
        properties = parameters.get("properties") if isinstance(parameters, dict) else None
        role = properties.get("role") if isinstance(properties, dict) else None
        if not isinstance(role, dict):
            raise HostSessionConfigError("hermes_host_delegate_task_schema_invalid")
        role["enum"] = list(roles)
        role["default"] = "team" if "team" in roles else roles[0]
        role["description"] = "Authorized delegation mode for this host session."
        # A Team-only Card accepts one durable mission because native Team
        # rejects temporary batches and output schemas. Main keeps Hermes'
        # complete Leaf batch/output contract alongside Team; the host narrows
        # roles but does not replace native delegate_task semantics.
        if roles == ["team"]:
            properties.pop("tasks", None)
            properties.pop("output_schema", None)
        function["description"] = (
            "Delegate one explicit task using this host session's authorized "
            f"native role(s): {', '.join(roles)}."
        )
    return projected


def _project_host_script_tool(
    definitions: list[dict[str, Any]],
    script: dict[str, Any] | None,
) -> list[dict[str, Any]]:
    """Publish the immutable Script as one typed model-callable tool."""

    if script is None:
        return definitions
    projected = copy.deepcopy(definitions)
    for definition in projected:
        function = definition.get("function") if isinstance(definition, dict) else None
        if not isinstance(function, dict) or function.get("name") != "execute_host_script":
            continue
        function["description"] = (
            "Run this Card's immutable optimized Python tool recipe using only "
            "the saved Card-authorized operations."
        )
        function["parameters"] = copy.deepcopy(script["inputSchema"])
        return projected
    raise HostSessionConfigError("hermes_host_script_tool_unavailable")


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


def attach_host_execution_context(agent: Any, execution_context_id: str) -> None:
    """Attach only the opaque host execution identity to an existing agent.

    LIQUIDAITY VENDOR PATCH: this is the transport-neutral half of the existing
    generic ACP child-lifecycle seam for an already-constructed native agent.
    Alternate native input surfaces can bind the same generic child lifecycle
    without replacing the agent's prompt, tools, Script, or other trusted host
    session configuration.
    """

    context_id = _bounded_text(
        execution_context_id,
        "executionContextId",
        limit=128,
        required=True,
    )
    setattr(agent, "_host_execution_context_id", context_id)


def allocate_host_native_execution(
    parent_agent: Any,
    *,
    native_child_id: str,
    provider: str = "",
    model: str = "",
) -> dict[str, Any] | None:
    """Allocate opaque host execution state for one native child identity.

    LIQUIDAITY VENDOR PATCH: native runtimes such as durable Kanban teams do
    not necessarily construct an in-process ``AIAgent`` child.  The ACP host
    correlation contract therefore keys on Hermes' native child id, while the
    older object-shaped helper below remains a compatibility adapter for
    temporary delegation children.
    """
    requester = getattr(parent_agent, "_host_execution_requester", None)
    raw_parent_context_id = getattr(parent_agent, "_host_execution_context_id", "")
    raw_session_id = getattr(parent_agent, "_host_execution_session_id", "")
    parent_context_id = (
        raw_parent_context_id.strip() if isinstance(raw_parent_context_id, str) else ""
    )
    session_id = raw_session_id.strip() if isinstance(raw_session_id, str) else ""
    if not parent_context_id and not session_id:
        return None
    if not callable(requester) or not parent_context_id or not session_id:
        raise HostSessionConfigError("hermes_host_child_execution_context_unavailable")
    native_child_id = str(native_child_id or "").strip()
    if not native_child_id:
        raise HostSessionConfigError("hermes_host_native_child_id_missing")
    child_provider = str(provider or "").strip()
    child_model = str(model or "").strip()
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
    return {
        "executionContextId": context_id,
        "runId": _bounded_text(
            response.get("runId"), "childRunId", limit=128, required=True
        ),
        "toolCallMeta": dict(tool_meta),
    }


def allocate_host_child_execution(parent_agent: Any, child: Any) -> bool:
    """Allocate trusted host execution state before a native child may run."""

    response = allocate_host_native_execution(
        parent_agent,
        native_child_id=str(getattr(child, "_subagent_id", "") or ""),
        provider=str(getattr(child, "provider", "") or ""),
        model=str(getattr(child, "model", "") or ""),
    )
    if response is None:
        return False
    context_id = str(response["executionContextId"])
    tool_meta = dict(response["toolCallMeta"])
    setattr(child, "_host_execution_context_id", context_id)
    setattr(child, "_host_tool_call_meta", dict(tool_meta))
    raw_session_id = getattr(parent_agent, "_host_execution_session_id", "")
    session_id = raw_session_id.strip() if isinstance(raw_session_id, str) else ""
    requester = getattr(parent_agent, "_host_execution_requester", None)
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
    script = getattr(agent, "_host_session_config", None)
    script = script.get("hostScript") if isinstance(script, dict) else None
    token = _ACTIVE_TOOL_CALL_META.set(dict(meta) if isinstance(meta, dict) else None)
    script_token = _ACTIVE_HOST_SCRIPT.set(copy.deepcopy(script) if script else None)
    agent_token = _ACTIVE_HOST_AGENT.set(agent)
    try:
        yield
    finally:
        _ACTIVE_HOST_AGENT.reset(agent_token)
        _ACTIVE_HOST_SCRIPT.reset(script_token)
        _ACTIVE_TOOL_CALL_META.reset(token)


def current_host_tool_call_meta() -> dict[str, str] | None:
    meta = _ACTIVE_TOOL_CALL_META.get()
    return dict(meta) if meta else None


def current_host_script_config() -> dict[str, Any] | None:
    script = _ACTIVE_HOST_SCRIPT.get()
    return copy.deepcopy(script) if script else None


def activate_host_script_fallback() -> list[str]:
    """Replace the compact Script tool with its exact saved MCP handles.

    This runs only inside the active native conversation scope after a Script
    failure. The MCP definitions were already registered from the same signed
    Card grant; this function cannot discover or add another capability.
    """

    agent = _ACTIVE_HOST_AGENT.get()
    script = _ACTIVE_HOST_SCRIPT.get()
    if agent is None or not isinstance(script, dict):
        raise HostSessionConfigError("hermes_host_script_fallback_scope_unavailable")
    aliases = script.get("fallbackToolAliases")
    if not isinstance(aliases, dict):
        raise HostSessionConfigError("hermes_host_script_fallback_aliases_unavailable")
    canonical_ids = list(aliases)
    native_names = list(aliases.values())
    definitions = [
        copy.deepcopy(item)
        for item in list(getattr(agent, "tools", []) or [])
        if str((item.get("function") or {}).get("name") or "") != "execute_host_script"
    ]
    definitions = _merge_definitions(definitions, _explicit_tool_definitions(native_names))
    agent.tools = definitions
    agent.valid_tool_names = {
        str((item.get("function") or {}).get("name") or "")
        for item in definitions
        if str((item.get("function") or {}).get("name") or "")
    }
    invalidate = getattr(agent, "_invalidate_system_prompt", None)
    if callable(invalidate):
        invalidate()
    return canonical_ids


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
    script = config.get("hostScript")
    if isinstance(script, dict):
        definitions = _merge_definitions(
            definitions,
            _explicit_tool_definitions(["execute_host_script"]),
        )
        definitions = _project_host_script_tool(definitions, script)
    definitions = _project_delegation_roles(
        definitions, config.get("delegationRoles")
    )

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
