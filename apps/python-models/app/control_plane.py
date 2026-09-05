"""Harness control-plane capability handlers (Python-owned).

The minimum user-directed MCP control surface over ACTUAL saved state:

  * agentgraph.inspect         — bounded current Card/AGE authority and telemetry
  * canvas.inspect             — bounded saved deck view
  * card.create                — strict optimistic creation in the saved deck
  * card.update_configuration  — strict allowlist edits of persisted card config
  * canvas.upsert_wire         — flow / magentic_option / magentic_control
  * card.run_assistant_agent   — run ONE saved enabled card (no overrides possible)

Policy/validation lives HERE (Python). Saved-deck persistence stays with the
existing backend deck routes on loopback (single deck authority — not replaced).
No Task Ledger, no Mag One worker selection, no graph write authority is exposed.
Failures are honest; there is no fallback path.
"""

from __future__ import annotations

import asyncio
import json
import math
import os
from typing import Any
from uuid import uuid4
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

_BACKEND = os.environ.get("MAIN_BACKEND_URL", "http://127.0.0.1:4000").rstrip("/")

SUPPORTED_WIRE_TYPES = ("flow", "magentic_option", "magentic_control")
_SUPPORTED_CARD_RUNTIME_MODES = {
    "hermes": {"main", "delegate"},
    "autogen": {"assistant", "magentic_one"},
}
_CARD_CREATE_KEYS = {
    "templateId",
    "projectId",
    "deckId",
    "expectedRevision",
    "title",
    "role",
    "prompt",
    "runtime",
    "model",
    "subagentModel",
    "team",
    "tools",
    "nativeTools",
    "skills",
    "toolsets",
    "mcpConnectionIds",
    "position",
}
_CARD_CREATE_RUNTIME_KEYS = {"kind", "mode", "profile"}
_CARD_CREATE_MODEL_KEYS = {
    "provider",
    "modelKey",
    "accessMode",
    "providerModelId",
    "reasoningEffort",
}
# Exact allowlist of Card fields Agent Builder may edit. Native selections stay
# saved as selections; current native availability is checked by the runtime.
_UPDATABLE_TOP_FIELDS = {"prompt", "title"}
_UPDATABLE_RUNTIME_OPTION_FIELDS = {
    "script",
    "accessMode",
    "modelKey",
    "provider",
    "providerModelId",
    "subagentModel",
    "team",
    "reasoningEffort",
    "temperature",
    "maxTokens",
    "tools",
    "nativeTools",
    "skills",
    "toolsets",
    "mcpConnectionIds",
    "configuration",
    "subsystems",
}
_CAPABILITY_LIST_FIELDS = {
    "tools", "nativeTools", "skills", "toolsets", "mcpConnectionIds",
}
_REASONING_EFFORTS = {"low", "medium", "high", "xhigh"}
_ACCESS_MODES = {"chatgpt-account", "openai-api", "openrouter-api"}
_SUBAGENT_MODEL_FIELDS = {
    "provider", "accessMode", "modelKey", "providerModelId",
}
_TEAM_CONFIG_FIELDS = {
    "mode", "maxWorkers", "retryLimit", "workerModel", "leadModel",
}
_DEFAULT_HERMES_SUBAGENT_MODEL = {
    "provider": "openai",
    "accessMode": "chatgpt-account",
    "modelKey": "gpt-5.6-luna",
    "providerModelId": "gpt-5.6-luna",
}
_AGENT_BUILDER_PROFILE = "liquidaity-agent-builder"
_AGENT_BUILDER_EDIT_FIELDS = frozenset({
    "configuration", "prompt", "script", "subsystems", "tools",
})
_AGENT_BUILDER_REQUIRED_EDIT_FIELDS = frozenset({"prompt", "tools"})
_AGENT_BUILDER_CREATE_FIELDS = frozenset({
    "templateId", "title", "role", "prompt", "runtime", "model", "tools",
})
_AGENT_BUILDER_CREATE_RUNTIME = {"kind": "autogen", "mode": "assistant"}
_SYSTEM_TEMPLATE_IDS = frozenset({
    "template_main_chat", "template_local_coder", "template_agent_builder",
    "template_hermes_steward", "template_magentic",
})


class ControlPlaneError(Exception):
    pass


def _subagent_model_selection(value: Any) -> dict[str, str]:
    if not isinstance(value, dict) or set(value) != _SUBAGENT_MODEL_FIELDS:
        raise ControlPlaneError("card_subagent_model_invalid")
    normalized = {
        key: str(value.get(key) or "").strip()
        for key in _SUBAGENT_MODEL_FIELDS
    }
    if any(not item or len(item) > 256 for item in normalized.values()):
        raise ControlPlaneError("card_subagent_model_invalid")
    if normalized["accessMode"] not in _ACCESS_MODES:
        raise ControlPlaneError("card_subagent_model_access_mode_invalid")
    return normalized


def _team_config(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != _TEAM_CONFIG_FIELDS:
        raise ControlPlaneError("card_team_config_invalid")
    mode = str(value.get("mode") or "").strip()
    max_workers = value.get("maxWorkers")
    retry_limit = value.get("retryLimit")
    if (
        mode not in {"off", "auto"}
        or isinstance(max_workers, bool)
        or max_workers not in {2, 3, 4}
        or isinstance(retry_limit, bool)
        or not isinstance(retry_limit, int)
        or not 0 <= retry_limit <= 4
    ):
        raise ControlPlaneError("card_team_config_invalid")
    return {
        "mode": mode,
        "maxWorkers": max_workers,
        "retryLimit": retry_limit,
        **{
            key: _subagent_model_selection(value.get(key))
            for key in ("workerModel", "leadModel")
        },
    }


def _backend_json(method: str, path: str, payload: dict | None = None) -> dict[str, Any]:
    request = Request(
        f"{_BACKEND}{path}",
        data=json.dumps(payload).encode("utf-8") if payload is not None else None,
        headers={"Content-Type": "application/json"},
        method=method,
    )
    try:
        with urlopen(request, timeout=300) as response:  # noqa: S310 — loopback backend only
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as err:
        try:
            body = err.read().decode("utf-8")
            return json.loads(body)
        except Exception:
            raise ControlPlaneError(f"backend_http_{err.code}: {path}") from err
    except URLError as err:
        raise ControlPlaneError(f"backend_unreachable: {err.reason}") from err


def _require(args: dict, *keys: str) -> None:
    for key in keys:
        if not str(args.get(key) or "").strip():
            raise ControlPlaneError(f"{key}_required")


def _load_deck(project_id: str, deck_id: str) -> tuple[dict[str, Any], str | None]:
    result = _backend_json("GET", f"/api/projects/{project_id}/decks/{deck_id}")
    deck = result.get("deck")
    if not result.get("ok") or not isinstance(deck, dict):
        raise ControlPlaneError(f"deck_not_found: {project_id}/{deck_id}")
    revision = (result.get("meta") or {}).get("deckRevision")
    return deck, revision


def _save_deck(project_id: str, deck_id: str, deck: dict, revision: str | None) -> dict[str, Any]:
    result = _backend_json(
        "PUT",
        f"/api/projects/{project_id}/decks/{deck_id}",
        {"document": deck, "expectedRevision": revision},
    )
    if not result.get("ok"):
        raise ControlPlaneError(f"deck_save_failed: {result.get('error') or 'unknown'}")
    return result


def _find_card(deck: dict, card_id: str) -> dict[str, Any]:
    for node in deck.get("nodes") or []:
        if str(node.get("id") or "") == card_id:
            return node
    raise ControlPlaneError(f"card_not_found: {card_id}")


def resolve_saved_card_reference(
    project_id: str,
    deck_id: str,
    card_id: str,
    *,
    deck: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Resolve compact run configuration by saved card identity.

    Prompt text and configuration payloads stay in the saved deck; AgentGraph
    carries the stable card identity used for the run.
    """
    if deck is None:
        deck, _revision = _load_deck(project_id, deck_id)
    card = _find_card(deck, card_id)
    runtime_options = (
        card.get("runtimeOptions")
        if isinstance(card.get("runtimeOptions"), dict)
        else {}
    )
    runtime = card.get("runtime") if isinstance(card.get("runtime"), dict) else {}
    role = str(card.get("role") or runtime_options.get("role") or "").strip()
    return {
        "cardId": card_id,
        "title": str(card.get("title") or ""),
        "role": role,
        "runtime": runtime,
        "provider": str(runtime_options.get("provider") or card.get("provider") or ""),
        "modelKey": str(runtime_options.get("modelKey") or ""),
        "providerModelId": str(
            runtime_options.get("providerModelId")
            or card.get("providerModelId")
            or ""
        ),
        "tools": [
            str(value)
            for value in (runtime_options.get("tools") or card.get("tools") or [])
            if str(value).strip()
        ],
    }


# ---------------------------------------------------------------------------
# agentgraph.inspect
# ---------------------------------------------------------------------------


async def agentgraph_inspect(args: dict[str, Any]) -> dict[str, Any]:
    _require(args, "projectId", "deckId")
    from app.python_models.card_domain import CardDomainError, inspect_agentgraph

    try:
        return await asyncio.to_thread(inspect_agentgraph, args)
    except CardDomainError as error:
        raise ControlPlaneError(str(error)) from error


# ---------------------------------------------------------------------------
# canvas.inspect
# ---------------------------------------------------------------------------


async def canvas_inspect(args: dict[str, Any]) -> dict[str, Any]:
    _require(args, "projectId", "deckId")
    from app.python_models.tool_registry import readable_tool_ids, tool_access, writable_tool_ids, tool_publication

    project_id = str(args["projectId"]).strip()
    deck_id = str(args["deckId"]).strip()
    deck, revision = await asyncio.to_thread(_load_deck, project_id, deck_id)

    cards = []
    for node in deck.get("nodes") or []:
        configured_tools = [
            str(value).strip()
            for value in (
                ((node.get("runtimeOptions") or {}).get("tools"))
                or node.get("tools")
                or []
            )
            if str(value).strip()
        ]
        saved_writes = [name for name in configured_tools if tool_access(name) == "write"]
        cards.append({
            "id": str(node.get("id") or ""),
            "title": str(node.get("title") or ""),
            "runtime": node.get("runtime"),
            "tools": [name for name in configured_tools
                      if tool_publication(name) != "private-admin" and tool_access(name) is not None],
            "savedWriteTools": saved_writes,
            "unavailableConfiguredTools": [name for name in configured_tools
                                           if tool_publication(name) == "private-admin"],
            "legacyReadableSelections": [
                name for name in configured_tools if tool_access(name) == "read"
            ],
            "unknownConfiguredTools": [
                name for name in configured_tools if tool_access(name) is None
            ],
        })
    wires = [
        {
            **edge,
            "id": str(edge.get("id") or ""),
            "source": str(edge.get("source") or ""),
            "target": str(edge.get("target") or ""),
            "edgeType": str(edge.get("edgeType") or "flow"),
        }
        for edge in deck.get("edges") or []
    ]
    return {
        "ok": True,
        "projectId": project_id,
        "deckId": deck_id,
        "deckRevision": revision,
        # Public catalog visibility grants nothing to an ordinary saved Card.
        "effectiveReadTools": [],
        "cards": cards,
        "wires": wires,
    }


def _configured_card_tools(card: dict[str, Any]) -> list[str]:
    options = card.get("runtimeOptions")
    values = options.get("tools") if isinstance(options, dict) else card.get("tools")
    return [str(value).strip() for value in values or [] if str(value).strip()]


async def write_mag_one_instructions(args: dict[str, Any]) -> dict[str, Any]:
    """Stage Card-editor mission/graph review state; never materialize or run."""
    _require(
        args,
        "projectId",
        "deckId",
        "targetCardId",
        "mission",
        "_sourceCardId",
    )
    from app.python_models.card_domain import (
        CardDomainError,
        prepare_card_review_context,
    )

    project_id = str(args["projectId"]).strip()
    deck_id = str(args["deckId"]).strip()
    source_card_id = str(args["_sourceCardId"]).strip()
    target_card_id = str(args["targetCardId"]).strip()
    mission = str(args["mission"]).strip()
    deck, _revision = await asyncio.to_thread(_load_deck, project_id, deck_id)
    source = _find_card(deck, source_card_id)
    if "write_mag_one_instructions" not in _configured_card_tools(source):
        raise ControlPlaneError("write_mag_one_instructions_not_granted")
    source_runtime = source.get("runtime")
    if not isinstance(source_runtime, dict) or (
        source_runtime.get("kind"), source_runtime.get("mode")
    ) != ("hermes", "delegate"):
        raise ControlPlaneError("grounded_staging_source_must_be_hermes_delegate")
    target = _find_card(deck, target_card_id)
    target_runtime = target.get("runtime")
    if not isinstance(target_runtime, dict) or (
        target_runtime.get("kind"), target_runtime.get("mode")
    ) not in {("hermes", "delegate"), ("autogen", "magentic_one")}:
        raise ControlPlaneError("grounded_staging_target_runtime_invalid")
    raw_anchors = args.get("dataAnchors") or []
    if not isinstance(raw_anchors, list):
        raise ControlPlaneError("data_anchors_must_be_array")
    data_anchors = [
        {**anchor, "required": True}
        if isinstance(anchor, dict)
        else anchor
        for anchor in raw_anchors
    ]
    request = {
        "projectId": project_id,
        "deckId": deck_id,
        "cardId": target_card_id,
        "assignment": mission,
        "dataAnchors": data_anchors,
    }
    try:
        review_context = await asyncio.to_thread(prepare_card_review_context, request)
    except CardDomainError as error:
        raise ControlPlaneError(str(error)) from error
    return {
        "ok": True,
        "ready": True,
        "projectId": review_context["projectId"],
        "deckId": deck_id,
        "targetCardId": target_card_id,
        "targetCardTitle": str(target.get("title") or target_card_id),
        "mission": mission,
        "dataAnchors": data_anchors,
        "reviewContext": review_context,
        "sourceCardId": source_card_id,
        "persisted": False,
        "started": False,
    }


async def card_load_graph_references(args: dict[str, Any]) -> dict[str, Any]:
    """Load one bounded native reference into transient target-Card context."""
    from app.python_models.card_domain import CardDomainError, load_card_graph_reference

    try:
        return await asyncio.to_thread(load_card_graph_reference, args)
    except CardDomainError as error:
        raise ControlPlaneError(str(error)) from error


# ---------------------------------------------------------------------------
# card.create
# ---------------------------------------------------------------------------


async def card_create(
    args: dict[str, Any], *, caller_card_id: str = "",
    builder_operation: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Create one saved Card through the canonical optimistic deck authority."""
    _require(
        args,
        "projectId",
        "deckId",
        "expectedRevision",
        "title",
        "role",
        "prompt",
    )
    unknown = sorted(set(args) - _CARD_CREATE_KEYS)
    if unknown:
        raise ControlPlaneError(f"card_create_fields_rejected:{','.join(unknown)}")
    # Builder templates construct Cards; persistence retains their reference, not
    # a live dictionary dependency. A removed template must not invalidate a Card.
    template_id = args.get("templateId", "template_assist")
    if not isinstance(template_id, str) or not template_id.strip():
        raise ControlPlaneError("card_create_template_invalid")

    title = str(args["title"]).strip()
    if title.casefold() == "assist 1":
        raise ControlPlaneError("card_create_default_title_rejected")
    role = str(args["role"]).strip()
    prompt = str(args["prompt"]).strip()

    runtime = args.get("runtime")
    if not isinstance(runtime, dict):
        raise ControlPlaneError("card_create_runtime_required")
    unknown_runtime = sorted(set(runtime) - _CARD_CREATE_RUNTIME_KEYS)
    if unknown_runtime:
        raise ControlPlaneError(
            f"card_create_runtime_fields_rejected:{','.join(unknown_runtime)}"
        )
    runtime_kind = str(runtime.get("kind") or "").strip()
    runtime_mode = str(runtime.get("mode") or "").strip()
    if runtime_mode not in _SUPPORTED_CARD_RUNTIME_MODES.get(runtime_kind, set()):
        raise ControlPlaneError("card_create_runtime_invalid")
    runtime_profile = str(runtime.get("profile") or "").strip()
    if runtime_kind == "hermes" and not runtime_profile:
        raise ControlPlaneError("card_create_hermes_profile_required")
    if runtime_kind != "hermes" and runtime_profile:
        raise ControlPlaneError("card_create_runtime_profile_unsupported")

    model = args.get("model")
    if not isinstance(model, dict):
        raise ControlPlaneError("card_create_model_required")
    unknown_model = sorted(set(model) - _CARD_CREATE_MODEL_KEYS)
    if unknown_model:
        raise ControlPlaneError(
            f"card_create_model_fields_rejected:{','.join(unknown_model)}"
        )
    provider = str(model.get("provider") or "").strip()
    model_key = str(model.get("modelKey") or "").strip()
    access_mode = str(model.get("accessMode") or "").strip()
    if not provider or not model_key or not access_mode:
        raise ControlPlaneError("card_create_model_configuration_required")
    reasoning_effort = model.get("reasoningEffort")
    if reasoning_effort is not None and reasoning_effort not in _REASONING_EFFORTS:
        raise ControlPlaneError("card_create_reasoning_effort_invalid")
    raw_subagent_model = args.get("subagentModel")
    if runtime_kind != "hermes" and raw_subagent_model is not None:
        raise ControlPlaneError("card_create_subagent_model_requires_hermes")
    subagent_model = (
        _subagent_model_selection(raw_subagent_model)
        if raw_subagent_model is not None
        else dict(_DEFAULT_HERMES_SUBAGENT_MODEL) if runtime_kind == "hermes"
        else None
    )
    raw_team = args.get("team")
    if runtime_kind != "hermes" and raw_team is not None:
        raise ControlPlaneError("card_create_team_requires_hermes")
    team = _team_config(raw_team) if raw_team is not None else None
    normalized_selections: dict[str, list[str]] = {}
    for field in _CAPABILITY_LIST_FIELDS:
        values = args.get(field) or []
        if (
            not isinstance(values, list)
            or any(not isinstance(name, str) or not name.strip() for name in values)
        ):
            raise ControlPlaneError(f"card_create_{field}_must_be_string_list")
        normalized_selections[field] = list(dict.fromkeys(name.strip() for name in values))
    normalized_tools = normalized_selections["tools"]
    if normalized_tools:
        from app.python_models.tool_registry import readable_tool_ids, writable_tool_ids

        invalid_tools = [name for name in normalized_tools if name not in (readable_tool_ids() | writable_tool_ids())]
        if invalid_tools:
            raise ControlPlaneError(
                f"card_create_tool_unavailable:{invalid_tools[0]}"
            )

    position = args.get("position") or {"x": 0, "y": 0}
    if not isinstance(position, dict) or set(position) - {"x", "y"}:
        raise ControlPlaneError("card_create_position_invalid")
    if not all(
        isinstance(position.get(axis, 0), (int, float))
        and not isinstance(position.get(axis, 0), bool)
        and math.isfinite(float(position.get(axis, 0)))
        for axis in ("x", "y")
    ):
        raise ControlPlaneError("card_create_position_invalid")

    project_id = str(args["projectId"]).strip()
    deck_id = str(args["deckId"]).strip()
    expected_revision = str(args["expectedRevision"]).strip()

    def _apply() -> dict[str, Any]:
        deck, current_revision = _load_deck(project_id, deck_id)
        try:
            caller = _find_card(deck, caller_card_id)
        except ControlPlaneError as error:
            raise ControlPlaneError("card_create_requires_agent_builder") from error
        caller_runtime = caller.get("runtime") or {}
        if (
            caller_runtime.get("kind") != "hermes"
            or caller_runtime.get("mode") != "delegate"
            or str(caller_runtime.get("profile") or "").strip()
            != _AGENT_BUILDER_PROFILE
        ):
            raise ControlPlaneError("card_create_requires_agent_builder")
        authorization = builder_operation if isinstance(builder_operation, dict) else {}
        if authorization.get("mode") != "create":
            raise ControlPlaneError("agent_builder_create_authority_required")
        allowed_fields = authorization.get("allowedFields")
        if set(allowed_fields or []) != _AGENT_BUILDER_CREATE_FIELDS:
            raise ControlPlaneError("agent_builder_create_fields_invalid")
        if str(authorization.get("deckRevision") or "") != str(current_revision or ""):
            raise ControlPlaneError("agent_builder_create_revision_changed")
        if str(deck.get("workspaceRoot") or "").strip() != str(
            authorization.get("workspaceRoot") or ""
        ).strip():
            raise ControlPlaneError("agent_builder_workspace_changed")
        authorized_model = authorization.get("model")
        authorized_runtime = authorization.get("runtime")
        if authorized_runtime != _AGENT_BUILDER_CREATE_RUNTIME:
            raise ControlPlaneError("agent_builder_create_runtime_forbidden")
        if (
            template_id != authorization.get("templateId")
            or title != authorization.get("title")
            or role != authorization.get("role")
            or prompt != authorization.get("prompt")
            or normalized_tools != authorization.get("tools")
            or runtime != authorized_runtime
            or model != authorized_model
        ):
            raise ControlPlaneError("agent_builder_create_request_mismatch")
        from app.python_models.idd import load_input_data_dictionary

        if template_id not in load_input_data_dictionary()["templates"]:
            raise ControlPlaneError("agent_builder_template_unavailable")
        if template_id in _SYSTEM_TEMPLATE_IDS:
            raise ControlPlaneError("agent_builder_system_template_forbidden")
        if any(normalized_selections[field] for field in (
            "nativeTools", "skills", "toolsets", "mcpConnectionIds"
        )) or raw_subagent_model is not None or raw_team is not None or "position" in args:
            raise ControlPlaneError("agent_builder_create_fields_forbidden")
        if current_revision != expected_revision:
            raise ControlPlaneError("deck_conflict")
        if any(
            str(node.get("title") or "").strip().casefold() == title.casefold()
            for node in deck.get("nodes") or []
        ):
            raise ControlPlaneError("card_title_conflict")

        identity = uuid4().hex
        card_id = f"card_{identity[:16]}"
        saved_runtime = {"kind": runtime_kind, "mode": runtime_mode}
        if runtime_profile:
            saved_runtime["profile"] = runtime_profile
        runtime_options: dict[str, Any] = {
            "provider": provider,
            "modelKey": model_key,
            "accessMode": access_mode,
            **normalized_selections,
        }
        if subagent_model is not None:
            runtime_options["subagentModel"] = subagent_model
        if team is not None:
            runtime_options["team"] = team
        for key in ("providerModelId", "reasoningEffort"):
            if model.get(key) is not None:
                runtime_options[key] = model[key]
        card = {
            "id": card_id,
            "kind": "agent",
            "title": title,
            "role": role,
            "prompt": prompt,
            "status": "ready",
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
        saved = _save_deck(project_id, deck_id, deck, expected_revision)
        saved_deck = saved.get("deck") if isinstance(saved.get("deck"), dict) else {}
        saved_card = _find_card(saved_deck, card_id)
        saved_revision = str((saved.get("meta") or {}).get("deckRevision") or "")
        if not saved_revision:
            raise ControlPlaneError("card_create_revision_missing")
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

    return await asyncio.to_thread(_apply)


# ---------------------------------------------------------------------------
# card.update_configuration
# ---------------------------------------------------------------------------


async def card_update_configuration(
    args: dict[str, Any], *, caller_card_id: str = "",
    target_card_id: str = "", target_card_revision_id: str = "",
    target_deck_revision: str = "",
    operation_mode: str = "", allowed_fields: list[str] | None = None,
    workspace_root: str = "",
    builder_operation: dict[str, Any] | None = None,
) -> dict[str, Any]:
    _require(args, "projectId", "deckId", "cardId")
    updates = args.get("updates")
    if not isinstance(updates, dict) or not updates:
        raise ControlPlaneError("updates_object_required")
    authorization = builder_operation if isinstance(builder_operation, dict) else {}
    if operation_mode != "edit" or authorization.get("mode") != "edit":
        raise ControlPlaneError("agent_builder_edit_authority_required")
    authorized_fields = set(allowed_fields or [])
    operation_fields = set(authorization.get("allowedFields") or [])
    if (
        authorized_fields != operation_fields
        or not _AGENT_BUILDER_REQUIRED_EDIT_FIELDS.issubset(authorized_fields)
        or not authorized_fields.issubset(_AGENT_BUILDER_EDIT_FIELDS)
    ):
        raise ControlPlaneError("agent_builder_edit_fields_invalid")
    if (
        str(authorization.get("targetCardId") or "") != target_card_id
        or str(authorization.get("targetCardRevisionId") or "")
        != target_card_revision_id
        or str(authorization.get("deckRevision") or "") != target_deck_revision
        or str(authorization.get("workspaceRoot") or "").strip()
        != workspace_root.strip()
    ):
        raise ControlPlaneError("agent_builder_edit_authority_mismatch")
    if set(updates) - authorized_fields:
        raise ControlPlaneError("agent_builder_edit_field_forbidden")
    unknown = [
        key for key in updates
        if key not in _UPDATABLE_TOP_FIELDS and key not in _UPDATABLE_RUNTIME_OPTION_FIELDS
    ]
    if unknown:
        raise ControlPlaneError(
            f"card_update_fields_rejected: {','.join(sorted(unknown))} "
            f"(allowed: {','.join(sorted(_UPDATABLE_TOP_FIELDS | _UPDATABLE_RUNTIME_OPTION_FIELDS))})"
        )
    for field in _CAPABILITY_LIST_FIELDS & set(updates):
        values = updates[field]
        if (
            not isinstance(values, list)
            or any(not isinstance(item, str) or not item.strip() for item in values)
        ):
            raise ControlPlaneError(f"card_update_{field}_must_be_string_list")
        updates = {
            **updates,
            field: list(dict.fromkeys(item.strip() for item in values)),
        }
    if "tools" in updates:
        from app.python_models.tool_registry import readable_tool_ids, writable_tool_ids

        invalid_tools = [
            name for name in updates["tools"] if name not in (readable_tool_ids() | writable_tool_ids())
        ]
        if invalid_tools:
            raise ControlPlaneError(
                f"card_update_tool_unavailable:{invalid_tools[0]}"
            )
    if "configuration" in updates and not isinstance(updates["configuration"], dict):
        raise ControlPlaneError("card_update_configuration_invalid")
    if "subsystems" in updates:
        from app.python_models.card_subsystem import normalize_card_subsystems
        try:
            updates = {
                **updates,
                "subsystems": normalize_card_subsystems(updates["subsystems"]),
            }
        except ValueError as error:
            raise ControlPlaneError(str(error)) from error
    for field in updates:
        if updates[field] != authorization.get(field):
            raise ControlPlaneError("agent_builder_edit_request_mismatch")
    if "script" in updates:
        from app.python_models.card_script import saved_script
        from app.python_models.idd import IddValidationError
        if not isinstance(updates["script"], dict):
            raise ControlPlaneError("card_script_configuration_invalid")
        try:
            updates = {**updates, "script": saved_script({
                **updates["script"],
                "author": {"kind": "agent-builder", "id": caller_card_id},
            })}
        except IddValidationError as error:
            raise ControlPlaneError(str(error)) from error
    if (
        "reasoningEffort" in updates
        and updates["reasoningEffort"] is not None
        and updates["reasoningEffort"] not in _REASONING_EFFORTS
    ):
        raise ControlPlaneError("card_update_reasoning_effort_invalid")
    if (
        "accessMode" in updates
        and updates["accessMode"] not in _ACCESS_MODES
    ):
        raise ControlPlaneError("card_update_access_mode_invalid")
    if (
        "providerModelId" in updates
        and not str(updates["providerModelId"] or "").strip()
    ):
        raise ControlPlaneError("card_update_provider_model_id_required")
    if "subagentModel" in updates:
        updates = {
            **updates,
            "subagentModel": _subagent_model_selection(updates["subagentModel"]),
        }
    if "team" in updates:
        updates = {**updates, "team": _team_config(updates["team"])}
    project_id = str(args["projectId"]).strip()
    deck_id = str(args["deckId"]).strip()
    card_id = str(args["cardId"]).strip()

    def _apply() -> dict[str, Any]:
        deck, revision = _load_deck(project_id, deck_id)
        try:
            caller = _find_card(deck, caller_card_id)
        except ControlPlaneError as error:
            raise ControlPlaneError(
                "card_update_requires_agent_builder"
            ) from error
        caller_runtime = caller.get("runtime") or {}
        if (
            caller_runtime.get("kind") != "hermes"
            or caller_runtime.get("mode") != "delegate"
            or str(caller_runtime.get("profile") or "").strip()
            != _AGENT_BUILDER_PROFILE
        ):
            raise ControlPlaneError("card_update_requires_agent_builder")
        if not target_card_id or not target_card_revision_id or not target_deck_revision:
            raise ControlPlaneError("agent_builder_target_authority_required")
        if card_id != target_card_id:
            raise ControlPlaneError("agent_builder_target_mismatch")
        if str(revision or "") != target_deck_revision:
            raise ControlPlaneError("agent_builder_target_revision_changed")
        if str(deck.get("workspaceRoot") or "").strip() != workspace_root:
            raise ControlPlaneError("agent_builder_workspace_changed")
        if card_id == caller_card_id:
            raise ControlPlaneError("agent_builder_target_self_forbidden")
        card = _find_card(deck, card_id)
        if str(card.get("_cardRevisionId") or "") != target_card_revision_id:
            raise ControlPlaneError("agent_builder_target_revision_changed")
        if (
            str(card.get("templateId") or "") != str(authorization.get("templateId") or "")
            or str(card.get("title") or "") != str(authorization.get("title") or "")
            or str(card.get("role") or "") != str(authorization.get("role") or "")
        ):
            raise ControlPlaneError("agent_builder_target_snapshot_changed")
        card_runtime = card.get("runtime") or {}
        if (
            card_runtime.get("kind") == "autogen"
            and card_runtime.get("mode") == "magentic_one"
        ):
            raise ControlPlaneError("agent_builder_system_target_forbidden")
        if (
            card_runtime.get("kind") == "hermes"
            and (
                card_runtime.get("mode") == "main"
                or str(card_runtime.get("profile") or "").strip()
                in {_AGENT_BUILDER_PROFILE, "liquidaity-hermes-steward"}
            )
        ):
            raise ControlPlaneError("agent_builder_system_target_forbidden")
        if "subagentModel" in updates and (card.get("runtime") or {}).get("kind") != "hermes":
            raise ControlPlaneError("card_update_subagent_model_requires_hermes")
        if "team" in updates and (card.get("runtime") or {}).get("kind") != "hermes":
            raise ControlPlaneError("card_update_team_requires_hermes")
        for key in _UPDATABLE_TOP_FIELDS:
            if key in updates:
                card[key] = str(updates[key])
        runtime_option_updates = {
            k: v for k, v in updates.items() if k in _UPDATABLE_RUNTIME_OPTION_FIELDS
        }
        if runtime_option_updates:
            options = card.get("runtimeOptions")
            if not isinstance(options, dict):
                options = {}
            options.update(runtime_option_updates)
            card["runtimeOptions"] = options
        saved = _save_deck(project_id, deck_id, deck, revision)
        saved_card = _find_card(saved.get("deck") or {}, card_id)
        return {
            "ok": True,
            "cardId": card_id,
            "targetCardRevisionId": target_card_revision_id,
            "appliedFields": sorted(updates.keys()),
            "card": {
                "prompt": saved_card.get("prompt"),
                "title": saved_card.get("title"),
                "runtimeOptions": saved_card.get("runtimeOptions"),
            },
        }

    return await asyncio.to_thread(_apply)


# ---------------------------------------------------------------------------
# canvas.upsert_wire
# ---------------------------------------------------------------------------


async def canvas_upsert_wire(args: dict[str, Any]) -> dict[str, Any]:
    _require(args, "projectId", "deckId", "op")
    op = str(args["op"]).strip()
    if op not in ("upsert", "remove"):
        raise ControlPlaneError(f"wire_op_invalid: {op}")
    wire = args.get("wire")
    if not isinstance(wire, dict):
        raise ControlPlaneError("wire_object_required")
    source = str(wire.get("source") or "").strip()
    target = str(wire.get("target") or "").strip()
    edge_type = str(wire.get("edgeType") or "").strip()
    wire_id = str(wire.get("id") or "").strip()
    if edge_type and edge_type not in SUPPORTED_WIRE_TYPES:
        raise ControlPlaneError(f"wire_edge_type_unsupported: {edge_type}")
    if op == "upsert" and (not source or not target):
        raise ControlPlaneError("wire_source_and_target_required")

    project_id = str(args["projectId"]).strip()
    deck_id = str(args["deckId"]).strip()

    def _apply() -> dict[str, Any]:
        from app.python_models.card_domain import CardDomainError, _edge_core, _validate_changed_flow_edges

        deck, revision = _load_deck(project_id, deck_id)
        cards = {str(node.get("id") or ""): node for node in deck.get("nodes") or []}
        edges = list(deck.get("edges") or [])
        prior = next((edge for edge in edges if edge.get("id") == wire_id), None)
        resolved_type = edge_type or (prior or {}).get("edgeType") or "flow"
        resolved_id = wire_id or f"{source}->{target}:{resolved_type}"
        if prior is None:
            prior = next((edge for edge in edges if edge.get("id") == resolved_id), None)
        if op == "upsert":
            if source not in cards or target not in cards:
                raise ControlPlaneError(f"wire_endpoints_not_in_deck: {source}->{target}")
            candidate = {**(prior or {}), **wire, "id": resolved_id, "source": source,
                         "target": target, "edgeType": resolved_type}
            blue = resolved_type in {"magentic_option", "magentic_control"}
            if blue and prior and (prior['source'], prior['target']) == (target, source):
                for field, old_field in (('sourceHandle', 'targetHandle'), ('targetHandle', 'sourceHandle')):
                    if field not in wire:
                        candidate.pop(field, None)
                        if old_field in prior:
                            candidate[field] = prior[old_field]
            if blue:
                bus_count = sum(cards[key].get("runtime") == {"kind": "autogen", "mode": "magentic_one"}
                                for key in (source, target))
                if bus_count != 1:
                    raise ControlPlaneError("wire_magentic_endpoint_required")
            for edge in edges:
                same_endpoints = ({edge["source"], edge["target"]} == {source, target} if blue
                                  else (edge["source"], edge["target"]) == (source, target))
                if edge["id"] != resolved_id and edge["edgeType"] == resolved_type and same_endpoints:
                    raise ControlPlaneError("wire_connection_duplicate")
            try:
                _edge_core(candidate)
                # A wire edit cannot implicitly remove a connection because its source is off.
                _validate_changed_flow_edges(list(cards.values()), [candidate], [])
            except CardDomainError as error:
                raise ControlPlaneError(str(error)) from error
            comparable = dict(candidate)
            if blue and prior and (prior['source'], prior['target']) == (target, source):
                comparable['source'], comparable['target'] = target, source
                comparable.pop('sourceHandle', None)
                comparable.pop('targetHandle', None)
                if 'targetHandle' in candidate:
                    comparable['sourceHandle'] = candidate['targetHandle']
                if 'sourceHandle' in candidate:
                    comparable['targetHandle'] = candidate['sourceHandle']
            if prior == comparable:
                return {"ok": True, "op": op, "wireId": resolved_id, "edgeType": resolved_type}
            if prior is None:
                edges.append(candidate)
            else:
                edges = [candidate if edge["id"] == resolved_id else edge for edge in edges]
        else:
            before = len(edges)
            edges = [e for e in edges if str(e.get("id") or "") != resolved_id]
            if len(edges) == before:
                raise ControlPlaneError(f"wire_not_found: {resolved_id}")
        deck["edges"] = edges
        _save_deck(project_id, deck_id, deck, revision)
        return {"ok": True, "op": op, "wireId": resolved_id, "edgeType": resolved_type}

    return await asyncio.to_thread(_apply)


# ---------------------------------------------------------------------------
# card.run_assistant_agent
# ---------------------------------------------------------------------------


async def card_run_assistant_agent(args: dict[str, Any]) -> dict[str, Any]:
    # deckId is optional transport: the backend bridge owns the canonical
    # Agent Canvas default. conversationId is a structural reference to the
    # real live conversation when one exists — the backend mints card-scoped
    # authority from it; this layer never authors or invents authority.
    action = str(args.get("action") or "execute").strip()
    if action == "status" or args.get("runId") or args.get("nativeRootId"):
        _require(args, "projectId")
        selectors = {
            key: str(args.get(key) or "").strip()
            for key in ("runId", "nativeRootId", "cardId")
            if str(args.get(key) or "").strip()
        }
        if len(selectors) != 1:
            raise ControlPlaneError("card_run_status_selector_invalid")
        payload = {
            "projectId": str(args["projectId"]).strip(),
            **({"deckId": str(args["deckId"]).strip()} if args.get("deckId") else {}),
            "action": "status",
            **selectors,
        }
        response = await asyncio.to_thread(
            _backend_json,
            "POST",
            "/api/coder/mcp-bridge/run_configured_card",
            payload,
        )
        if response.get("ok") is False:
            raise ControlPlaneError(str(response.get("error") or "configured_card_status_failed"))
        return response

    _require(args, "projectId", "cardId", "correlationId", "input")
    deck_id = str(args.get("deckId") or "").strip()
    conversation_id = str(args.get("conversationId") or "").strip()
    originating_agent_id = str(args.get("originatingAgentId") or "").strip()
    originating_run_id = str(args.get("originatingRunId") or "").strip()
    project_id = str(args["projectId"]).strip()
    card_id = str(args["cardId"]).strip()
    card_revision_id = str(args.get("cardRevisionId") or "").strip()
    correlation_id = str(args["correlationId"]).strip()
    instruction = str(args["input"])

    if originating_agent_id:
        if not conversation_id:
            raise ControlPlaneError("conversationId_required_for_agent_handoff")
        if not originating_run_id:
            raise ControlPlaneError("originatingRunId_required_for_agent_handoff")
        deck_id = deck_id or "deck_builder"

    payload = {
        "projectId": project_id,
        **({"deckId": deck_id} if deck_id else {}),
        "cardId": card_id,
        **({"cardRevisionId": card_revision_id} if card_revision_id else {}),
        "correlationId": correlation_id,
        **({"conversationId": conversation_id} if conversation_id else {}),
        **({"senderCardId": originating_agent_id} if originating_agent_id else {}),
        **({"originatingRunId": originating_run_id} if originating_run_id else {}),
        "input": instruction,
        **(
            {"dataAnchors": args["dataAnchors"]}
            if isinstance(args.get("dataAnchors"), list)
            else {}
        ),
    }

    try:
        response = await asyncio.to_thread(
            _backend_json,
            "POST",
            "/api/coder/mcp-bridge/run_configured_card",
            {
                **payload,
                "action": "execute",
            },
        )
    except Exception:
        raise

    if response.get("ok") is False:
        raise ControlPlaneError(str(response.get("error") or "configured_card_run_failed"))
    return response
