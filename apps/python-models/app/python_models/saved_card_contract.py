"""Pure saved-Card identity, runtime, provider, and serialization contract."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from hashlib import sha256
from typing import Any

from pydantic import TypeAdapter, ValidationError

from app.python_models.card_script import CardScriptValidationError, saved_script
from app.python_models.card_subsystem import normalize_card_subsystems
from app.python_models.card_configuration_contracts import CardSubagentType

class CardDomainError(ValueError):
    """Typed failure at the stable Card/transient communication boundary."""

GRANT_FIELDS = {
    "tool": "tools",
    "skill": "skills",
    "toolset": "toolsets",
    "mcp_connection": "mcpConnectionIds",
}

_RETIRED_HERMES_TOOL_MARKER_PREFIX = "hermes:tool:"
_RETIRED_CARD_TOOL_IDS = frozenset({
    "card.load_graph_references",
    "engraphis_correct",
    "engraphis_ingest",
    "engraphis_link",
    "write_mag_one_instructions",
})
_RETIRED_RUNTIME_OPTION_FIELDS = frozenset({"openaiRuntime", "team", "writeMode"})

KNOWN_RUNTIME_OPTION_FIELDS = {
    "tools", "skills", "toolsets", "mcpConnectionIds",
    "provider", "modelKey", "providerModelId", "accessMode",
    "reasoningEffort",
}

SUBAGENT_MODEL_FIELDS = {
    "provider", "accessMode", "modelKey", "providerModelId",
}

SUBAGENT_ACCESS_MODES = {
    "chatgpt-account", "openai-api", "openrouter-api",
}

SAVED_PROVIDER_ACCESS_PAIRS = {
    ("openai", "chatgpt-account"),
    ("openai", "openai-api"),
    ("openrouter", "openrouter-api"),
    ("local_openai_compatible", "openai-api"),
}

REASONING_EFFORTS = frozenset({
    "low", "medium", "high", "xhigh", "max", "ultra",
})


KNOWN_CARD_FIELDS = {
    "id", "kind", "templateId", "title", "subtitle", "role", "status",
    "parentGraphId", "prompt", "outputContract", "runtime",
    "runtimeOptions", "provider", "providerModelId",
    "enabled", "position",
    "_cardRevisionId", "_cardRevision", "_cardRevisionSha256",
}

def utc_now() -> datetime:
    return datetime.now(timezone.utc)

def accepted_at(value: Any) -> datetime:
    """Validate the transport-owned acceptance clock without replacing it."""

    if not isinstance(value, str) or not value.strip():
        raise CardDomainError("accepted_at_required")
    try:
        parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except ValueError as error:
        raise CardDomainError("accepted_at_invalid") from error
    if parsed.tzinfo is None:
        raise CardDomainError("accepted_at_invalid")
    return parsed.astimezone(timezone.utc)

def required_text(value: Any, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise CardDomainError(f"{field}_required")
    return value.strip()

def required_content(value: Any, field: str) -> str:
    """Validate non-empty user/model content without changing its exact bytes."""

    if not isinstance(value, str) or not value.strip():
        raise CardDomainError(f"{field}_required")
    return value

def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))

def sha256_text(value: str) -> str:
    return sha256(value.encode("utf-8")).hexdigest()

def json_object(value: Any, field: str) -> dict[str, Any]:
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise CardDomainError(f"{field}_invalid")
    return dict(value)

def string_list(value: Any, field: str) -> list[str]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise CardDomainError(f"{field}_invalid")
    result: list[str] = []
    seen: set[str] = set()
    for item in value:
        text = required_text(item, field)
        if text in seen:
            raise CardDomainError(f"{field}_duplicate:{text}")
        seen.add(text)
        result.append(text)
    return result


def canonical_card_tools_and_toolsets(options: dict[str, Any]) -> tuple[list[str], list[str]]:
    """Return the one canonical split between MCP tools and Hermes toolsets.

    Old saved revisions placed retired ``hermes:tool:*`` markers and removed
    staging operations in ``tools``. Reads discard that residue in memory and
    the next save removes it from persisted grants.
    """

    tools = string_list(options.get("tools"), "tools")
    toolsets = string_list(options.get("toolsets"), "toolsets")
    return (
        [
            tool_id for tool_id in tools
            if not tool_id.startswith(_RETIRED_HERMES_TOOL_MARKER_PREFIX)
            and tool_id not in _RETIRED_CARD_TOOL_IDS
        ],
        toolsets,
    )

def card_runtime(card: dict[str, Any]) -> dict[str, str]:
    runtime = json_object(card.get("runtime"), "card_runtime")
    unknown = set(runtime) - {"kind", "mode", "profile"}
    if unknown:
        raise CardDomainError(f"card_runtime_fields_unsupported:{','.join(sorted(unknown))}")
    kind = required_text(runtime.get("kind"), "runtime_kind")
    mode = required_text(runtime.get("mode"), "runtime_mode")
    if kind == "hermes":
        if mode not in {"main", "delegate", "magentic_one"}:
            raise CardDomainError(f"hermes_runtime_mode_unsupported:{mode}")
        return {
            "kind": kind,
            "mode": mode,
            "profile": required_text(runtime.get("profile"), "runtime_profile"),
        }
    raise CardDomainError(f"runtime_kind_unsupported:{kind}")

def is_magnetic_taskgraph_runtime(runtime: dict[str, Any]) -> bool:
    return runtime.get("kind") == "hermes" and runtime.get("mode") == "magentic_one"

def validate_auto_runtime_options(
    options: dict[str, Any],
    runtime: dict[str, Any],
) -> tuple[bool, bool]:
    """Validate saved Auto selectors without consulting live availability."""

    values: list[bool] = []
    for field, error_field in (
        ("autoTools", "auto_tools"),
        ("autoModel", "auto_model"),
    ):
        value = options.get(field)
        if value is not None and not isinstance(value, bool):
            raise CardDomainError(f"card_{error_field}_invalid")
        if value is not None and (
            runtime.get("kind") != "hermes"
            or is_magnetic_taskgraph_runtime(runtime)
        ):
            raise CardDomainError(
                f"card_{error_field}_requires_non_magnetic_hermes"
            )
        values.append(value is True)
    return values[0], values[1]

def validate_saved_provider_selection(
    provider: Any,
    access_mode: Any,
) -> tuple[str, str]:
    """Validate saved provider authority without resolving availability or credentials."""

    normalized_provider = str(provider or "").strip().lower()
    normalized_access_mode = str(access_mode or "").strip().lower()
    if not normalized_provider or not normalized_access_mode:
        raise CardDomainError("card_provider_selection_incomplete")
    pair = (normalized_provider, normalized_access_mode)
    if pair not in SAVED_PROVIDER_ACCESS_PAIRS:
        raise CardDomainError(
            f"card_provider_access_mode_mismatch:{normalized_provider}:{normalized_access_mode}"
        )
    return pair


def reasoning_effort_selection(value: Any) -> str:
    if value is None or value == "":
        return ""
    if not isinstance(value, str):
        raise CardDomainError("card_reasoning_effort_invalid")
    normalized = value.strip().lower()
    if normalized not in REASONING_EFFORTS:
        raise CardDomainError("card_reasoning_effort_invalid")
    return normalized

def validate_saved_hermes_runtime_authority(
    provider: Any,
    access_mode: Any,
    *,
    hermes: bool,
) -> dict[str, Any]:
    normalized_provider, normalized_access_mode = validate_saved_provider_selection(
        provider, access_mode
    )
    if not hermes:
        raise CardDomainError("card_runtime_requires_hermes")
    return {
        "provider": normalized_provider,
        "accessMode": normalized_access_mode,
    }

def stable_card_record(card: dict[str, Any]) -> dict[str, Any]:
    options = json_object(card.get("runtimeOptions"), "runtime_options")
    runtime = card_runtime(card)
    if any(field in card for field in ("provider", "providerModelId", *GRANT_FIELDS.values())):
        raise CardDomainError("card_top_level_runtime_configuration_unsupported")
    # Saved misconfigurations must remain readable through the canonical API so
    # an authenticated update can repair them. Invocation validates the strict
    # Hermes transport/policy and fails closed before starting a Run.
    provider = str(options.get("provider") or "").strip().lower()
    access_mode = str(options.get("accessMode") or "").strip().lower()
    tools, toolsets = canonical_card_tools_and_toolsets(options)
    grants = {
        "tools": tools,
        "skills": string_list(options.get("skills"), "skills"),
        "toolsets": toolsets,
        "mcpConnectionIds": string_list(
            options.get("mcpConnectionIds"), "mcp_connection_ids",
        ),
    }
    extensions = {
        key: value for key, value in options.items()
        if key not in KNOWN_RUNTIME_OPTION_FIELDS
        and key not in _RETIRED_RUNTIME_OPTION_FIELDS
    }
    # Preserve legacy or partially restored authority fields verbatim here.
    # The authenticated Card API must be able to read and repair them. The
    # invocation boundary below validates the exact current Hermes contract.
    if "subagentModel" in extensions:
        extensions["subagentModel"] = json_object(
            extensions["subagentModel"], "card_subagent_model"
        )
    if "subagentType" in extensions:
        try:
            extensions["subagentType"] = TypeAdapter(CardSubagentType).validate_python(
                extensions["subagentType"]
            )
        except ValidationError as error:
            raise CardDomainError("card_subagent_type_invalid") from error
    if "script" in extensions:
        try:
            extensions["script"] = saved_script(
                extensions["script"],
            )
        except CardScriptValidationError as error:
            raise CardDomainError(str(error)) from error
    if "subsystems" in extensions:
        try:
            extensions["subsystems"] = normalize_card_subsystems(extensions["subsystems"])
        except ValueError as error:
            raise CardDomainError(str(error)) from error
    stable = {
        "cardId": required_text(card.get("id"), "card_id"),
        "templateId": required_text(card.get("templateId"), "template_id"),
        "kind": str(card.get("kind") or "agent"),
        "title": required_text(card.get("title"), "card_title"),
        "subtitle": card.get("subtitle"),
        "role": card.get("role"),
        "parentGraphId": card.get("parentGraphId"),
        "basePrompt": str(card.get("prompt") or ""),
        "stableOutputContract": card.get("outputContract"),
        "runtime": runtime,
        "provider": provider,
        "modelKey": options.get("modelKey"),
        "providerModelId": options.get("providerModelId"),
        "accessMode": access_mode,
        "reasoningEffort": options.get("reasoningEffort"),
        "enabled": card.get("enabled", True) is not False,
        "enabledLocation": "card",
        "runtimeExtensions": extensions,
        "grants": grants,
        "presentationProperties": {
            key: value for key, value in card.items() if key not in KNOWN_CARD_FIELDS
        },
    }
    if stable["kind"] != "agent":
        raise CardDomainError("card_kind_unsupported")
    return stable

def validate_immutable_runtime_profile(
    previous: dict[str, Any],
    incoming: dict[str, Any],
) -> None:
    """Keep one saved Hermes Card permanently bound to its original profile."""
    previous_runtime = json_object(previous.get("runtime"), "runtime")
    if previous_runtime.get("kind") != "hermes":
        return
    incoming_runtime = json_object(incoming.get("runtime"), "runtime")
    if incoming_runtime.get("profile") != previous_runtime.get("profile"):
        raise CardDomainError("card_runtime_profile_immutable")

def subagent_model_selection(value: Any) -> dict[str, str] | None:
    """Validate the saved desired child-model selector without consulting availability.

    Stale Hermes selections remain durable and inspectable. Availability and
    credential resolution belong to the bound Hermes profile at Run start.
    """
    if value is None:
        return None
    if not isinstance(value, dict) or set(value) != SUBAGENT_MODEL_FIELDS:
        raise CardDomainError("card_subagent_model_invalid")
    normalized = {key: str(value.get(key) or "").strip() for key in SUBAGENT_MODEL_FIELDS}
    if any(not item or len(item) > 256 for item in normalized.values()):
        raise CardDomainError("card_subagent_model_invalid")
    if normalized["accessMode"] not in SUBAGENT_ACCESS_MODES:
        raise CardDomainError("card_subagent_model_access_mode_invalid")
    validate_saved_provider_selection(
        normalized["provider"], normalized["accessMode"]
    )
    return normalized

def subagent_type_selection(value: Any) -> CardSubagentType | None:
    """Validate an explicitly saved temporary-subagent topology choice.

    Missing remains missing so legacy Hermes Team profiles are not rewritten by
    an unrelated Card read or save.
    """
    if value is None:
        return None
    try:
        return TypeAdapter(CardSubagentType).validate_python(value)
    except ValidationError as error:
        raise CardDomainError("card_subagent_type_invalid") from error

def validate_new_card_revision(card: dict[str, Any]) -> None:
    """Validate a proposed revision while leaving old bad revisions readable."""

    options = json_object(card.get("runtimeOptions"), "runtime_options")
    runtime = card_runtime(card)
    is_hermes = runtime["kind"] == "hermes"
    validate_auto_runtime_options(options, runtime)
    validate_saved_hermes_runtime_authority(
        options.get("provider"),
        options.get("accessMode"),
        hermes=is_hermes,
    )
    model_key = str(options.get("modelKey") or "").strip()
    provider_model_id = str(
        options.get("providerModelId") or model_key
    ).strip()
    if not model_key or not provider_model_id:
        raise CardDomainError("card_model_selection_incomplete")
    reasoning_effort_selection(options.get("reasoningEffort"))
    subagent = options.get("subagentModel")
    if subagent is not None:
        if not is_hermes:
            raise CardDomainError("card_subagent_model_requires_hermes")
        subagent_model_selection(subagent)
    subagent_type = subagent_type_selection(options.get("subagentType"))
    if subagent_type is not None and not is_hermes:
        raise CardDomainError("card_subagent_type_requires_hermes")
    if "orchestrator" in options and not isinstance(options["orchestrator"], bool):
        raise CardDomainError("card_orchestrator_invalid")
    if options.get("orchestrator") is True and not is_hermes:
        raise CardDomainError("card_orchestrator_requires_hermes")
    if options.get("orchestrator") is True and is_magnetic_taskgraph_runtime(runtime):
        raise CardDomainError("card_orchestrator_requires_non_magnetic_hermes")
    configuration = options.get("configuration")
    if configuration is not None:
        if not isinstance(configuration, dict):
            raise CardDomainError("card_configuration_invalid")
        data_control = configuration.get("dataControl")
        if data_control is not None:
            if not isinstance(data_control, dict):
                raise CardDomainError("card_data_control_invalid")

def runtime_owner(card: dict[str, Any]) -> str:
    """Resolve one transport owner from the one explicit saved runtime union."""
    runtime = card_runtime(card)
    if is_magnetic_taskgraph_runtime(runtime):
        return "mag_one"
    return "hermes"

def card_is_enabled(card: dict[str, Any]) -> bool:
    return card.get("enabled") is not False
