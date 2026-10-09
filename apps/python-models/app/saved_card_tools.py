"""Saved Card creation and exact-revision configuration tools."""

from __future__ import annotations

import asyncio
import math
import re
from typing import Any
from uuid import uuid4

from app.application_tool_error import ApplicationToolError
from app.saved_deck_http import find_saved_card, load_saved_deck, save_saved_deck


_SUPPORTED_CARD_RUNTIME_MODES = {"hermes": {"main", "delegate", "magentic_one"}}
_CARD_CREATE_KEYS = {
    "templateId", "projectId", "deckId", "expectedRevision", "title", "role",
    "prompt", "runtime", "model", "openaiRuntime", "subagentType",
    "subagentModel", "tools", "skills", "toolsets", "mcpConnectionIds",
    "autoTools", "autoModel", "position",
}
_CARD_CREATE_RUNTIME_KEYS = {"kind", "mode", "profile"}
_CARD_CREATE_MODEL_KEYS = {
    "provider", "modelKey", "accessMode", "providerModelId",
}
_UPDATABLE_TOP_FIELDS = {"prompt", "title"}
_UPDATABLE_RUNTIME_OPTION_FIELDS = {
    "script", "accessMode", "modelKey", "provider", "providerModelId",
    "openaiRuntime", "subagentType", "subagentModel", "tools", "skills",
    "toolsets", "mcpConnectionIds", "configuration", "subsystems",
    "autoTools", "autoModel",
}
_CAPABILITY_LIST_FIELDS = {"tools", "skills", "toolsets", "mcpConnectionIds"}
_ACCESS_MODES = {"chatgpt-account", "openai-api", "openrouter-api"}
_SUBAGENT_TYPES = {"none", "leaf", "recursive"}
_SUBAGENT_MODEL_FIELDS = {
    "provider", "accessMode", "modelKey", "providerModelId",
}
_DEFAULT_HERMES_SUBAGENT_MODEL = {
    "provider": "openai",
    "accessMode": "chatgpt-account",
    "modelKey": "gpt-5.6-luna",
    "providerModelId": "gpt-5.6-luna",
}
_AGENT_BUILDER_PROFILE = "builder"


def saved_card_operation_schema(name: str) -> dict[str, Any]:
    """Return the exact public schema for one saved-Card operation."""

    text = {"type": "string", "minLength": 1}
    names = {"type": "array", "items": text}
    identity = {key: text for key in ("projectId", "deckId")}
    model = {
        "type": "object",
        "additionalProperties": False,
        "properties": {key: text for key in sorted(_SUBAGENT_MODEL_FIELDS)},
        "required": sorted(_SUBAGENT_MODEL_FIELDS),
    }
    subagent = {
        **model,
        "properties": {key: text for key in sorted(_SUBAGENT_MODEL_FIELDS)},
    }
    if name == "card.create":
        properties = {
            **identity,
            **{
                key: text
                for key in (
                    "expectedRevision", "templateId", "title", "role", "prompt",
                )
            },
            "runtime": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    key: text for key in sorted(_CARD_CREATE_RUNTIME_KEYS)
                },
                "required": ["kind", "mode"],
            },
            "model": model,
            "subagentType": {"type": "string", "enum": sorted(_SUBAGENT_TYPES)},
            "subagentModel": subagent,
            "openaiRuntime": {
                "type": ["string", "null"],
                "enum": [None, "codex_app_server"],
            },
            "autoTools": {"type": "boolean"},
            "autoModel": {"type": "boolean"},
            **{key: names for key in sorted(_CAPABILITY_LIST_FIELDS)},
            "position": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    key: {"type": "number"} for key in ("x", "y")
                },
            },
        }
        required = [
            "projectId", "deckId", "expectedRevision", "templateId", "title",
            "role", "prompt", "runtime", "model",
        ]
    elif name == "card.update_configuration":
        fields = {
            **{key: {"type": "string"} for key in sorted(_UPDATABLE_TOP_FIELDS)},
            **{key: names for key in sorted(_CAPABILITY_LIST_FIELDS)},
            **{
                key: text
                for key in ("accessMode", "modelKey", "provider", "providerModelId")
            },
            "subagentModel": subagent,
            "subagentType": {"type": "string", "enum": sorted(_SUBAGENT_TYPES)},
            "openaiRuntime": {
                "type": ["string", "null"],
                "enum": [None, "codex_app_server"],
            },
            "autoTools": {"type": "boolean"},
            "autoModel": {"type": "boolean"},
            "configuration": {"type": "object"},
            "script": {"type": "object"},
            "subsystems": {"type": "array", "items": {"type": "object"}},
        }
        properties = {
            **identity,
            "cardId": text,
            "expectedRevision": text,
            "expectedCardRevisionId": text,
            "updates": {
                "type": "object",
                "properties": fields,
                "minProperties": 1,
                "additionalProperties": False,
            },
        }
        required = [
            "projectId", "deckId", "cardId", "expectedRevision",
            "expectedCardRevisionId", "updates",
        ]
    else:
        raise ApplicationToolError("saved_card_operation_unknown")
    return {
        "type": "object",
        "properties": properties,
        "required": required,
        "additionalProperties": False,
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


async def card_create(
    args: dict[str, Any], *, caller_card_id: str = "",
) -> dict[str, Any]:
    """Create one saved Card through the canonical optimistic deck authority."""

    _require(
        args, "projectId", "deckId", "expectedRevision", "title", "role", "prompt",
    )
    unknown = sorted(set(args) - _CARD_CREATE_KEYS)
    if unknown:
        raise ApplicationToolError(f"card_create_fields_rejected:{','.join(unknown)}")
    template_id = args.get("templateId", "template_assist")
    if not isinstance(template_id, str) or not template_id.strip():
        raise ApplicationToolError("card_create_template_invalid")

    title = str(args["title"]).strip()
    role = str(args["role"]).strip()
    prompt = str(args["prompt"]).strip()
    runtime = args.get("runtime")
    if not isinstance(runtime, dict):
        raise ApplicationToolError("card_create_runtime_required")
    unknown_runtime = sorted(set(runtime) - _CARD_CREATE_RUNTIME_KEYS)
    if unknown_runtime:
        raise ApplicationToolError(
            f"card_create_runtime_fields_rejected:{','.join(unknown_runtime)}"
        )
    runtime_kind = str(runtime.get("kind") or "").strip()
    runtime_mode = str(runtime.get("mode") or "").strip()
    if runtime_mode not in _SUPPORTED_CARD_RUNTIME_MODES.get(runtime_kind, set()):
        raise ApplicationToolError("card_create_runtime_invalid")
    runtime_profile = str(runtime.get("profile") or "").strip()
    if runtime_kind != "hermes" and runtime_profile:
        raise ApplicationToolError("card_create_runtime_profile_unsupported")
    if runtime_kind == "hermes" and not runtime_profile:
        raise ApplicationToolError("card_create_profile_required")
    if runtime_kind == "hermes" and (
        not re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,63}", runtime_profile)
        or runtime_profile in {"hermes", "test", "tmp", "root", "sudo"}
    ):
        raise ApplicationToolError("card_create_profile_invalid")
    _validate_auto_flags(
        args, operation="card_create", runtime_mode=runtime_mode,
    )

    model = args.get("model")
    if not isinstance(model, dict):
        raise ApplicationToolError("card_create_model_required")
    unknown_model = sorted(set(model) - _CARD_CREATE_MODEL_KEYS)
    if unknown_model:
        raise ApplicationToolError(
            f"card_create_model_fields_rejected:{','.join(unknown_model)}"
        )
    provider = str(model.get("provider") or "").strip()
    model_key = str(model.get("modelKey") or "").strip()
    access_mode = str(model.get("accessMode") or "").strip()
    if not provider or not model_key or not access_mode:
        raise ApplicationToolError("card_create_model_configuration_required")
    authority = _validate_card_runtime_authority(
        provider=provider,
        access_mode=access_mode,
        openai_runtime=args.get("openaiRuntime"),
        hermes=runtime_kind == "hermes",
    )
    provider = authority["provider"]
    access_mode = authority["accessMode"]
    raw_subagent_model = args.get("subagentModel")
    if runtime_kind != "hermes" and raw_subagent_model is not None:
        raise ApplicationToolError("card_create_subagent_model_requires_hermes")
    subagent_model = (
        _subagent_model_selection(raw_subagent_model)
        if raw_subagent_model is not None
        else dict(_DEFAULT_HERMES_SUBAGENT_MODEL) if runtime_kind == "hermes"
        else None
    )
    raw_subagent_type = args.get(
        "subagentType", "none" if runtime_kind == "hermes" else None
    )
    if raw_subagent_type is not None and runtime_kind != "hermes":
        raise ApplicationToolError("card_create_subagent_type_requires_hermes")
    if raw_subagent_type is not None and raw_subagent_type not in _SUBAGENT_TYPES:
        raise ApplicationToolError("card_create_subagent_type_invalid")
    normalized_selections = _normalized_capability_selections(
        args, _CAPABILITY_LIST_FIELDS,
        operation="card_create", missing_as_empty=True,
    )
    _validate_tool_selections(
        normalized_selections["tools"], operation="card_create"
    )

    position = args.get("position") or {"x": 0, "y": 0}
    if not isinstance(position, dict) or set(position) - {"x", "y"}:
        raise ApplicationToolError("card_create_position_invalid")
    if not all(
        isinstance(position.get(axis, 0), (int, float))
        and not isinstance(position.get(axis, 0), bool)
        and math.isfinite(float(position.get(axis, 0)))
        for axis in ("x", "y")
    ):
        raise ApplicationToolError("card_create_position_invalid")

    project_id = str(args["projectId"]).strip()
    deck_id = str(args["deckId"]).strip()
    expected_revision = str(args["expectedRevision"]).strip()

    def apply() -> dict[str, Any]:
        deck, current_revision = load_saved_deck(project_id, deck_id)
        try:
            caller = find_saved_card(deck, caller_card_id)
        except ApplicationToolError as error:
            raise ApplicationToolError("card_create_requires_agent_builder") from error
        caller_runtime = caller.get("runtime") or {}
        if (
            caller_runtime.get("kind") != "hermes"
            or caller_runtime.get("mode") != "delegate"
            or str(caller_runtime.get("profile") or "").strip()
            != _AGENT_BUILDER_PROFILE
        ):
            raise ApplicationToolError("card_create_requires_agent_builder")
        if "card.create" not in (caller.get("runtimeOptions") or {}).get("tools", []):
            raise ApplicationToolError("card_create_not_granted")
        from app.python_models.idd import (
            load_input_data_dictionary,
            template_runtime,
        )

        dictionary = load_input_data_dictionary()
        if template_id not in dictionary["templates"]:
            raise ApplicationToolError("card_create_template_unavailable")
        expected_runtime = template_runtime(dictionary, template_id)
        if any(
            runtime.get(key) != expected_runtime.get(key)
            for key in ("kind", "mode")
        ):
            raise ApplicationToolError("card_create_template_runtime_mismatch")
        if current_revision != expected_revision:
            raise ApplicationToolError("deck_conflict")
        if any(
            str(node.get("title") or "").strip().casefold() == title.casefold()
            for node in deck.get("nodes") or []
        ):
            raise ApplicationToolError("card_title_conflict")

        card_id = f"card_{uuid4().hex[:16]}"
        saved_runtime = {"kind": runtime_kind, "mode": runtime_mode}
        if runtime_kind == "hermes":
            saved_runtime["profile"] = runtime_profile
        runtime_options: dict[str, Any] = {
            "provider": provider,
            "modelKey": model_key,
            "accessMode": access_mode,
            **normalized_selections,
        }
        for field in ("autoTools", "autoModel"):
            if field in args:
                runtime_options[field] = args[field]
        if runtime_kind == "hermes" and authority.get("openaiRuntime") is not None:
            runtime_options["openaiRuntime"] = authority["openaiRuntime"]
        if subagent_model is not None:
            runtime_options["subagentModel"] = subagent_model
        if raw_subagent_type is not None:
            runtime_options["subagentType"] = raw_subagent_type
        if model.get("providerModelId") is not None:
            runtime_options["providerModelId"] = model["providerModelId"]
        card = {
            "id": card_id,
            "kind": "agent",
            "title": title,
            "role": role,
            "prompt": prompt,
            "position": {
                "x": float(position.get("x", 0)),
                "y": float(position.get("y", 0)),
            },
            "subtitle": role,
            "templateId": template_id,
            "runtime": saved_runtime,
            "parentGraphId": None,
            "runtimeOptions": runtime_options,
        }
        deck["nodes"] = [*(deck.get("nodes") or []), card]
        saved = save_saved_deck(
            project_id, deck_id, deck, expected_revision
        )
        saved_deck = saved.get("deck") if isinstance(saved.get("deck"), dict) else {}
        saved_card = find_saved_card(saved_deck, card_id)
        saved_revision = str((saved.get("meta") or {}).get("deckRevision") or "")
        if not saved_revision:
            raise ApplicationToolError("card_create_revision_missing")
        return {
            "ok": True,
            "projectId": project_id,
            "deckId": deck_id,
            "cardId": card_id,
            "deckRevision": saved_revision,
            "card": saved_card,
            "created": True,
            "started": False,
        }

    return await asyncio.to_thread(apply)


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
