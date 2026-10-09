"""ThinkGraph presentation projection from the Engraphis service."""
from __future__ import annotations

from copy import deepcopy
import hashlib
import json
import math
from typing import Any

from engraphis import __version__ as ENGRAPHIS_VERSION

from .engraphis import (
    THINK_INCIDENCE_KIND,
    bounded_graph_snapshot,
    endpoint_thinks,
    newest_think_sort_key,
    validated_think_metadata,
    get_service,
    project_id,
)
from .engraphis_operations import inspect
from .thinkgraph_relationship_classification import winner_probability


def _projection_subject_directory(project: str) -> dict[str, Any] | None:
    """Attach one current cross-authority identity snapshot when both owners read."""

    from app.python_models.canonical_subject_directory import (
        build_canonical_subject_directory,
    )
    from app.python_models.data_anchor_contract import DataAnchorError

    try:
        return build_canonical_subject_directory(project)
    except DataAnchorError:
        # ThinkGraph remains independently readable when KnowGraph is unavailable.
        # Joined then fails closed because it has no complete authority snapshot.
        return None


def _bounded_entity_nodes(
    store: Any,
    *,
    project: str,
    workspace_id: str,
    ordered_entities: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], bool]:
    latest_thinks: list[dict[str, Any]] = []
    for node in ordered_entities:
        latest_thinks.extend(endpoint_thinks(
            store,
            workspace_id=workspace_id,
            canonical_id=str(node["id"]),
            limit=2,
        ))
    think_limit_hit = len(latest_thinks) > 24
    latest_thinks = latest_thinks[:24]
    think_by_entity: dict[str, list[dict[str, Any]]] = {}
    for think in latest_thinks:
        think_by_entity.setdefault(str(think["entity_id"]), []).append(think)

    nodes: list[dict[str, Any]] = []
    for engraphis_entity in ordered_entities:
        entity_id = str(engraphis_entity["id"])
        title = str(engraphis_entity.get("name") or entity_id)
        evidence = [{
            "id": think["memory_id"],
            "title": think["title"],
            "summary": think["content"],
            "content": think["content"],
            "metadata": {"relations": deepcopy(think["relations"])},
            "validFrom": think.get("valid_from"),
            "validTo": think.get("valid_to"),
            "ingestedAt": think.get("ingested_at"),
        } for think in think_by_entity.get(entity_id, [])]
        nodes.append({
            "id": entity_id,
            "canonicalId": str(engraphis_entity.get("canonical_id") or entity_id),
            "canonicalName": title,
            "entityKind": str(engraphis_entity.get("type") or "Concept"),
            "label": title,
            "title": title,
            "type": str(engraphis_entity.get("type") or "Concept"),
            "authority": "engraphis",
            "projectId": project,
            "member_ids": [entity_id],
            "focus": bool(engraphis_entity.get("focus")),
            "mentionCount": len(evidence),
            "properties": {
                "nodeType": str(engraphis_entity.get("type") or "Concept"),
                "focus": bool(engraphis_entity.get("focus")),
                "evidence": evidence,
            },
        })
    return nodes, think_limit_hit


def _bounded_entity_edges(
    relationships: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    edges: list[dict[str, Any]] = []
    for engraphis_relationship in relationships:
        strength_value = engraphis_relationship.get("relationship_strength")
        try:
            strength = float(strength_value)
        except (TypeError, ValueError, OverflowError):
            strength = None
        if strength is not None and not math.isfinite(strength):
            strength = None
        relation = str(engraphis_relationship.get("relation") or "")
        label = relation
        if strength is not None:
            label = f"{relation} · {strength:.2f}".replace(" 0.", " .")
        jev = {
            "distribution": deepcopy(engraphis_relationship.get("distribution") or {}),
            "label_confidence": engraphis_relationship.get("label_confidence"),
            "relationship_strength": strength,
        }
        edge = {
            "id": str(engraphis_relationship["id"]),
            "source": str(engraphis_relationship["source_id"]),
            "target": str(engraphis_relationship["target_id"]),
            "predicate": relation,
            "relation": relation,
            "label": label,
            "directed": True,
            "properties": {
                "directed": True,
                "relationship_strength": strength,
                "label_confidence": engraphis_relationship.get("label_confidence"),
                "jev": jev,
            },
        }
        if strength is not None:
            edge.update({
                "relationship_strength": strength,
                "label_confidence": engraphis_relationship.get("label_confidence"),
                "strength": strength,
                "spring_strength": 0.035 + (0.17 * strength),
                "rest_length": max(14.0, min(34.0, 26.0 - (12.0 * strength))),
            })
        edges.append(edge)
    return edges


def _bounded_entity_projection(
    service: Any,
    *,
    project: str,
    entity_id: str,
) -> dict[str, Any]:
    """Project one exact entity plus at most 24 direct Engraphis relationships."""

    store = service.store
    workspace = store.conn.execute(
        "SELECT id FROM workspaces WHERE name=?", (project,),
    ).fetchone()
    workspace_id = str(workspace["id"]) if workspace is not None else ""
    snapshot = bounded_graph_snapshot(
        store,
        workspace_id=workspace_id,
        entity_ids=[entity_id],
        edge_limit=24,
        think_limit=0,
    ) if workspace_id else {
        "nodes": [], "incident_edges": [], "truncated": False,
        "incomplete": False,
        "limits": {
            "edge_limit": 24, "think_limit": 0,
            "edge_source_limit_hit": False,
            "think_source_limit_hit": False,
        },
    }
    ordered_entities = sorted(
        snapshot["nodes"],
        key=lambda node: (not bool(node.get("focus")), str(node.get("id") or "")),
    )
    nodes, think_limit_hit = _bounded_entity_nodes(
        store,
        project=project,
        workspace_id=workspace_id,
        ordered_entities=ordered_entities,
    )
    edges = _bounded_entity_edges(snapshot["incident_edges"])

    incomplete = bool(snapshot.get("incomplete")) or think_limit_hit
    truncated = bool(snapshot.get("truncated")) or think_limit_hit
    bounds = {
        "scope": "direct-engraphis-neighborhood",
        "neighborLimit": 24,
        "edgeLimit": 24,
        "thinkLimit": 24,
        "edgeSourceLimitHit": bool(
            snapshot.get("limits", {}).get("edge_source_limit_hit")
        ),
        "thinkLimitHit": think_limit_hit,
    }
    revision = hashlib.sha256(
        json.dumps([nodes, edges, bounds], sort_keys=True).encode("utf-8")
    ).hexdigest()
    scene = {
        "nodes": deepcopy(nodes),
        "edges": deepcopy(edges),
        "links": deepcopy(edges),
        "meta": {
            "truncated": truncated,
            "incomplete": incomplete,
            "bounds": bounds,
        },
    }
    return {
        "schemaVersion": "thinkgraph.engraphis.v1",
        "authority": "engraphis",
        "projectId": project,
        "revision": revision,
        "nodes": nodes,
        "edges": edges,
        "scene": scene,
        "counts": {"nodes": len(nodes), "edges": len(edges)},
        "truncated": truncated,
        "incomplete": incomplete,
        "bounds": bounds,
        "embedding": {
            "state": "ready"
            if service.stats(workspace=project).get("embedding", {}).get("ready")
            else "unavailable"
        },
        "runtime": {"engine": "engraphis", "version": ENGRAPHIS_VERSION},
    }


def _apply_jev_scene_presentation(
    scene: dict[str, Any],
    engraphis_edges: dict[str, Any],
) -> None:
    """Apply persisted Jev labels and local semantic mass to one scene."""

    semantic_mass = {node["id"]: 0.0 for node in scene["nodes"]}
    for edge in scene["edges"]:
        edge_ids = edge.get("underlying_edge_ids") or [edge.get("id")]
        jev_edges = [
            engraphis_edges[edge_id]
            for edge_id in edge_ids
            if edge_id in engraphis_edges
            and isinstance(engraphis_edges[edge_id].provenance, dict)
            and isinstance(engraphis_edges[edge_id].provenance.get("jev"), dict)
        ]
        if not jev_edges:
            continue
        chosen = max(
            jev_edges,
            key=lambda item: winner_probability(item.provenance["jev"]),
        )
        jev = deepcopy(chosen.provenance["jev"])
        strength = winner_probability(jev)
        jev["label_confidence"] = strength
        jev["relationship_strength"] = strength
        probability_text = f"{strength:.2f}".removeprefix("0")
        edge.update({
            "relation": chosen.relation,
            "label": f"{chosen.relation} · {probability_text}",
            "label_min_scale": 0.35,
            "directional_arrow_length": 3.0,
            "directional_arrow_rel_pos": 0.9,
            "relationship_strength": strength,
            "label_confidence": float(jev["label_confidence"]),
            "strength": strength,
            "spring_strength": 0.035 + (0.17 * strength),
            "rest_length": max(14.0, min(34.0, 26.0 - (12.0 * strength))),
            "jev": jev,
        })
        if edge.get("source") in semantic_mass:
            semantic_mass[edge["source"]] += strength
        if edge.get("target") in semantic_mass:
            semantic_mass[edge["target"]] += strength
    for node in scene["nodes"]:
        mass = semantic_mass[node["id"]]
        node["semantic_mass"] = mass
        if mass > 0:
            node["gravity_mass"] = 1.0 + (4.0 * math.log1p(mass))
            node["visual_radius"] = 2.5 + (3.0 * math.log1p(mass))


def _scene_think_evidence(
    service: Any,
    *,
    project: str,
    scene: dict[str, Any],
) -> tuple[dict[str, dict[str, Any]], dict[str, list[str]]]:
    """Read the exact Engraphis Think incidences used by scene nodes and edges."""

    entity_members = {
        node["id"]: node.get("member_ids", [node["id"]]) for node in scene["nodes"]
    }
    incidences = service.store.list_memory_entities(entity_ids=list(dict.fromkeys(
        member for members in entity_members.values() for member in members
    )))
    direct_incidence_ids = list(dict.fromkeys(
        str(row["memory_id"]) for row in incidences
        if row.get("source_kind") == THINK_INCIDENCE_KIND
    ))
    direct_memories = service.store.get_memories(direct_incidence_ids)
    valid_think_ids = {
        memory_id for memory_id, memory in direct_memories.items()
        if validated_think_metadata(memory) is not None
    }
    entity_thinks = {node_id: list(dict.fromkeys(
        row["memory_id"] for row in incidences
        if row["entity_id"] in members
        and row.get("source_kind") == THINK_INCIDENCE_KIND
        and row["memory_id"] in valid_think_ids
    )) for node_id, members in entity_members.items()}
    evidence_groups = [edge.get("support_memory_ids", []) for edge in scene["edges"]]
    evidence_groups.extend(entity_thinks.values())
    supporting: dict[str, dict[str, Any]] = {}
    for memory_ids in evidence_groups:
        for memory_id in memory_ids:
            if memory_id in supporting:
                continue
            memory = inspect(project, "engraphisMemoryId", memory_id)["memory"]
            supporting[memory_id] = {
                "id": memory_id,
                "title": memory["title"],
                "summary": memory.get("summary") or memory["content"],
                "provenance": memory.get("provenance", {}),
                "metadata": memory.get("metadata", {}),
                "validFrom": memory.get("valid_from"),
                "validTo": memory.get("valid_to"),
                "validToRecordedAt": memory.get("valid_to_recorded_at"),
                "ingestedAt": memory.get("ingested_at"),
                "expiredAt": memory.get("expired_at"),
            }
    return supporting, entity_thinks


def _project_scene_nodes(
    scene: dict[str, Any],
    *,
    project: str,
    supporting: dict[str, dict[str, Any]],
    entity_thinks: dict[str, list[str]],
) -> list[dict[str, Any]]:
    nodes: list[dict[str, Any]] = []
    for node in scene["nodes"]:
        evidence_ids = list(dict.fromkeys(entity_thinks[node["id"]]))
        evidence_ids.sort(
            key=lambda memory_id: newest_think_sort_key(supporting[memory_id])
            if memory_id in supporting else (0.0, memory_id)
        )
        nodes.append({
            **node,
            "canonicalId": node["id"],
            "canonicalName": node["label"],
            "entityKind": node["type"],
            "title": node["label"],
            "type": node["type"],
            "authority": "engraphis",
            "projectId": project,
            "mentionCount": node.get("support_count", 0),
            "properties": {
                **node.get("properties", {}),
                "x": node["x"],
                "y": node["y"],
                "nodeType": node["type"],
                "communityId": node.get("community_id"),
                "semantic_mass": node.get("semantic_mass", 0.0),
                "gravity_mass": node.get("gravity_mass"),
                "visual_radius": node.get("visual_radius"),
                "evidence": [
                    supporting[memory_id]
                    for memory_id in evidence_ids
                    if memory_id in supporting
                ],
            },
        })
    return nodes


def _project_scene_edges(
    scene: dict[str, Any],
    supporting: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    return [{
        **edge,
        "predicate": edge["relation"],
        "mentionCount": edge.get("support_count", 0),
        "properties": {
            **edge.get("properties", {}),
            "layer": edge.get("layer"),
            "strength": edge.get("strength"),
            "relationship_strength": edge.get("relationship_strength"),
            "label_confidence": edge.get("label_confidence"),
            "jev": edge.get("jev"),
            "directed": edge.get("directed", True),
            "evidence": [
                supporting[memory_id]
                for memory_id in edge.get("support_memory_ids", [])
                if memory_id in supporting
            ],
        },
    } for edge in scene["edges"]]


def projection(project: str, entity_id: str | None = None) -> dict:
    service = get_service()
    project = project_id(project)
    if entity_id:
        return _bounded_entity_projection(
            service,
            project=project,
            entity_id=str(entity_id),
        )
    # Engraphis supplies the scene. This adapter only adds display field aliases
    # and resolves evidence IDs returned by the engine.
    scene = service.graph_scene(workspace=project, level="complete", presentation="quality",
        include_memory_nodes=False, include_weak_cooccurrence=False)
    scene_member_ids = list(dict.fromkeys(
        member
        for node in scene["nodes"]
        for member in node.get("member_ids", [node["id"]])
    ))
    engraphis_edges = {
        edge.id: edge for edge in service.store.neighbors(scene_member_ids)
    } if scene_member_ids else {}
    _apply_jev_scene_presentation(scene, engraphis_edges)
    supporting, entity_thinks = _scene_think_evidence(
        service,
        project=project,
        scene=scene,
    )
    nodes = _project_scene_nodes(
        scene,
        project=project,
        supporting=supporting,
        entity_thinks=entity_thinks,
    )
    edges = _project_scene_edges(scene, supporting)
    revision = hashlib.sha256(json.dumps([nodes, edges], sort_keys=True).encode()).hexdigest()
    return {"schemaVersion": "thinkgraph.engraphis.v1", "authority": "engraphis", "projectId": project,
            "revision": revision, "nodes": nodes, "edges": edges, "scene": scene,
            "counts": {"nodes": len(nodes), "edges": len(edges)},
            "truncated": scene["meta"]["truncated"],
            "canonicalSubjectDirectory": _projection_subject_directory(project),
            "embedding": {"state": "ready" if service.stats(workspace=project).get("embedding", {}).get("ready") else "unavailable"},
            "runtime": {"engine": "engraphis", "version": ENGRAPHIS_VERSION}}
