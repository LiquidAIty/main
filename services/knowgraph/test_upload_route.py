"""Route-level proof that PDF upload reaches the official Graphiti ingest path."""

from __future__ import annotations

import tempfile
import unittest
import importlib.util
import sys
import asyncio
import httpx
from pathlib import Path
from unittest.mock import AsyncMock, patch

from graphiti_core.errors import NodeNotFoundError

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
            app,
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
                patch.object(app, "ingest_pdf", ingest_pdf),
            ):
                response = asyncio.run(_request(
                    "POST",
                    "/ingest",
                    data={
                        "project_id": "project-1",
                        "document_id": "pdf:document:1",
                        "prompt_template": "Extract only source-backed claims.",
                        "organizing_principle": "Preserve source provenance.",
                    },
                    files={
                        "file": (
                            "source.pdf",
                            b"%PDF-1.4 deterministic route proof",
                            "application/pdf",
                        )
                    },
                    headers={
                        "x-agent-id": "retired-card",
                        "x-agent-provider": "openai",
                        "x-agent-model-key": "retired-model",
                        "x-agent-model-id": "retired/model",
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
        self.assertEqual(args[1:3], ("project-1", "pdf:document:1"))
        self.assertEqual(Path(args[0]).name, "pdf_document_1_source.pdf")
        self.assertNotIn("provider", kwargs)
        self.assertNotIn("model_key", kwargs)
        self.assertNotIn("model_id", kwargs)
        self.assertNotIn("agent_id", kwargs)
        self.assertEqual(kwargs["source_name"], "source.pdf")
        self.assertEqual(
            kwargs["prompt_template"], "Extract only source-backed claims."
        )
        self.assertEqual(
            kwargs["organizing_principle"], "Preserve source provenance."
        )

    def test_delete_native_routes_one_project_scoped_episode_to_graphiti(self) -> None:
        delete_native = AsyncMock(
            return_value={"kind": "episode", "native_id": "episode-1"}
        )
        with (
            patch.object(app, "_delete_native_know", delete_native),
        ):
            response = asyncio.run(_request(
                "POST",
                "/delete_native",
                json={
                    "project_id": "project-1",
                    "native_id": "episode-1",
                    "kind": "episode",
                },
            ))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {
            "ok": True,
            "kind": "episode",
            "native_id": "episode-1",
        })
        delete_native.assert_awaited_once()
        payload = delete_native.await_args.args[0]
        self.assertEqual(payload.project_id, "project-1")
        self.assertEqual(payload.native_id, "episode-1")
        self.assertEqual(payload.kind, "episode")

    def test_delete_native_returns_not_found_for_unknown_episode(self) -> None:
        delete_native = AsyncMock(side_effect=NodeNotFoundError("missing-episode"))
        with (
            patch.object(app, "_delete_native_know", delete_native),
        ):
            response = asyncio.run(_request(
                "POST",
                "/delete_native",
                json={
                    "project_id": "project-1",
                    "native_id": "missing-episode",
                    "kind": "episode",
                },
            ))

        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json(), {
            "ok": False,
            "error": {"message": "KnowGraph item not found."},
        })

    def test_delete_native_delegates_exact_episode_to_native_owner(self) -> None:
        delete_episode = AsyncMock(return_value={
            "kind": "episode", "native_id": "episode-1", "provider": "openai",
        })
        with patch.object(app, "delete_canonical_know", delete_episode):
            result = asyncio.run(app._delete_native_know(app.NativeKnowDeleteRequest(
                project_id="project-1",
                native_id="episode-1",
                kind="episode",
            )))

        self.assertEqual(result["native_id"], "episode-1")
        delete_episode.assert_awaited_once_with("project-1", "episode-1")

    def test_delete_native_rejects_fact_kind_without_calling_episode_owner(self) -> None:
        delete_episode = AsyncMock()
        with patch.object(app, "delete_canonical_know", delete_episode):
            with self.assertRaisesRegex(ValueError, "knowgraph_delete_kind_invalid"):
                asyncio.run(app._delete_native_know(app.NativeKnowDeleteRequest(
                    project_id="project-1",
                    native_id="fact-1",
                    kind="fact",
                )))
        delete_episode.assert_not_awaited()


if __name__ == "__main__":
    unittest.main()
