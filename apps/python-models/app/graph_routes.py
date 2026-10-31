"""ThinkGraph, KnowGraph, and Jev route owners."""
# Graph + less = more: less code that does the same work as more code is more useful.
# Entity names the feature; Relationship explains why this file belongs and what it contributes.
# Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
# Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
# Entity: Project Knowledge Graph
# Relationship: This file mounts the established Python-rails graph read and settlement routes without combining graph writers.
# Entity: ThinkGraph
# Relationship: This file exposes Engraphis projection, neighborhood, operation, completed-pair preparation, and completed-pair settlement routes.
# Entity: KnowGraph
# Relationship: This file exposes Graphiti reads, bounded Jev fact classification, and process-authenticated research context, policy, and preparation routes while Graphiti remains writer.
# Entity: CodeGraph
# Relationship: This file exposes the fixed saved-Builder CodeGraph read route and forwards validation failures without raw provider access.
# Entity: Jev Decisions
# Relationship: This file exposes bounded focus and shared relationship-vocabulary operations and returns explicit unavailable decisions without a success-shaped fallback.

from fastapi import APIRouter, HTTPException, Request
from typing import Any

graph_settlement_router = APIRouter()
graph_read_router = APIRouter()


def _research_process_authorized(request: Request) -> None:
    import hmac
    import os
    secret = os.environ.get("LIQUIDAITY_INTERNAL_MCP_SECRET", "")
    if len(secret) < 32 or not hmac.compare_digest(secret, request.headers.get("X-LiquidAIty-Internal-MCP-Secret", "")):
        raise HTTPException(403, "internal_process_authorization_required")


@graph_settlement_router.post("/knowgraph/research/context")
async def knowgraph_research_context(payload: dict[str, Any], request: Request):
    _research_process_authorized(request)
    import asyncio
    from app.python_models.project_graph_invocation import local_context_operation
    try:
        return await asyncio.to_thread(local_context_operation, payload.get("operation"), payload)
    except (ValueError, KeyError, TypeError) as error:
        raise HTTPException(400, str(error)) from None


@graph_settlement_router.post("/knowgraph/research/policy")
async def knowgraph_research_policy(payload: dict[str, Any], request: Request):
    _research_process_authorized(request)
    from app.python_models.saved_cards import project_research_policy
    import asyncio
    return await asyncio.to_thread(project_research_policy, str(payload.get("projectId") or ""), payload.get("enabled"))


@graph_settlement_router.post("/knowgraph/research/prepare")
async def knowgraph_research_prepare(payload: dict[str, Any], request: Request):
    _research_process_authorized(request)
    from app.python_models.project_graph_invocation import prepare_automatic_research
    import asyncio
    return await asyncio.to_thread(prepare_automatic_research, str(payload.get("projectId") or ""),
                                   str(payload.get("pairReference") or ""), str(payload.get("thinkId") or ""))

@graph_settlement_router.post("/knowgraph/jev/classify")
async def knowgraph_jev_classify(payload: dict[str, Any]):
    """Derive Jev Choice metadata for selected Graphiti facts."""
    from app.python_models.knowgraph_jev import (
        KnowGraphJevError,
        classify_knowgraph_facts,
    )
    from app.python_models.thinkgraph_relationship_vocabulary import (
        ThinkGraphIntakeError,
        promote_project_relationship_label,
        read_project_relationship_vocabulary,
    )
    import asyncio

    project = str(payload.get("projectId") or "")
    facts = payload.get("facts")
    if (
        not project
        or not isinstance(facts, list)
        or any(not isinstance(item, dict) for item in facts)
    ):
        raise HTTPException(status_code=400, detail="knowgraph_jev_facts_invalid")
    try:
        before = await asyncio.to_thread(
            read_project_relationship_vocabulary,
            project,
        )
        vocabulary = tuple(str(value) for value in before["labels"])
        results = await asyncio.to_thread(
            lambda: classify_knowgraph_facts(
                facts,
                relationship_vocabulary=vocabulary,
            )
        )
        for result in results:
            if result.get("status") != "success":
                continue
            winner = str(result.get("winner") or "")
            candidate = str(result.get("novel_relationship_candidate") or "")
            if not candidate or winner != candidate:
                result["vocabulary_promotion"] = "not_promoted"
                continue
            try:
                promoted = await asyncio.to_thread(
                    promote_project_relationship_label,
                    project,
                    winner,
                )
            except ThinkGraphIntakeError as error:
                result.update({
                    "status": "error",
                    "failure_reason": str(error),
                    "vocabulary_promotion": "failed",
                })
                continue
            result.update({
                "vocabulary_promotion": (
                    "promoted" if promoted["promoted"]
                    else "reused_concurrent"
                ),
                "vocabulary_after_hash": promoted["hash"],
                "vocabulary_after_count": promoted["count"],
            })
        after = await asyncio.to_thread(
            read_project_relationship_vocabulary,
            project,
        )
        for result in results:
            if result.get("status") == "success":
                result["vocabulary_after_hash"] = after["hash"]
                result["vocabulary_after_count"] = after["count"]
        unfinished_fact_uuids = [
            str(result.get("graphitiFactUuid") or "")
            for result in results
            if result.get("status") == "unfinished"
        ]
        return {
            "results": results,
            "attemptedFactUuids": [
                str(result.get("graphitiFactUuid") or "")
                for result in results
                if result.get("status") != "unfinished"
            ],
            "unfinishedFactUuids": unfinished_fact_uuids,
            "relationshipVocabulary": {
                "before": before,
                "after": after,
                "added": [
                    label for label in after["labels"]
                    if label not in before["labels"]
                ],
            },
        }
    except KnowGraphJevError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err
    except (ThinkGraphIntakeError, RuntimeError, ValueError) as err:
        raise HTTPException(status_code=502, detail=str(err)) from err


@graph_settlement_router.post("/graph/relationship-vocabulary/read")
async def graph_relationship_vocabulary_read(payload: dict[str, Any]):
    """Return one project's vocabulary for existing graph-writer prompts."""
    from app.python_models.thinkgraph_relationship_vocabulary import (
        ThinkGraphIntakeError,
        read_project_relationship_vocabulary,
    )
    import asyncio

    project = str(payload.get("projectId") or "")
    if not project:
        raise HTTPException(
            status_code=400,
            detail="project_relationship_vocabulary_project_invalid",
        )
    try:
        return await asyncio.to_thread(
            read_project_relationship_vocabulary,
            project,
        )
    except (ThinkGraphIntakeError, RuntimeError, ValueError) as err:
        raise HTTPException(status_code=502, detail=str(err)) from err


@graph_settlement_router.post("/graph/jev-focus")
async def graph_jev_focus(payload: dict[str, Any]):
    """Rerank one bounded client-supplied provider-entity neighborhood."""
    from app.python_models.jev_graph_focus import JevGraphError, decide_graph_focus
    import asyncio

    source_revision = (
        payload.get("sourceRevision")
        if isinstance(payload, dict) and isinstance(payload.get("sourceRevision"), str)
        else ""
    )
    try:
        return await asyncio.to_thread(decide_graph_focus, payload)
    except JevGraphError as err:
        return {
            "schemaVersion": "jev-focus.v1",
            "sourceRevision": source_revision,
            "status": err.status,
            "decisionId": None,
            "errorCode": err.error_code,
            "distribution": {},
            "candidates": [],
        }


@graph_settlement_router.post("/thinkgraph/operation")
async def thinkgraph_operation(payload: dict[str, Any]):
    from app.python_models.engraphis_operations import invoke_tool, private_operation
    import asyncio
    try:
        project = str(payload.get("projectId") or "")
        operation = str(payload.get("operation") or "")
        arguments = payload.get("arguments") or {}
        if operation.startswith("engraphis_"):
            return await invoke_tool(project, operation, arguments)
        return await asyncio.to_thread(private_operation, project, operation, arguments)
    except (RuntimeError, ValueError, KeyError) as err:
        raise HTTPException(status_code=409, detail=str(err)) from err


@graph_settlement_router.post("/thinkgraph/completed-pair/prepare")
async def thinkgraph_completed_pair_prepare(payload: dict[str, Any]):
    """Prepare one completed Main pair for its saved ThinkGraph Card pass."""
    from app.python_models.thinkgraph_completed_pair_preparation import (
        prepare_completed_pair,
    )
    from app.python_models.thinkgraph_relationship_vocabulary import ThinkGraphIntakeError
    import asyncio
    try:
        return await asyncio.to_thread(prepare_completed_pair, payload)
    except (ValueError, KeyError) as err:
        raise HTTPException(status_code=400, detail=str(err)) from err
    except (ThinkGraphIntakeError, RuntimeError) as err:
        raise HTTPException(status_code=502, detail=str(err)) from err


@graph_settlement_router.post("/thinkgraph/completed-pair/settle")
async def thinkgraph_completed_pair_settle(payload: dict[str, Any]):
    """Persist the saved Card's structured facts through Engraphis."""
    from app.python_models.thinkgraph_completed_pair_settlement import (
        settle_completed_pair,
    )
    from app.python_models.thinkgraph_relationship_vocabulary import ThinkGraphIntakeError
    import asyncio
    try:
        return await asyncio.to_thread(settle_completed_pair, payload)
    except (ValueError, KeyError) as err:
        raise HTTPException(status_code=400, detail=str(err)) from err
    except (ThinkGraphIntakeError, RuntimeError) as err:
        raise HTTPException(status_code=502, detail=str(err)) from err

@graph_read_router.get("/thinkgraph/projection")
def thinkgraph_projection(
    projectId: str,
):
    """Read the Engraphis projection for the selected project."""
    from app.python_models.thinkgraph_projection import projection

    project_id = str(projectId or "").strip()
    if not project_id:
        raise HTTPException(status_code=400, detail="projectId required")
    try:
        # The route keeps its stable transport contract. Engraphis owns the
        # bounded live topology; historical/type filtering is not fabricated.
        return projection(project_id)
    except Exception as err:
        raise HTTPException(status_code=500, detail=str(err)) from err


@graph_read_router.get("/knowgraph/projection")
def knowgraph_projection_read(projectId: str, limit: int = 200):
    """Read the bounded Graphiti projection for one canonical Project."""

    from app.python_models.data_anchor_contract import DataAnchorError
    from app.python_models.knowgraph_projection_reads import (
        read_knowgraph_projection,
    )

    try:
        return read_knowgraph_projection(projectId, limit)
    except (DataAnchorError, ValueError) as err:
        raise HTTPException(status_code=409, detail=str(err)) from err


@graph_read_router.get("/knowgraph/neighborhood")
def knowgraph_neighborhood_read(
    projectId: str,
    nodeId: str,
    limit: int = 50,
):
    """Read one bounded one-hop Graphiti neighborhood."""

    from app.python_models.data_anchor_contract import DataAnchorError
    from app.python_models.knowgraph_projection_reads import (
        read_knowgraph_neighborhood,
    )

    try:
        return read_knowgraph_neighborhood(projectId, nodeId, limit)
    except (DataAnchorError, ValueError) as err:
        raise HTTPException(status_code=409, detail=str(err)) from err


@graph_read_router.get("/thinkgraph/neighborhood")
def thinkgraph_neighborhood(projectId: str, canonicalId: str):
    """Read one exact Engraphis memory and its Engraphis neighborhood."""
    from app.python_models.thinkgraph_projection import projection

    project_id = str(projectId or "").strip()
    canonical_id = str(canonicalId or "").strip()
    if not project_id or not canonical_id:
        raise HTTPException(status_code=400, detail="projectId and canonicalId required")
    try:
        return projection(project_id, canonical_id)
    except Exception as err:
        raise HTTPException(status_code=500, detail=str(err)) from err


@graph_read_router.post("/codegraph/read")
def codegraph_read(payload: dict[str, Any]):
    """Read one bounded CodeGraph view through the persisted Builder grants."""

    from app.python_models.codegraph_reference_reads import read_codegraph_view
    from app.python_models.data_anchor_contract import DataAnchorError

    try:
        return read_codegraph_view(payload)
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err
    except DataAnchorError as err:
        raise HTTPException(status_code=409, detail=str(err)) from err
