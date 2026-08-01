"""Route-level proof that PDF upload reaches the official Graphiti ingest path."""

from __future__ import annotations

import tempfile
import unittest
import importlib.util
import sys
from pathlib import Path
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
                        "x-agent-id": "hermes",
                        "x-agent-provider": "openrouter",
                        "x-agent-model-key": "deepseek",
                        "x-agent-model-id": "deepseek/deepseek-chat",
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
        self.assertEqual(kwargs["provider"], "openrouter")
        self.assertEqual(kwargs["model_key"], "deepseek")
        self.assertEqual(kwargs["model_id"], "deepseek/deepseek-chat")
        self.assertEqual(kwargs["agent_id"], "hermes")
        self.assertEqual(kwargs["source_name"], "source.pdf")
        self.assertEqual(
            kwargs["prompt_template"], "Extract only source-backed claims."
        )
        self.assertEqual(
            kwargs["organizing_principle"], "Preserve source provenance."
        )


if __name__ == "__main__":
    unittest.main()
