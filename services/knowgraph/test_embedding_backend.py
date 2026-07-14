"""Blocker repair: inspection mode must force LOCAL embeddings, never paid OpenAI.

Run: services/knowgraph/.venv/Scripts/python.exe -m unittest test_embedding_backend -v
"""

from __future__ import annotations

import os
import unittest

from dotenv import load_dotenv
load_dotenv()

from ingest import RuntimeModelConfig, _apply_inspection_embedding_override
import inspection_extraction_provider as prov


def _openai_cfg() -> RuntimeModelConfig:
    return RuntimeModelConfig(
        provider="openai", model_key=None, model_id="gpt-4o-mini",
        llm_client_kwargs={"api_key": "x"}, embedding_backend="openai_compatible",
        embedding_model="text-embedding-3-large", embedding_dimensions=3072,
        embedding_client_kwargs={"api_key": "x"},
    )


class EmbeddingOverrideTest(unittest.TestCase):
    def setUp(self) -> None:
        self._prev = os.environ.get(prov.INSPECTION_MODE_ENV)

    def tearDown(self) -> None:
        if self._prev is None:
            os.environ.pop(prov.INSPECTION_MODE_ENV, None)
        else:
            os.environ[prov.INSPECTION_MODE_ENV] = self._prev

    def test_inspection_mode_forces_local_embeddings(self) -> None:
        os.environ[prov.INSPECTION_MODE_ENV] = "1"
        c = _apply_inspection_embedding_override(_openai_cfg())
        self.assertEqual(c.embedding_backend, "sentence_transformers")
        self.assertEqual(c.embedding_dimensions, 384)
        self.assertEqual(c.embedding_client_kwargs, {})
        self.assertNotIn("text-embedding", c.embedding_model)  # not an OpenAI embed model

    def test_product_mode_unchanged(self) -> None:
        os.environ[prov.INSPECTION_MODE_ENV] = "0"
        c = _apply_inspection_embedding_override(_openai_cfg())
        self.assertEqual(c.embedding_backend, "openai_compatible")
        self.assertEqual(c.embedding_dimensions, 3072)
        self.assertEqual(c.embedding_client_kwargs, {"api_key": "x"})


if __name__ == "__main__":
    unittest.main()
