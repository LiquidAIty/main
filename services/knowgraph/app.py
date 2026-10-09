# @graph entity: KnowGraph API
# @graph role: ingest-entrypoint
# @graph relates_to: KnowGraph Ingest, Graphiti
# @graph depends_on: FastAPI
# @graph feeds_to: KnowGraph Ingest
"""FastAPI entrypoint for KnowGraph ingestion."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, Form, UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from graphiti_core.errors import EdgeNotFoundError, NodeNotFoundError

import graphiti_runtime
import ingest as knowgraph_ingest
from graphiti_identity import graphiti_project_group_id
import pdf_upload_storage

app = FastAPI(title="KnowGraph")
UPLOADS_DIR = Path(__file__).resolve().parent / "uploads"
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)


class GraphitiFactDeleteRequest(BaseModel):
    project_id: str
    graphiti_fact_uuid: str
    kind: str = "fact"


async def _delete_graphiti_fact(
    payload: GraphitiFactDeleteRequest,
) -> dict[str, str]:
    from graphiti_core.edges import EntityEdge

    if payload.kind != "fact":
        raise ValueError("knowgraph_delete_kind_invalid")
    expected_group = graphiti_project_group_id(payload.project_id)
    driver, _database = graphiti_runtime.create_graphiti_driver()
    try:
        record = await EntityEdge.get_by_uuid(driver, payload.graphiti_fact_uuid)
        if record.group_id != expected_group:
            raise LookupError("knowgraph_graphiti_fact_not_found")
        await record.delete(driver)
        return {"kind": payload.kind, "graphiti_fact_uuid": payload.graphiti_fact_uuid}
    finally:
        await driver.close()


@app.post("/delete_fact")
async def delete_fact(payload: GraphitiFactDeleteRequest) -> JSONResponse:
    try:
        result = await _delete_graphiti_fact(payload)
        return JSONResponse(status_code=200, content={"ok": True, **result})
    except (LookupError, EdgeNotFoundError, NodeNotFoundError):
        return JSONResponse(
            status_code=404,
            content={"ok": False, "error": {"message": "KnowGraph item not found."}},
        )
    except (RuntimeError, ValueError, KeyError) as exc:
        return JSONResponse(
            status_code=409,
            content={"ok": False, "error": {"message": str(exc)}},
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


@app.get("/health")
async def health() -> dict[str, Any]:
    return {"status": "ok", "versions": graphiti_runtime.graphiti_runtime_versions()}
