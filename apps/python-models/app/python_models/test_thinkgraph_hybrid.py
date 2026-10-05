"""Focused proof for the real Engraphis-owned hybrid ThinkGraph lifecycle."""
from __future__ import annotations

import asyncio
import json
from pathlib import Path
import threading
import time
from typing import Any

import pytest

from app.python_models import engraphis as adapter
from app.python_models.jev_edge_ontology import (
    SHARED_JEV_RELATIONSHIPS,
)


@pytest.fixture()
def hybrid(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    from app.python_models.data_anchor import assemble_canonical_subject_directory

    original = adapter.DATABASE
    adapter.close_engine()
    adapter.DATABASE = tmp_path / "thinkgraph.sqlite"
    def directory(project: str) -> dict[str, Any]:
        return assemble_canonical_subject_directory(
            project,
            adapter.read_subject_directory(project),
            {
                "complete": True,
                "count": 1,
                "revision": "know-test-revision",
                "subjects": [
                    {"authority": "KnowGraph", "nativeId": "know-jev",
                     "canonicalName": "Jev", "entityKind": "Entity"},
                ],
            },
        )
    monkeypatch.setattr(adapter, "_subject_directory_for_project", directory)
    try:
        yield adapter
    finally:
        adapter.close_engine()
        adapter.DATABASE = original


def decision(
    winner: str = "QUALIFIES",
    *,
    choices: tuple[str, ...] | None = None,
    novel_candidate: str = "",
    proposal_status: str = "reused_canonical",
) -> dict[str, Any]:
    choice_options = choices or adapter.THINKGRAPH_JEV_CHOICES
    distribution = {name: 0.0 for name in choice_options}
    distribution[winner] = 0.76
    alternate = next(name for name in choice_options if name != winner)
    distribution[alternate] = 0.24
    return {
        "winner": winner,
        "distribution": distribution,
        "confidence": 0.64,
        "label_confidence": distribution[winner],
        "relationship_strength": distribution[winner],
        "provider": "TypeSafe",
        "requested_model": adapter.JEV_MODEL,
        "resolved_model": "typesafe/jev-1.13-test",
        "usage": {},
        "choice_options": list(choice_options),
        "vocabulary_version": adapter.PROJECT_RELATIONSHIP_VOCABULARY_VERSION,
        "vocabulary_hash": adapter.relationship_vocabulary_hash(
            tuple(name for name in choice_options
                  if name not in adapter.THINKGRAPH_CONTROL_OUTCOMES
                  and name != novel_candidate)
        ),
        "vocabulary_count": len([
            name for name in choice_options
            if name not in adapter.THINKGRAPH_CONTROL_OUTCOMES
            and name != novel_candidate
        ]),
        "relationship_proposal_status": proposal_status,
        "novel_relationship_candidate": novel_candidate,
    }


def source_response_fit(run_id: str) -> dict[str, Any]:
    return {
        "schemaVersion": "request-fulfillment-assessment.v1",
        "metric": "request_fulfillment",
        "rubricVersion": "request-fulfillment.v1",
        "status": "unavailable",
        "runId": run_id,
        "executionEvidenceComplete": False,
        "executionEvidenceError": "test_fixture_execution_evidence_unavailable",
        "failureReason": "test_fixture_execution_evidence_unavailable",
        "requestCount": 0,
        "questionCount": 0,
    }


def scored_source_response_fit(run_id: str) -> dict[str, Any]:
    return {
        "schemaVersion": "request-fulfillment-assessment.v1",
        "metric": "request_fulfillment",
        "rubricVersion": "request-fulfillment.v1",
        "status": "scored",
        "runId": run_id,
        "cardRevisionId": "revision-one",
        "idfSha256": "a" * 64,
        "outputSha256": "b" * 64,
        "executionEvidenceSha256": "c" * 64,
        "exposedToolsSha256": "d" * 64,
        "executionEvidenceComplete": True,
        "executionEvidenceError": None,
        "actualProvider": "openrouter",
        "actualModel": "configured/model",
        "requestedModel": "typesafe/jev-1.13",
        "scale": {"minimum": 0.0, "maximum": 4.0},
        "evaluatedAt": "2026-09-25T12:00:00Z",
        "rawScore": 1.0,
        "normalizedScore100": 25.0,
        "probabilities": {
            "0": 0.33, "1": 0.33, "2": 0.33, "3": 0.0, "4": 0.0,
        },
        "confidence": 0.2,
        "provider": "TypeSafe",
        "resolvedModel": "typesafe/jev-1.13-test",
        "decisionId": "decision-one",
        "usage": {},
        "requestCount": 1,
        "questionCount": 1,
        "timingMs": 12.0,
    }


def test_source_response_fit_accepts_exact_scored_receipt_without_normalizing():
    receipt = scored_source_response_fit("run-one")

    assert adapter._validate_source_response_fit(receipt, "run-one") == receipt


@pytest.mark.parametrize(
    "mutation",
    [
        {"failureReason": "must-not-coexist"},
        {"executionEvidenceComplete": False},
        {"requestCount": 0},
        {"idfSha256": None},
    ],
)
def test_source_response_fit_rejects_incomplete_scored_receipt(mutation):
    receipt = {**scored_source_response_fit("run-one"), **mutation}

    with pytest.raises(ValueError, match="thinkgraph_source_response_fit_invalid"):
        adapter._validate_source_response_fit(receipt, "run-one")


def payload(run_id: str = "run-one") -> dict[str, Any]:
    return {
        "projectId": "project-one",
        "deckId": "agent-builder",
        "conversationId": "conversation-one",
        "runId": run_id,
        "cardId": "main",
        "nativeSessionRef": "session-one",
        "completedAt": "2026-09-23T12:00:00Z",
        "userMessage": "Jev evaluates ThinkGraph relationship semantics.",
        "mainResponse": "ThinkGraph uses Jev before durable semantic edges are written.",
        "sourceResponseFit": source_response_fit(run_id),
    }


def test_retired_evidence_judgment_is_not_exposed_from_native_think_metadata():
    stored = {
        "thinkgraph_fact": {"entities": ["Jev"], "relations": []},
        "thinkgraph_origin": {"authority": "thinkgraph"},
        "needs_evidence": {
            "winner": "NO",
            "distribution": {"YES": 0.07, "NO": 0.93},
        },
    }

    exposed = adapter._public_think_metadata(stored)

    assert exposed == {
        "thinkgraph_fact": stored["thinkgraph_fact"],
        "thinkgraph_origin": stored["thinkgraph_origin"],
    }
    assert "needs_evidence" in stored


def card_run(run_id: str = "thinkgraph-run-one") -> dict[str, str]:
    return {
        "runId": run_id,
        "cardId": "card_thinkgraph",
        "revisionId": "revision-one",
        "profile": "thinkgraph",
        "nativeSessionRef": "thinkgraph-session-one",
        "resolvedModel": "openai/saved-thinkgraph-model-test",
    }


FREEFORM_RELATION = "provides probabilistic semantic classification for"


def structured_output(*, content: str = "Jev normalizes expressive graph relations.") -> dict:
    return {
        "facts": [{
            "content": content,
            "title": "Expressive relation normalization",
            "mtype": "episodic",
            "importance": 0.63,
            "keywords": ["probability", "graph semantics"],
            "entities": ["Jev", "ThinkGraph"],
            "relations": [{
                "source": "Jev",
                "relation": FREEFORM_RELATION,
                "target": "ThinkGraph",
            }],
        }],
    }


def four_fact_output() -> dict[str, Any]:
    rows = [
        (
            "Electron demonstrates present execution",
            "Rocket Lab's Electron cadence is evidence of present launch execution, not by itself evidence of shareholder value.",
            0.86,
            ["execution", "Electron"],
            "Electron",
            "operates Electron as its current orbital launch vehicle",
        ),
        (
            "Cadence needs attributable economics",
            "Rocket Lab's launch cadence strengthens the investment case only when completed missions produce attributable launch economics.",
            0.93,
            ["cadence", "economics"],
            "Launch cadence",
            "must convert launch cadence into attributable launch economics",
        ),
        (
            "Cash conversion remains decisive",
            "Rocket Lab needs launch gross profit to convert into durable cash generation before operating progress becomes investment-thesis progress.",
            0.89,
            ["cash generation", "gross profit"],
            "Cash generation",
            "must convert launch economics into cash generation",
        ),
        (
            "Neutron remains future option value",
            "Rocket Lab's Neutron program remains future option value until milestones reduce schedule, spending, and dilution uncertainty.",
            0.78,
            ["Neutron", "option value"],
            "Neutron",
            "develops Neutron as future option value",
        ),
    ]
    return {
        "facts": [{
            "content": content,
            "title": title,
            "mtype": "episodic",
            "importance": importance,
            "keywords": keywords,
            "entities": ["Rocket Lab", target],
            "relations": [{
                "source": "Rocket Lab",
                "relation": relation,
                "target": target,
            }],
        } for title, content, importance, keywords, target, relation in rows],
    }


def settle_payload(
    preparation: dict,
    *,
    output: dict | None = None,
    completed: dict[str, Any] | None = None,
) -> dict:
    return {
        **(completed or payload()),
        "pairReference": preparation["pairReference"],
        "structuredOutput": output or structured_output(),
        "cardRun": card_run(),
}


def only_think_id(settled: dict[str, Any]) -> str:
    assert len(settled["thinkMemoryIds"]) == 1
    return str(settled["thinkMemoryIds"][0])


def entities_and_edges(hybrid) -> tuple[list[Any], list[Any]]:
    service = hybrid.get_service()
    entities = service.store.list_entities()
    edges = service.store.neighbors([entity.id for entity in entities]) if entities else []
    return entities, edges


def persist_direct_think(
    hybrid,
    *,
    workspace_id: str,
    entity_ids: list[str],
    entity_names: list[str],
    summary: str,
    run_id: str,
    title: str = "Reusable Think",
) -> str:
    service = hybrid.get_service()
    completed = payload(run_id)
    completed.update({
        "userMessage": f"User contribution for {run_id}.",
        "mainResponse": summary,
    })
    output = hybrid._ProjectedStructuredFact(
        content=summary,
        title=title,
        mtype="episodic",
        importance=0.5,
        keywords=[],
        entities=entity_names,
        relations=[],
        pairings=[],
    )
    saved = hybrid._save_think_memories(
        service,
        workspace_id=workspace_id,
        completed=completed,
        outputs=[output],
        card_run=card_run(run_id),
        pair_reference=hybrid._pair_reference(completed),
    )
    memory_id = str(saved[0]["id"])
    memory = service.store.get_memory(memory_id)
    assert memory is not None
    with service.store._write_operation("test_structured_incidence", commit=True):
        for entity_id in entity_ids:
            service.store.link_memory_entity(
                memory_id=memory_id,
                entity_id=entity_id,
                workspace_id=workspace_id,
                repo_id=None,
                source_kind="structured_extractor",
                confidence=1.0,
                valid_from=memory.valid_from,
                ingested_at=memory.ingested_at,
                provenance={
                    "source": "structured_extractor",
                    "source_kind": "structured_extractor",
                    "memory_id": memory_id,
                },
                commit=False,
            )
    return memory_id


def test_contextual_think_candidates_are_complete_direct_native_incidence(
    hybrid,
    monkeypatch: pytest.MonkeyPatch,
):
    service = hybrid.get_service()
    workspace_id = service.store.get_or_create_workspace("project-one")
    graph = hybrid._apply_accepted_decision(
        service.store,
        source_name="Alpha",
        target_name="Beta",
        workspace_id=workspace_id,
        repo_id=None,
        payload=payload("graph-run"),
        memory_ids=[],
        decision=decision("QUALIFIES"),
        stage="test",
    )
    older = persist_direct_think(
        hybrid,
        workspace_id=workspace_id,
        entity_ids=[graph["source"]],
        entity_names=["Alpha"],
        summary="Older but applicable Alpha constraint.",
        run_id="older-run",
    )
    newer = persist_direct_think(
        hybrid,
        workspace_id=workspace_id,
        entity_ids=[graph["source"]],
        entity_names=["Alpha"],
        summary="Newer Alpha implementation note.",
        run_id="newer-run",
    )
    unrelated = persist_direct_think(
        hybrid,
        workspace_id=workspace_id,
        entity_ids=[graph["target"]],
        entity_names=["Beta"],
        summary="Beta-only note.",
        run_id="other-run",
    )
    original_get_memories = service.store.get_memories

    def with_legacy_grade(memory_ids):
        memories = original_get_memories(memory_ids)
        if older in memories:
            memories[older].metadata["needs_evidence"] = {
                "winner": "NO", "distribution": {"YES": 0.07, "NO": 0.93},
            }
        return memories

    monkeypatch.setattr(service.store, "get_memories", with_legacy_grade)
    candidates = hybrid.list_contextual_think_candidates(
        "project-one", [graph["source"]], service=service,
    )

    assert [candidate["nativeId"] for candidate in candidates] == sorted([older, newer])
    assert unrelated not in {candidate["nativeId"] for candidate in candidates}
    assert all(candidate["incidentEntityIds"] == [graph["source"]] for candidate in candidates)
    assert "needs_evidence" not in json.dumps(candidates)
    assert {candidate["content"] for candidate in candidates} == {
        "Older but applicable Alpha constraint.",
        "Newer Alpha implementation note.",
    }


def test_jev_choice_requires_complete_vocabulary_and_uses_winner_probability():
    assert len(SHARED_JEV_RELATIONSHIPS) == 20
    assert adapter.THINKGRAPH_JEV_CHOICES == SHARED_JEV_RELATIONSHIPS
    assert adapter.THINKGRAPH_CONTROL_OUTCOMES == ()
    probabilities = {name: 0.0 for name in adapter.THINKGRAPH_JEV_CHOICES}
    probabilities.update(CONTRADICTS=0.52, QUALIFIES=0.48)
    parsed = adapter._validate_jev_response({
        "answers": {"relationship": {
            "type": "choice",
            "choice": "CONTRADICTS",
            "confidence": 0.52,
            "probabilities": probabilities,
        }},
        "provider": "TypeSafe",
        "model": "typesafe/jev-1.13-test",
    })
    assert parsed["winner"] == "CONTRADICTS"
    assert parsed["label_confidence"] == pytest.approx(0.52)
    assert parsed["relationship_strength"] == pytest.approx(0.52)
    assert tuple(parsed["distribution"]) == adapter.THINKGRAPH_JEV_CHOICES

    low_winner = {name: 0.05 for name in adapter.THINKGRAPH_JEV_CHOICES}
    low_winner["QUALIFIES"] = 0.06
    low_winner["IS_A"] = 0.04
    normalized = adapter._validate_jev_response({
        "answers": {"relationship": {
            "type": "choice",
            "choice": "QUALIFIES",
            "confidence": 0.41,
            "probabilities": low_winner,
        }}
    })
    assert normalized["relationship_strength"] == pytest.approx(0.06)

    probabilities.pop("ENABLES")
    with pytest.raises(adapter.JevRelationshipError, match="response_invalid"):
        adapter._validate_jev_response({
            "answers": {"relationship": {
                "type": "choice",
                "choice": "CONTRADICTS",
                "probabilities": probabilities,
            }}
        })


def test_native_llm_structured_relation_preserves_custom_meaning_for_jev_normalization():
    from engraphis.backends.extractor import MAX_FACTS

    extractor = adapter._native_structured_extractor(
        adapter._SavedCardStructuredResult({}, "schema-only")
    )
    assert extractor.max_facts == MAX_FACTS
    schema, prompt = adapter._llm_structured_contract("pair", {})
    relation_schema = schema["$defs"]["_RelationSchema"]
    relation = relation_schema["properties"]["relation"]
    assert relation["type"] == "string"
    assert "enum" not in relation
    fact_schema = schema["$defs"]["_ExtractedFactSchema"]
    assert set(fact_schema["properties"]) == {
        "content", "title", "mtype", "importance", "keywords", "entities", "relations",
    }
    assert "think" not in fact_schema["properties"]
    assert "Use native Engraphis structured extraction" in prompt
    assert "Each returned Engraphis fact is one LiquidAIty Think" in prompt
    assert "Preserve each fact's native title, content, memory type, importance" in prompt
    assert "mandatory relationship" not in prompt


def test_empty_provider_result_matches_installed_engraphis_behavior_exactly():
    pair_text = "USER:\nRetain only reusable meaning.\n\nMAIN:\nNo durable change."
    empty = {"facts": []}
    model = "openai/saved-thinkgraph-model-test"
    direct = adapter._native_structured_extractor(
        adapter._SavedCardStructuredResult(empty, model)
    ).extract(pair_text, context="{}")
    through_adapter = adapter._extract_saved_card_facts(
        empty,
        pair_text=pair_text,
        context={},
        card_run=card_run(),
    )

    def comparable(fact):
        return {
            "content": fact.content,
            "title": fact.title,
            "mtype": fact.mtype,
            "importance": fact.importance,
            "keywords": fact.keywords,
            "metadata": fact.metadata,
        }

    assert [comparable(fact) for fact in through_adapter] == [
        comparable(fact) for fact in direct
    ]


def test_four_native_facts_persist_as_four_distinct_thinks_and_replay_exactly_once(
    hybrid,
):
    completed = payload("four-facts")
    prepared = hybrid.prepare_completed_pair(completed)
    output = four_fact_output()
    settled = hybrid.settle_completed_pair(
        settle_payload(prepared, output=output, completed=completed),
        classifier=lambda *_args, **_kwargs: decision("QUALIFIES"),
    )

    memory_ids = settled["thinkMemoryIds"]
    assert settled["factCount"] == 4
    assert len(memory_ids) == len(set(memory_ids)) == 4
    service = hybrid.get_service()
    memories = service.store.get_memories(memory_ids)
    assert list(memories) == memory_ids
    entity_names = {
        entity.id: entity.name for entity in service.store.list_entities()
    }
    expected = output["facts"]
    for index, memory_id in enumerate(memory_ids):
        memory = memories[memory_id]
        fact = expected[index]
        assert memory.content == fact["content"]
        assert memory.title == fact["title"]
        assert memory.mtype == hybrid.MemoryType.EPISODIC
        assert memory.importance == pytest.approx(fact["importance"])
        assert memory.keywords == fact["keywords"]
        assert memory.metadata["thinkgraph_fact"] == {
            "entities": fact["entities"],
            "relations": fact["relations"],
        }
        assert memory.metadata["thinkgraph_origin"]["fact_index"] == index
        assert memory.metadata["thinkgraph_origin"]["fact_count"] == 4
        incidence = service.store.list_memory_entities(memory_ids=[memory_id])
        assert {
            entity_names[str(row["entity_id"])]
            for row in incidence
            if row.get("source_kind") == "structured_extractor"
        } == set(fact["entities"])
        target_id = next(
            entity_id for entity_id, name in entity_names.items()
            if name == fact["entities"][1]
        )
        edge = next(
            edge for edge in service.store.neighbors([target_id])
            if edge.src != edge.dst and edge.provenance.get("jev")
        )
        assert set(hybrid._edge_memory_ids(edge)) == {memory_id}

    recalled = service.recall(
        workspace="project-one",
        query="Rocket Lab Electron launch cadence cash generation Neutron option value",
        k=12,
        token_budget=4_000,
        response_mode="compact",
        record_receipt=False,
        reinforce=False,
    )
    assert set(memory_ids) <= {
        str(item["id"]) for item in recalled.get("memories", [])
    }

    replay = hybrid.settle_completed_pair(
        settle_payload(prepared, output=output, completed=completed),
        classifier=lambda *_args, **_kwargs: pytest.fail(
            "replay must not rerun relationship normalization"
        ),
    )
    assert replay["status"] == "duplicate_noop"
    assert replay["thinkMemoryIds"] == memory_ids
    assert service.store.count_memories() == 4


def test_failure_after_native_batch_rolls_back_every_think_and_relationship(
    hybrid, monkeypatch: pytest.MonkeyPatch,
):
    completed = payload("four-fact-rollback")
    prepared = hybrid.prepare_completed_pair(completed)
    service = hybrid.get_service()

    def fail_after_batch(*_args, **_kwargs):
        assert service.store.count_memories() == 4
        return {"failures": [{"error": "forced_relationship_failure"}]}

    monkeypatch.setattr(hybrid, "_persist_opportunity_decisions", fail_after_batch)
    with pytest.raises(
        hybrid.ThinkGraphIntakeError,
        match="thinkgraph_relationship_settlement_failed",
    ):
        hybrid.settle_completed_pair(
            settle_payload(
                prepared,
                output=four_fact_output(),
                completed=completed,
            ),
            classifier=lambda *_args, **_kwargs: decision("QUALIFIES"),
        )

    assert service.store.count_memories() == 0
    assert entities_and_edges(hybrid) == ([], [])


@pytest.mark.parametrize(
    "legacy_label",
    [
        "ASSUMES", "QUESTIONS", "PREDICTS", "IMPLIES", "REFINES", "CORRECTS",
        "MOTIVATES", "GENERALIZES", "SPECIALIZES",
    ],
)
def test_non_seed_labels_require_a_real_dynamic_choice_option(legacy_label):
    probabilities = {name: 0.0 for name in adapter.THINKGRAPH_JEV_CHOICES}
    probabilities["QUALIFIES"] = 1.0
    with pytest.raises(adapter.JevRelationshipError, match="response_invalid"):
        adapter._validate_jev_response({
            "answers": {"relationship": {
                "type": "choice",
                "choice": legacy_label,
                "probabilities": probabilities,
            }},
        })
    choices = (*SHARED_JEV_RELATIONSHIPS, legacy_label, *adapter.THINKGRAPH_CONTROL_OUTCOMES)
    dynamic_probabilities = {name: 0.0 for name in choices}
    dynamic_probabilities[legacy_label] = 1.0
    dynamic = adapter._validate_jev_response({
        "answers": {"relationship": {
            "type": "choice",
            "choice": legacy_label,
            "confidence": 1.0,
            "probabilities": dynamic_probabilities,
        }},
    }, choices)
    assert dynamic["winner"] == legacy_label


def test_prepare_is_nonpersistent_without_regex_jev_or_graph_mutation(hybrid):
    prepared = hybrid.prepare_completed_pair(payload())
    assert prepared["pairReference"].startswith("pair_")
    assert prepared["intakeOperation"] == "pending"
    assert prepared["structuredExtractionRequired"] is True
    assert prepared["revisionChanged"] is False
    assert prepared["preparation"] == {
        "status": "completed_without_graph_mutation",
    }
    assert set(prepared["enrichmentInput"]) == {
        "exact_user_message", "exact_main_response", "canonical_subject_directory",
        "current_project_relationship_vocabulary",
    }
    assert prepared["enrichmentInput"][
        "current_project_relationship_vocabulary"
    ] == list(SHARED_JEV_RELATIONSHIPS)
    assert prepared["relationshipVocabulary"] == {
        "version": adapter.PROJECT_RELATIONSHIP_VOCABULARY_VERSION,
        "hash": adapter.relationship_vocabulary_hash(
            SHARED_JEV_RELATIONSHIPS
        ),
        "labels": list(SHARED_JEV_RELATIONSHIPS),
        "count": 20,
        "maximum": 252,
        "atMaximum": False,
    }
    entities, edges = entities_and_edges(hybrid)
    assert entities == []
    assert edges == []
    assert hybrid.get_service().store.conn.execute(
        "SELECT COUNT(*) FROM memories"
    ).fetchone()[0] == 0


def test_completed_pair_extractor_and_saved_semantics_exclude_runtime_sentinels(
    hybrid,
):
    visible_user = "VISIBLE_USER_BYTES_SENTINEL asks about Jev."
    visible_main = "VISIBLE_MAIN_BYTES_SENTINEL answers only that question."
    completed = payload("runtime-sentinel-source-run")
    completed.update({
        "userMessage": visible_user,
        "mainResponse": visible_main,
        "sourceResponseFit": {
            **scored_source_response_fit("runtime-sentinel-source-run"),
            "actualProvider": "SOURCE_PROVIDER_SENTINEL",
            "actualModel": "SOURCE_MODEL_SENTINEL",
            "requestedModel": "ASSESSMENT_REQUESTED_MODEL_SENTINEL",
            "provider": "ASSESSMENT_PROVIDER_SENTINEL",
            "resolvedModel": "ASSESSMENT_RESOLVED_MODEL_SENTINEL",
            "decisionId": "ASSESSMENT_DECISION_SENTINEL",
            "usage": {
                "providerInputTokens": 101,
                "providerOutputTokens": 17,
                "totalCostUsd": 0.123,
                "source": "RUNTIME_USAGE_COST_TOKEN_SENTINEL",
            },
        },
    })
    excluded_runtime_sentinels = {
        "SOURCE_PROVIDER_SENTINEL",
        "SOURCE_MODEL_SENTINEL",
        "ASSESSMENT_REQUESTED_MODEL_SENTINEL",
        "ASSESSMENT_PROVIDER_SENTINEL",
        "ASSESSMENT_RESOLVED_MODEL_SENTINEL",
        "ASSESSMENT_DECISION_SENTINEL",
        "RUNTIME_USAGE_COST_TOKEN_SENTINEL",
    }

    prepared = hybrid.prepare_completed_pair(completed)
    exact_extractor_input = json.dumps({
        "schema": prepared["enrichmentSchema"],
        "prompt": prepared["enrichmentPrompt"],
        "input": prepared["enrichmentInput"],
    }, ensure_ascii=False, sort_keys=True)

    assert visible_user in exact_extractor_input
    assert visible_main in exact_extractor_input
    assert "canonical_subject_directory" in exact_extractor_input
    assert "know-jev" in exact_extractor_input
    assert "THINKGRAPH" in exact_extractor_input
    assert not any(
        sentinel in exact_extractor_input
        for sentinel in excluded_runtime_sentinels
    )

    combined_visible = f"{visible_user}\n\n{visible_main}"
    output = structured_output(content=combined_visible)
    output["facts"][0].update({
        "title": "Current pair only",
        "keywords": ["Jev"],
        "entities": ["Jev", "ThinkGraph"],
        "relations": [{
            "source": "Jev",
            "relation": FREEFORM_RELATION,
            "target": "ThinkGraph",
        }],
        "importance": 0.81,
    })
    authorized_card_run = {
        "runId": "AUTHORIZED_RUN_ID_SENTINEL",
        "cardId": "AUTHORIZED_CARD_ID_SENTINEL",
        "revisionId": "AUTHORIZED_REVISION_ID_SENTINEL",
        "profile": "AUTHORIZED_PROFILE_SENTINEL",
        "nativeSessionRef": "AUTHORIZED_SESSION_SENTINEL",
        "resolvedModel": "AUTHORIZED_MODEL_SENTINEL",
    }
    settled = hybrid.settle_completed_pair({
        **completed,
        "pairReference": prepared["pairReference"],
        "structuredOutput": output,
        "cardRun": authorized_card_run,
    }, classifier=lambda *_args, **_kwargs: decision("QUALIFIES"))
    memory = hybrid.get_service().store.get_memory(only_think_id(settled))
    assert memory is not None
    saved_semantics = json.dumps({
        "summary": memory.content,
        "title": memory.title,
        "keywords": memory.keywords,
        "thinkgraph_fact": memory.metadata["thinkgraph_fact"],
    }, ensure_ascii=False, sort_keys=True)

    assert visible_user in saved_semantics
    assert visible_main in saved_semantics
    assert "source_response_fit" not in memory.metadata
    assert memory.importance == pytest.approx(0.81)
    assert not any(
        sentinel in saved_semantics
        for sentinel in excluded_runtime_sentinels
    )
    assert not any(
        value in saved_semantics
        for value in authorized_card_run.values()
    )
    assert memory.metadata["thinkgraph_origin"] == {
        "authority": "thinkgraph",
        "writer": "saved_thinkgraph_card",
        "card_id": authorized_card_run["cardId"],
        "card_revision_id": authorized_card_run["revisionId"],
        "run_id": authorized_card_run["runId"],
        "profile": authorized_card_run["profile"],
        "native_session_ref": authorized_card_run["nativeSessionRef"],
        "resolved_model": authorized_card_run["resolvedModel"],
        "completed_pair_reference": prepared["pairReference"],
        "fact_index": 0,
        "fact_count": 1,
        "fact_key": memory.metadata["thinkgraph_origin"]["fact_key"],
        "source_pair": hybrid._source_pair(completed),
    }


@pytest.mark.parametrize(
    ("proposal", "status", "candidate"),
    [
        (" affects ", "reused_canonical", ""),
        ("co evolves with", "novel_candidate", "CO_EVOLVES_WITH"),
        ("improves relative future value", "invalid_novel_label", ""),
    ],
)
def test_relationship_choice_plan_offers_at_most_one_short_novel_candidate(
    proposal, status, candidate,
):
    plan = adapter.relationship_choice_plan(
        proposal,
        SHARED_JEV_RELATIONSHIPS,
    )

    assert plan["proposal_status"] == status
    assert plan["novel_candidate"] == candidate
    assert plan["choices"][:20] == SHARED_JEV_RELATIONSHIPS
    if candidate:
        assert plan["choices"].count(candidate) == 1
        assert plan["choices"][-1] == candidate


def test_jev_winning_novel_relation_is_promoted_once_and_survives_restart(
    hybrid,
):
    completed = payload("novel-winner")
    prepared = hybrid.prepare_completed_pair(completed)
    output = structured_output(content="Jev amplification sharpens ThinkGraph semantics.")
    output["facts"][0]["relations"][0]["relation"] = "amplifies"

    def choose_novel(
        *_args,
        relationship_vocabulary,
        novel_relationship_candidate,
        relationship_proposal_status,
    ):
        assert relationship_vocabulary == SHARED_JEV_RELATIONSHIPS
        assert novel_relationship_candidate == "AMPLIFIES"
        assert relationship_proposal_status == "novel_candidate"
        choices = (
            *relationship_vocabulary,
            novel_relationship_candidate,
            *adapter.THINKGRAPH_CONTROL_OUTCOMES,
        )
        return decision(
            "AMPLIFIES",
            choices=choices,
            novel_candidate=novel_relationship_candidate,
            proposal_status=relationship_proposal_status,
        )

    settled = hybrid.settle_completed_pair(
        settle_payload(prepared, output=output, completed=completed),
        classifier=choose_novel,
    )

    assert settled["failures"] == []
    assert settled["relationshipVocabulary"]["added"] == ["AMPLIFIES"]
    assert settled["relationshipVocabulary"]["before"]["count"] == 20
    assert settled["relationshipVocabulary"]["after"]["count"] == 21
    assert settled["relationships"][0]["winner"] == "AMPLIFIES"
    assert settled["relationships"][0]["vocabulary_promotion"] == "promoted"

    from app.python_models import knowgraph_jev

    captured: dict[str, Any] = {}

    def know_transport(body: dict[str, Any]) -> dict[str, Any]:
        captured.update(body)
        choices = tuple(body["questions"]["relationship"]["criteria"])
        probabilities = {name: 0.0 for name in choices}
        probabilities["AMPLIFIES"] = 1.0
        return {
            "provider": "test-provider",
            "model": "typesafe/jev-1.13-test",
            "answers": {"relationship": {
                "type": "choice",
                "choice": "AMPLIFIES",
                "confidence": 0.64,
                "probabilities": probabilities,
            }},
        }

    vocabulary = tuple(
        hybrid.read_project_relationship_vocabulary("project-one")["labels"]
    )
    know_result = knowgraph_jev.classify_knowgraph_fact({
        "nativeFactUuid": "fact-amplifies",
        "sourceEntity": {"uuid": "entity-a", "name": "Jev"},
        "targetEntity": {"uuid": "entity-b", "name": "ThinkGraph"},
        "nativeRelation": "AMPLIFIES",
        "fact": "Jev amplification sharpens ThinkGraph semantics.",
        "supportingEpisodes": [],
    }, relationship_vocabulary=vocabulary, transport=know_transport)
    assert know_result["winner"] == "AMPLIFIES"
    assert know_result["relationship_proposal_status"] == "reused_canonical"
    assert "optional_novel_relationship_candidate" not in captured["state"]

    hybrid.close_engine()
    reopened = hybrid.read_project_relationship_vocabulary("project-one")
    assert reopened["labels"].count("AMPLIFIES") == 1
    assert reopened["count"] == 21

    later = payload("after-restart")
    later.update({
        "userMessage": "The next completed pair reuses the promoted predicate.",
        "mainResponse": "The shared vocabulary is loaded before extraction.",
    })
    later_preparation = hybrid.prepare_completed_pair(later)
    assert later_preparation["enrichmentInput"][
        "current_project_relationship_vocabulary"
    ][-1] == "AMPLIFIES"


def test_novel_proposal_does_not_expand_vocabulary_unless_it_wins(
    hybrid,
):
    completed = payload("novel-normalizes-to-existing")
    prepared = hybrid.prepare_completed_pair(completed)
    output = structured_output(content="A proposed relationship may lose Jev Choice.")
    output["facts"][0]["relations"][0]["relation"] = "amplifies"

    def choose_existing(
        *_args,
        relationship_vocabulary,
        novel_relationship_candidate,
        relationship_proposal_status,
    ):
        choices = (
            *relationship_vocabulary,
            novel_relationship_candidate,
            *adapter.THINKGRAPH_CONTROL_OUTCOMES,
        )
        return decision(
            "QUALIFIES",
            choices=choices,
            novel_candidate=novel_relationship_candidate,
            proposal_status=relationship_proposal_status,
        )

    settled = hybrid.settle_completed_pair(
        settle_payload(prepared, output=output, completed=completed),
        classifier=choose_existing,
    )

    assert settled["relationshipVocabulary"]["added"] == []
    assert settled["relationshipVocabulary"]["after"]["labels"] == list(
        SHARED_JEV_RELATIONSHIPS
    )
    assert "AMPLIFIES" not in hybrid.read_project_relationship_vocabulary(
        "project-one"
    )["labels"]


def test_project_relationship_vocabulary_preserves_shared_capacity(hybrid):
    service = hybrid.get_service()
    workspace_id = service.store.get_or_create_workspace("project-one")
    with service.store._write_operation(
        "test_relationship_vocabulary_ceiling", commit=True,
    ):
        for index in range(232):
            hybrid._promote_project_relationship_label(
                service.store,
                workspace_id=workspace_id,
                label=f"REL_{index:03d}",
            )

    vocabulary = tuple(
        hybrid.read_project_relationship_vocabulary("project-one")["labels"]
    )
    assert len(vocabulary) == 252
    plan = hybrid.relationship_choice_plan("over performs", vocabulary)
    assert plan["proposal_status"] == "novel_blocked_at_ceiling"
    assert plan["novel_candidate"] == ""
    assert "OVER_PERFORMS" not in plan["choices"]
    assert len(plan["choices"]) == 252
    reused, promoted = hybrid._promote_project_relationship_label(
        service.store,
        workspace_id=workspace_id,
        label=vocabulary[-1],
    )
    assert promoted is False
    assert reused == vocabulary
    with pytest.raises(
        hybrid.ThinkGraphIntakeError,
        match="thinkgraph_relationship_vocabulary_ceiling",
    ):
        hybrid.promote_project_relationship_label(
            "project-one", "OVER_PERFORMS",
        )


def test_relationship_choice_capacity_supports_251_plus_novel_and_252_reuse():
    vocabulary_251 = (
        *SHARED_JEV_RELATIONSHIPS,
        *(f"REL_{index:03d}" for index in range(231)),
    )
    novel = adapter.relationship_choice_plan("amplifies", vocabulary_251)
    assert len(vocabulary_251) == 251
    assert novel["novel_candidate"] == "AMPLIFIES"
    assert len(novel["choices"]) == 252

    vocabulary_252 = (*vocabulary_251, "AMPLIFIES")
    reused = adapter.relationship_choice_plan("amplifies", vocabulary_252)
    assert reused["proposal_status"] == "reused_canonical"
    assert reused["novel_candidate"] == ""
    assert len(reused["choices"]) == 252


def test_oversized_legacy_vocabulary_is_normalized_by_thinkgraph_but_not_knowgraph(hybrid):
    from app.python_models import knowgraph_jev

    service = hybrid.get_service()
    workspace_id = service.store.get_or_create_workspace("project-one")
    legacy_labels = [f"REL_{index:03d}" for index in range(235)]
    settings = hybrid._workspace_settings(service.store, workspace_id)
    settings[hybrid._PROJECT_RELATIONSHIP_VOCABULARY_SETTING] = {
        "version": hybrid.PROJECT_RELATIONSHIP_VOCABULARY_VERSION,
        "labels": legacy_labels,
    }
    with service.store._write_operation("test_legacy_vocabulary", commit=True):
        service.store.conn.execute(
            "UPDATE workspaces SET settings=? WHERE id=?",
            (json.dumps(settings), workspace_id),
        )

    state = hybrid.read_project_relationship_vocabulary("project-one")
    vocabulary = tuple(state["labels"])
    assert state["count"] == 255
    assert state["atMaximum"] is True

    called = False

    def classifier(*_args, **_kwargs):
        nonlocal called
        called = True
        return decision()

    think_results = hybrid._classify_opportunities(
        service.store,
        workspace_id=workspace_id,
        payload=payload("legacy-capacity"),
        opportunities=[{
            "id": "legacy-pair",
            "source": {"name": "Alpha", "type": "person_or_concept"},
            "target": {"name": "Beta", "type": "person_or_concept"},
            "native_relation": "AFFECTS",
            "native_weight": 0.0,
            "provenance": {},
        }],
        classifier=classifier,
        relationship_vocabulary=vocabulary,
    )
    assert called is True
    assert think_results[0]["status"] == "decided"
    assert think_results[0]["decision"]["winner"] == "QUALIFIES"

    know_results = knowgraph_jev.classify_knowgraph_facts(
        [{
            "nativeFactUuid": "legacy-fact",
            "sourceEntity": {"uuid": "a", "name": "Alpha"},
            "targetEntity": {"uuid": "b", "name": "Beta"},
            "nativeRelation": "AFFECTS",
            "fact": "Alpha affects Beta.",
        }],
        relationship_vocabulary=vocabulary,
    )
    assert know_results[0]["status"] == "error"
    assert know_results[0]["failure_reason"] == (
        "thinkgraph_relationship_choice_capacity_exceeded"
    )


def test_novel_vocabulary_promotion_rolls_back_with_failed_edge_write(
    hybrid, monkeypatch: pytest.MonkeyPatch,
):
    service = hybrid.get_service()
    workspace_id = service.store.get_or_create_workspace("project-one")
    choices = (
        *SHARED_JEV_RELATIONSHIPS,
        "AMPLIFIES",
        *hybrid.THINKGRAPH_CONTROL_OUTCOMES,
    )
    novel_decision = decision(
        "AMPLIFIES",
        choices=choices,
        novel_candidate="AMPLIFIES",
        proposal_status="novel_candidate",
    )

    def fail_edge(*_args, **_kwargs):
        raise RuntimeError("edge_write_failed")

    monkeypatch.setattr(service.store, "upsert_edge", fail_edge)
    with pytest.raises(RuntimeError, match="edge_write_failed"):
        hybrid._apply_accepted_decision(
            service.store,
            source_name="Alpha",
            target_name="Beta",
            workspace_id=workspace_id,
            repo_id=None,
            payload=payload("rollback"),
            memory_ids=[],
            decision=novel_decision,
            stage="test",
        )

    assert hybrid.read_project_relationship_vocabulary(
        "project-one"
    )["labels"] == list(SHARED_JEV_RELATIONSHIPS)
    assert service.store.list_entities() == []


def test_knowgraph_jev_winner_is_visible_to_next_thinkgraph_card(
    hybrid, monkeypatch: pytest.MonkeyPatch,
):
    from app import main as python_main
    from app.python_models import knowgraph_jev

    def classify_facts(facts, *, relationship_vocabulary):
        assert relationship_vocabulary == SHARED_JEV_RELATIONSHIPS
        assert facts[0]["nativeRelation"] == "undermines"
        return [{
            "nativeFactUuid": "fact-under",
            "status": "success",
            "winner": "UNDERMINES",
            "novel_relationship_candidate": "UNDERMINES",
        }]

    monkeypatch.setattr(
        knowgraph_jev,
        "classify_knowgraph_facts",
        classify_facts,
    )
    response = asyncio.run(python_main.knowgraph_jev_classify({
        "projectId": "project-one",
        "facts": [{
            "nativeFactUuid": "fact-under",
            "sourceEntity": {"uuid": "a", "name": "Risk"},
            "targetEntity": {"uuid": "b", "name": "Thesis"},
            "nativeRelation": "undermines",
            "fact": "Risk undermines the thesis.",
        }],
    }))

    assert response["results"][0]["vocabulary_promotion"] == "promoted"
    assert response["relationshipVocabulary"]["added"] == ["UNDERMINES"]
    next_pair = payload("know-to-think")
    next_pair.update({
        "userMessage": "Reuse a KnowGraph-discovered project predicate.",
        "mainResponse": "The next ThinkGraph Card receives the same list.",
    })
    prepared = hybrid.prepare_completed_pair(next_pair)
    assert prepared["enrichmentInput"][
        "current_project_relationship_vocabulary"
    ][-1] == "UNDERMINES"


def test_native_engraphis_noop_skips_repeat_after_authoritative_think_exists(hybrid):
    first = hybrid.prepare_completed_pair(payload())
    settled = hybrid.settle_completed_pair(
        settle_payload(first),
        classifier=lambda *_args, **_kwargs: decision("QUALIFIES"),
    )
    repeated = hybrid.prepare_completed_pair(payload())

    assert first["intakeOperation"] == "pending"
    assert first["structuredExtractionRequired"] is True
    assert repeated["ok"] is True
    assert repeated["projectId"] == "project-one"
    assert repeated["thinkMemoryIds"] == settled["thinkMemoryIds"]
    assert repeated["pairReference"] == first["pairReference"]
    assert repeated["intakeOperation"] == "noop"
    assert repeated["structuredExtractionRequired"] is False
    assert repeated["preparation"] == {"status": "duplicate_noop"}


def test_jev_pair_calls_use_native_order_with_at_most_four_in_flight(hybrid):
    service = hybrid.get_service()
    workspace_id = service.store.get_or_create_workspace("project-one")
    opportunities = [{
        "id": f"pair-{index}",
        "source": {"name": f"Source {index}", "type": "person_or_concept"},
        "target": {"name": f"Target {index}", "type": "person_or_concept"},
        "native_relation": "related",
        "native_weight": 0.0,
        "provenance": {},
    } for index in range(9)]
    lock = threading.Lock()
    active = 0
    peak = 0

    def classify(source: str, *_args, **_kwargs) -> dict[str, Any]:
        nonlocal active, peak
        with lock:
            active += 1
            peak = max(peak, active)
        try:
            time.sleep(0.02)
            result = decision("QUALIFIES")
            result["source_seen"] = source
            return result
        finally:
            with lock:
                active -= 1

    results = hybrid._classify_opportunities(
        service.store,
        workspace_id=workspace_id,
        payload=payload(),
        opportunities=opportunities,
        classifier=classify,
    )

    assert 1 < peak <= hybrid.MAX_JEV_CONCURRENCY == 4
    assert [item["decision"]["source_seen"] for item in results] == [
        f"Source {index}" for index in range(9)
    ]


def test_jev_context_contains_only_latest_endpoint_think_and_direct_edges(hybrid):
    service = hybrid.get_service()
    workspace_id = service.store.get_or_create_workspace("project-one")
    first = hybrid._apply_accepted_decision(
        service.store,
        source_name="Alpha",
        target_name="Beta",
        workspace_id=workspace_id,
        repo_id=None,
        payload=payload(),
        memory_ids=[],
        decision=decision("QUALIFIES"),
        stage="test",
    )
    second = hybrid._apply_accepted_decision(
        service.store,
        source_id=first["target"],
        source_name="Beta",
        target_name="Gamma",
        workspace_id=workspace_id,
        repo_id=None,
        payload=payload("run-two"),
        memory_ids=[],
        decision=decision("ENABLES"),
        stage="test",
    )
    third = hybrid._apply_accepted_decision(
        service.store,
        source_id=second["target"],
        source_name="Gamma",
        target_name="Delta",
        workspace_id=workspace_id,
        repo_id=None,
        payload=payload("run-three"),
        memory_ids=[],
        decision=decision("DEPENDS_ON"),
        stage="test",
    )
    older = persist_direct_think(
        hybrid,
        workspace_id=workspace_id,
        entity_ids=[first["source"]],
        entity_names=["Alpha"],
        summary="Alpha prior Think one.",
        run_id="prior-one",
    )
    newer = persist_direct_think(
        hybrid,
        workspace_id=workspace_id,
        entity_ids=[first["source"]],
        entity_names=["Alpha"],
        summary="Alpha latest prior Think.",
        run_id="prior-two",
        title="Latest Alpha constraint",
    )
    service.store.conn.execute(
        "UPDATE memories SET ingested_at=? WHERE id=?", (100.0, older),
    )
    service.store.conn.execute(
        "UPDATE memories SET ingested_at=? WHERE id=?", (200.0, newer),
    )
    service.store.conn.commit()

    snapshot = hybrid._bounded_relationship_context(
        service.store,
        workspace_id=workspace_id,
        source_id=first["source"],
        target_id=first["target"],
        source_name="Alpha",
        target_name="Beta",
    )

    assert {item["id"] for item in snapshot["nodes"]} == {
        first["source"], first["target"], second["target"],
    }
    assert {item["id"] for item in snapshot["incident_edges"]} == {
        first["edge_id"], second["edge_id"],
    }
    assert third["target"] not in {item["id"] for item in snapshot["nodes"]}
    assert "notes" not in snapshot
    assert [item["memory_id"] for item in snapshot["latest_prior_thinks"]] == [
        newer,
    ]
    assert snapshot["latest_prior_thinks"][0]["endpoint"] == "A"
    assert snapshot["latest_prior_thinks"][0]["title"] == "Latest Alpha constraint"
    assert snapshot["latest_prior_thinks"][0]["content"] == (
        "Alpha latest prior Think."
    )


def test_structured_proposal_reuses_canonical_node_and_freezes_prior_think(
    hybrid, monkeypatch: pytest.MonkeyPatch,
):
    service = hybrid.get_service()
    workspace_id = service.store.get_or_create_workspace("project-one")
    prior = hybrid._apply_accepted_decision(
        service.store,
        source_name="Alpha",
        target_name="Prior Context",
        workspace_id=workspace_id,
        repo_id=None,
        payload=payload("seed-run"),
        memory_ids=[],
        decision=decision("QUALIFIES"),
        stage="test",
    )
    prior_think_id = persist_direct_think(
        hybrid,
        workspace_id=workspace_id,
        entity_ids=[prior["source"]],
        entity_names=["Alpha"],
        summary="Alpha already has durable project context.",
        run_id="seed-think-run",
    )
    calls: list[dict[str, Any]] = []

    def classify(
        source, target, _payload, _fact, context, proposal, **_kwargs,
    ):
        calls.append({
            "source": source,
            "target": target,
            "context": context,
            "proposal": proposal,
        })
        return decision("QUALIFIES")

    completed = payload("active-target-run")
    completed.update({
        "completedAt": "2026-09-23T12:02:00Z",
        "userMessage": "Alpha now supplies a bounded input to Beta.",
        "mainResponse": "Beta uses that input for the current project decision.",
    })
    graph_before = hybrid._graph_revision(service.store, workspace_id)
    prepared = hybrid.prepare_completed_pair(completed)
    assert prepared["revision"] == graph_before
    assert prepared["revisionChanged"] is False
    enrichment = prepared["enrichmentInput"]
    assert set(enrichment) == {
        "exact_user_message",
        "exact_main_response",
        "canonical_subject_directory",
        "current_project_relationship_vocabulary",
    }
    assert "Alpha already has durable project context." not in prepared["enrichmentPrompt"]
    directory = enrichment["canonical_subject_directory"]
    assert directory["complete"] is True
    assert {node["canonicalName"] for node in directory["subjects"]} == {
        "Alpha", "Prior Context", "Jev",
    }
    assert all(set(node) == {
        "authority", "nativeId", "canonicalName", "entityKind",
    } for node in directory["subjects"])
    assert directory["counts"] == {"ThinkGraph": 2, "KnowGraph": 1, "total": 3}
    assert "canonical_subject_directory" in prepared["enrichmentPrompt"]
    assert "existingNotes" not in prepared["enrichmentPrompt"]
    assert prior_think_id not in prepared["enrichmentPrompt"]

    output = structured_output(content="Alpha now supplies a bounded input to Beta.")
    output["facts"][0]["entities"] = ["Alpha", "Beta"]
    output["facts"][0]["relations"] = [{
        "source": "Alpha",
        "relation": "supplies a bounded current input to",
        "target": "Beta",
    }]
    original_latest = hybrid._latest_endpoint_think
    original_save = hybrid._save_think_memories
    current_think_written = False

    def latest_before_write(*args, **kwargs):
        assert current_think_written is False
        return original_latest(*args, **kwargs)

    def mark_current_write(*args, **kwargs):
        nonlocal current_think_written
        current_think_written = True
        return original_save(*args, **kwargs)

    monkeypatch.setattr(hybrid, "_latest_endpoint_think", latest_before_write)
    monkeypatch.setattr(hybrid, "_save_think_memories", mark_current_write)
    settled = hybrid.settle_completed_pair(
        settle_payload(prepared, output=output, completed=completed),
        classifier=classify,
    )

    entities = service.store.list_entities()
    assert sum(entity.name == "Alpha" for entity in entities) == 1
    assert sum(entity.name == "Beta" for entity in entities) == 1
    beta_id = next(entity.id for entity in entities if entity.name == "Beta")
    beta_read = hybrid.inspect("project-one", beta_id)["entity"]
    assert any(
        "Alpha now supplies" in str(item.get("excerpt") or "")
        for item in beta_read["evidence"]
    )
    assert len(calls) == 1
    settled_call = calls[0]
    assert [
        item["memory_id"]
        for item in settled_call["context"]["latest_prior_thinks"]
    ] == [prior_think_id]
    assert not any(item["target"] == "Prior Context" for item in calls)
    assert prior["edge_id"] in {
        edge.id for edge in service.store.neighbors([prior["source"]])
        if edge.provenance.get("jev")
    }
    projected = hybrid.projection("project-one")
    assert projected["canonicalSubjectDirectory"]["complete"] is True
    assert projected["canonicalSubjectDirectory"]["projectId"] == "project-one"
    assert {item["canonicalName"] for item in projected["nodes"]} == {
        "Alpha", "Beta", "Prior Context",
    }
    assert all(item["entityKind"] == item["type"] for item in projected["nodes"])


def test_saved_card_freeform_proposal_becomes_think_context_and_jev_edge(hybrid):
    calls: list[dict[str, Any]] = []

    def classify(
        source: str,
        target: str,
        source_payload: dict,
        supporting_fact: str,
        graph_context: dict,
        relationship_proposal: str,
        **_kwargs,
    ) -> dict:
        calls.append({
            "source": source,
            "target": target,
            "runId": source_payload["runId"],
            "supporting_fact": supporting_fact,
            "graph_context": graph_context,
            "relationship_proposal": relationship_proposal,
        })
        return decision("QUALIFIES")

    prepared = hybrid.prepare_completed_pair(payload())
    settled = hybrid.settle_completed_pair(
        settle_payload(prepared), classifier=classify,
    )

    assert prepared["ok"] is True
    assert prepared["revisionChanged"] is False
    assert settled["ok"] is True
    assert not settled["failures"], settled["failures"]
    proposal_call = next(
        item for item in calls if item["relationship_proposal"] == FREEFORM_RELATION
    )
    assert proposal_call["source"] == "Jev"
    assert proposal_call["target"] == "ThinkGraph"
    assert proposal_call["supporting_fact"] == "Jev normalizes expressive graph relations."
    assert {"nodes", "latest_prior_thinks", "incident_edges"}.issubset(
        proposal_call["graph_context"]
    )

    service = hybrid.get_service()
    entities = service.store.list_entities()
    assert sum(node.name == "Jev" for node in entities) == 1
    assert sum(node.name == "ThinkGraph" for node in entities) == 1
    jev = next(node for node in entities if node.name == "Jev")
    thinkgraph = next(node for node in entities if node.name == "ThinkGraph")
    edge = next(
        edge for edge in service.store.neighbors([jev.id, thinkgraph.id])
        if edge.src == jev.id and edge.dst == thinkgraph.id
        and edge.provenance.get("jev")
    )
    assert edge.relation == "QUALIFIES"
    assert edge.relation != FREEFORM_RELATION
    assert edge.weight == pytest.approx(0.76)
    assert edge.provenance["jev"]["distribution"]["QUALIFIES"] == pytest.approx(0.76)
    assert edge.provenance["jev"]["vocabulary_version"] == (
        adapter.PROJECT_RELATIONSHIP_VOCABULARY_VERSION
    )

    think_memory_id = only_think_id(settled)
    think = service.store.get_memory(think_memory_id)
    assert think is not None
    assert think.mtype == hybrid.MemoryType.EPISODIC
    assert think.metadata["thinkgraph_fact"]["relations"][0]["relation"] == (
        FREEFORM_RELATION
    )
    assert think.content == "Jev normalizes expressive graph relations."
    assert think.title == "Expressive relation normalization"
    assert think.importance == pytest.approx(0.63)
    assert think.keywords == ["probability", "graph semantics"]
    assert think.metadata["thinkgraph_origin"] == {
        "authority": "thinkgraph",
        "writer": "saved_thinkgraph_card",
        "card_id": "card_thinkgraph",
        "card_revision_id": "revision-one",
        "run_id": "thinkgraph-run-one",
        "profile": "thinkgraph",
        "native_session_ref": "thinkgraph-session-one",
        "resolved_model": "openai/saved-thinkgraph-model-test",
        "completed_pair_reference": prepared["pairReference"],
        "fact_index": 0,
        "fact_count": 1,
        "fact_key": think.metadata["thinkgraph_origin"]["fact_key"],
        "source_pair": hybrid._source_pair(payload()),
    }
    assert "source_reference" not in think.metadata
    native_read = hybrid.inspect("project-one", jev.id)["entity"]
    direct_think = next(
        item for item in native_read["evidence"]
        if item["memory_id"] == think_memory_id
    )
    assert direct_think["excerpt"] == "Jev normalizes expressive graph relations."
    assert direct_think["metadata"]["thinkgraph_fact"]["relations"][0][
        "relation"
    ] == FREEFORM_RELATION

    graph = hybrid.projection("project-one")
    projected = next(
        item for item in graph["scene"]["edges"]
        if edge.id in item.get("underlying_edge_ids", [])
    )
    assert projected["relationship_strength"] == pytest.approx(0.76)
    assert projected["label_confidence"] == pytest.approx(0.76)
    assert projected["label"] == "QUALIFIES · .76"
    assert projected["label_min_scale"] == pytest.approx(0.35)
    assert projected["directional_arrow_length"] == pytest.approx(3.0)
    assert projected["directional_arrow_rel_pos"] == pytest.approx(0.9)
    assert projected["jev"]["natural_relationship"] == FREEFORM_RELATION
    assert projected["spring_strength"] == pytest.approx(0.1642)
    assert projected["rest_length"] == pytest.approx(16.88)
    projected_node = next(
        item for item in graph["scene"]["nodes"]
        if jev.id in item.get("member_ids", [item["id"]])
    )
    assert projected_node["semantic_mass"] > 0
    assert projected_node["gravity_mass"] > 1


def test_thinks_use_native_time_and_are_newest_first(hybrid):
    def classify(*args, **_kwargs):
        return decision("QUALIFIES")

    first_prepared = hybrid.prepare_completed_pair(payload())
    first = hybrid.settle_completed_pair(
        settle_payload(first_prepared), classifier=classify,
    )
    later = payload("run-two")
    later.update({
        "completedAt": "2026-09-23T12:05:00Z",
        "userMessage": "Revisit Jev and ThinkGraph in a later exchange.",
        "mainResponse": "Record the later temporal Think without rewriting history.",
    })
    second_prepared = hybrid.prepare_completed_pair(later)
    second_output = structured_output(content="A later self-contained Think.")
    second = hybrid.settle_completed_pair(
        settle_payload(second_prepared, output=second_output, completed=later),
        classifier=classify,
    )
    service = hybrid.get_service()
    jev = next(node for node in service.store.list_entities() if node.name == "Jev")
    workspace_id = service.store.get_or_create_workspace("project-one")
    direct_think_ids = [only_think_id(first), only_think_id(second)]
    for sequence, memory_id in enumerate(direct_think_ids, start=1):
        service.store.conn.execute(
            "UPDATE memories SET ingested_at=? WHERE id=?",
            (float(sequence * 100), memory_id),
        )
    service.store.conn.commit()
    newest_id = direct_think_ids[-1]

    # A newer episodic Memory that merely mentions Jev is still not Jev's direct
    # temporal Think. This reproduces the real Rocket Lab/Neutron failure.
    mention_only = service.engine.remember_with_resolution(
        "Jev appears only as a literal mention in this unrelated episode.",
        workspace_id=workspace_id,
        mtype=hybrid.MemoryType.EPISODIC,
        scope=hybrid.Scope.WORKSPACE,
        resolve_conflicts=False,
    )
    mention_only_id = str(mention_only["id"])
    service.store.link_memory_entity(
        memory_id=mention_only_id,
        entity_id=jev.id,
        workspace_id=workspace_id,
        repo_id=None,
        source_kind="text_mention",
        confidence=1.0,
        provenance={"source": "test_exact_mention"},
    )
    service.store.conn.execute(
        "UPDATE memories SET ingested_at=? WHERE id=?",
        (10_000.0, mention_only_id),
    )
    service.store.conn.commit()

    native = hybrid.inspect("project-one", jev.id)["entity"]
    native_think_ids = [
        item["memory_id"] for item in native["evidence"]
        if item["memory_id"] in set(direct_think_ids)
    ]
    assert native_think_ids == list(reversed(direct_think_ids))

    projected = hybrid.projection("project-one", native_id=jev.id)
    think_node = next(
        node for node in projected["nodes"]
        if jev.id in node.get("member_ids", [node["id"]])
    )
    projected_think_ids = [
        item["id"] for item in think_node["properties"]["evidence"]
        if item["id"] in set(direct_think_ids)
    ]
    assert projected_think_ids == list(reversed(direct_think_ids))
    assert mention_only_id not in {
        item["id"] for item in think_node["properties"]["evidence"]
    }
    assert projected_think_ids[0] == newest_id
    assert think_node["properties"]["evidence"][0]["ingestedAt"] is not None


def test_same_structured_think_body_appends_on_a_later_completed_pair(hybrid):
    def classify(*args, **_kwargs):
        return decision("QUALIFIES")

    first_preparation = hybrid.prepare_completed_pair(payload())
    first = hybrid.settle_completed_pair(
        settle_payload(first_preparation), classifier=classify,
    )

    later = payload("run-two")
    later.update({
        "completedAt": "2026-09-23T12:05:00Z",
        "userMessage": "Revisit Jev and ThinkGraph in this later exchange.",
        "mainResponse": "Record the current temporal Think without rewriting history.",
    })
    second_preparation = hybrid.prepare_completed_pair(later)
    second_payload = settle_payload(second_preparation, completed=later)
    second_payload["cardRun"] = card_run("thinkgraph-run-two")
    second = hybrid.settle_completed_pair(second_payload, classifier=classify)

    first_memory_id = only_think_id(first)
    second_memory_id = only_think_id(second)
    assert first_memory_id != second_memory_id
    service = hybrid.get_service()
    memories = service.store.get_memories([
        first_memory_id, second_memory_id,
    ])
    assert len(memories) == 2
    assert all(memory.mtype == hybrid.MemoryType.EPISODIC for memory in memories.values())
    assert {
        memory.content
        for memory in memories.values()
    } == {"Jev normalizes expressive graph relations."}
    assert all(
        "note_hash" not in memory.metadata["thinkgraph_fact"]
        for memory in memories.values()
    )


def test_loose_abstract_subject_does_not_create_a_node_without_a_relationship(hybrid):
    completed = payload("structured-discovery")
    prepared = hybrid.prepare_completed_pair(completed)
    output = structured_output(
        content="Rocket Lab's Electron execution must convert cadence into durable economics."
    )
    output["facts"][0]["entities"] = [
        "Rocket Lab", "Electron", "Launch cadence",
    ]
    output["facts"][0]["relations"] = [{
        "source": "Rocket Lab",
        "relation": "operates Electron as its current orbital launch vehicle",
        "target": "Electron",
    }]
    settled = hybrid.settle_completed_pair(
        settle_payload(prepared, output=output, completed=completed),
        classifier=lambda *_args, **_kwargs: decision("USES"),
    )

    assert not settled["failures"]
    entities, edges = entities_and_edges(hybrid)
    assert {entity.name for entity in entities} == {"Rocket Lab", "Electron"}
    assert [edge.relation for edge in edges if edge.provenance.get("jev")] == [
        "USES",
    ]


def test_central_subject_is_a_relationship_endpoint_and_one_think_anchors_every_node(
    hybrid,
):
    completed = payload("rocket-lab-anchor")
    prepared = hybrid.prepare_completed_pair(completed)
    summary = (
        "Rocket Lab's launch cadence strengthens the investment case only when Electron "
        "execution produces attributable launch revenue."
    )
    output = structured_output(content=summary)
    output["facts"][0].update({
        "title": "Launch cadence must become attributable revenue",
        "entities": ["Rocket Lab", "Electron", "HASTE", "Launch cadence"],
        "relations": [{
            "source": "Rocket Lab",
            "relation": "operates Electron as its current orbital launch vehicle",
            "target": "Electron",
        }, {
            "source": "Rocket Lab",
            "relation": "operates HASTE for responsive launch missions",
            "target": "HASTE",
        }],
    })

    settled = hybrid.settle_completed_pair(
        settle_payload(prepared, output=output, completed=completed),
        classifier=lambda source, *_args, **_kwargs: decision(
            "USES"
        ),
    )

    service = hybrid.get_service()
    entities, edges = entities_and_edges(hybrid)
    assert {entity.name for entity in entities} == {
        "Rocket Lab", "Electron", "HASTE",
    }
    assert len([edge for edge in edges if edge.provenance.get("jev")]) == 2
    assert all(any(
        edge.src == entity.id or edge.dst == entity.id
        for edge in edges if edge.provenance.get("jev")
    ) for entity in entities)
    memory_id = only_think_id(settled)
    direct = [
        row for row in service.store.list_memory_entities(memory_ids=[memory_id])
        if row.get("source_kind") == "structured_extractor"
    ]
    assert {row["entity_id"] for row in direct} == {entity.id for entity in entities}
    memory = service.store.get_memory(memory_id)
    assert memory is not None
    assert memory.title == "Launch cadence must become attributable revenue"
    assert memory.content == summary
    assert memory.metadata["thinkgraph_fact"]["entities"] == [
        "Rocket Lab", "Electron", "HASTE", "Launch cadence",
    ]
    assert {
        edge.provenance["jev"]["natural_relationship"] for edge in edges
    } == {
        "operates Electron as its current orbital launch vehicle",
        "operates HASTE for responsive launch missions",
    }


def test_structurally_valid_relationship_is_normalized_and_persisted(hybrid):
    prepared = hybrid.prepare_completed_pair(payload())
    output = structured_output(content="Jev supplies normalized graph mathematics.")
    low_probability = decision("QUALIFIES")
    low_probability["distribution"] = {
        name: (0.06 if name == "QUALIFIES" else 0.04 if name == "RELATED_TO" else 0.05)
        for name in adapter.THINKGRAPH_JEV_CHOICES
    }
    low_probability["label_confidence"] = 0.06
    low_probability["relationship_strength"] = 0.06
    settled = hybrid.settle_completed_pair(
        settle_payload(prepared, output=output),
        classifier=lambda *_args, **_kwargs: low_probability,
    )
    assert only_think_id(settled)
    entities, edges = entities_and_edges(hybrid)
    assert {entity.name for entity in entities} == {"Jev", "ThinkGraph"}
    assert len(edges) == 1
    assert edges[0].relation == "QUALIFIES"
    assert edges[0].weight == pytest.approx(0.06)
    assert edges[0].provenance["jev"]["natural_relationship"] == FREEFORM_RELATION


def test_think_store_failure_prevents_partial_node_and_edge_birth(
    hybrid, monkeypatch: pytest.MonkeyPatch,
):
    def classify(
        _source: str,
        _target: str,
        _source_payload: dict,
        _supporting_fact: str,
        _graph_context: dict,
        relationship_proposal: str,
        **_kwargs,
    ) -> dict:
        return decision("QUALIFIES")

    prepared = hybrid.prepare_completed_pair(payload())

    def fail_think(*_args, **_kwargs):
        raise RuntimeError("think_store_unavailable")

    monkeypatch.setattr(hybrid, "_save_think_memories", fail_think)
    with pytest.raises(
        hybrid.ThinkGraphIntakeError, match="thinkgraph_think_batch_store_failed",
    ):
        hybrid.settle_completed_pair(
            settle_payload(prepared),
            classifier=classify,
        )
    entities, edges = entities_and_edges(hybrid)
    assert entities == []
    assert edges == []
    assert hybrid.get_service().store.count_memories() == 0


def test_jev_edge_update_supersession_and_closure_use_native_temporal_history(hybrid):
    service = hybrid.get_service()
    workspace_id = service.store.get_or_create_workspace("project-one")
    first = hybrid._apply_accepted_decision(
        service.store,
        source_name="Jev",
        target_name="ThinkGraph",
        workspace_id=workspace_id,
        repo_id=None,
        payload=payload(),
        memory_ids=[],
        decision=decision("QUALIFIES"),
        stage="test",
    )
    original = service.store.conn.execute(
        "SELECT valid_from, ingested_at FROM edges WHERE id=?",
        (first["edge_id"],),
    ).fetchone()

    same = hybrid._apply_accepted_decision(
        service.store,
        source_id=first["source"],
        target_id=first["target"],
        source_name="Jev",
        target_name="ThinkGraph",
        workspace_id=workspace_id,
        repo_id=None,
        payload=payload("run-two"),
        memory_ids=[],
        decision=decision("QUALIFIES"),
        stage="test",
    )
    assert same["status"] == "updated"
    assert same["edge_id"] == first["edge_id"]
    updated = service.store.conn.execute(
        "SELECT valid_from, ingested_at, provenance FROM edges WHERE id=?",
        (same["edge_id"],),
    ).fetchone()
    assert updated["valid_from"] == original["valid_from"]
    assert updated["ingested_at"] == original["ingested_at"]
    assert len(json.loads(updated["provenance"])["jev_history"]) == 1

    changed = hybrid._apply_accepted_decision(
        service.store,
        source_id=first["source"],
        target_id=first["target"],
        source_name="Jev",
        target_name="ThinkGraph",
        workspace_id=workspace_id,
        repo_id=None,
        payload=payload("run-three"),
        memory_ids=[],
        decision=decision("CONTRADICTS"),
        stage="test",
    )
    assert changed["status"] == "superseded"
    assert changed["edge_id"] != first["edge_id"]
    prior = service.store.conn.execute(
        "SELECT valid_to, valid_to_recorded_at FROM edges WHERE id=?",
        (first["edge_id"],),
    ).fetchone()
    assert prior["valid_to"] is not None
    assert prior["valid_to_recorded_at"] is not None
    live = hybrid._current_jev_pair_edges(
        service.store,
        workspace_id=workspace_id,
        source_id=first["source"],
        target_id=first["target"],
    )
    assert [(edge.id, edge.relation) for edge in live] == [
        (changed["edge_id"], "CONTRADICTS")
    ]

    assert [(edge.id, edge.relation) for edge in hybrid._current_jev_pair_edges(
        service.store,
        workspace_id=workspace_id,
        source_id=first["source"],
        target_id=first["target"],
    )] == [(changed["edge_id"], "CONTRADICTS")]


def test_structured_writer_gets_complete_subject_directory_not_prior_think_bodies(
    hybrid,
):
    def seed_classifier(*args, **_kwargs):
        return decision("QUALIFIES")

    seed_preparation = hybrid.prepare_completed_pair(payload())
    seed_settled = hybrid.settle_completed_pair(
        settle_payload(seed_preparation), classifier=seed_classifier,
    )
    assert not seed_settled["failures"]
    service = hybrid.get_service()
    jev = next(node for node in service.store.list_entities() if node.name == "Jev")
    thinkgraph = next(
        node for node in service.store.list_entities() if node.name == "ThinkGraph"
    )

    completed = payload("run-two")
    completed.update({
        "completedAt": "2026-09-23T12:01:00Z",
        "userMessage": "Jev now operates under a stricter bounded constraint.",
        "mainResponse": "The new constraint changes how Jev may be applied.",
    })
    prepared = hybrid.prepare_completed_pair(completed)
    assert prepared["revisionChanged"] is False
    assert set(prepared["enrichmentInput"]) == {
        "exact_user_message",
        "exact_main_response",
        "canonical_subject_directory",
        "current_project_relationship_vocabulary",
    }
    assert "Jev normalizes expressive graph relations." not in prepared["enrichmentPrompt"]
    directory = prepared["enrichmentInput"]["canonical_subject_directory"]
    assert {item["nativeId"] for item in directory["subjects"]} == {
        jev.id, thinkgraph.id, "know-jev",
    }
    assert "canonical_subject_directory" in prepared["enrichmentPrompt"]
    assert "existingNotes" not in prepared["enrichmentPrompt"]


def test_structured_pair_normalization_never_closes_existing_edges(
    hybrid,
):
    service = hybrid.get_service()
    workspace_id = service.store.get_or_create_workspace("project-one")
    target = hybrid._apply_accepted_decision(
        service.store,
        source_name="Jev",
        target_name="ThinkGraph",
        workspace_id=workspace_id,
        repo_id=None,
        payload=payload(),
        memory_ids=[],
        decision=decision("QUALIFIES"),
        stage="test",
    )
    neighbor = hybrid._apply_accepted_decision(
        service.store,
        source_id=target["source"],
        source_name="Jev",
        target_name="Bounded Context",
        workspace_id=workspace_id,
        repo_id=None,
        payload=payload("neighbor-run"),
        memory_ids=[],
        decision=decision("DEPENDS_ON"),
        stage="test",
    )
    completed = payload("normalization-update-run")
    prepared = hybrid.prepare_completed_pair(completed)
    output = structured_output(content="Jev and ThinkGraph remain directly related.")
    settled = hybrid.settle_completed_pair(
        settle_payload(prepared, output=output, completed=completed),
        classifier=lambda *_args, **_kwargs: decision("QUALIFIES"),
    )

    assert settled["relationships"][0]["status"] == "updated"
    assert [(edge.id, edge.relation) for edge in hybrid._current_jev_pair_edges(
        service.store,
        workspace_id=workspace_id,
        source_id=target["source"],
        target_id=target["target"],
    )] == [(target["edge_id"], "QUALIFIES")]
    assert [edge.id for edge in hybrid._current_jev_pair_edges(
        service.store,
        workspace_id=workspace_id,
        source_id=neighbor["source"],
        target_id=neighbor["target"],
    )] == [neighbor["edge_id"]]


def test_jev_failure_is_visible_and_does_not_mutate_graph(hybrid):
    def fail(*_args, **_kwargs):
        raise adapter.JevRelationshipError("jev_relationship_unavailable")

    prepared = hybrid.prepare_completed_pair(payload())
    with pytest.raises(
        adapter.JevRelationshipError, match="jev_relationship_unavailable",
    ):
        hybrid.settle_completed_pair(
            settle_payload(prepared), classifier=fail,
        )
    entities, edges = entities_and_edges(hybrid)
    assert entities == []
    assert edges == []
    assert hybrid.get_service().store.count_memories() == 0
