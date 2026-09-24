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
def hybrid(tmp_path: Path):
    original = adapter.DATABASE
    adapter.close_engine()
    adapter.DATABASE = tmp_path / "thinkgraph.sqlite"
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
    distribution["NONE"] = 0.14 if winner != "NONE" else 0.76
    distribution["INSUFFICIENT_CONTEXT"] = 0.10
    if winner == "NONE":
        distribution["QUALIFIES"] = 0.14
    return {
        "winner": winner,
        "distribution": distribution,
        "label_confidence": distribution[winner],
        "relationship_strength": max(
            0.0, 1.0 - distribution["NONE"]
            - distribution["INSUFFICIENT_CONTEXT"]
            - distribution["INVALID_NODE_PAIR"]
        ),
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


def payload(run_id: str = "run-one") -> dict[str, str]:
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
    }


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
            "mtype": "semantic",
            "importance": 0.8,
            "keywords": ["probability", "graph semantics"],
            "entities": ["Jev", "ThinkGraph"],
            "relations": [{
                "source": "Jev",
                "relation": FREEFORM_RELATION,
                "target": "ThinkGraph",
            }],
            "kind": "DECISION",
            "properties": [{
                "name": "edge_owner",
                "value": "Jev",
            }],
            "concepts": ["probabilistic semantic edges"],
            "propositions": [content],
            "relationship_observations": [
                f"Jev {FREEFORM_RELATION} ThinkGraph."
            ],
        }],
    }


def settle_payload(
    preparation: dict,
    *,
    output: dict | None = None,
    completed: dict[str, str] | None = None,
) -> dict:
    return {
        **(completed or payload()),
        "pairMemoryId": preparation["pairMemoryId"],
        "structuredOutput": output or structured_output(),
        "cardRun": card_run(),
    }


def entities_and_edges(hybrid) -> tuple[list[Any], list[Any]]:
    service = hybrid.get_service()
    entities = service.store.list_entities()
    edges = service.store.neighbors([entity.id for entity in entities]) if entities else []
    return entities, edges


def test_jev_choice_requires_complete_vocabulary_and_uses_winner_probability():
    assert len(SHARED_JEV_RELATIONSHIPS) == 20
    assert adapter.THINKGRAPH_JEV_CHOICES[:20] == SHARED_JEV_RELATIONSHIPS
    probabilities = {name: 0.0 for name in adapter.THINKGRAPH_JEV_CHOICES}
    probabilities.update(
        CONTRADICTS=0.52,
        QUALIFIES=0.12,
        NONE=0.18,
        INSUFFICIENT_CONTEXT=0.10,
        INVALID_NODE_PAIR=0.08,
    )
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
    # Admission still sees 0.64 total semantic support, while visual physics
    # uses only the 0.52 probability of the winning edge type.
    assert adapter._decision_is_accepted(parsed) is True
    assert tuple(parsed["distribution"]) == adapter.THINKGRAPH_JEV_CHOICES

    invalid_mass = {name: 0.0 for name in adapter.THINKGRAPH_JEV_CHOICES}
    invalid_mass.update(
        QUALIFIES=0.55,
        NONE=0.05,
        INSUFFICIENT_CONTEXT=0.05,
        INVALID_NODE_PAIR=0.35,
    )
    rejected = adapter._validate_jev_response({
        "answers": {"relationship": {
            "type": "choice",
            "choice": "QUALIFIES",
            "probabilities": invalid_mass,
        }}
    })
    assert rejected["relationship_strength"] == pytest.approx(0.55)
    assert adapter._decision_is_accepted(rejected) is False

    probabilities.pop("ENABLES")
    with pytest.raises(adapter.JevRelationshipError, match="response_invalid"):
        adapter._validate_jev_response({
            "answers": {"relationship": {
                "type": "choice",
                "choice": "CONTRADICTS",
                "probabilities": probabilities,
            }}
        })


def test_native_llm_structured_relation_uses_dynamic_predicate_guidance():
    schema, _prompt = adapter._llm_structured_contract("pair", {})
    relation = schema["$defs"]["ThinkGraphStructuredRelation"]["properties"]["relation"]
    assert relation["type"] == "string"
    assert "enum" not in relation
    assert "current_project_relationship_vocabulary" in relation["description"]
    assert "never exceed three words" in relation["description"]
    assert adapter.ThinkGraphStructuredRelation(
        source="Jev",
        relation=FREEFORM_RELATION,
        target="ThinkGraph",
    ).relation == FREEFORM_RELATION


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
    assert adapter._decision_is_accepted({
        "winner": legacy_label,
        "distribution": {legacy_label: 1.0},
    }) is False

    choices = (*SHARED_JEV_RELATIONSHIPS, legacy_label, *adapter.THINKGRAPH_CONTROL_OUTCOMES)
    dynamic = decision(
        legacy_label,
        choices=choices,
        novel_candidate=legacy_label,
        proposal_status="novel_candidate",
    )
    assert adapter._decision_is_accepted(dynamic) is True


def test_prepare_stores_pair_without_regex_jev_or_graph_mutation(hybrid):
    prepared = hybrid.prepare_completed_pair(payload())
    assert hybrid.inspect("project-one", prepared["pairMemoryId"])["memory"]["content"].startswith(
        "USER:\nJev evaluates ThinkGraph"
    )
    assert prepared["structuredExtractionRequired"] is True
    assert prepared["revisionChanged"] is False
    assert prepared["preparation"] == {
        "status": "completed_without_graph_mutation",
    }
    assert set(prepared["enrichmentInput"]) == {
        "exact_user_message", "exact_main_response", "current_graph_shape",
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
        "maximum": 255,
        "atMaximum": False,
    }
    entities, edges = entities_and_edges(hybrid)
    assert entities == []
    assert edges == []


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
    assert plan["choices"][-3:] == adapter.THINKGRAPH_CONTROL_OUTCOMES
    if candidate:
        assert plan["choices"].count(candidate) == 1
        assert plan["choices"][-4] == candidate


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


@pytest.mark.parametrize("winner", ["QUALIFIES", "NONE"])
def test_novel_proposal_does_not_expand_vocabulary_unless_it_wins(
    hybrid, winner,
):
    completed = payload(f"novel-loses-{winner.lower()}")
    prepared = hybrid.prepare_completed_pair(completed)
    output = structured_output(content="A proposed relationship may lose Jev Choice.")
    output["facts"][0]["relations"][0]["relation"] = "amplifies"

    def choose_existing_or_control(
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
            winner,
            choices=choices,
            novel_candidate=novel_relationship_candidate,
            proposal_status=relationship_proposal_status,
        )

    settled = hybrid.settle_completed_pair(
        settle_payload(prepared, output=output, completed=completed),
        classifier=choose_existing_or_control,
    )

    assert settled["relationshipVocabulary"]["added"] == []
    assert settled["relationshipVocabulary"]["after"]["labels"] == list(
        SHARED_JEV_RELATIONSHIPS
    )
    assert "AMPLIFIES" not in hybrid.read_project_relationship_vocabulary(
        "project-one"
    )["labels"]


def test_project_relationship_vocabulary_stops_at_255(hybrid):
    service = hybrid.get_service()
    workspace_id = service.store.get_or_create_workspace("project-one")
    with service.store._write_operation(
        "test_relationship_vocabulary_ceiling", commit=True,
    ):
        for index in range(235):
            hybrid._promote_project_relationship_label(
                service.store,
                workspace_id=workspace_id,
                label=f"REL_{index:03d}",
            )

    vocabulary = tuple(
        hybrid.read_project_relationship_vocabulary("project-one")["labels"]
    )
    assert len(vocabulary) == 255
    plan = hybrid.relationship_choice_plan("over performs", vocabulary)
    assert plan["proposal_status"] == "novel_blocked_at_ceiling"
    assert plan["novel_candidate"] == ""
    assert "OVER_PERFORMS" not in plan["choices"]
    with pytest.raises(
        hybrid.ThinkGraphIntakeError,
        match="thinkgraph_relationship_vocabulary_ceiling",
    ):
        hybrid.promote_project_relationship_label(
            "project-one", "OVER_PERFORMS",
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


def test_native_engraphis_noop_skips_repeat_structured_card_extraction(hybrid):
    first = hybrid.prepare_completed_pair(payload())
    repeated = hybrid.prepare_completed_pair(payload())

    assert first["intakeOperation"] == "add"
    assert first["structuredExtractionRequired"] is True
    assert repeated == {
        "ok": True,
        "projectId": "project-one",
        "pairMemoryId": first["pairMemoryId"],
        "intakeOperation": "noop",
        "structuredExtractionRequired": False,
        "revision": first["revision"],
        "revisionChanged": False,
        "preparation": {"status": "duplicate_noop"},
    }


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


def test_jev_context_contains_only_latest_endpoint_thought_and_direct_edges(hybrid):
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
    older = hybrid._persist_note(
        service,
        project="project-one",
        workspace_id=workspace_id,
        entity_id=first["source"],
        entity_name="Alpha",
        note=hybrid.ThinkGraphNodeNote(
            kind="OBSERVATION", summary="Alpha prior Thought one."
        ),
        card_run=card_run("prior-one"),
    )
    newer = hybrid._persist_note(
        service,
        project="project-one",
        workspace_id=workspace_id,
        entity_id=first["source"],
        entity_name="Alpha",
        note=hybrid.ThinkGraphNodeNote(
            kind="DECISION", summary="Alpha latest prior Thought."
        ),
        card_run=card_run("prior-two"),
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
    assert [item["memory_id"] for item in snapshot["latest_prior_thoughts"]] == [
        newer,
    ]
    assert snapshot["latest_prior_thoughts"][0]["endpoint"] == "A"
    assert snapshot["latest_prior_thoughts"][0]["content"].startswith(
        "KIND: DECISION"
    )


def test_structured_proposal_reuses_canonical_node_and_freezes_prior_thought(
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
    prior_note_id = hybrid._persist_note(
        service,
        project="project-one",
        workspace_id=workspace_id,
        entity_id=prior["source"],
        entity_name="Alpha",
        note=hybrid.ThinkGraphNodeNote(
            kind="OBSERVATION",
            summary="Alpha already has durable project context.",
            keywords=["alpha"],
            propositions=["Alpha has prior context."],
        ),
        card_run=card_run("seed-note-run"),
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
        "current_graph_shape",
        "current_project_relationship_vocabulary",
    }
    assert "Alpha already has durable project context." not in prepared["enrichmentPrompt"]
    graph_shape = enrichment["current_graph_shape"]
    assert graph_shape["scope"] == "bounded_current_canonical_shape"
    assert {node["canonicalName"] for node in graph_shape["nodes"]} == {
        "Alpha", "Prior Context",
    }
    assert all(set(node) == {
        "nativeId", "canonicalName", "nodeType",
    } for node in graph_shape["nodes"])
    assert any(
        edge["source"]["nativeId"] == prior["source"]
        and edge["target"]["nativeId"] == prior["target"]
        and edge["canonicalRelationship"] == "QUALIFIES"
        for edge in graph_shape["edges"]
    )
    assert all("distribution" not in edge for edge in graph_shape["edges"])
    assert "current_graph_shape" in prepared["enrichmentPrompt"]
    assert "existingNotes" not in prepared["enrichmentPrompt"]
    assert prior_note_id not in prepared["enrichmentPrompt"]

    output = structured_output(content="Alpha now supplies a bounded input to Beta.")
    output["facts"][0]["entities"] = ["Alpha", "Beta"]
    output["facts"][0]["relations"] = [{
        "source": "Alpha",
        "relation": "supplies a bounded current input to",
        "target": "Beta",
    }]
    original_latest = hybrid._latest_endpoint_thought
    original_save = hybrid._save_note_memory
    current_thought_written = False

    def latest_before_write(*args, **kwargs):
        assert current_thought_written is False
        return original_latest(*args, **kwargs)

    def mark_current_write(*args, **kwargs):
        nonlocal current_thought_written
        current_thought_written = True
        return original_save(*args, **kwargs)

    monkeypatch.setattr(hybrid, "_latest_endpoint_thought", latest_before_write)
    monkeypatch.setattr(hybrid, "_save_note_memory", mark_current_write)
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
        for item in settled_call["context"]["latest_prior_thoughts"]
    ] == [prior_note_id]
    assert not any(item["target"] == "Prior Context" for item in calls)
    assert prior["edge_id"] in {
        edge.id for edge in service.store.neighbors([prior["source"]])
        if edge.provenance.get("jev")
    }


def test_saved_card_freeform_proposal_becomes_note_context_and_jev_edge(hybrid):
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
        return decision("QUALIFIES" if relationship_proposal else "INVALID_NODE_PAIR")

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
    assert {"nodes", "latest_prior_thoughts", "incident_edges"}.issubset(
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

    assert settled["noteMemoryIds"], settled
    note_memories = service.store.get_memories(settled["noteMemoryIds"])
    matching_notes = [
        memory for memory in note_memories.values()
        if FREEFORM_RELATION in memory.content
    ]
    assert matching_notes, [
        (memory.title, memory.content, memory.metadata)
        for memory in note_memories.values()
    ]
    note = matching_notes[0]
    assert note.metadata["thinkgraph_note"]["kind"] == "DECISION"
    assert note.metadata["thinkgraph_note"]["relationship_observations"]
    assert note.metadata["thinkgraph_origin"] == {
        "authority": "thinkgraph",
        "writer": "saved_thinkgraph_card",
        "card_id": "card_thinkgraph",
        "card_revision_id": "revision-one",
        "run_id": "thinkgraph-run-one",
        "profile": "thinkgraph",
        "native_session_ref": "thinkgraph-session-one",
        "resolved_model": "openai/saved-thinkgraph-model-test",
    }
    assert "source_reference" not in note.metadata
    assert "timestamp" not in note.metadata["thinkgraph_note"]
    native_read = hybrid.inspect("project-one", jev.id)["entity"]
    assert any(
        FREEFORM_RELATION in str(item.get("excerpt") or "")
        for item in native_read["evidence"]
    )

    graph = hybrid.projection("project-one")
    projected = next(
        item for item in graph["scene"]["edges"]
        if edge.id in item.get("underlying_edge_ids", [])
    )
    assert projected["relationship_strength"] == pytest.approx(0.76)
    assert projected["label_confidence"] == pytest.approx(0.76)
    assert projected["spring_strength"] == pytest.approx(0.1642)
    assert projected["rest_length"] == pytest.approx(16.88)
    projected_node = next(
        item for item in graph["scene"]["nodes"]
        if jev.id in item.get("member_ids", [item["id"]])
    )
    assert projected_node["semantic_mass"] > 0
    assert projected_node["gravity_mass"] > 1


def test_thought_notes_use_native_time_and_are_newest_first(hybrid):
    def classify(*args, **_kwargs):
        return decision("QUALIFIES" if args[5] else "INVALID_NODE_PAIR")

    prepared = hybrid.prepare_completed_pair(payload())
    output = structured_output()
    output["facts"].append({
        **structured_output(content="A later self-contained Thought Note.")["facts"][0],
        "title": "Later Thought Note",
    })
    settled = hybrid.settle_completed_pair(
        settle_payload(prepared, output=output),
        classifier=classify,
    )
    assert len(settled["noteMemoryIds"]) >= 2
    service = hybrid.get_service()
    jev = next(node for node in service.store.list_entities() if node.name == "Jev")
    workspace_id = service.store.get_or_create_workspace("project-one")
    incidences = service.store.list_memory_entities(
        hybrid.SearchFilter(workspace_id=workspace_id),
        entity_ids=[jev.id],
        limit=512,
    )
    memories = service.store.get_memories(list(dict.fromkeys(
        str(item["memory_id"]) for item in incidences
    )))
    direct_note_ids = [
        memory_id for memory_id, memory in memories.items()
        if hybrid._note_metadata(memory) is not None
    ]
    assert len(direct_note_ids) >= 2
    for sequence, memory_id in enumerate(direct_note_ids, start=1):
        service.store.conn.execute(
            "UPDATE memories SET ingested_at=? WHERE id=?",
            (float(sequence * 100), memory_id),
        )
    service.store.conn.commit()
    newest_id = direct_note_ids[-1]

    native = hybrid.inspect("project-one", jev.id)["entity"]
    native_note_ids = [
        item["memory_id"] for item in native["evidence"]
        if item["memory_id"] in set(direct_note_ids)
    ]
    assert native_note_ids == list(reversed(direct_note_ids))

    projected = hybrid.projection("project-one", native_id=jev.id)
    thought = next(
        node for node in projected["nodes"]
        if jev.id in node.get("member_ids", [node["id"]])
    )
    projected_note_ids = [
        item["id"] for item in thought["properties"]["evidence"]
        if item["id"] in set(direct_note_ids)
    ]
    assert projected_note_ids == [newest_id]
    assert thought["properties"]["evidence"][0]["ingestedAt"] is not None


def test_same_structured_thought_body_appends_on_a_later_completed_pair(hybrid):
    def classify(*args, **_kwargs):
        return decision("QUALIFIES" if args[5] else "INVALID_NODE_PAIR")

    first_preparation = hybrid.prepare_completed_pair(payload())
    first = hybrid.settle_completed_pair(
        settle_payload(first_preparation), classifier=classify,
    )

    later = payload("run-two")
    later.update({
        "completedAt": "2026-09-23T12:05:00Z",
        "userMessage": "Revisit Jev and ThinkGraph in this later exchange.",
        "mainResponse": "Record the current temporal Thought without rewriting history.",
    })
    second_preparation = hybrid.prepare_completed_pair(later)
    second_payload = settle_payload(second_preparation, completed=later)
    second_payload["cardRun"] = card_run("thinkgraph-run-two")
    second = hybrid.settle_completed_pair(second_payload, classifier=classify)

    assert first["noteMemoryIds"]
    assert second["noteMemoryIds"]
    assert set(first["noteMemoryIds"]).isdisjoint(second["noteMemoryIds"])
    service = hybrid.get_service()
    first_notes = service.store.get_memories(first["noteMemoryIds"])
    second_notes = service.store.get_memories(second["noteMemoryIds"])
    assert {
        memory.metadata["thinkgraph_note"]["summary"]
        for memory in first_notes.values()
    } == {"Jev normalizes expressive graph relations."}
    assert {
        memory.metadata["thinkgraph_note"]["summary"]
        for memory in second_notes.values()
    } == {"Jev normalizes expressive graph relations."}
    assert all(
        "note_hash" not in memory.metadata["thinkgraph_note"]
        for memory in [*first_notes.values(), *second_notes.values()]
    )


def test_structured_only_concept_can_become_durable_after_jev_accepts(hybrid):
    completed = payload("structured-discovery")
    assert "Execution Risk" not in completed["userMessage"]
    assert "Execution Risk" not in completed["mainResponse"]
    prepared = hybrid.prepare_completed_pair(completed)
    output = structured_output(
        content="Neutron schedule uncertainty creates execution risk for the thesis."
    )
    output["facts"][0]["entities"] = ["Neutron", "Execution Risk"]
    output["facts"][0]["relations"] = [{
        "source": "Neutron",
        "relation": "creates schedule-sensitive uncertainty represented by",
        "target": "Execution Risk",
    }]
    settled = hybrid.settle_completed_pair(
        settle_payload(prepared, output=output, completed=completed),
        classifier=lambda *_args, **_kwargs: decision("CAUSES"),
    )

    assert not settled["failures"]
    entities, edges = entities_and_edges(hybrid)
    assert {entity.name for entity in entities} == {"Neutron", "Execution Risk"}
    assert [edge.relation for edge in edges if edge.provenance.get("jev")] == [
        "CAUSES",
    ]


@pytest.mark.parametrize(
    "winner", ["NONE", "INSUFFICIENT_CONTEXT", "INVALID_NODE_PAIR"],
)
def test_unaccepted_saved_card_pair_creates_neither_new_nodes_nor_notes(
    hybrid, winner,
):
    prepared = hybrid.prepare_completed_pair(payload())
    output = structured_output(content="Discard this weak structured proposal.")
    output["facts"][0]["entities"] = ["Jev", "Transient Sentence Fragment"]
    output["facts"][0]["relations"] = [{
        "source": "Jev",
        "relation": "appears beside",
        "target": "Transient Sentence Fragment",
    }]
    settled = hybrid.settle_completed_pair(
        settle_payload(prepared, output=output),
        classifier=lambda *_args, **_kwargs: decision(winner),
    )
    assert settled["relationships"]
    assert all(item["status"] == "no_edge" for item in settled["relationships"])
    assert all(item["winner"] == winner for item in settled["relationships"])
    assert settled["noteMemoryIds"] == []
    entities, edges = entities_and_edges(hybrid)
    assert entities == []
    assert edges == []
    assert all(entity.name != "Transient Sentence Fragment" for entity in entities)
    assert all(edge.relation != "INVALID_NODE_PAIR" for edge in edges)


def test_new_node_note_failure_prevents_partial_node_and_edge_birth(
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
        return decision("QUALIFIES" if relationship_proposal else "NONE")

    prepared = hybrid.prepare_completed_pair(payload())

    def fail_note(*_args, **_kwargs):
        raise RuntimeError("note_store_unavailable")

    monkeypatch.setattr(hybrid, "_save_note_memory", fail_note)
    settled = hybrid.settle_completed_pair(
        settle_payload(prepared),
        classifier=classify,
    )

    assert settled["status"] == "completed_with_failures"
    assert any(
        item.get("stage") == "new_node_note"
        and item.get("error") == "note_store_unavailable"
        for item in settled["failures"]
    )
    assert settled["noteMemoryIds"] == []
    entities, edges = entities_and_edges(hybrid)
    assert entities == []
    assert edges == []


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

    closed = hybrid._invalidate_current_jev_pair(
        service.store,
        workspace_id=workspace_id,
        source_id=first["source"],
        target_id=first["target"],
    )
    assert closed == [changed["edge_id"]]
    assert hybrid._current_jev_pair_edges(
        service.store,
        workspace_id=workspace_id,
        source_id=first["source"],
        target_id=first["target"],
    ) == []


def test_structured_writer_gets_shape_not_thought_bodies_or_edge_reclassification(
    hybrid,
):
    def seed_classifier(*args, **_kwargs):
        return decision("QUALIFIES" if args[5] else "INVALID_NODE_PAIR")

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

    output = structured_output(content="Jev has a genuinely new operating constraint.")
    output["facts"][0]["entities"] = ["Jev", "ThinkGraph"]
    output["facts"][0]["relations"] = []
    output["facts"][0]["relationship_observations"] = []

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
        "current_graph_shape",
        "current_project_relationship_vocabulary",
    }
    assert "Jev normalizes expressive graph relations." not in prepared["enrichmentPrompt"]
    shape = prepared["enrichmentInput"]["current_graph_shape"]
    assert {item["nativeId"] for item in shape["nodes"]} == {
        jev.id, thinkgraph.id,
    }
    assert any(
        edge["source"]["nativeId"] == jev.id
        and edge["target"]["nativeId"] == thinkgraph.id
        and edge["canonicalRelationship"] == "QUALIFIES"
        for edge in shape["edges"]
    )
    assert "current_graph_shape" in prepared["enrichmentPrompt"]
    assert "existingNotes" not in prepared["enrichmentPrompt"]
    live_before = {
        edge.id: (edge.relation, edge.weight, edge.provenance)
        for edge in service.store.neighbors([jev.id])
        if edge.provenance.get("jev")
    }
    assert live_before

    calls = 0

    def fail(*_args, **_kwargs):
        nonlocal calls
        calls += 1
        raise adapter.JevRelationshipError("jev_relationship_unavailable")

    settled = hybrid.settle_completed_pair(
        settle_payload(prepared, output=output, completed=completed),
        classifier=fail,
    )

    assert calls == 0
    assert settled["failures"] == []
    assert settled["changedEdgeIds"] == []
    assert "reopenedNodeIds" not in settled
    assert "reclassifiedRelationships" not in settled
    live_after = {
        edge.id: (edge.relation, edge.weight, edge.provenance)
        for edge in service.store.neighbors([jev.id])
        if edge.provenance.get("jev")
    }
    assert live_after == live_before


def test_only_explicit_rejected_structured_pair_closes_its_live_edge(
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
    completed = payload("explicit-close-run")
    prepared = hybrid.prepare_completed_pair(completed)
    output = structured_output(content="The current pair no longer supports this edge.")
    settled = hybrid.settle_completed_pair(
        settle_payload(prepared, output=output, completed=completed),
        classifier=lambda *_args, **_kwargs: decision("NONE"),
    )

    assert settled["relationships"][0]["status"] == "closed"
    assert settled["relationships"][0]["closed_edge_ids"] == [target["edge_id"]]
    assert hybrid._current_jev_pair_edges(
        service.store,
        workspace_id=workspace_id,
        source_id=target["source"],
        target_id=target["target"],
    ) == []
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
    settled = hybrid.settle_completed_pair(
        settle_payload(prepared), classifier=fail,
    )
    assert settled["status"] == "completed_with_failures"
    assert settled["failures"]
    entities, edges = entities_and_edges(hybrid)
    assert entities == []
    assert edges == []
    assert hybrid.inspect("project-one", prepared["pairMemoryId"])["memory"]["content"]
