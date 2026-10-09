from __future__ import annotations

from datetime import datetime, timezone

import pytest

from app.python_models import (
    agentgraph_query,
    agentgraph_run_observations,
    agentgraph_topology,
    card_invocation,
    card_runs,
    saved_card_contract,
    saved_cards,
)


@pytest.fixture(autouse=True)
def project_worldview_defaults_to_existing_availability(monkeypatch):
    """Keep unrelated Card tests focused; dedicated tests override the mask."""

    def resolve(project_id, candidate_capability_ids, **_kwargs):
        candidates = list(dict.fromkeys(candidate_capability_ids))
        return {
            "schemaVersion": "project-worldview.v1",
            "projectId": project_id,
            "defaultEnabled": True,
            "candidateCapabilities": candidates,
            "enabledCapabilities": candidates,
            "excludedCapabilities": [],
            "overrides": [],
        }

    monkeypatch.setattr(card_invocation, "resolve_project_worldview", resolve)
    monkeypatch.setattr(agentgraph_topology, "resolve_project_worldview", resolve)

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

    materialized = card_invocation.materialize_idf(
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

@pytest.mark.parametrize("conversation_matches", [True, False])
def test_scoped_run_read_checks_provider_conversation_before_output(monkeypatch, conversation_matches):
    from unittest.mock import MagicMock

    connection = MagicMock()
    cursor = connection.__enter__.return_value.cursor.return_value.__enter__.return_value
    cursor.fetchone.return_value = {"run_id": "parent", "project_id": "p", "deck_id": "d",
                                   "card_id": "main", "final_result": "private output"}
    monkeypatch.setattr(card_runs, "connect_postgres", lambda **kwargs: connection)
    monkeypatch.setattr(saved_cards, "resolve_project_record", lambda *args: {"id": "p"})
    lineage = MagicMock(return_value=[{"run_id": "parent"}] if conversation_matches else [])
    monkeypatch.setattr(agentgraph_query, "execute_fixed_agentgraph_query", lineage)
    result = card_runs.read_run({"projectId": "p", "deckId": "d", "runId": "parent",
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
    monkeypatch.setattr(card_runs, "connect_postgres", lambda **_kwargs: connection)
    monkeypatch.setattr(saved_cards, "resolve_project_record", lambda *_args: {"id": "project-one"})
    monkeypatch.setattr(
        agentgraph_query,
        "execute_fixed_agentgraph_query",
        lambda *_args: pytest.fail("outer Run history must not depend on AGE"),
    )

    result = card_runs.read_run_history({
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
        card_runs.read_run_history({
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
    monkeypatch.setattr(card_runs, "connect_postgres", lambda **_kwargs: connection)
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

    result = card_runs.read_run({
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
    terminal: list[dict] = []
    monkeypatch.setattr(
        card_invocation, "prepare_run_invocation",
        lambda _payload, **_kwargs: prepared,
    )
    monkeypatch.setattr(card_runs, "_insert_run",
        lambda *_args, **_kwargs: ("run-one", "correlation-one", True),
    )
    monkeypatch.setattr(card_runs, "_retain_run_idf",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            saved_card_contract.CardDomainError("input_files_write_failed")
        ),
    )
    monkeypatch.setattr(card_runs, "finish_run", lambda payload: terminal.append(payload) or {})

    with pytest.raises(saved_card_contract.CardDomainError, match="input_files_write_failed"):
        card_runs.begin_run({"runId": "run-one", "correlationId": "correlation-one"})
    assert terminal == [{
        "runId": "run-one",
        "state": "failed",
        "errorCode": "input_files_materialization_failed",
        "errorSummary": "input_files_write_failed",
    }]

def test_mag_one_participant_validation_still_fails_before_run_creation(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    prepared = _prepared_grounded_runtime({
        "kind": "hermes", "mode": "magentic_one", "profile": "card-one",
    })
    monkeypatch.setattr(
        card_invocation, "prepare_run_invocation",
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
    monkeypatch.setattr(card_runs, "_insert_run",
        lambda *_args, **_kwargs: pytest.fail("participant validation created a Run"),
    )

    with pytest.raises(
        saved_card_contract.CardDomainError,
        match="magnetic_taskgraph_no_connected_workers",
    ):
        card_runs.begin_run({"runId": "run-one", "correlationId": "correlation-one"})

def test_mag_one_materializes_all_six_saved_edges_without_worker_selection(monkeypatch):
    prepared = _prepared_grounded_runtime({
        "kind": "hermes", "mode": "magentic_one", "profile": "card-one",
    })
    prepared["idf"]["stableSavedCardContext"]["outputRequirements"] = "Separate output contract"
    workers = [_agent(f"worker-{i}", subtitle=f"Saved capability {i}",
                      runtime={"kind": "hermes", "mode": "delegate", "profile": f"profile-{i}"})
               for i in range(6)]
    for i, worker in enumerate(workers):
        worker["_cardRevisionId"] = f"worker-revision-{i}"
        worker["_cardRevision"] = 1
        worker["_cardRevisionSha256"] = f"{i:064x}"
    monkeypatch.setattr(
        card_invocation, "prepare_run_invocation",
        lambda _payload, **_kwargs: prepared,
    )
    monkeypatch.setattr(saved_cards, "load_deck", lambda *_args: {"deck": {
        "nodes": workers,
        "edges": [{"source": "card-one" if i % 2 else worker["id"],
                   "target": worker["id"] if i % 2 else "card-one",
                   "edgeType": "magentic_option"} for i, worker in enumerate(workers)],
    }})
    monkeypatch.setattr(card_runs, "_insert_run", lambda *a, **kw: ("run-one", "correlation-one", True))
    monkeypatch.setattr(card_runs, "_retain_required_run_idf", _fake_retain_idf)
    monkeypatch.setattr(agentgraph_run_observations, "_observe_run_preparation_complete", lambda *a, **kw: True)
    result = card_runs.begin_run({"runId": "run-one", "correlationId": "correlation-one"})
    assert result["magneticTaskGraph"]["workers"] == [
        {
            "cardId": worker["id"],
            "title": worker["title"],
            "profile": worker["runtime"]["profile"],
            "description": worker["subtitle"],
            "cardRevisionId": worker["_cardRevisionId"],
            "capabilities": {
                "savedToolIds": [],
                "projectEligibleToolIds": [],
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

def test_run_projection_carries_saved_runtime_profile_for_exact_rejoin() -> None:
    projected = card_runs._run_projection({
        "run_id": "run-one",
        "runtime_kind": "hermes",
        "runtime_mode": "delegate",
        "runtime_profile": "research",
        "provider_thread_ref": "t_retained_root",
        "provider": "openai-codex",
        "provider_model_id": "gpt-5.6-luna",
        "effective_provider": "openai-codex",
        "access_mode": "chatgpt-account",
        "provider_total_tokens": 0,
        "cost_status": "included",
        "auto_tools_decision": {"status": "selected"},
        "auto_model_decision": {"status": "selected"},
        "state": "failed",
        "hermes_phase": "ready",
    })

    assert projected["runId"] == "run-one"
    assert projected["runtimeProfile"] == "research"
    assert projected["hermesRootId"] == "t_retained_root"
    assert projected["provider"] == "openai-codex"
    assert projected["model"] == "gpt-5.6-luna"
    assert projected["accessMode"] == "chatgpt-account"
    assert projected["providerTotalTokens"] == 0
    assert projected["costStatus"] == "included"
    assert projected["autoToolsDecision"] == {"status": "selected"}
    assert projected["autoModelDecision"] == {"status": "selected"}
    assert projected["hermesStatus"] == "ready"
    legacy = card_runs._run_projection({"run_id": "old", "hermes_phase": "queued"})
    assert legacy["hermesStatus"] is None


def test_run_projection_does_not_present_requested_model_as_effective() -> None:
    projected = card_runs._run_projection({
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
    monkeypatch.setattr(card_runs, "connect_postgres", lambda **_kwargs: Connection())
    monkeypatch.setattr(
        agentgraph_run_observations,
        "_observe_run_execution_started",
        lambda **kwargs: observed.append(kwargs) or True,
    )

    result = card_runs.start_run({
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


def test_run_progress_casts_numeric_hermes_run_id_to_persisted_text(
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

    monkeypatch.setattr(card_runs, "connect_postgres", lambda **_kwargs: Connection())
    monkeypatch.setattr(agentgraph_run_observations, "_observe_run_progress", lambda *_args, **_kwargs: True)

    result = card_runs.update_run_progress({
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
    assert "run.runtime_mode!='magentic_one'" in query
    assert "run.provider_thread_ref IS NULL OR run.provider_thread_ref=%s" in query
    assert "provider_total_tokens=COALESCE(%s, provider_total_tokens)" in query
    assert "cost_status=COALESCE(%s, cost_status)" in query
    assert params[4] == 18
    assert result["hermesRootId"] == "t_retained_root"
    assert result["updated"] is True

def test_run_progress_refuses_to_rebind_a_magnetic_root(monkeypatch: pytest.MonkeyPatch) -> None:
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

    monkeypatch.setattr(card_runs, "connect_postgres", lambda **_kwargs: Connection())
    monkeypatch.setattr(agentgraph_run_observations, "_observe_run_progress",
        lambda *_args, **_kwargs: pytest.fail("rejected rebind wrote telemetry"),
    )

    assert card_runs.update_run_progress({
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
    ("function", "payload", "error"),
    [
        (
            card_runs.update_run_progress,
            {
                "runId": "run-one", "hermesRootId": "root-one",
                "hermesStatus": "running", "providerTotalTokens": True,
            },
            "run_provider_total_tokens_invalid",
        ),
        (
            card_runs.finish_run,
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
    function,
    payload,
    error,
) -> None:
    monkeypatch.setattr(
        card_runs,
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
        "saved_openai_runtime": "",
        "effective_provider": None,
        "provider_api_mode": None,
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

    monkeypatch.setattr(card_runs, "connect_postgres", lambda **_kwargs: Connection())
    monkeypatch.setattr(agentgraph_run_observations, "_observe_run_finish", lambda *_args, **_kwargs: True)

    result = card_runs.finish_run({
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
    assert "provider_api_mode=COALESCE(provider_api_mode, %s)" in update_query
    assert "tool_call_count=COALESCE(%s, tool_call_count)" in update_query
    assert "provider_input_tokens=COALESCE(%s, provider_input_tokens)" in update_query
    assert update_params[6] == "openai-codex"
    assert update_params[7] is None
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
        "provider": "openai",
        "access_mode": "chatgpt-account",
        "saved_openai_runtime": "codex_app_server",
        "effective_provider": None,
        "provider_api_mode": None,
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

    monkeypatch.setattr(card_runs, "connect_postgres", lambda **_kwargs: Connection())
    monkeypatch.setattr(agentgraph_run_observations, "_observe_run_finish", lambda *_args, **_kwargs: True)

    result = card_runs.finish_run({
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
    assert update_params[8] is None
    assert update_params[9] == "t_mag_root"
    assert update_params[10] == "t_mag_final"
    assert result["updated"] is True
    assert result["state"] == "completed"
    assert result["runRecord"]["provider"] is None
    assert result["runRecord"]["model"] is None

def test_finish_run_reconciles_one_hash_verified_result_without_rewriting_run_record(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    statements: list[tuple[str, object]] = []
    final_result = "Exact provider assistant result."
    run_record = {
        "run_id": "run-one",
        "state": "completed",
        "finished_at": "original-finished-at",
        "provider_input_tokens": 123,
        "final_result": final_result,
    }

    class Cursor:
        rowcount = 0

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def execute(self, query, params=None):
            statements.append((str(query), params))
            if "UPDATE ag_catalog.agent_runs SET final_result" in str(query):
                self.rowcount = 1

        def fetchone(self):
            return run_record

    class Connection:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def cursor(self, **_kwargs):
            return Cursor()

    monkeypatch.setattr(card_runs, "connect_postgres", lambda **_kwargs: Connection())
    monkeypatch.setattr(agentgraph_run_observations, "_observe_run_result_ready", lambda *_args: True)
    monkeypatch.setattr(agentgraph_run_observations, "_observe_run_finish",
        lambda *_args, **_kwargs: pytest.fail("result recovery rewrote terminal Run telemetry"),
    )

    result = card_runs.finish_run({
        "runId": "run-one",
        "state": "completed",
        "finalResult": final_result,
        "expectedResultSha256": saved_card_contract.sha256_text(final_result),
        "reconcilePersistedResult": True,
    })

    update_query, update_params = next(
        statement for statement in statements
        if "UPDATE ag_catalog.agent_runs SET final_result" in statement[0]
    )
    assert "SET final_result=%s" in update_query
    assert "state='completed' AND final_result IS NULL" in update_query
    assert "finished_at" not in update_query
    assert "provider_input_tokens" not in update_query
    assert update_params == (final_result, "run-one")
    assert result["updated"] is True
    assert result["telemetryWritten"] is True

def test_finish_run_result_reconciliation_rejects_wrong_hash() -> None:
    with pytest.raises(
        saved_card_contract.CardDomainError,
        match="run_result_reconciliation_hash_mismatch",
    ):
        card_runs.finish_run({
            "runId": "run-one",
            "state": "completed",
            "finalResult": "Exact provider result.",
            "expectedResultSha256": "0" * 64,
            "reconcilePersistedResult": True,
        })

def test_main_chat_uses_one_canonical_materializer_without_serialized_card_data(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    from app.python_models import engraphis

    monkeypatch.setattr(
        engraphis,
        "get_service",
        lambda *_args, **_kwargs: pytest.fail("Main preparation opened Engraphis"),
    )
    main = _agent(
        "main", runtime={"kind": "hermes", "mode": "main", "profile": "default"}
    )
    main["runtimeOptions"] = {
        **main["runtimeOptions"],
        "tools": ["canvas.inspect"],
    }
    main["_cardRevisionId"] = "main-revision"
    main["_cardRevision"] = 1
    main["_cardRevisionSha256"] = "main-sha"
    monkeypatch.setattr(saved_cards, "load_deck",
        lambda _project, _deck: {
            "projectId": "00000000-0000-0000-0000-000000000001",
            "deck": {"nodes": [main], "edges": []},
        },
    )
    materializations: list[str] = []
    real_materialize = card_invocation.materialize_idf

    def count_materialization(**kwargs):
        materializations.append(str(kwargs["variable"]["task"]))
        return real_materialize(**kwargs)

    monkeypatch.setattr(card_invocation, "materialize_idf", count_materialization)
    prepared = card_invocation.prepare_main_chat({
        "projectId": "project-one",
        "deckId": "deck-one",
        "message": "Help me prepare work for another agent.",
    })
    assert "assignment" not in prepared
    assert prepared["message"] == "Help me prepare work for another agent."
    assert "idf" not in prepared
    assert prepared["sessionProfile"]["systemPrompt"] == main["prompt"]
    assert prepared["sessionProfile"]["enabledTools"] == ["canvas.inspect"]
    assert prepared["sessionProfile"]["unavailableTools"] == []
    assert prepared["sessionProfile"]["runtime"] == {
        "kind": "hermes", "mode": "main", "profile": "default",
    }
    assert prepared["cardIdentity"] == {"cardId": "main", "title": "main"}
    assert materializations == []
    inserted: dict[str, object] = {}
    monkeypatch.setattr(card_runs, "_insert_run",
        lambda value, **kwargs: (
            inserted.update({"prepared": value, **kwargs})
            or (kwargs["run_id"], kwargs["correlation_id"], True)
        ),
    )
    monkeypatch.setattr(agentgraph_run_observations, "_observe_run_preparation_complete", lambda *args, **kwargs: True)
    monkeypatch.setattr(card_runs, "_record_run_input_artifact", lambda *_args, **_kwargs: None)
    monkeypatch.setenv("LIQUIDAITY_RUN_INPUT_ROOT", str(tmp_path / "run-inputs"))
    begun = card_runs.begin_main_chat_run({
        "projectId": "project-one",
        "deckId": "deck-one",
        "message": "Help me prepare work for another agent.",
        "cardRevisionId": "main-revision",
        "runId": "run-main-one",
        "correlationId": "run-main-one",
        "conversationId": "conversation-one",
    })
    assert begun["hermesTransport"]["request"]["task"] == (
        "Help me prepare work for another agent."
    )
    assert inserted["prepared"]["idf"]["dynamicContext"]["task"] == begun["idf"]["dynamicContext"]["task"]
    assert begun["inputFile"]["idfPath"].endswith("in.idf")
    assert materializations == ["Help me prepare work for another agent."]

def test_shared_conversation_task_names_the_selected_saved_card() -> None:
    current = "Who just replied to me?"
    context = [
        {
            "role": "user",
            "speakerCardId": "",
            "speakerLabel": "You",
            "targetCardId": "builder",
            "targetLabel": "Builder",
            "content": "@builder Reply exactly BUILDER_DIRECT_OK",
        },
        {
            "role": "assistant",
            "speakerCardId": "builder",
            "speakerLabel": "Builder",
            "targetCardId": "",
            "targetLabel": "",
            "content": "BUILDER_DIRECT_OK",
        },
    ]
    rendered = card_runs.shared_conversation_task(current, context, "Builder")
    assert rendered.startswith("## Shared conversation before this Builder turn")
    assert "You -> Builder:\n@builder Reply exactly BUILDER_DIRECT_OK" in rendered
    assert "Builder:\nBUILDER_DIRECT_OK" in rendered
    assert rendered.endswith("## Current user message to Builder\n\nWho just replied to me?")
    assert card_runs.shared_conversation_task(current, [], "Research") == current

def test_begin_run_renders_shared_conversation_before_selected_card_idf(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    prepared = _prepared_grounded_runtime({
        "kind": "hermes", "mode": "delegate", "profile": "builder",
    })
    prepared["cardIdentity"] = {"cardId": "builder", "title": "Builder"}
    captured: dict[str, object] = {}

    def prepare(payload: dict, *, selection_request: str | None = None) -> dict:
        captured.update(payload)
        captured["selectionRequest"] = selection_request
        return prepared

    monkeypatch.setattr(card_invocation, "prepare_run_invocation", prepare)
    monkeypatch.setattr(card_runs, "_insert_run",
        lambda *_args, **_kwargs: ("run-builder", "run-builder", True),
    )
    monkeypatch.setattr(card_runs, "_retain_required_run_idf", _fake_retain_idf)
    monkeypatch.setattr(agentgraph_run_observations, "_observe_run_preparation_complete", lambda *_args, **_kwargs: True)

    card_runs.begin_run({
        "projectId": "project-one",
        "deckId": "deck-one",
        "cardId": "builder",
        "assignment": "Continue with this result.",
        "sharedConversationTargetLabel": "Builder",
        "sharedConversation": [{
            "role": "assistant",
            "speakerCardId": "research",
            "speakerLabel": "Research",
            "targetCardId": "",
            "targetLabel": "",
            "content": "The bounded research result.",
        }],
        "runId": "run-builder",
        "correlationId": "run-builder",
    })

    assert captured["assignment"] == "\n\n".join((
        "## Shared conversation before this Builder turn",
        "Research:\nThe bounded research result.",
        "## Current user message to Builder",
        "Continue with this result.",
    ))
    assert captured["selectionRequest"] == "Continue with this result."

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
    monkeypatch.setattr(card_runs, "connect_postgres", lambda **_kwargs: Connection())
    monkeypatch.setattr(agentgraph_run_observations, "_observe_run_acceptance",
        lambda **kwargs: observed.append(kwargs) or True,
    )

    result = card_runs.accept_run_request({
        "projectId": "project-one",
        "deckId": "deck-one",
        "cardId": "card-one",
        "runId": "request-one",
        "correlationId": "request-one",
        "cardRevisionId": "revision-one",
        "conversationId": "conversation-one",
        "acceptedAt": "2026-10-01T20:00:00.000Z",
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
    monkeypatch.setattr(card_runs, "connect_postgres",
        lambda **_kwargs: (_ for _ in ()).throw(AssertionError("must not insert")),
    )

    with pytest.raises(saved_card_contract.CardDomainError, match="card_revision_changed"):
        card_runs.accept_run_request({
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
                "execution_authority_sha256": None,
            }

    class Connection:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def cursor(self, **_kwargs):
            return Cursor()

    monkeypatch.setattr(card_runs, "connect_postgres", lambda **_kwargs: Connection())
    prepared = _prepared_grounded_runtime({
        "kind": "hermes", "mode": "main", "profile": "liquidaity-main",
    })

    assert card_runs._insert_run(
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
                "execution_authority_sha256": "authority-one",
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
    monkeypatch.setattr(card_runs, "connect_postgres", lambda **_kwargs: Connection())

    with pytest.raises(
        saved_card_contract.CardDomainError,
        match="run_selection_decision_conflict",
    ):
        card_runs._insert_run(
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
    monkeypatch.setattr(card_runs, "accept_run_request", lambda _payload: accepted)
    monkeypatch.setattr(card_runs, "_begin_accepted_run",
        lambda _payload: (_ for _ in ()).throw(
            saved_card_contract.CardDomainError("configured_tool_unknown:provider.tool")
        ),
    )
    monkeypatch.setattr(card_runs, "_fail_accepted_run_preparation",
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
        card_runs.begin_run(payload)

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
    error = card_runs.AutoModelSelectionError(model_decision)
    error.auto_tools_decision = {
        "schemaVersion": "auto-tools-decision.v1",
        "status": "selected",
        "candidateCount": 0,
        "selectedToolIds": [],
        "selectedConfidencePercentages": {},
        "decisionId": None,
        "errorCode": None,
    }
    monkeypatch.setattr(card_runs, "accept_run_request", lambda _payload: accepted)
    monkeypatch.setattr(
        card_runs,
        "_begin_accepted_run",
        lambda _payload: (_ for _ in ()).throw(error),
    )
    monkeypatch.setattr(
        card_runs,
        "_fail_accepted_run_preparation",
        lambda _accepted, payload: settled.append(payload) or {"ok": True},
    )
    payload = {
        "projectId": "project-one", "deckId": "deck-one", "cardId": "card-one",
        "runId": "request-one", "correlationId": "request-one",
        "acceptedAt": "2026-10-01T20:00:00.000Z",
    }

    with pytest.raises(
        card_runs.AutoModelSelectionError,
        match="auto_model_compatible_candidates_unavailable",
    ):
        card_runs.begin_run(payload)

    assert settled[0]["autoModelDecision"] == model_decision
    assert settled[0]["autoToolsDecision"] == error.auto_tools_decision
