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


def settle_payload(fast: dict, *, output: dict | None = None) -> dict:
    return {
        **payload(),
        "pairMemoryId": fast["pairMemoryId"],
        "fastTurnHeat": fast["fast"]["turnHeat"],
        "structuredOutput": output or structured_output(),
        "cardRun": card_run(),
    }


def entities_and_edges(hybrid) -> tuple[list[Any], list[Any]]:
    service = hybrid.get_service()
    entities = service.store.list_entities()
    edges = service.store.neighbors([entity.id for entity in entities]) if entities else []
    return entities, edges


def test_jev_choice_requires_complete_vocabulary_and_derives_strength():
    probabilities = {name: 0.0 for name in adapter.THINKGRAPH_RELATIONSHIPS}
    probabilities.update(CONTRADICTS=0.72, NONE=0.18, INSUFFICIENT_CONTEXT=0.10)
    parsed = adapter._validate_jev_response({
        "answers": {"relationship": {
            "type": "choice",
            "choice": "CONTRADICTS",
            "confidence": 0.72,
            "probabilities": probabilities,
        }},
        "provider": "TypeSafe",
        "model": "typesafe/jev-1.13-test",
    })
    assert parsed["winner"] == "CONTRADICTS"
    assert parsed["label_confidence"] == pytest.approx(0.72)
    assert parsed["relationship_strength"] == pytest.approx(0.72)
    assert tuple(parsed["distribution"]) == adapter.THINKGRAPH_RELATIONSHIPS

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


@pytest.mark.parametrize("winner", ["NONE", "INSUFFICIENT_CONTEXT"])
def test_fast_rejection_keeps_pair_memory_without_leaking_nodes(hybrid, winner):
    fast = hybrid.begin_completed_pair(
        payload(), classifier=lambda *_args, **_kwargs: decision(winner),
    )
    assert hybrid.inspect("project-one", fast["pairMemoryId"])["memory"]["content"].startswith(
        "USER:\nJev evaluates ThinkGraph"
    )
    assert all(item["status"] == "no_edge" for item in fast["fast"]["relationships"])
    entities, edges = entities_and_edges(hybrid)
    assert entities == []
    assert edges == []


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


def test_jev_context_contains_direct_notes_and_edges_but_not_second_hop(hybrid):
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

    snapshot = hybrid._bounded_graph_snapshot(
        service.store,
        workspace_id=workspace_id,
        entity_ids=[first["source"]],
    )

    assert {item["id"] for item in snapshot["nodes"]} == {
        first["source"], first["target"],
    }
    assert [item["id"] for item in snapshot["incident_edges"]] == [
        first["edge_id"]
    ]
    assert second["target"] not in {item["id"] for item in snapshot["nodes"]}


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
        return decision("REFINES")

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
    assert {"nodes", "notes", "incident_edges"}.issubset(
        proposal_call["graph_context"]
    )

    service = hybrid.get_service()
    entities = service.store.list_entities()
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
    fast = hybrid.begin_completed_pair(
        payload(), classifier=lambda *_args, **_kwargs: decision("REFINES"),
    )
    output = structured_output()
    output["facts"].append({
        **structured_output(content="A later self-contained Thought Note.")["facts"][0],
        "title": "Later Thought Note",
    })
    settled = hybrid.settle_completed_pair(
        settle_payload(fast, output=output),
        classifier=lambda *_args, **_kwargs: decision("REFINES"),
    )
    assert len(settled["noteMemoryIds"]) >= 2
    older_id, newer_id = settled["noteMemoryIds"][:2]
    service = hybrid.get_service()
    service.store.conn.execute(
        "UPDATE memories SET ingested_at=? WHERE id=?",
        (100.0, older_id),
    )
    service.store.conn.execute(
        "UPDATE memories SET ingested_at=? WHERE id=?",
        (200.0, newer_id),
    )
    service.store.conn.commit()
    jev = next(node for node in service.store.list_entities() if node.name == "Jev")

    native = hybrid.inspect("project-one", jev.id)["entity"]
    native_note_ids = [
        item["memory_id"] for item in native["evidence"]
        if item["memory_id"] in {older_id, newer_id}
    ]
    assert native_note_ids == [newer_id, older_id]

    projected = hybrid.projection("project-one", native_id=jev.id)
    thought = next(
        node for node in projected["nodes"]
        if jev.id in node.get("member_ids", [node["id"]])
    )
    projected_note_ids = [
        item["id"] for item in thought["properties"]["evidence"]
        if item["id"] in {older_id, newer_id}
    ]
    assert projected_note_ids == [newer_id, older_id]
    assert thought["properties"]["evidence"][0]["ingestedAt"] is not None


def test_unaccepted_saved_card_pair_creates_neither_new_nodes_nor_notes(hybrid):
    fast = hybrid.begin_completed_pair(
        payload(), classifier=lambda *_args, **_kwargs: decision("NONE"),
    )
    settled = hybrid.settle_completed_pair(
        settle_payload(fast),
        classifier=lambda *_args, **_kwargs: decision("NONE"),
    )
    assert settled["relationships"]
    assert all(item["status"] == "no_edge" for item in settled["relationships"])
    assert settled["noteMemoryIds"] == []
    entities, edges = entities_and_edges(hybrid)
    assert entities == []
    assert edges == []


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


def test_new_note_reopens_only_existing_one_hop_edges_and_failure_keeps_them(hybrid):
    fast = hybrid.begin_completed_pair(
        payload(), classifier=lambda *_args, **_kwargs: decision("REFINES"),
    )
    service = hybrid.get_service()
    jev = next(node for node in service.store.list_entities() if node.name == "Jev")
    live_before = {
        edge.id for edge in service.store.neighbors([jev.id])
        if edge.provenance.get("jev")
    }
    assert live_before

    output = structured_output(content="Jev has a genuinely new operating constraint.")
    output["facts"][0]["entities"] = ["Jev"]
    output["facts"][0]["relations"] = []
    output["facts"][0]["relationship_observations"] = []

    def fail(*_args, **_kwargs):
        raise adapter.JevRelationshipError("jev_relationship_unavailable")

    settled = hybrid.settle_completed_pair(
        settle_payload(fast, output=output),
        classifier=fail,
    )

    assert settled["reopenedNodeIds"] == [jev.id]
    assert settled["reclassifiedRelationships"]
    assert all(
        item["status"] == "kept_after_failure"
        for item in settled["reclassifiedRelationships"]
    )
    assert any(item.get("stage") == "reopened_edge" for item in settled["failures"])
    live_after = {
        edge.id for edge in service.store.neighbors([jev.id])
        if edge.provenance.get("jev")
    }
    assert live_after == live_before


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
