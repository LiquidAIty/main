"""Saved Canvas inspection and one-wire optimistic updates."""

from __future__ import annotations

import asyncio
from typing import Any
from urllib.parse import urlencode

from app.application_tool_error import ApplicationToolError
from app.saved_deck_http import (
    find_saved_card,
    load_saved_deck,
    request_backend_json,
    save_saved_deck,
)


SUPPORTED_WIRE_TYPES = ("flow", "magentic_option")


def saved_canvas_operation_schema(name: str) -> dict[str, Any]:
    """Return the exact public schema for one saved-Canvas operation."""

    text = {"type": "string", "minLength": 1}
    if name == "canvas.inspect":
        return {
            "type": "object",
            "properties": {
                "projectId": text,
                "deckId": text,
                "cardId": text,
                "includeCatalog": {"type": "boolean"},
            },
            "required": ["projectId", "deckId"],
            "additionalProperties": False,
        }
    if name == "canvas.upsert_wire":
        return {
            "type": "object",
            "properties": {
                "projectId": {"type": "string"},
                "deckId": {"type": "string"},
                "op": {"type": "string", "enum": ["upsert", "remove"]},
                "wire": {
                    "type": "object",
                    "properties": {
                        "id": {"type": "string"},
                        "source": {"type": "string"},
                        "target": {"type": "string"},
                        "sourceHandle": {"type": ["string", "null"]},
                        "targetHandle": {"type": ["string", "null"]},
                        "enabled": {"type": "boolean"},
                        "edgeType": {
                            "type": "string",
                            "enum": list(SUPPORTED_WIRE_TYPES),
                        },
                    },
                    "additionalProperties": True,
                },
            },
            "required": ["projectId", "deckId", "op", "wire"],
        }
    raise ApplicationToolError("saved_canvas_operation_unknown")


def _require(arguments: dict[str, Any], *keys: str) -> None:
    for key in keys:
        if not str(arguments.get(key) or "").strip():
            raise ApplicationToolError(f"{key}_required")


async def canvas_inspect(
    args: dict[str, Any], *, caller_card_id: str = "",
) -> dict[str, Any]:
    _require(args, "projectId", "deckId")
    from app.python_models.tool_registry import operation_definition

    project_id = str(args["projectId"]).strip()
    deck_id = str(args["deckId"]).strip()
    deck, revision = await asyncio.to_thread(
        load_saved_deck, project_id, deck_id
    )
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
        resolved = {
            name: operation_definition(name) for name in configured_tools
        }
        cards.append({
            "id": str(node.get("id") or ""),
            "title": str(node.get("title") or ""),
            "runtime": node.get("runtime"),
            "tools": [
                name for name in configured_tools
                if resolved[name] is not None and resolved[name].available
            ],
            "savedWriteTools": [
                name for name in configured_tools
                if resolved[name] is not None and resolved[name].access == "write"
            ],
            "unknownConfiguredTools": [
                name for name in configured_tools if resolved[name] is None
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
    result: dict[str, Any] = {
        "ok": True,
        "projectId": project_id,
        "deckId": deck_id,
        "deckRevision": revision,
        "cards": cards,
        "wires": wires,
    }
    selected_id = str(args.get("cardId") or "").strip()
    if selected_id:
        result["selectedCard"] = find_saved_card(deck, selected_id)
        result["projectCodeFolder"] = deck.get("projectCodeFolder")
    if args.get("includeCatalog") is True:
        if caller_card_id != "builder":
            raise ApplicationToolError("builder_idd_projection_requires_builder")
        if not selected_id:
            raise ApplicationToolError("cardId_required_for_catalog")
        catalog = await asyncio.to_thread(
            request_backend_json,
            "GET",
            "/api/idd/card-editor?" + urlencode({
                "projectId": project_id,
                "deckId": deck_id,
                "cardId": selected_id,
            }),
        )
        if catalog.get("ok") is not True:
            raise ApplicationToolError("card_editor_catalog_unavailable")
        result["catalog"] = catalog
    return result


def _validated_wire_request(
    args: dict[str, Any],
) -> tuple[str, dict[str, Any], str, str, str, str, str, str]:
    _require(args, "projectId", "deckId", "op")
    op = str(args["op"]).strip()
    if op not in ("upsert", "remove"):
        raise ApplicationToolError(f"wire_op_invalid: {op}")
    wire = args.get("wire")
    if not isinstance(wire, dict):
        raise ApplicationToolError("wire_object_required")
    source = str(wire.get("source") or "").strip()
    target = str(wire.get("target") or "").strip()
    edge_type = str(wire.get("edgeType") or "").strip()
    wire_id = str(wire.get("id") or "").strip()
    if edge_type and edge_type not in SUPPORTED_WIRE_TYPES:
        raise ApplicationToolError(f"wire_edge_type_unsupported: {edge_type}")
    if op == "upsert" and (not source or not target):
        raise ApplicationToolError("wire_source_and_target_required")
    project_id = str(args["projectId"]).strip()
    deck_id = str(args["deckId"]).strip()
    return op, wire, source, target, edge_type, wire_id, project_id, deck_id


def _upsert_wire_in_deck(
    *,
    cards: dict[str, dict[str, Any]],
    edges: list[dict[str, Any]],
    wire: dict[str, Any],
    source: str,
    target: str,
    resolved_type: str,
    resolved_id: str,
    prior: dict[str, Any] | None,
) -> tuple[list[dict[str, Any]], bool]:
    from app.python_models.agentgraph_topology import (
        parse_card_edge,
        validate_card_topology,
    )
    from app.python_models.saved_card_contract import CardDomainError

    if source not in cards or target not in cards:
        raise ApplicationToolError(f"wire_endpoints_not_in_deck: {source}->{target}")
    candidate = {
        **(prior or {}),
        **wire,
        "id": resolved_id,
        "source": source,
        "target": target,
        "edgeType": resolved_type,
    }
    blue = resolved_type == "magentic_option"
    reversed_blue = bool(
        blue and prior and (prior["source"], prior["target"]) == (target, source)
    )
    if reversed_blue:
        for field, old_field in (
            ("sourceHandle", "targetHandle"),
            ("targetHandle", "sourceHandle"),
        ):
            if field not in wire:
                candidate.pop(field, None)
                if old_field in prior:
                    candidate[field] = prior[old_field]
    if blue:
        bus_count = sum(
            isinstance(cards[key].get("runtime"), dict)
            and cards[key]["runtime"].get("kind") == "hermes"
            and cards[key]["runtime"].get("mode") == "magentic_one"
            for key in (source, target)
        )
        if bus_count != 1:
            raise ApplicationToolError("wire_magnetic_taskgraph_endpoint_required")
    for edge in edges:
        same_endpoints = (
            {edge["source"], edge["target"]} == {source, target}
            if blue
            else (edge["source"], edge["target"]) == (source, target)
        )
        if (
            edge["id"] != resolved_id
            and edge["edgeType"] == resolved_type
            and same_endpoints
        ):
            raise ApplicationToolError("wire_connection_duplicate")
    try:
        parse_card_edge(candidate)
        prospective_edges = (
            [candidate if edge.get("id") == resolved_id else edge for edge in edges]
            if prior is not None
            else [*edges, candidate]
        )
        validate_card_topology(list(cards.values()), prospective_edges)
    except CardDomainError as error:
        raise ApplicationToolError(str(error)) from error
    comparable = dict(candidate)
    if reversed_blue:
        comparable["source"], comparable["target"] = target, source
        comparable.pop("sourceHandle", None)
        comparable.pop("targetHandle", None)
        if "targetHandle" in candidate:
            comparable["sourceHandle"] = candidate["targetHandle"]
        if "sourceHandle" in candidate:
            comparable["targetHandle"] = candidate["sourceHandle"]
    if prior == comparable:
        return edges, False
    return (
        [*edges, candidate]
        if prior is None
        else [candidate if edge["id"] == resolved_id else edge for edge in edges]
    ), True


def _apply_wire_update(
    *,
    project_id: str,
    deck_id: str,
    op: str,
    wire: dict[str, Any],
    source: str,
    target: str,
    edge_type: str,
    wire_id: str,
) -> dict[str, Any]:
    deck, revision = load_saved_deck(project_id, deck_id)
    cards = {str(node.get("id") or ""): node for node in deck.get("nodes") or []}
    edges = list(deck.get("edges") or [])
    prior = next((edge for edge in edges if edge.get("id") == wire_id), None)
    resolved_type = edge_type or (prior or {}).get("edgeType") or "flow"
    resolved_id = wire_id or f"{source}->{target}:{resolved_type}"
    if prior is None:
        prior = next((edge for edge in edges if edge.get("id") == resolved_id), None)
    changed = True
    if op == "upsert":
        edges, changed = _upsert_wire_in_deck(
            cards=cards,
            edges=edges,
            wire=wire,
            source=source,
            target=target,
            resolved_type=resolved_type,
            resolved_id=resolved_id,
            prior=prior,
        )
    else:
        before = len(edges)
        edges = [edge for edge in edges if str(edge.get("id") or "") != resolved_id]
        if len(edges) == before:
            raise ApplicationToolError(f"wire_not_found: {resolved_id}")
    if changed:
        deck["edges"] = edges
        save_saved_deck(project_id, deck_id, deck, revision)
    return {
        "ok": True,
        "op": op,
        "wireId": resolved_id,
        "edgeType": resolved_type,
    }


async def canvas_upsert_wire(args: dict[str, Any]) -> dict[str, Any]:
    (
        op, wire, source, target, edge_type, wire_id, project_id, deck_id,
    ) = _validated_wire_request(args)

    def apply() -> dict[str, Any]:
        return _apply_wire_update(
            project_id=project_id,
            deck_id=deck_id,
            op=op,
            wire=wire,
            source=source,
            target=target,
            edge_type=edge_type,
            wire_id=wire_id,
        )

    return await asyncio.to_thread(apply)
