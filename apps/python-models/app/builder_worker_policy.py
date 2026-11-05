"""Builder's blue-worker-only saved Card and wire authority."""

# Entity: Builder Card
# Relationship: This file restricts authenticated Builder writes to new ordinary workers and existing non-core blue workers while preserving every system Card.
# Entity: Magnetic Membership
# Relationship: This file treats enabled blue membership as Builder's exact editable-worker boundary and protects the fixed Team wildcard plus every other core Card.

from __future__ import annotations

from typing import Any

from app.application_tool_error import ApplicationToolError


BUILDER_CARD_ID = "builder"
MAGNETIC_CARD_ID = "card_magentic"
PROTECTED_SYSTEM_CARD_IDS = frozenset({
    "card_main_chat",
    "builder",
    "card_thinkgraph",
    "card_knowgraph",
    "card_team",
    MAGNETIC_CARD_ID,
})
PROTECTED_SYSTEM_PROFILES = frozenset({
    "main", "builder", "thinkgraph", "knowgraph", "team", "card_magentic",
})


def _is_builder(caller_card_id: str) -> bool:
    return str(caller_card_id or "").strip() == BUILDER_CARD_ID


def require_builder_worker_creation(
    caller_card_id: str,
    *,
    runtime_kind: str,
    runtime_mode: str,
    runtime_profile: str,
) -> None:
    if not _is_builder(caller_card_id):
        return
    if (
        runtime_kind != "hermes"
        or runtime_mode != "delegate"
        or runtime_profile in PROTECTED_SYSTEM_PROFILES
    ):
        raise ApplicationToolError("builder_can_create_only_blue_worker_candidates")


def _blue_worker_ids(deck: dict[str, Any]) -> set[str]:
    cards = {
        str(card.get("id") or ""): card
        for card in deck.get("nodes") or []
        if isinstance(card, dict)
    }
    result: set[str] = set()
    for edge in deck.get("edges") or []:
        if (
            not isinstance(edge, dict)
            or edge.get("enabled") is False
            or edge.get("edgeType") != "magentic_option"
        ):
            continue
        source = str(edge.get("source") or "")
        target = str(edge.get("target") or "")
        if source == MAGNETIC_CARD_ID and target in cards:
            result.add(target)
        elif target == MAGNETIC_CARD_ID and source in cards:
            result.add(source)
    return result


def require_builder_worker_update(
    caller_card_id: str,
    deck: dict[str, Any],
    target_card_id: str,
) -> None:
    if not _is_builder(caller_card_id):
        return
    target = str(target_card_id or "").strip()
    if (
        target in PROTECTED_SYSTEM_CARD_IDS
        or target not in _blue_worker_ids(deck)
    ):
        raise ApplicationToolError("builder_can_update_only_noncore_blue_workers")


def require_builder_wire_change(
    caller_card_id: str,
    deck: dict[str, Any],
    *,
    op: str,
    wire: dict[str, Any],
    prior: dict[str, Any] | None,
    resolved_type: str,
    source: str,
    target: str,
) -> None:
    if not _is_builder(caller_card_id):
        return
    effective = prior if op == "remove" else {**(prior or {}), **wire}
    edge_type = str(effective.get("edgeType") or resolved_type or "")
    effective_source = str(effective.get("source") or source or "")
    effective_target = str(effective.get("target") or target or "")
    endpoints = {effective_source, effective_target}
    if edge_type != "magentic_option" or MAGNETIC_CARD_ID not in endpoints:
        raise ApplicationToolError("builder_can_change_only_blue_worker_wires")
    peer = next((card_id for card_id in endpoints if card_id != MAGNETIC_CARD_ID), "")
    if not peer or peer in PROTECTED_SYSTEM_CARD_IDS:
        raise ApplicationToolError("builder_cannot_change_core_system_wires")
    cards = {
        str(card.get("id") or "")
        for card in deck.get("nodes") or []
        if isinstance(card, dict)
    }
    if peer not in cards:
        raise ApplicationToolError("builder_blue_worker_missing")
    if op == "upsert" and prior is None:
        raise ApplicationToolError("builder_new_worker_wire_is_created_with_card")
