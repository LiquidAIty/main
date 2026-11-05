# Entity: Card Python
# Relationship: Validates and executes one enabled saved Card recipe in a bounded child of the Hermes plugin host while limiting nested calls to its selected MCP grants.
"""Execute one saved Card Python recipe through Hermes's code-execution runtime."""

from __future__ import annotations

import copy
import ast
import hashlib
import json
import os
import queue
import re
import subprocess
import sys
import tempfile
import threading
import time
from typing import Any


CARD_SCRIPT_TOOL_NAME = "card_python"
_OUTPUT_PREFIX = "HERMES_CARD_SCRIPT_OUTPUT:"
_CALL_PREFIX = "HERMES_CARD_SCRIPT_CALL:"
_TOOL_ID = re.compile(r"^[A-Za-z0-9_.-]+$")

_CHILD_RUNNER = r'''
import json
import sys
import types

CALL_PREFIX = "HERMES_CARD_SCRIPT_CALL:"
OUTPUT_PREFIX = "HERMES_CARD_SCRIPT_OUTPUT:"
config = json.loads(sys.stdin.readline())

class _AttrMap(dict):
    def __getattr__(self, name):
        try:
            return _wrap(self[name])
        except KeyError as error:
            raise AttributeError(name) from error

def _wrap(value):
    if isinstance(value, dict):
        return _AttrMap({key: _wrap(item) for key, item in value.items()})
    if isinstance(value, list):
        return [_wrap(item) for item in value]
    return value

OFF, SCRIPT, AGENT, BOTH = 0, 1, 2, 3
tool_states = config["tool_states"]

def _call(name, arguments):
    print(CALL_PREFIX + json.dumps({"name": name, "arguments": arguments}, separators=(",", ":")), flush=True)
    response = json.loads(sys.stdin.readline())
    if response.get("ok") is not True:
        return {"error": response.get("error") or "card_script_tool_failed"}
    return _wrap(response.get("result"))

class _ToolNamespace:
    def __init__(self, path):
        object.__setattr__(self, "_path", path)
    def __getattr__(self, name):
        return _ToolNamespace(object.__getattribute__(self, "_path") + [name])
    def __setattr__(self, name, value):
        canonical = ".".join(object.__getattribute__(self, "_path") + [name])
        if canonical not in tool_states:
            raise ValueError("tool is not selected on this Card: " + canonical)
        if not isinstance(value, int) or isinstance(value, bool) or value != tool_states[canonical]:
            raise ValueError("tool mode differs from compiled Card Python recipe: " + canonical)

class _Tools:
    def __getattr__(self, name):
        return _ToolNamespace([name])
    @staticmethod
    def call(canonical, **arguments):
        if not isinstance(canonical, str) or not canonical.strip():
            raise ValueError("tool canonical id required")
        return _call(canonical, arguments)

class _Output:
    @staticmethod
    def emit(value):
        print(OUTPUT_PREFIX + json.dumps(value, ensure_ascii=False, separators=(",", ":")), flush=True)

module = types.ModuleType("hermes_tools")
module.OFF, module.SCRIPT, module.AGENT, module.BOTH = OFF, SCRIPT, AGENT, BOTH
module.input = _wrap(config["input"])
module.output = _Output()
module.tools = _Tools()
sys.modules["hermes_tools"] = module
namespace = {"__name__": "__main__"}
exec(compile(config["source"], "card_script.py", "exec"), namespace, namespace)
'''


class CardScriptError(ValueError):
    """A bounded, caller-safe Card Script contract failure."""


def _validate_recipe_source(source: str, allowed_tools: set[str]) -> None:
    """Enforce the positive recipe grammar again at the execution boundary."""

    try:
        tree = ast.parse(source, filename="card_script.py", mode="exec")
    except SyntaxError as error:
        raise CardScriptError("card_script_source_invalid") from error
    allowed_nodes = (
        ast.Module, ast.ImportFrom, ast.alias, ast.Assign, ast.Name, ast.Load,
        ast.Store, ast.Constant, ast.Dict, ast.List, ast.Tuple, ast.Expr,
        ast.Call, ast.Attribute, ast.Subscript, ast.keyword, ast.UnaryOp, ast.UAdd, ast.USub,
        ast.Not,
    )
    if any(not isinstance(node, allowed_nodes) for node in ast.walk(tree)):
        raise CardScriptError("card_script_source_grammar_invalid")
    imports = [
        node for node in tree.body
        if isinstance(node, ast.ImportFrom)
        and node.level == 0
        and node.module == "hermes_tools"
    ]
    if len(imports) != 1 or any(alias.asname for alias in imports[0].names):
        raise CardScriptError("card_script_source_import_invalid")
    if any(
        alias.name not in {"AGENT", "BOTH", "OFF", "SCRIPT", "input", "output", "tools"}
        for alias in imports[0].names
    ):
        raise CardScriptError("card_script_source_import_invalid")
    contracts = [
        node for node in tree.body
        if isinstance(node, ast.Assign)
        and len(node.targets) == 1
        and isinstance(node.targets[0], ast.Name)
        and node.targets[0].id == "CARD_SCRIPT"
    ]
    if len(contracts) != 1:
        raise CardScriptError("card_script_contract_required_once")
    try:
        if not isinstance(ast.literal_eval(contracts[0].value), dict):
            raise ValueError
    except (TypeError, ValueError, SyntaxError) as error:
        raise CardScriptError("card_script_contract_literal_required") from error
    output_calls = 0
    for node in ast.walk(tree):
        if isinstance(node, ast.Attribute):
            root = node.value
            while isinstance(root, ast.Attribute):
                root = root.value
            if not isinstance(root, ast.Name) or root.id not in {"input", "output", "tools"}:
                raise CardScriptError("card_script_attribute_not_allowed")
        if not isinstance(node, ast.Call):
            continue
        function = node.func
        if (
            isinstance(function, ast.Attribute)
            and isinstance(function.value, ast.Name)
            and function.value.id == "output"
            and function.attr == "emit"
        ):
            output_calls += 1
            continue
        if not (
            isinstance(function, ast.Attribute)
            and isinstance(function.value, ast.Name)
            and function.value.id == "tools"
            and function.attr == "call"
            and node.args
            and isinstance(node.args[0], ast.Constant)
            and isinstance(node.args[0].value, str)
            and node.args[0].value in allowed_tools
        ):
            raise CardScriptError("card_script_call_not_allowed")
    if output_calls != 1:
        raise CardScriptError("card_script_output_emit_once_required")


def _schema(value: Any, field: str) -> dict[str, Any]:
    if not isinstance(value, dict) or value.get("type") != "object":
        raise CardScriptError(f"card_script_{field}_schema_invalid")
    try:
        from jsonschema.validators import validator_for

        validator_for(value).check_schema(value)
    except Exception as error:
        raise CardScriptError(f"card_script_{field}_schema_invalid") from error
    return copy.deepcopy(value)


def normalize_card_script(value: Any) -> dict[str, Any] | None:
    """Validate the exact profile-projected recipe; an empty mapping stays inert."""

    if value in (None, {}):
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
    tool_states: dict[str, int] = {}
    for raw_name, raw_mode in raw_states.items():
        name = str(raw_name)
        if (
            not _TOOL_ID.fullmatch(name)
            or not isinstance(raw_mode, int)
            or isinstance(raw_mode, bool)
            or raw_mode not in {0, 1, 2, 3}
        ):
            raise CardScriptError("card_script_tool_state_invalid")
        tool_states[name] = raw_mode
    if set(tool_names) != {
        name for name, mode in tool_states.items() if mode in {1, 3}
    }:
        raise CardScriptError("card_script_tool_scope_invalid")
    if len(set(tool_names.values())) != len(tool_names):
        raise CardScriptError("card_script_tool_name_duplicate")
    _validate_recipe_source(source, set(tool_names))

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
        "tool_states": tool_states,
        "timeout_seconds": bounded_integer("timeout_seconds", 1, 60),
        "max_tool_calls": bounded_integer("max_tool_calls", 1, 32),
        "max_output_bytes": bounded_integer("max_output_bytes", 256, 50_000),
    }


def card_python_schema(config: dict[str, Any] | None) -> dict[str, Any]:
    return {
        "name": CARD_SCRIPT_TOOL_NAME,
        "description": (
            "Run this Card's saved Python tool recipe when the current task matches "
            "its input schema. Nested calls remain inside this profile's selected "
            "LiquidAIty MCP tools."
        ),
        "parameters": copy.deepcopy(
            config["input_schema"] if config is not None
            else {"type": "object", "properties": {}, "additionalProperties": False}
        ),
    }


def hermes_python_runtime_available() -> bool:
    """The plugin host interpreter is the Card Script child-runtime owner."""

    return bool(sys.executable and os.path.isfile(sys.executable))


def _validate_json(value: Any, schema: dict[str, Any], field: str) -> None:
    try:
        from jsonschema.validators import validator_for

        validator_for(schema)(schema).validate(value)
    except Exception as error:
        raise CardScriptError(f"card_script_{field}_invalid") from error


def _safe_error_code(value: Any) -> str:
    match = re.match(r"^([a-z][a-z0-9_]{2,120})(?::|$)", str(value or ""))
    return match.group(1) if match else "card_script_execution_failed"


def execute_card_script(
    ctx: Any,
    config: dict[str, Any],
    arguments: dict[str, Any],
    *,
    session_id: str = "",
) -> dict[str, Any]:
    """Run one validated recipe in an isolated Hermes-Python child process."""

    _validate_json(arguments, config["input_schema"], "input")
    tool_names = dict(config["tool_names"])

    if not hermes_python_runtime_available():
        raise CardScriptError("card_script_hermes_python_unavailable")
    child_environment = {
        key: value for key, value in os.environ.items()
        if key.upper() in {"SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT", "TEMP", "TMP"}
    }
    child_environment.update({"PYTHONIOENCODING": "utf-8", "PYTHONUNBUFFERED": "1"})
    creation_flags = getattr(subprocess, "CREATE_NO_WINDOW", 0) if os.name == "nt" else 0
    events: queue.Queue[tuple[str, str | None]] = queue.Queue()
    emitted: list[str] = []
    diagnostics: list[str] = []
    deadline = time.monotonic() + config["timeout_seconds"]
    calls = 0

    with tempfile.TemporaryDirectory(prefix="hermes-card-script-") as workdir:
        process = subprocess.Popen(
            [sys.executable, "-I", "-u", "-c", _CHILD_RUNNER],
            cwd=workdir,
            env=child_environment,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            creationflags=creation_flags,
        )
        assert process.stdin is not None and process.stdout is not None and process.stderr is not None

        def read_stream(label: str, stream: Any) -> None:
            for line in stream:
                events.put((label, line.rstrip("\r\n")))
            events.put((label, None))

        readers = [
            threading.Thread(target=read_stream, args=("stdout", process.stdout), daemon=True),
            threading.Thread(target=read_stream, args=("stderr", process.stderr), daemon=True),
        ]
        for reader in readers:
            reader.start()

        def settle_process(*, kill: bool) -> int:
            if kill and process.poll() is None:
                process.kill()
            try:
                return_code = process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                return_code = process.wait(timeout=5)
            for reader in readers:
                reader.join(timeout=2)
            for stream in (process.stdin, process.stdout, process.stderr):
                try:
                    stream.close()
                except OSError:
                    pass
            return return_code
        try:
            process.stdin.write(json.dumps({
                "source": config["source"],
                "input": arguments,
                "tool_states": config["tool_states"],
                "session_id": str(session_id or ""),
            }, ensure_ascii=False, separators=(",", ":")) + "\n")
            process.stdin.flush()
            stdout_closed = stderr_closed = False
            while not (stdout_closed and stderr_closed and process.poll() is not None):
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise CardScriptError("card_script_timeout")
                try:
                    label, line = events.get(timeout=min(0.1, remaining))
                except queue.Empty:
                    continue
                if line is None:
                    if label == "stdout":
                        stdout_closed = True
                    else:
                        stderr_closed = True
                    continue
                if label == "stderr":
                    if sum(len(item) for item in diagnostics) < 8_000:
                        diagnostics.append(line)
                    continue
                if line.startswith(_CALL_PREFIX):
                    calls += 1
                    if calls > config["max_tool_calls"]:
                        response = {"ok": False, "error": "card_script_max_tool_calls_exceeded"}
                    else:
                        try:
                            request = json.loads(line[len(_CALL_PREFIX):])
                            canonical_name = str(request.get("name") or "")
                            tool_name = tool_names.get(canonical_name)
                            tool_arguments = request.get("arguments")
                            if tool_name is None or not isinstance(tool_arguments, dict):
                                raise CardScriptError("card_script_tool_not_selected")
                            result = ctx.call_mcp(
                                "liquidaity",
                                tool_name,
                                tool_arguments,
                                timeout=max(1, min(config["timeout_seconds"], int(remaining))),
                            )
                            response = result if isinstance(result, dict) else {
                                "ok": False, "error": "card_script_tool_result_invalid",
                            }
                        except CardScriptError as error:
                            response = {"ok": False, "error": _safe_error_code(error)}
                        except Exception:
                            response = {"ok": False, "error": "card_script_tool_failed"}
                    process.stdin.write(json.dumps(response, ensure_ascii=False, separators=(",", ":")) + "\n")
                    process.stdin.flush()
                elif line.startswith(_OUTPUT_PREFIX):
                    emitted.append(line[len(_OUTPUT_PREFIX):])
                elif sum(len(item) for item in diagnostics) < 8_000:
                    diagnostics.append(line)
            return_code = settle_process(kill=False)
        except BaseException:
            settle_process(kill=True)
            raise

    if return_code != 0:
        raise CardScriptError(
            _safe_error_code(diagnostics[-1] if diagnostics else None)
        )
    if len(emitted) != 1:
        raise CardScriptError("card_script_output_emit_once_required")
    if len(emitted[0].encode("utf-8")) > config["max_output_bytes"]:
        raise CardScriptError("card_script_output_too_large")
    try:
        output = json.loads(emitted[0])
    except json.JSONDecodeError as error:
        raise CardScriptError("card_script_result_invalid_json") from error
    _validate_json(output, config["output_schema"], "output")
    return output


def build_handler(ctx: Any):
    def handle(arguments: dict[str, Any], **kwargs: Any) -> str:
        try:
            config = normalize_card_script(ctx.get_config("card_script", {}))
            if config is None:
                raise CardScriptError("card_script_not_configured")
            return json.dumps(
                execute_card_script(
                    ctx,
                    config,
                    dict(arguments or {}),
                    session_id=str(kwargs.get("session_id") or kwargs.get("task_id") or ""),
                ),
                ensure_ascii=False,
                separators=(",", ":"),
            )
        except CardScriptError as error:
            return json.dumps({"error": _safe_error_code(error)})
        except Exception:
            return json.dumps({"error": "card_script_execution_failed"})

    return handle
