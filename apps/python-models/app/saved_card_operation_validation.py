"""Shared validation for saved Card create and configuration operations."""

# Entity: Saved Cards
# Relationship: This file validates create and update inputs against the saved Card contract before any deck persistence occurs.
# Entity: Card Profiles
# Relationship: This file validates provider access mode, stable profile runtime, subagent type, subagent model, and reasoning selections used by Card profiles.
# Entity: Tool Catalog
# Relationship: This file normalizes exact capability lists and rejects saved tool selections that are not eligible in the canonical catalog.

from __future__ import annotations

from typing import Any

from app.application_tool_error import ApplicationToolError
from app.python_models.saved_card_contract import (
    CardDomainError,
    REASONING_EFFORTS,
    reasoning_effort_selection,
)


_CAPABILITY_LIST_FIELDS = {"tools", "skills", "toolsets", "mcpConnectionIds"}
_ACCESS_MODES = {"chatgpt-account", "openai-api", "openrouter-api"}
_SUBAGENT_TYPES = {"none", "leaf", "recursive"}
_SUBAGENT_MODEL_FIELDS = {
    "provider", "accessMode", "modelKey", "providerModelId",
}
_REASONING_EFFORTS = set(REASONING_EFFORTS)


def _find_saved_card(deck: dict[str, Any], card_id: str) -> dict[str, Any]:
    for node in deck.get("nodes") or []:
        if str(node.get("id") or "") == card_id:
            return node
    raise ApplicationToolError(f"card_not_found: {card_id}")


def _load_saved_deck(
    project_id: str, deck_id: str,
) -> tuple[dict[str, Any], str | None]:
    from app.python_models import saved_cards
    from app.python_models.saved_card_contract import CardDomainError

    try:
        loaded = saved_cards.load_deck(project_id, deck_id)
    except CardDomainError as error:
        raise ApplicationToolError(str(error)) from error
    deck = loaded.get("deck")
    meta = loaded.get("meta")
    if not isinstance(deck, dict) or not isinstance(meta, dict):
        raise ApplicationToolError("saved_deck_readback_invalid")
    revision = str(meta.get("deckRevision") or "").strip() or None
    return deck, revision


def _save_saved_deck(
    project_id: str,
    deck_id: str,
    deck: dict[str, Any],
    revision: str | None,
) -> dict[str, Any]:
    from app.python_models import saved_cards
    from app.python_models.saved_card_contract import CardDomainError

    try:
        saved = saved_cards.save_deck(project_id, deck_id, deck, revision)
    except CardDomainError as error:
        raise ApplicationToolError(str(error)) from error
    if not isinstance(saved.get("deck"), dict) or not isinstance(saved.get("meta"), dict):
        raise ApplicationToolError("saved_deck_write_readback_invalid")
    return {"ok": True, **saved}


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


def _reasoning_effort_selection(value: Any, *, operation: str) -> str:
    try:
        effort = reasoning_effort_selection(value)
    except CardDomainError as error:
        raise ApplicationToolError(f"{operation}_reasoning_effort_invalid") from error
    if not effort:
        raise ApplicationToolError(f"{operation}_reasoning_effort_invalid")
    return effort


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
    *, provider: Any, access_mode: Any, supported: bool,
) -> dict[str, Any]:
    from app.python_models.saved_card_contract import (
        CardDomainError,
        validate_saved_card_runtime_authority,
    )

    try:
        return validate_saved_card_runtime_authority(
            provider,
            access_mode,
            supported=supported,
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
                f"{operation}_{error_field}_requires_ordinary_card_runtime"
            )
