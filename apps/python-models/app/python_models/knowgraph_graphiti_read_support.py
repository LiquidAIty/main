"""Shared Graphiti/Neo4j read connection and KnowGraph fact projection."""

from __future__ import annotations

import json
import math
import os
from typing import Any

from app.python_models.data_anchor_contract import DataAnchorError
from app.python_models.jev_validation import (
    validate_rounded_choice_winner,
    validate_rounded_probability_distribution,
)
_GRAPHITI_GROUP_PREFIX = "liquidaity-"


def neo4j_rows(result: Any) -> list[dict[str, Any]]:
    if hasattr(result, "data"):
        data = result.data()
        return [dict(row) for row in data]
    return [
        row.data() if hasattr(row, "data") else dict(row)
        for row in result
    ]


def without_graphiti_embedding_vectors(value: Any) -> Any:
    """Normalize Neo4j values and remove Graphiti vectors from projected reads."""

    if isinstance(value, dict):
        return {
            key: without_graphiti_embedding_vectors(item)
            for key, item in value.items()
            if not (
                str(key).strip().lower() == "embedding"
                or str(key).strip().lower().endswith("_embedding")
                or str(key).strip().lower().startswith("embedding_")
            )
        }
    if isinstance(value, list):
        return [without_graphiti_embedding_vectors(item) for item in value]
    to_native = getattr(value, "to_native", None)
    if callable(to_native):
        return without_graphiti_embedding_vectors(to_native())
    to_number = getattr(value, "toNumber", None)
    if callable(to_number):
        return to_number()
    iso_format = getattr(value, "isoformat", None)
    if callable(iso_format):
        return iso_format()
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    return str(value)


def graphiti_project_scope_ids(project_id: str) -> list[str]:
    """Return Graphiti's one authoritative group scope for a canonical Project ID."""

    canonical_project_id = str(project_id or "").strip()
    if not canonical_project_id:
        return []
    return [f"{_GRAPHITI_GROUP_PREFIX}{canonical_project_id}"]


def knowgraph_driver() -> tuple[Any, str]:
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
        raise DataAnchorError("data_anchorknowgraph_driver_unavailable") from error
    return GraphDatabase.driver(uri, auth=(user, password)), database
def graphiti_episode_ids(item: dict[str, Any]) -> list[str]:
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


def persisted_knowgraph_jev(
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


def project_portable_know(
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

    episode_ids = graphiti_episode_ids(properties)
    invalid_at = properties.get("invalid_at")
    expired_at = properties.get("expired_at")
    jev = persisted_knowgraph_jev(graphiti_fact_uuid, properties)
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
