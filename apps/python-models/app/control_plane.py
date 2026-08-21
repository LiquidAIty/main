"""Harness control-plane capability handlers (Python-owned).

The minimum user-directed MCP control surface over ACTUAL saved state:

  * agentgraph.inspect         — bounded current Card/AGE authority and telemetry
  * canvas.inspect             — bounded saved deck view
  * card.create                — strict optimistic creation in the saved deck
  * card.update_configuration  — strict allowlist edits of persisted card config
  * canvas.upsert_wire         — supported wire types only (flow / magentic_option)
  * card.run_assistant_agent   — run ONE saved enabled card (no overrides possible)

Policy/validation lives HERE (Python). Saved-deck persistence stays with the
existing backend deck routes on loopback (single deck authority — not replaced).
No Task Ledger, no Mag One worker selection, no graph write authority is exposed.
Failures are honest; there is no fallback path.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import math
import os
from typing import Any
from uuid import uuid4
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

_BACKEND = os.environ.get("MAIN_BACKEND_URL", "http://127.0.0.1:4000").rstrip("/")

SUPPORTED_WIRE_TYPES = ("flow", "magentic_option")
_SUPPORTED_CARD_RUNTIME_MODES = {
    "hermes": {"main", "delegate", "kanban", "single"},
    "autogen": {"assistant", "magentic_one"},
}
_CARD_CREATE_KEYS = {
    "projectId",
    "deckId",
    "expectedRevision",
    "title",
    "role",
    "prompt",
    "runtime",
    "model",
    "tools",
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
_MAG_ONE_PROPOSAL_WORKER_LIMIT = 12
_MAG_ONE_PROPOSAL_REFERENCE_LIMIT = 24

# Exact allowlist of card fields Harness may edit. Anything else — runtime code,
# shell config, hidden tools, authority grants, worker selection — is rejected.
_UPDATABLE_TOP_FIELDS = {"prompt", "title"}
_UPDATABLE_RUNTIME_OPTION_FIELDS = {
    "modelKey",
    "provider",
    "reasoningEffort",
    "temperature",
    "maxTokens",
    "tools",
}
_REASONING_EFFORTS = {"low", "medium", "high", "xhigh"}


class ControlPlaneError(Exception):
    pass


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
    from app.python_models.idd import readable_tool_ids, tool_access

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
            # Backward-compatible field now means exactly what the Card Tools
            # tab means: durable write/effect assignments.
            "tools": saved_writes,
            "savedWriteTools": saved_writes,
            "legacyReadableSelections": [
                name for name in configured_tools if tool_access(name) == "read"
            ],
            "unknownConfiguredTools": [
                name for name in configured_tools if tool_access(name) is None
            ],
        })
    wires = [
        {
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
        "effectiveReadTools": sorted(readable_tool_ids()),
        "cards": cards,
        "wires": wires,
    }


def _proposal_strings(value: Any, field: str, *, limit: int = 24) -> list[str]:
    if value is None:
        return []
    if not isinstance(value, list) or len(value) > limit:
        raise ControlPlaneError(f"{field}_invalid")
    result: list[str] = []
    for item in value:
        text = str(item or "").strip()
        if not text:
            raise ControlPlaneError(f"{field}_invalid")
        if text not in result:
            result.append(text)
    return result


async def prepare_mag_one_proposal(args: dict[str, Any]) -> dict[str, Any]:
    """Validate one transient read-only Hermes proposal against saved deck truth."""
    _require(args, "projectId", "deckId", "instructions")
    from app.python_models.card_domain import resolve_magentic_card_identity
    from app.python_models.idd import readable_tool_ids, tool_access

    project_id = str(args["projectId"]).strip()
    deck_id = str(args["deckId"]).strip()
    instructions = str(args["instructions"]).strip()
    deck, revision = await asyncio.to_thread(_load_deck, project_id, deck_id)
    target = resolve_magentic_card_identity(project_id, deck_id)
    target_card_id = str(target["targetCardId"])
    cards = {
        str(node.get("id") or ""): node
        for node in deck.get("nodes") or []
        if str(node.get("id") or "")
    }
    existing_worker_ids = list(dict.fromkeys(
        str(edge.get("source") or "")
        for edge in deck.get("edges") or []
        if str(edge.get("target") or "") == target_card_id
        and str(edge.get("edgeType") or "") == "magentic_option"
        and edge.get("enabled") is not False
    ))
    readable = set(readable_tool_ids())

    raw_references = args.get("graphReferences") or []
    if not isinstance(raw_references, list) or len(raw_references) > _MAG_ONE_PROPOSAL_REFERENCE_LIMIT:
        raise ControlPlaneError("mag_one_proposal_graph_references_invalid")
    graph_references: list[dict[str, Any]] = []
    seen_references: set[tuple[str, str]] = set()
    for item in raw_references:
        if not isinstance(item, dict):
            raise ControlPlaneError("mag_one_proposal_graph_reference_invalid")
        authority = str(item.get("authority") or "").strip()
        native_id = str(item.get("nativeId") or "").strip()
        reason = str(item.get("reason") or "").strip()
        if authority not in {"ThinkGraph", "KnowGraph", "CodeGraph"} or not native_id or not reason:
            raise ControlPlaneError("mag_one_proposal_graph_reference_invalid")
        identity = (authority, native_id)
        if identity in seen_references:
            continue
        seen_references.add(identity)
        graph_references.append({
            "authority": authority,
            "nativeId": native_id,
            "reason": reason[:2_000],
            "provenance": item.get("provenance") if isinstance(item.get("provenance"), dict) else {},
        })

    raw_workers = args.get("workers") or []
    if not isinstance(raw_workers, list) or len(raw_workers) > _MAG_ONE_PROPOSAL_WORKER_LIMIT:
        raise ControlPlaneError("mag_one_proposal_workers_invalid")
    workers: list[dict[str, Any]] = []
    cards_to_create: list[dict[str, Any]] = []
    cards_to_update: list[dict[str, Any]] = []
    wires_to_add: list[dict[str, Any]] = []
    seen_workers: set[str] = set()
    existing_wire_ids = {
        str(edge.get("id") or "")
        for edge in deck.get("edges") or []
    }
    for index, item in enumerate(raw_workers):
        if not isinstance(item, dict):
            raise ControlPlaneError("mag_one_proposal_worker_invalid")
        existing_card_id = str(item.get("existingCardId") or "").strip()
        card = cards.get(existing_card_id) if existing_card_id else None
        if existing_card_id and card is None:
            raise ControlPlaneError(f"mag_one_proposal_worker_card_not_found:{existing_card_id}")
        identity = existing_card_id or f"new:{index}"
        if identity in seen_workers:
            raise ControlPlaneError("mag_one_proposal_worker_duplicate")
        seen_workers.add(identity)
        title = str(item.get("title") or (card or {}).get("title") or "").strip()
        role = str(item.get("role") or (card or {}).get("role") or "").strip()
        stable_instructions = str(item.get("stableInstructions") or "").strip()
        reason = str(item.get("reason") or "").strip()
        expected_input = str(item.get("expectedInput") or "").strip()
        expected_output = str(item.get("expectedOutput") or "").strip()
        if not all((title, role, reason, expected_input, expected_output)):
            raise ControlPlaneError("mag_one_proposal_worker_fields_required")
        if card is None and not stable_instructions:
            raise ControlPlaneError("mag_one_proposal_new_worker_instructions_required")
        read_capabilities = _proposal_strings(item.get("readCapabilities"), "readCapabilities")
        effect_tools = _proposal_strings(item.get("effectTools"), "effectTools")
        invalid_reads = [name for name in read_capabilities if name not in readable]
        invalid_effects = [name for name in effect_tools if tool_access(name) != "write"]
        if invalid_reads:
            raise ControlPlaneError(f"mag_one_proposal_read_capability_invalid:{invalid_reads[0]}")
        if invalid_effects:
            raise ControlPlaneError(f"mag_one_proposal_effect_tool_invalid:{invalid_effects[0]}")
        skills = _proposal_strings(item.get("skills"), "skills")
        options = (card or {}).get("runtimeOptions") if isinstance((card or {}).get("runtimeOptions"), dict) else {}
        runtime = (card or {}).get("runtime") if isinstance((card or {}).get("runtime"), dict) else item.get("runtime")
        proposed_model = item.get("model")
        if proposed_model is None:
            proposed_model = {}
        if not isinstance(proposed_model, dict):
            raise ControlPlaneError("mag_one_proposal_worker_runtime_model_required")
        model = {
            "provider": str(options.get("provider") or proposed_model.get("provider") or ""),
            "modelKey": str(options.get("modelKey") or proposed_model.get("modelKey") or ""),
            "providerModelId": str(options.get("providerModelId") or proposed_model.get("providerModelId") or ""),
        }
        if not isinstance(runtime, dict) or not runtime.get("kind") or not runtime.get("mode") or not all(model.values()):
            raise ControlPlaneError("mag_one_proposal_worker_runtime_model_required")
        worker = {
            "existingCardId": existing_card_id or None,
            "reuseExisting": bool(existing_card_id),
            "title": title,
            "role": role,
            "stableInstructions": stable_instructions,
            "skills": skills,
            "runtime": runtime,
            "model": model,
            "readCapabilities": read_capabilities,
            "effectTools": effect_tools,
            "reason": reason,
            "expectedInput": expected_input,
            "expectedOutput": expected_output,
        }
        workers.append(worker)
        if card is None:
            cards_to_create.append(worker)
            continue
        updates: dict[str, Any] = {}
        if stable_instructions and stable_instructions != str(card.get("prompt") or ""):
            updates["prompt"] = stable_instructions
        configured_effects = [
            str(name) for name in (options.get("tools") or []) if tool_access(str(name)) == "write"
        ]
        if effect_tools and effect_tools != configured_effects:
            updates["tools"] = effect_tools
        if updates:
            cards_to_update.append({"cardId": existing_card_id, "updates": updates})
        if existing_card_id not in existing_worker_ids:
            wire_id = f"{existing_card_id}->{target_card_id}:magentic_option"
            wires_to_add.append({
                "id": wire_id,
                "source": existing_card_id,
                "target": target_card_id,
                "edgeType": "magentic_option",
                "alreadyExists": wire_id in existing_wire_ids,
            })

    remove_worker_ids = _proposal_strings(
        args.get("removeWorkerCardIds"), "removeWorkerCardIds", limit=_MAG_ONE_PROPOSAL_WORKER_LIMIT
    )
    wires_to_remove = [
        {
            "id": str(edge.get("id") or ""),
            "source": str(edge.get("source") or ""),
            "target": target_card_id,
            "edgeType": "magentic_option",
        }
        for edge in deck.get("edges") or []
        if str(edge.get("source") or "") in remove_worker_ids
        and str(edge.get("target") or "") == target_card_id
        and str(edge.get("edgeType") or "") == "magentic_option"
    ]
    proposal = {
        "instructions": instructions,
        "goal": str(args.get("goal") or "").strip(),
        "completionCriteria": _proposal_strings(args.get("completionCriteria"), "completionCriteria"),
        "graphReferences": graph_references,
        "requestedOutputFormat": str(args.get("requestedOutputFormat") or "").strip(),
        "boundaries": _proposal_strings(args.get("boundaries"), "boundaries"),
        "workers": workers,
        "cardsToCreate": cards_to_create,
        "cardsToUpdate": cards_to_update,
        "wiresToAdd": wires_to_add,
        "wiresToRemove": wires_to_remove,
        "estimatedModelCalls": int(args.get("estimatedModelCalls") or 0),
        "costRisk": str(args.get("costRisk") or "unknown").strip(),
        "graphResultsTruncated": args.get("graphResultsTruncated") is True,
    }
    proposal_hash = hashlib.sha256(
        json.dumps(
            {"projectId": project_id, "deckId": deck_id, "deckRevision": revision, "proposal": proposal},
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    ).hexdigest()
    return {
        "ok": True,
        **target,
        "projectId": project_id,
        "deckId": deck_id,
        "deckRevision": revision,
        "instructions": instructions,
        "proposal": proposal,
        "proposalHash": proposal_hash,
        "existingWorkerCardIds": existing_worker_ids,
        "persisted": False,
        "started": False,
        "approvalRequired": True,
        "magOneLaunchApproved": False,
    }


# ---------------------------------------------------------------------------
# card.create
# ---------------------------------------------------------------------------


async def card_create(args: dict[str, Any]) -> dict[str, Any]:
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

    tools = args.get("tools") or []
    if (
        not isinstance(tools, list)
        or any(not isinstance(name, str) or not name.strip() for name in tools)
    ):
        raise ControlPlaneError("card_create_tools_must_be_string_list")
    normalized_tools = list(dict.fromkeys(name.strip() for name in tools))
    from app.python_models.idd import tool_access

    invalid_tools = [name for name in normalized_tools if tool_access(name) != "write"]
    if invalid_tools:
        raise ControlPlaneError(
            f"card_create_tools_must_be_write_operations:{invalid_tools[0]}"
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
            "tools": normalized_tools,
        }
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
            "templateId": f"template_{identity[:16]}",
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


async def card_update_configuration(args: dict[str, Any]) -> dict[str, Any]:
    _require(args, "projectId", "deckId", "cardId")
    updates = args.get("updates")
    if not isinstance(updates, dict) or not updates:
        raise ControlPlaneError("updates_object_required")
    unknown = [
        key for key in updates
        if key not in _UPDATABLE_TOP_FIELDS and key not in _UPDATABLE_RUNTIME_OPTION_FIELDS
    ]
    if unknown:
        raise ControlPlaneError(
            f"card_update_fields_rejected: {','.join(sorted(unknown))} "
            f"(allowed: {','.join(sorted(_UPDATABLE_TOP_FIELDS | _UPDATABLE_RUNTIME_OPTION_FIELDS))})"
        )
    if "tools" in updates and (
        not isinstance(updates["tools"], list)
        or any(not isinstance(t, str) or not t.strip() for t in updates["tools"])
    ):
        raise ControlPlaneError("card_update_tools_must_be_string_list")
    if "tools" in updates:
        from app.python_models.idd import tool_access

        invalid_tools = [
            name for name in updates["tools"] if tool_access(name) != "write"
        ]
        if invalid_tools:
            raise ControlPlaneError(
                f"card_update_tools_must_be_write_operations:{invalid_tools[0]}"
            )
    if (
        "reasoningEffort" in updates
        and updates["reasoningEffort"] is not None
        and updates["reasoningEffort"] not in _REASONING_EFFORTS
    ):
        raise ControlPlaneError("card_update_reasoning_effort_invalid")

    project_id = str(args["projectId"]).strip()
    deck_id = str(args["deckId"]).strip()
    card_id = str(args["cardId"]).strip()

    def _apply() -> dict[str, Any]:
        deck, revision = _load_deck(project_id, deck_id)
        card = _find_card(deck, card_id)
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
    edge_type = str(wire.get("edgeType") or "flow").strip()
    wire_id = str(wire.get("id") or "").strip() or f"{source}->{target}:{edge_type}"
    if edge_type not in SUPPORTED_WIRE_TYPES:
        raise ControlPlaneError(f"wire_edge_type_unsupported: {edge_type}")
    if op == "upsert" and (not source or not target):
        raise ControlPlaneError("wire_source_and_target_required")

    project_id = str(args["projectId"]).strip()
    deck_id = str(args["deckId"]).strip()

    def _apply() -> dict[str, Any]:
        deck, revision = _load_deck(project_id, deck_id)
        node_ids = {str(node.get("id") or "") for node in deck.get("nodes") or []}
        edges = list(deck.get("edges") or [])
        if op == "upsert":
            if source not in node_ids or target not in node_ids:
                raise ControlPlaneError(f"wire_endpoints_not_in_deck: {source}->{target}")
            edges = [e for e in edges if str(e.get("id") or "") != wire_id]
            edges.append({"id": wire_id, "source": source, "target": target, "edgeType": edge_type})
        else:
            before = len(edges)
            edges = [e for e in edges if str(e.get("id") or "") != wire_id]
            if len(edges) == before:
                raise ControlPlaneError(f"wire_not_found: {wire_id}")
        deck["edges"] = edges
        _save_deck(project_id, deck_id, deck, revision)
        return {"ok": True, "op": op, "wireId": wire_id, "edgeType": edge_type}

    return await asyncio.to_thread(_apply)


# ---------------------------------------------------------------------------
# card.run_assistant_agent
# ---------------------------------------------------------------------------


async def card_run_assistant_agent(args: dict[str, Any]) -> dict[str, Any]:
    # deckId is optional transport: the backend bridge owns the canonical
    # Agent Canvas default. conversationId is a structural reference to the
    # real live conversation when one exists — the backend mints card-scoped
    # authority from it; this layer never authors or invents authority.
    _require(args, "projectId", "cardId", "correlationId", "input")
    deck_id = str(args.get("deckId") or "").strip()
    conversation_id = str(args.get("conversationId") or "").strip()
    originating_agent_id = str(args.get("originatingAgentId") or "").strip()
    originating_run_id = str(args.get("originatingRunId") or "").strip()
    project_id = str(args["projectId"]).strip()
    card_id = str(args["cardId"]).strip()
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
