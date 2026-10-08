"""Focused proof for the one-Think, Jev-governed Engraphis lifecycle."""
from __future__ import annotations

from copy import deepcopy
from typing import Any, Callable

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


def _card_run(run_id: str = "thinkgraph-run-one") -> dict[str, str]:
    return {
        "runId": run_id,
        "cardId": "card_thinkgraph",
        "revisionId": "revision-one",
        "profile": "thinkgraph",
        "hermesSessionId": "thinkgraph-session-one",
        "resolvedModel": "configured/model",
    }


def _completed(run_id: str = "main-run-one") -> dict[str, Any]:
    return {
        "projectId": "project-one",
        "deckId": "deck_builder",
        "conversationId": "conversation-one",
        "runId": run_id,
        "cardId": "card_main_chat",
        "hermesSessionId": "main-session",
        "completedAt": "2026-10-08T12:00:00Z",
        "userMessage": "How does Rocket Lab's Electron cadence affect launch revenue?",
        "mainResponse": (
            "Rocket Lab uses Electron, whose cadence can affect launch revenue."
        ),
    }


def _fact(
    *,
    summary: str = "Rocket Lab uses Electron, and its cadence can affect launch revenue.",
    title: str = "Electron cadence and launch revenue",
    entities: list[str] | None = None,
    relations: list[dict[str, str]] | None = None,
) -> dict[str, Any]:
    return {
        "content": summary,
        "title": title,
        "mtype": "episodic",
        "importance": 0.8,
        "keywords": ["Rocket Lab", "Electron", "launch revenue"],
        "entities": entities or ["Rocket Lab", "Electron"],
        "relations": relations or [{
            "source": "Rocket Lab",
            "relation": "operates as its current launch vehicle",
            "target": "Electron",
        }],
        "think": {"summary": summary},
    }


def _structured_output(**kwargs: Any) -> dict[str, Any]:
    return {"facts": [_fact(**kwargs)]}


def _settle_payload(
    completed: dict[str, Any] | None = None,
    *,
    output: dict[str, Any] | None = None,
    card_run: dict[str, str] | None = None,
) -> dict[str, Any]:
    source = completed or _completed()
    return {
        **source,
        "pairReference": adapter._pair_reference(source),
        "structuredOutput": output or _structured_output(),
        "cardRun": card_run or _card_run(),
    }


def _decision(
    winner: str = "USES",
    *,
    vocabulary: tuple[str, ...] | None = None,
) -> dict[str, Any]:
    vocabulary = vocabulary or tuple(adapter.SHARED_JEV_RELATIONSHIPS)
    choices = adapter._relationship_choices(vocabulary)
    distribution = {name: 0.0 for name in choices}
    if winner == adapter._THINKGRAPH_JEV_ABSTAIN:
        distribution[winner] = 0.76
        distribution["USES"] = 0.24
    else:
        distribution[winner] = 0.76
        distribution[adapter._THINKGRAPH_JEV_ABSTAIN] = 0.24
    return {
        "decision_id": "jev-decision-one",
        "winner": winner,
        "distribution": distribution,
        "confidence": 0.91,
        "provider": "TypeSafe",
        "requested_model": adapter.JEV_MODEL,
        "resolved_model": "typesafe/jev-1.13-test",
        "usage": {"input_tokens": 12, "output_tokens": 4},
        "vocabulary_version": adapter.PROJECT_RELATIONSHIP_VOCABULARY_VERSION,
        "vocabulary_hash": adapter.relationship_vocabulary_hash(vocabulary),
        "vocabulary_count": len(vocabulary),
    }


def _classifier(winner: str = "USES") -> Callable[..., dict[str, Any]]:
    def classify(*_args: Any, **kwargs: Any) -> dict[str, Any]:
        return _decision(
            winner,
            vocabulary=tuple(kwargs["relationship_vocabulary"]),
        )

    return classify


def _table_counts(service: Any) -> dict[str, int]:
    return {
        table: int(service.store.conn.execute(
            f"SELECT COUNT(*) AS n FROM {table}"
        ).fetchone()["n"])
        for table in (
            "memories", "entities", "edges", "memory_entities", "edge_supports",
        )
    }


def _settle(
    service: Any,
    monkeypatch: pytest.MonkeyPatch,
    *,
    payload: dict[str, Any] | None = None,
    classifier: Callable[..., dict[str, Any]] | None = None,
) -> dict[str, Any]:
    monkeypatch.setattr(adapter, "get_service", lambda: service)
    return adapter.settle_completed_pair(
        payload or _settle_payload(),
        classifier=classifier or _classifier(),
    )


def test_custom_schema_requires_exactly_one_episodic_think() -> None:
    schema, prompt = adapter._llm_structured_contract(
        "USER: x\nMAIN: y", {"canonical_subject_directory": {}}
    )
    facts = adapter._extract_saved_card_facts(
        _structured_output(),
        pair_text="USER: x\nMAIN: y",
        context={},
        card_run=_card_run(),
    )
    projected = adapter._project_saved_card_think(facts)

    assert len(facts) == 1
    assert facts[0].mtype == adapter.MemoryType.EPISODIC
    assert projected["summary"] == facts[0].content
    assert projected["entities"] == ["Rocket Lab", "Electron"]
    assert projected["relationships"][0]["relation"] == (
        "operates as its current launch vehicle"
    )
    assert "think" in str(schema)
    assert "Return exactly one object in the facts array" in prompt
    assert "Jev alone" in prompt


@pytest.mark.parametrize(
    "structured_output",
    [
        {"facts": []},
        {"facts": [_fact(), _fact(title="duplicate second fact")]},
        {"facts": [{key: value for key, value in _fact().items() if key != "think"}]},
        {"wrong": [_fact()]},
    ],
)
def test_invalid_or_multiple_card_output_creates_no_graph_rows(
    engraphis_service: Any,
    monkeypatch: pytest.MonkeyPatch,
    structured_output: dict[str, Any],
) -> None:
    calls = 0

    def classify(*_args: Any, **_kwargs: Any) -> dict[str, Any]:
        nonlocal calls
        calls += 1
        return _decision()

    with pytest.raises(
        (adapter.ThinkGraphIntakeError, ValueError),
        match="thinkgraph_card_",
    ):
        _settle(
            engraphis_service,
            monkeypatch,
            payload=_settle_payload(output=structured_output),
            classifier=classify,
        )
    assert calls == 0
    assert _table_counts(engraphis_service) == {
        "memories": 0,
        "entities": 0,
        "edges": 0,
        "memory_entities": 0,
        "edge_supports": 0,
    }


def test_one_pair_writes_one_think_and_only_jev_edge(
    engraphis_service: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    completed = {**_completed(), "mainSubjects": ["Rocket Lab"]}
    settled = _settle(
        engraphis_service,
        monkeypatch,
        payload=_settle_payload(completed),
    )

    assert settled["intakeOperation"] == "add"
    assert settled["thinkMemoryIds"] == [settled["thinkMemoryId"]]
    assert len(settled["newSubjects"]) == 2
    assert settled["newMainSubjects"] == [{
        "canonicalName": "Rocket Lab",
        "engraphisEntityId": next(
            item["engraphisEntityId"] for item in settled["newSubjects"]
            if item["canonicalName"] == "Rocket Lab"
        ),
        "engraphisMemoryId": settled["thinkMemoryId"],
    }]

    memory = engraphis_service.store.get_memory(settled["thinkMemoryId"])
    assert memory is not None
    assert memory.mtype == adapter.MemoryType.EPISODIC
    assert memory.metadata["consolidation_exempt"] is True
    assert set(memory.metadata["structured_extraction"]) == {"think"}
    think = memory.metadata["structured_extraction"]["think"]
    assert think["summary"] == memory.content
    assert think["relationships"][0]["relation"] == (
        "operates as its current launch vehicle"
    )
    assert "relations" not in memory.metadata["structured_extraction"]
    assert "entities" not in memory.metadata["structured_extraction"]

    entities = engraphis_service.store.list_entities()
    assert {entity.name for entity in entities} == {"Rocket Lab", "Electron"}
    incidence = engraphis_service.store.list_memory_entities(
        memory_ids=[settled["thinkMemoryId"]]
    )
    assert {row["entity_id"] for row in incidence} == {entity.id for entity in entities}
    direct_incidence = [
        row for row in incidence if row["source_kind"] == "structured_extractor"
    ]
    assert len(direct_incidence) == 2
    assert {row["entity_id"] for row in direct_incidence} == {
        entity.id for entity in entities
    }

    edges = engraphis_service.store.neighbors([entity.id for entity in entities])
    assert len(edges) == 1
    edge = edges[0]
    assert edge.relation == "USES"
    assert edge.relation != think["relationships"][0]["relation"]
    assert edge.weight == pytest.approx(0.76)
    jev = edge.provenance["jev"]
    assert jev["decision_id"] == "jev-decision-one"
    assert jev["winner"] == "USES"
    assert jev["distribution"]["USES"] == pytest.approx(0.76)
    assert jev["label_confidence"] == pytest.approx(0.76)
    assert jev["relationship_strength"] == pytest.approx(0.76)
    assert jev["provider"] == "TypeSafe"
    assert jev["requested_model"] == adapter.JEV_MODEL
    assert jev["resolved_model"] == "typesafe/jev-1.13-test"
    assert jev["natural_relationship"] == (
        "operates as its current launch vehicle"
    )
    supports = engraphis_service.store.edge_supports_in_scope([edge.id])
    assert len(supports) == 1
    assert supports[0]["memory_id"] == settled["thinkMemoryId"]


def test_every_freeform_proposal_is_classified_before_one_atomic_write(
    engraphis_service: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[tuple[str, str, str]] = []
    output = _structured_output(
        summary="Rocket Lab uses Electron, and cadence supports launch revenue.",
        entities=["Rocket Lab", "Electron", "Launch revenue"],
        relations=[
            {
                "source": "Rocket Lab",
                "relation": "operates as its current launch vehicle",
                "target": "Electron",
            },
            {
                "source": "Electron",
                "relation": "can support repeatable launch revenue",
                "target": "Launch revenue",
            },
        ],
    )

    def classify(
        source: str,
        target: str,
        _payload: dict[str, Any],
        _summary: str,
        _context: dict[str, Any],
        proposal: str,
        *,
        relationship_vocabulary: tuple[str, ...],
    ) -> dict[str, Any]:
        calls.append((source, proposal, target))
        winner = "USES" if source == "Rocket Lab" else "SUPPORTS"
        return _decision(winner, vocabulary=relationship_vocabulary)

    settled = _settle(
        engraphis_service,
        monkeypatch,
        payload=_settle_payload(output=output),
        classifier=classify,
    )
    assert calls == [
        ("Rocket Lab", "operates as its current launch vehicle", "Electron"),
        ("Electron", "can support repeatable launch revenue", "Launch revenue"),
    ]
    assert len(settled["thinkMemoryIds"]) == 1
    assert {item["relation"] for item in settled["relationships"]} == {
        "USES", "SUPPORTS",
    }
    counts = _table_counts(engraphis_service)
    assert {key: counts[key] for key in (
        "memories", "entities", "edges", "edge_supports",
    )} == {
        "memories": 1,
        "entities": 3,
        "edges": 2,
        "edge_supports": 2,
    }
    direct_incidence = [
        row for row in engraphis_service.store.list_memory_entities(
            memory_ids=[settled["thinkMemoryId"]]
        )
        if row["source_kind"] == "structured_extractor"
    ]
    assert len(direct_incidence) == 3


def test_duplicate_pair_is_exact_noop_without_another_jev_call(
    engraphis_service: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    payload = _settle_payload()
    first = _settle(engraphis_service, monkeypatch, payload=payload)
    before = _table_counts(engraphis_service)

    def forbidden(*_args: Any, **_kwargs: Any) -> dict[str, Any]:
        raise AssertionError("duplicate pair must not reach Jev")

    repeated = _settle(
        engraphis_service,
        monkeypatch,
        payload=payload,
        classifier=forbidden,
    )
    assert repeated["intakeOperation"] == "noop"
    assert repeated["thinkMemoryId"] == first["thinkMemoryId"]
    assert repeated["relationships"] == []
    assert repeated["newSubjects"] == []
    assert _table_counts(engraphis_service) == before


@pytest.mark.parametrize(
    "failure",
    [
        adapter.JevRelationshipError("jev_relationship_unavailable"),
        adapter.JevRelationshipError("jev_relationship_timeout"),
    ],
)
def test_jev_provider_failure_creates_no_rows(
    engraphis_service: Any,
    monkeypatch: pytest.MonkeyPatch,
    failure: Exception,
) -> None:
    def fail(*_args: Any, **_kwargs: Any) -> dict[str, Any]:
        raise failure

    with pytest.raises(adapter.JevRelationshipError, match=str(failure)):
        _settle(engraphis_service, monkeypatch, classifier=fail)
    assert not any(_table_counts(engraphis_service).values())


def test_jev_abstention_creates_no_rows(
    engraphis_service: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    with pytest.raises(adapter.JevRelationshipError, match="abstained"):
        _settle(
            engraphis_service,
            monkeypatch,
            classifier=_classifier(adapter._THINKGRAPH_JEV_ABSTAIN),
        )
    assert not any(_table_counts(engraphis_service).values())


def test_invalid_jev_winner_creates_no_rows(
    engraphis_service: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    invalid = _decision()
    invalid["winner"] = "MODEL_AUTHORED_RAW_EDGE"
    with pytest.raises(adapter.JevRelationshipError, match="response_invalid"):
        _settle(
            engraphis_service,
            monkeypatch,
            classifier=lambda *_args, **_kwargs: invalid,
        )
    assert not any(_table_counts(engraphis_service).values())


def test_edge_store_failure_rolls_back_think_entities_and_supports(
    engraphis_service: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def fail_edge(*_args: Any, **_kwargs: Any) -> str:
        raise RuntimeError("edge-store-failed")

    monkeypatch.setattr(engraphis_service.store, "upsert_edge", fail_edge)
    with pytest.raises(adapter.ThinkGraphIntakeError, match="think_store_failed"):
        _settle(engraphis_service, monkeypatch)
    assert not any(_table_counts(engraphis_service).values())


def test_later_pair_reuses_subject_and_reports_only_new_endpoint(
    engraphis_service: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    first = _settle(engraphis_service, monkeypatch)
    later = {
        **_completed("main-run-two"),
        "completedAt": "2026-10-08T12:05:00Z",
        "userMessage": "What must Rocket Lab do next?",
        "mainResponse": "Rocket Lab must convert launch revenue into cash generation.",
        "mainSubjects": ["Cash generation"],
    }
    output = _structured_output(
        summary="Rocket Lab must convert launch revenue into cash generation.",
        title="Launch revenue must convert to cash",
        entities=["Rocket Lab", "Cash generation"],
        relations=[{
            "source": "Rocket Lab",
            "relation": "must convert launch revenue into",
            "target": "Cash generation",
        }],
    )
    second = _settle(
        engraphis_service,
        monkeypatch,
        payload=_settle_payload(
            later,
            output=output,
            card_run=_card_run("thinkgraph-run-two"),
        ),
        classifier=_classifier("REQUIRES"),
    )

    assert first["thinkMemoryId"] != second["thinkMemoryId"]
    assert {item["canonicalName"] for item in second["newSubjects"]} == {
        "Cash generation",
    }
    assert second["newMainSubjects"] == [{
        "canonicalName": "Cash generation",
        "engraphisEntityId": second["newSubjects"][0]["engraphisEntityId"],
        "engraphisMemoryId": second["thinkMemoryId"],
    }]
    entities = engraphis_service.store.list_entities()
    assert sum(entity.name == "Rocket Lab" for entity in entities) == 1
    assert _table_counts(engraphis_service)["memories"] == 2


def test_projection_and_anchor_keep_entity_ids_separate_from_think_id(
    engraphis_service: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.python_models.data_anchor import read_thinkgraph_exact

    settled = _settle(engraphis_service, monkeypatch)
    monkeypatch.setattr(adapter, "_projection_subject_directory", lambda _project: None)
    projection = adapter.projection("project-one")
    node_ids = {str(node["id"]) for node in projection["nodes"]}
    assert node_ids
    assert settled["thinkMemoryId"] not in node_ids
    assert all(edge["source"] in node_ids and edge["target"] in node_ids
               for edge in projection["edges"])

    rocket_id = next(
        str(node["id"]) for node in projection["nodes"]
        if node["label"] == "Rocket Lab"
    )
    anchored = read_thinkgraph_exact(
        "project-one",
        "engraphisEntityId",
        rocket_id,
        engraphis_reader=lambda project, id_field, identifier: adapter.inspect(
            project, id_field, identifier,
        ),
    )
    assert anchored is not None
    assert anchored["engraphisEntityId"] == rocket_id
    assert anchored["recordKind"] == "entity"


def test_real_jev_request_is_bounded_and_uses_only_declared_pair_context(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, Any] = {}
    vocabulary = tuple(adapter.SHARED_JEV_RELATIONSHIPS)
    response_decision = _decision("USES", vocabulary=vocabulary)
    choices = adapter._relationship_choices(vocabulary)

    class Response:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict[str, Any]:
            return {
                "id": response_decision["decision_id"],
                "provider": response_decision["provider"],
                "model": response_decision["resolved_model"],
                "usage": response_decision["usage"],
                "answers": {"relationship": {
                    "type": "choice",
                    "choice": "USES",
                    "confidence": response_decision["confidence"],
                    "probabilities": {
                        name: response_decision["distribution"][name]
                        for name in choices
                    },
                }},
            }

    class Client:
        def __init__(self, **_kwargs: Any) -> None:
            pass

        def __enter__(self) -> "Client":
            return self

        def __exit__(self, *_args: Any) -> None:
            return None

        def post(
            self,
            url: str,
            *,
            headers: dict[str, str],
            json: dict[str, Any],
        ) -> Response:
            captured.update({"url": url, "headers": headers, "json": deepcopy(json)})
            return Response()

    monkeypatch.setattr(adapter.httpx, "Client", Client)
    monkeypatch.setenv("OPENROUTER_API_KEY", "fixture-key")
    result = adapter.classify_relationship(
        "Rocket Lab",
        "Electron",
        _completed(),
        "Rocket Lab uses Electron.",
        {"nodes": [], "incident_edges": [], "latest_prior_thinks": []},
        "operates as its current launch vehicle",
        relationship_vocabulary=vocabulary,
    )

    assert result["winner"] == "USES"
    body = captured["json"]
    assert captured["url"] == adapter.JEV_ENDPOINT
    assert body["model"] == adapter.JEV_MODEL
    assert set(body["state"]) == {
        "description",
        "source_node_a",
        "target_node_b",
        "direction",
        "current_event",
        "thinkgraph_card_freeform_relationship_proposal",
        "supporting_think",
        "bounded_local_graph",
        "current_project_relationship_vocabulary",
    }
    assert body["state"]["current_event"] == (
        "USER:\nHow does Rocket Lab's Electron cadence affect launch revenue?\n\n"
        "MAIN:\nRocket Lab uses Electron, whose cadence can affect launch revenue."
    )
    assert set(body["questions"]["relationship"]["criteria"]) == set(choices)


def test_official_remember_many_is_atomic(engraphis_service: Any) -> None:
    from engraphis.core.interfaces import FactSpec

    workspace_id = engraphis_service.store.get_or_create_workspace("project-one")
    with pytest.raises(ValueError, match="non-empty content"):
        engraphis_service.engine.remember_many(
            [FactSpec(content="valid"), FactSpec(content="")],
            workspace_id=workspace_id,
        )
    assert _table_counts(engraphis_service)["memories"] == 0


def test_projection_excludes_memory_nodes(
    engraphis_service: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[dict[str, Any]] = []

    def graph_scene(**kwargs: Any) -> dict[str, Any]:
        calls.append(kwargs)
        return {"nodes": [], "edges": [], "meta": {"truncated": False}}

    monkeypatch.setattr(adapter, "get_service", lambda: engraphis_service)
    monkeypatch.setattr(engraphis_service, "graph_scene", graph_scene)
    monkeypatch.setattr(adapter, "_projection_subject_directory", lambda _project: None)

    result = adapter.projection("project-one")
    assert result["counts"] == {"nodes": 0, "edges": 0}
    assert calls[0]["include_memory_nodes"] is False
