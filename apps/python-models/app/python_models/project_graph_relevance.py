"""Provider graph retrieval followed by bounded Jev context relevance."""

# Entity: Project Knowledge Graph
# Relationship: This file builds the non-persisting current-request grounding packet shared with Cards from bounded provider-owned graph records.
# Entity: ThinkGraph
# Relationship: This file retrieves exact Project Think candidates and one distinct recent Think while preserving Engraphis record identity.
# Entity: KnowGraph
# Relationship: This file retrieves exact atomic and historical Know candidates and one distinct recent Know while preserving Graphiti record identity.
# Entity: Jev Decisions
# Relationship: This file asks Jev to rank bounded provider candidates for current-request relevance without changing either graph authority.

from __future__ import annotations

import asyncio
from copy import deepcopy
import hashlib
import json
import threading
from typing import Any, Callable

from engraphis.core.interfaces import MemoryType
from mcp.types import CallToolResult

from app import mcp_graphiti_provider, mcp_provider_operations
from app.python_models import card_run_jev
from app.python_models.engraphis import (
    SERVICE_LOCK,
    exact_think_entity_ids,
    get_service,
    project_id,
    read_recent_project_thinks,
    validated_think_metadata,
)
from app.python_models.knowgraph_exact_reads import (
    read_knowgraph_entity_know_candidates,
    read_recent_knowgraph_knows,
)


_DEFAULT_CANDIDATE_LIMIT = 12
_MAX_CANDIDATE_LIMIT = 24
_RELEVANT_LIMIT = 1
_QUERY_LIMIT = 16_000
_CONTEXT_LIMIT = 16_000
_BODY_LIMIT = 8_000
_JEV_TIMEOUT_SECONDS = 8.0
_GROUNDING_MARKER = "PROJECT GRAPH GROUNDING (CURRENT REQUEST):"
_GRAPHITI_RETRIEVAL_LOCK = threading.Lock()


def _bounded_text(value: Any, limit: int) -> str:
    return str(value or "").strip()[:limit]


def _candidate_limit(result_limit: int) -> int:
    return min(_MAX_CANDIDATE_LIMIT, max(_DEFAULT_CANDIDATE_LIMIT, result_limit * 2))


def _think_record(memory: Any, entity_id: str, think: dict[str, Any]) -> dict[str, Any]:
    return {
        "engraphisMemoryId": str(memory.id),
        "engraphisEntityId": entity_id,
        "body": str(think["summary"]),
        **({"detail": str(think["detail"])} if think.get("detail") else {}),
        "validFrom": memory.valid_from,
        "validTo": memory.valid_to,
        "ingestedAt": memory.ingested_at,
    }


def _provider_think_records(
    project: str,
    query: str,
    result_limit: int = 1,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
    service = get_service()
    project = project_id(project)
    candidate_limit = _candidate_limit(result_limit)
    recent = read_recent_project_thinks(project, limit=result_limit)
    with SERVICE_LOCK:
        result = service.recall(
            query,
            workspace=project,
            mtypes=[MemoryType.EPISODIC],
            k=candidate_limit,
            retrieval_profile="balanced",
            response_mode="full",
            record_receipt=False,
            jev_assisted=False,
        )
        rows = result.get("memories") if isinstance(result, dict) else None
        metadata = {
            "retrieval": "engraphis_provider",
            "semanticSupport": bool(result.get("semantic_support"))
            if isinstance(result, dict) else False,
            "degradedMode": bool(result.get("degraded_mode"))
            if isinstance(result, dict) else False,
        }
        memory_ids = [
            str(row.get("id") or "").strip()
            for row in rows if isinstance(row, dict)
        ] if isinstance(rows, list) else []
        memory_ids = list(dict.fromkeys(value for value in memory_ids if value))
        workspace = service.store.conn.execute(
            "SELECT id FROM workspaces WHERE name=?", (project,),
        ).fetchone()
        if workspace is None or not memory_ids:
            return recent, [], metadata
        workspace_id = str(workspace["id"])
        exact_entities = exact_think_entity_ids(
            service.store,
            workspace_id=workspace_id,
            memory_ids=memory_ids,
        )
        candidates: list[dict[str, Any]] = []
        for memory_id in memory_ids:
            memory = service.store.get_memory(memory_id)
            think = validated_think_metadata(memory) if memory is not None else None
            entity_id = exact_entities.get(memory_id)
            if memory is None or think is None or not entity_id:
                continue
            candidates.append(_think_record(memory, entity_id, think))
            if len(candidates) == candidate_limit:
                break
    return recent, candidates, metadata


def _tool_payload(result: Any) -> dict[str, Any]:
    if isinstance(result, dict):
        return result.get("result") if isinstance(result.get("result"), dict) else result
    if isinstance(result, CallToolResult):
        if result.is_error:
            raise RuntimeError("knowgraph_provider_retrieval_unavailable")
        structured = result.structured_content
        if isinstance(structured, dict):
            payload = structured.get("result")
            if isinstance(payload, dict):
                return payload
            return structured
        for block in result.content:
            text = getattr(block, "text", "")
            if not isinstance(text, str) or not text:
                continue
            value = json.loads(text)
            if isinstance(value, dict):
                return value.get("result") if isinstance(value.get("result"), dict) else value
    raise RuntimeError("knowgraph_provider_retrieval_invalid")


async def _search_graphiti_entities(project: str, query: str) -> list[str]:
    try:
        result = await mcp_provider_operations.call_graphiti_operation("search_nodes", {
            "query": query,
            "group_ids": [mcp_provider_operations.graphiti_project_group_id(project)],
            "max_nodes": 8,
        })
    finally:
        # Python rails calls Graphiti grounding from synchronous request workers.
        # Each call owns a short-lived event loop, so the async Neo4j client must
        # be closed before that loop exits instead of being reused by the next
        # worker on a dead transport. The canonical MCP host runs in a separate
        # process and keeps its Graphiti client for that host's lifetime.
        await mcp_graphiti_provider.close_graphiti()
    payload = _tool_payload(result)
    nodes = payload.get("nodes")
    if not isinstance(nodes, list):
        raise RuntimeError("knowgraph_provider_retrieval_invalid")
    return list(dict.fromkeys(
        str(node.get("uuid") or "").strip()
        for node in nodes if isinstance(node, dict) and str(node.get("uuid") or "").strip()
    ))


def _provider_know_records(
    project: str,
    query: str,
    result_limit: int = 1,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
    with _GRAPHITI_RETRIEVAL_LOCK:
        entity_ids = asyncio.run(_search_graphiti_entities(project, query))
    candidate_limit = _candidate_limit(result_limit)
    recent = read_recent_knowgraph_knows(project, limit=result_limit)
    candidates: list[dict[str, Any]] = []
    seen: set[str] = set()
    metadata = {
        "retrieval": "graphiti_provider_entity_search",
        "matchedEntityCount": len(entity_ids),
    }
    for entity_id in entity_ids:
        for record in read_knowgraph_entity_know_candidates(
            project, entity_id, limit=3,
        ):
            episode_id = str(record.get("graphitiEpisodeId") or "")
            if not episode_id or episode_id in seen:
                continue
            seen.add(episode_id)
            candidates.append(record)
            if len(candidates) == candidate_limit:
                return recent, candidates, metadata
    return recent, candidates, metadata


def _record_id(authority: str, record: dict[str, Any]) -> str:
    field = "engraphisMemoryId" if authority == "thinkgraph" else "graphitiEpisodeId"
    return str(record.get(field) or "")


def _choice_id(authority: str, record_id: str) -> str:
    digest = hashlib.sha256(f"{authority}:{record_id}".encode("utf-8")).hexdigest()[:24]
    return f"context_{digest}"


def _bounded_know_candidate(record: dict[str, Any]) -> dict[str, Any]:
    citation = record.get("citation")
    citation = citation if isinstance(citation, dict) else {}
    direction = record.get("direction")
    direction = direction if isinstance(direction, dict) else {}
    return {
        "kind": "Know",
        "observation": _bounded_text(record.get("observation"), _BODY_LIMIT),
        "interpretation": _bounded_text(record.get("interpretation"), _BODY_LIMIT),
        "citation": {
            "title": _bounded_text(citation.get("title"), 1000),
            "publisher": _bounded_text(citation.get("publisher"), 1000),
            "evidence": _bounded_text(citation.get("evidence"), _BODY_LIMIT),
            "url": _bounded_text(
                citation.get("resolvedUrl") or citation.get("url"),
                2048,
            ),
        },
        **({"direction": {
            "proposition": _bounded_text(direction.get("proposition"), _BODY_LIMIT),
            "relation": _bounded_text(direction.get("relation"), 32),
        }} if direction else {}),
    }


def _jev_relevance(
    query: str,
    context: str,
    candidates: dict[str, list[dict[str, Any]]],
    result_limit: int = _RELEVANT_LIMIT,
) -> dict[str, dict[str, Any]]:
    questions: dict[str, Any] = {}
    choice_maps: dict[str, dict[str, dict[str, Any]]] = {}
    state_candidates: dict[str, list[dict[str, Any]]] = {}
    for authority in ("thinkgraph", "knowgraph"):
        records = candidates.get(authority, [])
        if not records:
            continue
        mapping: dict[str, dict[str, Any]] = {}
        options: list[dict[str, Any]] = []
        for record in records:
            record_id = _record_id(authority, record)
            if not record_id:
                continue
            choice_id = _choice_id(authority, record_id)
            mapping[choice_id] = record
            options.append({
                "choice_id": choice_id,
                "entity_id": str(record.get(
                    "engraphisEntityId" if authority == "thinkgraph" else "graphitiEntityId"
                ) or ""),
                **({
                    "body": _bounded_text(record.get("body"), _BODY_LIMIT),
                    **({"detail": _bounded_text(record.get("detail"), _BODY_LIMIT)}
                       if record.get("detail") else {}),
                } if authority == "thinkgraph" else _bounded_know_candidate(record)),
            })
        if not mapping:
            continue
        state_candidates[authority] = options
        question_id = f"{authority}_relevance"
        choice_maps[question_id] = mapping
        questions[question_id] = {
            "type": "choice",
            "instructions": (
                "Return a full probability distribution across every opaque candidate id. "
                + (
                    "Rate which exact stored Think most faithfully steelmans the user's current "
                    "idea and makes its strongest useful optimistic case without changing its intent. "
                    if authority == "thinkgraph" else
                    "Rate which exact stored sourced Know is most directly useful to the current "
                    "idea. A Know is one verified observation, a separate interpretation, one "
                    "inspectable citation and exactly one ABOUT Entity attachment. It may support, "
                    "challenge, or contextualize an explicit proposition. Rate the complete stored "
                    "record without inventing a fixed sentiment balance. "
                )
                + "Do not reward mere recency or repetition of the immediately previous turn. "
                "This is contextual relevance, not truth, authority, claim confidence, or "
                "permission to write."
            ),
            "criteria": {
                choice_id: (
                    "Judge this complete stored record against the current user request and "
                    "bounded context for direct usefulness."
                )
                for choice_id in mapping
            },
        }
    if not questions:
        return {
            authority: {"status": "empty", "records": [], "decisionId": None}
            for authority in ("thinkgraph", "knowgraph")
        }
    body = {
        "model": card_run_jev.JEV_MODEL,
        "state": {
            "description": "Provider graph-retrieval candidates for the current Project request.",
            "current_user_request": _bounded_text(query, _QUERY_LIMIT),
            "bounded_context": _bounded_text(context, _CONTEXT_LIMIT),
            "candidates": state_candidates,
        },
        "questions": questions,
    }
    try:
        response = card_run_jev.request_jev_decision(
            body,
            prefix="project_graph_relevance",
            timeout_seconds=_JEV_TIMEOUT_SECONDS,
        )
        selected: dict[str, dict[str, Any]] = {}
        for question_id, mapping in choice_maps.items():
            decision_id, distribution, confidence = card_run_jev.validated_choice_distribution(
                response, question_id, tuple(mapping),
            )
            authority = question_id.removesuffix("_relevance")
            ranked = sorted(
                mapping,
                key=lambda choice_id: (-distribution[choice_id], choice_id),
            )
            selected[authority] = {
                "status": "success",
                "decisionId": decision_id,
                "confidence": confidence,
                "records": [
                    {
                        **deepcopy(mapping[choice_id]),
                        "relevance": distribution[choice_id],
                        "relevanceRank": index,
                    }
                    for index, choice_id in enumerate(
                        ranked[:result_limit], start=1,
                    )
                ],
            }
        return {
            authority: selected.get(
                authority,
                {"status": "empty", "records": [], "decisionId": None},
            )
            for authority in ("thinkgraph", "knowgraph")
        }
    except Exception as error:
        status = str(getattr(error, "status", "unavailable"))
        error_code = str(
            getattr(error, "error_code", "project_graph_relevance_unavailable")
        )
        return {
            authority: {
                "status": status,
                "errorCode": error_code,
                "decisionId": None,
                "records": [],
            }
            for authority in ("thinkgraph", "knowgraph")
        }


Retriever = Callable[
    [str, str, int],
    tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]],
]
Rater = Callable[
    [str, str, dict[str, list[dict[str, Any]]], int],
    dict[str, dict[str, Any]],
]


def build_project_graph_grounding(
    project: str,
    query: str,
    *,
    context: str = "",
    think_retriever: Retriever = _provider_think_records,
    know_retriever: Retriever = _provider_know_records,
    relevance_rater: Rater = _jev_relevance,
    result_limit: int = 1,
    authorities: tuple[str, ...] = ("thinkgraph", "knowgraph"),
) -> dict[str, Any]:
    """Build one non-persisting Recent/Relevant packet for the current request."""

    project = project_id(project)
    query = _bounded_text(query, _QUERY_LIMIT)
    if not query:
        raise ValueError("project_graph_relevance_query_required")
    if isinstance(result_limit, bool) or not isinstance(result_limit, int) \
            or not 1 <= result_limit <= _MAX_CANDIDATE_LIMIT // 2:
        raise ValueError("project_graph_relevance_limit_invalid")
    selected_authorities = tuple(dict.fromkeys(authorities))
    if not selected_authorities or any(
        authority not in {"thinkgraph", "knowgraph"}
        for authority in selected_authorities
    ):
        raise ValueError("project_graph_relevance_authority_invalid")
    recent: dict[str, list[dict[str, Any]]] = {}
    candidates: dict[str, list[dict[str, Any]]] = {}
    provider: dict[str, dict[str, Any]] = {}
    failures: dict[str, str] = {}
    retrievers = {
        "thinkgraph": think_retriever,
        "knowgraph": know_retriever,
    }
    for authority in selected_authorities:
        retriever = retrievers[authority]
        try:
            authority_recent, authority_candidates, metadata = retriever(
                project, query, result_limit,
            )
            recent[authority] = authority_recent[:result_limit]
            recent_ids = {
                _record_id(authority, record) for record in recent[authority]
            }
            candidates[authority] = [
                record for record in authority_candidates
                if _record_id(authority, record) not in recent_ids
            ][:_candidate_limit(result_limit)]
            provider[authority] = metadata
        except Exception:
            recent[authority] = []
            candidates[authority] = []
            provider[authority] = {"retrieval": f"{authority}_provider"}
            failures[authority] = f"{authority}_provider_retrieval_unavailable"
    rated = relevance_rater(query, context, candidates, result_limit)
    authority_packets: dict[str, Any] = {}
    for authority in selected_authorities:
        relevance = rated.get(authority) or {
            "status": "empty", "records": [], "decisionId": None,
        }
        if authority in failures:
            relevance = {
                "status": "unavailable",
                "errorCode": failures[authority],
                "decisionId": None,
                "records": [],
            }
        authority_packets[authority] = {
            "recent": recent[authority],
            "relevant": list(relevance.get("records") or [])[:result_limit],
            "candidateCount": len(candidates[authority]),
            "relevanceStatus": str(relevance.get("status") or "empty"),
            "decisionId": relevance.get("decisionId"),
            **({"confidence": relevance["confidence"]}
               if relevance.get("confidence") is not None else {}),
            **({"errorCode": relevance["errorCode"]}
               if relevance.get("errorCode") else {}),
            "provider": provider[authority],
        }
    packet = {
        "schemaVersion": "project-graph.grounding.v1",
        "projectId": project,
        "resultLimit": result_limit,
        "querySha256": hashlib.sha256(query.encode("utf-8")).hexdigest(),
        "authorities": authority_packets,
    }
    packet["revision"] = hashlib.sha256(
        json.dumps(packet, ensure_ascii=False, sort_keys=True, default=str).encode("utf-8")
    ).hexdigest()
    return packet


def append_project_graph_grounding(graph_context: str, packet: dict[str, Any]) -> str:
    """Append the exact current-request packet once to canonical graph context."""

    base = str(graph_context or "").rstrip()
    if _GROUNDING_MARKER in base:
        return base
    encoded = json.dumps(packet, ensure_ascii=False, sort_keys=True, default=str)
    return f"{base}\n\n{_GROUNDING_MARKER}\n{encoded}" if base else (
        f"{_GROUNDING_MARKER}\n{encoded}"
    )
