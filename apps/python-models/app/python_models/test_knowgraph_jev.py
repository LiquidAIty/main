from copy import deepcopy

from app.python_models.knowgraph_jev import (
    KNOWGRAPH_RELATIONSHIPS,
    classify_knowgraph_fact,
    classify_knowgraph_facts,
)


EXPECTED_RELATIONSHIPS = (
    "IS_A", "PART_OF", "HAS_PART", "LOCATED_IN",
    "OWNS", "OPERATES", "PRODUCES", "PROVIDES", "USES", "DEPENDS_ON",
    "CAUSES", "AFFECTS", "PARTNERS_WITH", "COMPETES_WITH",
    "CONTRACTS_WITH", "SUPPLIES", "FUNDS", "INVESTS_IN", "ACQUIRES",
    "REGULATES", "GOVERNS", "REPORTS", "MEASURES", "ASSOCIATED_WITH",
    "OTHER_RELATION", "INSUFFICIENT_CONTEXT",
)


def native_fact() -> dict:
    return {
        "nativeFactUuid": "fact-1",
        "sourceEntity": {"uuid": "company-a", "name": "Rocket Lab"},
        "targetEntity": {"uuid": "customer-b", "name": "NASA"},
        "nativeRelation": "was awarded a launch services contract by",
        "fact": "NASA awarded Rocket Lab a launch services contract.",
        "supportingEpisodes": [{
            "uuid": "episode-1",
            "source_url": "https://example.test/source",
            "content_preview": "NASA announced the award.",
        }],
        "createdAt": "2026-09-24T00:00:00Z",
        "validAt": "2026-09-23T00:00:00Z",
    }


def choice_response(winner: str = "CONTRACTS_WITH") -> dict:
    probability = 0.01
    probabilities = {name: probability for name in KNOWGRAPH_RELATIONSHIPS}
    probabilities[winner] = 0.75
    return {
        "provider": "test-provider",
        "model": "typesafe/jev-1.13-test",
        "answers": {
            "relationship": {
                "type": "choice",
                "choice": winner,
                "probabilities": probabilities,
            },
        },
        "usage": {"input_tokens": 100},
    }


def test_choice_uses_exact_vocabulary_and_preserves_native_fact() -> None:
    assert KNOWGRAPH_RELATIONSHIPS == EXPECTED_RELATIONSHIPS
    fact = native_fact()
    original = deepcopy(fact)
    captured = {}

    def transport(body):
        captured.update(body)
        return choice_response()

    result = classify_knowgraph_fact(fact, transport=transport)

    assert fact == original
    assert result["status"] == "success"
    assert result["winner"] == "CONTRACTS_WITH"
    assert set(result["distribution"]) == set(EXPECTED_RELATIONSHIPS)
    assert abs(sum(result["distribution"].values()) - 1.0) < 1e-9
    assert "relationship_strength" not in result
    state = captured["state"]
    assert state["native_fact_uuid"] == "fact-1"
    assert state["source_entity_a"]["name"] == "Rocket Lab"
    assert state["target_entity_b"]["name"] == "NASA"
    assert state["native_graphiti_relationship"] == "was awarded a launch services contract by"
    assert state["supporting_source_episodes"][0]["uuid"] == "episode-1"
    assert set(captured["questions"]["relationship"]["criteria"]) == set(EXPECTED_RELATIONSHIPS)


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
        "question_schema_version": "knowgraph.relationship-choice.v1",
        "vocabulary_version": "knowgraph.relationships.v1",
        "vocabulary_hash": results[0]["vocabulary_hash"],
        "evaluated_at": results[0]["evaluated_at"],
        "failure_reason": "knowgraph_jev_unavailable",
    }]
