"""Focused proof for the one-Think, Jev-governed Engraphis lifecycle."""
from __future__ import annotations

from copy import deepcopy
from typing import Any, Callable

import pytest

from app.python_models import engraphis as service_adapter
from app.python_models import (
    thinkgraph_completed_pair_extraction as completed_pair_extraction,
)
from app.python_models import (
    thinkgraph_completed_pair_preparation as completed_pair_preparation,
)
from app.python_models import (
    thinkgraph_completed_pair_settlement as completed_pair_settlement,
)
from app.python_models import thinkgraph_projection as projection_adapter
from app.python_models import (
    thinkgraph_relationship_classification as relationship_classification,
)
from app.python_models import (
    thinkgraph_relationship_vocabulary as relationship_vocabulary,
)
from app.python_models.jev_edge_ontology import SHARED_JEV_RELATIONSHIPS
from app.python_models.thinkgraph_relationship_vocabulary import (
    relationship_choice_plan,
)


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
        "resolvedProvider": "openai-codex",
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
        "pairReference": completed_pair_preparation.pair_reference(source),
        "structuredOutput": output or _structured_output(),
        "cardRun": card_run or _card_run(),
    }


def _decision(
    winner: str = "USES",
    *,
    vocabulary: tuple[str, ...] | None = None,
    choices: tuple[str, ...] | None = None,
) -> dict[str, Any]:
    vocabulary = vocabulary or tuple(SHARED_JEV_RELATIONSHIPS)
    choices = choices or vocabulary
    distribution = {name: 0.0 for name in choices}
    distribution[winner] = 0.76
    alternate = next(name for name in choices if name != winner)
    distribution[alternate] = 0.24
    return {
        "decision_id": "jev-decision-one",
        "winner": winner,
        "distribution": distribution,
        "confidence": 0.91,
        "provider": "TypeSafe",
        "requested_model": relationship_classification.JEV_MODEL,
        "resolved_model": "typesafe/jev-1.13-test",
        "usage": {"input_tokens": 12, "output_tokens": 4},
        "vocabulary_version": relationship_vocabulary.PROJECT_RELATIONSHIP_VOCABULARY_VERSION,
        "vocabulary_hash": relationship_vocabulary.relationship_vocabulary_hash(vocabulary),
        "vocabulary_count": len(vocabulary),
    }


def _classifier(winner: str = "USES") -> Callable[..., dict[str, Any]]:
    def classify(*args: Any, **kwargs: Any) -> dict[str, Any]:
        vocabulary = tuple(kwargs["relationship_vocabulary"])
        plan = relationship_choice_plan(
            str(args[5]), vocabulary,
        )
        assert kwargs["novel_relationship_candidate"] == plan["novel_candidate"]
        assert kwargs["relationship_proposal_status"] == plan["proposal_status"]
        return _decision(
            winner,
            vocabulary=vocabulary,
            choices=tuple(plan["choices"]),
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
    monkeypatch.setattr(service_adapter, "_service", service)
    return completed_pair_settlement.settle_completed_pair(
        payload or _settle_payload(),
        classifier=classifier or _classifier(),
    )


def test_custom_schema_requires_exactly_one_episodic_think() -> None:
    schema, prompt = completed_pair_extraction.llm_structured_contract(
        "USER: x\nMAIN: y", {"canonical_subject_directory": {}}
    )
    facts = completed_pair_extraction.extract_saved_card_facts(
        _structured_output(),
        pair_text="USER: x\nMAIN: y",
        context={},
        card_run=_card_run(),
    )
    projected = completed_pair_extraction.project_saved_card_think(facts)

    assert len(facts) == 1
    assert facts[0].mtype == service_adapter.MemoryType.EPISODIC
    assert projected["summary"] == facts[0].content
    assert projected["entities"] == ["Rocket Lab", "Electron"]
    assert projected["relationships"][0]["relation"] == (
        "operates as its current launch vehicle"
    )
    assert "think" in str(schema)
    assert "Return exactly one object in the facts array" in prompt
    assert "Jev alone" in prompt


def test_relationship_choice_plan_has_no_abstention_option() -> None:
    vocabulary = tuple(SHARED_JEV_RELATIONSHIPS)
    long_proposal = relationship_choice_plan(
        "operates as its current launch vehicle",
        vocabulary,
    )
    novel = relationship_choice_plan(
        "amplifies",
        vocabulary,
    )

    assert "NONE" not in long_proposal["choices"]
    assert long_proposal["proposal_status"] == "invalid_novel_label"
    assert long_proposal["choices"] == vocabulary
    assert novel["novel_candidate"] == "AMPLIFIES"
    assert novel["choices"] == (*vocabulary, "AMPLIFIES")
    assert "NONE" not in novel["choices"]


def test_prepare_is_non_persisting_and_returns_exact_extraction_contract(
    engraphis_service: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    directory = {
        "schemaVersion": "graph-subject-directory",
        "projectId": "project-one",
        "complete": True,
        "counts": {"engraphis": 0, "graphiti": 0, "total": 0},
        "revisions": {"engraphis": "0:test", "graphiti": "test"},
        "subjects": [],
        "sha256": "test",
        "bytes": 0,
        "estimatedTokens": 0,
        "readDurationMs": 0.0,
    }
    monkeypatch.setattr(service_adapter, "_service", engraphis_service)
    monkeypatch.setattr(
        completed_pair_preparation,
        "_subject_directory_for_project",
        lambda _project: directory,
    )
    before = _table_counts(engraphis_service)

    prepared = completed_pair_preparation.prepare_completed_pair(_completed())

    assert prepared["pairReference"] == completed_pair_preparation.pair_reference(
        _completed()
    )
    assert prepared["intakeOperation"] == "pending"
    assert prepared["structuredExtractionRequired"] is True
    assert prepared["revisionChanged"] is False
    assert prepared["preparation"] == {
        "status": "completed_without_graph_mutation"
    }
    assert prepared["canonicalSubjectDirectory"] == directory
    assert prepared["enrichmentInput"]["canonical_subject_directory"] == directory
    assert "think" in str(prepared["enrichmentSchema"])
    assert "THINKGRAPH TEMPORAL THINK" in prepared["enrichmentPrompt"]
    assert _table_counts(engraphis_service) == before


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
        (relationship_vocabulary.ThinkGraphIntakeError, ValueError),
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
    completed = _completed()
    settled = _settle(
        engraphis_service,
        monkeypatch,
        payload=_settle_payload(completed),
    )

    assert settled["intakeOperation"] == "add"
    assert settled["thinkMemoryIds"] == [settled["thinkMemoryId"]]
    assert len(settled["newSubjects"]) == 2

    memory = engraphis_service.store.get_memory(settled["thinkMemoryId"])
    assert memory is not None
    assert memory.mtype == service_adapter.MemoryType.EPISODIC
    assert memory.metadata["consolidation_exempt"] is True
    origin = memory.metadata["thinkgraph_origin"]
    assert origin["card_id"] == "card_thinkgraph"
    assert origin["card_revision_id"] == "revision-one"
    assert origin["run_id"] == "thinkgraph-run-one"
    assert origin["profile"] == "thinkgraph"
    assert origin["hermes_session_id"] == "thinkgraph-session-one"
    assert origin["resolved_provider"] == "openai-codex"
    assert origin["resolved_model"] == "configured/model"
    assert origin["source_pair"] == {
        "projectId": "project-one",
        "deckId": "deck_builder",
        "conversationId": "conversation-one",
        "runId": "main-run-one",
        "cardId": "card_main_chat",
        "hermesSessionId": "main-session",
        "completedAt": "2026-10-08T12:00:00Z",
        "user_sha256": completed_pair_preparation.text_hash(
            _completed()["userMessage"]
        ),
        "main_sha256": completed_pair_preparation.text_hash(
            _completed()["mainResponse"]
        ),
    }
    assert "userMessage" not in origin["source_pair"]
    assert "mainResponse" not in origin["source_pair"]
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
    entity_ids = {entity.name: entity.id for entity in entities}
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
    assert (edge.src, edge.dst) == (
        entity_ids["Rocket Lab"], entity_ids["Electron"],
    )
    assert edge.relation == "USES"
    assert edge.relation != think["relationships"][0]["relation"]
    assert edge.weight == pytest.approx(0.76)
    assert settled["relationships"][0]["choice_options"] == list(
        SHARED_JEV_RELATIONSHIPS
    )
    assert "NONE" not in settled["relationships"][0]["choice_options"]
    jev = edge.provenance["jev"]
    assert jev["decision_id"] == "jev-decision-one"
    assert jev["winner"] == "USES"
    assert jev["distribution"]["USES"] == pytest.approx(0.76)
    assert jev["label_confidence"] == pytest.approx(0.76)
    assert jev["relationship_strength"] == pytest.approx(0.76)
    assert jev["provider"] == "TypeSafe"
    assert jev["requested_model"] == relationship_classification.JEV_MODEL
    assert jev["resolved_model"] == "typesafe/jev-1.13-test"
    assert jev["natural_relationship"] == (
        "operates as its current launch vehicle"
    )
    assert jev["relationship_proposal_status"] == "invalid_novel_label"
    assert jev["novel_relationship_candidate"] == ""
    assert jev["vocabulary_promotion"] == "not_promoted"
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
        novel_relationship_candidate: str,
        relationship_proposal_status: str,
    ) -> dict[str, Any]:
        calls.append((source, proposal, target))
        winner = "USES" if source == "Rocket Lab" else "SUPPORTS"
        plan = relationship_choice_plan(
            proposal, relationship_vocabulary,
        )
        assert novel_relationship_candidate == plan["novel_candidate"]
        assert relationship_proposal_status == plan["proposal_status"]
        return _decision(
            winner,
            vocabulary=relationship_vocabulary,
            choices=tuple(plan["choices"]),
        )

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


def test_valid_novel_predicate_is_selected_promoted_and_persisted(
    engraphis_service: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    output = _structured_output(
        summary="Rocket Lab amplifies Electron launch capability.",
        entities=["Rocket Lab", "Electron"],
        relations=[{
            "source": "Rocket Lab",
            "relation": "amplifies",
            "target": "Electron",
        }],
    )

    settled = _settle(
        engraphis_service,
        monkeypatch,
        payload=_settle_payload(output=output),
        classifier=_classifier("AMPLIFIES"),
    )

    workspace_id = engraphis_service.store.get_or_create_workspace("project-one")
    vocabulary = relationship_vocabulary.project_relationship_vocabulary(
        engraphis_service.store,
        workspace_id,
    )
    assert vocabulary[-1] == "AMPLIFIES"
    assert vocabulary.count("AMPLIFIES") == 1
    assert settled["relationshipVocabulary"]["labels"] == list(vocabulary)
    assert settled["relationships"][0]["relation"] == "AMPLIFIES"
    assert settled["relationships"][0]["vocabulary_promotion"] == "promoted"
    assert settled["relationships"][0]["vocabulary_after_count"] == len(vocabulary)
    edge = engraphis_service.store.neighbors(
        [settled["relationships"][0]["source"]]
    )[0]
    assert (edge.src, edge.dst) == (
        settled["relationships"][0]["source"],
        settled["relationships"][0]["target"],
    )
    assert edge.relation == "AMPLIFIES"
    assert edge.provenance["jev"]["relationship_proposal_status"] == (
        "novel_candidate"
    )
    assert edge.provenance["jev"]["novel_relationship_candidate"] == (
        "AMPLIFIES"
    )
    assert edge.provenance["jev"]["vocabulary_promotion"] == "promoted"
    assert edge.provenance["jev"]["vocabulary_after_count"] == len(vocabulary)


def test_duplicate_pair_is_exact_noop_without_another_jev_call(
    engraphis_service: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    payload = _settle_payload()
    first = _settle(engraphis_service, monkeypatch, payload=payload)
    before = _table_counts(engraphis_service)
    prepared = completed_pair_preparation.prepare_completed_pair(_completed())

    assert prepared["intakeOperation"] == "noop"
    assert prepared["structuredExtractionRequired"] is False
    assert prepared["thinkMemoryIds"] == [first["thinkMemoryId"]]
    assert prepared["revisionChanged"] is False
    assert _table_counts(engraphis_service) == before

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
        relationship_classification.JevRelationshipError("jev_relationship_unavailable"),
        relationship_classification.JevRelationshipError("jev_relationship_timeout"),
    ],
)
def test_jev_provider_failure_creates_no_rows(
    engraphis_service: Any,
    monkeypatch: pytest.MonkeyPatch,
    failure: Exception,
) -> None:
    def fail(*_args: Any, **_kwargs: Any) -> dict[str, Any]:
        raise failure

    with pytest.raises(relationship_classification.JevRelationshipError, match=str(failure)):
        _settle(engraphis_service, monkeypatch, classifier=fail)
    assert not any(_table_counts(engraphis_service).values())


def test_invalid_jev_winner_creates_no_rows(
    engraphis_service: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    invalid = _decision()
    invalid["winner"] = "MODEL_AUTHORED_RAW_EDGE"
    with pytest.raises(relationship_classification.JevRelationshipError, match="response_invalid"):
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
    output = _structured_output(
        relations=[{
            "source": "Rocket Lab",
            "relation": "amplifies",
            "target": "Electron",
        }],
    )

    def fail_edge(*_args: Any, **_kwargs: Any) -> str:
        raise RuntimeError("edge-store-failed")

    monkeypatch.setattr(engraphis_service.store, "upsert_edge", fail_edge)
    with pytest.raises(relationship_vocabulary.ThinkGraphIntakeError, match="think_store_failed"):
        _settle(
            engraphis_service,
            monkeypatch,
            payload=_settle_payload(output=output),
            classifier=_classifier("AMPLIFIES"),
        )
    assert not any(_table_counts(engraphis_service).values())
    workspace_id = engraphis_service.store.get_or_create_workspace("project-one")
    assert "AMPLIFIES" not in (
        relationship_vocabulary.project_relationship_vocabulary(
            engraphis_service.store,
            workspace_id,
        )
    )


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
    entities = engraphis_service.store.list_entities()
    assert sum(entity.name == "Rocket Lab" for entity in entities) == 1
    assert _table_counts(engraphis_service)["memories"] == 2


def test_projection_and_anchor_keep_entity_ids_separate_from_think_id(
    engraphis_service: Any,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.python_models.thinkgraph_reference_reads import read_thinkgraph_exact

    settled = _settle(engraphis_service, monkeypatch)
    monkeypatch.setattr(projection_adapter, "_projection_subject_directory", lambda _project: None)
    projection = projection_adapter.projection("project-one")
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
    )
    assert anchored is not None
    assert anchored["engraphisEntityId"] == rocket_id
    assert anchored["recordKind"] == "entity"


def test_real_jev_request_is_bounded_and_uses_only_declared_pair_context(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, Any] = {}
    vocabulary = tuple(SHARED_JEV_RELATIONSHIPS)
    response_decision = _decision("USES", vocabulary=vocabulary)
    choices = tuple(relationship_choice_plan(
        "operates as its current launch vehicle",
        vocabulary,
    )["choices"])

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

    monkeypatch.setattr(relationship_classification.httpx, "Client", Client)
    monkeypatch.setenv("OPENROUTER_API_KEY", "fixture-key")
    result = relationship_classification.classify_relationship(
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
    assert captured["url"] == relationship_classification.JEV_ENDPOINT
    assert body["model"] == relationship_classification.JEV_MODEL
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
    assert "NONE" not in body["questions"]["relationship"]["criteria"]


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

    monkeypatch.setattr(service_adapter, "_service", engraphis_service)
    monkeypatch.setattr(engraphis_service, "graph_scene", graph_scene)
    monkeypatch.setattr(projection_adapter, "_projection_subject_directory", lambda _project: None)

    result = projection_adapter.projection("project-one")
    assert result["counts"] == {"nodes": 0, "edges": 0}
    assert calls[0]["include_memory_nodes"] is False
