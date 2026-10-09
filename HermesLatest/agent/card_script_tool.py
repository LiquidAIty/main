"""Execute one saved Card Python recipe through Hermes' code-execution owner.

The application supplies an already-compiled, per-turn recipe plus exact
canonical-to-Dynamic-Tool aliases.  This module verifies that boundary, runs
the immutable source in Hermes' child Python process, and routes every nested
tool call through the same signed MCP callback as the parent turn.
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
        "input_schema", "output_schema", "tool_aliases", "tool_states",
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

    raw_aliases = value.get("tool_aliases")
    raw_states = value.get("tool_states")
    if not isinstance(raw_aliases, dict) or not isinstance(raw_states, dict):
        raise CardScriptError("card_script_tool_scope_invalid")
    if len(raw_aliases) > 128 or len(raw_states) > 128:
        raise CardScriptError("card_script_tool_scope_invalid")
    aliases: dict[str, str] = {}
    for raw_canonical, raw_name in raw_aliases.items():
        canonical, name = str(raw_canonical), str(raw_name)
        if not _TOOL_ID.fullmatch(canonical) or not _TOOL_ID.fullmatch(name):
            raise CardScriptError("card_script_tool_alias_invalid")
        aliases[canonical] = name
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
    if set(aliases) != {name for name, mode in states.items() if mode in {1, 3}}:
        raise CardScriptError("card_script_tool_scope_invalid")
    if len(set(aliases.values())) != len(aliases):
        raise CardScriptError("card_script_tool_alias_duplicate")

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
        "tool_aliases": aliases,
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


def _dynamic_result_json(result: dict[str, Any]) -> str:
    items = result.get("contentItems") if isinstance(result, dict) else None
    if isinstance(items, list) and len(items) == 1 and isinstance(items[0], dict):
        item = items[0]
        if item.get("type") == "inputText":
            text = str(item.get("text") or "")
            try:
                json.loads(text)
            except (TypeError, ValueError):
                return json.dumps({"text": text}, ensure_ascii=False, separators=(",", ":"))
            return text
    return json.dumps(result, ensure_ascii=False, separators=(",", ":"))


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
        aliases = dict(config["tool_aliases"])
        deadline_interrupt = threading.Event()

        class _CombinedInterrupt:
            def is_set(self) -> bool:
                return deadline_interrupt.is_set() or interrupt_event.is_set()

        combined_interrupt = _CombinedInterrupt()
        if aliases:
            from agent.transports.dynamic_tools_mcp import build_dynamic_tool_executor

            endpoint = str(getattr(agent, "_dynamic_tool_endpoint", "") or "")
            authorization = str(getattr(agent, "_dynamic_tool_authorization", "") or "")
            remote = build_dynamic_tool_executor(
                endpoint=endpoint,
                authorization=authorization,
                canonical_names={safe: canonical for canonical, safe in aliases.items()},
            )

            def dispatch(canonical_name: str, tool_arguments: dict[str, Any]) -> str:
                safe_name = aliases.get(canonical_name)
                if safe_name is None:
                    return json.dumps({"error": "card_script_tool_not_selected"})
                return _dynamic_result_json(remote(
                    safe_name, tool_arguments, call_id, combined_interrupt,
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
                enabled_tools=list(aliases),
                reset=True,
                host_script={
                    "toolAliases": aliases,
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
        return _result(success=False, value={"error": _safe_error_code(exc)})
    except json.JSONDecodeError:
        return _result(success=False, value={"error": "card_script_result_invalid_json"})
    except Exception:
        return _result(success=False, value={"error": "card_script_execution_failed"})


__all__ = [
    "CARD_SCRIPT_CANONICAL_NAME",
    "CARD_SCRIPT_TOOL_NAME",
    "card_script_tool_definition",
    "execute_card_script_tool",
    "normalize_card_script",
]
