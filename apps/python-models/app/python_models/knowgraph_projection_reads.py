"""Bounded KnowGraph projection and neighborhood reads for the UI."""

from __future__ import annotations

from typing import Any

from app.python_models.knowgraph_graphiti_read_support import (
    graphiti_episode_ids,
    graphiti_project_scope_ids,
    knowgraph_driver,
    neo4j_rows,
    persisted_knowgraph_jev,
    without_graphiti_embedding_vectors,
)
from app.python_models.knowgraph_know_contract import (
    know_from_properties,
    know_word_count,
)

_KNOWS_PER_ENTITY_LIMIT = 2


def _node_type(labels: list[str]) -> str:
    for label in ("Entity", "Episodic", "Community", "Saga"):
        if label in labels:
            return label
    return labels[0] if labels else "NeoEntity"


def _knowgraph_node_label(
    identifier: str,
    properties: dict[str, Any],
) -> str:
    for candidate in (
        properties.get("name"), properties.get("title"), properties.get("label"),
        properties.get("id"), properties.get("document_id"),
        properties.get("chunk_id"),
    ):
        text = str(candidate or "").strip()
        if text:
            return text
    return identifier


def _upsert_projection_node(
    nodes: dict[str, dict[str, Any]],
    identifier: Any,
    labels: Any,
    properties: Any,
) -> None:
    node_id = str(identifier or "").strip()
    if not node_id or node_id in nodes:
        return
    safe_labels = [str(label) for label in labels] if isinstance(labels, list) else []
    safe_properties = without_graphiti_embedding_vectors(
        properties if isinstance(properties, dict) else {}
    )
    nodes[node_id] = {
        "id": node_id,
        "label": _knowgraph_node_label(node_id, safe_properties),
        "type": _node_type(safe_labels),
        "source": "knowgraph",
        "properties": {
            **safe_properties,
            **({"providerType": str(safe_properties["owlClass"])}
               if safe_properties.get("owlClass") else {}),
        },
    }


def _attach_entity_knows(
    session: Any,
    project_scope_ids: list[str],
    nodes: dict[str, dict[str, Any]],
    entity_ids: list[str],
) -> None:
    """Attach at most two exact ABOUT episodes to each projected Entity."""

    if not entity_ids:
        return
    rows = neo4j_rows(session.run(
        """
        MATCH (episode:Episodic)-[:ABOUT]->(entity:Entity)
        WHERE coalesce(toString(entity.uuid), elementId(entity)) IN $entityIds
          AND toString(entity.group_id) IN $projectScopeIds
          AND toString(episode.group_id) IN $projectScopeIds
          AND toString(episode.content) CONTAINS '\"schemaVersion\":\"know.v1\"'
        RETURN coalesce(toString(entity.uuid), elementId(entity)) AS entity_id,
               coalesce(toString(episode.uuid), elementId(episode)) AS episode_id,
               properties(episode) AS episode_props
        ORDER BY entity_id,
                 coalesce(episode.valid_at, episode.created_at) DESC,
                 episode.created_at DESC,
                 episode_id DESC
        """,
        entityIds=entity_ids,
        projectScopeIds=project_scope_ids,
    ))
    counts: dict[str, int] = {}
    for row in rows:
        entity_id = str(row.get("entity_id") or "").strip()
        episode_id = str(row.get("episode_id") or "").strip()
        if not entity_id or not episode_id or entity_id not in nodes:
            continue
        count = counts.get(entity_id, 0)
        properties = without_graphiti_embedding_vectors(
            row.get("episode_props")
            if isinstance(row.get("episode_props"), dict)
            else {}
        )
        know = know_from_properties(properties)
        if know is None:
            continue
        entity_properties = nodes[entity_id].setdefault("properties", {})
        entity_properties["attachedWordCount"] = int(
            entity_properties.get("attachedWordCount") or 0
        ) + know_word_count(know)
        if count >= _KNOWS_PER_ENTITY_LIMIT:
            continue
        content = str(properties.get("content") or "")
        evidence = entity_properties.setdefault("evidence", [])
        evidence.append({
            "id": episode_id,
            "graphitiEpisodeId": episode_id,
            "graphitiEntityId": entity_id,
            "title": str(properties.get("name") or "Know"),
            "idea": know["idea"],
            "counterIdea": know["counterIdea"],
            "body": content,
            "content": content,
            "properties": properties,
            "validFrom": properties.get("valid_at"),
            "ingestedAt": properties.get("created_at"),
        })
        counts[entity_id] = count + 1


def _relationship_properties(
    fact_uuid: str,
    graphiti_relationship_type: str,
    properties: dict[str, Any],
    *,
    source_id: str,
    source_name: str,
    target_id: str,
    target_name: str,
) -> dict[str, Any]:
    supporting_episode_uuids = graphiti_episode_ids(properties)
    invalid_at = properties.get("invalid_at")
    expired_at = properties.get("expired_at")
    jev = persisted_knowgraph_jev(fact_uuid, properties)
    return {
        **properties,
        "authority": "knowgraph",
        "graphitiStore": "neo4j",
        "graphitiFactUuid": fact_uuid,
        "graphitiRelationshipType": graphiti_relationship_type,
        "graphitiRelation": str(
            properties.get("name") or graphiti_relationship_type or "Fact"
        ),
        "fact": str(properties.get("fact") or ""),
        "sourceEntity": {"uuid": source_id, "name": source_name},
        "targetEntity": {"uuid": target_id, "name": target_name},
        "supportingEpisodeUuids": supporting_episode_uuids,
        "createdAt": properties.get("created_at"),
        "referenceTime": properties.get("reference_time"),
        "validAt": properties.get("valid_at"),
        "invalidAt": invalid_at,
        "expiredAt": expired_at,
        "temporalStatus": "historical" if invalid_at or expired_at else "current",
        **({
            "jevCanonicalRelation": jev["winner"],
            "relationship_strength": jev["label_confidence"],
            "jev": jev,
        } if jev is not None else {}),
    }


def _projection_relationship(
    row: dict[str, Any],
    nodes: dict[str, dict[str, Any]],
) -> dict[str, Any] | None:
    relationship_id = str(row.get("rel_id") or "").strip()
    source_id = str(row.get("from_id") or "").strip()
    target_id = str(row.get("to_id") or "").strip()
    if not relationship_id or not source_id or not target_id:
        return None
    _upsert_projection_node(
        nodes, source_id, row.get("from_labels"), row.get("from_props")
    )
    _upsert_projection_node(
        nodes, target_id, row.get("to_labels"), row.get("to_props")
    )
    relationship_type = str(row.get("rel_type") or "RELATED_TO")
    relationship_properties = without_graphiti_embedding_vectors(
        row.get("rel_props") if isinstance(row.get("rel_props"), dict) else {}
    )
    source_properties = without_graphiti_embedding_vectors(
        row.get("from_props") if isinstance(row.get("from_props"), dict) else {}
    )
    target_properties = without_graphiti_embedding_vectors(
        row.get("to_props") if isinstance(row.get("to_props"), dict) else {}
    )
    properties = _relationship_properties(
        relationship_id,
        relationship_type,
        relationship_properties,
        source_id=source_id,
        source_name=_knowgraph_node_label(source_id, source_properties),
        target_id=target_id,
        target_name=_knowgraph_node_label(target_id, target_properties),
    )
    return {
        "id": relationship_id,
        "from": source_id,
        "to": target_id,
        "type": str(
            properties.get("jevCanonicalRelation")
            or properties.get("graphitiRelation")
            or relationship_type
        ),
        "properties": properties,
    }


def read_knowgraph_projection(
    project_id: str,
    limit: int,
) -> dict[str, list[dict[str, Any]]]:
    """Project the bounded Graphiti graph used by the existing KnowGraph UI."""

    canonical_project_id = str(project_id or "").strip()
    if not canonical_project_id:
        raise ValueError("projectId is required")
    if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= 500:
        raise ValueError("knowgraph_projection_limit_invalid")
    project_scope_ids = graphiti_project_scope_ids(canonical_project_id)
    driver, database = knowgraph_driver()
    try:
        with driver.session(database=database) as session:
            node_rows = neo4j_rows(session.run(
                """
                MATCH (n:Entity)
                WHERE toString(n.group_id) IN $projectScopeIds
                OPTIONAL MATCH (community:Community)-[:HAS_MEMBER]->(n)
                WHERE toString(community.group_id) IN $projectScopeIds
                WITH n,
                     min(coalesce(toString(community.uuid), elementId(community)))
                       AS community_id
                RETURN DISTINCT coalesce(toString(n.uuid), elementId(n)) AS node_id,
                       labels(n) AS node_labels,
                       properties(n) AS node_props,
                       community_id
                ORDER BY node_id
                LIMIT $limit
                """,
                projectScopeIds=project_scope_ids,
                limit=limit,
            ))
            nodes: dict[str, dict[str, Any]] = {}
            for row in node_rows:
                _upsert_projection_node(
                    nodes,
                    row.get("node_id"),
                    row.get("node_labels"),
                    row.get("node_props"),
                )
                node_id = str(row.get("node_id") or "").strip()
                community_id = str(row.get("community_id") or "").strip()
                if node_id in nodes and community_id:
                    nodes[node_id]["community_id"] = community_id
                    nodes[node_id]["properties"]["communityId"] = community_id
            entity_ids = list(nodes)
            _attach_entity_knows(session, project_scope_ids, nodes, entity_ids)
            relationship_rows = [] if not entity_ids else neo4j_rows(session.run(
                """
                MATCH (a:Entity)-[r:RELATES_TO]->(b:Entity)
                WITH a, r, b,
                     coalesce(toString(a.uuid), elementId(a)) AS from_id,
                     coalesce(toString(b.uuid), elementId(b)) AS to_id
                WHERE from_id IN $nodeIds
                  AND to_id IN $nodeIds
                  AND toString(r.group_id) IN $projectScopeIds
                RETURN DISTINCT
                       coalesce(toString(r.uuid), elementId(r)) AS rel_id,
                       type(r) AS rel_type,
                       properties(r) AS rel_props,
                       from_id,
                       labels(a) AS from_labels,
                       properties(a) AS from_props,
                       to_id,
                       labels(b) AS to_labels,
                       properties(b) AS to_props
                ORDER BY rel_id
                LIMIT $relationshipLimit
                """,
                projectScopeIds=project_scope_ids,
                nodeIds=entity_ids,
                relationshipLimit=min(1_000, limit * 4),
            ))
            relationships = [
                projected
                for row in relationship_rows
                if (projected := _projection_relationship(row, nodes)) is not None
            ]
            return {"nodes": list(nodes.values()), "relationships": relationships}
    finally:
        close = getattr(driver, "close", None)
        if callable(close):
            close()


def read_knowgraph_neighborhood(
    project_id: str,
    node_id: str,
    limit: int,
) -> dict[str, list[dict[str, Any]]]:
    """Project one bounded one-hop Graphiti neighborhood for the KnowGraph UI."""

    canonical_project_id = str(project_id or "").strip()
    canonical_node_id = str(node_id or "").strip()
    if not canonical_project_id:
        raise ValueError("projectId is required")
    if not canonical_node_id:
        raise ValueError("nodeId is required")
    if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= 200:
        raise ValueError("knowgraph_neighborhood_limit_invalid")
    project_scope_ids = graphiti_project_scope_ids(canonical_project_id)
    driver, database = knowgraph_driver()
    try:
        with driver.session(database=database) as session:
            center_rows = neo4j_rows(session.run(
                """
                MATCH (n:Entity)
                WHERE (elementId(n) = $nodeId OR toString(n.uuid) = $nodeId)
                  AND toString(n.group_id) IN $projectScopeIds
                RETURN coalesce(toString(n.uuid), elementId(n)) AS node_id,
                       labels(n) AS node_labels,
                       properties(n) AS node_props
                LIMIT 1
                """,
                nodeId=canonical_node_id,
                projectScopeIds=project_scope_ids,
            ))
            if not center_rows:
                return {"nodes": [], "relationships": []}
            nodes: dict[str, dict[str, Any]] = {}
            for row in center_rows:
                _upsert_projection_node(
                    nodes,
                    row.get("node_id"),
                    row.get("node_labels"),
                    row.get("node_props"),
                )
            relationship_rows = neo4j_rows(session.run(
                """
                MATCH (center:Entity)
                WHERE (elementId(center) = $nodeId OR toString(center.uuid) = $nodeId)
                  AND toString(center.group_id) IN $projectScopeIds
                MATCH (a:Entity)-[r:RELATES_TO]-(b:Entity)
                WHERE (a = center OR b = center)
                  AND toString(a.group_id) IN $projectScopeIds
                  AND toString(b.group_id) IN $projectScopeIds
                  AND toString(r.group_id) IN $projectScopeIds
                RETURN DISTINCT
                       coalesce(toString(r.uuid), elementId(r)) AS rel_id,
                       type(r) AS rel_type,
                       properties(r) AS rel_props,
                       coalesce(toString(startNode(r).uuid), elementId(startNode(r))) AS from_id,
                       labels(startNode(r)) AS from_labels,
                       properties(startNode(r)) AS from_props,
                       coalesce(toString(endNode(r).uuid), elementId(endNode(r))) AS to_id,
                       labels(endNode(r)) AS to_labels,
                       properties(endNode(r)) AS to_props
                LIMIT $limit
                """,
                nodeId=canonical_node_id,
                projectScopeIds=project_scope_ids,
                limit=limit,
            ))
            relationships = [
                projected
                for row in relationship_rows
                if (projected := _projection_relationship(row, nodes)) is not None
            ]
            _attach_entity_knows(
                session,
                project_scope_ids,
                nodes,
                list(nodes),
            )
            return {"nodes": list(nodes.values()), "relationships": relationships}
    finally:
        close = getattr(driver, "close", None)
        if callable(close):
            close()
