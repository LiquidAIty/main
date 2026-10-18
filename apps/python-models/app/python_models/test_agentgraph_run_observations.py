"""Focused contracts for truthful AGE Run and artifact observations."""

# Entity: AgentGraph
# Relationship: Verifies only exact lifecycle, Hermes identity, assignment, lineage, and artifact events produce confirmed AGE observations while unmatched writes report false.

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Callable

import pytest

from app.python_models import agentgraph_query, agentgraph_run_observations


class _Cursor:
    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return None


class _Connection:
    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return None

    def cursor(self, **_kwargs):
        return _Cursor()


def _install_observer(
    monkeypatch: pytest.MonkeyPatch,
    responder: Callable[[str, dict[str, Any], str], list[dict[str, Any]]],
) -> list[tuple[str, dict[str, Any], str]]:
    statements: list[tuple[str, dict[str, Any], str]] = []
    monkeypatch.setattr(
        agentgraph_run_observations,
        "connect_postgres",
        lambda **_kwargs: _Connection(),
    )

    def execute(_cursor, query, params, columns):
        statements.append((query, params, columns))
        return responder(query, params, columns)

    monkeypatch.setattr(
        agentgraph_query,
        "execute_fixed_agentgraph_query",
        execute,
    )
    return statements


def _run_row(_query: str, params: dict[str, Any], _columns: str):
    return [{"run_id": params["runId"]}]


def test_exact_acceptance_failure_and_start_events_require_the_returned_run(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    statements = _install_observer(monkeypatch, _run_row)
    accepted_at = datetime(2026, 10, 1, 20, 0, tzinfo=timezone.utc)
    preparation_started_at = datetime(
        2026, 10, 1, 20, 0, 0, 1000, tzinfo=timezone.utc,
    )
    ended_at = datetime(2026, 10, 1, 20, 0, 1, tzinfo=timezone.utc)

    assert agentgraph_run_observations.observe_run_acceptance(
        project_id="project-one",
        deck_id="deck-one",
        card_id="card-one",
        run_id="run-one",
        correlation_id="correlation-one",
        accepted_at=accepted_at,
        preparation_started_at=preparation_started_at,
        conversation_id="conversation-one",
    ) is True
    assert agentgraph_run_observations.observe_run_preparation_failure(
        project_id="project-one",
        deck_id="deck-one",
        card_id="card-one",
        run_id="run-one",
        ended_at=ended_at,
        elapsed_ms=1_000,
        error_summary="preparation failed",
    ) is True
    assert agentgraph_run_observations.observe_run_execution_started(
        run_id="run-one",
        submission_id="submission-one",
        hermes_session_id="session-one",
        started_at=ended_at,
    ) is True
    assert len(statements) == 3

    _install_observer(monkeypatch, lambda *_args: [])
    assert agentgraph_run_observations.observe_run_execution_started(
        run_id="run-one",
        submission_id="submission-one",
        hermes_session_id="session-one",
        started_at=ended_at,
    ) is False


def test_preparation_completion_confirms_run_assignment_and_lineage(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def responder(query: str, params: dict[str, Any], _columns: str):
        if "ASSIGNED_TO" in query:
            return [{
                "sender_id": params["senderId"],
                "target_id": params["targetId"],
                "run_id": params["runId"],
            }]
        if "CHILD_RUN" in query:
            return [{
                "parent_run_id": params["parentRunId"],
                "child_run_id": params["runId"],
            }]
        return [{"run_id": params["runId"]}]

    statements = _install_observer(monkeypatch, responder)
    started_at = datetime(2026, 10, 1, 20, 0, tzinfo=timezone.utc)
    ended_at = datetime(2026, 10, 1, 20, 0, 2, tzinfo=timezone.utc)
    prepared = {
        "projectId": "project-one",
        "deckId": "deck-one",
        "cardIdentity": {"cardId": "card-one"},
    }

    assert agentgraph_run_observations.observe_run_preparation_complete(
        prepared,
        {
            "senderCardId": "card-parent",
            "originatingRunId": "run-parent",
        },
        run_id="run-one",
        correlation_id="correlation-one",
        preparation_started_at=started_at,
        ended_at=ended_at,
    ) is True
    assert len(statements) == 3
    run_query, run_params, _columns = statements[0]
    assert "run.preparationState='completed'" in run_query
    assert "run.state=" not in run_query
    assert "run.acceptedAt" not in run_query
    assert "run.idfSha256" not in run_query
    assert run_params["preparationStartedAt"] == started_at.isoformat()
    assert run_params["endedAt"] == ended_at.isoformat()
    assert run_params["preparationElapsedMs"] == 2_000

    _install_observer(monkeypatch, lambda *_args: [])
    assert agentgraph_run_observations.observe_run_preparation_complete(
        prepared,
        {},
        run_id="run-one",
        correlation_id="correlation-one",
        preparation_started_at=started_at,
        ended_at=ended_at,
    ) is False


def test_progress_copies_only_exact_hermes_identity_without_inventing_run_chronology(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    statements = _install_observer(monkeypatch, _run_row)

    assert agentgraph_run_observations.observe_run_progress(
        "run-one",
        "running",
        {
            "hermesRootId": "root-one",
            "hermesRunId": "turn-one",
            "activeWorkers": 3,
            "providerCachedTokens": 99,
        },
    ) is True
    query, params, _columns = statements[0]
    assert params == {
        "runId": "run-one",
        "hermesRootId": "root-one",
        "hermesRunId": "turn-one",
        "hermesStatus": "running",
    }
    assert "run.state" not in query
    assert "run.startedAt" not in query
    assert "activeWorker" not in query
    assert "providerCachedTokens" not in query

    _install_observer(monkeypatch, lambda *_args: [])
    assert agentgraph_run_observations.observe_run_progress(
        "run-one", "running", {},
    ) is False


def test_finish_uses_canonical_postgres_readback_and_rejects_unmatched_write(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    statements = _install_observer(monkeypatch, _run_row)
    finished_at = datetime(2026, 10, 1, 20, 1, tzinfo=timezone.utc)
    run_record = {
        "run_id": "run-one",
        "state": "failed",
        "finished_at": finished_at,
        "provider_thread_ref": "root-one",
        "provider_turn_ref": "turn-one",
        "error_code": "provider_failure",
        "error_summary": "provider source failure",
    }

    assert agentgraph_run_observations.observe_run_finish(run_record) is True
    query, params, _columns = statements[0]
    assert params == {
        "runId": "run-one",
        "state": "failed",
        "finishedAt": finished_at.isoformat(),
        "hermesRootId": "root-one",
        "hermesRunId": "turn-one",
        "errorCode": "provider_failure",
        "errorSummary": "provider source failure",
    }
    assert "durationMs" not in query
    assert "resultReady" not in query
    assert "providerInputTokens" not in query

    _install_observer(monkeypatch, lambda *_args: [])
    assert agentgraph_run_observations.observe_run_finish(run_record) is False
    assert agentgraph_run_observations.observe_run_finish({
        **run_record, "finished_at": None,
    }) is False


def test_artifact_observation_requires_exact_returned_run_and_artifact(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def responder(_query: str, params: dict[str, Any], _columns: str):
        return [{
            "run_id": params["runId"],
            "artifact_id": params["artifactId"],
        }]

    statements = _install_observer(monkeypatch, responder)
    assert agentgraph_run_observations.observe_artifact(
        "run-one",
        "artifact-one",
        "input-data-file",
        "artifact://input-one",
        "a" * 64,
        321,
    ) is True
    query, params, _columns = statements[0]
    assert "PRODUCED_ARTIFACT" in query
    assert params["contentSha256"] == "a" * 64
    assert params["sizeBytes"] == 321

    _install_observer(monkeypatch, lambda *_args: [])
    assert agentgraph_run_observations.observe_artifact(
        "run-one",
        "artifact-one",
        "input-data-file",
        "artifact://input-one",
        "a" * 64,
        321,
    ) is False
