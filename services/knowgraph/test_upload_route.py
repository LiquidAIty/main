"""Route-level proof that PDF upload reaches the official Graphiti ingest path."""

from __future__ import annotations

import tempfile
import unittest
import importlib.util
import sys
import asyncio
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

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


class KnowGraphUploadRouteTests(unittest.TestCase):
    def test_health_exposes_loaded_graphiti_versions(self) -> None:
        with patch.object(
            app,
            "graphiti_runtime_versions",
            return_value={"graphiti_core": "0.30.2", "graphiti_mcp": None},
        ):
            response = TestClient(app.app).get("/health")
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
                TestClient(app.app) as client,
            ):
                response = client.post(
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
                )

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

    def test_delete_native_routes_one_project_scoped_fact_to_graphiti(self) -> None:
        delete_native = AsyncMock(
            return_value={"kind": "fact", "native_id": "fact-1"}
        )
        with (
            patch.object(app, "_delete_native_know", delete_native),
            TestClient(app.app) as client,
        ):
            response = client.post(
                "/delete_native",
                json={
                    "project_id": "project-1",
                    "native_id": "fact-1",
                    "kind": "fact",
                },
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {
            "ok": True,
            "kind": "fact",
            "native_id": "fact-1",
        })
        delete_native.assert_awaited_once()
        payload = delete_native.await_args.args[0]
        self.assertEqual(payload.project_id, "project-1")
        self.assertEqual(payload.native_id, "fact-1")
        self.assertEqual(payload.kind, "fact")

    def test_delete_native_removes_only_a_fact_in_the_requested_project(self) -> None:
        edge = SimpleNamespace(
            group_id="liquidaity-project-1",
            delete=AsyncMock(),
        )
        graphiti = SimpleNamespace(driver=object(), close=AsyncMock())
        with (
            patch.object(
                app,
                "_create_graphiti_runtime",
                return_value=(object(), graphiti, "neo4j"),
            ),
            patch(
                "graphiti_core.edges.EntityEdge.get_by_uuid",
                new=AsyncMock(return_value=edge),
            ),
        ):
            result = asyncio.run(app._delete_native_know(
                app.NativeKnowDeleteRequest(
                    project_id="project-1",
                    native_id="fact-1",
                    kind="fact",
                ),
                provider=None,
                model_key=None,
                model_id=None,
            ))

        self.assertEqual(result, {"kind": "fact", "native_id": "fact-1"})
        edge.delete.assert_awaited_once_with(graphiti.driver)
        graphiti.close.assert_awaited_once()


if __name__ == "__main__":
    unittest.main()
