"""Harness control-plane capability handlers (Python-owned).

The minimum user-directed MCP control surface over ACTUAL saved state:

  * agentgraph.inspect         — bounded current Card/AGE authority and telemetry
  * canvas.inspect             — bounded saved deck view
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
import json
import os
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

_BACKEND = os.environ.get("MAIN_BACKEND_URL", "http://127.0.0.1:4000").rstrip("/")

SUPPORTED_WIRE_TYPES = ("flow", "magentic_option")

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
    project_id = str(args["projectId"]).strip()
    deck_id = str(args["deckId"]).strip()
    deck, revision = await asyncio.to_thread(_load_deck, project_id, deck_id)

    cards = [
        {
            "id": str(node.get("id") or ""),
            "title": str(node.get("title") or ""),
            "runtime": node.get("runtime"),
            "tools": ((node.get("runtimeOptions") or {}).get("tools")) or node.get("tools") or [],
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
    }

    try:
        preview_response = await asyncio.to_thread(
            _backend_json,
            "POST",
            "/api/coder/mcp-bridge/run_configured_card",
            {**payload, "action": "materialize"},
        )
        if isinstance(preview_response, dict) and preview_response.get("ok") is False:
            error = str(preview_response.get("error") or "configured_card_materialization_failed").strip()
            raise ControlPlaneError(error or "configured_card_materialization_failed")
        preview_result = preview_response.get("result") if isinstance(preview_response, dict) else None
        invocation = preview_result.get("invocation") if isinstance(preview_result, dict) else None
        exact_idf = invocation.get("exactIdf") if isinstance(invocation, dict) else None
        card_revision_id = invocation.get("cardRevisionId") if isinstance(invocation, dict) else None
        if not isinstance(exact_idf, str) or not exact_idf.strip():
            raise ControlPlaneError("configured_card_materialization_missing_exact_idf")
        if not isinstance(card_revision_id, str) or not card_revision_id.strip():
            raise ControlPlaneError("configured_card_materialization_missing_revision")
        response = await asyncio.to_thread(
            _backend_json,
            "POST",
            "/api/coder/mcp-bridge/run_configured_card",
            {
                **payload,
                "action": "execute",
                "exactIdf": exact_idf,
                "cardRevisionId": card_revision_id,
            },
        )
    except Exception:
        raise

    return response
