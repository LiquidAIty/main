"""Focused proof for the official Engraphis structured-fact ThinkGraph path."""
from __future__ import annotations

from typing import Any

import pytest

from app.python_models import engraphis as adapter


@pytest.fixture()
def native_service():
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
        "nativeSessionRef": "session-one", "resolvedModel": "configured/model",
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


def test_native_schema_has_no_custom_think_wrapper() -> None:
    schema, prompt = adapter._llm_structured_contract("USER: x\nMAIN: y", {})

    rendered = str(schema)
    assert "facts" in schema.get("properties", {})
    assert "summary" not in rendered
    assert "native Engraphis structured extraction" in prompt


def test_each_native_fact_is_one_memory_with_native_graph_evidence(native_service) -> None:
    facts = _facts()
    workspace_id = native_service.store.get_or_create_workspace("project-one")

    results = adapter._save_extracted_facts(
        native_service, workspace_id=workspace_id, completed=_completed(),
        facts=facts, card_run=_card_run(), pair_reference="pair-one",
    )

    memory_ids = [str(result["id"]) for result in results]
    assert len(memory_ids) == len(facts) == 2
    assert len(set(memory_ids)) == 2
    memories = native_service.store.get_memories(memory_ids)
    assert [memories[mid].content for mid in memory_ids] == [
        fact.content for fact in facts
    ]
    assert [memories[mid].title for mid in memory_ids] == [fact.title for fact in facts]
    assert [memories[mid].importance for mid in memory_ids] == [0.8, 0.55]
    assert all("think" not in memories[mid].metadata for mid in memory_ids)
    assert all("think" not in memories[mid].metadata.get("structured_extraction", {})
               for mid in memory_ids)

    entities = native_service.store.list_entities(
        adapter.SearchFilter(workspace_id=workspace_id)
    )
    entity_ids = {entity.id for entity in entities}
    assert not entity_ids.intersection(memory_ids)
    assert {entity.name for entity in entities} == {
        "Rocket Lab", "Electron", "Electron cadence", "Launch revenue",
    }
    edge_rows = native_service.store.conn.execute(
        "SELECT id, relation FROM edges ORDER BY id"
    ).fetchall()
    assert {str(row["relation"]) for row in edge_rows} == {"operates", "can affect"}
    support_rows = native_service.store.conn.execute(
        "SELECT edge_id, memory_id FROM edge_supports ORDER BY edge_id, memory_id"
    ).fetchall()
    assert {str(row["memory_id"]) for row in support_rows} == set(memory_ids)
    incidence_rows = native_service.store.list_memory_entities(
        adapter.SearchFilter(workspace_id=workspace_id), memory_ids=memory_ids,
    )
    assert {str(row["memory_id"]) for row in incidence_rows} == set(memory_ids)
    assert {str(row["source_kind"]) for row in incidence_rows}.issuperset(
        {"edge_support"}
    )


def test_identical_replay_reuses_native_memory_ids(native_service) -> None:
    workspace_id = native_service.store.get_or_create_workspace("project-one")
    first = adapter._save_extracted_facts(
        native_service, workspace_id=workspace_id, completed=_completed(),
        facts=_facts(), card_run=_card_run(), pair_reference="pair-one",
    )
    second = adapter._save_extracted_facts(
        native_service, workspace_id=workspace_id, completed=_completed(),
        facts=_facts(), card_run=_card_run(), pair_reference="pair-one",
    )

    assert [item["id"] for item in second] == [item["id"] for item in first]
    assert all(item["op"] == "noop" for item in second)
    row = native_service.store.conn.execute(
        "SELECT COUNT(*) AS n FROM memories"
    ).fetchone()
    assert int(row["n"]) == 2


def test_completed_pair_settlement_returns_every_native_fact_identity(
    native_service,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    completed = {
        **_completed(),
        "deckId": "deck_builder",
        "conversationId": "conversation-one",
        "cardId": "card_main_chat",
        "nativeSessionRef": "main-session",
        "completedAt": "2026-10-05T21:00:00Z",
    }
    pair_reference = adapter._pair_reference(completed)
    monkeypatch.setattr(adapter, "get_service", lambda: native_service)

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


def test_official_remember_many_is_atomic(native_service) -> None:
    from engraphis.core.interfaces import FactSpec

    workspace_id = native_service.store.get_or_create_workspace("project-one")
    with pytest.raises(ValueError, match="non-empty content"):
        native_service.engine.remember_many(
            [FactSpec(content="valid"), FactSpec(content="")],
            workspace_id=workspace_id,
        )
    row = native_service.store.conn.execute(
        "SELECT COUNT(*) AS n FROM memories"
    ).fetchone()
    assert int(row["n"]) == 0


def test_projection_excludes_memory_nodes(native_service, monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[dict[str, Any]] = []

    def graph_scene(**kwargs: Any) -> dict[str, Any]:
        calls.append(kwargs)
        return {"nodes": [], "edges": [], "meta": {"truncated": False}}

    monkeypatch.setattr(adapter, "get_service", lambda: native_service)
    monkeypatch.setattr(native_service, "graph_scene", graph_scene)
    monkeypatch.setattr(
        adapter, "_projection_subject_directory",
        lambda _project: {"subjects": [], "count": 0, "complete": True},
    )

    result = adapter.projection("project-one")

    assert result["counts"] == {"nodes": 0, "edges": 0}
    assert calls[0]["include_memory_nodes"] is False
