# @graph entity: KnowGraph API
# @graph role: ingest-entrypoint
# @graph relates_to: KnowGraph Ingest, Magentic-One Runtime
# @graph depends_on: FastAPI
# @graph feeds_to: KnowGraph Ingest
"""FastAPI entrypoint for KnowGraph ingestion."""

from __future__ import annotations

import shutil
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, Query, Request, UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from ingest import ingest_pdf, ingest_web_documents, ingest_text_document
from analysis import (
    AnalysisRequest,
    ProviderComparisonRequest,
    SourceScope,
    analysis_evidence,
    analyze as analyze_scope,
    compare_providers,
    create_analysis_view,
    get_analysis,
    get_latest_analysis,
    get_latest_comparison,
    infranodus_capabilities,
    local_capabilities,
    source_preview,
    context_projection,
)

load_dotenv()

app = FastAPI(title="KnowGraph")
UPLOADS_DIR = Path(__file__).resolve().parent / "uploads"
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)


class WebResearchDocument(BaseModel):
    project_id: str
    document_id: str
    source_url: str
    title: str
    snippet: str | None = None
    summary: str | None = None
    fetched_at: str
    full_text: str | None = None
    text: str
    metadata: dict[str, Any] = Field(default_factory=dict)


class WebResearchIngestRequest(BaseModel):
    project_id: str
    documents: list[WebResearchDocument] = Field(default_factory=list)
    prompt_template: str | None = None
    organizing_principle: str | None = None
    entity_taxonomy: Any = None
    relationship_taxonomy: Any = None
    extraction_policy: Any = None
    research_focus: dict[str, Any] = Field(default_factory=dict)


class AnalysisViewRequest(BaseModel):
    analysis_id: str
    project_id: str
    producing_invocation: str
    parent_view_id: str | None = None


@app.get("/analysis/context-projection")
async def analysis_context_projection(project_id: str, refs: list[str] = Query(default=[]), limit: int = 120, conversation_id: str = "main", role: str = "main_chat"):
    return context_projection(project_id, refs, limit, conversation_id=conversation_id, receiving_role=role)


def _model_dump(model: BaseModel) -> dict[str, Any]:
    if hasattr(model, "model_dump"):
        return getattr(model, "model_dump")()
    return model.dict()


def _sanitize_filename(name: str) -> str:
    safe = "".join(ch if ch.isalnum() or ch in ("-", "_", ".") else "_" for ch in name)
    return safe or "upload.pdf"


@app.post("/ingest")
async def ingest(
    request: Request,
    project_id: str = Form(...),
    document_id: str = Form(...),
    file: UploadFile = File(...),
    organizing_principle: str | None = Form(None),
    entity_taxonomy_json: str | None = Form(None),
    relationship_taxonomy_json: str | None = Form(None),
    extraction_policy_json: str | None = Form(None),
) -> JSONResponse:
    saved_path: Path | None = None
    try:
        filename = _sanitize_filename(file.filename or "upload.pdf")
        saved_path = UPLOADS_DIR / f"{document_id}_{filename}"
        with saved_path.open("wb") as out:
            shutil.copyfileobj(file.file, out)

        agent_id = (request.headers.get("x-agent-id") or "").strip() or None
        agent_provider = (request.headers.get("x-agent-provider") or "").strip() or None
        agent_model_key = (request.headers.get("x-agent-model-key") or "").strip() or None
        agent_model_id = (request.headers.get("x-agent-model-id") or "").strip() or None

        await ingest_pdf(
            str(saved_path),
            project_id,
            document_id,
            provider=agent_provider,
            model_key=agent_model_key,
            model_id=agent_model_id,
            agent_id=agent_id,
            organizing_principle=organizing_principle,
            entity_taxonomy_json=entity_taxonomy_json,
            relationship_taxonomy_json=relationship_taxonomy_json,
            extraction_policy_json=extraction_policy_json,
        )
        return JSONResponse(
            status_code=200,
            content={
                "ok": True,
                "project_id": project_id,
                "document_id": document_id,
                "provider": agent_provider,
                "model": agent_model_id or agent_model_key,
            },
        )
    except Exception as exc:
        return JSONResponse(
            status_code=500,
            content={
                "ok": False,
                "error": {
                    "message": str(exc),
                },
            },
        )
    finally:
        await file.close()


@app.post("/ingest_web_results")
async def ingest_web_results(
    request: Request,
    payload: WebResearchIngestRequest,
) -> JSONResponse:
    try:
        agent_id = (request.headers.get("x-agent-id") or "").strip() or None
        agent_provider = (request.headers.get("x-agent-provider") or "").strip() or None
        agent_model_key = (request.headers.get("x-agent-model-key") or "").strip() or None
        agent_model_id = (request.headers.get("x-agent-model-id") or "").strip() or None

        result = await ingest_web_documents(
            project_id=payload.project_id,
            documents=[_model_dump(doc) for doc in payload.documents],
            provider=agent_provider,
            model_key=agent_model_key,
            model_id=agent_model_id,
            agent_id=agent_id,
            prompt_template=payload.prompt_template,
            organizing_principle=payload.organizing_principle,
            entity_taxonomy=payload.entity_taxonomy,
            relationship_taxonomy=payload.relationship_taxonomy,
            extraction_policy=payload.extraction_policy,
            research_focus=payload.research_focus,
        )
        return JSONResponse(status_code=200, content={"ok": True, **result})
    except Exception as exc:
        return JSONResponse(
            status_code=500,
            content={
                "ok": False,
                "error": {
                    "message": str(exc),
                },
            },
        )


@app.post("/ingest_code")
async def ingest_code(
    request: Request,
    project_id: str = Form(...),
    document_id: str = Form(...),
    code_text: str = Form(...),
    file_path: str | None = Form(None),
    language: str | None = Form(None),
    organizing_principle: str | None = Form(None),
    entity_taxonomy_json: str | None = Form(None),
    relationship_taxonomy_json: str | None = Form(None),
    extraction_policy_json: str | None = Form(None),
) -> JSONResponse:
    try:
        agent_id = (request.headers.get("x-agent-id") or "").strip() or None
        agent_provider = (request.headers.get("x-agent-provider") or "").strip() or None
        agent_model_key = (request.headers.get("x-agent-model-key") or "").strip() or None
        agent_model_id = (request.headers.get("x-agent-model-id") or "").strip() or None

        result = await ingest_text_document(
            project_id=project_id,
            document_id=document_id,
            text=code_text,
            title=file_path or f"{document_id}.{language or 'code'}",
            source_url=f"file://{file_path}" if file_path else None,
            metadata={"language": language, "file_path": file_path},
            source_type="code_file",
            provider=agent_provider,
            model_key=agent_model_key,
            model_id=agent_model_id,
            agent_id=agent_id,
            organizing_principle=organizing_principle,
            entity_taxonomy=entity_taxonomy_json,
            relationship_taxonomy=relationship_taxonomy_json,
            extraction_policy=extraction_policy_json,
        )
        return JSONResponse(status_code=200, content={"ok": True, **result})
    except Exception as exc:
        return JSONResponse(
            status_code=500,
            content={
                "ok": False,
                "error": {
                    "message": str(exc),
                },
            },
        )


@app.get("/analysis/capabilities")
async def analysis_capabilities() -> JSONResponse:
    try:
        return JSONResponse(
            status_code=200,
            content={
                "ok": True,
                "providers": [
                    local_capabilities().model_dump(),
                    (await infranodus_capabilities()).model_dump(),
                ],
            },
        )
    except Exception as exc:
        return JSONResponse(status_code=502, content={"ok": False, "error": {"message": str(exc)}})


@app.get("/analysis/source-preview")
async def analysis_source_preview(
    project_id: str,
    document_id: list[str] = Query(default=[]),
    chunk_id: list[str] = Query(default=[]),
) -> JSONResponse:
    try:
        preview = source_preview(
            SourceScope(project_id=project_id, document_ids=document_id, chunk_ids=chunk_id)
        )
        return JSONResponse(status_code=200, content={"ok": True, **preview})
    except Exception as exc:
        return JSONResponse(status_code=500, content={"ok": False, "error": {"message": str(exc)}})


@app.post("/analysis/analyze")
async def run_analysis(payload: AnalysisRequest) -> JSONResponse:
    try:
        result = await analyze_scope(payload)
        return JSONResponse(status_code=200, content={"ok": True, "analysis": result.model_dump()})
    except (ValueError, PermissionError) as exc:
        return JSONResponse(status_code=400, content={"ok": False, "error": {"message": str(exc)}})
    except Exception as exc:
        return JSONResponse(status_code=502, content={"ok": False, "error": {"message": str(exc)}})


@app.post("/analysis/compare")
async def run_provider_comparison(payload: ProviderComparisonRequest) -> JSONResponse:
    try:
        result = await compare_providers(payload)
        return JSONResponse(status_code=200, content={"ok": True, **result})
    except (ValueError, PermissionError) as exc:
        return JSONResponse(status_code=400, content={"ok": False, "error": {"message": str(exc)}})
    except Exception as exc:
        return JSONResponse(status_code=502, content={"ok": False, "error": {"message": str(exc)}})


@app.get("/analysis/latest")
async def latest_analysis(project_id: str, provider: str = "local_cleanroom") -> JSONResponse:
    try:
        result = get_latest_analysis(project_id, provider)
        if result is None:
            return JSONResponse(status_code=404, content={"ok": False, "error": {"message": "analysis not found"}})
        return JSONResponse(status_code=200, content={"ok": True, "analysis": result.model_dump()})
    except Exception as exc:
        return JSONResponse(status_code=500, content={"ok": False, "error": {"message": str(exc)}})


@app.get("/analysis/comparison/latest")
async def latest_provider_comparison(project_id: str) -> JSONResponse:
    try:
        comparison = get_latest_comparison(project_id)
        if comparison is None:
            return JSONResponse(status_code=404, content={"ok": False, "error": {"message": "comparison not found"}})
        return JSONResponse(status_code=200, content={"ok": True, "comparison": comparison})
    except Exception as exc:
        return JSONResponse(status_code=500, content={"ok": False, "error": {"message": str(exc)}})


@app.get("/analysis/{analysis_id}/evidence/{topic_id}")
async def get_topic_evidence(analysis_id: str, topic_id: str) -> JSONResponse:
    try:
        return JSONResponse(status_code=200, content={"ok": True, **analysis_evidence(analysis_id, topic_id)})
    except LookupError as exc:
        return JSONResponse(status_code=404, content={"ok": False, "error": {"message": str(exc)}})
    except Exception as exc:
        return JSONResponse(status_code=500, content={"ok": False, "error": {"message": str(exc)}})


@app.get("/analysis/{analysis_id}/topics")
async def get_analysis_topics(analysis_id: str) -> JSONResponse:
    try:
        result = get_analysis(analysis_id)
        if result is None:
            return JSONResponse(status_code=404, content={"ok": False, "error": {"message": "analysis not found"}})
        return JSONResponse(
            status_code=200,
            content={
                "ok": True,
                "analysis_id": analysis_id,
                "main_concepts": result.main_concepts,
                "communities": [community.model_dump() for community in result.communities],
            },
        )
    except Exception as exc:
        return JSONResponse(status_code=500, content={"ok": False, "error": {"message": str(exc)}})


@app.get("/analysis/{analysis_id}/gateways")
async def get_analysis_gateways(analysis_id: str) -> JSONResponse:
    try:
        result = get_analysis(analysis_id)
        if result is None:
            return JSONResponse(status_code=404, content={"ok": False, "error": {"message": "analysis not found"}})
        gateway_labels = set(result.conceptual_gateways)
        nodes = [node.model_dump() for node in result.nodes if node.label in gateway_labels]
        return JSONResponse(
            status_code=200,
            content={"ok": True, "analysis_id": analysis_id, "conceptual_gateways": nodes},
        )
    except Exception as exc:
        return JSONResponse(status_code=500, content={"ok": False, "error": {"message": str(exc)}})


@app.get("/analysis/{analysis_id}/gaps")
async def get_analysis_gaps(analysis_id: str) -> JSONResponse:
    try:
        result = get_analysis(analysis_id)
        if result is None:
            return JSONResponse(status_code=404, content={"ok": False, "error": {"message": "analysis not found"}})
        return JSONResponse(
            status_code=200,
            content={
                "ok": True,
                "analysis_id": analysis_id,
                "content_gap_candidates": [gap.model_dump() for gap in result.content_gap_candidates],
            },
        )
    except Exception as exc:
        return JSONResponse(status_code=500, content={"ok": False, "error": {"message": str(exc)}})


@app.get("/analysis/{analysis_id}")
async def read_analysis(analysis_id: str) -> JSONResponse:
    try:
        result = get_analysis(analysis_id)
        if result is None:
            return JSONResponse(status_code=404, content={"ok": False, "error": {"message": "analysis not found"}})
        return JSONResponse(status_code=200, content={"ok": True, "analysis": result.model_dump()})
    except Exception as exc:
        return JSONResponse(status_code=500, content={"ok": False, "error": {"message": str(exc)}})


@app.post("/analysis-view")
async def create_view(payload: AnalysisViewRequest) -> JSONResponse:
    try:
        view = create_analysis_view(
            analysis_id=payload.analysis_id,
            project_id=payload.project_id,
            producing_invocation=payload.producing_invocation,
            parent_view_id=payload.parent_view_id,
        )
        return JSONResponse(status_code=200, content={"ok": True, "view": view})
    except LookupError as exc:
        return JSONResponse(status_code=404, content={"ok": False, "error": {"message": str(exc)}})
    except Exception as exc:
        return JSONResponse(status_code=500, content={"ok": False, "error": {"message": str(exc)}})


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
