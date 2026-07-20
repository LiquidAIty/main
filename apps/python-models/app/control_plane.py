"""Harness control-plane capability handlers (Python-owned).

The minimum user-directed MCP control surface over ACTUAL saved state:

  * canvas.inspect             — bounded saved deck view + DB-backed assignments
  * card.update_configuration  — strict allowlist edits of persisted card config
  * canvas.upsert_wire         — supported wire types only (flow / magentic_option)
  * card.assign_runtime_skill  — promoted, compatible, version-pinned assignment
  * card.assign_data_binding   — bounded pointer/scope records, no raw queries
  * card.run_assistant_agent   — run ONE saved enabled card (no overrides possible)

Policy/validation lives HERE (Python). Saved-deck persistence stays with the
existing backend deck routes on loopback (single deck authority — not replaced);
runtime assignments live in the Python-owned Postgres tables
(runtime_assignments). No Task Ledger, no Mag One worker selection, no graph
write authority is exposed. Failures are honest; there is no fallback path.
"""

from __future__ import annotations

import asyncio
import json
import os
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from app.python_models import runtime_assignments as ra

_BACKEND = os.environ.get("LIQUIDAITY_BACKEND_URL", "http://127.0.0.1:4000").rstrip("/")

SUPPORTED_WIRE_TYPES = ("flow", "magentic_option")

# Exact allowlist of card fields Harness may edit. Anything else — runtime code,
# shell config, hidden tools, authority grants, worker selection — is rejected.
_UPDATABLE_TOP_FIELDS = {"prompt", "title"}
_UPDATABLE_RUNTIME_OPTION_FIELDS = {"modelKey", "provider", "temperature", "maxTokens", "tools"}


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


# ---------------------------------------------------------------------------
# canvas.inspect
# ---------------------------------------------------------------------------


async def canvas_inspect(args: dict[str, Any]) -> dict[str, Any]:
    _require(args, "projectId", "deckId")
    project_id = str(args["projectId"]).strip()
    deck_id = str(args["deckId"]).strip()
    deck, revision = await asyncio.to_thread(_load_deck, project_id, deck_id)

    def _assignments() -> tuple[dict, dict, list, dict]:
        skills: dict[str, list] = {}
        data: dict[str, list] = {}
        profiles: dict[str, dict | None] = {}
        for node in deck.get("nodes") or []:
            card_id = str(node.get("id") or "")
            skills[card_id] = [
                {"skillId": s.skill_id, "version": s.version, "status": s.status}
                for s in ra.assigned_skills(project_id=project_id, deck_id=deck_id, card_id=card_id)
            ]
            data[card_id] = ra.assigned_data_bindings(
                project_id=project_id, deck_id=deck_id, card_id=card_id
            )
            binding = str(node.get("runtimeBinding") or "")
            try:
                profile = ra.resolve_profile(binding) if binding else None
            except LookupError:
                profile = None
            profiles[card_id] = (
                {"profileId": profile.profile_id, "version": profile.version} if profile else None
            )
        traces = ra.get_run_traces(project_id=project_id, limit=10)
        return skills, data, traces, profiles

    skills, data, traces, profiles = await asyncio.to_thread(_assignments)

    cards = [
        {
            "id": str(node.get("id") or ""),
            "title": str(node.get("title") or ""),
            "runtimeBinding": node.get("runtimeBinding"),
            "runtimeType": node.get("runtimeType"),
            "prompt": str(node.get("prompt") or "")[:500],
            "tools": ((node.get("runtimeOptions") or {}).get("tools")) or node.get("tools") or [],
            "assignedProfile": profiles.get(str(node.get("id") or "")),
            "assignedSkills": skills.get(str(node.get("id") or ""), []),
            "assignedDataBindings": data.get(str(node.get("id") or ""), []),
        }
        for node in deck.get("nodes") or []
    ]
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
        "cards": cards,
        "wires": wires,
        "recentRunTraces": traces,
    }


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
# card.assign_runtime_skill / card.assign_data_binding
# ---------------------------------------------------------------------------


async def card_assign_runtime_skill(args: dict[str, Any]) -> dict[str, Any]:
    _require(args, "projectId", "deckId", "cardId", "skillId", "op")
    op = str(args["op"]).strip()
    if op not in ("assign", "remove"):
        raise ControlPlaneError(f"skill_op_invalid: {op}")
    project_id = str(args["projectId"]).strip()
    deck_id = str(args["deckId"]).strip()
    card_id = str(args["cardId"]).strip()
    skill_id = str(args["skillId"]).strip()

    def _apply() -> dict[str, Any]:
        deck, _ = _load_deck(project_id, deck_id)
        card = _find_card(deck, card_id)  # card must actually exist in the saved deck
        if op == "assign":
            version = args.get("skillVersion")
            if not isinstance(version, int) or version < 1:
                raise ControlPlaneError("skill_version_required_for_pinning")
            ra.assign_skill(
                project_id=project_id, deck_id=deck_id, card_id=card_id,
                skill_id=skill_id, skill_version=version,
                card_runtime_binding=str(card.get("runtimeBinding") or ""),
            )
            return {"ok": True, "op": op, "skillId": skill_id, "pinnedVersion": version}
        ra.remove_skill_assignment(
            project_id=project_id, deck_id=deck_id, card_id=card_id, skill_id=skill_id
        )
        return {"ok": True, "op": op, "skillId": skill_id}

    try:
        return await asyncio.to_thread(_apply)
    except ValueError as err:
        raise ControlPlaneError(str(err)) from err


async def card_assign_data_binding(args: dict[str, Any]) -> dict[str, Any]:
    _require(args, "projectId", "deckId", "cardId", "bindingType", "op")
    op = str(args["op"]).strip()
    if op not in ("assign", "remove"):
        raise ControlPlaneError(f"data_binding_op_invalid: {op}")
    project_id = str(args["projectId"]).strip()
    deck_id = str(args["deckId"]).strip()
    card_id = str(args["cardId"]).strip()
    binding_type = str(args["bindingType"]).strip()

    def _apply() -> dict[str, Any]:
        deck, _ = _load_deck(project_id, deck_id)
        _find_card(deck, card_id)
        if op == "assign":
            ra.assign_data_binding(
                project_id=project_id, deck_id=deck_id, card_id=card_id,
                binding_type=binding_type, binding_ref=args.get("bindingRef"),
            )
            return {"ok": True, "op": op, "bindingType": binding_type}
        ra.remove_data_binding(
            project_id=project_id, deck_id=deck_id, card_id=card_id, binding_type=binding_type
        )
        return {"ok": True, "op": op, "bindingType": binding_type}

    try:
        return await asyncio.to_thread(_apply)
    except ValueError as err:
        raise ControlPlaneError(str(err)) from err


# ---------------------------------------------------------------------------
# thinkgraph.get_graph_slice — bounded READ of stored project reasoning.
# Main reads the project projection through MCP. Its separate submit tool owns
# writes; no card gains write authority from its name or runtime binding.
# ---------------------------------------------------------------------------


async def thinkgraph_get_graph_slice(args: dict[str, Any]) -> dict[str, Any]:
    _require(args, "projectId")
    project_id = str(args["projectId"]).strip()
    limit = args.get("limit")
    query = f"/api/thinkgraph/graph-view?projectId={project_id}"
    if isinstance(limit, int) and limit > 0:
        query += f"&limit={min(limit, 2000)}"
    result = await asyncio.to_thread(_backend_json, "GET", query)
    if not result.get("ok", True) and result.get("error"):
        raise ControlPlaneError(f"thinkgraph_slice_failed: {result.get('error')}")
    return {"ok": True, "projectId": project_id, **{k: v for k, v in result.items() if k != "ok"}}


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
    return await asyncio.to_thread(
        _backend_json,
        "POST",
        "/api/coder/mcp-bridge/run_configured_card",
        {
            "projectId": str(args["projectId"]).strip(),
            **({"deckId": deck_id} if deck_id else {}),
            "cardId": str(args["cardId"]).strip(),
            "correlationId": str(args["correlationId"]).strip(),
            **({"conversationId": conversation_id} if conversation_id else {}),
            "input": str(args["input"]),
        },
    )
