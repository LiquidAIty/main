"""Saved AGE Card topology and authorization projections."""

from __future__ import annotations

import re
from typing import Any

from app.python_models import agentgraph_query
from app.python_models.postgres import connect_postgres
from app.python_models.project_worldview import (
    ProjectWorldviewError,
    resolve_project_worldview,
)
from app.python_models.saved_card_contract import (
    CardDomainError,
    card_is_enabled,
    card_runtime,
    is_magnetic_taskgraph_runtime,
    json_object,
    required_text,
    string_list,
)

_TEAM_CARD_ID = "card_team"

_HERMES_PROFILE_ID_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")

_PUBLIC_CARD_ADDRESS_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")


def _edge_labels() -> dict[str, str]:
    """Exact AGE transport labels; builder relationship descriptions grant nothing."""
    return {"flow": "FLOW", "magentic_option": "MAGENTIC_OPTION"}


def ensure_card_vertex(cursor: Any, project_id: str, deck_id: str, card_id: str) -> None:
    agentgraph_query.execute_fixed_agentgraph_query(
        cursor,
        """
        MERGE (card:Card {projectId: $projectId, deckId: $deckId, cardId: $cardId})
        RETURN properties(card)
        """,
        {"projectId": project_id, "deckId": deck_id, "cardId": card_id},
        "value agtype",
    )


def parse_card_edge(edge: dict[str, Any]) -> dict[str, Any]:
    edge_type = required_text(edge.get("edgeType"), "edge_type")
    if edge_type not in _edge_labels():
        raise CardDomainError(f"edge_type_unsupported:{edge_type}")
    edge_id = required_text(edge.get("id"), "edge_id")
    source = required_text(edge.get("source"), "edge_source")
    target = required_text(edge.get("target"), "edge_target")
    for field in ("sourceHandle", "targetHandle"):
        if edge.get(field) is not None and not isinstance(edge[field], str):
            raise CardDomainError(f"edge_handle_invalid:{field}")
    if "enabled" in edge and not isinstance(edge["enabled"], bool):
        raise CardDomainError("edge_enabled_invalid")
    presentation = {
        key: value for key, value in edge.items()
        if key not in {"id", "source", "target", "edgeType", "sourceHandle", "targetHandle"}
    }
    return {
        "id": edge_id,
        "source": source,
        "target": target,
        "edgeType": edge_type,
        "sourceHandle": edge.get("sourceHandle"),
        "targetHandle": edge.get("targetHandle"),
        "presentation": presentation,
    }


def upsert_card_relationship(
    cursor: Any,
    project_id: str,
    deck_id: str,
    edge: dict[str, Any],
    ordinal: int,
) -> None:
    core = parse_card_edge(edge)
    label = _edge_labels()[core["edgeType"]]
    query = f"""
        MATCH (source:Card {{projectId: $projectId, deckId: $deckId, cardId: $source}})
        MATCH (target:Card {{projectId: $projectId, deckId: $deckId, cardId: $target}})
        MERGE (source)-[edge:{label} {{edgeId: $edgeId}}]->(target)
        SET edge.edgeType = $edgeType,
            edge.direction = 'source-to-target',
            edge.sourceHandle = $sourceHandle,
            edge.targetHandle = $targetHandle,
            edge.ordinal = $ordinal,
            edge.presentation = $presentation
        RETURN properties(edge)
    """
    rows = agentgraph_query.execute_fixed_agentgraph_query(
        cursor,
        query,
        {
            "projectId": project_id,
            "deckId": deck_id,
            "source": core["source"],
            "target": core["target"],
            "edgeId": core["id"],
            "edgeType": core["edgeType"],
            "sourceHandle": core["sourceHandle"],
            "targetHandle": core["targetHandle"],
            "ordinal": ordinal,
            "presentation": core["presentation"],
        },
        "value agtype",
    )
    if len(rows) != 1:
        raise CardDomainError(f"age_edge_upsert_failed:{core['id']}")


def delete_card_relationship(cursor: Any, project_id: str, deck_id: str, edge: dict[str, Any]) -> None:
    core = parse_card_edge(edge)
    label = _edge_labels()[core["edgeType"]]
    rows = agentgraph_query.execute_fixed_agentgraph_query(
        cursor,
        f"""
        MATCH (:Card {{projectId: $projectId, deckId: $deckId}})
              -[edge:{label} {{edgeId: $edgeId}}]->
              (:Card {{projectId: $projectId, deckId: $deckId}})
        DELETE edge
        RETURN $edgeId
        """,
        {"projectId": project_id, "deckId": deck_id, "edgeId": core["id"]},
        "value agtype",
    )
    if len(rows) != 1:
        raise CardDomainError(f"age_edge_delete_failed:{core['id']}")


def load_card_relationships(cursor: Any, project_id: str, deck_id: str) -> list[dict[str, Any]]:
    edges: list[dict[str, Any]] = []
    for edge_type, label in _edge_labels().items():
        rows = agentgraph_query.execute_fixed_agentgraph_query(
            cursor,
            f"""
            MATCH (source:Card {{projectId: $projectId, deckId: $deckId}})
                  -[edge:{label}]->
                  (target:Card {{projectId: $projectId, deckId: $deckId}})
            RETURN source.cardId, target.cardId, properties(edge)
            """,
            {"projectId": project_id, "deckId": deck_id},
            "source agtype, target agtype, properties agtype",
        )
        for row in rows:
            props = row.get("properties") if isinstance(row.get("properties"), dict) else {}
            presentation = props.get("presentation") if isinstance(props.get("presentation"), dict) else {}
            value = {
                **presentation,
                "id": str(props.get("edgeId") or ""),
                "source": str(row.get("source") or ""),
                "target": str(row.get("target") or ""),
                "edgeType": edge_type,
            }
            if props.get("sourceHandle") is not None:
                value["sourceHandle"] = props["sourceHandle"]
            if props.get("targetHandle") is not None:
                value["targetHandle"] = props["targetHandle"]
            edges.append((int(props.get("ordinal") or 0), value))
    return [value for _, value in sorted(edges, key=lambda item: (item[0], item[1]["id"]))]


def card_has_orchestrator_authority(card: dict[str, Any]) -> bool:
    """Return saved outbound orange authority for one non-Magnetic Hermes Card."""
    if card.get("kind") != "agent" or not card_is_enabled(card):
        return False
    try:
        runtime = card_runtime(card)
    except CardDomainError:
        return False
    options = card.get("runtimeOptions")
    explicitly_enabled = (
        isinstance(options, dict) and options.get("orchestrator") is True
    )
    return (
        runtime.get("kind") == "hermes"
        and not is_magnetic_taskgraph_runtime(runtime)
        and (runtime.get("mode") == "main" or explicitly_enabled)
    )


def _is_callable_magnetic_taskgraph_worker_card(card: dict[str, Any]) -> bool:
    """Accept enabled saved delegate Cards with a callable Hermes runtime.

    Orange orchestration authority and blue Magnetic availability are
    independent saved relationships.  A delegate may therefore remain a
    Magnetic worker while its own outbound orange roster is enabled.  Main is
    still the front door rather than a Magnetic worker, and Magnetic itself is
    still the bus.
    """
    try:
        runtime = card_runtime(card)
    except CardDomainError:
        return False
    return (
        runtime.get("kind") == "hermes"
        and runtime.get("mode") == "delegate"
        and card_is_enabled(card)
    )


def _validate_single_master_topology(
    cards: dict[str, dict[str, Any]],
    edges: list[dict[str, Any]],
) -> None:
    """Keep one controller per topology while orange and blue stay independent."""

    flow_masters: dict[str, set[str]] = {}
    magnetic_masters: dict[str, set[str]] = {}
    for edge in edges:
        if edge.get("enabled") is False:
            continue
        edge_type = edge.get("edgeType")
        source_id = str(edge.get("source") or "")
        target_id = str(edge.get("target") or "")
        if edge_type == "flow":
            source = cards.get(source_id)
            target = cards.get(target_id)
            if (
                source is not None
                and target is not None
                and card_has_orchestrator_authority(source)
                and not is_magnetic_taskgraph_runtime(card_runtime(target))
            ):
                flow_masters.setdefault(target_id, set()).add(source_id)
        elif edge_type == "magentic_option":
            source = cards.get(source_id)
            target = cards.get(target_id)
            if source is None or target is None:
                continue
            source_is_magnetic = is_magnetic_taskgraph_runtime(card_runtime(source))
            target_is_magnetic = is_magnetic_taskgraph_runtime(card_runtime(target))
            if source_is_magnetic == target_is_magnetic:
                continue
            master_id = source_id if source_is_magnetic else target_id
            worker_id = target_id if source_is_magnetic else source_id
            if not _is_callable_magnetic_taskgraph_worker_card(cards[worker_id]):
                raise CardDomainError(f"card_master_conflict:{worker_id}")
            magnetic_masters.setdefault(worker_id, set()).add(master_id)
    for topology_masters in (flow_masters, magnetic_masters):
        for card_id, master_ids in topology_masters.items():
            if len(master_ids) > 1:
                raise CardDomainError(f"card_master_conflict:{card_id}")


def validate_card_topology(nodes: list[dict[str, Any]], edges: list[dict[str, Any]]) -> None:
    cards = {card["id"]: card for card in nodes}
    _validate_single_master_topology(cards, edges)
    addressable_ids = {
        endpoint
        for edge in edges
        if edge.get("edgeType") == "flow" and edge.get("enabled") is not False
        for endpoint in (edge["source"], edge["target"])
    }
    addresses: dict[str, str] = {}
    for card_id in sorted(addressable_ids):
        card = cards.get(card_id)
        if card is None:
            continue
        title = required_text(card.get("title"), "card_title")
        if not _PUBLIC_CARD_ADDRESS_RE.fullmatch(title):
            raise CardDomainError(f"card_address_invalid:{card_id}")
        folded = title.casefold()
        prior = addresses.get(folded)
        if prior is not None and prior != card_id:
            raise CardDomainError(f"card_address_duplicate:{folded}")
        addresses[folded] = card_id
    for edge in edges:
        if edge.get("edgeType") != "flow":
            continue
        if edge.get("enabled") is False:
            continue
        targets = direct_orchestrator_targets(edge["source"], cards, [edge])
        if not any(target["cardId"] == edge["target"] for target in targets):
            raise CardDomainError(f"card_connection_controller_required:{edge['id']}")


def connected_hermes_card_targets(
    card_id: str,
    cards: dict[str, dict[str, Any]],
    edges: list[dict[str, Any]],
    *,
    edge_type: str,
    strict: bool = False,
) -> list[dict[str, Any]]:
    """Project exact saved Hermes Card peers from one enabled connection type."""
    profiles = [
        str(runtime.get("profile") or "").strip().lower()
        for card in cards.values()
        if isinstance(runtime := card.get("runtime"), dict) and runtime.get("kind") == "hermes"
    ]
    direct: list[dict[str, Any]] = []
    seen: set[str] = set()
    for edge in edges:
        source_id = str(edge.get("source") or "")
        target_id = str(edge.get("target") or "")
        if source_id == card_id:
            peer_id = target_id
        elif target_id == card_id:
            peer_id = source_id
        else:
            continue
        target = cards.get(peer_id)
        if (
            edge.get("edgeType") != edge_type
            or edge.get("enabled") is False
            or peer_id == card_id
            or peer_id in seen
        ):
            continue
        if target is None:
            if strict:
                raise CardDomainError(f"magnetic_taskgraph_worker_card_missing:{peer_id}")
            continue
        if target.get("kind") != "agent":
            if strict:
                raise CardDomainError(f"magnetic_taskgraph_worker_card_invalid:{peer_id}")
            continue
        if not card_is_enabled(target):
            if strict:
                raise CardDomainError(f"magnetic_taskgraph_worker_card_disabled:{peer_id}")
            continue
        try:
            runtime = card_runtime(target)
        except CardDomainError:
            if strict:
                raise
            continue
        if runtime.get("kind") != "hermes":
            if strict:
                raise CardDomainError(f"magnetic_taskgraph_worker_runtime_invalid:{peer_id}")
            continue
        if is_magnetic_taskgraph_runtime(runtime) and edge_type != "flow":
            if strict:
                raise CardDomainError(f"magnetic_taskgraph_worker_runtime_invalid:{peer_id}")
            continue
        profile = runtime["profile"].strip().lower()
        if not _HERMES_PROFILE_ID_RE.fullmatch(profile):
            if strict:
                raise CardDomainError(f"runtime_profile_invalid:{profile or 'missing'}")
            continue
        if profiles.count(profile) != 1:
            if strict:
                raise CardDomainError(f"card_profile_duplicate:{profile}")
            continue
        revision_id = str(target.get("_cardRevisionId") or "").strip()
        if strict and not revision_id:
            raise CardDomainError(f"magnetic_taskgraph_worker_revision_missing:{peer_id}")
        options = json_object(target.get("runtimeOptions"), "runtime_options")
        seen.add(peer_id)
        direct.append({
            "cardId": peer_id,
            "title": str(target.get("title") or peer_id),
            "profile": runtime["profile"],
            "description": str(target.get("subtitle") or "")[:1_000],
            "cardRevisionId": revision_id,
            **({
                "teamTaskMode": True,
                "provider": {
                    "provider": options.get("provider") or target.get("provider"),
                    "accessMode": options.get("accessMode"),
                    "modelKey": options.get("modelKey"),
                    "providerModelId": (
                        options.get("providerModelId")
                        or target.get("providerModelId")
                        or options.get("modelKey")
                    ),
                },
                "runtimeOptions": {
                    "modelKey": options.get("modelKey"),
                    "providerModelId": (
                        options.get("providerModelId")
                        or target.get("providerModelId")
                        or options.get("modelKey")
                    ),
                },
            } if peer_id == _TEAM_CARD_ID else {}),
        })
    return direct


def materialize_magnetic_worker_capabilities(
    project_id: str,
    workers: list[dict[str, Any]],
    cards: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    """Add compact saved/Project-eligible capability facts to exact workers.

    This is assignment metadata only. It grants no tool, carries no schemas or
    datasets, and does not replace the worker Card's normal Run-time
    Project/Card/Run intersection.
    """

    saved_by_card: dict[str, list[str]] = {}
    candidates: list[str] = []
    for worker in workers:
        card_id = str(worker.get("cardId") or "")
        card = cards.get(card_id)
        if card is None:
            raise CardDomainError(
                f"magnetic_taskgraph_worker_card_missing:{card_id or 'missing'}"
            )
        options = json_object(card.get("runtimeOptions"), "runtime_options")
        saved = string_list(options.get("tools"), "tools")
        saved_by_card[card_id] = saved
        candidates.extend(saved)
    try:
        worldview = resolve_project_worldview(
            project_id,
            list(dict.fromkeys(candidates)),
            connector=connect_postgres,
        )
    except ProjectWorldviewError as error:
        raise CardDomainError(str(error)) from error
    enabled = set(worldview["enabledCapabilities"])
    projected: list[dict[str, Any]] = []
    for worker in workers:
        card_id = str(worker["cardId"])
        saved = saved_by_card[card_id]
        projected.append({
            **worker,
            "capabilities": {
                "savedToolIds": saved,
                "projectEligibleToolIds": [tool for tool in saved if tool in enabled],
            },
        })
    return projected


def direct_orchestrator_targets(
    card_id: str,
    cards: dict[str, dict[str, Any]],
    edges: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Project one saved orchestrator Card's Bots from outbound FLOW edges."""
    source = cards.get(card_id)
    if source is None or not card_has_orchestrator_authority(source):
        return []
    return connected_hermes_card_targets(
        card_id,
        cards,
        [edge for edge in edges if edge.get("source") == card_id],
        edge_type="flow",
    )
