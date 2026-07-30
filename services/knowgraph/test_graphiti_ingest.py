"""Deterministic proof for the Graphiti KnowGraph ingestion boundary."""

from __future__ import annotations

import asyncio
import unittest
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import patch

import ingest


class FakeGraphDriver:
    def __init__(self, *, existing: bool = False) -> None:
        self.existing = existing
        self.queries: list[tuple[str, dict]] = []
        self.closed = False

    async def execute_query(self, cypher: str, **params):
        self.queries.append((cypher, params))
        rows = [{"uuid": params["episode_id"]}] if self.existing and "LIMIT 1" in cypher else []
        return SimpleNamespace(records=rows)

    async def close(self) -> None:
        self.closed = True


class FakeGraphiti:
    def __init__(self, *, existing: bool = False) -> None:
        self.driver = FakeGraphDriver(existing=existing)
        self.add_calls: list[dict] = []

    async def add_episode(self, **kwargs):
        self.add_calls.append(kwargs)
        return SimpleNamespace(nodes=["entity"], edges=["fact"])


def _runtime():
    return ingest.RuntimeModelConfig(
        provider="openrouter",
        model_key="deepseek",
        model_id="deepseek/deepseek-chat",
        llm_client_kwargs={"api_key": "not-used"},
        embedding_backend="openai_compatible",
        embedding_model="openai/text-embedding-3-large",
        embedding_dimensions=3072,
        embedding_client_kwargs={"api_key": "not-used"},
    )


def _run(graphiti: FakeGraphiti):
    with patch.object(
        ingest,
        "_create_graphiti_runtime",
        return_value=(_runtime(), graphiti, "neo4j"),
    ):
        return asyncio.run(
            ingest._ingest_episode(
                project_id="project-1",
                document_id="document-1",
                text="Temporal knowledge is grounded in a source.",
                source_name="Source",
                source_path="https://example.test/source",
                source_type="web_research",
                source_url="https://example.test/source",
                fetched_at="2026-07-01T12:00:00Z",
                snippet=None,
                metadata={"published_at": "2026-06-30T12:00:00Z"},
                provider="openrouter",
                model_key="deepseek",
                model_id="deepseek/deepseek-chat",
                agent_id="hermes",
                guidance="Keep claims grounded.",
                reference_time=datetime(2026, 7, 1, 12, tzinfo=timezone.utc),
            )
        )


class GraphitiIngestTests(unittest.TestCase):
    def test_episode_identity_is_content_versioned_and_deterministic(self) -> None:
        first = ingest._episode_identity("p", "d", "same")
        second = ingest._episode_identity("p", "d", "same")
        changed = ingest._episode_identity("p", "d", "changed")
        self.assertEqual(first, second)
        self.assertNotEqual(first, changed)

    def test_reference_time_prefers_source_time_over_ingestion_time(self) -> None:
        parsed = ingest._reference_time(
            None, {"publication_date": "2026-06-30T12:00:00Z"}
        )
        self.assertEqual(parsed, datetime(2026, 6, 30, 12, tzinfo=timezone.utc))

    def test_new_source_uses_one_graphiti_episode_and_records_authority(self) -> None:
        graphiti = FakeGraphiti()
        result = _run(graphiti)

        self.assertFalse(result["idempotent"])
        self.assertEqual(result["status"], "ingested")
        self.assertEqual(result["entity_count"], 1)
        self.assertEqual(result["fact_count"], 1)
        self.assertEqual(len(graphiti.add_calls), 1)
        call = graphiti.add_calls[0]
        self.assertEqual(call["group_id"], "liquidaity:project-1")
        self.assertEqual(call["uuid"], result["episode_id"])
        self.assertEqual(call["custom_extraction_instructions"], "Keep claims grounded.")
        self.assertTrue(
            any("graphiti_version" in cypher for cypher, _ in graphiti.driver.queries)
        )
        self.assertTrue(graphiti.driver.closed)

    def test_duplicate_episode_skips_graphiti_and_provider_work(self) -> None:
        graphiti = FakeGraphiti(existing=True)
        result = _run(graphiti)

        self.assertTrue(result["idempotent"])
        self.assertEqual(result["status"], "already_ingested")
        self.assertEqual(graphiti.add_calls, [])
        self.assertEqual(len(graphiti.driver.queries), 1)
        self.assertTrue(graphiti.driver.closed)

    def test_old_custom_chunk_pipeline_is_absent(self) -> None:
        for obsolete in (
            "SimpleKGPipeline",
            "DeterministicFixedSizeSplitter",
            "_merge_ingested_graph",
            "_delete_prior_document",
        ):
            self.assertFalse(hasattr(ingest, obsolete), obsolete)


if __name__ == "__main__":
    unittest.main()
