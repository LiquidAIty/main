"""Accepted Jev-decision settlement into the Engraphis ThinkGraph."""

from __future__ import annotations

from copy import deepcopy
from typing import Any

from engraphis.core.interfaces import Edge, Node

from .engraphis import canonical_entity_id, existing_entity_for_name
from .thinkgraph_relationship_classification import (
    THINKGRAPH_JEV_ABSTAIN,
    current_jev_pair_edges,
    jev_provenance,
    winner_probability,
)
from .thinkgraph_relationship_vocabulary import (
    ThinkGraphIntakeError,
    project_relationship_vocabulary,
)


def _upsert_canonical_endpoint(
    store: Any,
    *,
    workspace_id: str,
    name: str,
) -> tuple[str, bool]:
    existing = existing_entity_for_name(
        store,
        workspace_id=workspace_id,
        name=name,
    )
    if existing is not None:
        return str(existing["id"]), False
    written_id = store.upsert_entity(
        Node(
            id="",
            name=name,
            ntype="person_or_concept",
            workspace_id=workspace_id,
            repo_id=None,
        ),
        commit=False,
    )
    canonical_id = canonical_entity_id(store, written_id) or written_id
    return canonical_id, canonical_id == written_id


def apply_accepted_decision(
    store: Any,
    *,
    workspace_id: str,
    payload: dict[str, Any],
    memory_id: str,
    relationship: dict[str, str],
    decision: dict[str, Any],
) -> dict[str, Any]:
    """Persist one Jev winner; the Card's free-form phrase is provenance only."""
    winner = str(decision.get("winner") or "")
    vocabulary = project_relationship_vocabulary(store, workspace_id)
    if winner not in vocabulary or winner == THINKGRAPH_JEV_ABSTAIN:
        raise ThinkGraphIntakeError(
            "thinkgraph_relationship_winner_not_canonical"
        )
    source_id, source_created = _upsert_canonical_endpoint(
        store,
        workspace_id=workspace_id,
        name=relationship["source"],
    )
    target_id, target_created = _upsert_canonical_endpoint(
        store,
        workspace_id=workspace_id,
        name=relationship["target"],
    )
    if not source_id or not target_id or source_id == target_id:
        raise ThinkGraphIntakeError("thinkgraph_relationship_endpoints_invalid")
    current = current_jev_pair_edges(
        store,
        workspace_id=workspace_id,
        source_id=source_id,
        target_id=target_id,
    )
    provenance = jev_provenance(
        decision,
        payload,
        memory_id=memory_id,
        natural_relationship=relationship["relation"],
    )
    replaced_ids: list[str] = []
    edge_weight = winner_probability(decision)
    if len(current) == 1 and current[0].relation == winner:
        existing = current[0]
        previous = (
            existing.provenance if isinstance(existing.provenance, dict) else {}
        )
        history = list(previous.get("jev_history") or [])
        if isinstance(previous.get("jev"), dict):
            history.append(deepcopy(previous["jev"]))
        provenance["jev_history"] = history
        edge_id = store.upsert_edge(
            Edge(
                id=existing.id,
                src=source_id,
                dst=target_id,
                relation=winner,
                weight=edge_weight,
                workspace_id=workspace_id,
                repo_id=None,
                valid_from=existing.valid_from,
                ingested_at=existing.ingested_at,
                provenance=provenance,
            ),
            commit=False,
        )
        status = "updated"
    else:
        for edge in current:
            store.invalidate_edge(edge.id, commit=False)
            replaced_ids.append(edge.id)
        edge_id = store.upsert_edge(
            Edge(
                id="",
                src=source_id,
                dst=target_id,
                relation=winner,
                weight=edge_weight,
                workspace_id=workspace_id,
                repo_id=None,
                provenance=provenance,
            ),
            commit=False,
        )
        status = "superseded" if replaced_ids else "written"
    return {
        **decision,
        "status": status,
        "edge_id": edge_id,
        "replaced_edge_ids": replaced_ids,
        "source": source_id,
        "target": target_id,
        "new_subjects": [
            {"canonicalName": name, "engraphisEntityId": entity_id}
            for name, entity_id, created in (
                (relationship["source"], source_id, source_created),
                (relationship["target"], target_id, target_created),
            )
            if created
        ],
        "relation": winner,
        "label_confidence": edge_weight,
        "relationship_strength": edge_weight,
    }
