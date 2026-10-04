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
    distribution["NONE"] = 0.14 if winner != "NONE" else 0.76
    distribution["INSUFFICIENT_CONTEXT"] = 0.10
    if winner == "NONE":
        distribution["QUALIFIES"] = 0.14
    return {
        "winner": winner,
        "distribution": distribution,
        "confidence": 0.64,
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
        "userMessageId": f"msg-user-{run_id}",
        "userMessageAt": "2026-09-23T11:59:00Z",
        "mainMessageId": f"msg-main-{run_id}",
        "mainMessageAt": "2026-09-23T12:00:00Z",
        "userMessage": "Jev evaluates ThinkGraph relationship semantics.",
        "mainResponse": "ThinkGraph uses Jev before durable semantic edges are written.",
        "sourceResponseFit": source_response_fit(run_id),
    }


def test_retired_evidence_judgment_is_not_exposed_from_native_think_metadata():
    stored = {
        "structured_extraction": {
            "think": {"kind": "OBSERVATION", "summary": "Retained Think."},
        },
        "needs_evidence": {
            "winner": "NO",
            "distribution": {"YES": 0.07, "NO": 0.93},
        },
    }

    exposed = adapter._public_think_metadata(stored)

    assert exposed == {"structured_extraction": stored["structured_extraction"]}
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
        "thinks": [{
            "name": "Expressive relation normalization",
            "body": content,
            "kind": "judgment",
            "concepts": ["Jev", "ThinkGraph", "probabilistic semantic edges"],
            "relationships": [{
                "subject": "Jev",
                "relation": FREEFORM_RELATION,
                "object": "ThinkGraph",
            }],
        }],
    }


def settle_payload(
    preparation: dict,
    *,
    output: dict | None = None,
    completed: dict[str, Any] | None = None,
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


def persist_legacy_v1_manifest(
    hybrid,
    completed: dict[str, Any],
    *,
    complete: bool,
) -> tuple[str, list[str]]:
    service = hybrid.get_service()
    workspace_id = service.store.get_or_create_workspace(completed["projectId"])
    pair_reference = hybrid._pair_reference(completed)
    facet = hybrid._LegacyRoleSplitThinkFacet(
        facet_id=f"legacy-{completed['runId']}",
        source_role="main",
        ordinal=0,
        name="Legacy aligned meaning",
        body="A settled legacy v1 Think remains readable without v2 reinterpretation.",
        kind="judgment",
        concepts=[],
        relations=[],
        pairings=[],
    )
    batch = hybrid._LegacyRoleSplitThinkBatch(
        batch_id=f"legacy-batch-{completed['runId']}", facets=[facet],
    )
    manifest = {
        "schema_version": hybrid._LEGACY_THINK_FACET_SCHEMA_VERSION,
        "batch": batch.model_dump(mode="json"),
        "source_pair": hybrid._source_pair(completed),
        "card_run": card_run(f"legacy-card-{completed['runId']}"),
    }
    previous = getattr(hybrid._intake_local, "context", None)
    hybrid._intake_local.context = {"suppress_graph": True}
    try:
        service.engine.remember_with_resolution(
            json.dumps(manifest, ensure_ascii=False, sort_keys=True),
            workspace_id=workspace_id,
            mtype=hybrid.MemoryType.EPISODIC,
            scope=hybrid.Scope.WORKSPACE,
            title="Legacy Think facet manifest",
            importance=0.0,
            keywords=[],
            metadata={"thinkgraph_facet_manifest": manifest},
            resolve_conflicts=False,
            subject_key=hybrid._manifest_subject_key(
                pair_reference, hybrid._LEGACY_THINK_FACET_SCHEMA_VERSION,
            ),
            claim_kind="think_manifest",
        )
        memory_ids: list[str] = []
        if complete:
            saved = service.engine.remember_with_resolution(
                facet.body,
                workspace_id=workspace_id,
                mtype=hybrid.MemoryType.EPISODIC,
                scope=hybrid.Scope.WORKSPACE,
                title=facet.name,
                importance=0.0,
                keywords=[],
                metadata={
                    "thinkgraph_facet": {
                        "kind": "JUDGMENT",
                        "summary": facet.body,
                    },
                    "thinkgraph_origin": {
                        "authority": "thinkgraph",
                        "schema_version": hybrid._LEGACY_THINK_FACET_SCHEMA_VERSION,
                    },
                },
                resolve_conflicts=False,
                subject_key=hybrid._facet_subject_key(
                    facet.facet_id, hybrid._LEGACY_THINK_FACET_SCHEMA_VERSION,
                ),
                claim_kind="think",
            )
            memory_ids.append(str(saved["id"]))
    finally:
        hybrid._intake_local.context = previous
    return pair_reference, memory_ids


def persist_direct_think(
    hybrid,
    *,
    workspace_id: str,
    entity_ids: list[str],
    entity_names: list[str],
    summary: str,
    run_id: str,
    kind: str = "OBSERVATION",
) -> str:
    service = hybrid.get_service()
    completed = payload(run_id)
    completed.update({
        "userMessage": f"User contribution for {run_id}.",
        "mainResponse": summary,
    })
    facet = hybrid._ProjectedThinkFacet(
        facet_id=f"facet-{run_id}",
        ordinal=0,
        name=f"{kind} Think",
        body=summary,
        kind={
            "DECISION": "judgment",
            "CLAIM": "belief",
            "PREDICTION": "hypothesis",
            "PROPOSAL": "plan",
            "CORRECTION": "judgment",
            "PROCEDURE": "plan",
        }.get(str(kind).upper(), str(kind).lower()) if (
            str(kind).upper() in {
                "DECISION", "CLAIM", "PREDICTION", "PROPOSAL", "CORRECTION", "PROCEDURE",
            } or str(kind).lower() in {
            "preference", "belief", "judgment", "question", "uncertainty",
            "plan", "hypothesis", "constraint", "observation",
            }
        ) else "observation",
        concepts=entity_names,
        relations=[],
        pairings=[],
    )
    batch = hybrid._ProjectedThinkBatch(
        thought_id=f"thought-{run_id}", facets=[facet],
    )
    hybrid._save_facet_manifest(
        service,
        workspace_id=workspace_id,
        completed=completed,
        batch=batch,
        card_run=card_run(run_id),
        pair_reference=hybrid._pair_reference(completed),
    )
    saved = hybrid._save_think_facets(
        service,
        workspace_id=workspace_id,
        completed=completed,
        batch=batch,
        card_run=card_run(run_id),
        pair_reference=hybrid._pair_reference(completed),
    )[0]
    memory_id = str(saved["id"])
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
            "confidence": 0.41,
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
    schema, prompt = adapter._llm_structured_contract("pair", {})
    relation = schema["$defs"]["ThinkGraphFacetRelationship"]["properties"]["relation"]
    assert relation["type"] == "string"
    assert "enum" not in relation
    assert "current_project_relationship_vocabulary" in relation["description"]
    assert "never exceed three words" in relation["description"]
    assert "nearest concrete reusable subject" in prompt
    assert "Never create a generic wrapper entity" in prompt
    assert "that framing belongs in the Think body" in prompt
    assert adapter.ThinkGraphStructuredRelation(
        source="Jev",
        relation=FREEFORM_RELATION,
        target="ThinkGraph",
    ).relation == FREEFORM_RELATION


def test_aligned_v2_schema_has_one_bounded_collection_and_rejects_old_buckets():
    schema, prompt = adapter._llm_structured_contract("pair", {})

    assert set(schema["properties"]) == {"thinks"}
    assert schema["required"] == ["thinks"]
    assert schema["properties"]["thinks"]["maxItems"] == 6
    assert "one combined conversation pair" in prompt
    assert "emit one Think, not speaker paraphrases" in prompt
    assert "User correction controls the final meaning" in prompt
    assert "canonical_subject_directory" in prompt
    with pytest.raises(adapter.ThinkGraphIntakeError, match="llm_structured_invalid"):
        adapter._extract_saved_card_facts(
            {"userFacets": [], "mainFacets": []},
            pair_text="pair",
            context={},
            card_run=card_run(),
        )


@pytest.mark.parametrize(
    "forbidden_field",
    [
        "id", "timestamp", "authority", "importance", "confidence",
        "probability", "provenance", "source_role",
    ],
)
def test_aligned_v2_rejects_model_authored_server_fields(forbidden_field):
    value = structured_output()
    value["thinks"][0][forbidden_field] = "forbidden"

    with pytest.raises(adapter.ThinkGraphIntakeError, match="llm_structured_invalid"):
        adapter._extract_saved_card_facts(
            value,
            pair_text="pair",
            context={},
            card_run=card_run(),
        )


def test_aligned_v2_enforces_zero_to_six_and_does_not_multiply_same_idea():
    same_idea = adapter.ThinkGraphFacetExtraction.model_validate(
        structured_output(content=(
            "Rocket Lab launch cadence matters only when revenue can be attributed to it; "
            "missing attribution remains uncertainty rather than counterevidence."
        ))
    )
    projected = adapter._project_structured_facts(same_idea, completed=payload())
    assert len(projected.facets) == 1
    assert projected.facets[0].body.startswith("Rocket Lab launch cadence")

    two_ideas = structured_output()
    two_ideas["thinks"].append({
        "name": "Separate evidence threshold",
        "body": "Use official results as the evidence threshold for attributable revenue.",
        "kind": "constraint",
        "concepts": ["Revenue attribution"],
        "relationships": [],
    })
    assert len(adapter.ThinkGraphFacetExtraction.model_validate(two_ideas).thinks) == 2
    assert adapter.ThinkGraphFacetExtraction.model_validate({"thinks": []}).thinks == []
    with pytest.raises(Exception):
        adapter.ThinkGraphFacetExtraction.model_validate({
            "thinks": [structured_output()["thinks"][0] for _ in range(7)],
        })


def test_think_size_is_semantic_and_preserves_simple_and_qualified_meaning():
    _schema, prompt = adapter._llm_structured_contract("pair", {})
    assert "natural size of its meaning" in prompt
    assert "Atomicity is semantic, not length" in prompt
    assert "sentence, word, character, token, or record-count target" in prompt

    simple_body = "Use attributable revenue to test the launch-cadence thesis."
    qualified_body = (
        "Launch cadence supports the thesis only when revenue is attributable to it. "
        "If attribution remains missing, preserve that gap as uncertainty rather than "
        "treating it as counterevidence, because the absent link is the falsifier still "
        "to be tested rather than a resolved negative conclusion."
    )
    extraction = adapter.ThinkGraphFacetExtraction.model_validate({
        "thinks": [
            {"name": "Attributable revenue test", "body": simple_body,
             "kind": "plan", "concepts": [], "relationships": []},
            {"name": "Missing attribution remains uncertainty", "body": qualified_body,
             "kind": "uncertainty", "concepts": [], "relationships": []},
        ],
    })
    projected = adapter._project_structured_facts(extraction, completed=payload())
    assert [facet.body for facet in projected.facets] == [simple_body, qualified_body]


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


def test_prepare_is_nonpersistent_without_regex_jev_or_graph_mutation(hybrid):
    prepared = hybrid.prepare_completed_pair(payload())
    assert prepared["pairMemoryId"].startswith("pair_")
    assert prepared["pairReference"] == prepared["pairMemoryId"]
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


def test_complete_directory_keeps_37_plus_11_bindings_and_one_logical_name(
    hybrid, monkeypatch: pytest.MonkeyPatch,
):
    from app.python_models.data_anchor import assemble_canonical_subject_directory

    think_subjects = [
        {
            "authority": "ThinkGraph",
            "nativeId": f"think-{index}",
            "canonicalName": "Rocket Lab" if index == 0 else f"Think Entity {index}",
            "entityKind": "person_or_concept",
        }
        for index in range(37)
    ]
    know_subjects = [
        {
            "authority": "KnowGraph",
            "nativeId": f"know-{index}",
            "canonicalName": "Rocket Lab" if index == 0 else f"Know Entity {index}",
            "entityKind": "Entity",
        }
        for index in range(11)
    ]
    directory = assemble_canonical_subject_directory(
        "project-one",
        {"complete": True, "count": 37, "revision": "think-37",
         "subjects": think_subjects},
        {"complete": True, "count": 11, "revision": "know-11",
         "subjects": know_subjects},
    )
    monkeypatch.setattr(
        hybrid, "_subject_directory_for_project", lambda _project: directory,
    )

    prepared = hybrid.prepare_completed_pair(payload("directory-37-plus-11"))
    received = prepared["enrichmentInput"]["canonical_subject_directory"]
    assert received["counts"] == {"ThinkGraph": 37, "KnowGraph": 11, "total": 48}
    assert len(received["subjects"]) == 48
    assert sum(item["canonicalName"] == "Rocket Lab" for item in received["subjects"]) == 2
    assert all(set(item) == {
        "canonicalName", "entityKind", "authority", "nativeId",
    } for item in received["subjects"])

    extraction = hybrid.ThinkGraphFacetExtraction.model_validate({
        "thinks": [{
            "name": "Rocket Lab thesis boundary",
            "body": "Rocket Lab requires attributable revenue before launch cadence supports the thesis.",
            "kind": "constraint",
            "concepts": ["Rocket Lab"],
            "relationships": [],
        }],
    })
    projected = hybrid._project_structured_facts(extraction, completed=payload())
    assert projected.facets[0].concepts == ["Rocket Lab"]
    assert "think-0" not in projected.facets[0].body
    assert "know-0" not in projected.facets[0].body


def test_same_idea_persists_once_and_two_independent_ideas_persist_twice(hybrid):
    same_prepared = hybrid.prepare_completed_pair(payload("same-idea"))
    same_output = structured_output(content=(
        "Jev remains the sole durable relationship classifier for ThinkGraph semantics."
    ))
    same = hybrid.settle_completed_pair(
        settle_payload(
            same_prepared,
            output=same_output,
            completed=payload("same-idea"),
        ),
        classifier=lambda *_args, **_kwargs: decision("QUALIFIES"),
    )
    assert len(same["thinkMemoryIds"]) == 1

    independent_pair = payload("two-independent")
    two_prepared = hybrid.prepare_completed_pair(independent_pair)
    two_output = structured_output(content=(
        "Jev remains the sole durable relationship classifier for ThinkGraph semantics."
    ))
    two_output["thinks"].append({
        "name": "Keep graph claims epistemically qualified",
        "body": "Unresolved graph claims remain uncertainty until evidence resolves them.",
        "kind": "uncertainty",
        "concepts": ["ThinkGraph"],
        "relationships": [],
    })
    two = hybrid.settle_completed_pair(
        settle_payload(
            two_prepared,
            output=two_output,
            completed=independent_pair,
        ),
        classifier=lambda *_args, **_kwargs: decision("QUALIFIES"),
    )
    assert len(two["thinkMemoryIds"]) == 2
    assert len(set(two["thinkMemoryIds"])) == 2
    two_memories = hybrid.get_service().store.get_memories(two["thinkMemoryIds"])
    origins = [memory.metadata["thinkgraph_origin"] for memory in two_memories.values()]
    assert len({origin["thought_id"] for origin in origins}) == 1
    assert len({origin["facet_id"] for origin in origins}) == 2
    assert {origin["completed_pair_reference"] for origin in origins} == {
        two_prepared["pairReference"],
    }
    assert {origin["completed_at"] for origin in origins} == {
        independent_pair["mainMessageAt"],
    }


def test_user_correction_keeps_only_final_meaning_and_main_only_filler_can_be_zero(hybrid):
    corrected_pair = payload("correction")
    corrected_pair.update({
        "userMessage": "Missing revenue attribution is uncertainty, not evidence against Rocket Lab.",
        "mainResponse": "Understood: missing attribution remains uncertainty rather than counterevidence.",
    })
    prepared = hybrid.prepare_completed_pair(corrected_pair)
    output = {
        "thinks": [{
            "name": "Missing attribution remains uncertainty",
            "body": (
                "Missing revenue attribution remains uncertainty and must not be treated "
                "as evidence against Rocket Lab."
            ),
            "kind": "correction",
            "concepts": ["Rocket Lab", "Revenue attribution"],
            "relationships": [],
        }],
    }
    settled = hybrid.settle_completed_pair(
        settle_payload(prepared, output=output, completed=corrected_pair),
    )
    memory = hybrid.get_service().store.get_memory(settled["thinkMemoryIds"][0])
    assert memory is not None
    assert "evidence against Rocket Lab" in memory.content
    assert "attribution disproves" not in memory.content

    empty_pair = payload("unaccepted-main-only")
    empty_prepared = hybrid.prepare_completed_pair(empty_pair)
    empty = hybrid.settle_completed_pair(
        settle_payload(
            empty_prepared,
            output={"thinks": []},
            completed=empty_pair,
        ),
    )
    assert empty["thinkMemoryIds"] == []
    repeated = hybrid.prepare_completed_pair(empty_pair)
    assert repeated["intakeOperation"] == "noop"
    assert repeated["structuredExtractionRequired"] is False


def test_one_think_links_three_canonical_entities_without_record_multiplication(hybrid):
    completed = payload("three-entity-one-think")
    prepared = hybrid.prepare_completed_pair(completed)
    output = {
        "thinks": [{
            "name": "Launch cadence requires revenue attribution",
            "body": (
                "Rocket Lab's launch cadence matters to the thesis only when revenue can "
                "be attributed to it."
            ),
            "kind": "constraint",
            "concepts": ["Rocket Lab", "Launch cadence", "Revenue attribution"],
            "relationships": [
                {"subject": "Rocket Lab", "relation": "HAS_PART", "object": "Launch cadence"},
                {"subject": "Launch cadence", "relation": "DEPENDS_ON", "object": "Revenue attribution"},
            ],
        }],
    }
    settled = hybrid.settle_completed_pair(
        settle_payload(prepared, output=output, completed=completed),
        classifier=lambda *_args, **_kwargs: decision("QUALIFIES"),
    )

    assert len(settled["thinkMemoryIds"]) == 1
    service = hybrid.get_service()
    workspace_id = service.store.get_or_create_workspace("project-one")
    incidences = service.store.list_memory_entities(
        hybrid.SearchFilter(workspace_id=workspace_id),
        memory_ids=settled["thinkMemoryIds"],
    )
    linked_names = {
        str(hybrid._entity_row(
            service.store, str(row["entity_id"]),
        )["name"])
        for row in incidences
        if row["source_kind"] == "structured_extractor"
    }
    assert linked_names == {"Rocket Lab", "Launch cadence", "Revenue attribution"}


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
    assert "one combined conversation pair" in exact_extractor_input
    assert "Equal canonicalName values across authority bindings" in exact_extractor_input
    assert not any(
        sentinel in exact_extractor_input
        for sentinel in excluded_runtime_sentinels
    )

    aligned_body = f"{visible_user} {visible_main}"
    output = {
        "thinks": [{
            "name": "Current Jev exchange",
            "body": aligned_body,
            "kind": "question",
            "concepts": ["Jev"],
            "relationships": [],
        }],
    }
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
        "pairMemoryId": prepared["pairMemoryId"],
        "structuredOutput": output,
        "cardRun": authorized_card_run,
    })
    memories = hybrid.get_service().store.get_memories(settled["thinkMemoryIds"])
    assert len(memories) == 1
    saved_semantics = json.dumps([{
        "summary": memory.content,
        "title": memory.title,
        "keywords": memory.keywords,
        "thinkgraph_facet": memory.metadata["thinkgraph_facet"],
    } for memory in memories.values()], ensure_ascii=False, sort_keys=True)

    assert visible_user in saved_semantics
    assert visible_main in saved_semantics
    assert all("source_response_fit" not in memory.metadata for memory in memories.values())
    assert not any(
        sentinel in saved_semantics
        for sentinel in excluded_runtime_sentinels
    )
    assert not any(
        value in saved_semantics
        for value in authorized_card_run.values()
    )
    saved_memory = next(iter(memories.values()))
    origin = saved_memory.metadata["thinkgraph_origin"]
    assert "source_role" not in origin
    assert origin["source_message_refs"] == {
        "user": {
            "message_id": completed["userMessageId"],
            "event_at": completed["userMessageAt"],
        },
        "main": {
            "message_id": completed["mainMessageId"],
            "event_at": completed["mainMessageAt"],
        },
    }
    assert origin["completed_at"] == completed["mainMessageAt"]
    assert saved_memory.valid_from == hybrid._source_event_timestamp(completed, "main")
    assert origin["authority"] == "thinkgraph"
    assert origin["writer"] == "saved_thinkgraph_card"
    assert origin["completed_pair_reference"] == prepared["pairReference"]


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
    output["thinks"][0]["relationships"][0]["relation"] = "amplifies"

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


@pytest.mark.parametrize("winner", ["QUALIFIES", "NONE"])
def test_novel_proposal_does_not_expand_vocabulary_unless_it_wins(
    hybrid, winner,
):
    completed = payload(f"novel-loses-{winner.lower()}")
    prepared = hybrid.prepare_completed_pair(completed)
    output = structured_output(content="A proposed relationship may lose Jev Choice.")
    output["thinks"][0]["relationships"][0]["relation"] = "amplifies"

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


def test_project_relationship_vocabulary_reserves_control_choice_capacity(hybrid):
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
    assert len(plan["choices"]) == 255
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
    assert len(novel["choices"]) == 255

    vocabulary_252 = (*vocabulary_251, "AMPLIFIES")
    reused = adapter.relationship_choice_plan("amplifies", vocabulary_252)
    assert reused["proposal_status"] == "reused_canonical"
    assert reused["novel_candidate"] == ""
    assert len(reused["choices"]) == 255


def test_oversized_legacy_vocabulary_is_readable_but_not_classified(hybrid):
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
    assert called is False
    assert think_results[0]["status"] == "jev_failed"
    assert think_results[0]["error"] == "thinkgraph_relationship_choice_capacity_exceeded"

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
    assert repeated["pairMemoryId"] == settled["pairReference"]
    assert repeated["thinkMemoryIds"] == settled["thinkMemoryIds"]
    assert repeated["pairReference"] == first["pairReference"]
    assert repeated["intakeOperation"] == "noop"
    assert repeated["structuredExtractionRequired"] is False
    assert repeated["preparation"] == {"status": "duplicate_noop"}
    duplicate_classifier_calls = 0

    def unexpected_classifier(*_args, **_kwargs):
        nonlocal duplicate_classifier_calls
        duplicate_classifier_calls += 1
        return decision("QUALIFIES")

    duplicate_settle = hybrid.settle_completed_pair(
        settle_payload(first), classifier=unexpected_classifier,
    )
    assert duplicate_settle["intakeOperation"] == "noop"
    assert duplicate_settle["thinkMemoryIds"] == settled["thinkMemoryIds"]
    assert duplicate_classifier_calls == 0


def test_incomplete_v2_manifest_resumes_only_missing_facets_without_extraction(
    hybrid, monkeypatch: pytest.MonkeyPatch,
):
    completed = payload("v2-resume")
    extraction = adapter.ThinkGraphFacetExtraction.model_validate({
        "thinks": [
            structured_output(content="First aligned idea.")["thinks"][0],
            {
                "name": "Second aligned idea",
                "body": "Second independently reusable aligned idea.",
                "kind": "plan",
                "concepts": [],
                "relationships": [],
            },
        ],
    })
    batch = hybrid._project_structured_facts(extraction, completed=completed)
    service = hybrid.get_service()
    workspace_id = service.store.get_or_create_workspace("project-one")
    pair_reference = hybrid._pair_reference(completed)
    hybrid._save_facet_manifest(
        service,
        workspace_id=workspace_id,
        completed=completed,
        batch=batch,
        card_run=card_run("v2-resume-card"),
        pair_reference=pair_reference,
    )
    first_only = hybrid._ProjectedThinkBatch(
        thought_id=batch.thought_id,
        facets=[batch.facets[0]],
    )
    first_id = hybrid._save_think_facets(
        service,
        workspace_id=workspace_id,
        completed=completed,
        batch=first_only,
        card_run=card_run("v2-resume-card"),
        pair_reference=pair_reference,
    )[0]["id"]

    resumed = hybrid.prepare_completed_pair(completed)
    assert resumed["intakeOperation"] == "resume"
    assert resumed["structuredExtractionRequired"] is False
    assert resumed["thinkMemoryIds"] == [first_id]
    monkeypatch.setattr(
        hybrid,
        "_extract_saved_card_facts",
        lambda *_args, **_kwargs: pytest.fail("resume must not extract again"),
    )
    original_remember_many = service.engine.remember_many
    written_batch_sizes: list[int] = []

    def remember_missing_only(specs, **kwargs):
        written_batch_sizes.append(len(specs))
        return original_remember_many(specs, **kwargs)

    monkeypatch.setattr(service.engine, "remember_many", remember_missing_only)
    settled = hybrid.settle_completed_pair({
        **completed,
        "pairMemoryId": pair_reference,
    })

    assert written_batch_sizes == [1]
    assert settled["thinkMemoryIds"][0] == first_id
    assert len(settled["thinkMemoryIds"]) == 2
    repeated = hybrid.prepare_completed_pair(completed)
    assert repeated["intakeOperation"] == "noop"
    assert repeated["thinkMemoryIds"] == settled["thinkMemoryIds"]


def test_other_project_completed_v1_is_read_only_and_never_reextracted_as_v2(hybrid):
    completed = payload("other-project-v1")
    completed["projectId"] = "other-project"
    pair_reference, legacy_ids = persist_legacy_v1_manifest(
        hybrid, completed, complete=True,
    )
    service = hybrid.get_service()
    count_before = service.store.count_memories()

    prepared = hybrid.prepare_completed_pair(completed)
    assert prepared["schemaVersion"] == hybrid._LEGACY_THINK_FACET_SCHEMA_VERSION
    assert prepared["pairReference"] == pair_reference
    assert prepared["thinkMemoryIds"] == legacy_ids
    assert prepared["intakeOperation"] == "noop"
    assert prepared["structuredExtractionRequired"] is False
    assert service.store.count_memories() == count_before
    workspace_id = service.store.get_or_create_workspace("other-project")
    assert hybrid._existing_facet_manifest(
        service.store,
        workspace_id=workspace_id,
        pair_reference=pair_reference,
        schema_version=hybrid._THINK_FACET_SCHEMA_VERSION,
    ) is None


def test_other_project_incomplete_v1_fails_precisely_without_writing(hybrid):
    completed = payload("other-project-incomplete-v1")
    completed["projectId"] = "other-project"
    persist_legacy_v1_manifest(hybrid, completed, complete=False)
    count_before = hybrid.get_service().store.count_memories()

    with pytest.raises(
        hybrid.ThinkGraphIntakeError,
        match="thinkgraph_legacy_v1_manifest_incomplete",
    ):
        hybrid.prepare_completed_pair(completed)
    assert hybrid.get_service().store.count_memories() == count_before


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
        kind="DECISION",
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
    assert snapshot["latest_prior_thinks"][0]["kind"] == "JUDGMENT"
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
        "mainMessageAt": "2026-09-23T12:02:00Z",
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
    output["thinks"][0]["concepts"] = ["Alpha", "Beta"]
    output["thinks"][0]["relationships"] = [{
        "subject": "Alpha",
        "relation": "supplies a bounded current input to",
        "object": "Beta",
    }]
    original_latest = hybrid._latest_endpoint_think
    original_save = hybrid._save_think_facets
    current_think_written = False

    def latest_before_write(*args, **kwargs):
        assert current_think_written is False
        return original_latest(*args, **kwargs)

    def mark_current_write(*args, **kwargs):
        nonlocal current_think_written
        current_think_written = True
        return original_save(*args, **kwargs)

    monkeypatch.setattr(hybrid, "_latest_endpoint_think", latest_before_write)
    monkeypatch.setattr(hybrid, "_save_think_facets", mark_current_write)
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

    think = service.store.get_memory(settled["thinkMemoryId"])
    assert think is not None
    assert think.mtype == hybrid.MemoryType.EPISODIC
    assert think.metadata["thinkgraph_relationships"][0]["relation"] == (
        FREEFORM_RELATION
    )
    structured_think = think.metadata["thinkgraph_facet"]
    assert structured_think["kind"] == "JUDGMENT"
    assert structured_think["relationship_observations"]
    origin = think.metadata["thinkgraph_origin"]
    assert origin["authority"] == "thinkgraph"
    assert origin["writer"] == "saved_thinkgraph_card"
    assert "source_role" not in origin
    assert origin["source_message_refs"] == {
        "user": {
            "message_id": payload()["userMessageId"],
            "event_at": payload()["userMessageAt"],
        },
        "main": {
            "message_id": payload()["mainMessageId"],
            "event_at": payload()["mainMessageAt"],
        },
    }
    assert origin["completed_at"] == payload()["mainMessageAt"]
    assert origin["completed_pair_reference"] == prepared["pairReference"]
    assert "source_reference" not in think.metadata
    assert "timestamp" not in structured_think
    native_read = hybrid.inspect("project-one", jev.id)["entity"]
    direct_think = next(
        item for item in native_read["evidence"]
        if item["memory_id"] == settled["thinkMemoryId"]
    )
    assert direct_think["excerpt"] == "Jev normalizes expressive graph relations."
    assert direct_think["metadata"]["thinkgraph_relationships"][0][
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
        return decision("QUALIFIES" if args[5] else "INVALID_NODE_PAIR")

    first_prepared = hybrid.prepare_completed_pair(payload())
    first = hybrid.settle_completed_pair(
        settle_payload(first_prepared), classifier=classify,
    )
    later = payload("run-two")
    later.update({
        "completedAt": "2026-09-23T12:05:00Z",
        "mainMessageAt": "2026-09-23T12:05:00Z",
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
    direct_think_ids = [first["thinkMemoryId"], second["thinkMemoryId"]]
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
        return decision("QUALIFIES" if args[5] else "INVALID_NODE_PAIR")

    first_preparation = hybrid.prepare_completed_pair(payload())
    first = hybrid.settle_completed_pair(
        settle_payload(first_preparation), classifier=classify,
    )

    later = payload("run-two")
    later.update({
        "completedAt": "2026-09-23T12:05:00Z",
        "mainMessageAt": "2026-09-23T12:05:00Z",
        "userMessage": "Revisit Jev and ThinkGraph in this later exchange.",
        "mainResponse": "Record the current temporal Think without rewriting history.",
    })
    second_preparation = hybrid.prepare_completed_pair(later)
    second_payload = settle_payload(second_preparation, completed=later)
    second_payload["cardRun"] = card_run("thinkgraph-run-two")
    second = hybrid.settle_completed_pair(second_payload, classifier=classify)

    assert first["thinkMemoryId"]
    assert second["thinkMemoryId"]
    assert first["thinkMemoryId"] != second["thinkMemoryId"]
    service = hybrid.get_service()
    memories = service.store.get_memories([
        first["thinkMemoryId"], second["thinkMemoryId"],
    ])
    assert len(memories) == 2
    assert all(memory.mtype == hybrid.MemoryType.EPISODIC for memory in memories.values())
    assert {
        memory.metadata["thinkgraph_facet"]["summary"]
        for memory in memories.values()
    } == {"Jev normalizes expressive graph relations."}
    assert all(
        "note_hash" not in memory.metadata["thinkgraph_facet"]
        for memory in memories.values()
    )


def test_structured_only_concept_can_become_durable_after_jev_accepts(hybrid):
    completed = payload("structured-discovery")
    assert "Execution Risk" not in completed["userMessage"]
    assert "Execution Risk" not in completed["mainResponse"]
    prepared = hybrid.prepare_completed_pair(completed)
    output = structured_output(
        content="Neutron schedule uncertainty creates execution risk for the thesis."
    )
    output["thinks"][0]["concepts"] = ["Neutron", "Execution Risk"]
    output["thinks"][0]["relationships"] = [{
        "subject": "Neutron",
        "relation": "creates schedule-sensitive uncertainty represented by",
        "object": "Execution Risk",
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
def test_unaccepted_saved_card_pair_keeps_one_think_but_creates_no_nodes_or_edges(
    hybrid, winner,
):
    prepared = hybrid.prepare_completed_pair(payload())
    output = structured_output(content="Discard this weak structured proposal.")
    output["thinks"][0]["concepts"] = ["Jev", "Transient Sentence Fragment"]
    output["thinks"][0]["relationships"] = [{
        "subject": "Jev",
        "relation": "appears beside",
        "object": "Transient Sentence Fragment",
    }]
    settled = hybrid.settle_completed_pair(
        settle_payload(prepared, output=output),
        classifier=lambda *_args, **_kwargs: decision(winner),
    )
    assert settled["relationships"]
    assert all(item["status"] == "no_edge" for item in settled["relationships"])
    assert all(item["winner"] == winner for item in settled["relationships"])
    assert settled["thinkMemoryId"]
    think = hybrid.get_service().store.get_memory(settled["thinkMemoryId"])
    assert think is not None
    assert think.mtype == hybrid.MemoryType.EPISODIC
    assert hybrid._think_metadata(think) is not None
    entities, edges = entities_and_edges(hybrid)
    assert entities == []
    assert edges == []
    assert all(entity.name != "Transient Sentence Fragment" for entity in entities)
    assert all(edge.relation != "INVALID_NODE_PAIR" for edge in edges)


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
        return decision("QUALIFIES" if relationship_proposal else "NONE")

    prepared = hybrid.prepare_completed_pair(payload())
    service = hybrid.get_service()
    attempted_batch_sizes: list[int] = []

    def fail_think(specs, **_kwargs):
        attempted_batch_sizes.append(len(specs))
        raise RuntimeError("think_store_unavailable")

    monkeypatch.setattr(service.engine, "remember_many", fail_think)
    with pytest.raises(
        hybrid.ThinkGraphIntakeError, match="thinkgraph_think_store_failed",
    ):
        hybrid.settle_completed_pair(
            settle_payload(prepared),
            classifier=classify,
        )
    entities, edges = entities_and_edges(hybrid)
    assert entities == []
    assert edges == []
    assert attempted_batch_sizes == [1]
    assert service.store.count_memories() == 1
    manifest = hybrid._existing_facet_manifest(
        service.store,
        workspace_id=service.store.get_or_create_workspace("project-one"),
        pair_reference=prepared["pairReference"],
        schema_version=hybrid._THINK_FACET_SCHEMA_VERSION,
    )
    assert manifest is not None
    batch, _card_run, schema_version = hybrid._manifest_batch(manifest)
    assert schema_version == hybrid._THINK_FACET_SCHEMA_VERSION
    assert all(hybrid._existing_facet_memory(
        service.store,
        workspace_id=service.store.get_or_create_workspace("project-one"),
        facet_id=facet.facet_id,
        schema_version=schema_version,
    ) is None for facet in batch.facets)


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


def test_structured_writer_gets_complete_subject_directory_not_prior_think_bodies(
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
    output["thinks"][0]["concepts"] = ["Jev", "ThinkGraph"]
    output["thinks"][0]["relationships"] = []

    completed = payload("run-two")
    completed.update({
        "completedAt": "2026-09-23T12:01:00Z",
        "mainMessageAt": "2026-09-23T12:01:00Z",
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
    assert all(set(item) == {
        "authority", "nativeId", "canonicalName", "entityKind",
    } for item in directory["subjects"])
    assert sum(
        item["canonicalName"] == "Jev" for item in directory["subjects"]
    ) == 2
    assert "canonical_subject_directory" in prepared["enrichmentPrompt"]
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
    assert len(settled["thinkMemoryIds"]) == 1
    aligned = service.store.get_memory(settled["thinkMemoryIds"][0])
    assert aligned is not None
    assert aligned.metadata["thinkgraph_facet"]["concepts"] == [
        "Jev", "ThinkGraph",
    ]
    assert "know-jev" not in aligned.content
    assert jev.id not in aligned.content
    assert thinkgraph.id not in aligned.content
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
    assert hybrid.inspect("project-one", settled["thinkMemoryId"])["memory"]["content"]
