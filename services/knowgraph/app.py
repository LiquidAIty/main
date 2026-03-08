"""FastAPI entrypoint for KnowGraph ingestion."""

from __future__ import annotations

import shutil
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, Request, UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from ingest import ingest_pdf, ingest_web_documents

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


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
