"""Lightweight current Project Entity and Relationship map for model context."""
# Entity: Project Knowledge Graph
# Relationship: This file builds the bounded Project Entity directory and relationship map appended to Card context without copying Think or Know evidence bodies.
# Entity: ThinkGraph
# Relationship: This file projects current Jev-authored ThinkGraph relationships into the shared Project Entity map while preserving Engraphis identity.
# Entity: KnowGraph
# Relationship: This file projects current KnowGraph Entity relationships into the shared Project Entity map while preserving Graphiti identity and provenance state.

from __future__ import annotations

import hashlib
import math
import time
from typing import Any

from engraphis.core.interfaces import SearchFilter

from app.python_models.canonical_entity_directory import (
    build_canonical_entity_directory,
)
from app.python_models.data_anchor_contract import (
    GRAPH_CONTEXT_BYTE_LIMIT,
    DataAnchorError,
    canonical_json,
    json_safe,
)
from app.python_models.engraphis import (
    SERVICE_LOCK,
    canonical_entity_id,
    get_service,
    jev_edge_provenance,
    project_id,
)
from app.python_models.knowgraph_graphiti_read_support import (
    graphiti_project_scope_ids,
    knowgraph_driver,
    neo4j_rows,
    persisted_knowgraph_jev,
)


def _thinkgraph_relationships(project: str) -> list[dict[str, Any]]:
    service = get_service()
    project = project_id(project)
    with SERVICE_LOCK:
        workspace = service.store.conn.execute(
            "SELECT id FROM workspaces WHERE name=?", (project,)
        ).fetchone()
        if workspace is None:
            return []
        workspace_id = str(workspace["id"])
        entity_rows = service.store.conn.execute(
            "SELECT id, name, COALESCE(canonical_id,id) AS canonical_id "
            "FROM entities WHERE workspace_id=? AND repo_id IS NULL "
            "AND id=COALESCE(canonical_id,id) ORDER BY id",
            (workspace_id,),
        ).fetchall()
        names = {
            str(row["canonical_id"]): str(row["name"] or "")
            for row in entity_rows
            if str(row["canonical_id"] or "")
        }
        relationships: list[dict[str, Any]] = []
        for edge in service.store.edges_in_scope(
            SearchFilter(workspace_id=workspace_id)
        ):
            jev = jev_edge_provenance(edge)
            if jev is None:
                continue
            source_id = canonical_entity_id(service.store, edge.src) or edge.src
            target_id = canonical_entity_id(service.store, edge.dst) or edge.dst
            source_name = names.get(source_id, "")
            target_name = names.get(target_id, "")
            if not source_name or not target_name:
                raise DataAnchorError("project_entity_map_thinkgraph_endpoint_invalid")
            relationships.append({
                "authority": "thinkgraph",
                "engraphisRelationshipId": str(edge.id),
                "sourceEngraphisEntityId": str(source_id),
                "sourceCanonicalName": source_name,
                "targetEngraphisEntityId": str(target_id),
                "targetCanonicalName": target_name,
                "label": str(edge.relation),
                "state": json_safe({
                    "relationshipStrength": jev.get(
                        "relationship_strength", edge.weight
                    ),
                    "labelConfidence": jev.get("label_confidence"),
                    "distribution": jev.get("distribution") or {},
                }),
            })
    return sorted(
        relationships,
        key=lambda value: (
            value["sourceEngraphisEntityId"],
            value["label"],
            value["targetEngraphisEntityId"],
            value["engraphisRelationshipId"],
        ),
    )


def _knowgraph_relationships(project: str) -> list[dict[str, Any]]:
    scope_ids = graphiti_project_scope_ids(project)
    driver, database = knowgraph_driver()
    try:
        with driver.session(database=database) as session:
            count_rows = neo4j_rows(session.run(
                """
                MATCH (source:Entity)-[relationship]->(target:Entity)
                WHERE toString(source.group_id) IN $scopeIds
                  AND toString(target.group_id) IN $scopeIds
                  AND toString(relationship.group_id) IN $scopeIds
                RETURN count(DISTINCT relationship) AS count
                """,
                scopeIds=scope_ids,
            ))
            rows = neo4j_rows(session.run(
                """
                MATCH (source:Entity)-[relationship]->(target:Entity)
                WHERE toString(source.group_id) IN $scopeIds
                  AND toString(target.group_id) IN $scopeIds
                  AND toString(relationship.group_id) IN $scopeIds
                RETURN DISTINCT
                       coalesce(toString(relationship.uuid), elementId(relationship)) AS relationshipId,
                       type(relationship) AS relationshipType,
                       properties(relationship) AS relationshipProperties,
                       coalesce(toString(source.uuid), elementId(source)) AS sourceId,
                       coalesce(toString(source.name), '') AS sourceName,
                       coalesce(toString(target.uuid), elementId(target)) AS targetId,
                       coalesce(toString(target.name), '') AS targetName
                ORDER BY relationshipId
                """,
                scopeIds=scope_ids,
            ))
    except Exception as error:
        if isinstance(error, DataAnchorError):
            raise
        raise DataAnchorError("project_entity_map_knowgraph_unavailable") from error
    finally:
        close = getattr(driver, "close", None)
        if callable(close):
            close()
    if len(count_rows) != 1:
        raise DataAnchorError("project_entity_map_knowgraph_count_invalid")
    raw_count = count_rows[0].get("count")
    if hasattr(raw_count, "to_native"):
        raw_count = raw_count.to_native()
    if hasattr(raw_count, "toNumber"):
        raw_count = raw_count.toNumber()
    if isinstance(raw_count, bool) or not isinstance(raw_count, (int, float)):
        raise DataAnchorError("project_entity_map_knowgraph_count_invalid")
    if int(raw_count) != len(rows):
        raise DataAnchorError("project_entity_map_knowgraph_incomplete")

    relationships: list[dict[str, Any]] = []
    for row in rows:
        properties = (
            row.get("relationshipProperties")
            if isinstance(row.get("relationshipProperties"), dict)
            else {}
        )
        relationship_id = str(row.get("relationshipId") or "").strip()
        source_id = str(row.get("sourceId") or "").strip()
        target_id = str(row.get("targetId") or "").strip()
        source_name = str(row.get("sourceName") or "").strip()
        target_name = str(row.get("targetName") or "").strip()
        jev = persisted_knowgraph_jev(relationship_id, properties)
        label = str(
            (jev or {}).get("winner")
            or properties.get("name")
            or row.get("relationshipType")
            or ""
        ).strip()
        if not all((relationship_id, source_id, target_id, source_name, target_name, label)):
            raise DataAnchorError("project_entity_map_knowgraph_relationship_invalid")
        relationships.append({
            "authority": "knowgraph",
            "graphitiRelationshipId": relationship_id,
            "sourceGraphitiEntityId": source_id,
            "sourceCanonicalName": source_name,
            "targetGraphitiEntityId": target_id,
            "targetCanonicalName": target_name,
            "label": label,
            "state": json_safe({
                key: value
                for key, value in {
                    "validAt": properties.get("valid_at"),
                    "invalidAt": properties.get("invalid_at"),
                    "expiredAt": properties.get("expired_at"),
                    "labelConfidence": (jev or {}).get("label_confidence"),
                    "distribution": (jev or {}).get("distribution"),
                }.items()
                if value is not None
            }),
        })
    return relationships


def build_project_entity_map(project: str) -> dict[str, Any]:
    """Return the exact lightweight Entity/Relationship map shared with Cards."""

    started = time.perf_counter()
    directory = build_canonical_entity_directory(project)
    think_relationships = _thinkgraph_relationships(project)
    know_relationships = _knowgraph_relationships(project)
    relationship_identity = {
        "thinkgraph": think_relationships,
        "knowgraph": know_relationships,
    }
    identity = {
        "schemaVersion": "project-entity-map",
        "projectId": directory["projectId"],
        "complete": True,
        "entities": directory["entities"],
        "relationships": [*think_relationships, *know_relationships],
        "counts": {
            **directory["counts"],
            "thinkgraphRelationships": len(think_relationships),
            "knowgraphRelationships": len(know_relationships),
            "relationships": len(think_relationships) + len(know_relationships),
        },
        "revisions": {
            **directory["revisions"],
            "entities": directory["sha256"],
            "relationships": hashlib.sha256(
                canonical_json(relationship_identity).encode("utf-8")
            ).hexdigest(),
        },
    }
    identity_bytes = canonical_json(identity).encode("utf-8")
    result = {
        **identity,
        "sha256": hashlib.sha256(identity_bytes).hexdigest(),
        "bytes": len(identity_bytes),
        "estimatedTokens": math.ceil(len(identity_bytes) / 4),
        "readDurationMs": round((time.perf_counter() - started) * 1000, 3),
    }
    if len(canonical_json(result).encode("utf-8")) > GRAPH_CONTEXT_BYTE_LIMIT:
        raise DataAnchorError("project_entity_map_input_limit_exceeded")
    return result


def append_project_entity_map(graph_context: str, entity_map: dict[str, Any]) -> str:
    rendered = "\n".join((
        "### Current Project Entity Map",
        (
            "Use this complete identity-and-relationship map before proposing an Entity. "
            "It intentionally contains no Think or Know bodies. Provider IDs remain "
            "authority-specific; shared names do not merge graph ownership."
        ),
        canonical_json(entity_map),
    ))
    combined = "\n\n".join(
        value for value in (graph_context.strip(), rendered) if value
    )
    if len(combined.encode("utf-8")) > GRAPH_CONTEXT_BYTE_LIMIT:
        raise DataAnchorError("data_anchor_seed_limit_exceeded")
    return combined
