from __future__ import annotations

import json

import pytest

from app.python_models import engraphis as adapter
from app.python_models.engraphis import AtomicResearchError, validate_atomic_research_result


CALL_ONE = "know-call:11111111-1111-4111-8111-111111111111"
CALL_TWO = "know-call:22222222-2222-4222-8222-222222222222"


def _know(name: str = "Rocket Lab evidence", count: int = 1) -> dict:
    return {
        "schemaVersion": "knowgraph.source-observation.v2",
        "name": name,
        "observations": [
            {
                "datum": f"Complete qualified datum {index}.",
                "interpretation": f"Bounded interpretation {index}.",
                "citations": [{
                    "url": f"https://primary.example/report/{index}",
                    "title": None,
                    "publishedAt": None,
                    "sourceNote": f"This source establishes datum {index}.",
                }],
                "relevantEntities": ["Rocket Lab", "Revenue attribution"],
            }
            for index in range(count)
        ],
    }


def _episode(
    episode_id: str = "episode-one",
    call_id: str = CALL_ONE,
    *,
    know: dict | None = None,
) -> dict:
    canonical = know or _know()
    objective = {
        "observations": [
            {"datum": observation["datum"]}
            for observation in canonical["observations"]
        ],
    }
    return {
        "uuid": episode_id,
        "liquidaity_record_kind": "canonical_know",
        "liquidaity_schema_version": "knowgraph.source-observation.v2",
        "liquidaity_call_id": call_id,
        "canonicalKnow": canonical,
        "content": json.dumps(objective, separators=(",", ":")),
    }


def _event(
    call_id: str = CALL_ONE,
    episode_id: str = "episode-one",
    phase: str = "completed",
    **changes,
) -> dict:
    return {
        "eventId": call_id,
        "callId": call_id,
        "phase": phase,
        "projectId": "project-one",
        "deckId": "deck-one",
        "runId": "atomic_research:child",
        "cardId": "knowgraph",
        "authority": "knowgraph",
        "operation": "write",
        "toolName": "graphiti.add_memory",
        "nativeEpisodeIds": [episode_id] if phase == "completed" else [],
        "nativeNodeIds": ["entity-one", "entity-two"],
        "nativeEdgeIds": ["fact-one"],
        **changes,
    }


def _payload(*, call_id: str | None = CALL_ONE) -> dict:
    return {
        "projectId": "project-one",
        "deckId": "deck-one",
        "assessmentId": "atomic-research-assessment:one",
        "sourceRunId": "run-main",
        "childRunId": "atomic_research:child",
        "knowGraphCardId": "knowgraph",
        "thinkMemoryIds": ["think-one"],
        "output": {
            "schemaVersion": "atomic-research-response.v2",
            "callId": call_id,
            "results": [{
                "status": "supported" if call_id else "source-unavailable",
                "summary": (
                    "The primary evidence supports the bounded Think."
                    if call_id else "No usable primary-source evidence was available."
                ),
            }],
        },
    }


def test_atomic_research_settlement_bound_covers_measured_native_completion() -> None:
    assert adapter.ATOMIC_RESEARCH_EPISODE_READBACK_TIMEOUT_SECONDS == 180.0
    assert adapter.ATOMIC_RESEARCH_EPISODE_READBACK_POLL_SECONDS == 2.0


def test_one_grouped_structured_know_settles_to_exactly_one_episode() -> None:
    know = _know(count=4)
    reads = []

    def episodes(project, ids):
        reads.append((project, list(ids)))
        return [_episode(know=know)]

    result = validate_atomic_research_result(
        _payload(),
        episode_reader=episodes,
        attention_reader=lambda *_args: [_event()],
    )

    settled = result["result"]["results"][0]
    assert result["citationCount"] == 4
    assert result["episodeCount"] == 1
    assert settled["episodeUuid"] == "episode-one"
    assert settled["know"] == know
    assert [citation["sourceNote"] for observation in know["observations"]
            for citation in observation["citations"]] == [
        "This source establishes datum 0.",
        "This source establishes datum 1.",
        "This source establishes datum 2.",
        "This source establishes datum 3.",
    ]
    assert result["settlement"] == {
        "eventIds": [CALL_ONE],
        "callIds": [CALL_ONE],
        "phase": "completed",
        "episodeUuids": ["episode-one"],
    }
    assert reads == [("project-one", ["episode-one"])]


def test_settlement_ignores_entity_and_fact_ids_as_episode_candidates() -> None:
    observed_ids = []

    def episodes(_project, ids):
        observed_ids.extend(ids)
        return [_episode()]

    validate_atomic_research_result(
        _payload(), episode_reader=episodes,
        attention_reader=lambda *_args: [_event(
            nativeNodeIds=["episode-lookalike", "entity-one"],
            nativeEdgeIds=["fact-one"],
        )],
    )
    assert observed_ids == ["episode-one"]


def test_two_results_settle_through_one_call_and_one_episode_not_name_or_url() -> None:
    payload = _payload()
    payload["thinkMemoryIds"] = ["think-one", "think-two"]
    payload["output"]["results"].append({
        "status": "contradicted",
        "summary": "A second exact Know contradicts the second Think.",
    })
    first = _know(name="Same name")
    first["observations"].append({
        **first["observations"][0],
        "datum": "Distinct second datum.",
        "interpretation": "Distinct second interpretation.",
        "citations": [{
            **first["observations"][0]["citations"][0],
            "sourceNote": "The same link establishes a distinct second datum.",
        }],
    })

    result = validate_atomic_research_result(
        payload,
        attention_reader=lambda *_args: [_event(CALL_ONE, "episode-one")],
        episode_reader=lambda _project, _ids: [
            _episode("episode-one", CALL_ONE, know=first),
        ],
    )

    assert [item["episodeUuid"] for item in result["result"]["results"]] == [
        "episode-one", "episode-one",
    ]
    assert all(len(item["know"]["observations"]) == 2
               for item in result["result"]["results"])


def test_result_contract_rejects_model_episode_or_flat_citation_fields() -> None:
    for extra in (
        {"episodeUuid": "invented"},
        {"citations": [{"url": "https://primary.example/report"}]},
    ):
        payload = _payload()
        payload["output"]["results"][0].update(extra)
        with pytest.raises(AtomicResearchError, match="result_contract_invalid"):
            validate_atomic_research_result(payload)


def test_readback_rejects_unexplained_or_detached_citation_shape() -> None:
    malformed = _know()
    citation = malformed["observations"][0]["citations"][0]
    citation.pop("sourceNote")
    with pytest.raises(AtomicResearchError, match="know_readback_invalid"):
        validate_atomic_research_result(
            _payload(),
            attention_reader=lambda *_args: [_event()],
            episode_reader=lambda *_args: [_episode(know=malformed)],
        )


def test_readback_rejects_interpretation_or_source_note_in_objective_body() -> None:
    episode = _episode()
    body = json.loads(episode["content"])
    body["observations"][0]["interpretation"] = "Must stay analysis only."
    episode["content"] = json.dumps(body)
    with pytest.raises(AtomicResearchError, match="know_objective_body_invalid"):
        validate_atomic_research_result(
            _payload(),
            attention_reader=lambda *_args: [_event()],
            episode_reader=lambda *_args: [episode],
        )


def test_result_rejects_transport_id_in_summary_or_know_prose() -> None:
    payload = _payload()
    payload["output"]["results"][0]["summary"] = "Result for think-one."
    with pytest.raises(AtomicResearchError, match="transport_identifier_in_prose"):
        validate_atomic_research_result(payload)

    know = _know()
    know["observations"][0]["interpretation"] = "Analysis for think-one."
    with pytest.raises(AtomicResearchError, match="transport_identifier_in_prose"):
        validate_atomic_research_result(
            _payload(),
            attention_reader=lambda *_args: [_event()],
            episode_reader=lambda *_args: [_episode(know=know)],
        )


class _ReadbackClock:
    def __init__(self) -> None:
        self.now = 0.0
        self.sleeps: list[float] = []

    def monotonic(self) -> float:
        return self.now

    def sleep(self, seconds: float) -> None:
        self.sleeps.append(seconds)
        self.now += seconds


def test_pending_event_times_out_without_episode_substitution(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    clock = _ReadbackClock()
    monkeypatch.setattr(adapter.time, "monotonic", clock.monotonic)
    monkeypatch.setattr(adapter.time, "sleep", clock.sleep)
    monkeypatch.setattr(adapter, "ATOMIC_RESEARCH_EPISODE_READBACK_TIMEOUT_SECONDS", 2.0)
    monkeypatch.setattr(adapter, "ATOMIC_RESEARCH_EPISODE_READBACK_POLL_SECONDS", 1.0)

    with pytest.raises(AtomicResearchError, match="episode_settlement_pending"):
        validate_atomic_research_result(
            _payload(),
            attention_reader=lambda *_args: [_event(phase="pending")],
            episode_reader=lambda *_args: pytest.fail(
                "pending event must not hydrate an entity or fact as an episode"
            ),
        )
    assert clock.sleeps == [1.0, 1.0]


def test_completed_event_requires_exactly_one_native_episode_id() -> None:
    with pytest.raises(
        AtomicResearchError,
        match="completed_write_episode_identity_invalid",
    ):
        validate_atomic_research_result(
            _payload(),
            attention_reader=lambda *_args: [_event(
                nativeEpisodeIds=["episode-one", "episode-two"],
            )],
            episode_reader=lambda *_args: pytest.fail("malformed event must fail first"),
        )


def test_missing_or_mismatched_exact_episode_readback_is_not_success() -> None:
    with pytest.raises(AtomicResearchError, match="episode_call_identity_mismatch"):
        validate_atomic_research_result(
            _payload(),
            attention_reader=lambda *_args: [_event()],
            episode_reader=lambda *_args: [_episode(call_id=CALL_TWO)],
        )


def test_source_unavailable_without_call_does_not_infer_an_episode() -> None:
    result = validate_atomic_research_result(
        _payload(call_id=None),
        episode_reader=lambda *_args: pytest.fail("no call means no readback"),
        attention_reader=lambda *_args: pytest.fail("no call means no settlement"),
    )
    settled = result["result"]["results"][0]
    assert settled["status"] == "source-unavailable"
    assert settled["episodeUuid"] is None
    assert result["episodeCount"] == result["citationCount"] == 0


def test_result_item_cannot_override_the_one_top_level_call_identity() -> None:
    payload = _payload()
    payload["thinkMemoryIds"] = ["think-one", "think-two"]
    payload["output"]["results"][0]["callId"] = CALL_TWO
    with pytest.raises(AtomicResearchError, match="result_contract_invalid"):
        validate_atomic_research_result(payload)
