"""Immutable content-addressed storage for uploaded KnowGraph PDFs."""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import os
from pathlib import Path
import tempfile
from typing import BinaryIO
from urllib.parse import quote

_CHUNK_BYTES = 1024 * 1024


@dataclass(frozen=True)
class StoredPdfUpload:
    path: Path
    source_name: str
    source_reference: str
    content_sha256: str
    byte_size: int
    reused: bool


def sanitize_pdf_filename(name: str) -> str:
    safe = "".join(
        character if character.isalnum() or character in {"-", "_", "."} else "_"
        for character in str(name or "")
    ).strip(".")
    filename = safe or "upload.pdf"
    if not filename.lower().endswith(".pdf"):
        raise ValueError("knowgraph_upload_pdf_required")
    return filename


def _file_sha256(path: Path) -> tuple[str, int]:
    digest = hashlib.sha256()
    size = 0
    with path.open("rb") as source:
        while chunk := source.read(_CHUNK_BYTES):
            digest.update(chunk)
            size += len(chunk)
    return digest.hexdigest(), size


def store_pdf_upload(
    stream: BinaryIO,
    original_name: str,
    uploads_directory: Path,
) -> StoredPdfUpload:
    """Stream one PDF into immutable storage and reuse identical bytes."""

    source_name = sanitize_pdf_filename(original_name)
    uploads_directory.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256()
    byte_size = 0
    staging_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="wb",
            prefix=".upload-",
            suffix=".pdf",
            dir=uploads_directory,
            delete=False,
        ) as staging:
            staging_path = Path(staging.name)
            while chunk := stream.read(_CHUNK_BYTES):
                digest.update(chunk)
                byte_size += len(chunk)
                staging.write(chunk)
            staging.flush()
            os.fsync(staging.fileno())
        if byte_size == 0:
            raise ValueError("knowgraph_upload_empty")

        content_sha256 = digest.hexdigest()
        content_directory = uploads_directory / content_sha256[:2]
        content_directory.mkdir(parents=True, exist_ok=True)
        destination = content_directory / f"{content_sha256}.pdf"
        try:
            os.link(staging_path, destination)
            reused = False
            staging_path.unlink()
            staging_path = None
        except FileExistsError:
            reused = True
            existing_sha256, existing_size = _file_sha256(destination)
            if existing_sha256 != content_sha256 or existing_size != byte_size:
                raise RuntimeError("knowgraph_upload_content_address_conflict")
            staging_path.unlink()
            staging_path = None

        return StoredPdfUpload(
            path=destination,
            source_name=source_name,
            source_reference=(
                f"knowgraph-upload://sha256/{content_sha256}/{quote(source_name)}"
            ),
            content_sha256=content_sha256,
            byte_size=byte_size,
            reused=reused,
        )
    finally:
        if staging_path is not None:
            staging_path.unlink(missing_ok=True)
