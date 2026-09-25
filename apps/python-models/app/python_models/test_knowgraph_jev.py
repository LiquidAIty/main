from copy import deepcopy
from threading import Lock
from time import sleep

from app.python_models.jev_edge_ontology import (
    SHARED_JEV_RELATIONSHIPS,
)
from app.python_models.engraphis import PROJECT_RELATIONSHIP_VOCABULARY_VERSION
from app.python_models.knowgraph_jev import (
    KNOWGRAPH_JEV_CHOICES,
    classify_knowgraph_fact,
    classify_knowgraph_facts,
)


EXPECTED_RELATIONSHIPS = (
    "IS_A", "PART_OF", "HAS_PART", "CAUSES", "AFFECTS", "DEPENDS_ON",
    "ENABLES", "CONSTRAINS", "REQUIRES", "SUPPORTS", "CONTRADICTS",
    "QUALIFIES", "EXPLAINS", "ASSOCIATED_WITH", "ALTERNATIVE_TO",
    "COMPETES_WITH", "PROVIDES", "USES", "PRECEDES", "FOLLOWS",
)
EXPECTED_CHOICES = EXPECTED_RELATIONSHIPS + ("INSUFFICIENT_CONTEXT",)


def native_fact() -> dict:
    return {
        "nativeFactUuid": "fact-1",
        "sourceEntity": {"uuid": "company-a", "name": "Rocket Lab"},
        "targetEntity": {"uuid": "customer-b", "name": "NASA"},
        "nativeRelation": "provides launch services to",
        "fact": "Rocket Lab provides NASA launch services under contract.",
        "supportingEpisodes": [{
            "uuid": "episode-1",
            "source_url": "https://example.test/source",
            "content_preview": "NASA announced the award.",
        }],
        "createdAt": "2026-09-24T00:00:00Z",
        "validAt": "2026-09-23T00:00:00Z",
    }


def choice_response(
    winner: str = "PROVIDES",
    choices: tuple[str, ...] = KNOWGRAPH_JEV_CHOICES,
) -> dict:
    probability = (1.0 - 0.75) / (len(choices) - 1)
    probabilities = {name: probability for name in choices}
    probabilities[winner] = 0.75
    return {
        "provider": "test-provider",
        "model": "typesafe/jev-1.13-test",
        "answers": {
            "relationship": {
                "type": "choice",
                "choice": winner,
                "probabilities": probabilities,
                "confidence": 0.61,
            },
        },
        "usage": {"input_tokens": 100},
    }


def test_choice_uses_exact_vocabulary_and_preserves_native_fact() -> None:
    assert SHARED_JEV_RELATIONSHIPS == EXPECTED_RELATIONSHIPS
    assert KNOWGRAPH_JEV_CHOICES == EXPECTED_CHOICES
    fact = native_fact()
    original = deepcopy(fact)
    captured = {}

    def transport(body):
        captured.update(body)
        return choice_response()

    result = classify_knowgraph_fact(fact, transport=transport)

    assert fact == original
    assert result["status"] == "success"
    assert result["winner"] == "PROVIDES"
    assert result["provider_confidence"] == 0.61
    assert result["label_confidence"] == 0.75
    assert set(result["distribution"]) == set(EXPECTED_CHOICES)
    assert abs(sum(result["distribution"].values()) - 1.0) < 1e-9
    assert "relationship_strength" not in result
    state = captured["state"]
    assert state["native_fact_uuid"] == "fact-1"
    assert state["source_entity_a"]["name"] == "Rocket Lab"
    assert state["target_entity_b"]["name"] == "NASA"
    assert state["native_graphiti_relationship"] == "provides launch services to"
    assert state["supporting_source_episodes"][0]["uuid"] == "episode-1"
    assert set(captured["questions"]["relationship"]["criteria"]) == set(EXPECTED_CHOICES)
    assert result["vocabulary_version"] == PROJECT_RELATIONSHIP_VOCABULARY_VERSION
    assert result["relationship_proposal_status"] == "invalid_novel_label"
    assert result["novel_relationship_candidate"] == ""


def test_materially_malformed_probability_total_is_rejected() -> None:
    response = choice_response()
    response["answers"]["relationship"]["probabilities"]["PROVIDES"] = 0.50

    try:
        classify_knowgraph_fact(native_fact(), transport=lambda _body: response)
    except Exception as error:
        assert str(error) == "knowgraph_jev_response_invalid"
    else:
        raise AssertionError("malformed provider probabilities must not be repaired")


def test_possible_two_decimal_probability_total_is_preserved() -> None:
    choices = ("PROVIDES", "QUALIFIES", "INSUFFICIENT_CONTEXT")
    response = choice_response(winner="PROVIDES", choices=choices)
    response["answers"]["relationship"]["probabilities"] = {
        choice: 0.33 for choice in choices
    }

    result = classify_knowgraph_fact(
        native_fact(),
        relationship_vocabulary=("PROVIDES", "QUALIFIES"),
        transport=lambda _body: response,
    )

    assert result["winner"] == "PROVIDES"
    assert result["distribution"] == {choice: 0.33 for choice in choices}


def test_provider_confidence_is_distinct_and_validated() -> None:
    response = choice_response()
    response["answers"]["relationship"]["confidence"] = 0.41
    result = classify_knowgraph_fact(
        native_fact(), transport=lambda _body: response
    )
    assert result["provider_confidence"] == 0.41
    assert result["label_confidence"] == 0.75

    response["answers"]["relationship"]["confidence"] = 1.01
    try:
        classify_knowgraph_fact(native_fact(), transport=lambda _body: response)
    except Exception as error:
        assert str(error) == "knowgraph_jev_response_invalid"
    else:
        raise AssertionError("provider confidence outside [0, 1] must fail")


def test_concise_native_relation_competes_as_one_optional_novel_candidate() -> None:
    fact = native_fact()
    fact["nativeRelation"] = "amplifies"
    captured = {}

    def transport(body):
        captured.update(body)
        choices = tuple(body["questions"]["relationship"]["criteria"])
        return choice_response("AMPLIFIES", choices)

    result = classify_knowgraph_fact(fact, transport=transport)

    assert result["status"] == "success"
    assert result["winner"] == "AMPLIFIES"
    assert result["novel_relationship_candidate"] == "AMPLIFIES"
    assert result["relationship_proposal_status"] == "novel_candidate"
    assert tuple(result["choice_options"])[-2:] == (
        "AMPLIFIES", "INSUFFICIENT_CONTEXT",
    )
    assert captured["state"]["optional_novel_relationship_candidate"] == "AMPLIFIES"


def test_insufficient_context_is_control_only_and_preserves_native_fact() -> None:
    fact = native_fact()
    original = deepcopy(fact)

    result = classify_knowgraph_fact(
        fact,
        transport=lambda _body: choice_response("INSUFFICIENT_CONTEXT"),
    )

    assert fact == original
    assert result["status"] == "unavailable"
    assert result["control_outcome"] == "INSUFFICIENT_CONTEXT"
    assert result["failure_reason"] == "knowgraph_jev_insufficient_context"
    assert "label_confidence" not in result
    assert result["winner"] not in SHARED_JEV_RELATIONSHIPS


def test_batch_failure_is_visible_and_never_removes_or_rewrites_fact() -> None:
    fact = native_fact()
    original = deepcopy(fact)

    def unavailable(_fact):
        raise RuntimeError("knowgraph_jev_unavailable")

    results = classify_knowgraph_facts([fact], classifier=unavailable)

    assert fact == original
    assert results == [{
        "nativeFactUuid": "fact-1",
        "status": "unavailable",
        "requested_model": "typesafe/jev-1.13",
        "question_schema_version": "knowgraph.relationship-choice.v3",
        "vocabulary_version": PROJECT_RELATIONSHIP_VOCABULARY_VERSION,
        "vocabulary_hash": results[0]["vocabulary_hash"],
        "vocabulary_count": 20,
        "evaluated_at": results[0]["evaluated_at"],
        "failure_reason": "knowgraph_jev_unavailable",
    }]


def test_full_batch_is_bounded_to_four_workers_and_preserves_native_order() -> None:
    lock = Lock()
    active = 0
    maximum_active = 0

    def classify(fact):
        nonlocal active, maximum_active
        with lock:
            active += 1
            maximum_active = max(maximum_active, active)
        sleep(0.002)
        with lock:
            active -= 1
        return {
            "status": "success",
            "winner": "PROVIDES",
            "distribution": {"PROVIDES": 1.0},
            "provider_confidence": 0.73,
        }

    facts = [
        {**native_fact(), "nativeFactUuid": f"fact-{index:02d}"}
        for index in range(64)
    ]
    results = classify_knowgraph_facts(
        facts,
        classifier=classify,
        deadline_seconds=1.0,
        provider_timeout_seconds=0.1,
    )

    assert maximum_active == 4
    assert [result["nativeFactUuid"] for result in results] == [
        f"fact-{index:02d}" for index in range(64)
    ]
    assert all(result["status"] == "success" for result in results)


def test_deadline_reports_exact_unfinished_ids_and_joins_admitted_work() -> None:
    completed: list[str] = []

    def classify(fact):
        sleep(0.03)
        completed.append(fact["nativeFactUuid"])
        return {
            "status": "success",
            "winner": "PROVIDES",
            "distribution": {"PROVIDES": 1.0},
            "provider_confidence": 0.73,
        }

    facts = [
        {**native_fact(), "nativeFactUuid": f"fact-{index}"}
        for index in range(8)
    ]
    results = classify_knowgraph_facts(
        facts,
        classifier=classify,
        deadline_seconds=0.05,
        provider_timeout_seconds=0.04,
    )
    unfinished = [
        result["nativeFactUuid"]
        for result in results
        if result["status"] == "unfinished"
    ]

    assert sorted(completed) == ["fact-0", "fact-1", "fact-2", "fact-3"]
    assert unfinished == ["fact-4", "fact-5", "fact-6", "fact-7"]
    snapshot = list(completed)
    sleep(0.05)
    assert completed == snapshot
