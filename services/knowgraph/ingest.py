"""Extract immutable uploaded PDF pages for source-passage retrieval, not Knows."""
# Entity: KnowGraph
# Relationship: Verifies uploaded PDF identity and retains unmodified extracted pages through the existing document/vector owner, without automatic Entity, Know or relationship extraction.

from __future__ import annotations

import asyncio
import re
from pathlib import Path
from typing import Any

import document_store
from pdf_upload_storage import _file_sha256

_SHA256 = re.compile(r"^[0-9a-f]{64}$")


def _extract_pages(file_path: str) -> list[str]:
    from pypdf import PdfReader

    reader = PdfReader(file_path)
    if len(reader.pages) > document_store.MAX_PAGES:
        raise ValueError("document_text_limit")
    pages = []
    characters = 0
    for page in reader.pages:
        text = page.extract_text() or ""
        characters += len(text)
        if characters > document_store.MAX_DOCUMENT_CHARS:
            raise ValueError("document_text_limit")
        pages.append(text)
    return pages


async def ingest_pdf(file_path: str, project_id: str, document_id: str, *, source_name: str,
                     source_reference: str, source_content_sha256: str,
                     publication_date: str | None = None, source_url: str | None = None) -> dict[str, Any]:
    if not isinstance(source_content_sha256, str) or not _SHA256.fullmatch(source_content_sha256):
        raise ValueError("source_content_sha256_invalid")
    if not source_reference.startswith(f"knowgraph-upload://sha256/{source_content_sha256}/"):
        raise ValueError("source_reference_invalid")
    source = Path(file_path)
    if not source.is_file():
        raise FileNotFoundError("document_source_missing")
    digest, _size = await asyncio.to_thread(_file_sha256, source)
    if digest != source_content_sha256:
        raise ValueError("document_checksum_mismatch")
    pages = await asyncio.to_thread(_extract_pages, str(source))
    return await document_store.ingest_pages(
        project_id=project_id, document_id=document_id, pages=pages,
        source_name=source_name, source_reference=source_reference,
        source_checksum=source_content_sha256, publication_date=publication_date, source_url=source_url,
    )
