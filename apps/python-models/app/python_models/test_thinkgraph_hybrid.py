"""Focused proof for the official Engraphis structured-fact ThinkGraph path."""
from __future__ import annotations

from typing import Any

import pytest

from app.python_models import engraphis as adapter


@pytest.fixture()
def engraphis_service():
    from engraphis.service import MemoryService

    service = MemoryService.create(
        ":memory:", extractor="none", graph_extractor="none"
    )
    try:
        yield service
    finally:
        service.close()


def _card_run() -> dict[str, str]:
    return {
        "runId": "run-one", "cardId": "card_thinkgraph",
        "revisionId": "revision-one", "profile": "thinkgraph",
        "hermesSessionId": "session-one", "resolvedModel": "configured/model",
    }


def _completed() -> dict[str, str]:
    return {
        "projectId": "project-one", "runId": "main-run-one",
        "userMessage": "How does Rocket Lab's Electron cadence affect launch revenue?",
        "mainResponse": "Rocket Lab operates Electron, whose cadence can affect launch revenue.",
    }


def _structured_output() -> dict[str, Any]:
    return {"facts": [
        {
            "content": "Rocket Lab operates Electron.",
            "title": "Rocket Lab operates Electron", "mtype": "episodic",
            "importance": 0.8, "keywords": ["Rocket Lab", "Electron"],
            "entities": ["Rocket Lab", "Electron"],
            "relations": [{"source": "Rocket Lab", "relation": "operates",
                           "target": "Electron"}],
        },
        {
            "content": "Electron cadence can affect launch revenue.",
            "title": "Cadence affects revenue", "mtype": "semantic",
            "importance": 0.55,
            "keywords": ["Electron cadence", "Launch revenue"],
            "entities": ["Electron cadence", "Launch revenue"],
            "relations": [{"source": "Electron cadence", "relation": "can affect",
                           "target": "Launch revenue"}],
        },
    ]}


def _facts() -> list[Any]:
    completed = _completed()
    return adapter._extract_saved_card_facts(
        _structured_output(),
        pair_text=(f"USER:\n{completed['userMessage']}\n\n"
                   f"MAIN:\n{completed['mainResponse']}"),
        context={}, card_run=_card_run(),
    )


def _second_facts() -> list[Any]:
    return adapter._extract_saved_card_facts(
        {"facts": [{
            "content": "Rocket Lab must convert launch revenue into cash generation.",
            "title": "Launch revenue must convert to cash",
            "mtype": "episodic",
            "importance": 0.7,
            "keywords": ["Rocket Lab", "Cash generation"],
            "entities": ["Rocket Lab", "Cash generation"],
            "relations": [{
                "source": "Rocket Lab", "relation": "must convert revenue into",
                "target": "Cash generation",
            }],
        }]},
        pair_text="USER: What matters next?\n\nMAIN: Rocket Lab must convert launch revenue to cash.",
        context={},
        card_run={**_card_run(), "runId": "run-two"},
    )


def _table_counts(engraphis_service) -> dict[str, int]:
    return {
        table: int(engraphis_service.store.conn.execute(
            f"SELECT COUNT(*) AS n FROM {table}"
        ).fetchone()["n"])
        for table in ("memories", "entities", "edges", "memory_entities", "edge_supports")
    }


def test_engraphis_schema_has_no_custom_think_wrapper() -> None:
    schema, prompt = adapter._llm_structured_contract("USER: x\nMAIN: y", {})

    rendered = str(schema)
    assert "facts" in schema.get("properties", {})
    assert "summary" not in rendered
    assert "Engraphis structured extraction" in prompt


def test_each_engraphis_fact_is_one_memory_with_engraphis_graph_evidence(engraphis_service) -> None:
    facts = _facts()
    workspace_id = engraphis_service.store.get_or_create_workspace("project-one")

    results = adapter._save_extracted_facts(
        engraphis_service, workspace_id=workspace_id, completed=_completed(),
        facts=facts, card_run=_card_run(), pair_reference="pair-one",
    )

    memory_ids = [str(result["id"]) for result in results]
    assert len(memory_ids) == len(facts) == 2
    assert len(set(memory_ids)) == 2
    memories = engraphis_service.store.get_memories(memory_ids)
    assert [memories[mid].content for mid in memory_ids] == [
        fact.content for fact in facts
    ]
    assert [memories[mid].title for mid in memory_ids] == [fact.title for fact in facts]
    assert [memories[mid].importance for mid in memory_ids] == [0.8, 0.55]
    assert [memories[mid].mtype.value for mid in memory_ids] == ["episodic", "semantic"]
    assert [memories[mid].keywords for mid in memory_ids] == [
        ["Rocket Lab", "Electron"], ["Electron cadence", "Launch revenue"],
    ]
    assert [memories[mid].metadata["entities"] for mid in memory_ids] == [
        ["Rocket Lab", "Electron"], ["Electron cadence", "Launch revenue"],
    ]
    assert [memories[mid].metadata["relations"] for mid in memory_ids] == [
        fact.metadata["relations"] for fact in facts
    ]
    assert all(memories[mid].provenance == {
        "source": "saved_thinkgraph_card", "trusted": True,
        "review_state": "approved", "trust_origin": "saved_card_runtime",
    } for mid in memory_ids)
    assert [memories[mid].metadata["thinkgraph_origin"]["fact_index"]
            for mid in memory_ids] == [0, 1]
    assert all("think" not in memories[mid].metadata for mid in memory_ids)
    assert all("think" not in memories[mid].metadata.get("structured_extraction", {})
               for mid in memory_ids)

    entities = engraphis_service.store.list_entities(
        adapter.SearchFilter(workspace_id=workspace_id)
    )
    entity_ids = {entity.id for entity in entities}
    assert not entity_ids.intersection(memory_ids)
    assert {entity.name for entity in entities} == {
        "Rocket Lab", "Electron", "Electron cadence", "Launch revenue",
    }
    edge_rows = engraphis_service.store.conn.execute(
        "SELECT id, relation FROM edges ORDER BY id"
    ).fetchall()
    assert {str(row["relation"]) for row in edge_rows} == {"operates", "can affect"}
    support_rows = engraphis_service.store.conn.execute(
        "SELECT edge_id, memory_id FROM edge_supports ORDER BY edge_id, memory_id"
    ).fetchall()
    assert {str(row["memory_id"]) for row in support_rows} == set(memory_ids)
    incidence_rows = engraphis_service.store.list_memory_entities(
        adapter.SearchFilter(workspace_id=workspace_id), memory_ids=memory_ids,
    )
    assert {str(row["memory_id"]) for row in incidence_rows} == set(memory_ids)
    assert {str(row["source_kind"]) for row in incidence_rows}.issuperset(
        {"edge_support"}
    )


def test_identical_replay_reuses_engraphis_memory_ids(engraphis_service) -> None:
    workspace_id = engraphis_service.store.get_or_create_workspace("project-one")
    first = adapter._save_extracted_facts(
        engraphis_service, workspace_id=workspace_id, completed=_completed(),
        facts=_facts(), card_run=_card_run(), pair_reference="pair-one",
    )
    second = adapter._save_extracted_facts(
        engraphis_service, workspace_id=workspace_id, completed=_completed(),
        facts=_facts(), card_run=_card_run(), pair_reference="pair-one",
    )

    assert [item["id"] for item in second] == [item["id"] for item in first]
    assert all(item["op"] == "noop" for item in second)
    row = engraphis_service.store.conn.execute(
        "SELECT COUNT(*) AS n FROM memories"
    ).fetchone()
    assert int(row["n"]) == 2


def test_completed_pair_settlement_returns_every_engraphis_fact_identity(
    engraphis_service,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    completed = {
        **_completed(),
        "deckId": "deck_builder",
        "conversationId": "conversation-one",
        "cardId": "card_main_chat",
        "hermesSessionId": "main-session",
        "completedAt": "2026-10-05T21:00:00Z",
    }
    pair_reference = adapter._pair_reference(completed)
    monkeypatch.setattr(adapter, "get_service", lambda: engraphis_service)

    settled = adapter.settle_completed_pair({
        **completed,
        "pairReference": pair_reference,
        "structuredOutput": _structured_output(),
        "cardRun": _card_run(),
    })

    assert settled["pairReference"] == pair_reference
    assert len(settled["thinkMemoryIds"]) == 2
    assert len(set(settled["thinkMemoryIds"])) == 2
    assert len(settled["changedNodeIds"]) == 4
    assert len(settled["changedEdgeIds"]) == 2
    assert settled["revisionChanged"] is True


def test_separate_exchanges_reuse_entity_and_accumulate_unique_thinks(
    engraphis_service,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workspace_id = engraphis_service.store.get_or_create_workspace("project-one")
    first = adapter._save_extracted_facts(
        engraphis_service, workspace_id=workspace_id, completed=_completed(),
        facts=_facts(), card_run=_card_run(), pair_reference="pair-one",
    )
    second = adapter._save_extracted_facts(
        engraphis_service, workspace_id=workspace_id,
        completed={**_completed(), "runId": "main-run-two"},
        facts=_second_facts(), card_run={**_card_run(), "runId": "run-two"},
        pair_reference="pair-two",
    )
    first_id, second_id = str(first[0]["id"]), str(second[0]["id"])
    assert first_id != second_id

    entities = engraphis_service.store.list_entities(
        adapter.SearchFilter(workspace_id=workspace_id)
    )
    rocket_entities = [entity for entity in entities if entity.name == "Rocket Lab"]
    assert len(rocket_entities) == 1
    rocket_id = rocket_entities[0].id
    assert rocket_id not in {first_id, second_id}

    incidence = engraphis_service.store.list_memory_entities(
        adapter.SearchFilter(workspace_id=workspace_id),
        entity_ids=[rocket_id],
    )
    assert {str(row["memory_id"]) for row in incidence} == {first_id, second_id}
    monkeypatch.setattr(adapter, "get_service", lambda: engraphis_service)
    evidence = adapter.inspect(
        "project-one", "engraphisEntityId", rocket_id,
    )["entity"]["evidence"]
    evidence_ids = [str(item["memory_id"]) for item in evidence]
    assert set(evidence_ids) == {first_id, second_id}
    assert len(evidence_ids) == len(set(evidence_ids)) == 2

    first_incidence = engraphis_service.store.list_memory_entities(
        adapter.SearchFilter(workspace_id=workspace_id), memory_ids=[first_id],
    )
    assert rocket_id in {str(row["entity_id"]) for row in first_incidence}
    assert len(engraphis_service.store.get_memories([first_id])) == 1


def test_projection_edges_and_data_anchor_keep_entity_ids_separate(
    engraphis_service,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.python_models.data_anchor import read_thinkgraph_exact

    workspace_id = engraphis_service.store.get_or_create_workspace("project-one")
    saved = adapter._save_extracted_facts(
        engraphis_service, workspace_id=workspace_id, completed=_completed(),
        facts=_facts(), card_run=_card_run(), pair_reference="pair-one",
    )
    memory_ids = {str(item["id"]) for item in saved}
    monkeypatch.setattr(adapter, "get_service", lambda: engraphis_service)
    monkeypatch.setattr(
        adapter, "_projection_subject_directory",
        lambda _project: {"subjects": [], "count": 0, "complete": True},
    )

    projection = adapter.projection("project-one")
    node_ids = {str(node["id"]) for node in projection["nodes"]}
    assert node_ids
    assert node_ids.isdisjoint(memory_ids)
    assert all(str(edge["source"]) in node_ids and str(edge["target"]) in node_ids
               for edge in projection["edges"])
    assert all(str(edge["source"]) not in memory_ids and str(edge["target"]) not in memory_ids
               for edge in projection["edges"])

    rocket_id = next(str(node["id"]) for node in projection["nodes"]
                     if node["label"] == "Rocket Lab")
    anchored = read_thinkgraph_exact(
        "project-one", "engraphisEntityId", rocket_id,
        engraphis_reader=lambda project, id_field, identifier: adapter.inspect(
            project, id_field, identifier,
        ),
    )
    assert anchored is not None
    assert anchored["engraphisEntityId"] == rocket_id
    assert anchored["engraphisEntityId"] not in memory_ids
    assert anchored["recordKind"] == "entity"


def test_settlement_replay_preserves_order_and_all_engraphis_rows(
    engraphis_service,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    completed = {
        **_completed(), "deckId": "deck_builder", "conversationId": "conversation-one",
        "cardId": "card_main_chat", "hermesSessionId": "main-session",
        "completedAt": "2026-10-05T21:00:00Z",
    }
    pair_reference = adapter._pair_reference(completed)
    payload = {
        **completed, "pairReference": pair_reference,
        "structuredOutput": _structured_output(), "cardRun": _card_run(),
    }
    monkeypatch.setattr(adapter, "get_service", lambda: engraphis_service)

    first = adapter.settle_completed_pair(payload)
    before = _table_counts(engraphis_service)
    replay = adapter.settle_completed_pair(payload)

    assert replay["intakeOperation"] == "noop"
    assert replay["thinkMemoryIds"] == first["thinkMemoryIds"]
    assert _table_counts(engraphis_service) == before


def test_empty_result_and_engraphis_validation_failure_create_no_rows(engraphis_service) -> None:
    from engraphis.core.interfaces import ExtractedFact

    empty = adapter._extract_saved_card_facts(
        {"facts": []}, pair_text="", context={}, card_run=_card_run(),
    )
    assert empty == []
    workspace_id = engraphis_service.store.get_or_create_workspace("project-one")
    assert adapter._save_extracted_facts(
        engraphis_service, workspace_id=workspace_id, completed=_completed(),
        facts=empty, card_run=_card_run(), pair_reference="pair-empty",
    ) == []
    assert _table_counts(engraphis_service) == {
        "memories": 0, "entities": 0, "edges": 0,
        "memory_entities": 0, "edge_supports": 0,
    }

    with pytest.raises(TypeError, match="JSON serializable"):
        adapter._save_extracted_facts(
            engraphis_service, workspace_id=workspace_id, completed=_completed(),
            facts=[ExtractedFact(content="valid", metadata={"entities": object()})],
            card_run=_card_run(),
            pair_reference="pair-invalid",
        )
    assert _table_counts(engraphis_service) == {
        "memories": 0, "entities": 0, "edges": 0,
        "memory_entities": 0, "edge_supports": 0,
    }


def test_official_remember_many_is_atomic(engraphis_service) -> None:
    from engraphis.core.interfaces import FactSpec

    workspace_id = engraphis_service.store.get_or_create_workspace("project-one")
    with pytest.raises(ValueError, match="non-empty content"):
        engraphis_service.engine.remember_many(
            [FactSpec(content="valid"), FactSpec(content="")],
            workspace_id=workspace_id,
        )
    row = engraphis_service.store.conn.execute(
        "SELECT COUNT(*) AS n FROM memories"
    ).fetchone()
    assert int(row["n"]) == 0


def test_projection_excludes_memory_nodes(engraphis_service, monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[dict[str, Any]] = []

    def graph_scene(**kwargs: Any) -> dict[str, Any]:
        calls.append(kwargs)
        return {"nodes": [], "edges": [], "meta": {"truncated": False}}

    monkeypatch.setattr(adapter, "get_service", lambda: engraphis_service)
    monkeypatch.setattr(engraphis_service, "graph_scene", graph_scene)
    monkeypatch.setattr(
        adapter, "_projection_subject_directory",
        lambda _project: {"subjects": [], "count": 0, "complete": True},
    )

    result = adapter.projection("project-one")

    assert result["counts"] == {"nodes": 0, "edges": 0}
    assert calls[0]["include_memory_nodes"] is False
