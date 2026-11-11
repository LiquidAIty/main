"""Deterministic proof for Graphiti runtime and canonical Know fact settlement."""

# Graph + less = more: less code that does the same work as more code is more useful.
# Entity names the feature; Relationship explains why this file belongs and what it contributes.
# Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
# Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
# Entity: KnowGraph
# Relationship: This file preserves process configuration and canonical sourced-fact settlement proof independently of document indexing.
# Entity: Jev Decisions
# Relationship: This file contributes proof of bounded, idempotent, and repairable Graphiti fact classification to the Jev Decisions feature.
# Entity: Credentials
# Relationship: This file contributes proof of process-scoped provider and model configuration without exposing secret values to the Credentials feature.

from __future__ import annotations

import asyncio
import json
import os
import unittest
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import patch

import graphiti_runtime
import ingest
import jev_fact_settlement


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
        if "episode.project_id AS project_id" in cypher:
            rows = [{
                "uuid": params["episode_id"],
                "project_id": params["project_id"],
                "document_id": params["document_id"],
                "source_content_sha256": params["source_content_sha256"],
                "content_fingerprint": params["content_fingerprint"],
            }]
        elif "episode.ingest_settlement_status AS status" in cypher:
            rows = [{
                "uuid": params["episode_id"],
                "settlement_version": params["settlement_version"],
                "status": params["status"],
            }]
        elif "source_uuid" in cypher and self.existing_episode_id:
            rows = [{
                "uuid": "fact-1",
                "source_node_uuid": "entity-a",
                "target_node_uuid": "entity-b",
                "name": "supplies launch services to",
                "fact": "Alpha supplies launch services to Beta.",
                "episodes": [self.existing_episode_id],
                "created_at": datetime(2026, 7, 1, 12, tzinfo=timezone.utc),
                "valid_at": datetime(2026, 6, 30, 12, tzinfo=timezone.utc),
                "invalid_at": None,
                "expired_at": None,
                "source_uuid": "entity-a",
                "source_name": "Alpha",
                "target_uuid": "entity-b",
                "target_name": "Beta",
            }]
        elif self.existing_episode_id and "LIMIT 1" in cypher:
            rows = [{"uuid": self.existing_episode_id}]
        elif (
            "fact.jev_graphiti_signature AS graphiti_signature" in cypher
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
                "uuid": params["graphiti_fact_uuid"],
                "graphiti_signature": params["graphiti_signature"],
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
            self.existing_jev[params["graphiti_fact_uuid"]] = {
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
        add_barrier: asyncio.Barrier | None = None,
    ) -> None:
        self.driver = FakeGraphDriver(
            existing_episode_id=existing_episode_id,
            existing_jev=existing_jev,
            persist_error=persist_error,
        )
        self.add_calls: list[dict] = []
        self.add_barrier = add_barrier
        self.jev_calls: list[list[dict]] = []
        self.graphiti_edge = SimpleNamespace(
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
        if self.add_barrier is not None:
            await self.add_barrier.wait()
        episode_id = str(kwargs["uuid"])
        self.driver.existing_episode_id = episode_id
        edge = SimpleNamespace(**{
            **vars(self.graphiti_edge),
            "episodes": [episode_id],
        })
        return SimpleNamespace(
            episode=SimpleNamespace(uuid=episode_id),
            nodes=[
                SimpleNamespace(uuid="entity-a", name="Alpha"),
                SimpleNamespace(uuid="entity-b", name="Beta"),
            ],
            edges=[edge],
        )


def _decision(graphiti_fact_uuid: str = "fact-1") -> dict:
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
        "graphitiFactUuid": graphiti_fact_uuid,
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
        "vocabulary_hash": "vocabulary-hash",
        "vocabulary_count": 20,
        "vocabulary_after_hash": "vocabulary-hash",
        "vocabulary_after_count": 20,
        "choice_options": choice_options,
        "relationship_proposal_status": "invalid_novel_label",
        "novel_relationship_candidate": "",
        "vocabulary_promotion": "not_promoted",
    }


def _run(graphiti: FakeGraphiti, *, decisions=None, jev_error=None, edges=None, read_existing=False):
    async def classify(project_id, facts):
        assert project_id == "project-1"
        graphiti.jev_calls.append(facts)
        if jev_error:
            raise jev_error
        return decisions if decisions is not None else [_decision(str(fact["graphitiFactUuid"])) for fact in facts]

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

    async def settle():
        episode_id = graphiti.driver.existing_episode_id or "graphiti-episode-1"
        source_edges = edges if edges is not None else [graphiti.graphiti_edge]
        nodes = [SimpleNamespace(uuid="entity-a", name="Alpha"), SimpleNamespace(uuid="entity-b", name="Beta")]
        if read_existing:
            source_edges, nodes = await jev_fact_settlement.read_episode_facts(graphiti, episode_id=episode_id)
        return await jev_fact_settlement.classify_episode_facts_with_jev(
            graphiti, project_id="project-1", edges=source_edges, nodes=nodes, episode_id=episode_id,
            source_name="Source", source_reference="https://example.test/source",
            text="Temporal knowledge is grounded in a source.",
            reference_time=datetime(2026, 7, 1, 12, tzinfo=timezone.utc),
            relationship_vocabulary=vocabulary, source_type="web_research")

    with patch.object(jev_fact_settlement, "_call_knowgraph_jev", side_effect=classify):
        return asyncio.run(settle())

class GraphitiIngestTests(unittest.TestCase):
    def test_promoted_vocabulary_does_not_change_the_scored_choice_identity(self) -> None:
        graphiti = FakeGraphiti()
        decision = _decision()
        decision.update(vocabulary_after_hash="promoted-vocabulary", vocabulary_after_count=21,
                        vocabulary_promotion="promoted")
        result = _run(graphiti, decisions=[decision])
        self.assertEqual(result["status"], "success")
        persisted = next(params for cypher, params in graphiti.driver.queries
                         if "SET fact.jev_relation_winner" in cypher)
        self.assertEqual(persisted["ontology_hash"], "vocabulary-hash")
        self.assertEqual(persisted["vocabulary_count"], 20)
        self.assertEqual(persisted["vocabulary_after_hash"], "promoted-vocabulary")
        self.assertEqual(persisted["vocabulary_after_count"], 21)

    def test_runtime_version_is_resolved_from_the_loaded_distribution(self) -> None:
        versions = graphiti_runtime.graphiti_runtime_versions()
        self.assertRegex(str(versions["graphiti_core"]), r"^\d+\.\d+\.\d+")
        self.assertEqual(graphiti_runtime.graphiti_core_version(), versions["graphiti_core"])

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
            runtime = graphiti_runtime.resolve_runtime_model_config()
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
            runtime = graphiti_runtime.resolve_runtime_model_config()
            self.assertEqual(runtime.model_id, "vendor/general-model")

        with patch.dict(
            os.environ,
            {"OPENROUTER_API_KEY": "not-used"},
            clear=True,
        ):
            runtime = graphiti_runtime.resolve_runtime_model_config()
            self.assertEqual(runtime.model_id, "z-ai/glm-5.2")

    def test_service_owned_openai_configuration_is_process_scoped(self) -> None:
        with patch.dict(
            os.environ,
            {
                "KNOWGRAPH_PROVIDER": "openai",
                "KNOWGRAPH_MODEL": "openai-knowledge-model",
                "OPENAI_API_KEY": "not-used",
            },
            clear=True,
        ):
            runtime = graphiti_runtime.resolve_runtime_model_config()
        self.assertEqual(runtime.provider, "openai")
        self.assertEqual(runtime.model_id, "openai-knowledge-model")

    def test_pdf_source_reference_must_match_its_content_digest(self) -> None:
        with self.assertRaisesRegex(ValueError, "source_reference_invalid"):
            asyncio.run(ingest.ingest_pdf(
                "missing.pdf",
                "project-1",
                "document-1",
                source_name="source.pdf",
                source_reference=(
                    "knowgraph-upload://sha256/" + "b" * 64 + "/source.pdf"
                ),
                source_content_sha256="a" * 64,
            ))

    def test_canonical_facts_settle_with_exact_confidence_and_without_source_mutation(self) -> None:
        graphiti = FakeGraphiti()
        graphiti_before = vars(graphiti.graphiti_edge).copy()
        result = _run(graphiti)

        self.assertEqual(len(graphiti.jev_calls), 1)
        self.assertEqual(graphiti.jev_calls[0][0]["graphitiFactUuid"], "fact-1")
        self.assertEqual(result, {
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
        self.assertEqual(persisted[0]["graphiti_fact_uuid"], "fact-1")
        self.assertEqual(persisted[0]["winner"], "PROVIDES")
        self.assertEqual(persisted[0]["label_confidence"], 0.88)
        self.assertEqual(persisted[0]["provider_confidence"], 0.64)
        self.assertEqual(persisted[0]["vocabulary_count"], 20)
        self.assertEqual(
            persisted[0]["relationship_proposal_status"],
            "invalid_novel_label",
        )
        self.assertEqual(vars(graphiti.graphiti_edge), graphiti_before)

    def test_support_only_update_reuses_semantically_identical_classification(self) -> None:
        signature = jev_fact_settlement.graphiti_fact_signature({
            "sourceEntity": {"uuid": "entity-a"},
            "targetEntity": {"uuid": "entity-b"},
            "graphitiRelation": "supplies launch services to",
            "fact": "Alpha supplies launch services to Beta.",
        })
        graphiti = FakeGraphiti(existing_jev={"fact-1": {
            "graphiti_signature": signature,
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
        self.assertEqual(result, {
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

    def test_materially_changed_graphiti_fact_is_classified_once(self) -> None:
        graphiti = FakeGraphiti(existing_jev={"fact-1": {
            "graphiti_signature": "old-meaning",
            "winner": "ASSOCIATED_WITH",
            "distribution_json": '{"ASSOCIATED_WITH":1.0}',
        }})

        result = _run(graphiti)

        self.assertEqual(len(graphiti.jev_calls), 1)
        self.assertEqual(len(graphiti.jev_calls[0]), 1)
        self.assertEqual(result["classified_fact_count"], 1)

    def test_fact_settlement_repairs_malformed_annotation_then_is_idempotent(self) -> None:
        graphiti = FakeGraphiti(existing_jev={"fact-1": {
            "graphiti_signature": "stale-signature",
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
        graphiti_before = vars(graphiti.graphiti_edge).copy()
        fact = {
            "graphitiFactUuid": "fact-1",
            "sourceEntity": {"uuid": "entity-a", "name": "Alpha"},
            "targetEntity": {"uuid": "entity-b", "name": "Beta"},
            "graphitiRelation": "supplies launch services to",
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
            return [_decision(str(item["graphitiFactUuid"])) for item in facts]

        with patch.object(jev_fact_settlement, "_call_knowgraph_jev", side_effect=classify):
            repaired = asyncio.run(jev_fact_settlement._classify_and_persist_jev_facts(
                graphiti,
                project_id="project-1",
                facts=[dict(fact)],
                relationship_vocabulary=vocabulary,
            ))
            current = asyncio.run(jev_fact_settlement._classify_and_persist_jev_facts(
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
        self.assertEqual(vars(graphiti.graphiti_edge), graphiti_before)

    def test_jev_failure_keeps_the_grounded_graphiti_fact(self) -> None:
        graphiti = FakeGraphiti()
        graphiti_before = vars(graphiti.graphiti_edge).copy()

        result = _run(graphiti, jev_error=RuntimeError("jev unavailable"))

        self.assertEqual(result["status"], "unavailable")
        self.assertEqual(result["failed_fact_uuids"], ["fact-1"])
        self.assertEqual(vars(graphiti.graphiti_edge), graphiti_before)
        self.assertFalse(any(
            "SET fact.jev_relation_winner" in cypher
            for cypher, _ in graphiti.driver.queries
        ))

    def test_unmapped_jev_control_outcome_keeps_the_grounded_graphiti_fact(self) -> None:
        graphiti = FakeGraphiti()
        graphiti_before = vars(graphiti.graphiti_edge).copy()
        insufficient = {
            **_decision(),
            "status": "unavailable",
            "winner": "INSUFFICIENT_CONTEXT",
            "distribution": {"PROVIDES": 0.35, "INSUFFICIENT_CONTEXT": 0.65},
            "control_outcome": "INSUFFICIENT_CONTEXT",
            "failure_reason": "knowgraph_jev_insufficient_context",
        }

        result = _run(graphiti, decisions=[insufficient])

        self.assertEqual(result["status"], "unavailable")
        self.assertEqual(
            result["attempted_fact_uuids"], ["fact-1"]
        )
        self.assertEqual(result["failed_fact_uuids"], ["fact-1"])
        self.assertEqual(vars(graphiti.graphiti_edge), graphiti_before)
        self.assertFalse(any(
            "SET fact.jev_relation_winner" in cypher
            for cypher, _ in graphiti.driver.queries
        ))

    def test_unfinished_jev_result_is_attempted_and_remains_unsettled(self) -> None:
        graphiti = FakeGraphiti()
        unfinished = {
            "graphitiFactUuid": "fact-1",
            "status": "unfinished",
            "failure_reason": "knowgraph_jev_deadline_exceeded",
        }

        result = _run(graphiti, decisions=[unfinished])

        classification = result
        self.assertEqual(classification["status"], "unavailable")
        self.assertEqual(classification["attempted_fact_uuids"], ["fact-1"])
        self.assertEqual(classification["unfinished_fact_uuids"], ["fact-1"])
        self.assertEqual(classification["still_unsettled_fact_uuids"], ["fact-1"])
        self.assertEqual(classification["failed_fact_uuids"], [])

    def test_unsettled_jev_metadata_repairs_on_same_episode_retry(self) -> None:
        graphiti = FakeGraphiti()
        first = _run(graphiti, jev_error=RuntimeError("jev unavailable"))

        self.assertEqual(first["status"], "unavailable")
        self.assertEqual(
            first["still_unsettled_fact_uuids"],
            ["fact-1"],
        )

        repaired = _run(graphiti)

        self.assertEqual(repaired["status"], "success")
        self.assertEqual(repaired["still_unsettled_fact_uuids"], [])

    def test_existing_episode_facts_settle_without_reextracting(self) -> None:
        graphiti = FakeGraphiti(existing_episode_id="graphiti-existing-episode")
        result = _run(graphiti, read_existing=True)
        self.assertEqual(result["status"], "success")
        self.assertEqual(result["succeeded_fact_uuids"], ["fact-1"])
        self.assertEqual(graphiti.add_calls, [])
        self.assertEqual(len(graphiti.jev_calls), 1)
        fact = graphiti.jev_calls[0][0]
        self.assertEqual(fact["sourceEntity"]["uuid"], "entity-a")
        self.assertEqual(fact["targetEntity"]["uuid"], "entity-b")

    def test_fact_settlement_preserves_partial_success(self) -> None:
        graphiti = FakeGraphiti()
        second = SimpleNamespace(**{**vars(graphiti.graphiti_edge), "uuid": "fact-2"})
        result = _run(graphiti, edges=[graphiti.graphiti_edge, second], decisions=[
            _decision("fact-1"),
            {"graphitiFactUuid": "fact-2", "status": "unfinished", "failure_reason": "provider unavailable"},
        ])
        self.assertEqual(result["status"], "partial")
        self.assertEqual(result["attempted_fact_uuids"], ["fact-1", "fact-2"])
        self.assertEqual(result["succeeded_fact_uuids"], ["fact-1"])
        self.assertEqual(result["still_unsettled_fact_uuids"], ["fact-2"])
        self.assertEqual(result["failure_reasons"]["fact-2"], "provider unavailable")


if __name__ == "__main__":
    unittest.main()
