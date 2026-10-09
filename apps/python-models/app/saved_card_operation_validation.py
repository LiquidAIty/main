"""Shared validation for saved Card create and configuration operations."""

from __future__ import annotations

from typing import Any

from app.application_tool_error import ApplicationToolError


_CAPABILITY_LIST_FIELDS = {"tools", "skills", "toolsets", "mcpConnectionIds"}
_ACCESS_MODES = {"chatgpt-account", "openai-api", "openrouter-api"}
_SUBAGENT_TYPES = {"none", "leaf", "recursive"}
_SUBAGENT_MODEL_FIELDS = {
    "provider", "accessMode", "modelKey", "providerModelId",
}


def _require(arguments: dict[str, Any], *keys: str) -> None:
    for key in keys:
        if not str(arguments.get(key) or "").strip():
            raise ApplicationToolError(f"{key}_required")


def _subagent_model_selection(value: Any) -> dict[str, str]:
    if not isinstance(value, dict) or set(value) != _SUBAGENT_MODEL_FIELDS:
        raise ApplicationToolError("card_subagent_model_invalid")
    normalized = {
        key: str(value.get(key) or "").strip()
        for key in _SUBAGENT_MODEL_FIELDS
    }
    if any(not item or len(item) > 256 for item in normalized.values()):
        raise ApplicationToolError("card_subagent_model_invalid")
    if normalized["accessMode"] not in _ACCESS_MODES:
        raise ApplicationToolError("card_subagent_model_access_mode_invalid")
    _validate_card_provider_selection(
        normalized["provider"], normalized["accessMode"]
    )
    return normalized


def _validate_card_provider_selection(
    provider: Any, access_mode: Any,
) -> tuple[str, str]:
    from app.python_models.saved_card_contract import (
        CardDomainError,
        validate_saved_provider_selection,
    )

    try:
        return validate_saved_provider_selection(provider, access_mode)
    except CardDomainError as error:
        raise ApplicationToolError(str(error)) from error


def _validate_card_runtime_authority(
    *, provider: Any, access_mode: Any, openai_runtime: Any, hermes: bool,
) -> dict[str, Any]:
    from app.python_models.saved_card_contract import (
        CardDomainError,
        validate_saved_hermes_runtime_authority,
    )

    try:
        return validate_saved_hermes_runtime_authority(
            provider,
            access_mode,
            openai_runtime,
            hermes=hermes,
        )
    except CardDomainError as error:
        raise ApplicationToolError(str(error)) from error


def _validate_tool_selections(tool_ids: list[str], *, operation: str) -> None:
    from app.python_models.tool_registry import card_tool_selection_is_eligible

    invalid = [
        tool_id
        for tool_id in tool_ids
        if not card_tool_selection_is_eligible(tool_id)
    ]
    if invalid:
        raise ApplicationToolError(f"{operation}_tool_unavailable:{invalid[0]}")


def _normalized_capability_selections(
    source: dict[str, Any],
    fields: set[str],
    *,
    operation: str,
    missing_as_empty: bool,
) -> dict[str, list[str]]:
    normalized: dict[str, list[str]] = {}
    for field in fields:
        values = source.get(field) or [] if missing_as_empty else source[field]
        if (
            not isinstance(values, list)
            or any(not isinstance(item, str) or not item.strip() for item in values)
        ):
            raise ApplicationToolError(f"{operation}_{field}_must_be_string_list")
        normalized[field] = list(dict.fromkeys(item.strip() for item in values))
    return normalized


def _validate_auto_flags(
    source: dict[str, Any],
    *,
    operation: str,
    runtime_mode: str | None = None,
) -> None:
    for field, error_field in (
        ("autoTools", "auto_tools"),
        ("autoModel", "auto_model"),
    ):
        if field in source and not isinstance(source[field], bool):
            raise ApplicationToolError(f"{operation}_{error_field}_invalid")
        if field in source and runtime_mode == "magentic_one":
            raise ApplicationToolError(
                f"{operation}_{error_field}_requires_non_magnetic_hermes"
            )
