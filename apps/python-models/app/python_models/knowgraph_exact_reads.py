"""Exact project-scoped KnowGraph subject, episode, and reference reads."""

from __future__ import annotations

import hashlib
import json
from typing import Any

from app.python_models.data_anchor_contract import (
    ANCHOR_BODY_LIMIT,
    MAX_GRAPH_REFERENCE_RESULTS,
    DataAnchorError,
    canonical_json,
    utc_now_text,
)
from app.python_models.graph_reference_contracts import graph_record_fields
from app.python_models.knowgraph_graphiti_read_support import (
    graphiti_episode_ids,
    graphiti_project_scope_ids,
    knowgraph_driver,
    neo4j_rows,
    project_portable_know,
    without_graphiti_embedding_vectors,
)
_KNOWGRAPH_EPISODE_LIMIT = 50
_KNOWGRAPH_EPISODE_PREVIEW_CHARS = 1_000
def read_knowgraph_subject_directory(project_id: str) -> dict[str, Any]:
    """Read every current project-scoped KnowGraph entity header."""

    driver, database = knowgraph_driver()
    scope_ids = graphiti_project_scope_ids(project_id)
    try:
        with driver.session(database=database) as session:
            count_rows = neo4j_rows(session.run(
                """
                MATCH (subject:Entity)
                WHERE toString(subject.group_id) IN $scopeIds
                RETURN count(DISTINCT coalesce(toString(subject.uuid), elementId(subject))) AS count
                """,
                scopeIds=scope_ids,
            ))
            rows = neo4j_rows(session.run(
                """
                MATCH (subject:Entity)
                WHERE toString(subject.group_id) IN $scopeIds
                RETURN DISTINCT
                       coalesce(toString(subject.uuid), elementId(subject)) AS entityId,
                       coalesce(toString(subject.name), '') AS canonicalName,
                       labels(subject) AS labels
                ORDER BY entityId
                """,
                scopeIds=scope_ids,
            ))
    except Exception as error:
        if isinstance(error, DataAnchorError):
            raise
        raise DataAnchorError("subject_directory_knowgraph_unavailable") from error
    finally:
        close = getattr(driver, "close", None)
        if callable(close):
            close()
    if len(count_rows) != 1:
        raise DataAnchorError("subject_directory_knowgraph_count_invalid")
    raw_count = count_rows[0].get("count")
    # Normalize scalar wrappers at the provider boundary before projection.
    if hasattr(raw_count, "to_native"):
        raw_count = raw_count.to_native()
    if hasattr(raw_count, "toNumber"):
        raw_count = raw_count.toNumber()
    if isinstance(raw_count, bool) or not isinstance(raw_count, (int, float)):
        raise DataAnchorError("subject_directory_knowgraph_count_invalid")
    subjects: list[dict[str, str]] = []
    for row in rows:
        labels = row.get("labels")
        entity_labels = [
            str(label).strip() for label in labels
            if str(label).strip() and str(label).strip() != "Entity"
        ] if isinstance(labels, list) else []
        subjects.append({
            "graphitiEntityId": str(row.get("entityId") or "").strip(),
            "canonicalName": str(row.get("canonicalName") or ""),
            "entityKind": entity_labels[0] if entity_labels else "Entity",
        })
    count = int(raw_count)
    revision = hashlib.sha256(
        canonical_json(subjects).encode("utf-8")
    ).hexdigest()
    return {
        "complete": count == len(subjects),
        "count": count,
        "revision": revision,
        "subjects": subjects,
    }


def read_knowgraph_episodes_exact(
    project_id: str,
    episode_ids: list[str],
) -> list[dict[str, Any]]:
    """Hydrate only the requested project-scoped Graphiti source episodes."""

    requested = list(dict.fromkeys(
        str(value or "").strip() for value in episode_ids if str(value or "").strip()
    ))
    if not requested:
        return []
    if len(requested) > _KNOWGRAPH_EPISODE_LIMIT:
        raise DataAnchorError("data_anchor_knowgraph_episode_limit_invalid")
    driver, database = knowgraph_driver()
    scope_ids = graphiti_project_scope_ids(project_id)
    try:
        with driver.session(database=database) as session:
            rows = neo4j_rows(session.run(
                """
                MATCH (episode:Episodic)
                WHERE toString(episode.uuid) IN $episodeIds
                  AND (
                    toString(episode.group_id) IN $scopeIds
                    OR toString(episode.project_id) = $projectId
                  )
                RETURN toString(episode.uuid) AS uuid,
                       properties(episode) AS properties
                """,
                episodeIds=requested,
                scopeIds=scope_ids,
                projectId=project_id,
            ))
    except Exception as error:
        if isinstance(error, DataAnchorError):
            raise
        raise DataAnchorError("data_anchor_knowgraph_episode_read_failed") from error
    finally:
        close = getattr(driver, "close", None)
        if callable(close):
            close()

    hydrated: dict[str, dict[str, Any]] = {}
    for row in rows:
        episode_id = str(row.get("uuid") or "").strip()
        if not episode_id or episode_id not in requested:
            continue
        properties = without_graphiti_embedding_vectors(
            row.get("properties") if isinstance(row.get("properties"), dict) else {}
        )
        content = str(properties.get("content") or "")
        source = {
            "uuid": episode_id,
            **{
                key: properties.get(key)
                for key in (
                    "name", "source", "source_description", "source_name", "source_url",
                    "source_path", "source_type", "document_id", "created_at", "valid_at",
                    "reference_time", "fetched_at", "snippet", "content_fingerprint",
                    "graphiti_version",
                )
                if properties.get(key) is not None
            },
            "content_chars": len(content),
            "content_preview": content[:_KNOWGRAPH_EPISODE_PREVIEW_CHARS],
            "content_truncated": len(content) > _KNOWGRAPH_EPISODE_PREVIEW_CHARS,
        }
        hydrated[episode_id] = source
    return [hydrated[episode_id] for episode_id in requested if episode_id in hydrated]
def _read_knowgraph_center_rows(
    project_id: str,
    identifier: str,
    *,
    bounded_expansion: int,
    result_limit: int,
) -> tuple[list[dict[str, Any]], bool, list[dict[str, Any]]]:
    """Read one scoped center row and its optional bounded paths."""

    scope_ids = graphiti_project_scope_ids(project_id)
    driver, database = knowgraph_driver()
    try:
        with driver.session(database=database) as session:
            center_rows = neo4j_rows(session.run(
                """
                MATCH (n)
                WHERE (elementId(n) = $graphitiId OR toString(n.uuid) = $graphitiId)
                  AND toString(n.group_id) IN $scopeIds
                RETURN coalesce(toString(n.uuid), elementId(n)) AS graphitiId,
                       labels(n) AS labels, properties(n) AS properties
                LIMIT 1
                """,
                graphitiId=identifier,
                scopeIds=scope_ids,
            ))
            relationship_center = False
            if not center_rows:
                center_rows = neo4j_rows(session.run(
                    """
                    MATCH (a)-[r]->(b)
                    WHERE (elementId(r) = $graphitiId OR toString(r.uuid) = $graphitiId)
                      AND toString(a.group_id) IN $scopeIds
                      AND toString(b.group_id) IN $scopeIds
                      AND toString(r.group_id) IN $scopeIds
                    RETURN coalesce(toString(r.uuid), elementId(r)) AS graphitiId,
                           [type(r)] AS labels, properties(r) AS properties,
                           coalesce(toString(a.uuid), elementId(a)) AS sourceGraphitiId,
                           coalesce(toString(b.uuid), elementId(b)) AS targetGraphitiId,
                           [{graphitiId: coalesce(toString(a.uuid), elementId(a)),
                             labels: labels(a), properties: properties(a)},
                            {graphitiId: coalesce(toString(b.uuid), elementId(b)),
                             labels: labels(b), properties: properties(b)}] AS endpointNodes
                    LIMIT 1
                    """,
                    graphitiId=identifier,
                    scopeIds=scope_ids,
                ))
                relationship_center = bool(center_rows)
            paths: list[dict[str, Any]] = []
            if center_rows and bounded_expansion and not relationship_center:
                paths = neo4j_rows(session.run(
                    f"""
                    MATCH (center)
                    WHERE (elementId(center) = $graphitiId OR toString(center.uuid) = $graphitiId)
                      AND toString(center.group_id) IN $scopeIds
                    MATCH path=(center)-[*1..{bounded_expansion}]-(other)
                    WHERE ALL(node IN nodes(path)
                              WHERE toString(node.group_id) IN $scopeIds)
                      AND ALL(rel IN relationships(path)
                              WHERE toString(rel.group_id) IN $scopeIds)
                    RETURN [node IN nodes(path) | {{
                               id: coalesce(toString(node.uuid), elementId(node)),
                               labels: labels(node), properties: properties(node)}}] AS nodes,
                           [rel IN relationships(path) | {{
                               id: coalesce(toString(rel.uuid), elementId(rel)),
                               type: type(rel), properties: properties(rel),
                               sourceId: coalesce(toString(startNode(rel).uuid), elementId(startNode(rel))),
                               targetId: coalesce(toString(endNode(rel).uuid), elementId(endNode(rel)))}}] AS relationships
                    LIMIT $limit
                    """,
                    graphitiId=identifier,
                    scopeIds=scope_ids,
                    limit=result_limit,
                ))
    except Exception as error:
        if isinstance(error, DataAnchorError):
            raise
        raise DataAnchorError("data_anchor_knowgraph_read_failed") from error
    finally:
        close = getattr(driver, "close", None)
        if callable(close):
            close()
    return center_rows, relationship_center, paths


def read_knowgraph_exact(
    project_id: str,
    id_field: str,
    identifier: str,
    *,
    bounded_expansion: int = 0,
    result_limit: int = MAX_GRAPH_REFERENCE_RESULTS,
) -> dict[str, Any] | None:
    """Read one project-scoped Neo4j object and a bounded current neighborhood."""

    if bounded_expansion < 0 or bounded_expansion > 3:
        raise DataAnchorError("data_anchor_expansion_invalid")
    if result_limit < 1 or result_limit > MAX_GRAPH_REFERENCE_RESULTS:
        raise DataAnchorError("data_anchor_result_limit_invalid")
    if id_field not in {
        "graphitiEpisodeId", "graphitiEntityId", "graphitiRelationshipId",
    }:
        raise DataAnchorError("data_anchor_graphiti_reference_unsupported")
    center_rows, relationship_center, paths = _read_knowgraph_center_rows(
        project_id,
        identifier,
        bounded_expansion=bounded_expansion,
        result_limit=result_limit,
    )
    if not center_rows:
        return None

    center = without_graphiti_embedding_vectors(center_rows[0])
    properties = center.get("properties") if isinstance(center.get("properties"), dict) else {}
    labels = center.get("labels") if isinstance(center.get("labels"), list) else []
    neighborhood = without_graphiti_embedding_vectors(paths)[:result_limit]
    episode_ids = graphiti_episode_ids(properties) if relationship_center else []
    episodes = read_knowgraph_episodes_exact(project_id, episode_ids) if episode_ids else []
    endpoint_nodes = center.get("endpointNodes") if relationship_center else []
    endpoints = endpoint_nodes if isinstance(endpoint_nodes, list) else []
    source_endpoint = endpoints[0] if endpoints and isinstance(endpoints[0], dict) else {}
    target_endpoint = endpoints[1] if len(endpoints) > 1 and isinstance(endpoints[1], dict) else {}
    source_properties = source_endpoint.get("properties") \
        if isinstance(source_endpoint.get("properties"), dict) else {}
    target_properties = target_endpoint.get("properties") \
        if isinstance(target_endpoint.get("properties"), dict) else {}
    identifier = str(center.get("graphitiId") or identifier)
    resolved_id_field = (
        "graphitiRelationshipId" if relationship_center
        else "graphitiEpisodeId" if "Episodic" in labels
        else "graphitiEntityId"
    )
    if resolved_id_field != id_field:
        return None
    portable_know = project_portable_know(
        identifier,
        properties,
        source_id=str(center.get("sourceGraphitiId") or ""),
        target_id=str(center.get("targetGraphitiId") or ""),
        source_name=str(source_properties.get("name") or ""),
        target_name=str(target_properties.get("name") or ""),
        episodes=episodes,
    ) if relationship_center else None
    return {
        "graphSystem": "graphiti",
        **graph_record_fields(resolved_id_field, identifier),
        "recordKind": "relationship" if relationship_center else (
            "episode" if resolved_id_field == "graphitiEpisodeId" else "entity"
        ),
        **({"portableKind": "know"} if relationship_center else {}),
        "type": str(labels[0] if labels else "Neo4jObject"),
        "title": str(properties.get("name") or properties.get("title") or identifier),
        "content": json.dumps(
            {"properties": properties, "neighborhood": neighborhood},
            ensure_ascii=False,
            separators=(",", ":"),
            default=str,
        )[:ANCHOR_BODY_LIMIT],
        "properties": properties,
        "endpointNodes": endpoint_nodes,
        "sourceId": str(center.get("sourceGraphitiId") or ""),
        "targetId": str(center.get("targetGraphitiId") or ""),
        **({"know": portable_know, "jev": portable_know.get("jev")}
           if portable_know is not None else {}),
        "relationshipEvidence": neighborhood,
        "provenance": {
            **{
                key: properties.get(key)
                for key in (
                    "group_id", "source", "source_description", "created_at",
                    "reference_time", "valid_at", "invalid_at", "expired_at",
                )
                if properties.get(key) is not None
            },
            **({"episodeUuids": episode_ids, "episodes": episodes} if episode_ids else {}),
        },
        "asOf": utc_now_text(),
        "readOperation": "neo4j.project_scoped_exact",
        "resultLimit": result_limit,
        "truncated": bool(bounded_expansion and len(paths) >= result_limit),
    }
