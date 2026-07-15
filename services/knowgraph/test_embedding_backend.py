"""OpenRouter is the single KnowGraph embedding backend; no local substitution."""

from __future__ import annotations

import os
import unittest
from unittest import mock

from ingest import _resolve_runtime_model_config


class EmbeddingBackendTest(unittest.TestCase):
    def test_openrouter_routes_llm_and_embeddings_to_same_compatible_api(self):
        env = {
            "OPENROUTER_API_KEY": "test-key",
            "OPENROUTER_OPENAI_BASE_URL": "https://openrouter.ai/api/v1",
            "KNOWGRAPH_LLM_MODEL": "openai/gpt-4o-mini",
            "KNOWGRAPH_OPENROUTER_EMBEDDING_BACKEND": "openai_compatible",
            "KNOWGRAPH_OPENROUTER_EMBEDDING_MODEL": "openai/text-embedding-3-large",
            "KNOWGRAPH_OPENROUTER_EMBEDDING_DIM": "3072",
        }
        with mock.patch.dict(os.environ, env, clear=False):
            config = _resolve_runtime_model_config(provider="openrouter", model_key=None, model_id=None)
        self.assertEqual(config.model_id, "openai/gpt-4o-mini")
        self.assertEqual(config.embedding_backend, "openai_compatible")
        self.assertEqual(config.embedding_model, "openai/text-embedding-3-large")
        self.assertEqual(config.embedding_dimensions, 3072)
        self.assertEqual(config.embedding_client_kwargs["base_url"], "https://openrouter.ai/api/v1")
        self.assertEqual(config.embedding_client_kwargs["max_retries"], 2)
        self.assertEqual(config.embedding_client_kwargs["timeout"], 30.0)

    def test_local_embedding_backend_fails_closed(self):
        with mock.patch.dict(
            os.environ,
            {
                "OPENROUTER_API_KEY": "test-key",
                "KNOWGRAPH_OPENROUTER_EMBEDDING_BACKEND": "sentence_transformers",
            },
            clear=False,
        ):
            with self.assertRaisesRegex(RuntimeError, "Unsupported embedding backend"):
                _resolve_runtime_model_config(provider="openrouter", model_key=None, model_id=None)


if __name__ == "__main__":
    unittest.main()
