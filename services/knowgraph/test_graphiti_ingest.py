"""Deterministic proof for the Graphiti KnowGraph ingestion boundary."""

from __future__ import annotations

import asyncio
import inspect
import json
import os
import unittest
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import patch

import ingest


class FakeGraphDriver:
    def __init__(
        self,
        *,
        existing_episode_id: str | None = None,
        existing_jev: dict[str, dict] | None = None,
        persist_error: Exception | None = None,
    ) -> None:
        self.existing_episode_id = existing_episode_id
        self.existing_jev = existing_jev or {}
        self.persist_error = persist_error
        self.queries: list[tuple[str, dict]] = []
        self.closed = False

    async def execute_query(self, cypher: str, **params):
        self.queries.append((cypher, params))
        if self.existing_episode_id and "LIMIT 1" in cypher:
            rows = [{"uuid": self.existing_episode_id}]
        elif (
            "fact.jev_native_signature AS native_signature" in cypher
            and "SET fact.jev_relation_winner" not in cypher
        ):
            rows = [
                {"uuid": fact_id, **metadata}
                for fact_id, metadata in self.existing_jev.items()
                if fact_id in params.get("fact_ids", [])
            ]
        elif "SET fact.jev_relation_winner" in cypher:
            if self.persist_error:
                raise self.persist_error
            persisted = {
                "uuid": params["native_fact_uuid"],
                "native_signature": params["native_signature"],
                "winner": params["winner"],
                "distribution_json": params["distribution_json"],
                "label_confidence": params["label_confidence"],
                "provider_confidence": params["provider_confidence"],
                "requested_model": params["requested_model"],
                "resolved_model": params["resolved_model"],
                "question_schema_version": params["question_schema_version"],
                "ontology_version": params["ontology_version"],
                "ontology_hash": params["ontology_hash"],
                "vocabulary_count": params["vocabulary_count"],
                "choice_options_json": params["choice_options_json"],
            }
            self.existing_jev[params["native_fact_uuid"]] = {
                key: value for key, value in persisted.items() if key != "uuid"
            }
            rows = [persisted]
        else:
            rows = []
        return SimpleNamespace(records=rows)

    async def close(self) -> None:
        self.closed = True


class FakeGraphiti:
    def __init__(
        self,
        *,
        existing_episode_id: str | None = None,
        existing_jev: dict[str, dict] | None = None,
        persist_error: Exception | None = None,
    ) -> None:
        self.driver = FakeGraphDriver(
            existing_episode_id=existing_episode_id,
            existing_jev=existing_jev,
            persist_error=persist_error,
        )
        self.add_calls: list[dict] = []
        self.jev_calls: list[list[dict]] = []
        self.native_edge = SimpleNamespace(
            uuid="fact-1",
            source_node_uuid="entity-a",
            target_node_uuid="entity-b",
            name="supplies launch services to",
            fact="Alpha supplies launch services to Beta.",
            episodes=["graphiti-episode-1"],
            created_at=datetime(2026, 7, 1, 12, tzinfo=timezone.utc),
            valid_at=datetime(2026, 6, 30, 12, tzinfo=timezone.utc),
            invalid_at=None,
            expired_at=None,
        )

    async def add_episode(self, **kwargs):
        self.add_calls.append(kwargs)
        return SimpleNamespace(
            episode=SimpleNamespace(uuid="graphiti-episode-1"),
            nodes=[
                SimpleNamespace(uuid="entity-a", name="Alpha"),
                SimpleNamespace(uuid="entity-b", name="Beta"),
            ],
            edges=[self.native_edge],
        )


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


def _decision(native_fact_uuid: str = "fact-1") -> dict:
    choice_options = [
        "IS_A", "PART_OF", "HAS_PART", "CAUSES", "AFFECTS",
        "DEPENDS_ON", "ENABLES", "CONSTRAINS", "REQUIRES", "SUPPORTS",
        "CONTRADICTS", "QUALIFIES", "EXPLAINS", "ASSOCIATED_WITH",
        "ALTERNATIVE_TO", "COMPETES_WITH", "PROVIDES", "USES",
        "PRECEDES", "FOLLOWS", "INSUFFICIENT_CONTEXT",
    ]
    distribution = {choice: 0.0 for choice in choice_options}
    distribution.update({"PROVIDES": 0.88, "ASSOCIATED_WITH": 0.12})
    return {
        "nativeFactUuid": native_fact_uuid,
        "status": "success",
        "winner": "PROVIDES",
        "distribution": distribution,
        "label_confidence": 0.88,
        "provider_confidence": 0.64,
        "requested_model": "typesafe/jev-1.13",
        "resolved_model": "typesafe/jev-1.13",
        "evaluated_at": "2026-09-24T12:00:00Z",
        "question_schema_version": "knowgraph.relationship-choice.v3",
        "vocabulary_version": "project.relationship-vocabulary.v1",
        "vocabulary_hash": "hash-1",
        "vocabulary_count": 20,
        "vocabulary_after_hash": "vocabulary-hash",
        "vocabulary_after_count": 20,
        "choice_options": choice_options,
        "relationship_proposal_status": "invalid_novel_label",
        "novel_relationship_candidate": "",
        "vocabulary_promotion": "not_promoted",
    }


def _run(
    graphiti: FakeGraphiti,
    *,
    decisions: list[dict] | None = None,
    jev_error: Exception | None = None,
    vocabulary_error: Exception | None = None,
):
    async def classify(project_id: str, facts: list[dict]) -> list[dict]:
        assert project_id == "project-1"
        graphiti.jev_calls.append(facts)
        if jev_error:
            raise jev_error
        return decisions if decisions is not None else [
            _decision(str(fact["nativeFactUuid"])) for fact in facts
        ]

    vocabulary = {
        "version": "project.relationship-vocabulary.v1",
        "hash": "vocabulary-hash",
        "count": 20,
        "maximum": 252,
        "atMaximum": False,
        "labels": [
            "IS_A", "PART_OF", "HAS_PART", "CAUSES", "AFFECTS",
            "DEPENDS_ON", "ENABLES", "CONSTRAINS", "REQUIRES", "SUPPORTS",
            "CONTRADICTS", "QUALIFIES", "EXPLAINS", "ASSOCIATED_WITH",
            "ALTERNATIVE_TO", "COMPETES_WITH", "PROVIDES", "USES",
            "PRECEDES", "FOLLOWS",
        ],
    }

    async def read_vocabulary(project_id: str) -> dict:
        assert project_id == "project-1"
        if vocabulary_error:
            raise vocabulary_error
        return vocabulary

    with patch.object(
        ingest,
        "_create_graphiti_runtime",
        return_value=(_runtime(), graphiti, "neo4j"),
    ), patch.object(
        ingest,
        "_read_project_relationship_vocabulary",
        side_effect=read_vocabulary,
    ), patch.object(ingest, "_call_knowgraph_jev", side_effect=classify):
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
    def test_loaded_graphiti_api_exposes_required_temporal_fact_contract(self) -> None:
        from graphiti_core import Graphiti
        from graphiti_core.edges import EntityEdge

        add_episode = inspect.signature(Graphiti.add_episode).parameters
        self.assertTrue({
            "episode_body", "source_description", "reference_time", "group_id",
            "update_communities", "custom_extraction_instructions",
        }.issubset(add_episode))
        self.assertTrue({
            "uuid", "source_node_uuid", "target_node_uuid", "name", "fact",
            "episodes", "created_at", "valid_at", "invalid_at", "expired_at",
        }.issubset(EntityEdge.model_fields))

    def test_runtime_version_is_resolved_from_the_loaded_distribution(self) -> None:
        versions = ingest.graphiti_runtime_versions()
        self.assertRegex(str(versions["graphiti_core"]), r"^\d+\.\d+\.\d+")
        self.assertEqual(ingest._graphiti_core_version(), versions["graphiti_core"])

    def test_service_owned_openrouter_model_precedence(self) -> None:
        with patch.dict(
            os.environ,
            {
                "OPENROUTER_API_KEY": "not-used",
                "OPENROUTER_DEFAULT_KG_MODEL_KEY": "vendor/kg-model",
                "OPENROUTER_DEFAULT_MODEL": "vendor/general-model",
            },
            clear=True,
        ):
            runtime = ingest._resolve_runtime_model_config(
                provider=None,
                model_key=None,
                model_id=None,
            )
            self.assertEqual(runtime.provider, "openrouter")
            self.assertEqual(runtime.model_id, "vendor/kg-model")

        with patch.dict(
            os.environ,
            {
                "OPENROUTER_API_KEY": "not-used",
                "OPENROUTER_DEFAULT_MODEL": "vendor/general-model",
            },
            clear=True,
        ):
            runtime = ingest._resolve_runtime_model_config(
                provider=None,
                model_key=None,
                model_id=None,
            )
            self.assertEqual(runtime.model_id, "vendor/general-model")

        with patch.dict(
            os.environ,
            {"OPENROUTER_API_KEY": "not-used"},
            clear=True,
        ):
            runtime = ingest._resolve_runtime_model_config(
                provider=None,
                model_key=None,
                model_id=None,
            )
            self.assertEqual(runtime.model_id, "z-ai/glm-5.2")

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

    def test_large_pdf_uses_authored_top_level_outline_sections(self) -> None:
        class FakePage:
            def __init__(self, text: str) -> None:
                self.text = text

            def extract_text(self) -> str:
                return self.text

        class FakeDestination:
            def __init__(self, title: str, page: int) -> None:
                self.title = title
                self.page = page

        first = FakeDestination("Chapter 1", 0)
        nested = FakeDestination("Nested heading", 1)
        second = FakeDestination("Chapter 2", 2)
        reader = SimpleNamespace(
            pages=[FakePage("a" * 10), FakePage("b" * 10), FakePage("c" * 10)],
            outline=[first, [nested], second],
            get_destination_page_number=lambda destination: destination.page,
        )

        sections = ingest._pdf_source_sections(
            reader, "book.pdf", single_episode_max_chars=15
        )

        self.assertEqual(
            [(section.title, section.page_start, section.page_end) for section in sections],
            [("Chapter 1", 1, 2), ("Chapter 2", 3, 3)],
        )
        self.assertNotIn("Nested heading", [section.title for section in sections])

    def test_large_pdf_without_authored_outline_fails_closed(self) -> None:
        page = SimpleNamespace(extract_text=lambda: "a" * 20)
        reader = SimpleNamespace(pages=[page, page], outline=[])
        with self.assertRaisesRegex(ValueError, "Refusing an arbitrary fixed-size split"):
            ingest._pdf_source_sections(
                reader, "unstructured.pdf", single_episode_max_chars=15
            )

    def test_new_source_uses_one_graphiti_episode_and_records_authority(self) -> None:
        graphiti = FakeGraphiti()
        native_before = vars(graphiti.native_edge).copy()
        result = _run(graphiti)

        self.assertFalse(result["idempotent"])
        self.assertEqual(result["status"], "ingested")
        self.assertEqual(result["entity_count"], 2)
        self.assertEqual(result["fact_count"], 1)
        self.assertEqual(len(graphiti.add_calls), 1)
        call = graphiti.add_calls[0]
        self.assertEqual(call["group_id"], "liquidaity-project-1")
        self.assertNotIn("uuid", call)
        self.assertEqual(result["episode_id"], "graphiti-episode-1")
        self.assertEqual(result["graphiti_version"], ingest._graphiti_core_version())
        self.assertEqual(result["relationship_vocabulary_guidance"], {
            "status": "available",
            "version": "project.relationship-vocabulary.v1",
            "hash": "vocabulary-hash",
            "count": 20,
        })
        self.assertIn("Keep claims grounded.", call["custom_extraction_instructions"])
        self.assertIn(
            "CURRENT_SHARED_PROJECT_RELATIONSHIP_VOCABULARY",
            call["custom_extraction_instructions"],
        )
        self.assertIn("PROVIDES", call["custom_extraction_instructions"])
        self.assertTrue(
            any("graphiti_version" in cypher for cypher, _ in graphiti.driver.queries)
        )
        self.assertEqual(len(graphiti.jev_calls), 1)
        self.assertEqual(graphiti.jev_calls[0][0]["nativeFactUuid"], "fact-1")
        self.assertEqual(result["jev_classification"], {
            "status": "success",
            "touched_fact_count": 1,
            "classified_fact_count": 1,
            "reused_fact_count": 0,
            "attempted_fact_uuids": ["fact-1"],
            "succeeded_fact_uuids": ["fact-1"],
            "failed_fact_uuids": [],
            "skipped_fact_uuids": [],
            "unfinished_fact_uuids": [],
            "still_unsettled_fact_uuids": [],
        })
        persisted = [
            params for cypher, params in graphiti.driver.queries
            if "SET fact.jev_relation_winner" in cypher
        ]
        self.assertEqual(len(persisted), 1)
        self.assertEqual(persisted[0]["native_fact_uuid"], "fact-1")
        self.assertEqual(persisted[0]["winner"], "PROVIDES")
        self.assertEqual(persisted[0]["label_confidence"], 0.88)
        self.assertEqual(persisted[0]["provider_confidence"], 0.64)
        self.assertEqual(persisted[0]["vocabulary_count"], 20)
        self.assertEqual(
            persisted[0]["relationship_proposal_status"],
            "invalid_novel_label",
        )
        self.assertEqual(vars(graphiti.native_edge), native_before)
        self.assertTrue(graphiti.driver.closed)

    def test_vocabulary_guidance_failure_does_not_discard_native_graphiti_fact(self) -> None:
        graphiti = FakeGraphiti()
        native_before = vars(graphiti.native_edge).copy()

        result = _run(
            graphiti,
            vocabulary_error=RuntimeError("shared vocabulary unavailable"),
        )

        self.assertEqual(result["status"], "ingested")
        self.assertEqual(result["fact_count"], 1)
        self.assertEqual(result["relationship_vocabulary_guidance"], {
            "status": "unavailable",
            "failure_reason": "shared vocabulary unavailable",
        })
        self.assertEqual(
            graphiti.add_calls[0]["custom_extraction_instructions"],
            "Keep claims grounded.",
        )
        self.assertEqual(vars(graphiti.native_edge), native_before)

    def test_support_only_update_reuses_semantically_identical_classification(self) -> None:
        signature = ingest._native_fact_signature({
            "sourceEntity": {"uuid": "entity-a"},
            "targetEntity": {"uuid": "entity-b"},
            "nativeRelation": "supplies launch services to",
            "fact": "Alpha supplies launch services to Beta.",
        })
        graphiti = FakeGraphiti(existing_jev={"fact-1": {
            "native_signature": signature,
            "winner": "PROVIDES",
            "distribution_json": json.dumps(
                _decision()["distribution"], sort_keys=True, separators=(",", ":")
            ),
            "label_confidence": 0.88,
            "provider_confidence": 0.64,
            "requested_model": "typesafe/jev-1.13",
            "resolved_model": "typesafe/jev-1.13",
            "question_schema_version": "knowgraph.relationship-choice.v3",
            "ontology_version": "project.relationship-vocabulary.v1",
            "ontology_hash": "vocabulary-hash",
            "vocabulary_count": 20,
            "choice_options_json": json.dumps(_decision()["choice_options"]),
        }})

        result = _run(graphiti)

        self.assertEqual(graphiti.jev_calls, [])
        self.assertEqual(result["jev_classification"], {
            "status": "current",
            "touched_fact_count": 1,
            "classified_fact_count": 0,
            "reused_fact_count": 1,
            "attempted_fact_uuids": [],
            "succeeded_fact_uuids": [],
            "failed_fact_uuids": [],
            "skipped_fact_uuids": ["fact-1"],
            "unfinished_fact_uuids": [],
            "still_unsettled_fact_uuids": [],
        })
        self.assertFalse(any(
            "SET fact.jev_relation_winner" in cypher
            for cypher, _ in graphiti.driver.queries
        ))

    def test_materially_changed_native_fact_is_classified_once(self) -> None:
        graphiti = FakeGraphiti(existing_jev={"fact-1": {
            "native_signature": "old-meaning",
            "winner": "ASSOCIATED_WITH",
            "distribution_json": '{"ASSOCIATED_WITH":1.0}',
        }})

        result = _run(graphiti)

        self.assertEqual(len(graphiti.jev_calls), 1)
        self.assertEqual(len(graphiti.jev_calls[0]), 1)
        self.assertEqual(result["jev_classification"]["classified_fact_count"], 1)

    def test_explicit_reconciliation_repairs_malformed_annotation_then_is_idempotent(self) -> None:
        graphiti = FakeGraphiti(existing_jev={"fact-1": {
            "native_signature": "stale-signature",
            "winner": "PROVIDES",
            "distribution_json": '{"ASSOCIATED_WITH":1.0}',
            "label_confidence": 1.0,
            "provider_confidence": 0.64,
            "requested_model": "typesafe/jev-1.13",
            "resolved_model": "typesafe/jev-1.13",
            "question_schema_version": "knowgraph.relationship-choice.v3",
            "ontology_version": "project.relationship-vocabulary.v1",
            "ontology_hash": "stale-vocabulary",
            "vocabulary_count": 20,
            "choice_options_json": '["ASSOCIATED_WITH"]',
        }})
        native_before = vars(graphiti.native_edge).copy()
        fact = {
            "nativeFactUuid": "fact-1",
            "sourceEntity": {"uuid": "entity-a", "name": "Alpha"},
            "targetEntity": {"uuid": "entity-b", "name": "Beta"},
            "nativeRelation": "supplies launch services to",
            "fact": "Alpha supplies launch services to Beta.",
            "supportingEpisodeUuids": ["graphiti-episode-1"],
            "supportingEpisodes": [],
            "createdAt": "2026-07-01T12:00:00+00:00",
            "referenceTime": "2026-07-01T12:00:00+00:00",
            "validAt": "2026-06-30T12:00:00+00:00",
            "invalidAt": None,
            "expiredAt": None,
        }
        vocabulary = {
            "version": "project.relationship-vocabulary.v1",
            "hash": "vocabulary-hash",
            "count": 20,
            "labels": _decision()["choice_options"][:-1],
        }
        calls: list[list[dict]] = []

        async def classify(project_id: str, facts: list[dict]) -> list[dict]:
            self.assertEqual(project_id, "project-1")
            calls.append(facts)
            return [_decision(str(item["nativeFactUuid"])) for item in facts]

        with patch.object(ingest, "_call_knowgraph_jev", side_effect=classify):
            repaired = asyncio.run(ingest._reconcile_jev_facts(
                graphiti,
                project_id="project-1",
                facts=[dict(fact)],
                relationship_vocabulary=vocabulary,
            ))
            current = asyncio.run(ingest._reconcile_jev_facts(
                graphiti,
                project_id="project-1",
                facts=[dict(fact)],
                relationship_vocabulary=vocabulary,
            ))

        self.assertEqual(repaired["status"], "success")
        self.assertEqual(repaired["attempted_fact_uuids"], ["fact-1"])
        self.assertEqual(repaired["succeeded_fact_uuids"], ["fact-1"])
        self.assertEqual(repaired["skipped_fact_uuids"], [])
        self.assertEqual(repaired["still_unsettled_fact_uuids"], [])
        self.assertEqual(current["status"], "current")
        self.assertEqual(current["attempted_fact_uuids"], [])
        self.assertEqual(current["succeeded_fact_uuids"], [])
        self.assertEqual(current["skipped_fact_uuids"], ["fact-1"])
        self.assertEqual(current["still_unsettled_fact_uuids"], [])
        self.assertEqual(len(calls), 1)
        self.assertEqual(vars(graphiti.native_edge), native_before)

    def test_jev_failure_keeps_the_grounded_native_fact(self) -> None:
        graphiti = FakeGraphiti()
        native_before = vars(graphiti.native_edge).copy()

        result = _run(graphiti, jev_error=RuntimeError("jev unavailable"))

        self.assertEqual(result["status"], "ingested")
        self.assertEqual(result["fact_count"], 1)
        self.assertEqual(result["jev_classification"]["status"], "unavailable")
        self.assertEqual(result["jev_classification"]["failed_fact_uuids"], ["fact-1"])
        self.assertEqual(vars(graphiti.native_edge), native_before)
        self.assertFalse(any(
            "SET fact.jev_relation_winner" in cypher
            for cypher, _ in graphiti.driver.queries
        ))
        self.assertTrue(graphiti.driver.closed)

    def test_unmapped_jev_control_outcome_keeps_the_grounded_native_fact(self) -> None:
        graphiti = FakeGraphiti()
        native_before = vars(graphiti.native_edge).copy()
        insufficient = {
            **_decision(),
            "status": "unavailable",
            "winner": "INSUFFICIENT_CONTEXT",
            "distribution": {"PROVIDES": 0.35, "INSUFFICIENT_CONTEXT": 0.65},
            "control_outcome": "INSUFFICIENT_CONTEXT",
            "failure_reason": "knowgraph_jev_insufficient_context",
        }

        result = _run(graphiti, decisions=[insufficient])

        self.assertEqual(result["status"], "ingested")
        self.assertEqual(result["fact_count"], 1)
        self.assertEqual(result["jev_classification"]["status"], "unavailable")
        self.assertEqual(result["jev_classification"]["failed_fact_uuids"], ["fact-1"])
        self.assertEqual(vars(graphiti.native_edge), native_before)
        self.assertFalse(any(
            "SET fact.jev_relation_winner" in cypher
            for cypher, _ in graphiti.driver.queries
        ))

    def test_duplicate_episode_skips_graphiti_and_provider_work(self) -> None:
        graphiti = FakeGraphiti(existing_episode_id="graphiti-existing-episode")
        result = _run(graphiti)

        self.assertTrue(result["idempotent"])
        self.assertEqual(result["status"], "already_ingested")
        self.assertEqual(result["episode_id"], "graphiti-existing-episode")
        self.assertEqual(graphiti.add_calls, [])
        self.assertEqual(graphiti.jev_calls, [])
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
