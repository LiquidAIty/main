"""Saved Card creation through the canonical optimistic deck authority."""

from __future__ import annotations

import asyncio
import math
import re
from typing import Any
from uuid import uuid4

from app.application_tool_error import ApplicationToolError
from app.saved_card_operation_validation import (
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
_DEFAULT_HERMES_SUBAGENT_MODEL = {
    "provider": "openai",
    "accessMode": "chatgpt-account",
    "modelKey": "gpt-5.6-luna",
    "providerModelId": "gpt-5.6-luna",
}
_AGENT_BUILDER_PROFILE = "builder"


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
