"""Compile the one saved, visible Python composition Script owned by a Card.

The compiler is structural: it validates Python syntax, a literal
``CARD_SCRIPT`` contract, and literal ``tools.call`` handles. It never executes
code or interprets intent. Invalid source remains saved and inspectable, but
cannot become the active runtime presentation.
"""
from __future__ import annotations

import ast
import json
import re
from hashlib import sha256
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from app.python_models.idd import IddValidationError, load_input_data_dictionary


SCRIPT_MAX_BYTES = 32_768
SCRIPT_MODES = frozenset({"outer_controller"})
TOOL_MODE_VALUES = {"OFF": 0, "SCRIPT": 1, "AGENT": 2, "BOTH": 3}
SAFE_IMPORT_ROOTS = frozenset({
    "collections", "datetime", "decimal", "fractions", "functools",
    "hermes_tools", "itertools", "json", "math", "re", "statistics",
})
FORBIDDEN_CALLS = frozenset({
    "__import__", "breakpoint", "compile", "eval", "exec", "globals",
    "help", "input", "locals", "open", "vars",
})


class CardScript(BaseModel):
    """Optional data in the existing saved Card runtime-extension field."""

    model_config = ConfigDict(extra="forbid", strict=True)
    enabled: bool = False
    source: str = Field(default="", max_length=SCRIPT_MAX_BYTES)
    version: int = Field(default=1, ge=1)
    author: dict[str, str] = Field(default_factory=dict)
    sourceHash: str = ""
    compiledHash: str = ""
    paletteFingerprint: str = ""
    compiled: dict[str, Any] = Field(default_factory=dict)
    lastValidation: dict[str, Any] = Field(default_factory=dict)
    nativeSupport: dict[str, Any] = Field(default_factory=dict)
    rollback: dict[str, Any] = Field(default_factory=dict)


def _canonical(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _python_identifier(value: str) -> str:
    identifier = re.sub(r"[^A-Za-z0-9_]", "_", value)
    if not identifier or identifier[0].isdigit():
        identifier = f"_{identifier}"
    return identifier


def generate_card_script_header(
    *,
    catalog_tools: list[dict[str, Any]],
    selected_tools: list[str],
    card_id: str,
) -> dict[str, Any]:
    """Generate the read-only editor/compiler stub from canonical live inputs.

    This text is never saved as Card source and never enters model context.  It
    exists solely to expose stable IDD objects plus the live catalog's grant
    state to the editor in ordinary Python names.
    """

    dictionary = load_input_data_dictionary()
    selected = set(selected_tools)
    catalog_by_id: dict[str, dict[str, Any]] = {}
    for item in catalog_tools:
        if not isinstance(item, dict):
            raise ValueError("card_script_header_catalog_invalid")
        canonical_id = str(item.get("canonicalId") or "").strip()
        if not canonical_id or canonical_id in catalog_by_id:
            raise ValueError("card_script_header_catalog_identity_invalid")
        catalog_by_id[canonical_id] = item
    unknown = next((name for name in selected_tools if name not in catalog_by_id), None)
    if unknown:
        raise ValueError(f"card_script_tool_not_selected:{unknown}")

    identity = {
        "schemaVersion": "liquidaity.card-script.header.v1",
        "iddVersion": dictionary.get("dictionary", {}).get("version"),
        "idd": {
            "types": dictionary.get("types", {}),
            "objects": dictionary.get("objects", {}),
            "operations": dictionary.get("operations", []),
        },
        "catalog": [
            {
                "canonicalId": name,
                "access": catalog_by_id[name].get("access"),
                "availability": catalog_by_id[name].get("availability"),
                "contracts": catalog_by_id[name].get("contracts", []),
            }
            for name in sorted(catalog_by_id)
        ],
        "selectedTools": list(selected_tools),
        "cardId": card_id,
    }
    header_hash = sha256(_canonical(identity).encode("utf-8")).hexdigest()
    card_delegation_roles = ["leaf", "team"] if card_id == "card_main_chat" else ["team"]
    role_literal = ", ".join(repr(value) for value in card_delegation_roles)
    lines = [
        "# Generated from LiquidAIty.idd + live native catalog + saved Card selection.",
        "# Read-only editor/compiler metadata. This file is not saved, executed, or sent to a model.",
        f"# schema: liquidaity.card-script.header.v1  hash: {header_hash}",
        "from enum import IntEnum",
        "from typing import Any, Final, Literal, Protocol, TypedDict",
        "",
        "class ToolMode(IntEnum):",
        "    OFF = 0",
        "    SCRIPT = 1",
        "    AGENT = 2",
        "    BOTH = 3",
        "OFF: Final[ToolMode]",
        "SCRIPT: Final[ToolMode]",
        "AGENT: Final[ToolMode]",
        "BOTH: Final[ToolMode]",
        "",
        "class SelectedToolHandle(Protocol):",
        "    canonical_id: str",
        "    access: str",
        "    state: ToolMode",
        "",
        "class UngrantedToolHandle(Protocol):",
        "    canonical_id: str",
        "    available: bool  # always False for this Card revision",
        "",
        "class PromptBlock(TypedDict):",
        "    id: str",
        "    content: str",
        "",
        "class SparseOverlay(TypedDict, total=False):",
        "    order: list[str]",
        "    select: list[str]",
        "    exclude: list[str]",
        "    replace: dict[str, str]",
        "    prepend: list[PromptBlock]",
        "    append: list[PromptBlock]",
        "    maxChars: int",
        "",
        "class CardAgentStage(TypedDict, total=False):",
        "    run: bool",
        "    prompt: str",
        "    overlay: SparseOverlay",
        "",
        "class CardDelegation(Protocol):",
        "    def delegate_task(",
        "        self, *, goal: str, context: str | None = None,",
        f"        role: Literal[{role_literal}] = 'team',",
        "    ) -> Any: ...",
        "",
    ]
    definitions: dict[str, dict[str, Any]] = {}
    idd_type_names = {
        name: _python_identifier(name) for name in sorted(dictionary.get("types", {}))
    }
    for name, python_name in idd_type_names.items():
        definition = dictionary["types"][name]
        lines.extend((f"class {python_name}(TypedDict, total=False):",))
        fields = definition.get("fields") if isinstance(definition, dict) else None
        if isinstance(fields, list) and fields:
            for field in fields:
                field_name = _python_identifier(str(field.get("id") or "value"))
                field_type = idd_type_names.get(str(field.get("type") or ""), "Any")
                lines.append(f"    {field_name}: {field_type}")
        else:
            lines.append("    value: Any")
        definitions[f"types.{name}"] = {"line": len(lines) - 1, "kind": "idd-type"}
        lines.append("")
    lines.append("class CardControl(Protocol):")
    for name in sorted(dictionary.get("objects", {})):
        definition = dictionary["objects"][name]
        type_name = idd_type_names.get(str(definition.get("type") or ""), "Any")
        lines.append(f"    {_python_identifier(name)}: {type_name}")
        definitions[f"card.{name}"] = {"line": len(lines), "kind": "idd-object"}
    lines.extend((
        "    prompt_blocks: list[PromptBlock]",
        "    context_blocks: list[PromptBlock]",
        "    idf: Any  # canonical retained Run input; sparse controls are Run-only",
        "    runtime: Any  # stable-only provider/model/profile authority",
        "    memory: Any  # native profile input; no credential material",
        "    skills: Any  # native profile input",
        "    agent: Any  # native Hermes stage",
        "    subagents: CardDelegation  # one native delegate_task; bounded Card roles only",
        "    handoffs: Any  # typed persisted artifacts and authorized edges",
        "    receipts: Any  # immutable Run evidence",
        "",
        "card: Final[CardControl]",
        "",
    ))
    grouped: dict[str, list[str]] = {}
    for canonical_id in sorted(catalog_by_id):
        namespace, _, leaf = canonical_id.rpartition(".")
        if not namespace:
            namespace, leaf = "root", canonical_id
        grouped.setdefault(namespace, []).append(leaf)
    for namespace, leaves in sorted(grouped.items()):
        class_name = f"_{''.join(part.title() for part in _python_identifier(namespace).split('_'))}Tools"
        lines.append(f"class {class_name}(Protocol):")
        for leaf in leaves:
            canonical_id = leaf if namespace == "root" else f"{namespace}.{leaf}"
            item = catalog_by_id[canonical_id]
            granted = canonical_id in selected
            handle_type = "SelectedToolHandle" if granted else "UngrantedToolHandle"
            access = str(item.get("access") or "read").upper()
            availability = str(item.get("availability") or "disabled").upper()
            state = "AGENT" if granted else "UNGRANTED"
            lines.append(
                f"    {_python_identifier(leaf)}: {handle_type}  # {canonical_id} | {access} | {availability} | {state}"
            )
            definitions[f"tools.{canonical_id}"] = {
                "line": len(lines),
                "kind": "tool",
                "canonicalId": canonical_id,
                "selected": granted,
                "access": str(item.get("access") or "read"),
                "availability": str(item.get("availability") or "disabled"),
            }
        lines.append("")
    lines.append("class ToolControls(Protocol):")
    for namespace in sorted(grouped):
        class_name = f"_{''.join(part.title() for part in _python_identifier(namespace).split('_'))}Tools"
        attribute = "root" if namespace == "root" else _python_identifier(namespace)
        lines.append(f"    {attribute}: {class_name}")
    lines.extend(("", "tools: Final[ToolControls]", ""))
    source = "\n".join(lines)
    return {
        "schemaVersion": "liquidaity.card-script.header.v1",
        "version": int(dictionary.get("dictionary", {}).get("version") or 0),
        "hash": header_hash,
        "source": source,
        "definitions": definitions,
        "selectedTools": list(selected_tools),
        "catalogToolCount": len(catalog_by_id),
        "cardId": card_id,
    }


def _json_schema(value: Any, field: str) -> dict[str, Any]:
    if not isinstance(value, dict) or value.get("type") != "object":
        raise ValueError(f"card_script_{field}_schema_must_be_object")
    properties = value.get("properties", {})
    required = value.get("required", [])
    if not isinstance(properties, dict) or not isinstance(required, list):
        raise ValueError(f"card_script_{field}_schema_invalid")
    if any(not isinstance(item, str) or item not in properties for item in required):
        raise ValueError(f"card_script_{field}_schema_required_invalid")
    return value


def _require_outer_controller_contract(contract: dict[str, Any]) -> None:
    """Require the one host-entered controller boundary used by every Card.

    The host always supplies the current mission, and the controller must make
    an explicit typed decision about the native agent stage.  The prompt stays
    optional in the schema because it is required only when ``run`` is true;
    that dependent check is enforced immediately before ``session/prompt``.
    """

    input_schema = contract["inputSchema"]
    mission = (input_schema.get("properties") or {}).get("mission")
    if (
        not isinstance(mission, dict)
        or mission.get("type") != "string"
        or "mission" not in (input_schema.get("required") or [])
    ):
        raise ValueError("card_script_outer_controller_mission_required")

    output_schema = contract["outputSchema"]
    agent = (output_schema.get("properties") or {}).get("agent")
    if (
        not isinstance(agent, dict)
        or agent.get("type") != "object"
        or "agent" not in (output_schema.get("required") or [])
    ):
        raise ValueError("card_script_outer_controller_agent_required")
    agent_properties = agent.get("properties") or {}
    agent_required = agent.get("required") or []
    if (
        not isinstance(agent_properties, dict)
        or not isinstance(agent_required, list)
        or (agent_properties.get("run") or {}).get("type") != "boolean"
        or "run" not in agent_required
    ):
        raise ValueError("card_script_outer_controller_agent_run_required")
    prompt = agent_properties.get("prompt")
    if prompt is not None and (
        not isinstance(prompt, dict) or prompt.get("type") != "string"
    ):
        raise ValueError("card_script_outer_controller_agent_prompt_invalid")


def _literal_contract(tree: ast.Module) -> dict[str, Any]:
    declarations: list[ast.Assign | ast.AnnAssign] = []
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(
            isinstance(target, ast.Name) and target.id == "CARD_SCRIPT"
            for target in node.targets
        ):
            declarations.append(node)
        elif (
            isinstance(node, ast.AnnAssign)
            and isinstance(node.target, ast.Name)
            and node.target.id == "CARD_SCRIPT"
        ):
            declarations.append(node)
    if len(declarations) != 1:
        raise ValueError("card_script_contract_required_once")
    value_node = declarations[0].value
    if value_node is None:
        raise ValueError("card_script_contract_literal_required")
    try:
        value = ast.literal_eval(value_node)
    except (ValueError, TypeError, SyntaxError) as error:
        raise ValueError("card_script_contract_literal_required") from error
    if not isinstance(value, dict):
        raise ValueError("card_script_contract_invalid")
    allowed = {
        "mode", "input", "output", "timeout_seconds", "max_tool_calls",
        "max_output_bytes",
    }
    unknown = set(value) - allowed
    if unknown:
        raise ValueError(f"card_script_contract_fields_unsupported:{','.join(sorted(unknown))}")
    mode = value.get("mode")
    if mode not in SCRIPT_MODES:
        raise ValueError("card_script_mode_invalid")
    timeout_seconds = value.get("timeout_seconds", 15)
    max_tool_calls = value.get("max_tool_calls", 6)
    max_output_bytes = value.get("max_output_bytes", 20_000)
    if not isinstance(timeout_seconds, int) or not 1 <= timeout_seconds <= 60:
        raise ValueError("card_script_timeout_invalid")
    if not isinstance(max_tool_calls, int) or not 1 <= max_tool_calls <= 32:
        raise ValueError("card_script_max_tool_calls_invalid")
    if not isinstance(max_output_bytes, int) or not 256 <= max_output_bytes <= 50_000:
        raise ValueError("card_script_max_output_bytes_invalid")
    contract = {
        "mode": mode,
        "inputSchema": _json_schema(value.get("input"), "input"),
        "outputSchema": _json_schema(value.get("output"), "output"),
        "timeoutSeconds": timeout_seconds,
        "maxToolCalls": max_tool_calls,
        "maxOutputBytes": max_output_bytes,
    }
    _require_outer_controller_contract(contract)
    return contract


def _validate_import(node: ast.Import | ast.ImportFrom) -> None:
    if isinstance(node, ast.Import):
        roots = [alias.name.split(".", 1)[0] for alias in node.names]
    else:
        roots = [(node.module or "").split(".", 1)[0]]
    if any(root not in SAFE_IMPORT_ROOTS for root in roots):
        raise ValueError("card_script_import_not_granted")
    if isinstance(node, ast.ImportFrom) and node.module == "hermes_tools":
        names = {alias.name for alias in node.names}
        if not names or not names.issubset({
            "AGENT", "BOTH", "OFF", "SCRIPT", "input", "output", "tools",
        }):
            raise ValueError("card_script_hermes_tools_import_invalid")


def _tool_handles(tree: ast.Module) -> tuple[list[str], int]:
    handles: list[str] = []
    output_calls = 0
    for node in ast.walk(tree):
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            _validate_import(node)
        if isinstance(node, ast.Attribute) and node.attr.startswith("_"):
            raise ValueError("card_script_private_attribute_forbidden")
        if not isinstance(node, ast.Call):
            continue
        if isinstance(node.func, ast.Name) and node.func.id in FORBIDDEN_CALLS:
            raise ValueError(f"card_script_call_forbidden:{node.func.id}")
        if not isinstance(node.func, ast.Attribute) or not isinstance(node.func.value, ast.Name):
            continue
        owner = node.func.value.id
        if owner == "tools" and node.func.attr == "call":
            if (
                not node.args
                or not isinstance(node.args[0], ast.Constant)
                or not isinstance(node.args[0].value, str)
            ):
                raise ValueError("card_script_tool_handle_must_be_literal")
            handle = node.args[0].value.strip()
            if not handle:
                raise ValueError("card_script_tool_handle_required")
            if handle not in handles:
                handles.append(handle)
        elif owner == "output" and node.func.attr == "emit":
            output_calls += 1
    if output_calls == 0:
        raise ValueError("card_script_output_emit_required")
    return handles, output_calls


def _tool_assignment_id(target: ast.expr) -> str | None:
    parts: list[str] = []
    current = target
    while isinstance(current, ast.Attribute):
        parts.append(current.attr)
        current = current.value
    if not isinstance(current, ast.Name) or current.id != "tools" or not parts:
        return None
    return ".".join(reversed(parts))


def _tool_mode_value(value: ast.expr) -> int:
    if isinstance(value, ast.Name) and value.id in TOOL_MODE_VALUES:
        return TOOL_MODE_VALUES[value.id]
    if (
        isinstance(value, ast.Constant)
        and isinstance(value.value, int)
        and not isinstance(value.value, bool)
        and value.value in TOOL_MODE_VALUES.values()
    ):
        return value.value
    raise ValueError("card_script_tool_mode_invalid")


def _tool_states(tree: ast.Module, selected_tools: list[str]) -> dict[str, int]:
    selected = set(selected_tools)
    explicit: dict[str, int] = {}
    for node in tree.body:
        target: ast.expr | None = None
        value: ast.expr | None = None
        if isinstance(node, ast.Assign) and len(node.targets) == 1:
            target, value = node.targets[0], node.value
        elif isinstance(node, ast.AnnAssign):
            target, value = node.target, node.value
        if target is None or value is None:
            continue
        tool_id = _tool_assignment_id(target)
        if tool_id is None:
            continue
        if tool_id in explicit:
            raise ValueError(f"card_script_tool_mode_duplicate:{tool_id}")
        mode = _tool_mode_value(value)
        if tool_id not in selected and mode != TOOL_MODE_VALUES["OFF"]:
            raise ValueError(f"card_script_tool_not_selected:{tool_id}")
        explicit[tool_id] = mode
    return {tool_id: explicit.get(tool_id, TOOL_MODE_VALUES["AGENT"]) for tool_id in selected_tools}


def compile_card_script(
    source: str,
    *,
    selected_tools: list[str] | None = None,
) -> dict[str, Any]:
    """Return a deterministic compiled descriptor without executing source."""

    if not source.strip():
        raise ValueError("card_script_source_blank")
    try:
        tree = ast.parse(source, filename="card_script.py", mode="exec")
    except SyntaxError as error:
        raise ValueError(
            f"card_script_syntax_invalid:{error.lineno or 0}:{error.offset or 0}"
        ) from error
    contract = _literal_contract(tree)
    handles, output_calls = _tool_handles(tree)
    selected_order = list(dict.fromkeys(selected_tools or []))
    if selected_tools is not None:
        selected = set(selected_tools)
        unavailable = [handle for handle in handles if handle not in selected]
        if unavailable:
            raise ValueError(f"card_script_tool_not_selected:{unavailable[0]}")
    tool_states = _tool_states(tree, selected_order)
    invalid_calls = [
        handle for handle in handles
        if tool_states.get(handle) not in {TOOL_MODE_VALUES["SCRIPT"], TOOL_MODE_VALUES["BOTH"]}
    ]
    if invalid_calls:
        raise ValueError(f"card_script_tool_call_mode_invalid:{invalid_calls[0]}")
    compiled = {
        "schemaVersion": "liquidaity.card-script.compiled.v1",
        **contract,
        "toolHandles": handles,
        "toolStates": tool_states,
        "offToolIds": [name for name in selected_order if tool_states[name] == TOOL_MODE_VALUES["OFF"]],
        "scriptToolIds": [name for name in selected_order if tool_states[name] in {1, 3}],
        "agentToolIds": [name for name in selected_order if tool_states[name] in {2, 3}],
        "outputEmitCalls": output_calls,
    }
    compiled["compiledHash"] = sha256(_canonical(compiled).encode("utf-8")).hexdigest()
    return compiled


def saved_script(
    value: Any,
    *,
    selected_tools: list[str] | None = None,
    palette_fingerprint: str = "",
    native_available: bool = False,
) -> dict[str, Any]:
    """Normalize source and record honest activation/fallback state."""

    try:
        script = CardScript.model_validate(value)
    except ValidationError as error:
        raise IddValidationError("card_script_configuration_invalid") from error
    script.sourceHash = sha256(script.source.encode("utf-8")).hexdigest()
    script.paletteFingerprint = palette_fingerprint
    script.compiled = {}
    script.compiledHash = ""
    errors: list[str] = []
    if script.source.strip():
        try:
            script.compiled = compile_card_script(
                script.source,
                selected_tools=selected_tools,
            )
            script.compiledHash = str(script.compiled["compiledHash"])
        except ValueError as error:
            errors.append(str(error))
    if not script.source.strip():
        status: Literal["blank", "valid", "invalid"] = "blank"
    elif errors:
        status = "invalid"
    else:
        status = "valid"
    active = bool(script.enabled and status == "valid" and native_available)
    script.lastValidation = {
        "status": status,
        "executionTested": False,
        "errors": errors,
        "toolHandles": list(script.compiled.get("toolHandles") or []),
    }
    script.nativeSupport = {
        "available": native_available,
        "executor": "hermes-native-python" if native_available else None,
        "active": active,
        **({"reason": "card_script_native_bridge_unavailable"} if not native_available else {}),
    }
    return script.model_dump()


def script_presentation(value: Any, *, selected_tools: list[str]) -> dict[str, Any]:
    """Choose Script or exact selected-MCP presentation without widening grants."""

    script = saved_script(
        value or {},
        selected_tools=selected_tools,
        native_available=True,
    )
    if script["nativeSupport"]["active"]:
        return {
            "mode": "script",
            # A Script takes over only its literal handles. Other exact
            # Tools-tab selections remain ordinary model-callable MCP tools.
            "presentedTools": list(script["compiled"].get("agentToolIds") or []),
            "script": script,
            "fallbackReason": None,
        }
    reason = None
    if script["enabled"]:
        if script["lastValidation"]["status"] != "valid":
            reason = "card_script_validation_failed"
        elif not script["nativeSupport"]["available"]:
            reason = "card_script_native_bridge_unavailable"
    return {
        "mode": "selected-mcp",
        "presentedTools": list(selected_tools),
        "script": script,
        "fallbackReason": reason,
    }
