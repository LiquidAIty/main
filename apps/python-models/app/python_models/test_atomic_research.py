from __future__ import annotations

import pytest

from app.python_models import engraphis as adapter
from app.python_models.engraphis import (
    AtomicResearchError,
    validate_atomic_research_result,
)


def _payload() -> dict:
    return {
        "projectId": "project-one",
        "deckId": "deck-one",
        "assessmentId": "atomic-research-assessment:one",
        "sourceRunId": "run-main",
        "childRunId": "atomic_research:child",
        "knowGraphCardId": "knowgraph",
        "thinkMemoryIds": ["think-one"],
        "output": {
            "schemaVersion": "atomic-research-response.v1",
            "results": [{
                "status": "supported",
                "summary": "The current primary source supports the bounded Think.",
                "citations": [{
                    "url": "https://primary.example/report",
                    "title": "Primary report",
                    "publishedAt": "2026-10-01",
                }],
                "episodeUuids": [],
            }],
        },
    }


def _event(phase="completed", **changes) -> dict:
    return {
        "eventId": "native-attention:write-one",
        "phase": phase,
        "projectId": "project-one",
        "deckId": "deck-one",
        "runId": "atomic_research:child",
        "cardId": "knowgraph",
        "authority": "knowgraph",
        "operation": "write",
        "toolName": "graphiti.add_memory",
        "nativeNodeIds": ["episode-one", "entity-one", "entity-two"],
        **changes,
    }


def test_atomic_research_settlement_bound_covers_measured_native_completion() -> None:
    assert adapter.ATOMIC_RESEARCH_EPISODE_READBACK_TIMEOUT_SECONDS == 180.0
    assert adapter.ATOMIC_RESEARCH_EPISODE_READBACK_POLL_SECONDS == 2.0


def test_atomic_research_result_requires_exact_persisted_episode_readback() -> None:
    reads = []

    def episodes(project, ids):
        reads.append((project, list(ids)))
        return [{
            "uuid": "episode-one",
            "source_description": '["https://primary.example/report"]',
        }]

    result = validate_atomic_research_result(
        _payload(),
        episode_reader=episodes,
        attention_reader=lambda *_args: _event(),
    )
    assert result["ok"] is True
    assert result["citationCount"] == 1
    assert result["episodeCount"] == 1
    assert result["result"]["results"][0]["status"] == "supported"
    assert result["result"]["results"][0]["thinkMemoryId"] == "think-one"
    assert result["result"]["results"][0]["episodeUuids"] == ["episode-one"]
    assert result["settlement"] == {
        "eventId": "native-attention:write-one",
        "phase": "completed",
        "episodeUuids": ["episode-one"],
    }
    assert result["sharedChatText"] == (
        "Research result\n\n"
        "Supported: The current primary source supports the bounded Think.\n\n"
        "Evidence and sources are retained in KnowGraph."
    )
    assert "https://primary.example/report" not in result["sharedChatText"]
    assert "Primary report" not in result["sharedChatText"]
    assert reads == [(
        "project-one", ["episode-one", "entity-one", "entity-two"],
    )]


def test_atomic_research_model_response_rejects_echoed_runtime_ids() -> None:
    payload = _payload()
    payload["output"]["assessmentId"] = payload["assessmentId"]
    payload["output"]["sourceRunId"] = payload["sourceRunId"]
    payload["output"]["results"][0]["thinkMemoryId"] = "think-one"

    with pytest.raises(
        AtomicResearchError,
        match="atomic_research_result_contract_invalid",
    ):
        validate_atomic_research_result(payload)


def test_atomic_research_result_rejects_transport_id_in_summary_prose() -> None:
    payload = _payload()
    payload["output"]["results"][0]["summary"] = (
        "The sourced result for think-one is supported."
    )

    with pytest.raises(
        AtomicResearchError,
        match="atomic_research_transport_identifier_in_prose",
    ):
        validate_atomic_research_result(payload)


def test_atomic_research_result_rejects_transport_id_in_native_episode_prose() -> None:
    with pytest.raises(
        AtomicResearchError,
        match="atomic_research_transport_identifier_in_prose",
    ):
        validate_atomic_research_result(
            _payload(),
            episode_reader=lambda *_args: [{
                "uuid": "episode-one",
                "content": "Research packet for Think memory think-one.",
                "source_description": '["https://primary.example/report"]',
            }],
            attention_reader=lambda *_args: _event(),
        )


def test_atomic_research_result_rejects_mismatched_episode_ref() -> None:
    payload = _payload()
    payload["output"]["results"][0]["episodeUuids"] = ["different-episode"]
    with pytest.raises(
        AtomicResearchError,
        match="atomic_research_episode_reference_mismatch",
    ):
        validate_atomic_research_result(
            payload,
            episode_reader=lambda *_args: [{
                "uuid": "episode-one",
                "source_url": "https://primary.example/report",
            }],
            attention_reader=lambda *_args: _event(),
        )


def test_atomic_research_result_rejects_citation_episode_mismatch() -> None:
    with pytest.raises(
        AtomicResearchError,
        match="atomic_research_citation_episode_mismatch",
    ):
        validate_atomic_research_result(
            _payload(),
            episode_reader=lambda *_args: [{
                "uuid": "episode-one",
                "source_url": "https://different.example/source",
            }],
            attention_reader=lambda *_args: _event(),
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


def test_atomic_research_result_waits_for_delayed_exact_episode(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    clock = _ReadbackClock()
    attention_reads = []
    episode_reads = []

    def attention(*args):
        attention_reads.append(args)
        return _event("pending" if len(attention_reads) < 3 else "completed")

    def delayed_episode(project, ids):
        episode_reads.append((project, list(ids)))
        if len(episode_reads) < 2:
            return []
        return [{
            "uuid": "episode-one",
            "source_url": "https://primary.example/report",
        }]

    monkeypatch.setattr(adapter.time, "monotonic", clock.monotonic)
    monkeypatch.setattr(adapter.time, "sleep", clock.sleep)
    monkeypatch.setattr(
        adapter, "ATOMIC_RESEARCH_EPISODE_READBACK_TIMEOUT_SECONDS", 3.0,
    )
    monkeypatch.setattr(
        adapter, "ATOMIC_RESEARCH_EPISODE_READBACK_POLL_SECONDS", 1.0,
    )

    result = validate_atomic_research_result(
        _payload(),
        episode_reader=delayed_episode,
        attention_reader=attention,
    )

    assert result["result"]["results"][0]["status"] == "supported"
    assert result["result"]["results"][0]["episodeUuids"] == ["episode-one"]
    assert attention_reads == [
        ("project-one", "deck-one", "atomic_research:child", "knowgraph"),
        ("project-one", "deck-one", "atomic_research:child", "knowgraph"),
        ("project-one", "deck-one", "atomic_research:child", "knowgraph"),
    ]
    assert episode_reads == [
        ("project-one", ["episode-one", "entity-one", "entity-two"]),
        ("project-one", ["episode-one", "entity-one", "entity-two"]),
    ]
    assert clock.sleeps == [1.0, 1.0, 1.0]


def test_atomic_research_result_readback_timeout_remains_unverified(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    clock = _ReadbackClock()
    reads = []

    def pending(*args):
        reads.append(args)
        return _event("pending")

    monkeypatch.setattr(adapter.time, "monotonic", clock.monotonic)
    monkeypatch.setattr(adapter.time, "sleep", clock.sleep)
    monkeypatch.setattr(
        adapter, "ATOMIC_RESEARCH_EPISODE_READBACK_TIMEOUT_SECONDS", 2.0,
    )
    monkeypatch.setattr(
        adapter, "ATOMIC_RESEARCH_EPISODE_READBACK_POLL_SECONDS", 1.0,
    )

    with pytest.raises(
        AtomicResearchError,
        match="atomic_research_episode_settlement_pending",
    ):
        validate_atomic_research_result(
            _payload(),
            episode_reader=lambda *_args: pytest.fail(
                "pending event must not trigger native episode reads"
            ),
            attention_reader=pending,
        )

    assert reads == [
        ("project-one", "deck-one", "atomic_research:child", "knowgraph"),
        ("project-one", "deck-one", "atomic_research:child", "knowgraph"),
        ("project-one", "deck-one", "atomic_research:child", "knowgraph"),
    ]
    assert clock.sleeps == [1.0, 1.0]


def test_atomic_research_result_rejects_mismatched_write_event_scope() -> None:
    with pytest.raises(
        AtomicResearchError,
        match="atomic_research_write_event_scope_mismatch",
    ):
        validate_atomic_research_result(
            _payload(),
            episode_reader=lambda *_args: pytest.fail(
                "mismatched write event must fail before episode reads"
            ),
            attention_reader=lambda *_args: _event(runId="another-run"),
        )


def test_atomic_research_source_unavailable_without_episode_id_does_not_infer_one() -> None:
    payload = _payload()
    result_item = payload["output"]["results"][0]
    result_item.update({
        "status": "source-unavailable",
        "summary": "No usable primary-source evidence was available.",
        "citations": [],
        "episodeUuids": [],
    })

    result = validate_atomic_research_result(
        payload,
        episode_reader=lambda *_args: pytest.fail(
            "an absent native episode ID must not be inferred or searched"
        ),
        attention_reader=lambda *_args: pytest.fail(
            "a semantic source failure must not wait for write settlement"
        ),
    )

    assert result["result"]["results"][0]["status"] == "source-unavailable"
    assert result["result"]["results"][0]["episodeUuids"] == []
    assert result["episodeCount"] == 0
    assert result["sharedChatText"] == (
        "Research result\n\n"
        "Source unavailable: No usable primary-source evidence was available."
    )


def test_cited_source_unavailable_result_settles_same_native_write() -> None:
    payload = _payload()
    result_item = payload["output"]["results"][0]
    result_item.update({
        "status": "source-unavailable",
        "summary": (
            "Primary sources identify participants but do not support a "
            "responsible supplier ranking."
        ),
        "episodeUuids": [],
    })

    result = validate_atomic_research_result(
        payload,
        episode_reader=lambda project, ids: [{
            "uuid": "episode-one",
            "source_description": '["https://primary.example/report"]',
        }] if project == "project-one" and "episode-one" in ids else [],
        attention_reader=lambda *_args: _event(),
    )

    settled = result["result"]["results"][0]
    assert settled["status"] == "source-unavailable"
    assert settled["summary"] == result_item["summary"]
    assert settled["episodeUuids"] == ["episode-one"]
    assert result["settlement"] == {
        "eventId": "native-attention:write-one",
        "phase": "completed",
        "episodeUuids": ["episode-one"],
    }
