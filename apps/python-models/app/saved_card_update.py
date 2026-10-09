"""Exact-revision saved Card configuration updates."""

from __future__ import annotations

import asyncio
from typing import Any

from app.application_tool_error import ApplicationToolError
from app.saved_card_operation_validation import (
    _ACCESS_MODES,
    _CAPABILITY_LIST_FIELDS,
    _SUBAGENT_TYPES,
    _normalized_capability_selections,
    _require,
    _subagent_model_selection,
    _validate_auto_flags,
    _validate_card_runtime_authority,
    _validate_tool_selections,
)
from app.saved_deck_http import find_saved_card, load_saved_deck, save_saved_deck


_UPDATABLE_TOP_FIELDS = {"prompt", "title"}
_UPDATABLE_RUNTIME_OPTION_FIELDS = {
    "script", "accessMode", "modelKey", "provider", "providerModelId",
    "openaiRuntime", "subagentType", "subagentModel", "tools", "skills",
    "toolsets", "mcpConnectionIds", "configuration", "subsystems",
    "autoTools", "autoModel",
}
_AGENT_BUILDER_PROFILE = "builder"


async def card_update_configuration(
    args: dict[str, Any],
    *,
    caller_card_id: str = "",
    authenticated_user_edit: bool = False,
) -> dict[str, Any]:
    """Update one exact Card revision through the saved-deck authority."""

    _require(args, "projectId", "deckId", "cardId")
    updates = args.get("updates")
    if not isinstance(updates, dict) or not updates:
        raise ApplicationToolError("updates_object_required")
    if not authenticated_user_edit:
        _require(args, "expectedRevision", "expectedCardRevisionId")
    unknown = [
        key for key in updates
        if key not in _UPDATABLE_TOP_FIELDS
        and key not in _UPDATABLE_RUNTIME_OPTION_FIELDS
    ]
    if unknown:
        raise ApplicationToolError(
            f"card_update_fields_rejected: {','.join(sorted(unknown))} "
            f"(allowed: {','.join(sorted(_UPDATABLE_TOP_FIELDS | _UPDATABLE_RUNTIME_OPTION_FIELDS))})"
        )
    normalized_updates = _normalized_capability_selections(
        updates, _CAPABILITY_LIST_FIELDS & set(updates),
        operation="card_update", missing_as_empty=False,
    )
    for field, values in normalized_updates.items():
        updates = {
            **updates,
            field: values,
        }
    if "tools" in updates:
        _validate_tool_selections(updates["tools"], operation="card_update")
    if "configuration" in updates and not isinstance(updates["configuration"], dict):
        raise ApplicationToolError("card_update_configuration_invalid")
    _validate_auto_flags(updates, operation="card_update")
    if "subsystems" in updates:
        from app.python_models.card_subsystem import normalize_card_subsystems

        try:
            updates = {
                **updates,
                "subsystems": normalize_card_subsystems(updates["subsystems"]),
            }
        except ValueError as error:
            raise ApplicationToolError(str(error)) from error
    if "script" in updates:
        from app.python_models.card_script import (
            CardScriptValidationError,
            saved_script,
        )

        if not isinstance(updates["script"], dict):
            raise ApplicationToolError("card_script_configuration_invalid")
        try:
            updates = {
                **updates,
                "script": saved_script(
                    {
                        **updates["script"],
                        "author": {
                            "kind": (
                                "user" if authenticated_user_edit else "agent-builder"
                            ),
                            "id": caller_card_id,
                        },
                    },
                ),
            }
        except CardScriptValidationError as error:
            raise ApplicationToolError(str(error)) from error
    if "accessMode" in updates and updates["accessMode"] not in _ACCESS_MODES:
        raise ApplicationToolError("card_update_access_mode_invalid")
    if (
        "providerModelId" in updates
        and not str(updates["providerModelId"] or "").strip()
    ):
        raise ApplicationToolError("card_update_provider_model_id_required")
    if "subagentModel" in updates:
        updates = {
            **updates,
            "subagentModel": _subagent_model_selection(updates["subagentModel"]),
        }
    if "subagentType" in updates and updates["subagentType"] not in _SUBAGENT_TYPES:
        raise ApplicationToolError("card_update_subagent_type_invalid")

    project_id = str(args["projectId"]).strip()
    deck_id = str(args["deckId"]).strip()
    card_id = str(args["cardId"]).strip()

    def apply() -> dict[str, Any]:
        deck, revision = load_saved_deck(project_id, deck_id)
        card = find_saved_card(deck, card_id)
        if not authenticated_user_edit:
            try:
                caller = find_saved_card(deck, caller_card_id)
            except ApplicationToolError as error:
                raise ApplicationToolError(
                    "card_update_requires_agent_builder"
                ) from error
            caller_runtime = caller.get("runtime") or {}
            if (
                caller_runtime.get("kind") != "hermes"
                or caller_runtime.get("mode") != "delegate"
                or str(caller_runtime.get("profile") or "").strip()
                != _AGENT_BUILDER_PROFILE
            ):
                raise ApplicationToolError("card_update_requires_agent_builder")
            if "card.update_configuration" not in (
                caller.get("runtimeOptions") or {}
            ).get("tools", []):
                raise ApplicationToolError("card_update_not_granted")
            if card_id == caller_card_id:
                raise ApplicationToolError("card_update_self_forbidden")
            if (card.get("runtime") or {}).get("mode") == "main":
                raise ApplicationToolError("card_update_main_forbidden")
        if (
            args.get("expectedRevision") is not None
            and args["expectedRevision"] != revision
        ):
            raise ApplicationToolError("deck_conflict")
        if (
            args.get("expectedCardRevisionId") is not None
            and args["expectedCardRevisionId"] != card.get("_cardRevisionId")
        ):
            raise ApplicationToolError("card_revision_conflict")
        if (
            "subagentModel" in updates
            and (card.get("runtime") or {}).get("kind") != "hermes"
        ):
            raise ApplicationToolError("card_update_subagent_model_requires_hermes")
        if (
            "subagentType" in updates
            and (card.get("runtime") or {}).get("kind") != "hermes"
        ):
            raise ApplicationToolError("card_update_subagent_type_requires_hermes")
        current_options = card.get("runtimeOptions")
        if not isinstance(current_options, dict):
            current_options = {}
        if {"autoTools", "autoModel"}.intersection(updates):
            from app.python_models.saved_card_contract import (
                CardDomainError,
                validate_auto_runtime_options,
                card_runtime,
            )

            try:
                validate_auto_runtime_options(
                    {**current_options, **{
                        key: updates[key]
                        for key in ("autoTools", "autoModel")
                        if key in updates
                    }},
                    card_runtime(card),
                )
            except CardDomainError as error:
                raise ApplicationToolError(str(error)) from error
        if {"provider", "accessMode", "openaiRuntime"}.intersection(updates):
            _validate_card_runtime_authority(
                provider=updates.get(
                    "provider", current_options.get("provider") or card.get("provider")
                ),
                access_mode=updates.get(
                    "accessMode", current_options.get("accessMode")
                ),
                openai_runtime=updates.get(
                    "openaiRuntime", current_options.get("openaiRuntime")
                ),
                hermes=(card.get("runtime") or {}).get("kind") == "hermes",
            )
        for key in _UPDATABLE_TOP_FIELDS:
            if key in updates:
                card[key] = str(updates[key])
        runtime_option_updates = {
            key: value
            for key, value in updates.items()
            if key in _UPDATABLE_RUNTIME_OPTION_FIELDS
        }
        if runtime_option_updates:
            options = card.get("runtimeOptions")
            if not isinstance(options, dict):
                options = {}
            options.update(runtime_option_updates)
            card["runtimeOptions"] = options
        saved = save_saved_deck(project_id, deck_id, deck, revision)
        saved_card = find_saved_card(saved.get("deck") or {}, card_id)
        return {
            "ok": True,
            "cardId": card_id,
            "targetCardRevisionId": saved_card.get("_cardRevisionId"),
            "deckRevision": (saved.get("meta") or {}).get("deckRevision"),
            "appliedFields": sorted(updates.keys()),
            "card": saved_card,
        }

    return await asyncio.to_thread(apply)
