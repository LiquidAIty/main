from __future__ import annotations

# Entity: Run Ledger
# Relationship: This file verifies scoped Run acceptance, transitions, readback, usage, cost, failure settlement, terminal evidence, idempotence, and exact saved revision authority.
#
# Entity: Card Invocation
# Relationship: This file verifies preparation returns the same Card identity at every transport level and fails before execution when authority or revision evidence differs.
#
# Entity: IDF
# Relationship: This file verifies every accepted Run retains and reloads one canonical IDF and settles honestly when input persistence fails.
#
# Entity: AgentGraph
# Relationship: This file verifies Run history remains SQL-owned while optional conversation scope and truthful lifecycle observations use AgentGraph without controlling the Run.
#
# Entity: Magnetic TaskGraph
# Relationship: This file verifies one Magnetic outer Run retains its exact Hermes root, projects only blue-connected saved workers, accepts bounded progress, and settles final synthesis.

from datetime import datetime, timezone

import pytest

from app.python_models import (
    agentgraph_query,
    agentgraph_run_observations,
    agentgraph_topology,
    card_invocation_preparation,
    card_run_execution,
    card_run_inputs,
    card_run_preparation,
    card_run_readback,
    card_run_settlement,
    saved_card_contract,
    saved_cards,
)
from app.python_models.card_run_auto_model import AutoModelSelectionError


def _agent(card_id: str, **overrides):
    card = {
        "id": card_id,
        "kind": "agent",
        "templateId": "template_assist",
        "title": card_id,
        "prompt": "common prompt",
        "runtime": {"kind": "hermes", "mode": "delegate", "profile": card_id},
        "runtimeOptions": {
            "provider": "openrouter",
            "modelKey": "deepseek/deepseek-v4-flash-0731",
            "providerModelId": "deepseek/deepseek-v4-flash-0731",
            "accessMode": "openrouter-api",
            "tools": [],
        },
        "position": {"x": 0, "y": 0},
    }
    card.update(overrides)
    return card

def _prepared_grounded_runtime(runtime: dict[str, str]) -> dict:
    reads = [{
        "cbmQualifiedName": "symbol-one",
    }]

    materialized = card_invocation_preparation.materialize_idf(
        stable={
            "projectId": "project-one", "deckId": "deck-one", "cardId": "card-one",
            "instructions": "test instructions",
            "outputContract": "",
            "runtime": runtime,
            "runtimeOptions": {},
            "provider": {
                "provider": "openai", "modelKey": "gpt-5.6-luna",
                "providerModelId": "gpt-5.6-luna", "accessMode": "chatgpt-account",
            },
        },
        variable={"task": "test task"},
        capabilities={"enabledTools": []},
        graph_context="symbol-one",
        graph_records=reads,
        graph_projection={"graphSystems": ["cbm"], "nodes": [{
            "id": "symbol-one", "graphSystem": "cbm", "type": "Function",
        }], "edges": []},
    )
    return {
        "projectId": "project-one",
        "deckId": "deck-one",
        "runtimeOwner": "mag_one" if runtime.get("mode") == "magentic_one" else "hermes",
        "cardIdentity": {"cardId": "card-one", "title": "Card"},
        "cardRevisionId": "revision-one",
        "idf": materialized.idf.model_dump(),
        "resolvedGraphReads": reads,
        "resolvedGraphProjection": {
            "nodes": [{"id": "symbol-one"}], "edges": [],
        },
    }

def _fake_retain_idf(prepared: dict, **_kwargs) -> tuple[dict, dict, dict]:
    idf = prepared["idf"]
    stable = idf["stableSavedCardContext"]
    grants = idf["selectedToolsAndGrants"]
    dynamic = idf["dynamicContext"]
    return (
        {
            "idf": idf,
            "inputSummary": {"idfBytes": 1},
        },
        {
            "idfPath": "in.idf", "idfSha256": "idf", "idfBytes": 1,
        },
        {
            "systemPrompt": str(stable.get("instructions") or ""),
            "outputRequirements": str(stable.get("outputRequirements") or ""),
            "task": str(dynamic.get("task") or ""),
            "message": str(dynamic.get("task") or ""),
            "taskGraphMission": str(dynamic.get("task") or ""),
            "graphContext": str(idf["actualGraphData"].get("modelText") or ""),
            "runtime": stable["runtime"],
            "provider": stable["provider"],
            "enabledTools": list(grants.get("enabledTools") or []),
        },
    )


def _accepted_run_snapshot() -> dict[str, object]:
    return {
        "runId": "run-one",
        "correlationId": "correlation-one",
        "projectId": "project-one",
        "deckId": "deck-one",
        "cardId": "card-one",
        "cardRevisionId": "revision-one",
        "acceptedAt": "2026-10-01T20:00:00+00:00",
        "preparationStartedAt": "2026-10-01T20:00:00.001+00:00",
    }

@pytest.mark.parametrize("conversation_matches", [True, False])
def test_scoped_run_read_checks_provider_conversation_before_output(monkeypatch, conversation_matches):
    from unittest.mock import MagicMock

    connection = MagicMock()
    cursor = connection.__enter__.return_value.cursor.return_value.__enter__.return_value
    cursor.fetchone.return_value = {"run_id": "parent", "project_id": "p", "deck_id": "d",
                                   "card_id": "main", "final_result": "private output"}
    monkeypatch.setattr(card_run_readback, "connect_postgres", lambda **kwargs: connection)
    monkeypatch.setattr(saved_cards, "resolve_project_record", lambda *args: {"id": "p"})
    lineage = MagicMock(return_value=[{"run_id": "parent"}] if conversation_matches else [])
    monkeypatch.setattr(agentgraph_query, "execute_fixed_agentgraph_query", lineage)
    result = card_run_readback.read_run({"projectId": "p", "deckId": "d", "runId": "parent",
                                   "conversationId": "selected-conversation"})
    if conversation_matches:
        assert result["run"]["conversationId"] == "selected-conversation"
        assert result["run"]["result"] == "private output"
    else:
        assert result == {"ok": True, "run": None}
    assert lineage.call_args.args[2] == {"projectId": "p", "deckId": "d",
                                         "runId": "parent", "conversationId": "selected-conversation"}

def test_run_history_reads_only_the_outer_run_ledger_without_age_filtering(monkeypatch):
    from unittest.mock import MagicMock

    connection = MagicMock()
    cursor = connection.__enter__.return_value.cursor.return_value.__enter__.return_value
    cursor.fetchall.return_value = [
        {
            "run_id": "run-new",
            "project_id": "project-one",
            "deck_id": "deck-one",
            "card_id": "card-one",
            "state": "failed",
        },
        {
            "run_id": "run-old",
            "project_id": "project-one",
            "deck_id": "deck-one",
            "card_id": "card-one",
            "state": "completed",
        },
    ]
    monkeypatch.setattr(card_run_readback, "connect_postgres", lambda **_kwargs: connection)
    monkeypatch.setattr(saved_cards, "resolve_project_record", lambda *_args: {"id": "project-one"})
    monkeypatch.setattr(
        agentgraph_query,
        "execute_fixed_agentgraph_query",
        lambda *_args: pytest.fail("outer Run history must not depend on AGE"),
    )

    result = card_run_readback.read_run_history({
        "projectId": "project-one",
        "deckId": "deck-one",
        "cardId": "card-one",
        "limit": 2,
    })

    assert [run["runId"] for run in result["runs"]] == ["run-new", "run-old"]
    query, params = cursor.execute.call_args_list[-1].args
    assert "revision.card_id=%s" in query
    assert "hermesChildId" not in query
    assert "ORDER BY run.created_at DESC" in query
    assert params == ("project-one", "deck-one", "card-one", 2)

@pytest.mark.parametrize("limit", [0, 21, True, "8"])
def test_run_history_rejects_unbounded_limits(monkeypatch, limit):
    with pytest.raises(saved_card_contract.CardDomainError, match="run_history_limit_invalid"):
        card_run_readback.read_run_history({
            "projectId": "project-one",
            "deckId": "deck-one",
            "cardId": "card-one",
            "limit": limit,
        })


def test_card_rejoin_reads_only_the_outer_run_ledger_without_age_filtering(monkeypatch):
    from unittest.mock import MagicMock

    connection = MagicMock()
    cursor = connection.__enter__.return_value.cursor.return_value.__enter__.return_value
    cursor.fetchone.return_value = {
        "run_id": "root-run",
        "project_id": "project-one",
        "deck_id": "deck-one",
        "card_id": "card-one",
        "state": "completed",
    }
    monkeypatch.setattr(card_run_readback, "connect_postgres", lambda **_kwargs: connection)
    monkeypatch.setattr(
        saved_cards,
        "resolve_project_record",
        lambda *_args: {"id": "project-one"},
    )
    monkeypatch.setattr(
        agentgraph_query,
        "execute_fixed_agentgraph_query",
        lambda *_args: pytest.fail("Card Run read must not depend on AGE"),
    )

    result = card_run_readback.read_run({
        "projectId": "project-one",
        "deckId": "deck-one",
        "cardId": "card-one",
    })

    assert result["run"]["runId"] == "root-run"
    query, params = cursor.execute.call_args_list[-1].args
    assert "hermesChildId" not in query
    assert params == ("project-one", "deck-one", "card-one")

def test_new_run_fails_closed_when_root_input_files_cannot_persist(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    prepared = _prepared_grounded_runtime({
        "kind": "hermes", "mode": "delegate", "profile": "card-one",
    })
    settled: list[dict] = []
    accepted = _accepted_run_snapshot()
    monkeypatch.setattr(
        card_run_preparation, "accept_run_request", lambda _payload: accepted,
    )
    monkeypatch.setattr(
        card_invocation_preparation, "prepare_run_invocation",
        lambda _payload, **_kwargs: prepared,
    )
    monkeypatch.setattr(card_run_preparation, "_insert_run",
        lambda *_args, **_kwargs: ("run-one", "correlation-one", True),
    )
    monkeypatch.setattr(card_run_inputs, "_retain_run_idf",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            saved_card_contract.CardDomainError("input_files_write_failed")
        ),
    )
    monkeypatch.setattr(
        card_run_preparation,
        "_fail_accepted_run_preparation",
        lambda snapshot, payload: settled.append({
            "accepted": snapshot,
            "payload": payload,
        }) or {"ok": True},
    )

    with pytest.raises(saved_card_contract.CardDomainError, match="input_files_write_failed"):
        card_run_preparation.begin_run({
            "runId": "run-one", "correlationId": "correlation-one",
            "assignment": "test task",
        })
    assert settled == [{
        "accepted": accepted,
        "payload": {
            "runId": "run-one",
            "correlationId": "correlation-one",
            "assignment": "test task",
            "errorCode": "input_files_write_failed",
            "errorSummary": "input_files_write_failed",
        },
    }]


def test_hermes_begin_run_returns_the_same_card_identity_at_both_transport_levels(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    prepared = _prepared_grounded_runtime({
        "kind": "hermes", "mode": "main", "profile": "main",
    })
    monkeypatch.setattr(
        card_run_preparation, "accept_run_request",
        lambda _payload: _accepted_run_snapshot(),
    )
    monkeypatch.setattr(
        card_invocation_preparation, "prepare_run_invocation",
        lambda _payload, **_kwargs: prepared,
    )
    monkeypatch.setattr(
        card_run_preparation, "_insert_run",
        lambda *_args, **_kwargs: ("run-one", "correlation-one", True),
    )
    monkeypatch.setattr(card_run_inputs, "retain_required_run_idf", _fake_retain_idf)
    monkeypatch.setattr(
        agentgraph_run_observations, "observe_run_preparation_complete",
        lambda *_args, **_kwargs: True,
    )

    result = card_run_preparation.begin_run({
        "runId": "run-one",
        "correlationId": "correlation-one",
        "conversationId": "conversation-one",
        "assignment": "test task",
    })

    assert result["cardId"] == "card-one"
    assert result["hermesTransport"]["cardIdentity"]["cardId"] == "card-one"
    assert result["hermesTransport"]["request"]["runtime"]["profile"] == "main"

def test_mag_one_participant_validation_fails_before_runtime_binding(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    prepared = _prepared_grounded_runtime({
        "kind": "hermes", "mode": "magentic_one", "profile": "card-one",
    })
    monkeypatch.setattr(
        card_run_preparation,
        "accept_run_request",
        lambda _payload: _accepted_run_snapshot(),
    )
    monkeypatch.setattr(
        card_run_preparation,
        "_fail_accepted_run_preparation",
        lambda *_args, **_kwargs: {"ok": True},
    )
    monkeypatch.setattr(
        card_invocation_preparation, "prepare_run_invocation",
        lambda _payload, **_kwargs: prepared,
    )
    monkeypatch.setattr(saved_cards, "load_deck", lambda *_args: {
        "projectId": "project-one",
        "deck": {
            "nodes": [{
                "id": "card-one",
                "runtime": {
                    "kind": "hermes", "mode": "magentic_one", "profile": "card-one",
                },
            }],
            "edges": [],
        },
    })
    monkeypatch.setattr(card_run_preparation, "_insert_run",
        lambda *_args, **_kwargs: pytest.fail("participant validation created a Run"),
    )

    with pytest.raises(
        saved_card_contract.CardDomainError,
        match="magnetic_taskgraph_no_connected_workers",
    ):
        card_run_preparation.begin_run({
            "runId": "run-one", "correlationId": "correlation-one",
            "assignment": "test task",
        })

def test_mag_one_materializes_all_six_saved_edges_without_worker_selection(monkeypatch):
    prepared = _prepared_grounded_runtime({
        "kind": "hermes", "mode": "magentic_one", "profile": "card-one",
    })
    prepared["idf"]["stableSavedCardContext"]["outputRequirements"] = "Separate output contract"
    monkeypatch.setattr(
        card_run_preparation,
        "accept_run_request",
        lambda _payload: _accepted_run_snapshot(),
    )
    workers = [_agent(f"worker-{i}", subtitle=f"Saved capability {i}",
                      runtime={"kind": "hermes", "mode": "delegate", "profile": f"profile-{i}"})
               for i in range(6)]
    for i, worker in enumerate(workers):
        worker["_cardRevisionId"] = f"worker-revision-{i}"
        worker["_cardRevision"] = 1
        worker["_cardRevisionSha256"] = f"{i:064x}"
    monkeypatch.setattr(
        card_invocation_preparation, "prepare_run_invocation",
        lambda _payload, **_kwargs: prepared,
    )
    monkeypatch.setattr(saved_cards, "load_deck", lambda *_args: {"deck": {
        "nodes": workers,
        "edges": [{"source": "card-one" if i % 2 else worker["id"],
                   "target": worker["id"] if i % 2 else "card-one",
                   "edgeType": "magentic_option"} for i, worker in enumerate(workers)],
    }})
    monkeypatch.setattr(card_run_preparation, "_insert_run", lambda *a, **kw: ("run-one", "correlation-one", True))
    monkeypatch.setattr(card_run_inputs, "retain_required_run_idf", _fake_retain_idf)
    monkeypatch.setattr(agentgraph_run_observations, "observe_run_preparation_complete", lambda *a, **kw: True)
    result = card_run_preparation.begin_run({
        "runId": "run-one", "correlationId": "correlation-one",
        "assignment": "test task",
    })
    assert result["magneticTaskGraph"]["workers"] == [
        {
            "cardId": worker["id"],
            "title": worker["title"],
            "profile": worker["runtime"]["profile"],
            "description": worker["subtitle"],
            "cardRevisionId": worker["_cardRevisionId"],
            "capabilities": {
                "savedToolIds": [],
            },
        }
        for worker in workers
    ]
    assert result["magneticTaskGraph"]["mission"] == "test task"
    assert result["magneticTaskGraph"]["orchestrator"] == {
        "cardId": "card-one",
        "cardRevisionId": "revision-one",
        "hermesProfile": "card-one",
        "instructions": "test instructions",
        "provider": {
            "provider": "openai",
            "modelKey": "gpt-5.6-luna",
            "providerModelId": "gpt-5.6-luna",
            "accessMode": "chatgpt-account",
        },
        "runtimeOptions": {},
    }


def test_run_projection_does_not_present_requested_model_as_effective() -> None:
    projected = card_run_readback.run_projection({
        "run_id": "pending-run",
        "provider": "openai",
        "provider_model_id": "requested-model",
        "effective_provider": None,
    })

    assert projected["provider"] is None
    assert projected["model"] is None
    assert projected["activeWorkers"] is None
    assert projected["toolCallCount"] is None
    assert projected["inputTokens"] is None
    assert projected["outputTokens"] is None


def test_run_starts_only_from_exact_correlated_submission_evidence(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    statements: list[tuple[str, object]] = []
    started_at = datetime(2026, 10, 8, 12, 0, tzinfo=timezone.utc)

    class Cursor:
        rowcount = 1

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def execute(self, query, params=None):
            statements.append((str(query), params))

        def fetchone(self):
            return {
                "run_id": "run-one",
                "correlation_id": "run-one",
                "state": "running",
                "started_at": started_at,
                "hermes_session_ref": "stored-main",
                "provider_turn_ref": "run-one",
            }

    class Connection:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def cursor(self, **_kwargs):
            return Cursor()

    observed: list[dict] = []
    monkeypatch.setattr(card_run_execution, "connect_postgres", lambda **_kwargs: Connection())
    monkeypatch.setattr(
        agentgraph_run_observations,
        "observe_run_execution_started",
        lambda **kwargs: observed.append(kwargs) or True,
    )

    result = card_run_execution.start_run({
        "runId": "run-one",
        "correlationId": "run-one",
        "submissionId": "run-one",
        "hermesSessionRef": "stored-main",
    })

    assert result["state"] == "running"
    assert result["updated"] is True
    assert result["startedAt"] == started_at.isoformat()
    assert "state='running'" in statements[0][0]
    assert "state='pending'" in statements[0][0]
    assert observed == [{
        "run_id": "run-one",
        "submission_id": "run-one",
        "hermes_session_id": "stored-main",
        "started_at": started_at,
    }]


def test_magnetic_run_progress_casts_numeric_hermes_run_id_to_persisted_text(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    statements: list[tuple[str, object]] = []

    class Cursor:
        rowcount = 1

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def execute(self, query, params=None):
            statements.append((str(query), params))

        def fetchone(self):
            return ("t_retained_root",)

    class Connection:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def cursor(self, **_kwargs):
            return Cursor()

    monkeypatch.setattr(card_run_execution, "connect_postgres", lambda **_kwargs: Connection())
    monkeypatch.setattr(agentgraph_run_observations, "observe_run_progress", lambda *_args, **_kwargs: True)

    result = card_run_execution.update_run_progress({
        "runId": "run-one",
        "hermesRootId": "t_retained_root",
        "hermesRunId": 18,
        "hermesStatus": "running",
        "tasksCompleted": 2,
        "tasksTotal": 5,
        "activeWorkers": 1,
        "providerTotalTokens": 0,
        "costStatus": "unknown",
    })

    query, params = statements[0]
    assert "WHEN %s AND run.state='pending' THEN 'running'" in query
    assert "provider_turn_ref=COALESCE(%s::text, provider_turn_ref)" in query
    assert "run.runtime_kind='hermes'" in query
    assert "run.runtime_mode='magentic_one'" in query
    assert "revision.card_id='card_magentic'" in query
    assert "revision.runtime_profile='card_magentic'" in query
    assert "run.runtime_mode!='magentic_one'" not in query
    assert "run.provider_thread_ref IS NULL OR run.provider_thread_ref=%s" in query
    assert "provider_total_tokens=COALESCE(%s, provider_total_tokens)" in query
    assert "cost_status=COALESCE(%s, cost_status)" in query
    assert params[3] == 18
    assert result["hermesRootId"] == "t_retained_root"
    assert result["updated"] is True

def test_magnetic_run_progress_refuses_to_rebind_outer_run_root(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class Cursor:
        rowcount = 0

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def execute(self, _query, _params=None):
            return None

        def fetchone(self):
            return None

    class Connection:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def cursor(self, **_kwargs):
            return Cursor()

    monkeypatch.setattr(card_run_execution, "connect_postgres", lambda **_kwargs: Connection())
    monkeypatch.setattr(agentgraph_run_observations, "observe_run_progress",
        lambda *_args, **_kwargs: pytest.fail("rejected rebind wrote telemetry"),
    )

    assert card_run_execution.update_run_progress({
        "runId": "run-one",
        "hermesRootId": "t_conflicting_root",
        "hermesStatus": "running",
    }) == {
        "ok": True,
        "runId": "run-one",
        "hermesRootId": None,
        "updated": False,
        "telemetryWritten": False,
    }

@pytest.mark.parametrize(
    ("owner", "function", "payload", "error"),
    [
        (
            card_run_execution,
            card_run_execution.update_run_progress,
            {
                "runId": "run-one", "hermesRootId": "root-one",
                "hermesStatus": "running", "providerTotalTokens": True,
            },
            "run_provider_total_tokens_invalid",
        ),
        (
            card_run_settlement,
            card_run_settlement.finish_run,
            {
                "runId": "run-one", "state": "failed",
                "costStatus": "unavailable",
            },
            "run_cost_status_invalid",
        ),
    ],
)
def test_run_usage_extension_rejects_coerced_or_unknown_values(
    monkeypatch: pytest.MonkeyPatch,
    owner,
    function,
    payload,
    error,
) -> None:
    monkeypatch.setattr(
        owner,
        "connect_postgres",
        lambda **_kwargs: (_ for _ in ()).throw(
            AssertionError("invalid metrics must fail before storage")
        ),
    )

    with pytest.raises(saved_card_contract.CardDomainError, match=error):
        function(payload)

def test_finish_run_accepts_stock_gateway_completion_without_unconfigured_api_mode(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    statements: list[tuple[str, object]] = []
    run_record = {
        "run_id": "run-one",
        "state": "running",
        "runtime_kind": "hermes",
        "runtime_mode": "main",
        "provider": "openai",
        "access_mode": "chatgpt-account",
        "effective_provider": None,
        "hermes_session_ref": "hermes-session",
        "provider_turn_ref": "run-one",
    }

    class Cursor:
        rowcount = 0

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def execute(self, query, params=None):
            statements.append((str(query), params))
            if "UPDATE ag_catalog.agent_runs SET state" in str(query):
                self.rowcount = 1
                run_record["state"] = "completed"
                run_record["effective_provider"] = "openai-codex"

        def fetchone(self):
            return run_record

    class Connection:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def cursor(self, **_kwargs):
            return Cursor()

    monkeypatch.setattr(card_run_settlement, "connect_postgres", lambda **_kwargs: Connection())
    monkeypatch.setattr(agentgraph_run_observations, "observe_run_finish", lambda *_args, **_kwargs: True)

    result = card_run_settlement.finish_run({
        "runId": "run-one",
        "state": "completed",
        "finalResult": "Exact Gateway answer",
        "hermesSessionRef": "hermes-session",
        "providerTurnRef": "run-one",
        "provider": "openai-codex",
        "model": "gpt-5.6-sol",
        "effectiveProvider": "openai-codex",
    })

    update_query, update_params = next(
        statement for statement in statements
        if "UPDATE ag_catalog.agent_runs SET state" in statement[0]
    )
    assert "provider_api_mode" not in update_query
    assert "tool_call_count=COALESCE(%s, tool_call_count)" in update_query
    assert "provider_input_tokens=COALESCE(%s, provider_input_tokens)" in update_query
    assert update_params[4] == "openai-codex"
    assert update_params[5] == "hermes-session"
    assert result["updated"] is True
    assert result["state"] == "completed"

def test_finish_run_accepts_mag_one_hermes_root_and_final_task_without_fake_session(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    statements: list[tuple[str, object]] = []
    run_record = {
        "run_id": "run-mag-one",
        "state": "running",
        "runtime_kind": "hermes",
        "runtime_mode": "magentic_one",
        "runtime_profile": "card_magentic",
        "provider": "openai",
        "access_mode": "chatgpt-account",
        "effective_provider": None,
        "provider_thread_ref": "t_mag_root",
        "provider_turn_ref": "t_mag_previous_attempt",
    }

    class Cursor:
        rowcount = 0

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def execute(self, query, params=None):
            statements.append((str(query), params))
            if "UPDATE ag_catalog.agent_runs SET state" in str(query):
                self.rowcount = 1
                run_record["state"] = "completed"

        def fetchone(self):
            return run_record

    class Connection:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def cursor(self, **_kwargs):
            return Cursor()

    monkeypatch.setattr(card_run_settlement, "connect_postgres", lambda **_kwargs: Connection())
    monkeypatch.setattr(agentgraph_run_observations, "observe_run_finish", lambda *_args, **_kwargs: True)

    result = card_run_settlement.finish_run({
        "runId": "run-mag-one",
        "state": "completed",
        "finalResult": "Exact Hermes synthesis",
        "providerThreadRef": "t_mag_root",
        "providerTurnRef": "t_mag_final",
        "hermesStatus": "done",
    })

    update_query, update_params = next(
        statement for statement in statements
        if "UPDATE ag_catalog.agent_runs SET state" in statement[0]
    )
    assert "hermes_session_ref=COALESCE(hermes_session_ref, %s)" in update_query
    assert update_params[5] is None
    assert update_params[6] == "t_mag_root"
    assert update_params[7] == "t_mag_final"
    assert result["updated"] is True
    assert result["state"] == "completed"
    assert result["runRecord"]["runtimeProfile"] == "card_magentic"
    assert result["runRecord"]["hermesRootId"] == "t_mag_root"
    assert result["runRecord"]["provider"] is None
    assert result["runRecord"]["model"] is None


def test_accepted_run_request_is_pending_scoped_and_has_no_hermes_run(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    statements: list[tuple[str, tuple | None]] = []
    observed: list[dict] = []

    class Cursor:
        rowcount = 0

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def execute(self, query, params=None):
            statements.append((str(query), params))
            self.rowcount = 1 if "INSERT INTO ag_catalog.agent_runs" in str(query) else 0

        def fetchone(self):
            return {
                "run_id": "request-one",
                "correlation_id": "request-one",
                "project_id": "project-one",
                "deck_id": "deck-one",
                "target_card_revision_id": "revision-one",
                "state": "pending",
                "created_at": datetime(2026, 10, 1, 20, 0, tzinfo=timezone.utc),
                "provider_turn_ref": None,
            }

    class Connection:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def cursor(self, **_kwargs):
            return Cursor()

    card = _agent(
        "card-one",
        runtime={"kind": "hermes", "mode": "delegate", "profile": "card-one"},
    )
    card["_cardRevisionId"] = "revision-one"
    monkeypatch.setattr(saved_cards, "load_deck", lambda *_args: {
        "projectId": "project-one", "deck": {"nodes": [card], "edges": []},
    })
    monkeypatch.setattr(card_run_preparation, "connect_postgres", lambda **_kwargs: Connection())
    monkeypatch.setattr(agentgraph_run_observations, "observe_run_acceptance",
        lambda **kwargs: observed.append(kwargs) or True,
    )
    accepted_at_value = datetime(2026, 10, 1, 20, 0, tzinfo=timezone.utc)
    monkeypatch.setattr(card_run_preparation, "utc_now", lambda: accepted_at_value)

    result = card_run_preparation.accept_run_request({
        "projectId": "project-one",
        "deckId": "deck-one",
        "cardId": "card-one",
        "runId": "request-one",
        "correlationId": "request-one",
        "cardRevisionId": "revision-one",
        "conversationId": "conversation-one",
    })

    insert_params = next(params for query, params in statements if "INSERT INTO" in query)
    assert insert_params[-1] == datetime(2026, 10, 1, 20, 0, tzinfo=timezone.utc)
    assert result["state"] == "pending"
    assert result["hermesRunId"] is None
    assert result["acceptedAt"] == "2026-10-01T20:00:00+00:00"
    assert observed[0]["project_id"] == "project-one"
    assert observed[0]["deck_id"] == "deck-one"
    assert observed[0]["card_id"] == "card-one"

def test_run_acceptance_rejects_a_changed_expected_card_revision_before_insert(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    card = _agent(
        "card-one",
        runtime={"kind": "hermes", "mode": "delegate", "profile": "card-one"},
    )
    card["_cardRevisionId"] = "revision-current"
    monkeypatch.setattr(saved_cards, "load_deck", lambda *_args: {
        "projectId": "project-one", "deck": {"nodes": [card], "edges": []},
    })
    monkeypatch.setattr(card_run_preparation, "connect_postgres",
        lambda **_kwargs: (_ for _ in ()).throw(AssertionError("must not insert")),
    )

    with pytest.raises(saved_card_contract.CardDomainError, match="card_revision_changed"):
        card_run_preparation.accept_run_request({
            "projectId": "project-one",
            "deckId": "deck-one",
            "cardId": "card-one",
            "cardRevisionId": "revision-selected",
            "runId": "request-one",
            "correlationId": "request-one",
            "acceptedAt": "2026-10-01T20:00:00.000Z",
        })

def test_beginning_an_accepted_run_uses_only_run_and_correlation_identity(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    statements: list[tuple[str, tuple | None]] = []

    class Cursor:
        rowcount = 0

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def execute(self, query, params=None):
            text = str(query)
            statements.append((text, params))
            if "INSERT INTO ag_catalog.agent_runs" in text:
                self.rowcount = 0
            elif "UPDATE ag_catalog.agent_runs SET" in text:
                self.rowcount = 1
            else:
                self.rowcount = 0

        def fetchone(self):
            return {
                "run_id": "request-one",
                "correlation_id": "request-one",
                "project_id": "project-one",
                "deck_id": "deck-one",
                "target_card_revision_id": "revision-one",
                "state": "pending",
            }

    class Connection:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def cursor(self, **_kwargs):
            return Cursor()

    monkeypatch.setattr(card_run_preparation, "connect_postgres", lambda **_kwargs: Connection())
    prepared = _prepared_grounded_runtime({
        "kind": "hermes", "mode": "main", "profile": "liquidaity-main",
    })

    assert card_run_preparation._insert_run(
        prepared,
        run_id="request-one",
        correlation_id="request-one",
    ) == ("request-one", "request-one", True)
    lookup_query = next(
        query for query, _params in statements
        if "SELECT run_id, correlation_id" in query
    )
    assert "request_fingerprint" not in "\n".join(
        query for query, _params in statements
    )
    lookup_params = next(
        params for query, params in statements
        if "SELECT run_id, correlation_id" in query
    )
    assert lookup_params == ("request-one", "request-one")

def test_idempotent_run_rejoin_requires_exact_selection_decisions(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class Cursor:
        rowcount = 0

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def execute(self, query, _params=None):
            self.rowcount = 0

        def fetchone(self):
            return {
                "run_id": "request-one",
                "correlation_id": "request-one",
                "project_id": "project-one",
                "deck_id": "deck-one",
                "target_card_revision_id": "revision-one",
                "state": "pending",
                "provider": "openai",
                "auto_tools_decision": {
                    "schemaVersion": "auto-tools-decision.v1",
                    "status": "selected",
                    "selectedToolIds": ["canvas.inspect"],
                },
                "auto_model_decision": None,
            }

    class Connection:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def cursor(self, **_kwargs):
            return Cursor()

    prepared = _prepared_grounded_runtime({
        "kind": "hermes", "mode": "main", "profile": "liquidaity-main",
    })
    prepared["autoToolsDecision"] = {
        "schemaVersion": "auto-tools-decision.v1",
        "status": "selected",
        "selectedToolIds": [],
    }
    prepared["autoModelDecision"] = None
    monkeypatch.setattr(card_run_preparation, "connect_postgres", lambda **_kwargs: Connection())

    with pytest.raises(
        saved_card_contract.CardDomainError,
        match="run_selection_decision_conflict",
    ):
        card_run_preparation._insert_run(
            prepared,
            run_id="request-one",
            correlation_id="request-one",
        )

def test_begin_run_preserves_source_failure_after_settling_accepted_attempt(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settled: list[dict] = []
    accepted = {
        "runId": "request-one", "correlationId": "request-one",
        "projectId": "project-one", "deckId": "deck-one", "cardId": "card-one",
        "cardRevisionId": "revision-one", "acceptedAt": "2026-10-01T20:00:00+00:00",
        "preparationStartedAt": "2026-10-01T20:00:00.001+00:00",
    }
    monkeypatch.setattr(card_run_preparation, "accept_run_request", lambda _payload: accepted)
    monkeypatch.setattr(
        card_run_preparation,
        "_begin_accepted_run",
        lambda _payload, _accepted: (_ for _ in ()).throw(
            saved_card_contract.CardDomainError("configured_tool_unknown:provider.tool")
        ),
    )
    monkeypatch.setattr(card_run_preparation, "_fail_accepted_run_preparation",
        lambda snapshot, payload: settled.append({
            "accepted": snapshot, "payload": payload,
        }) or {"ok": True},
    )
    payload = {
        "projectId": "project-one", "deckId": "deck-one", "cardId": "card-one",
        "runId": "request-one", "correlationId": "request-one",
        "acceptedAt": "2026-10-01T20:00:00.000Z",
    }

    with pytest.raises(
        saved_card_contract.CardDomainError,
        match="configured_tool_unknown:provider.tool",
    ):
        card_run_preparation.begin_run(payload)

    assert settled == [{
        "accepted": accepted,
        "payload": {
            **payload,
            "errorCode": "configured_tool_unknown",
            "errorSummary": "configured_tool_unknown:provider.tool",
        },
    }]

def test_auto_model_preparation_failure_persists_the_typed_bounded_decision(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settled: list[dict] = []
    accepted = {
        "runId": "request-one", "correlationId": "request-one",
        "projectId": "project-one", "deckId": "deck-one", "cardId": "card-one",
        "cardRevisionId": "revision-one", "acceptedAt": "2026-10-01T20:00:00+00:00",
        "preparationStartedAt": "2026-10-01T20:00:00.001+00:00",
    }
    model_decision = {
        "schemaVersion": "auto-model-decision.v1",
        "status": "unavailable",
        "savedModelId": "openai:chatgpt-account:gpt-5.6-sol",
        "candidateCount": 0,
        "selectedModelId": None,
        "selectedConfidencePercentage": None,
        "decisionId": None,
        "errorCode": "auto_model_compatible_candidates_unavailable",
    }
    error = AutoModelSelectionError(model_decision)
    error.auto_tools_decision = {
        "schemaVersion": "auto-tools-decision.v1",
        "status": "selected",
        "candidateCount": 0,
        "selectedToolIds": [],
        "selectedConfidencePercentages": {},
        "decisionId": None,
        "errorCode": None,
    }
    monkeypatch.setattr(card_run_preparation, "accept_run_request", lambda _payload: accepted)
    monkeypatch.setattr(
        card_run_preparation,
        "_begin_accepted_run",
        lambda _payload, _accepted: (_ for _ in ()).throw(error),
    )
    monkeypatch.setattr(
        card_run_preparation,
        "_fail_accepted_run_preparation",
        lambda _accepted, payload: settled.append(payload) or {"ok": True},
    )
    payload = {
        "projectId": "project-one", "deckId": "deck-one", "cardId": "card-one",
        "runId": "request-one", "correlationId": "request-one",
        "acceptedAt": "2026-10-01T20:00:00.000Z",
    }

    with pytest.raises(
        AutoModelSelectionError,
        match="auto_model_compatible_candidates_unavailable",
    ):
        card_run_preparation.begin_run(payload)

    assert settled[0]["autoModelDecision"] == model_decision
    assert settled[0]["autoToolsDecision"] == error.auto_tools_decision
