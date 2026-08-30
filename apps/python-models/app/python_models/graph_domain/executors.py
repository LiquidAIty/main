"""One bounded executor for LiquidAIty graph recipes.

Canonical tool names identify operations, while injected adapters choose the
real direct-Python or process-boundary transport. The executor never opens a
graph database and never creates a second graph authority.
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from datetime import datetime, timezone
import json
import json
from time import monotonic
from typing import Any

from app.python_models.graph_domain.contracts import (
    CodeContextRequest,
    CrossGraphContextRequest,
    KnowContextRequest,
    ThinkContextRequest,
)
from app.python_models.graph_domain.recipes import graph_recipe_manifest


AsyncNativeCall = Callable[[str, dict[str, Any]], Awaitable[dict[str, Any]]]
SyncNativeCall = Callable[[str, dict[str, Any]], dict[str, Any]]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _strings(value: Any) -> list[str]:
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except (TypeError, ValueError, json.JSONDecodeError):
            parsed = value
        value = parsed
    if isinstance(value, list):
        return list(dict.fromkeys(
            str(item).strip() for item in value if str(item).strip()
        ))
    return [value.strip()] if isinstance(value, str) and value.strip() else []


def _records(payload: dict[str, Any], *keys: str) -> list[dict[str, Any]]:
    for key in keys:
        value = payload.get(key)
        if isinstance(value, list):
            return [dict(item) for item in value if isinstance(item, dict)]
    nested = payload.get("result")
    return _records(nested, *keys) if isinstance(nested, dict) else []


def _table_records(payload: dict[str, Any]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []

    def append(columns: Any, values: Any, prefix: str = "", file_path: str = "") -> None:
        if not isinstance(columns, list) or not isinstance(values, list):
            return
        for value in values:
            if isinstance(value, dict):
                row = dict(value)
            elif isinstance(value, list):
                row = {
                    str(column): value[index]
                    for index, column in enumerate(columns)
                    if index < len(value)
                }
            else:
                continue
            name = str(row.get("name") or "").strip()
            if prefix and name and not str(row.get("qn") or row.get("qualified_name") or "").strip():
                row["qualified_name"] = f"{prefix}.{name}"
            if file_path and not str(row.get("file") or row.get("file_path") or "").strip():
                row["file_path"] = file_path
            rows.append(row)

    columns = payload.get("cols")
    append(columns, payload.get("rows"))
    for group in payload.get("groups") or []:
        if isinstance(group, dict):
            append(
                group.get("cols") or columns,
                group.get("rows"),
                str(group.get("qn_prefix") or group.get("prefix") or "").strip(),
                str(group.get("file") or group.get("file_path") or "").strip(),
            )
    return rows


def _stage_receipt(
    operation: str,
    started: float,
    payload: dict[str, Any],
    native_ids: list[str],
) -> dict[str, Any]:
    return {
        "operation": operation,
        "state": "completed",
        "durationMs": int((monotonic() - started) * 1_000),
        "nativeIds": list(dict.fromkeys(native_ids)),
        "engine": payload.get("engine"),
        "engineVersion": payload.get("engineVersion"),
        "engineRevision": payload.get("engineRevision"),
        "databasePath": payload.get("databasePath"),
    }


def _aggregate_receipt(
    recipe_id: str,
    started: float,
    stages: list[dict[str, Any]],
    native_references: list[dict[str, Any]],
) -> dict[str, Any]:
    return {
        "schemaVersion": "graph-recipe-receipt.v1",
        "recipeId": recipe_id,
        "state": "completed",
        "readOnly": True,
        "durationMs": int((monotonic() - started) * 1_000),
        "underlyingCallCount": len(stages),
        "nativeReferenceCount": len(native_references),
        "stages": stages,
    }


_THINK_CONCEPTS = {
    "goal": "goal",
    "idea": "idea",
    "hypothesis": "hypothesis",
    "decision": "decision",
    "question": "question",
    "unresolved_question": "question",
    "conflict": "conflict",
    "alternative": "alternative",
}


def _think_concept(row: dict[str, Any]) -> str:
    explicit = [
        str(row.get("node_type") or "").strip().casefold(),
        str(row.get("subkind") or "").strip().casefold(),
        *[tag.casefold() for tag in _strings(row.get("tags"))],
    ]
    return next((_THINK_CONCEPTS[value] for value in explicit if value in _THINK_CONCEPTS), "thought")


def execute_think_context(
    project_id: str,
    request: ThinkContextRequest | dict[str, Any],
    *,
    native_call: SyncNativeCall,
) -> dict[str, Any]:
    """Run deterministic context then bounded exact inspection in one owner."""

    started = monotonic()
    resolved = request if isinstance(request, ThinkContextRequest) else ThinkContextRequest.model_validate(request)
    stages: list[dict[str, Any]] = []
    context_args = {
        "focus": resolved.focus,
        "budget": resolved.budget,
        "maxDepth": resolved.maxDepth,
        "maxL2": resolved.maxL2,
    }
    stage_started = monotonic()
    context = native_call("constellation.context", context_args)
    context_rows = _records(context, "nodes", "memories", "records")
    context_ids = [str(row.get("id") or row.get("memory_id") or "").strip() for row in context_rows]
    context_ids = list(dict.fromkeys(value for value in context_ids if value))
    stages.append(_stage_receipt("constellation.context", stage_started, context, context_ids))

    exact_by_id: dict[str, dict[str, Any]] = {}
    exact_edge_rows: list[dict[str, Any]] = []
    for native_id in context_ids[:resolved.inspectTop]:
        stage_started = monotonic()
        inspected = native_call("constellation.inspect", {
            "nativeId": native_id,
            "budget": min(resolved.budget, 4_000),
            "maxDepth": min(resolved.maxDepth, 1),
            "maxL2": resolved.maxL2,
        })
        row = inspected.get("inspectedNode")
        if isinstance(row, dict) and str(row.get("id") or "").strip() == native_id:
            exact_by_id[native_id] = dict(row)
        exact_edge_rows.extend(_records(inspected, "inspectedEdges"))
        stages.append(_stage_receipt("constellation.inspect", stage_started, inspected, [native_id]))

    nodes: list[dict[str, Any]] = []
    for row in context_rows:
        native_id = str(row.get("id") or row.get("memory_id") or "").strip()
        if not native_id:
            continue
        current = {**row, **exact_by_id.get(native_id, {})}
        nodes.append({
            "nativeId": native_id,
            "concept": _think_concept(current),
            "summary": str(current.get("l0") or current.get("content") or native_id),
            "reasoning": str(current.get("l1") or ""),
            "detail": str(current.get("l2") or ""),
            "tags": _strings(current.get("tags")),
            "tone": current.get("tone"),
            "valence": current.get("valence"),
            "arousal": current.get("arousal"),
            "weight": current.get("weight"),
            "distance": current.get("distance"),
            "activation": current.get("activation"),
            "source": current.get("source"),
            "createdAt": current.get("created_at"),
            "updatedAt": current.get("updated_at"),
        })

    edge_rows = [*_records(context, "edges"), *exact_edge_rows]
    edges: list[dict[str, Any]] = []
    seen_edges: set[tuple[str, str, str, str]] = set()
    for row in edge_rows:
        source = str(row.get("source") or row.get("from") or "").strip()
        target = str(row.get("target") or row.get("to") or "").strip()
        relation = str(row.get("edge_type") or row.get("type") or "associative").strip()
        native_id = str(row.get("id") or "").strip()
        identity = (native_id, source, target, relation)
        if not source or not target or identity in seen_edges:
            continue
        seen_edges.add(identity)
        edges.append({
            **({"nativeId": native_id} if native_id else {}),
            "sourceNativeId": source,
            "targetNativeId": target,
            "relation": relation,
            "strength": row.get("strength"),
            "fineType": row.get("fine_type"),
            "fineConfidence": row.get("fine_confidence"),
        })

    native_references = [
        {"authority": "ThinkGraph", "nativeKind": "node", "nativeId": row["nativeId"]}
        for row in nodes
    ]
    native_references.extend(
        {"authority": "ThinkGraph", "nativeKind": "edge", "nativeId": row["nativeId"]}
        for row in edges if row.get("nativeId")
    )
    stats = context.get("stats") if isinstance(context.get("stats"), dict) else {}
    truncated = bool(
        context.get("truncated") is True
        or int(
            stats.get("total_nodes")
            or stats.get("total")
            or stats.get("matched")
            or len(nodes)
        ) > len(nodes)
    )
    semantic_state = str(context.get("semanticState") or "unknown")
    packet = {
        "schemaVersion": "think-context.v1",
        "recipe": graph_recipe_manifest("think.context.v1"),
        "authority": "ThinkGraph",
        "nativeOwner": "constellation-engine",
        "projectId": project_id,
        "retrievalMode": "deterministic-topology",
        "state": "empty" if not nodes else "ready",
        "empty": not nodes,
        "degraded": context.get("deterministicTopologyReady") is not True,
        "truncated": truncated,
        "semanticAvailability": {
            "state": semantic_state,
            "reason": context.get("semanticReason"),
            "used": False,
        },
        "nodes": nodes,
        "relationships": edges,
        "goals": [row for row in nodes if row["concept"] == "goal"],
        "ideasAndHypotheses": [row for row in nodes if row["concept"] in {"idea", "hypothesis"}],
        "decisions": [row for row in nodes if row["concept"] == "decision"],
        "unresolvedQuestions": [row for row in nodes if row["concept"] == "question"],
        "conflictsAndAlternatives": [row for row in nodes if row["concept"] in {"conflict", "alternative"}],
        "evidenceReferences": [],
        "missingEvidenceReferences": True,
        "nativeReferences": native_references,
        "retrievedAt": _now(),
    }
    packet["receipt"] = _aggregate_receipt("think.context.v1", started, stages, native_references)
    return packet


async def _timed_async_call(
    operation: str,
    arguments: dict[str, Any],
    native_call: AsyncNativeCall,
) -> tuple[dict[str, Any], dict[str, Any]]:
    started = monotonic()
    payload = await native_call(operation, arguments)
    ids = [
        str(row.get("uuid") or row.get("qualified_name") or row.get("qn") or "").strip()
        for row in [*_records(payload, "nodes", "facts", "episodes", "results"), *_table_records(payload)]
    ]
    return payload, _stage_receipt(operation, started, payload, [value for value in ids if value])


async def execute_know_context(
    project_id: str,
    request: KnowContextRequest | dict[str, Any],
    *,
    native_call: AsyncNativeCall,
) -> dict[str, Any]:
    """Run Graphiti fact/entity search plus bounded stored provenance reads."""

    started = monotonic()
    resolved = request if isinstance(request, KnowContextRequest) else KnowContextRequest.model_validate(request)
    node_args: dict[str, Any] = {"query": resolved.query, "max_nodes": resolved.maxEntities}
    fact_args: dict[str, Any] = {"query": resolved.query, "max_facts": resolved.maxFacts}
    if resolved.entityTypes:
        node_args["entity_types"] = resolved.entityTypes
    if resolved.edgeTypes:
        fact_args["edge_types"] = resolved.edgeTypes
    if resolved.validAtAfter:
        fact_args["valid_at_after"] = resolved.validAtAfter
    if resolved.validAtBefore:
        fact_args["valid_at_before"] = resolved.validAtBefore
    (nodes_payload, nodes_receipt), (facts_payload, facts_receipt) = await asyncio.gather(
        _timed_async_call("graphiti.search_nodes", node_args, native_call),
        _timed_async_call("graphiti.search_memory_facts", fact_args, native_call),
    )
    stages = [nodes_receipt, facts_receipt]
    entities = _records(nodes_payload, "nodes")[:resolved.maxEntities]
    facts = _records(facts_payload, "facts")[:resolved.maxFacts]

    if resolved.expandAroundTopEntity and entities:
        center = str(entities[0].get("uuid") or "").strip()
        if center:
            centered_nodes = {**node_args, "center_node_uuid": center}
            centered_facts = {**fact_args, "center_node_uuid": center}
            (more_nodes, more_nodes_receipt), (more_facts, more_facts_receipt) = await asyncio.gather(
                _timed_async_call("graphiti.search_nodes", centered_nodes, native_call),
                _timed_async_call("graphiti.search_memory_facts", centered_facts, native_call),
            )
            stages.extend([more_nodes_receipt, more_facts_receipt])
            entities.extend(_records(more_nodes, "nodes"))
            facts.extend(_records(more_facts, "facts"))

    def deduplicate(rows: list[dict[str, Any]], limit: int) -> list[dict[str, Any]]:
        result: list[dict[str, Any]] = []
        seen: set[str] = set()
        for row in rows:
            native_id = str(row.get("uuid") or "").strip()
            if not native_id or native_id in seen:
                continue
            seen.add(native_id)
            result.append(row)
            if len(result) >= limit:
                break
        return result

    entities = deduplicate(entities, resolved.maxEntities)
    facts = deduplicate(facts, resolved.maxFacts)
    episode_ids = list(dict.fromkeys(
        episode_id
        for fact in facts
        for episode_id in _strings(
            fact.get("episodes")
            or fact.get("episode_uuids")
            or fact.get("source_episode_uuids")
        )
    ))
    episodes: list[dict[str, Any]] = []
    if episode_ids:
        episodes_payload, episode_receipt = await _timed_async_call(
            "graphiti.get_episodes",
            {
                "max_episodes": resolved.maxEpisodes,
                "include_body": False,
                "body_preview_chars": 400,
                "max_response_chars": 20_000,
            },
            native_call,
        )
        stages.append(episode_receipt)
        selected = set(episode_ids)
        episodes = [
            row for row in _records(episodes_payload, "episodes")
            if str(row.get("uuid") or "") in selected
        ]

    entity_ids = {str(row.get("uuid") or "").strip() for row in entities}
    fact_ids = {str(row.get("uuid") or "").strip() for row in facts}
    native_references = [
        {"authority": "KnowGraph", "nativeKind": "node", "nativeId": value}
        for value in sorted(entity_ids - {""})
    ] + [
        {"authority": "KnowGraph", "nativeKind": "edge", "nativeId": value}
        for value in sorted(fact_ids - {""})
    ] + [
        {"authority": "KnowGraph", "nativeKind": "episode", "nativeId": value}
        for value in episode_ids
    ]
    cited_episode_ids = {
        str(row.get("uuid") or "") for row in episodes
        if str(row.get("source_description") or "").strip()
    }
    missing_episode_ids = [value for value in episode_ids if value not in cited_episode_ids]
    packet = {
        "schemaVersion": "know-context.v1",
        "recipe": graph_recipe_manifest("know.context.v1"),
        "authority": "KnowGraph",
        "nativeOwner": "graphiti",
        "projectId": project_id,
        "state": "empty" if not entities and not facts else "ready",
        "empty": not entities and not facts,
        "degraded": False,
        "truncated": len(entities) >= resolved.maxEntities or len(facts) >= resolved.maxFacts,
        "query": resolved.query,
        "entities": entities,
        "facts": facts,
        "relationships": [
            {
                "nativeId": str(row.get("uuid") or ""),
                "sourceNativeId": str(row.get("source_node_uuid") or ""),
                "targetNativeId": str(row.get("target_node_uuid") or ""),
                "relation": row.get("name"),
                "fact": row.get("fact"),
                "validAt": row.get("valid_at"),
                "invalidAt": row.get("invalid_at"),
            }
            for row in facts
        ],
        "episodes": episodes,
        "citations": [
            {
                "episodeUuid": str(row.get("uuid") or ""),
                "name": row.get("name"),
                "source": row.get("source"),
                "sourceDescription": row.get("source_description"),
                "observedAt": row.get("created_at"),
            }
            for row in episodes
        ],
        "missingCitation": bool(facts and (not episode_ids or missing_episode_ids)),
        "missingEpisodeUuids": missing_episode_ids,
        "nativeReferences": native_references,
        "retrievedAt": _now(),
    }
    packet["receipt"] = _aggregate_receipt("know.context.v1", started, stages, native_references)
    return packet


async def execute_code_context(
    request: CodeContextRequest | dict[str, Any],
    *,
    native_call: AsyncNativeCall,
) -> dict[str, Any]:
    """Run the established native CBM discovery-to-exact-source sequence."""

    started = monotonic()
    resolved = request if isinstance(request, CodeContextRequest) else CodeContextRequest.model_validate(request)
    stages: list[dict[str, Any]] = []
    graph_payload, receipt = await _timed_async_call(
        "cbm.search_graph",
        {"project": resolved.project, "query": resolved.query, "limit": resolved.maxSymbols, "format": "json"},
        native_call,
    )
    stages.append(receipt)
    graph_rows = [*_records(graph_payload, "results", "semantic_results"), *_table_records(graph_payload)]
    qualified_names = list(dict.fromkeys(
        str(row.get("qualified_name") or row.get("qn") or "").strip()
        for row in graph_rows
        if str(row.get("qualified_name") or row.get("qn") or "").strip()
    ))[:resolved.maxSymbols]

    code_payload, receipt = await _timed_async_call(
        "cbm.search_code",
        {"project": resolved.project, "pattern": resolved.query, "mode": "compact", "limit": resolved.maxSymbols},
        native_call,
    )
    stages.append(receipt)
    code_rows = [*_records(code_payload, "results"), *_table_records(code_payload)]
    traces: list[dict[str, Any]] = []
    snippets: list[dict[str, Any]] = []
    for qualified_name in qualified_names:
        if resolved.traceDepth:
            trace, receipt = await _timed_async_call(
                "cbm.trace_path",
                {
                    "project": resolved.project,
                    "function_name": qualified_name,
                    "direction": "both",
                    "depth": resolved.traceDepth,
                    "mode": "calls",
                    "include_tests": resolved.includeTests,
                    "limit": 48,
                    "format": "json",
                },
                native_call,
            )
            stages.append(receipt)
            traces.append({"nativeId": qualified_name, "result": trace})
        snippet, receipt = await _timed_async_call(
            "cbm.get_code_snippet",
            {"project": resolved.project, "qualified_name": qualified_name, "include_neighbors": False},
            native_call,
        )
        stages.append(receipt)
        snippets.append(snippet)

    relationship_readback: dict[str, Any] = {}
    if qualified_names:
        # Qualified names originate in the native CBM result above. JSON string
        # encoding produces bounded Cypher literals without accepting caller-
        # supplied query text on this purpose-built path.
        qn_literals = ", ".join(json.dumps(value, ensure_ascii=False) for value in qualified_names)
        relationship_readback, receipt = await _timed_async_call(
            "cbm.query_graph",
            {
                "project": resolved.project,
                "query": (
                    f"MATCH (n) WHERE n.qualified_name IN [{qn_literals}] "
                    "OPTIONAL MATCH (n)-[r]-(m) "
                    "RETURN n.qualified_name AS source, type(r) AS relationship, "
                    "m.qualified_name AS target "
                    f"LIMIT {max(12, resolved.maxSymbols * 12)}"
                ),
                "max_rows": max(12, resolved.maxSymbols * 12),
            },
            native_call,
        )
        stages.append(receipt)

    native_references = [
        {"authority": "CodeGraph", "nativeKind": "node", "nativeId": value}
        for value in qualified_names
    ]
    packet = {
        "schemaVersion": "code-context.v1",
        "recipe": graph_recipe_manifest("code.context.v1"),
        "authority": "CodeGraph",
        "nativeOwner": "codebase-memory-mcp",
        "project": resolved.project,
        "state": "empty" if not qualified_names and not code_rows else "ready",
        "empty": not qualified_names and not code_rows,
        "degraded": False,
        "truncated": bool(graph_payload.get("has_more") is True),
        "query": resolved.query,
        "symbols": graph_rows[:resolved.maxSymbols],
        "textMatches": code_rows[:resolved.maxSymbols],
        "traces": traces,
        "snippets": snippets,
        "relationshipReadback": relationship_readback,
        "nativeReferences": native_references,
        "retrievedAt": _now(),
    }
    packet["receipt"] = _aggregate_receipt("code.context.v1", started, stages, native_references)
    return packet


async def execute_cross_graph_context(
    project_id: str,
    request: CrossGraphContextRequest | dict[str, Any],
    *,
    think_call: Callable[[dict[str, Any]], Awaitable[dict[str, Any]]],
    know_call: Callable[[dict[str, Any]], Awaitable[dict[str, Any]]],
    code_call: Callable[[dict[str, Any]], Awaitable[dict[str, Any]]],
) -> dict[str, Any]:
    """Compose separate typed sections and native references without writes."""

    started = monotonic()
    resolved = request if isinstance(request, CrossGraphContextRequest) else CrossGraphContextRequest.model_validate(request)
    think = await think_call({
        "focus": resolved.mission,
        "budget": resolved.thinkBudget,
        "maxDepth": 2,
        "maxL2": 12,
        "inspectTop": 3,
    })
    thought_summaries = [
        str(row.get("summary") or "").strip()
        for row in think.get("nodes") or []
        if isinstance(row, dict) and str(row.get("summary") or "").strip()
    ][:3]
    evidence_query = "\n".join([resolved.mission, *thought_summaries])[:2_000]
    know = await know_call({
        "query": evidence_query,
        "maxEntities": resolved.evidenceLimit,
        "maxFacts": resolved.evidenceLimit,
        "expandAroundTopEntity": False,
        "maxEpisodes": 50,
    })
    code = None
    if resolved.includeCode:
        code = await code_call({
            "query": resolved.mission,
            "project": resolved.codeProject,
            "maxSymbols": resolved.codeSymbolLimit,
            "traceDepth": 2,
            "includeTests": False,
        })
    references = [
        reference
        for section in (think, know, code or {})
        for reference in section.get("nativeReferences") or []
        if isinstance(reference, dict)
    ]
    explicit = [anchor.model_dump() for anchor in resolved.anchors]
    seen: set[tuple[str, str]] = set()
    consumed: list[dict[str, Any]] = []
    for reference in [*explicit, *references]:
        identity = (str(reference.get("authority") or ""), str(reference.get("nativeId") or ""))
        if not all(identity) or identity in seen:
            continue
        seen.add(identity)
        consumed.append(dict(reference))
    return {
        "schemaVersion": "cross-graph-context.v1",
        "recipe": graph_recipe_manifest("graph.think-know-code.v1"),
        "projectId": project_id,
        "readOnly": True,
        "mission": resolved.mission,
        "sections": {"think": think, "know": know, "code": code},
        "consumedNativeReferences": consumed,
        "copiedGraphRecords": False,
        "writesPerformed": False,
        "receipt": {
            "schemaVersion": "graph-recipe-receipt.v1",
            "recipeId": "graph.think-know-code.v1",
            "state": "completed",
            "readOnly": True,
            "durationMs": int((monotonic() - started) * 1_000),
            "sectionReceipts": [
                section.get("receipt")
                for section in (think, know, code or {})
                if isinstance(section, dict) and isinstance(section.get("receipt"), dict)
            ],
        },
    }
