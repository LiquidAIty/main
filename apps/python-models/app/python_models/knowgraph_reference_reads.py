"""Exact project-scoped reads from the Graphiti/Neo4j KnowGraph authority."""

from __future__ import annotations

import hashlib
import json
import math
import os
from typing import Any

from app.python_models.data_anchor_contract import (
    ANCHOR_BODY_LIMIT,
    MAX_GRAPH_REFERENCE_RESULTS,
    DataAnchorError,
    canonical_json,
    utc_now_text,
)
from app.python_models.jev_validation import (
    validate_rounded_choice_winner,
    validate_rounded_probability_distribution,
)
from app.python_models.graph_reference_contracts import graph_record_fields


_KNOWGRAPH_EPISODE_LIMIT = 50
_KNOWGRAPH_EPISODE_PREVIEW_CHARS = 1_000
_GRAPHITI_GROUP_PREFIX = "liquidaity-"


def _neo4j_rows(result: Any) -> list[dict[str, Any]]:
    if hasattr(result, "data"):
        data = result.data()
        return [dict(row) for row in data]
    return [
        row.data() if hasattr(row, "data") else dict(row)
        for row in result
    ]


def _without_graphiti_embedding_vectors(value: Any) -> Any:
    """Normalize Neo4j values and remove Graphiti vectors from projected reads."""

    if isinstance(value, dict):
        return {
            key: _without_graphiti_embedding_vectors(item)
            for key, item in value.items()
            if not (
                str(key).strip().lower() == "embedding"
                or str(key).strip().lower().endswith("_embedding")
                or str(key).strip().lower().startswith("embedding_")
            )
        }
    if isinstance(value, list):
        return [_without_graphiti_embedding_vectors(item) for item in value]
    to_native = getattr(value, "to_native", None)
    if callable(to_native):
        return _without_graphiti_embedding_vectors(to_native())
    to_number = getattr(value, "toNumber", None)
    if callable(to_number):
        return to_number()
    iso_format = getattr(value, "isoformat", None)
    if callable(iso_format):
        return iso_format()
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    return str(value)


def _project_scope_ids(project_id: str) -> list[str]:
    """Return Graphiti's one authoritative group scope for a canonical Project ID."""

    canonical_project_id = str(project_id or "").strip()
    if not canonical_project_id:
        return []
    return [f"{_GRAPHITI_GROUP_PREFIX}{canonical_project_id}"]


def _knowgraph_driver() -> tuple[Any, str]:
    """Open the existing project-scoped Neo4j read seam."""

    database = os.environ.get("NEO4J_DATABASE", "neo4j").strip() or "neo4j"
    uri = os.environ.get("NEO4J_URI", "").strip()
    user = os.environ.get("NEO4J_USER", "").strip()
    password = os.environ.get("NEO4J_PASSWORD", "").strip()
    if not uri or not user or not password:
        raise DataAnchorError("data_anchor_knowgraph_unavailable")
    try:
        from neo4j import GraphDatabase
    except ImportError as error:
        raise DataAnchorError("data_anchor_knowgraph_driver_unavailable") from error
    return GraphDatabase.driver(uri, auth=(user, password)), database


def read_knowgraph_subject_directory(project_id: str) -> dict[str, Any]:
    """Read every current project-scoped KnowGraph entity header."""

    driver, database = _knowgraph_driver()
    scope_ids = _project_scope_ids(project_id)
    try:
        with driver.session(database=database) as session:
            count_rows = _neo4j_rows(session.run(
                """
                MATCH (subject:Entity)
                WHERE toString(subject.group_id) IN $scopeIds
                RETURN count(DISTINCT coalesce(toString(subject.uuid), elementId(subject))) AS count
                """,
                scopeIds=scope_ids,
            ))
            rows = _neo4j_rows(session.run(
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
    driver, database = _knowgraph_driver()
    scope_ids = _project_scope_ids(project_id)
    try:
        with driver.session(database=database) as session:
            rows = _neo4j_rows(session.run(
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
        properties = _without_graphiti_embedding_vectors(
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


def _episode_ids(item: dict[str, Any]) -> list[str]:
    values: list[str] = []
    for key in ("episode_uuids", "episodes", "source_episode_uuids"):
        raw = item.get(key)
        if isinstance(raw, list):
            for value in raw:
                if isinstance(value, dict):
                    text = str(value.get("uuid") or "").strip()
                else:
                    text = str(value or "").strip()
                if text:
                    values.append(text)
        elif isinstance(raw, str) and raw.strip():
            values.append(raw.strip())
    return list(dict.fromkeys(values))


def _persisted_knowgraph_jev(
    graphiti_fact_uuid: str,
    properties: dict[str, Any],
) -> dict[str, Any] | None:
    """Read already-settled Jev metadata from the Graphiti relationship."""

    winner = str(properties.get("jev_relation_winner") or "").strip()
    serialized = properties.get("jev_relation_distribution_json")
    if not winner or serialized in (None, ""):
        return None
    try:
        distribution = (
            json.loads(serialized) if isinstance(serialized, str) else dict(serialized)
        )
        if not isinstance(distribution, dict) or not distribution:
            return None
        serialized_choices = properties.get("jev_choice_options_json")
        choices = (
            json.loads(serialized_choices)
            if isinstance(serialized_choices, str) and serialized_choices.strip()
            else list(distribution)
        )
        if (
            not isinstance(choices, list)
            or any(not isinstance(choice, str) or not choice for choice in choices)
        ):
            return None
        distribution = validate_rounded_probability_distribution(
            distribution,
            choices,
        )
        validate_rounded_choice_winner(winner, distribution)
        label_confidence_value = properties.get("jev_label_confidence")
        if isinstance(label_confidence_value, bool):
            return None
        label_confidence = float(label_confidence_value)
        if (
            not math.isfinite(label_confidence)
            or label_confidence != distribution[winner]
        ):
            return None
        provider_confidence_value = properties.get("jev_provider_confidence")
        provider_confidence: float | None = None
        if provider_confidence_value not in (None, ""):
            if isinstance(provider_confidence_value, bool):
                return None
            provider_confidence = float(provider_confidence_value)
            if (
                not math.isfinite(provider_confidence)
                or not 0.0 <= provider_confidence <= 1.0
            ):
                return None
    except (KeyError, TypeError, ValueError, json.JSONDecodeError):
        return None
    return {
        "graphitiFactUuid": graphiti_fact_uuid,
        "status": "success",
        "winner": winner,
        "distribution": distribution,
        "label_confidence": label_confidence,
        **({"provider_confidence": provider_confidence}
           if provider_confidence is not None else {}),
        "requested_model": str(properties.get("jev_requested_model") or ""),
        "resolved_model": str(properties.get("jev_resolved_model") or ""),
        "evaluated_at": str(properties.get("jev_evaluated_at") or ""),
        "question_schema_version": str(
            properties.get("jev_question_schema_version") or ""
        ),
        "vocabulary_version": str(properties.get("jev_ontology_version") or ""),
        "vocabulary_hash": str(properties.get("jev_ontology_hash") or ""),
    }


def _portable_know(
    graphiti_fact_uuid: str,
    properties: dict[str, Any],
    *,
    source_id: str,
    target_id: str,
    source_name: str = "",
    target_name: str = "",
    episodes: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Project one Graphiti fact without creating another stored object."""

    episode_ids = _episode_ids(properties)
    invalid_at = properties.get("invalid_at")
    expired_at = properties.get("expired_at")
    jev = _persisted_knowgraph_jev(graphiti_fact_uuid, properties)
    return {
        "portableKind": "know",
        "graphitiFactUuid": graphiti_fact_uuid,
        "sourceEntity": {"uuid": source_id, **({"name": source_name} if source_name else {})},
        "targetEntity": {"uuid": target_id, **({"name": target_name} if target_name else {})},
        "graphitiRelation": str(properties.get("name") or properties.get("edge_type") or "Fact"),
        "fact": str(properties.get("fact") or ""),
        "supportingEpisodeUuids": episode_ids,
        "supportingEpisodes": list(episodes or []),
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


def _read_knowgraph_center_rows(
    project_id: str,
    identifier: str,
    *,
    bounded_expansion: int,
    result_limit: int,
) -> tuple[list[dict[str, Any]], bool, list[dict[str, Any]]]:
    """Read one scoped center row and its optional bounded paths."""

    scope_ids = _project_scope_ids(project_id)
    driver, database = _knowgraph_driver()
    try:
        with driver.session(database=database) as session:
            center_rows = _neo4j_rows(session.run(
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
                center_rows = _neo4j_rows(session.run(
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
                paths = _neo4j_rows(session.run(
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

    center = _without_graphiti_embedding_vectors(center_rows[0])
    properties = center.get("properties") if isinstance(center.get("properties"), dict) else {}
    labels = center.get("labels") if isinstance(center.get("labels"), list) else []
    neighborhood = _without_graphiti_embedding_vectors(paths)[:result_limit]
    episode_ids = _episode_ids(properties) if relationship_center else []
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
    portable_know = _portable_know(
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
    safe_properties = _without_graphiti_embedding_vectors(
        properties if isinstance(properties, dict) else {}
    )
    nodes[node_id] = {
        "id": node_id,
        "label": _knowgraph_node_label(node_id, safe_properties),
        "type": str(safe_properties.get("owlClass") or (
            safe_labels[0] if safe_labels else "NeoEntity"
        )),
        "source": "know",
        "properties": safe_properties,
    }


def _portable_ui_fact(
    fact_uuid: str,
    graphiti_relationship_type: str,
    properties: dict[str, Any],
    *,
    source_id: str,
    source_name: str,
    target_id: str,
    target_name: str,
) -> dict[str, Any]:
    supporting_episode_uuids = _episode_ids(properties)
    invalid_at = properties.get("invalid_at")
    expired_at = properties.get("expired_at")
    jev = _persisted_knowgraph_jev(fact_uuid, properties)
    return {
        **properties,
        "authority": "know",
        "graphitiStore": "neo4j",
        "portableKind": "know",
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
    relationship_properties = _without_graphiti_embedding_vectors(
        row.get("rel_props") if isinstance(row.get("rel_props"), dict) else {}
    )
    source_properties = _without_graphiti_embedding_vectors(
        row.get("from_props") if isinstance(row.get("from_props"), dict) else {}
    )
    target_properties = _without_graphiti_embedding_vectors(
        row.get("to_props") if isinstance(row.get("to_props"), dict) else {}
    )
    properties = _portable_ui_fact(
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
        "source": "know",
        "properties": properties,
    }


def _hydrate_projection_episode_nodes(
    session: Any,
    relationships: list[dict[str, Any]],
    project_scope_ids: list[str],
    nodes: dict[str, dict[str, Any]],
) -> None:
    episode_ids = list(dict.fromkeys(
        episode_id
        for relationship in relationships
        for episode_id in _episode_ids(relationship.get("properties") or {})
    ))
    if not episode_ids:
        return
    rows = _neo4j_rows(session.run(
        """
        MATCH (episode:Episodic)
        WHERE toString(episode.uuid) IN $episodeIds
          AND toString(episode.group_id) IN $projectScopeIds
        RETURN toString(episode.uuid) AS node_id,
               labels(episode) AS node_labels,
               properties(episode) AS node_props
        """,
        episodeIds=episode_ids,
        projectScopeIds=project_scope_ids,
    ))
    for row in rows:
        _upsert_projection_node(
            nodes, row.get("node_id"), row.get("node_labels"), row.get("node_props")
        )


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
    project_scope_ids = _project_scope_ids(canonical_project_id)
    driver, database = _knowgraph_driver()
    try:
        with driver.session(database=database) as session:
            node_rows = _neo4j_rows(session.run(
                """
                MATCH (n)
                WHERE toString(n.group_id) IN $projectScopeIds
                RETURN DISTINCT coalesce(toString(n.uuid), elementId(n)) AS node_id,
                       labels(n) AS node_labels,
                       properties(n) AS node_props
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
            node_ids = list(nodes)
            relationship_rows = [] if not node_ids else _neo4j_rows(session.run(
                """
                MATCH (a)-[r]->(b)
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
                nodeIds=node_ids,
                relationshipLimit=min(1_000, limit * 4),
            ))
            relationships = [
                projected
                for row in relationship_rows
                if (projected := _projection_relationship(row, nodes)) is not None
            ]
            _hydrate_projection_episode_nodes(
                session, relationships, project_scope_ids, nodes
            )
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
    project_scope_ids = _project_scope_ids(canonical_project_id)
    driver, database = _knowgraph_driver()
    try:
        with driver.session(database=database) as session:
            center_rows = _neo4j_rows(session.run(
                """
                MATCH (n)
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
            relationship_rows = _neo4j_rows(session.run(
                """
                MATCH (center)
                WHERE (elementId(center) = $nodeId OR toString(center.uuid) = $nodeId)
                  AND toString(center.group_id) IN $projectScopeIds
                MATCH (a)-[r]-(b)
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
            _hydrate_projection_episode_nodes(
                session, relationships, project_scope_ids, nodes
            )
            return {"nodes": list(nodes.values()), "relationships": relationships}
    finally:
        close = getattr(driver, "close", None)
        if callable(close):
            close()
