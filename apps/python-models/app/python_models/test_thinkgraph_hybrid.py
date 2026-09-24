"""Focused proof for the real Engraphis-owned hybrid ThinkGraph lifecycle."""
from __future__ import annotations

import json
from pathlib import Path
import threading
import time
from typing import Any

import pytest

from app.python_models import engraphis as adapter


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


def decision(winner: str = "REFINES") -> dict[str, Any]:
    distribution = {name: 0.0 for name in adapter.THINKGRAPH_RELATIONSHIPS}
    distribution[winner] = 0.76
    distribution["NONE"] = 0.14 if winner != "NONE" else 0.76
    distribution["INSUFFICIENT_CONTEXT"] = 0.10
    if winner == "NONE":
        distribution["REFINES"] = 0.14
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
    fast: dict,
    *,
    output: dict | None = None,
    completed: dict[str, str] | None = None,
) -> dict:
    return {
        **(completed or payload()),
        "pairMemoryId": fast["pairMemoryId"],
        "fastTurnHeat": fast["fast"]["turnHeat"],
        "fastActiveTargets": fast["fast"]["activeEnrichmentTargets"],
        "turnStartPriorThoughtSnapshot": fast["turnStartPriorThoughtSnapshot"],
        "structuredOutput": output or structured_output(),
        "cardRun": card_run(),
    }


def entities_and_edges(hybrid) -> tuple[list[Any], list[Any]]:
    service = hybrid.get_service()
    entities = service.store.list_entities()
    edges = service.store.neighbors([entity.id for entity in entities]) if entities else []
    return entities, edges


def test_jev_choice_requires_complete_vocabulary_and_uses_winner_probability():
    probabilities = {name: 0.0 for name in adapter.THINKGRAPH_RELATIONSHIPS}
    probabilities.update(
        CONTRADICTS=0.52,
        REFINES=0.12,
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
    assert tuple(parsed["distribution"]) == adapter.THINKGRAPH_RELATIONSHIPS

    invalid_mass = {name: 0.0 for name in adapter.THINKGRAPH_RELATIONSHIPS}
    invalid_mass.update(
        REFINES=0.55,
        NONE=0.05,
        INSUFFICIENT_CONTEXT=0.05,
        INVALID_NODE_PAIR=0.35,
    )
    rejected = adapter._validate_jev_response({
        "answers": {"relationship": {
            "type": "choice",
            "choice": "REFINES",
            "probabilities": invalid_mass,
        }}
    })
    assert rejected["relationship_strength"] == pytest.approx(0.55)
    assert adapter._decision_is_accepted(rejected) is False

    probabilities.pop("ASSUMES")
    with pytest.raises(adapter.JevRelationshipError, match="response_invalid"):
        adapter._validate_jev_response({
            "answers": {"relationship": {
                "type": "choice",
                "choice": "CONTRADICTS",
                "probabilities": probabilities,
            }}
        })


def test_native_llm_structured_relation_remains_freeform():
    schema, _prompt = adapter._llm_structured_contract("pair", {})
    relation = schema["$defs"]["ThinkGraphStructuredRelation"]["properties"]["relation"]
    assert relation["type"] == "string"
    assert "enum" not in relation
    assert adapter.ThinkGraphStructuredRelation(
        source="Jev",
        relation=FREEFORM_RELATION,
        target="ThinkGraph",
    ).relation == FREEFORM_RELATION


@pytest.mark.parametrize(
    "winner", ["NONE", "INSUFFICIENT_CONTEXT", "INVALID_NODE_PAIR"],
)
def test_fast_rejection_keeps_pair_memory_without_leaking_nodes(hybrid, winner):
    fast = hybrid.begin_completed_pair(
        payload(), classifier=lambda *_args, **_kwargs: decision(winner),
    )
    assert hybrid.inspect("project-one", fast["pairMemoryId"])["memory"]["content"].startswith(
        "USER:\nJev evaluates ThinkGraph"
    )
    assert all(item["status"] == "no_edge" for item in fast["fast"]["relationships"])
    assert all(item["winner"] == winner for item in fast["fast"]["relationships"])
    entities, edges = entities_and_edges(hybrid)
    assert entities == []
    assert edges == []
    assert all(edge.relation != "INVALID_NODE_PAIR" for edge in edges)


def test_native_engraphis_noop_skips_repeat_regex_jev_and_card_enrichment(hybrid):
    classifier_calls = 0

    def classify(*_args, **_kwargs):
        nonlocal classifier_calls
        classifier_calls += 1
        return decision("REFINES")

    first = hybrid.begin_completed_pair(payload(), classifier=classify)
    calls_after_first = classifier_calls
    repeated = hybrid.begin_completed_pair(payload(), classifier=classify)

    assert first["intakeOperation"] == "add"
    assert first["enrichmentRequired"] is True
    assert calls_after_first > 0
    assert repeated == {
        "ok": True,
        "projectId": "project-one",
        "pairMemoryId": first["pairMemoryId"],
        "intakeOperation": "noop",
        "enrichmentRequired": False,
        "revision": first["revision"],
        "revisionChanged": False,
        "fast": {
            "status": "duplicate_noop",
            "opportunityCount": 0,
            "relationships": [],
            "failures": [],
            "changedNodeIds": [],
            "changedEdgeIds": [],
            "turnHeat": {},
            "topActiveNodes": [],
        },
    }
    assert classifier_calls == calls_after_first


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
            result = decision("REFINES")
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
        decision=decision("REFINES"),
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
        decision=decision("IMPLIES"),
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


def test_canonical_reuse_marks_every_accepted_endpoint_for_active_enrichment(
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
        decision=decision("REFINES"),
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

    local = hybrid._IntakeLocalGraphStore()
    local.opportunities.append({
        "id": "intake_edge_0000",
        "source": {"name": "Alpha", "type": "person_or_concept"},
        "target": {"name": "Beta", "type": "person_or_concept"},
        "native_relation": "co_occurs",
        "native_weight": 0.5,
        "provenance": {},
    })
    monkeypatch.setattr(
        hybrid,
        "_enumerate_native_regex_opportunities",
        lambda *_args, **_kwargs: (None, local),
    )
    calls: list[dict[str, Any]] = []

    def classify(source, target, _payload, _fact, context, proposal):
        calls.append({
            "source": source,
            "target": target,
            "context": context,
            "proposal": proposal,
        })
        return decision("REFINES")

    completed = payload("active-target-run")
    completed.update({
        "completedAt": "2026-09-23T12:02:00Z",
        "userMessage": "Alpha now supplies a bounded input to Beta.",
        "mainResponse": "Beta uses that input for the current project decision.",
    })
    fast = hybrid.begin_completed_pair(completed, classifier=classify)

    targets = {
        item["canonicalName"]: item
        for item in fast["fast"]["activeEnrichmentTargets"]
    }
    assert targets == {
        "Alpha": {
            "nativeId": prior["source"],
            "canonicalName": "Alpha",
            "status": "EXISTING",
        },
        "Beta": {
            "nativeId": targets["Beta"]["nativeId"],
            "canonicalName": "Beta",
            "status": "NEW",
        },
    }
    enrichment = fast["enrichmentInput"]
    assert set(enrichment) == {
        "exact_user_message",
        "exact_main_response",
        "current_turn_enrichment_targets",
        "current_graph_shape",
        "current_turn_accepted_relationships",
    }
    assert {
        item["canonicalName"]: item["structuredNoteRule"]
        for item in enrichment["current_turn_enrichment_targets"]
    } == {
        "Alpha": "APPEND_CURRENT_PAIR_THOUGHT",
        "Beta": "CREATE_FIRST_CURRENT_PAIR_THOUGHT",
    }
    prompt_targets = {
        item["canonicalName"]: item
        for item in enrichment["current_turn_enrichment_targets"]
    }
    assert all("existingNotes" not in item for item in prompt_targets.values())
    assert "Alpha already has durable project context." not in fast["enrichmentPrompt"]
    graph_shape = enrichment["current_graph_shape"]
    assert graph_shape["scope"] == "active_endpoints_plus_direct_live_jev_neighbors"
    assert {node["canonicalName"] for node in graph_shape["nodes"]} == {
        "Alpha", "Beta", "Prior Context",
    }
    assert all(set(node) == {
        "nativeId", "canonicalName", "nodeType", "activeEndpoint",
    } for node in graph_shape["nodes"])
    assert any(
        edge["source"]["nativeId"] == prior["source"]
        and edge["target"]["nativeId"] == prior["target"]
        and edge["canonicalRelationship"] == "REFINES"
        for edge in graph_shape["edges"]
    )
    assert all("distribution" not in edge for edge in graph_shape["edges"])
    current_relationships = enrichment["current_turn_accepted_relationships"]
    assert current_relationships == [{
        "source": {"nativeId": prior["source"], "canonicalName": "Alpha"},
        "target": {"nativeId": targets["Beta"]["nativeId"], "canonicalName": "Beta"},
        "canonicalRelationship": "REFINES",
        "relationshipStrength": pytest.approx(0.76),
    }]
    assert not {
        "provider", "requested_model", "resolved_model", "usage", "edge_id",
        "opportunity_index",
    }.intersection(current_relationships[0])
    assert "current_graph_shape" in fast["enrichmentPrompt"]
    assert "existingNotes" not in fast["enrichmentPrompt"]
    assert fast["turnStartPriorThoughtSnapshot"][prior["source"]][
        "memory_id"
    ] == prior_note_id
    assert prior_note_id not in fast["enrichmentPrompt"]
    fast_call = next(
        item for item in calls
        if item["source"] == "Alpha" and item["target"] == "Beta"
        and not item["proposal"]
    )
    assert any(
        item["id"] == prior["source"] and item["focus"]
        for item in fast_call["context"]["nodes"]
    )
    assert any(
        item["memory_id"] == prior_note_id
        for item in fast_call["context"]["latest_prior_thoughts"]
    )
    assert "notes" not in fast_call["context"]
    assert any(
        item["id"] == prior["edge_id"]
        for item in fast_call["context"]["incident_edges"]
    )

    output = structured_output(content="Alpha now supplies a bounded input to Beta.")
    output["facts"][0]["entities"] = ["Alpha", "Beta"]
    output["facts"][0]["relations"] = [{
        "source": "Alpha",
        "relation": "supplies a bounded current input to",
        "target": "Beta",
    }]
    current_turn_note_id = hybrid._persist_note(
        service,
        project="project-one",
        workspace_id=workspace_id,
        entity_id=prior["source"],
        entity_name="Alpha",
        note=hybrid.ThinkGraphNodeNote(
            kind="OBSERVATION",
            summary="Alpha current T3 Thought must not become its own prior context.",
        ),
        card_run=card_run("simulated-current-turn"),
    )

    def reject_post_write_latest_lookup(*_args, **_kwargs):
        raise AssertionError("settled Jev re-queried latest Thought after T3 write")

    monkeypatch.setattr(
        hybrid, "_latest_endpoint_thought", reject_post_write_latest_lookup,
    )
    settled = hybrid.settle_completed_pair(
        settle_payload(fast, output=output, completed=completed),
        classifier=classify,
    )

    entities = service.store.list_entities()
    assert sum(entity.name == "Alpha" for entity in entities) == 1
    assert sum(entity.name == "Beta" for entity in entities) == 1
    beta_id = targets["Beta"]["nativeId"]
    beta_read = hybrid.inspect("project-one", beta_id)["entity"]
    assert any(
        "Alpha now supplies" in str(item.get("excerpt") or "")
        for item in beta_read["evidence"]
    )
    assert len(calls) == 2
    settled_call = next(item for item in calls if item["proposal"])
    assert [
        item["memory_id"]
        for item in settled_call["context"]["latest_prior_thoughts"]
    ] == [prior_note_id]
    assert current_turn_note_id not in {
        item["memory_id"]
        for item in settled_call["context"]["latest_prior_thoughts"]
    }
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
    ) -> dict:
        calls.append({
            "source": source,
            "target": target,
            "runId": source_payload["runId"],
            "supporting_fact": supporting_fact,
            "graph_context": graph_context,
            "relationship_proposal": relationship_proposal,
        })
        return decision("REFINES" if relationship_proposal else "INVALID_NODE_PAIR")

    fast = hybrid.begin_completed_pair(payload(), classifier=classify)
    settled = hybrid.settle_completed_pair(settle_payload(fast), classifier=classify)

    assert fast["ok"] is True
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
    assert edge.relation == "REFINES"
    assert edge.relation != FREEFORM_RELATION
    assert edge.weight == pytest.approx(0.76)
    assert edge.provenance["jev"]["distribution"]["REFINES"] == pytest.approx(0.76)

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
        return decision("REFINES" if args[5] else "INVALID_NODE_PAIR")

    fast = hybrid.begin_completed_pair(
        payload(), classifier=classify,
    )
    output = structured_output()
    output["facts"].append({
        **structured_output(content="A later self-contained Thought Note.")["facts"][0],
        "title": "Later Thought Note",
    })
    settled = hybrid.settle_completed_pair(
        settle_payload(fast, output=output),
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
        return decision("REFINES" if args[5] else "INVALID_NODE_PAIR")

    first_fast = hybrid.begin_completed_pair(payload(), classifier=classify)
    first = hybrid.settle_completed_pair(
        settle_payload(first_fast), classifier=classify,
    )

    later = payload("run-two")
    later.update({
        "completedAt": "2026-09-23T12:05:00Z",
        "userMessage": "Revisit Jev and ThinkGraph in this later exchange.",
        "mainResponse": "Record the current temporal Thought without rewriting history.",
    })
    second_fast = hybrid.begin_completed_pair(later, classifier=classify)
    second_payload = settle_payload(second_fast, completed=later)
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


@pytest.mark.parametrize(
    "winner", ["NONE", "INSUFFICIENT_CONTEXT", "INVALID_NODE_PAIR"],
)
def test_unaccepted_saved_card_pair_creates_neither_new_nodes_nor_notes(
    hybrid, winner,
):
    fast = hybrid.begin_completed_pair(
        payload(), classifier=lambda *_args, **_kwargs: decision(winner),
    )
    settled = hybrid.settle_completed_pair(
        settle_payload(fast),
        classifier=lambda *_args, **_kwargs: decision(winner),
    )
    assert settled["relationships"]
    assert all(item["status"] == "no_edge" for item in settled["relationships"])
    assert all(item["winner"] == winner for item in settled["relationships"])
    assert settled["noteMemoryIds"] == []
    entities, edges = entities_and_edges(hybrid)
    assert entities == []
    assert edges == []
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
    ) -> dict:
        return decision("REFINES" if relationship_proposal else "NONE")

    fast = hybrid.begin_completed_pair(payload(), classifier=classify)

    def fail_note(*_args, **_kwargs):
        raise RuntimeError("note_store_unavailable")

    monkeypatch.setattr(hybrid, "_save_note_memory", fail_note)
    settled = hybrid.settle_completed_pair(
        settle_payload(fast),
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
        decision=decision("REFINES"),
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
        decision=decision("REFINES"),
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
        decision=decision("CORRECTS"),
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
        (changed["edge_id"], "CORRECTS")
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
    hybrid, monkeypatch: pytest.MonkeyPatch,
):
    def seed_classifier(*args, **_kwargs):
        return decision("REFINES" if args[5] else "INVALID_NODE_PAIR")

    seed_fast = hybrid.begin_completed_pair(
        payload(), classifier=seed_classifier,
    )
    seed_settled = hybrid.settle_completed_pair(
        settle_payload(seed_fast), classifier=seed_classifier,
    )
    assert not seed_settled["failures"]
    service = hybrid.get_service()
    jev = next(node for node in service.store.list_entities() if node.name == "Jev")
    thinkgraph = next(
        node for node in service.store.list_entities() if node.name == "ThinkGraph"
    )

    local = hybrid._IntakeLocalGraphStore()
    local.opportunities.append({
        "id": "intake_edge_0000",
        "source": {"name": "Jev", "type": "person_or_concept"},
        "target": {"name": "ThinkGraph", "type": "person_or_concept"},
        "native_relation": "co_occurs",
        "native_weight": 0.5,
        "provenance": {},
    })
    monkeypatch.setattr(
        hybrid,
        "_enumerate_native_regex_opportunities",
        lambda *_args, **_kwargs: (None, local),
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
    fast_contexts: list[dict[str, Any]] = []

    def classify_fast(_source, _target, _payload, _fact, context, _proposal):
        fast_contexts.append(context)
        return decision("REFINES")

    fast = hybrid.begin_completed_pair(completed, classifier=classify_fast)
    assert {item["nativeId"] for item in fast["fast"]["activeEnrichmentTargets"]} == {
        jev.id, thinkgraph.id,
    }
    assert set(fast["enrichmentInput"]) == {
        "exact_user_message",
        "exact_main_response",
        "current_turn_enrichment_targets",
        "current_graph_shape",
        "current_turn_accepted_relationships",
    }
    prompt_targets = {
        item["nativeId"]: item
        for item in fast["enrichmentInput"]["current_turn_enrichment_targets"]
    }
    assert all("existingNotes" not in item for item in prompt_targets.values())
    assert "Jev normalizes expressive graph relations." not in fast["enrichmentPrompt"]
    shape = fast["enrichmentInput"]["current_graph_shape"]
    assert {item["nativeId"] for item in shape["nodes"]} == {
        jev.id, thinkgraph.id,
    }
    assert any(
        edge["source"]["nativeId"] == jev.id
        and edge["target"]["nativeId"] == thinkgraph.id
        and edge["canonicalRelationship"] == "REFINES"
        for edge in shape["edges"]
    )
    assert any(
        edge["source_id"] == jev.id and edge["target_id"] == thinkgraph.id
        for context in fast_contexts
        for edge in context["incident_edges"]
    )
    assert "current_graph_shape" in fast["enrichmentPrompt"]
    assert "existingNotes" not in fast["enrichmentPrompt"]
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
        settle_payload(fast, output=output, completed=completed),
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
    hybrid, monkeypatch: pytest.MonkeyPatch,
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
        decision=decision("REFINES"),
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
    monkeypatch.setattr(
        hybrid,
        "_enumerate_native_regex_opportunities",
        lambda *_args, **_kwargs: (None, hybrid._IntakeLocalGraphStore()),
    )
    completed = payload("explicit-close-run")
    fast = hybrid.begin_completed_pair(
        completed,
        classifier=lambda *_args, **_kwargs: decision("INVALID_NODE_PAIR"),
    )
    output = structured_output(content="The current pair no longer supports this edge.")
    settled = hybrid.settle_completed_pair(
        settle_payload(fast, output=output, completed=completed),
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

    fast = hybrid.begin_completed_pair(payload(), classifier=fail)
    assert fast["fast"]["status"] == "completed_with_pair_failures"
    assert fast["fast"]["failures"]
    entities, edges = entities_and_edges(hybrid)
    assert entities == []
    assert edges == []
    assert hybrid.inspect("project-one", fast["pairMemoryId"])["memory"]["content"]
