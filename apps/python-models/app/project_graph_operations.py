"""Read-only exact Project Entity operations."""
# Entity: Knowledge Graphs
# Relationship: Publishes explicit grantable Project Entity directory and bounded cross-authority context reads while graph providers retain data ownership.

from __future__ import annotations

import hashlib
import json
from typing import Any

from app.python_models.canonical_entity_directory import (
    build_canonical_entity_directory,
)
from app.python_models.operation_definition import OperationDefinition


def _canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def list_entities(*, projectId: str) -> dict[str, Any]:
    """Return the complete current exact Project Entity directory."""

    return build_canonical_entity_directory(projectId)


def read_entity_context(
    *,
    projectId: str,
    entities: list[dict[str, Any]],
    query: str,
    context: str = "",
    limit: int = 1,
) -> dict[str, Any]:
    """Read bounded Relevant and distinct Recent records for exact Entities."""

    if not isinstance(entities, list) or not 1 <= len(entities) <= 24:
        raise ValueError("entities must contain between 1 and 24 exact Entity references")
    query = str(query or "").strip()
    if not query:
        raise ValueError("query is required")
    if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= 12:
        raise ValueError("limit must be an integer between 1 and 12")
    directory = build_canonical_entity_directory(projectId)
    current = {
        _canonical_json(entity): entity
        for entity in directory["entities"]
    }
    selected: list[dict[str, Any]] = []
    seen: set[str] = set()
    for reference in entities:
        if not isinstance(reference, dict):
            raise ValueError("each Entity reference must be an object")
        key = _canonical_json(reference)
        exact = current.get(key)
        if exact is None:
            raise ValueError("entity_reference_not_current_or_exact")
        if key in seen:
            continue
        seen.add(key)
        selected.append(exact)

    from app.python_models.engraphis import (
        read_entity_think_candidates,
        read_entity_thinks,
    )
    from app.python_models.knowgraph_exact_reads import (
        read_knowgraph_entity_know_candidates,
        read_knowgraph_entity_knows,
    )
    from app.python_models.project_graph_relevance import build_project_graph_grounding

    result_entities: list[dict[str, Any]] = []
    grounding_revisions: list[str] = []
    for entity in selected:
        engraphis_entity_id = entity.get("engraphisEntityId")
        graphiti_entity_id = entity.get("graphitiEntityId")

        def exact_think_retriever(_project: str, _query: str, requested: int):
            if not engraphis_entity_id:
                return [], [], {"retrieval": "engraphis_exact_entity"}
            recent = read_entity_thinks(
                projectId, str(engraphis_entity_id), limit=requested,
            )
            candidates = read_entity_think_candidates(
                projectId, str(engraphis_entity_id), limit=min(24, max(12, requested * 2)),
            )
            return ([{
                "engraphisMemoryId": think["memory_id"],
                "engraphisEntityId": think["entity_id"],
                "body": think["content"],
                **({"detail": think["detail"]} if think.get("detail") else {}),
                "validFrom": think.get("valid_from"),
                "validTo": think.get("valid_to"),
                "ingestedAt": think.get("ingested_at"),
            } for think in recent], [{
                "engraphisMemoryId": think["memory_id"],
                "engraphisEntityId": think["entity_id"],
                "body": think["content"],
                **({"detail": think["detail"]} if think.get("detail") else {}),
                "validFrom": think.get("valid_from"),
                "validTo": think.get("valid_to"),
                "ingestedAt": think.get("ingested_at"),
            } for think in candidates], {"retrieval": "engraphis_exact_entity"})

        def exact_know_retriever(_project: str, _query: str, requested: int):
            if not graphiti_entity_id:
                return [], [], {"retrieval": "graphiti_exact_about"}
            return (
                read_knowgraph_entity_knows(
                    projectId, str(graphiti_entity_id), limit=requested,
                ),
                read_knowgraph_entity_know_candidates(
                    projectId, str(graphiti_entity_id),
                    limit=min(24, max(12, requested * 2)),
                ),
                {"retrieval": "graphiti_exact_about"},
            )

        grounding = build_project_graph_grounding(
            projectId,
            query,
            context=str(context or ""),
            think_retriever=exact_think_retriever,
            know_retriever=exact_know_retriever,
            result_limit=limit,
        )
        grounding_revisions.append(grounding["revision"])
        authority_grounding = grounding["authorities"]
        result_entities.append({
            **entity,
            "thinks": {
                "recent": authority_grounding["thinkgraph"]["recent"],
                "relevant": authority_grounding["thinkgraph"]["relevant"],
                "relevanceStatus": authority_grounding["thinkgraph"]["relevanceStatus"],
                "decisionId": authority_grounding["thinkgraph"].get("decisionId"),
            },
            "knows": {
                "recent": authority_grounding["knowgraph"]["recent"],
                "relevant": authority_grounding["knowgraph"]["relevant"],
                "relevanceStatus": authority_grounding["knowgraph"]["relevanceStatus"],
                "decisionId": authority_grounding["knowgraph"].get("decisionId"),
            },
        })

    payload = {
        "schemaVersion": "project-entity-context.v1",
        "projectId": projectId,
        "directorySha256": directory["sha256"],
        "querySha256": hashlib.sha256(query.encode("utf-8")).hexdigest(),
        "groundingRevision": hashlib.sha256(
            _canonical_json(grounding_revisions).encode("utf-8")
        ).hexdigest(),
        "limit": limit,
        "entities": result_entities,
    }
    payload["sha256"] = hashlib.sha256(
        _canonical_json(payload).encode("utf-8")
    ).hexdigest()
    return payload


def project_graph_operation_definitions(
    external: frozenset[str],
) -> list[OperationDefinition]:
    entity_base = {
        "type": "object",
        "properties": {
            "canonicalName": {"type": "string", "minLength": 1, "maxLength": 256},
            "authority": {
                "type": "string",
                "enum": ["thinkgraph", "knowgraph", "both"],
            },
            "engraphisEntityId": {"type": "string", "minLength": 1, "maxLength": 1024},
            "graphitiEntityId": {"type": "string", "minLength": 1, "maxLength": 1024},
        },
        "required": ["canonicalName", "authority"],
        "additionalProperties": False,
        "oneOf": [
            {
                "properties": {"authority": {"const": "thinkgraph"}},
                "required": ["engraphisEntityId"],
                "not": {"required": ["graphitiEntityId"]},
            },
            {
                "properties": {"authority": {"const": "knowgraph"}},
                "required": ["graphitiEntityId"],
                "not": {"required": ["engraphisEntityId"]},
            },
            {
                "properties": {"authority": {"const": "both"}},
                "required": ["engraphisEntityId", "graphitiEntityId"],
            },
        ],
    }
    think_record = {
        "type": "object",
        "properties": {
            "engraphisMemoryId": {"type": "string", "minLength": 1},
            "engraphisEntityId": {"type": "string", "minLength": 1},
            "body": {"type": "string", "minLength": 1},
            "detail": {"type": "string", "minLength": 1},
            "validFrom": {}, "validTo": {}, "ingestedAt": {},
            "relevance": {"type": "number", "minimum": 0, "maximum": 1},
            "relevanceRank": {"type": "integer", "minimum": 1, "maximum": 12},
        },
        "required": ["engraphisMemoryId", "engraphisEntityId", "body"],
        "additionalProperties": False,
    }
    citation = {
        "type": "object",
        "properties": {
            "url": {"type": "string", "minLength": 1},
            "title": {"type": "string"},
            "publisher": {"type": "string"},
            "locator": {"type": "string"},
            "supports": {"type": "string"},
        },
        "required": ["url"],
        "additionalProperties": False,
    }
    know_side = {
        "type": "object",
        "properties": {
            "body": {"type": "string", "minLength": 1},
            "detail": {"type": "string", "minLength": 1},
            "citations": {
                "type": "array", "minItems": 1, "items": citation,
            },
        },
        "required": ["body", "citations"],
        "additionalProperties": False,
    }
    know_record = {
        "type": "object",
        "properties": {
            "graphitiEpisodeId": {"type": "string", "minLength": 1},
            "graphitiEntityId": {"type": "string", "minLength": 1},
            "idea": know_side,
            "counterIdea": know_side,
            "validFrom": {}, "ingestedAt": {},
            "relevance": {"type": "number", "minimum": 0, "maximum": 1},
            "relevanceRank": {"type": "integer", "minimum": 1, "maximum": 12},
        },
        "required": [
            "graphitiEpisodeId", "graphitiEntityId", "idea", "counterIdea",
        ],
        "additionalProperties": False,
    }

    def selection_schema(record_schema: dict[str, Any]) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "recent": {"type": "array", "maxItems": 12, "items": record_schema},
                "relevant": {"type": "array", "maxItems": 12, "items": record_schema},
                "relevanceStatus": {
                    "type": "string",
                    "enum": ["success", "empty", "unavailable", "invalid"],
                },
                "decisionId": {
                    "anyOf": [
                        {"type": "string", "minLength": 1},
                        {"type": "null"},
                    ],
                },
            },
            "required": ["recent", "relevant", "relevanceStatus", "decisionId"],
            "additionalProperties": False,
        }

    context_entity = {
        **entity_base,
        "properties": {
            **entity_base["properties"],
            "thinks": selection_schema(think_record),
            "knows": selection_schema(know_record),
        },
        "required": [*entity_base["required"], "thinks", "knows"],
    }
    return [OperationDefinition(
        canonical_id="project_graph.list_entities",
        title="List Project Entities",
        description=(
            "Read the complete current Project Entity identity directory. Exact canonical "
            "name bytes combine provider Engraphis and Graphiti identities for presentation "
            "only; each graph remains a separate authority and writer. Returns no Think or "
            "Know bodies and performs no semantic search or graph write."
        ),
        parameters_schema={
            "type": "object",
            "properties": {
                "projectId": {"type": "string", "minLength": 1},
            },
            "required": ["projectId"],
            "additionalProperties": False,
        },
        output_schema={
            "type": "object",
            "properties": {
                "schemaVersion": {"const": "graph-entity-directory"},
                "projectId": {"type": "string", "minLength": 1},
                "complete": {"const": True},
                "counts": {
                    "type": "object",
                    "properties": {
                        "engraphis": {"type": "integer", "minimum": 0},
                        "graphiti": {"type": "integer", "minimum": 0},
                        "total": {"type": "integer", "minimum": 0},
                    },
                    "required": ["engraphis", "graphiti", "total"],
                    "additionalProperties": False,
                },
                "revisions": {
                    "type": "object",
                    "properties": {
                        "engraphis": {"type": "string", "minLength": 1},
                        "graphiti": {"type": "string", "minLength": 1},
                    },
                    "required": ["engraphis", "graphiti"],
                    "additionalProperties": False,
                },
                "entities": {"type": "array", "items": entity_base},
                "sha256": {"type": "string", "pattern": "^[0-9a-f]{64}$"},
                "bytes": {"type": "integer", "minimum": 1},
                "estimatedTokens": {"type": "integer", "minimum": 1},
                "readDurationMs": {"type": "number", "minimum": 0},
            },
            "required": [
                "schemaVersion", "projectId", "complete", "counts", "revisions",
                "entities", "sha256", "bytes", "estimatedTokens", "readDurationMs",
            ],
            "additionalProperties": False,
        },
        handler=list_entities,
        available=True,
        publishers=external,
        access="read",
        namespace="project_graph",
        grant_eligible=True,
        annotations={
            "readOnlyHint": True,
            "destructiveHint": False,
            "idempotentHint": True,
            "openWorldHint": False,
        },
        server_injected_arguments=frozenset({"projectId"}),
        dispatcher_context_arguments=frozenset({"projectId"}),
    ), OperationDefinition(
        canonical_id="project_graph.read_entity_context",
        title="Read Project Entity Context",
        description=(
            "Read bounded Relevant and distinct Recent exact Thinks and Knows for exact "
            "current Project Entity directory references. The owning graphs produce provider "
            "candidates and Jev rates them against the supplied current request/context. "
            "Performs no fuzzy Entity lookup, Entity creation, or graph write."
        ),
        parameters_schema={
            "type": "object",
            "properties": {
                "projectId": {"type": "string", "minLength": 1},
                "entities": {
                    "type": "array", "minItems": 1, "maxItems": 24,
                    "items": entity_base,
                },
                "query": {"type": "string", "minLength": 1, "maxLength": 16000},
                "context": {"type": "string", "maxLength": 16000},
                "limit": {
                    "type": "integer", "minimum": 1, "maximum": 12, "default": 1,
                },
            },
            "required": ["projectId", "entities", "query"],
            "additionalProperties": False,
        },
        output_schema={
            "type": "object",
            "properties": {
                "schemaVersion": {"const": "project-entity-context.v1"},
                "projectId": {"type": "string", "minLength": 1},
                "directorySha256": {"type": "string", "pattern": "^[0-9a-f]{64}$"},
                "querySha256": {"type": "string", "pattern": "^[0-9a-f]{64}$"},
                "groundingRevision": {"type": "string", "pattern": "^[0-9a-f]{64}$"},
                "limit": {"type": "integer", "minimum": 1, "maximum": 12},
                "entities": {"type": "array", "items": context_entity},
                "sha256": {"type": "string", "pattern": "^[0-9a-f]{64}$"},
            },
            "required": [
                "schemaVersion", "projectId", "directorySha256", "querySha256",
                "groundingRevision", "limit", "entities", "sha256",
            ],
            "additionalProperties": False,
        },
        handler=read_entity_context,
        available=True,
        publishers=external,
        access="read",
        namespace="project_graph",
        grant_eligible=True,
        annotations={
            "readOnlyHint": True,
            "destructiveHint": False,
            "idempotentHint": False,
            "openWorldHint": True,
        },
        server_injected_arguments=frozenset({"projectId"}),
        dispatcher_context_arguments=frozenset({"projectId"}),
    )]
