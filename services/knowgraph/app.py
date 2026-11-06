"""FastAPI entrypoint for KnowGraph ingestion."""
# Graph + less = more: less code that does the same work as more code is more useful.
# Entity names the feature; Relationship explains why this file belongs and what it contributes.
# Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
# Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
# Entity: KnowGraph
# Relationship: This file exposes bounded PDF ingestion, Project-scoped episode deletion, process-authenticated research settlement, provider-safe ingestion errors, and runtime health.
# Entity: Jev Decisions
# Relationship: This file loads one persisted Know and its actual Graphiti facts, then supplies web evidence and Project vocabulary to the existing Jev settlement owner.

from __future__ import annotations

import logging
import hmac
import os
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, Form, UploadFile, Request, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from graphiti_core.errors import NodeNotFoundError
from graphiti_core.helpers import parse_db_date

import graphiti_runtime
import ingest as knowgraph_ingest
from graphiti_identity import graphiti_project_group_id
import pdf_upload_storage

app = FastAPI(title="KnowGraph")
logger = logging.getLogger(__name__)
UPLOADS_DIR = Path(__file__).resolve().parent / "uploads"
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)


class GraphitiEpisodeDeleteRequest(BaseModel):
    project_id: str
    graphiti_episode_uuid: str


class ResearchSettlementRequest(BaseModel):
    project_id: str
    know_uuid: str


@app.post("/research/settle")
async def settle_research(payload: ResearchSettlementRequest, request: Request):
    secret = os.environ.get("LIQUIDAITY_INTERNAL_MCP_SECRET", "")
    if len(secret) < 32 or not hmac.compare_digest(secret, request.headers.get("X-LiquidAIty-Internal-MCP-Secret", "")):
        raise HTTPException(403, "internal_process_authorization_required")
    import jev_fact_settlement
    _runtime, graphiti, _database = graphiti_runtime.create_graphiti_runtime()
    try:
        # Settlement reads the stored Know, not a newer Graphiti client method.
        result = await graphiti.driver.execute_query(
            "MATCH (k:Episodic:Know {uuid:$uuid,group_id:$group}) "
            "RETURN k.content AS content,k.valid_at AS valid_at,k.citation_title AS title,"
            "coalesce(k.citation_resolved_url,k.citation_url) AS source_url",
            uuid=payload.know_uuid, group=graphiti_project_group_id(payload.project_id), routing_="r")
        rows = graphiti_runtime.graphiti_records(result)
        if len(rows) != 1:
            raise HTTPException(404, "research_know_not_found")
        know = rows[0]
        edges, nodes = await jev_fact_settlement.read_episode_facts(graphiti, episode_id=payload.know_uuid)
        return await jev_fact_settlement.classify_episode_facts_with_jev(
            graphiti, project_id=payload.project_id, edges=edges, nodes=nodes, episode_id=payload.know_uuid,
            source_name=know["title"], source_reference=know["source_url"],
            text=know["content"], reference_time=parse_db_date(know["valid_at"]), source_type="web_research",
            relationship_vocabulary=await jev_fact_settlement.read_project_relationship_vocabulary(payload.project_id))
    finally:
        await graphiti.driver.close()


def _ingest_error(error: Exception) -> tuple[int, str, str]:
    error_type = error.__class__.__name__.lower()
    error_text = str(error).lower()
    if "ratelimit" in error_type or any(
        marker in error_text
        for marker in ("rate limit", "insufficient_quota", "quota exceeded")
    ):
        return 429, "knowgraph_provider_rate_limited", (
            "KnowGraph provider rate limit or quota exceeded."
        )
    if isinstance(error, ValueError) and error_text in {
        "knowgraph_upload_pdf_required",
        "knowgraph_upload_empty",
    }:
        return 400, error_text, "KnowGraph requires one non-empty PDF."
    if error_text == "knowgraph_upload_content_address_conflict":
        return 409, error_text, "KnowGraph upload storage conflict."
    return 500, "knowgraph_ingest_failed", "KnowGraph ingest failed."


async def _delete_graphiti_episode(
    payload: GraphitiEpisodeDeleteRequest,
) -> dict[str, str]:
    from graphiti_core.nodes import EpisodicNode

    expected_group = graphiti_project_group_id(payload.project_id)
    _runtime, graphiti, _database = graphiti_runtime.create_graphiti_runtime()
    try:
        episode = await EpisodicNode.get_by_uuid(
            graphiti.driver, payload.graphiti_episode_uuid
        )
        if episode.group_id != expected_group:
            raise LookupError("knowgraph_graphiti_episode_not_found")
        await graphiti.remove_episode(payload.graphiti_episode_uuid)
        return {"graphiti_episode_uuid": payload.graphiti_episode_uuid}
    finally:
        await graphiti.driver.close()


@app.post("/delete_episode")
async def delete_episode(payload: GraphitiEpisodeDeleteRequest) -> JSONResponse:
    try:
        result = await _delete_graphiti_episode(payload)
        return JSONResponse(status_code=200, content={"ok": True, **result})
    except (LookupError, NodeNotFoundError):
        return JSONResponse(
            status_code=404,
            content={"ok": False, "error": {"message": "KnowGraph item not found."}},
        )
    except (RuntimeError, ValueError, KeyError) as exc:
        logger.warning(
            "knowgraph_delete_failed error_type=%s",
            exc.__class__.__name__,
        )
        return JSONResponse(
            status_code=409,
            content={"ok": False, "error": {
                "code": "knowgraph_delete_conflict",
                "message": "KnowGraph deletion could not be completed.",
            }},
        )


@app.post("/ingest")
async def ingest(
    project_id: str = Form(...),
    document_id: str = Form(...),
    file: UploadFile = File(...),
) -> JSONResponse:
    try:
        stored = pdf_upload_storage.store_pdf_upload(
            file.file,
            file.filename or "upload.pdf",
            UPLOADS_DIR,
        )
        result = await knowgraph_ingest.ingest_pdf(
            str(stored.path),
            project_id,
            document_id,
            source_name=stored.source_name,
            source_reference=stored.source_reference,
            source_content_sha256=stored.content_sha256,
        )
        return JSONResponse(
            status_code=200,
            content={
                "ok": True,
                **result,
            },
        )
    except Exception as exc:
        status, code, message = _ingest_error(exc)
        logger.warning(
            "knowgraph_ingest_failed code=%s error_type=%s",
            code,
            exc.__class__.__name__,
        )
        return JSONResponse(
            status_code=status,
            content={
                "ok": False,
                "error": {
                    "code": code,
                    "message": message,
                },
            },
        )
    finally:
        await file.close()


@app.get("/health")
async def health() -> dict[str, Any]:
    return {"status": "ok", "versions": graphiti_runtime.graphiti_runtime_versions()}
