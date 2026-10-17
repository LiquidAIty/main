"""Route-level proof that PDF upload reaches the official Graphiti ingest path."""
# Entity: KnowGraph
# Relationship: Verifies content-addressed PDF storage, Project-scoped ingestion and episode deletion, provider version health, and stable secret-free route failures.

from __future__ import annotations

import tempfile
import unittest
import importlib.util
import sys
import asyncio
import hashlib
import io
import httpx
from pathlib import Path
from unittest.mock import AsyncMock, patch

SERVICE_DIR = Path(__file__).resolve().parent
if str(SERVICE_DIR) not in sys.path:
    sys.path.insert(0, str(SERVICE_DIR))
APP_SPEC = importlib.util.spec_from_file_location(
    "knowgraph_upload_app", SERVICE_DIR / "app.py"
)
if APP_SPEC is None or APP_SPEC.loader is None:
    raise RuntimeError("Unable to load services/knowgraph/app.py")
app = importlib.util.module_from_spec(APP_SPEC)
APP_SPEC.loader.exec_module(app)

import graphiti_runtime
import ingest as knowgraph_ingest
import pdf_upload_storage


async def _request(method: str, path: str, **kwargs: object) -> httpx.Response:
    transport = httpx.ASGITransport(app=app.app)
    async with httpx.AsyncClient(
        transport=transport,
        base_url="http://testserver",
    ) as client:
        return await client.request(method, path, **kwargs)


class KnowGraphUploadRouteTests(unittest.TestCase):
    def test_health_exposes_loaded_graphiti_versions(self) -> None:
        with patch.object(
            graphiti_runtime,
            "graphiti_runtime_versions",
            return_value={"graphiti_core": "0.30.2", "graphiti_mcp": None},
        ):
            response = asyncio.run(_request("GET", "/health"))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {
            "status": "ok",
            "versions": {"graphiti_core": "0.30.2", "graphiti_mcp": None},
        })

    def test_multipart_pdf_reaches_graphiti_ingest_with_project_authority(self) -> None:
        ingest_pdf = AsyncMock(
            return_value={
                "status": "ingested",
                "episode_id": "episode-1",
                "project_id": "project-1",
                "document_id": "pdf:document:1",
                "source_name": "source.pdf",
                "content_fingerprint": "sha256:proof",
                "provider": "openrouter",
                "model": "deepseek/deepseek-chat",
                "entity_count": 2,
                "fact_count": 1,
            }
        )
        with tempfile.TemporaryDirectory() as upload_dir:
            with (
                patch.object(app, "UPLOADS_DIR", Path(upload_dir)),
                patch.object(knowgraph_ingest, "ingest_pdf", ingest_pdf),
            ):
                response = asyncio.run(_request(
                    "POST",
                    "/ingest",
                    data={
                        "project_id": "project-1",
                        "document_id": "pdf:document:1",
                    },
                    files={
                        "file": (
                            "source.pdf",
                            b"%PDF-1.4 deterministic route proof",
                            "application/pdf",
                        )
                    },
                ))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(),
            {
                "ok": True,
                "status": "ingested",
                "episode_id": "episode-1",
                "project_id": "project-1",
                "document_id": "pdf:document:1",
                "source_name": "source.pdf",
                "content_fingerprint": "sha256:proof",
                "provider": "openrouter",
                "model": "deepseek/deepseek-chat",
                "entity_count": 2,
                "fact_count": 1,
            },
        )
        ingest_pdf.assert_awaited_once()
        args, kwargs = ingest_pdf.await_args
        content_sha256 = hashlib.sha256(
            b"%PDF-1.4 deterministic route proof"
        ).hexdigest()
        self.assertEqual(args[1:3], ("project-1", "pdf:document:1"))
        self.assertEqual(Path(args[0]).name, f"{content_sha256}.pdf")
        self.assertEqual(Path(args[0]).parent.name, content_sha256[:2])
        self.assertEqual(kwargs["source_name"], "source.pdf")
        self.assertEqual(
            kwargs["source_reference"],
            f"knowgraph-upload://sha256/{content_sha256}/source.pdf",
        )
        self.assertEqual(kwargs["source_content_sha256"], content_sha256)

    def test_ingest_failure_returns_only_a_stable_safe_error(self) -> None:
        with tempfile.TemporaryDirectory() as upload_dir:
            with (
                patch.object(app, "UPLOADS_DIR", Path(upload_dir)),
                patch.object(
                    knowgraph_ingest,
                    "ingest_pdf",
                    AsyncMock(side_effect=RuntimeError(
                        "provider failed at C:\\secret\\path token=do-not-return"
                    )),
                ),
            ):
                response = asyncio.run(_request(
                    "POST",
                    "/ingest",
                    data={"project_id": "project-1", "document_id": "document-1"},
                    files={"file": ("source.pdf", b"%PDF-1.4", "application/pdf")},
                ))

        self.assertEqual(response.status_code, 500)
        self.assertEqual(response.json(), {
            "ok": False,
            "error": {
                "code": "knowgraph_ingest_failed",
                "message": "KnowGraph ingest failed.",
            },
        })
        self.assertNotIn("secret", response.text.lower())
        self.assertNotIn("token", response.text.lower())

    def test_ingest_preserves_safe_rate_limit_classification(self) -> None:
        class RateLimitError(RuntimeError):
            pass

        with tempfile.TemporaryDirectory() as upload_dir:
            with (
                patch.object(app, "UPLOADS_DIR", Path(upload_dir)),
                patch.object(
                    knowgraph_ingest,
                    "ingest_pdf",
                    AsyncMock(side_effect=RateLimitError("private provider detail")),
                ),
            ):
                response = asyncio.run(_request(
                    "POST",
                    "/ingest",
                    data={"project_id": "project-1", "document_id": "document-1"},
                    files={"file": ("source.pdf", b"%PDF-1.4", "application/pdf")},
                ))

        self.assertEqual(response.status_code, 429)
        self.assertEqual(response.json()["error"], {
            "code": "knowgraph_provider_rate_limited",
            "message": "KnowGraph provider rate limit or quota exceeded.",
        })

    def test_pdf_storage_reuses_identical_bytes_without_overwriting(self) -> None:
        payload = b"%PDF-1.4 immutable content"
        digest = hashlib.sha256(payload).hexdigest()
        with tempfile.TemporaryDirectory() as upload_dir:
            directory = Path(upload_dir)
            first = pdf_upload_storage.store_pdf_upload(
                io.BytesIO(payload), "Research Source.pdf", directory
            )
            second = pdf_upload_storage.store_pdf_upload(
                io.BytesIO(payload), "Research Source.pdf", directory
            )

            self.assertFalse(first.reused)
            self.assertTrue(second.reused)
            self.assertEqual(first.path, second.path)
            self.assertEqual(first.path.read_bytes(), payload)
            self.assertEqual(first.path.name, f"{digest}.pdf")
            self.assertEqual(
                first.source_reference,
                f"knowgraph-upload://sha256/{digest}/Research_Source.pdf",
            )
            self.assertEqual(list(directory.glob(".upload-*.pdf")), [])

    def test_delete_episode_routes_one_project_scoped_know_to_graphiti(self) -> None:
        delete_episode = AsyncMock(
            return_value={"graphiti_episode_uuid": "episode-1"}
        )
        with patch.object(app, "_delete_graphiti_episode", delete_episode):
            response = asyncio.run(_request(
                "POST",
                "/delete_episode",
                json={
                    "project_id": "project-1",
                    "graphiti_episode_uuid": "episode-1",
                },
            ))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {
            "ok": True,
            "graphiti_episode_uuid": "episode-1",
        })
        payload = delete_episode.await_args.args[0]
        self.assertEqual(payload.project_id, "project-1")
        self.assertEqual(payload.graphiti_episode_uuid, "episode-1")

    def test_delete_conflict_does_not_return_internal_exception_detail(self) -> None:
        delete_episode = AsyncMock(
            side_effect=RuntimeError("neo4j secret at C:\\private\\database")
        )
        with patch.object(app, "_delete_graphiti_episode", delete_episode):
            response = asyncio.run(_request(
                "POST",
                "/delete_episode",
                json={
                    "project_id": "project-1",
                    "graphiti_episode_uuid": "episode-1",
                },
            ))

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json(), {
            "ok": False,
            "error": {
                "code": "knowgraph_delete_conflict",
                "message": "KnowGraph deletion could not be completed.",
            },
        })
        self.assertNotIn("secret", response.text.lower())

if __name__ == "__main__":
    unittest.main()
