"""Execute one saved Card Python recipe through Hermes' code-execution owner.

The application supplies an already-compiled recipe plus exact canonical MCP
tool names. This module verifies that boundary, runs the immutable source in
Hermes' child Python process, and dispatches nested calls through the Card's
already-loaded profile tools.
"""

from __future__ import annotations

import copy
import hashlib
import json
import re
import threading
from typing import Any


CARD_SCRIPT_TOOL_NAME = "card_python"
CARD_SCRIPT_CANONICAL_NAME = "hermes.card_python"
_OUTPUT_PREFIX = "HERMES_CARD_SCRIPT_OUTPUT:"
_TOOL_ID = re.compile(r"^[A-Za-z0-9_.-]+$")


class CardScriptError(ValueError):
    """A bounded, caller-safe Card Script contract failure."""


def _schema(value: Any, field: str) -> dict[str, Any]:
    if not isinstance(value, dict) or value.get("type") != "object":
        raise CardScriptError(f"card_script_{field}_schema_invalid")
    try:
        from jsonschema.validators import validator_for

        validator_for(value).check_schema(value)
    except Exception as exc:
        raise CardScriptError(f"card_script_{field}_schema_invalid") from exc
    return copy.deepcopy(value)


def normalize_card_script(value: Any) -> dict[str, Any] | None:
    """Validate the exact per-turn wire object; ``None`` stays inert."""

    if value is None:
        return None
    if not isinstance(value, dict):
        raise CardScriptError("card_script_contract_invalid")
    allowed = {
        "version", "source", "source_hash", "compiled_hash", "mode",
        "input_schema", "output_schema", "tool_names", "tool_states",
        "timeout_seconds", "max_tool_calls", "max_output_bytes",
    }
    if unknown := sorted(set(value) - allowed):
        raise CardScriptError(f"card_script_contract_field_unsupported:{unknown[0]}")
    version = value.get("version")
    source = value.get("source")
    source_hash = str(value.get("source_hash") or "")
    compiled_hash = str(value.get("compiled_hash") or "")
    if not isinstance(version, int) or isinstance(version, bool) or version < 1:
        raise CardScriptError("card_script_version_invalid")
    if (
        not isinstance(source, str)
        or not source.strip()
        or len(source.encode("utf-8")) > 32_768
    ):
        raise CardScriptError("card_script_source_invalid")
    if (
        not re.fullmatch(r"[0-9a-f]{64}", source_hash)
        or hashlib.sha256(source.encode("utf-8")).hexdigest() != source_hash
    ):
        raise CardScriptError("card_script_source_hash_mismatch")
    if not re.fullmatch(r"[0-9a-f]{64}", compiled_hash):
        raise CardScriptError("card_script_compiled_hash_invalid")
    if value.get("mode") != "tool_recipe":
        raise CardScriptError("card_script_mode_invalid")

    raw_names = value.get("tool_names")
    raw_states = value.get("tool_states")
    if not isinstance(raw_names, dict) or not isinstance(raw_states, dict):
        raise CardScriptError("card_script_tool_scope_invalid")
    if len(raw_names) > 128 or len(raw_states) > 128:
        raise CardScriptError("card_script_tool_scope_invalid")
    tool_names: dict[str, str] = {}
    for raw_canonical, raw_name in raw_names.items():
        canonical, name = str(raw_canonical), str(raw_name)
        if not _TOOL_ID.fullmatch(canonical) or not _TOOL_ID.fullmatch(name):
            raise CardScriptError("card_script_tool_name_invalid")
        tool_names[canonical] = name
    states: dict[str, int] = {}
    for raw_name, raw_mode in raw_states.items():
        name = str(raw_name)
        if (
            not _TOOL_ID.fullmatch(name)
            or not isinstance(raw_mode, int)
            or isinstance(raw_mode, bool)
            or raw_mode not in {0, 1, 2, 3}
        ):
            raise CardScriptError("card_script_tool_state_invalid")
        states[name] = raw_mode
    if set(tool_names) != {name for name, mode in states.items() if mode in {1, 3}}:
        raise CardScriptError("card_script_tool_scope_invalid")
    if len(set(tool_names.values())) != len(tool_names):
        raise CardScriptError("card_script_tool_name_duplicate")

    def bounded_integer(field: str, minimum: int, maximum: int) -> int:
        raw = value.get(field)
        if not isinstance(raw, int) or isinstance(raw, bool) or not minimum <= raw <= maximum:
            raise CardScriptError(f"card_script_{field}_invalid")
        return raw

    return {
        "version": version,
        "source": source,
        "source_hash": source_hash,
        "compiled_hash": compiled_hash,
        "mode": "tool_recipe",
        "input_schema": _schema(value.get("input_schema"), "input"),
        "output_schema": _schema(value.get("output_schema"), "output"),
        "tool_names": tool_names,
        "tool_states": states,
        "timeout_seconds": bounded_integer("timeout_seconds", 1, 60),
        "max_tool_calls": bounded_integer("max_tool_calls", 1, 32),
        "max_output_bytes": bounded_integer("max_output_bytes", 256, 50_000),
    }


def card_script_tool_definition(config: dict[str, Any]) -> dict[str, Any]:
    return {
        "type": "function",
        "name": CARD_SCRIPT_TOOL_NAME,
        "canonical_name": CARD_SCRIPT_CANONICAL_NAME,
        "description": (
            "Run this Card's saved Python tool recipe. Use it when the current task "
            "matches its input schema. The recipe can call only the Card tools assigned to it."
        ),
        "input_schema": copy.deepcopy(config["input_schema"]),
    }


def _validate_json(value: Any, schema: dict[str, Any], field: str) -> None:
    try:
        from jsonschema.validators import validator_for

        validator_for(schema)(schema).validate(value)
    except Exception as exc:
        raise CardScriptError(f"card_script_{field}_invalid") from exc


def _tool_result_json(result: Any) -> str:
    if isinstance(result, str):
        try:
            json.loads(result)
        except (TypeError, ValueError):
            return json.dumps({"text": result}, ensure_ascii=False, separators=(",", ":"))
        return result
    return json.dumps(result, ensure_ascii=False, separators=(",", ":"), default=str)


def _result(*, success: bool, value: Any) -> dict[str, Any]:
    return {
        "success": success,
        "contentItems": [{
            "type": "inputText",
            "text": json.dumps(value, ensure_ascii=False, separators=(",", ":")),
        }],
    }


def _safe_error_code(value: Any) -> str:
    match = re.match(r"^([a-z][a-z0-9_]{2,120})(?::|$)", str(value or ""))
    return match.group(1) if match else "card_script_execution_failed"


def _restore_wrapped_profile_tools(agent: Any) -> None:
    """Remove the failed compact Script and restore only its preloaded wrapped tools."""

    fallback_tools = list(getattr(agent, "_card_script_fallback_tools", None) or [])
    fallback_names = set(getattr(agent, "_card_script_fallback_names", None) or set())
    current_tools = list(getattr(agent, "tools", None) or [])

    def definition_name(definition: Any) -> str:
        function = definition.get("function") if isinstance(definition, dict) else None
        return str(function.get("name") or "") if isinstance(function, dict) else ""

    retained = [
        definition for definition in current_tools
        if definition_name(definition) != CARD_SCRIPT_TOOL_NAME
    ]
    retained_names = {definition_name(definition) for definition in retained}
    retained.extend(
        definition for definition in fallback_tools
        if definition_name(definition) not in retained_names
    )
    agent.tools = retained
    agent.valid_tool_names = (
        set(getattr(agent, "valid_tool_names", None) or set())
        - {CARD_SCRIPT_TOOL_NAME}
    ) | fallback_names
    agent._card_script = None


def execute_card_script_tool(
    agent: Any,
    arguments: dict[str, Any],
    call_id: str,
    interrupt_event: threading.Event,
) -> dict[str, Any]:
    """Execute the current turn's validated recipe and return one model tool result."""

    try:
        config = normalize_card_script(getattr(agent, "_card_script", None))
        if config is None:
            raise CardScriptError("card_script_not_configured")
        _validate_json(arguments, config["input_schema"], "input")
        tool_names = dict(config["tool_names"])
        deadline_interrupt = threading.Event()

        class _CombinedInterrupt:
            def is_set(self) -> bool:
                return deadline_interrupt.is_set() or interrupt_event.is_set()

        combined_interrupt = _CombinedInterrupt()
        if tool_names:
            dispatch_count = 0

            def dispatch(canonical_name: str, tool_arguments: dict[str, Any]) -> str:
                nonlocal dispatch_count
                registry_name = tool_names.get(canonical_name)
                if registry_name is None:
                    return json.dumps({"error": "card_script_tool_not_selected"})
                if combined_interrupt.is_set():
                    return json.dumps({"error": "card_script_interrupted"})
                dispatch_count += 1
                agent._card_script_nested_tool_calls = int(
                    getattr(agent, "_card_script_nested_tool_calls", 0) or 0
                ) + 1
                import model_tools

                return _tool_result_json(model_tools.handle_function_call(
                    registry_name,
                    tool_arguments,
                    task_id=str(getattr(agent, "session_id", "") or ""),
                    tool_call_id=f"{call_id}:script:{dispatch_count}",
                    session_id=str(getattr(agent, "session_id", "") or ""),
                    turn_id=str(getattr(agent, "_current_turn_id", "") or ""),
                    api_request_id=str(getattr(agent, "_current_api_request_id", "") or ""),
                    enabled_tools=sorted(
                        set(getattr(agent, "valid_tool_names", None) or set())
                        | set(tool_names.values())
                    ),
                    enabled_toolsets=getattr(agent, "enabled_toolsets", None),
                    disabled_toolsets=getattr(agent, "disabled_toolsets", None),
                ))
        else:
            def dispatch(_canonical_name: str, _tool_arguments: dict[str, Any]) -> str:
                return json.dumps({"error": "card_script_tool_not_selected"})

        from tools.code_execution_tool import execute_code

        timeout = threading.Timer(config["timeout_seconds"], deadline_interrupt.set)
        timeout.daemon = True
        timeout.start()
        try:
            raw = execute_code(
                config["source"],
                task_id=str(getattr(agent, "session_id", "") or ""),
                enabled_tools=list(tool_names),
                reset=True,
                host_script={
                    "toolAliases": tool_names,
                    "toolStates": config["tool_states"],
                    "input": arguments,
                    "timeoutSeconds": config["timeout_seconds"],
                    "maxToolCalls": config["max_tool_calls"],
                    "sourceHash": config["source_hash"],
                },
                dispatch=dispatch,
            )
        finally:
            deadline_interrupt.set()
            timeout.cancel()
        execution = json.loads(raw)
        if not isinstance(execution, dict) or execution.get("status") != "success":
            raise CardScriptError(_safe_error_code(
                execution.get("error") if isinstance(execution, dict) else None
            ))
        emitted = [
            line[len(_OUTPUT_PREFIX):]
            for line in str(execution.get("output") or "").splitlines()
            if line.startswith(_OUTPUT_PREFIX)
        ]
        if len(emitted) != 1:
            raise CardScriptError("card_script_output_emit_once_required")
        if len(emitted[0].encode("utf-8")) > config["max_output_bytes"]:
            raise CardScriptError("card_script_output_too_large")
        output = json.loads(emitted[0])
        _validate_json(output, config["output_schema"], "output")
        return _result(success=True, value=output)
    except CardScriptError as exc:
        _restore_wrapped_profile_tools(agent)
        return _result(success=False, value={"error": _safe_error_code(exc)})
    except json.JSONDecodeError:
        _restore_wrapped_profile_tools(agent)
        return _result(success=False, value={"error": "card_script_result_invalid_json"})
    except Exception:
        _restore_wrapped_profile_tools(agent)
        return _result(success=False, value={"error": "card_script_execution_failed"})


__all__ = [
    "CARD_SCRIPT_CANONICAL_NAME",
    "CARD_SCRIPT_TOOL_NAME",
    "card_script_tool_definition",
    "execute_card_script_tool",
    "normalize_card_script",
]
