"""FastAPI entrypoint for KnowGraph ingestion."""

from __future__ import annotations

import shutil
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, UploadFile
from fastapi.responses import JSONResponse

from ingest import ingest_pdf

load_dotenv()

app = FastAPI(title="KnowGraph")
UPLOADS_DIR = Path(__file__).resolve().parent / "uploads"
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)


def _sanitize_filename(name: str) -> str:
    safe = "".join(ch if ch.isalnum() or ch in ("-", "_", ".") else "_" for ch in name)
    return safe or "upload.pdf"


@app.post("/ingest")
async def ingest(
    project_id: str = Form(...),
    document_id: str = Form(...),
    file: UploadFile = File(...),
) -> JSONResponse:
    saved_path: Path | None = None
    try:
        filename = _sanitize_filename(file.filename or "upload.pdf")
        saved_path = UPLOADS_DIR / f"{document_id}_{filename}"
        with saved_path.open("wb") as out:
            shutil.copyfileobj(file.file, out)

        await ingest_pdf(str(saved_path), project_id, document_id)
        return JSONResponse(
            status_code=200,
            content={
                "ok": True,
                "project_id": project_id,
                "document_id": document_id,
            },
        )
    except Exception as exc:
        return JSONResponse(
            status_code=500,
            content={"ok": False, "error": {"message": str(exc)}},
        )
    finally:
        await file.close()


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
