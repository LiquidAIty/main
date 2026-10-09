"""ThinkGraph, KnowGraph, and Jev route owners."""
from fastapi import APIRouter, HTTPException
from typing import Any

graph_settlement_router = APIRouter()
graph_read_router = APIRouter()

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
