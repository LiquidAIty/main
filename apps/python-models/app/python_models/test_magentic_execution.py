from __future__ import annotations

import builtins
import hashlib
import hmac
import json
from typing import Any

import pytest

from app.python_models import idf as idf_module
from app.python_models import magentic_execution


def _execution_payload() -> dict[str, Any]:
    return {
        "runId": "run-one",
        "correlationId": "correlation-one",
        "projectId": "project-one",
        "deckId": "deck-one",
        "inputFile": {
            "idfPath": "retained/in.idf",
            "idfSha256": "exact-hash",
            "idfBytes": 123,
        },
        "mission": "Exact mission from the retained IDF.",
        "orchestrator": {
            "cardId": "card_magentic",
            "cardRevisionId": "mag-one-revision",
            "nativeIdentity": "card_magentic",
            "instructions": "Coordinate the connected Cards.",
            "provider": {
                "provider": "openai",
                "modelKey": "gpt-5.6-sol",
                "providerModelId": "gpt-5.6-sol",
                "accessMode": "chatgpt-account",
            },
            "runtimeOptions": {},
        },
        "workers": [
            {
                "cardId": "worker-card-a",
                "cardRevisionId": "worker-revision-a",
                "profile": "worker-a",
                "title": "Worker A",
                "description": "First saved Card",
            },
            {
                "cardId": "worker-card-b",
                "cardRevisionId": "worker-revision-b",
                "profile": "worker-b",
                "title": "Worker B",
                "description": "Second saved Card",
            },
        ],
        "workerAuthorities": [
            {
                "cardId": "worker-card-a",
                "cardRevisionId": "worker-revision-a",
                "profile": "worker-a",
                "configurationFingerprint": "a" * 64,
            },
            {
                "cardId": "worker-card-b",
                "cardRevisionId": "worker-revision-b",
                "profile": "worker-b",
                "configurationFingerprint": "b" * 64,
            },
        ],
    }


def _team_execution_payload() -> dict[str, Any]:
    payload = _execution_payload()
    payload["workers"] = [{
        "cardId": "card_team",
        "cardRevisionId": "team-revision",
        "profile": "team",
        "title": "Team",
        "description": "Automatic generalist Team",
        "teamTaskMode": True,
        "provider": {
            "provider": "openai",
            "accessMode": "chatgpt-account",
            "modelKey": "gpt-5.6-terra",
            "providerModelId": "gpt-5.6-terra",
        },
        "runtimeOptions": {
            "modelKey": "gpt-5.6-terra",
            "providerModelId": "gpt-5.6-terra",
        },
    }]
    payload["workerAuthorities"] = [{
        "cardId": "card_team",
        "cardRevisionId": "team-revision",
        "profile": "team",
        "configurationFingerprint": "c" * 64,
    }]
    return payload


@pytest.fixture
def native_task_store(tmp_path, monkeypatch):
    magentic_execution._runtime_paths()
    from hermes_cli import kanban_db_connect as task_db_connect

    db_path = tmp_path / "tasks.db"
    task_db_connect.init_db(db_path)
    monkeypatch.setattr(magentic_execution, "_task_db_path", lambda: db_path)
    return db_path


def _stub_retained_input(monkeypatch, *, mission: str | None = None) -> dict[str, str]:
    captured: dict[str, str] = {}

    def load_idf(_descriptor, **identity):
        captured.update(identity)
        return object()

    monkeypatch.setattr(idf_module, "load_idf", load_idf)
    monkeypatch.setattr(
        idf_module,
        "runtime_projection",
        lambda _materialized: {
            "kanbanMission": mission or "Exact mission from the retained IDF.",
        },
    )
    monkeypatch.setattr(
        magentic_execution,
        "_ensure_orchestrator_identity",
        lambda _spec, _workers: (
            "card_magentic", "openai-codex", "gpt-5.6-sol", "codex_app_server",
        ),
    )
    monkeypatch.setattr(
        magentic_execution,
        "_bind_outer_magentic_run",
        lambda run_id, native_root_id, _status: {
            "ok": True,
            "runId": run_id,
            "nativeRootId": native_root_id,
            "updated": True,
        },
    )
    return captured


def test_orchestrator_identity_resolves_the_repository_profile_tree(
    tmp_path, monkeypatch,
) -> None:
    magentic_execution._runtime_paths()
    hermes_root = tmp_path / "Hermes"
    hermes_home = hermes_root / ".hermes"
    orchestrator_home = hermes_home / "profiles" / "card_magentic"
    worker_home = hermes_home / "profiles" / "worker-a"
    orchestrator_home.mkdir(parents=True)
    worker_home.mkdir(parents=True)
    orchestrator_home.joinpath("config.yaml").write_text(
        "model:\n"
        "  provider: openai-codex\n"
        "  default: gpt-5.6-sol\n",
        encoding="utf-8",
    )
    orchestrator_home.joinpath("SOUL.md").write_text(
        "Coordinate the connected Cards.",
        encoding="utf-8",
    )
    worker_home.joinpath("config.yaml").write_text("model: {}\n", encoding="utf-8")
    monkeypatch.setattr(
        magentic_execution,
        "_runtime_paths",
        lambda: (hermes_root, hermes_home),
    )

    assert magentic_execution._ensure_orchestrator_identity(
        _execution_payload()["orchestrator"],
        [_execution_payload()["workers"][0]],
    ) == ("card_magentic", "openai-codex", "gpt-5.6-sol", "codex_app_server")


@pytest.mark.parametrize(
    ("soul", "agent_config"),
    [
        ("Wrong instructions.", ""),
        (
            "Coordinate the connected Cards.",
            "agent:\n  system_prompt: Coordinate the connected Cards.\n",
        ),
    ],
)
def test_orchestrator_identity_rejects_duplicate_or_mismatched_prompt_authority(
    tmp_path, monkeypatch, soul: str, agent_config: str,
) -> None:
    magentic_execution._runtime_paths()
    hermes_root = tmp_path / "Hermes"
    hermes_home = hermes_root / ".hermes"
    orchestrator_home = hermes_home / "profiles" / "card_magentic"
    worker_home = hermes_home / "profiles" / "worker-a"
    orchestrator_home.mkdir(parents=True)
    worker_home.mkdir(parents=True)
    orchestrator_home.joinpath("config.yaml").write_text(
        "model:\n"
        "  provider: openai-codex\n"
        "  default: gpt-5.6-sol\n"
        f"{agent_config}",
        encoding="utf-8",
    )
    orchestrator_home.joinpath("SOUL.md").write_text(soul, encoding="utf-8")
    worker_home.joinpath("config.yaml").write_text("model: {}\n", encoding="utf-8")
    monkeypatch.setattr(
        magentic_execution,
        "_runtime_paths",
        lambda: (hermes_root, hermes_home),
    )

    with pytest.raises(
        magentic_execution.MagenticExecutionError,
        match="magentic_orchestrator_materialization_mismatch",
    ):
        magentic_execution._ensure_orchestrator_identity(
            _execution_payload()["orchestrator"],
            [_execution_payload()["workers"][0]],
        )


def test_submit_uses_reloaded_idf_and_creates_one_idempotent_bounded_root(
    native_task_store, monkeypatch,
) -> None:
    from hermes_cli import kanban_db as task_db, kanban_db_connect as task_db_connect

    captured = _stub_retained_input(monkeypatch)
    payload = _execution_payload()
    payload["notifySession"] = {
        "sessionKey": "main-stored-session",
        "profile": "liquidaity-main",
    }
    first = magentic_execution.submit_magentic_execution(payload)
    second = magentic_execution.submit_magentic_execution(payload)

    assert captured == {
        "project_id": "project-one",
        "deck_id": "deck-one",
        "run_id": "run-one",
        "card_id": "card_magentic",
    }
    assert second["nativeRootId"] == first["nativeRootId"]
    assert first == {
        "ok": True,
        "runId": "run-one",
        "nativeRootId": first["nativeRootId"],
        "nativeIdentity": "card_magentic",
        "effectiveProvider": "openai-codex",
        "providerApiMode": "codex_app_server",
        "model": "gpt-5.6-sol",
        "tenant": "mag-one:run-one",
        "state": "running",
        "nativeStatus": "ready",
        "nativeNotification": True,
        "outerRunBound": True,
    }
    with task_db_connect.connect_closing(native_task_store) as connection:
        root = task_db.get_task(connection, first["nativeRootId"])
        assert root is not None
        assert root.allowed_assignees == ["card_magentic", "worker-a", "worker-b"]
        assert root.assignee == "card_magentic"
        assert root.tenant == "mag-one:run-one"
        assert root.model_override == "gpt-5.6-sol"
        assert root.provider_override == "openai-codex"
        assert root.session_id == "main-stored-session"
        assert root.status == "ready"
        assert "Exact mission from the retained IDF." in (root.body or "")
        assert "First saved Card" in (root.body or "")
        assert "both the orchestration root and the final result task" in (root.body or "")
        assert "already approved this mission after upstream context engineering" in (root.body or "")
        assert "do not invent a replacement mission or another approval step" in (root.body or "")
        assert "initial_status=\"running\"" in (root.body or "")
        assert "parent of THIS root task" in (root.body or "")
        assert "kanban_block(kind=\"dependency\")" in (root.body or "")
        assert "root in todo while those parents are unfinished" in (root.body or "")
        assert "then promote it to ready" in (root.body or "")
        assert "Never complete an intermediate decomposition" in (root.body or "")
        assert "never create another task for final synthesis" in (root.body or "")
        assert "auto-decomposition, triage, goal mode, delegate_task" in (root.body or "")
        assert "never make one worker wait for another" in (root.body or "")
        assert connection.execute(
            "SELECT COUNT(*) AS count FROM tasks WHERE idempotency_key = ?",
            ("magentic:run-one:root",),
        ).fetchone()["count"] == 1
        assert connection.execute(
            "SELECT COUNT(*) AS count FROM task_events WHERE task_id = ? AND kind = ?",
            (first["nativeRootId"], magentic_execution._NATIVE_AUTHORITY_EVENT),
        ).fetchone()["count"] == 1
        subscription = connection.execute(
            "SELECT platform, chat_id, notifier_profile FROM kanban_notify_subs WHERE task_id = ?",
            (first["nativeRootId"],),
        ).fetchone()
        assert dict(subscription) == {
            "platform": "tui",
            "chat_id": "main-stored-session",
            "notifier_profile": "liquidaity-main",
        }


def test_team_only_bypasses_magnetic_model_and_uses_the_same_team_root(
    native_task_store, tmp_path, monkeypatch,
) -> None:
    from hermes_cli import kanban_db as task_db, kanban_db_connect as task_db_connect
    from hermes_cli.kanban_team import TEAM_DECOMPOSITION_STEP, TEAM_WORKFLOW_ID

    _stub_retained_input(monkeypatch)
    hermes_root = tmp_path / "Hermes"
    hermes_home = hermes_root / ".hermes"
    profile_home = hermes_home / "profiles" / "team"
    profile_home.mkdir(parents=True)
    profile_home.joinpath("config.yaml").write_text(
        "model:\n"
        "  provider: openai-codex\n"
        "  default: gpt-5.6-terra\n"
        "delegation:\n"
        "  provider: openai-codex\n"
        "  model: gpt-5.6-luna\n"
        "  reasoning_effort: high\n"
        "kanban:\n"
        "  task_mode: team\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(
        magentic_execution, "_runtime_paths", lambda: (hermes_root, hermes_home),
    )

    def magnetic_model_must_not_run(*_args, **_kwargs):
        raise AssertionError("Team-only execution must bypass the Magnetic model")

    monkeypatch.setattr(
        magentic_execution, "_ensure_orchestrator_identity", magnetic_model_must_not_run,
    )
    payload = _team_execution_payload()
    payload["notifySession"] = {
        "sessionKey": "main-stored-session",
        "profile": "liquidaity-main",
    }

    result = magentic_execution.submit_magentic_execution(payload)

    assert result == {
        "ok": True,
        "runId": "run-one",
        "nativeRootId": result["nativeRootId"],
        "nativeIdentity": "team",
        "effectiveProvider": "openai-codex",
        "providerApiMode": "codex_app_server",
        "model": "gpt-5.6-terra",
        "tenant": "mag-one:run-one",
        "state": "running",
        "nativeStatus": "triage",
        "nativeNotification": True,
        "outerRunBound": True,
    }
    with task_db_connect.connect_closing(native_task_store) as connection:
        root = task_db.get_task(connection, result["nativeRootId"])
        assert root is not None
        assert root.assignee == "team"
        assert root.created_by == "card_magentic"
        assert root.allowed_assignees == ["team"]
        assert root.workflow_template_id == TEAM_WORKFLOW_ID
        assert root.current_step_key == TEAM_DECOMPOSITION_STEP
        assert root.model_override == "gpt-5.6-terra"
        assert root.provider_override == "openai-codex"
        assert root.body == "Exact mission from the retained IDF."
        assert root.session_id == "main-stored-session"
        subscriptions = connection.execute(
            "SELECT platform, chat_id, notifier_profile FROM kanban_notify_subs "
            "WHERE task_id = ?",
            (root.id,),
        ).fetchall()
        assert [tuple(row) for row in subscriptions] == [
            ("tui", "main-stored-session", "liquidaity-main"),
        ]


def test_submit_rejoin_rejects_changed_immutable_worker_authority(
    native_task_store, monkeypatch,
) -> None:
    from hermes_cli import kanban_db_connect as task_db_connect

    _stub_retained_input(monkeypatch)
    payload = _execution_payload()
    first = magentic_execution.submit_magentic_execution(payload)
    changed = _execution_payload()
    changed["workerAuthorities"][0]["configurationFingerprint"] = "d" * 64

    with pytest.raises(
        magentic_execution.MagenticExecutionError,
        match="magentic_worker_authority_binding_mismatch",
    ):
        magentic_execution.submit_magentic_execution(changed)

    with task_db_connect.connect_closing(native_task_store) as connection:
        assert connection.execute(
            "SELECT COUNT(*) AS count FROM tasks WHERE idempotency_key = ?",
            ("magentic:run-one:root",),
        ).fetchone()["count"] == 1
        assert connection.execute(
            "SELECT COUNT(*) AS count FROM task_events WHERE task_id = ? AND kind = ?",
            (first["nativeRootId"], magentic_execution._NATIVE_AUTHORITY_EVENT),
        ).fetchone()["count"] == 1


def test_submit_preserves_an_unbound_staged_root_for_exact_retry(
    native_task_store, monkeypatch,
) -> None:
    from hermes_cli import kanban_db_connect as task_db_connect

    _stub_retained_input(monkeypatch)
    monkeypatch.setattr(
        magentic_execution,
        "_bind_outer_magentic_run",
        lambda *_args: (_ for _ in ()).throw(
            magentic_execution.MagenticExecutionError("magentic_outer_run_binding_failed")
        ),
    )

    with pytest.raises(
        magentic_execution.MagenticExecutionError,
        match="magentic_outer_run_binding_failed",
    ):
        magentic_execution.submit_magentic_execution(_execution_payload())
    with task_db_connect.connect_closing(native_task_store) as connection:
        staged = connection.execute(
            "SELECT id, status, current_run_id FROM tasks WHERE idempotency_key = ?",
            ("magentic:run-one:root",),
        ).fetchone()
        assert staged is not None
        assert staged["status"] == "blocked"
        assert staged["current_run_id"] is None
        assert connection.execute(
            "SELECT COUNT(*) AS count FROM task_events WHERE task_id = ? AND kind = ?",
            (staged["id"], magentic_execution._NATIVE_AUTHORITY_EVENT),
        ).fetchone()["count"] == 1


def test_submit_preserves_a_bound_staged_root_when_activation_fails_for_retry(
    native_task_store, monkeypatch,
) -> None:
    from hermes_cli import kanban_db as task_db, kanban_db_connect as task_db_connect

    _stub_retained_input(monkeypatch)
    promote_task = task_db.promote_task
    monkeypatch.setattr(task_db, "promote_task", lambda *_args, **_kwargs: (False, "injected"))

    with pytest.raises(
        magentic_execution.MagenticExecutionError,
        match="magentic_native_root_activation_failed",
    ):
        magentic_execution.submit_magentic_execution(_execution_payload())
    with task_db_connect.connect_closing(native_task_store) as connection:
        staged = connection.execute(
            "SELECT id, status FROM tasks WHERE idempotency_key = ?",
            ("magentic:run-one:root",),
        ).fetchone()
        assert staged is not None and staged["status"] == "blocked"
        assert connection.execute(
            "SELECT COUNT(*) AS count FROM task_events WHERE task_id = ? AND kind = ?",
            (staged["id"], magentic_execution._NATIVE_AUTHORITY_EVENT),
        ).fetchone()["count"] == 1

    monkeypatch.setattr(task_db, "promote_task", promote_task)
    retried = magentic_execution.submit_magentic_execution(_execution_payload())
    assert retried["nativeRootId"] == staged["id"]
    assert retried["nativeStatus"] == "ready"


def test_team_marker_cannot_be_applied_to_another_worker(monkeypatch) -> None:
    payload = _execution_payload()
    payload["workers"][0]["teamTaskMode"] = True
    _stub_retained_input(monkeypatch)

    with pytest.raises(
        magentic_execution.MagenticExecutionError,
        match="magentic_team_identity_invalid:worker-card-a",
    ):
        magentic_execution.submit_magentic_execution(payload)


def test_submit_rejects_transport_mission_that_differs_from_reloaded_idf(
    native_task_store, monkeypatch,
) -> None:
    _stub_retained_input(monkeypatch, mission="Mission held by retained bytes.")

    with pytest.raises(
        magentic_execution.MagenticExecutionError,
        match="magentic_mission_input_mismatch",
    ):
        magentic_execution.submit_magentic_execution(_execution_payload())


def _submit_root(monkeypatch) -> str:
    _stub_retained_input(monkeypatch)
    return magentic_execution.submit_magentic_execution(
        _execution_payload(),
    )["nativeRootId"]


def _signed_worker_envelope(secret: str, payload: dict[str, Any]) -> dict[str, str]:
    raw = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    secret_bytes = secret.encode("utf-8")
    return {
        "keyId": hashlib.sha256(secret_bytes).hexdigest(),
        "payload": raw,
        "signature": hmac.new(secret_bytes, raw.encode("utf-8"), hashlib.sha256).hexdigest(),
    }


def _claimed_worker_auth_case(native_task_store, monkeypatch) -> dict[str, Any]:
    from hermes_cli import kanban_db as task_db, kanban_db_connect as task_db_connect

    now = 2_000_000_000
    monkeypatch.setattr(magentic_execution.time, "time", lambda: now)
    root_id = _submit_root(monkeypatch)
    with task_db_connect.connect_closing(native_task_store) as connection:
        worker_id = task_db.create_task(
            connection,
            title="Authenticated worker tool task",
            assignee="worker-a",
            created_by="card_magentic",
            creator_task_id=root_id,
            tenant="mag-one:run-one",
            initial_status="running",
        )
        claimed = task_db.claim_task(connection, worker_id)
        assert claimed is not None
        source_run_id = claimed.current_run_id
        secret = claimed.claim_lock
        assert isinstance(secret, str) and secret
    payload = {
        "version": 2,
        "expiresAt": now + 300,
        "nonce": "a" * 32,
        "sourceTaskId": worker_id,
        "sourceTaskRunId": source_run_id,
        "sourceProfile": "worker-a",
        "tool": "card__canvas_inspect",
        "arguments": {"depth": 1},
    }
    outer_run = {
        "run_id": "run-one",
        "project_id": "project-one",
        "deck_id": "deck-one",
        "state": "running",
        "runtime_kind": "hermes",
        "runtime_mode": "magentic_one",
        "provider_thread_ref": root_id,
        "card_id": "card_magentic",
        "runtime_profile": "card_magentic",
    }
    monkeypatch.setattr(
        magentic_execution,
        "_read_outer_magentic_run",
        lambda outer_run_id: dict(outer_run) if outer_run_id == "run-one" else None,
    )
    return {
        "rootId": root_id,
        "workerId": worker_id,
        "sourceRunId": source_run_id,
        "secret": secret,
        "payload": payload,
        "outerRun": outer_run,
        "now": now,
    }


def _claimed_direct_team_auth_case(
    native_task_store, monkeypatch, *, decomposed_worker: bool = False,
    profile: str = "team",
) -> dict[str, Any]:
    from hermes_cli import kanban_db as task_db, kanban_db_connect as task_db_connect
    from hermes_cli.kanban_db_graph import decompose_triage_task
    from hermes_cli.kanban_team import create_team_root

    now = 2_000_000_000
    monkeypatch.setattr(magentic_execution.time, "time", lambda: now)
    hermes_root = native_task_store.parent / "Hermes"
    hermes_home = hermes_root / ".hermes"
    profile_home = hermes_home / "profiles" / profile
    profile_home.mkdir(parents=True)
    profile_home.joinpath("config.yaml").write_text(
        "model:\n"
        "  provider: openai-codex\n"
        "  default: gpt-5.6-terra\n"
        "delegation:\n"
        "  provider: openai-codex\n"
        "  model: gpt-5.6-luna\n"
        "  reasoning_effort: high\n"
        "kanban:\n"
        "  task_mode: team\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(
        magentic_execution, "_runtime_paths", lambda: (hermes_root, hermes_home),
    )
    with task_db_connect.connect_closing(native_task_store) as connection:
        root = create_team_root(
            connection,
            title="Authenticated direct Team root",
            body="Use the native Team workflow.",
            assignee=profile,
            profile_home=profile_home,
            created_by="card_magentic",
            tenant="mag-one:run-one",
            allowed_assignees=[profile],
            idempotency_key="magentic:run-one:root",
            initial_status="running",
        )
        root_id = root.id
        magentic_execution._bind_native_worker_authorities(
            connection,
            task_db,
            root_id,
            [{
                "cardId": "card_team",
                "cardRevisionId": "team-revision",
                "profile": profile,
                "configurationFingerprint": "c" * 64,
            }],
        )
        child_ids = decompose_triage_task(
            connection,
            root_id,
            root_assignee=profile,
            children=[{
                "title": "Native decomposed Team worker",
                "body": "Complete the bounded worker task.",
                "assignee": profile,
            }],
            author=profile,
        )
        assert child_ids and len(child_ids) == 1
        child_id = child_ids[0]
        if decomposed_worker:
            source_task_id = child_id
            secret = "dispatcher:team-worker:claim"
        else:
            child = task_db.claim_task(
                connection, child_id, claimer="dispatcher:team-worker:setup",
            )
            assert child is not None and child.current_run_id is not None
            assert task_db.complete_task(
                connection,
                child_id,
                summary="Native Team worker completed.",
                expected_run_id=child.current_run_id,
            )
            task_db.recompute_ready(connection)
            source_task_id = root_id
            secret = "dispatcher:team-synthesis:claim"
        claimed = task_db.claim_task(connection, source_task_id, claimer=secret)
        assert claimed is not None
        source_run_id = claimed.current_run_id
    payload = {
        "version": 2,
        "expiresAt": now + 300,
        "nonce": "b" * 32,
        "sourceTaskId": source_task_id,
        "sourceTaskRunId": source_run_id,
        "sourceProfile": profile,
        "tool": "card__canvas_inspect",
        "arguments": {"depth": 1},
    }
    outer_run = {
        "run_id": "run-one",
        "project_id": "project-one",
        "deck_id": "deck-one",
        "state": "running",
        "runtime_kind": "hermes",
        "runtime_mode": "magentic_one",
        "provider_thread_ref": root_id,
        "card_id": "card_magentic",
        "runtime_profile": "card_magentic",
    }
    monkeypatch.setattr(
        magentic_execution,
        "_read_outer_magentic_run",
        lambda outer_run_id: dict(outer_run) if outer_run_id == "run-one" else None,
    )
    return {
        "rootId": root_id,
        "sourceTaskId": source_task_id,
        "sourceRunId": source_run_id,
        "secret": secret,
        "payload": payload,
        "outerRun": outer_run,
        "now": now,
        "profile": profile,
    }


def test_worker_tool_auth_accepts_only_the_live_native_claim_and_redacts_auth_material(
    native_task_store, monkeypatch,
) -> None:
    case = _claimed_worker_auth_case(native_task_store, monkeypatch)
    result = magentic_execution.authenticate_magentic_worker_tool_request(
        _signed_worker_envelope(case["secret"], case["payload"]),
    )

    assert result == {
        "projectId": "project-one",
        "deckId": "deck-one",
        "outerRunId": "run-one",
        "nativeRootId": case["rootId"],
        "sourceTaskId": case["workerId"],
        "sourceTaskRunId": case["sourceRunId"],
        "sourceProfile": "worker-a",
        "authorityProfile": "worker-a",
        "authorityCardId": "worker-card-a",
        "authorityCardRevisionId": "worker-revision-a",
        "authorityConfigurationFingerprint": "a" * 64,
        "expiresAt": case["now"] + 300,
        "nonce": "a" * 32,
        "tool": "card__canvas_inspect",
        "arguments": {"depth": 1},
    }
    serialized = json.dumps(result, sort_keys=True)
    assert case["secret"] not in serialized
    assert "keyId" not in result
    assert "signature" not in result
    assert "payload" not in result


def test_worker_tool_auth_rejects_a_sibling_from_the_same_dispatcher(
    native_task_store, monkeypatch,
) -> None:
    from hermes_cli import kanban_db as task_db, kanban_db_connect as task_db_connect

    worker_a = _claimed_worker_auth_case(native_task_store, monkeypatch)
    with task_db_connect.connect_closing(native_task_store) as connection:
        worker_b_id = task_db.create_task(
            connection,
            title="Sibling worker tool task",
            assignee="worker-b",
            created_by="card_magentic",
            creator_task_id=worker_a["rootId"],
            tenant="mag-one:run-one",
            initial_status="running",
        )
        worker_b = task_db.claim_task(connection, worker_b_id)
        assert worker_b is not None and worker_b.current_run_id is not None
        assert isinstance(worker_b.claim_lock, str) and worker_b.claim_lock
        assert worker_b.claim_lock != worker_a["secret"]
        assert worker_b.claim_lock.rsplit(":", 1)[0] == worker_a["secret"].rsplit(":", 1)[0]

    worker_b_payload = {
        **worker_a["payload"],
        "nonce": "c" * 32,
        "sourceTaskId": worker_b_id,
        "sourceTaskRunId": worker_b.current_run_id,
        "sourceProfile": "worker-b",
    }
    accepted = magentic_execution.authenticate_magentic_worker_tool_request(
        _signed_worker_envelope(worker_b.claim_lock, worker_b_payload),
    )
    assert accepted["sourceTaskId"] == worker_b_id
    assert accepted["authorityProfile"] == "worker-b"

    with pytest.raises(
        magentic_execution.MagenticExecutionError,
        match="magentic_worker_tool_authentication_failed",
    ):
        magentic_execution.authenticate_magentic_worker_tool_request(
            _signed_worker_envelope(worker_a["secret"], worker_b_payload),
        )


@pytest.mark.parametrize(
    ("decomposed_worker", "profile"),
    [(False, "team"), (True, "team"), (True, "alternate-team")],
)
def test_worker_tool_auth_accepts_the_exact_direct_team_native_execution(
    native_task_store, monkeypatch, decomposed_worker: bool, profile: str,
) -> None:
    case = _claimed_direct_team_auth_case(
        native_task_store, monkeypatch,
        decomposed_worker=decomposed_worker,
        profile=profile,
    )

    assert magentic_execution.authenticate_magentic_worker_tool_request(
        _signed_worker_envelope(case["secret"], case["payload"]),
    ) == {
        "projectId": "project-one",
        "deckId": "deck-one",
        "outerRunId": "run-one",
        "nativeRootId": case["rootId"],
        "sourceTaskId": case["sourceTaskId"],
        "sourceTaskRunId": case["sourceRunId"],
        "sourceProfile": profile,
        "authorityProfile": profile,
        "authorityCardId": "card_team",
        "authorityCardRevisionId": "team-revision",
        "authorityConfigurationFingerprint": "c" * 64,
        "expiresAt": case["now"] + 300,
        "nonce": "b" * 32,
        "tool": "card__canvas_inspect",
        "arguments": {"depth": 1},
    }


@pytest.mark.parametrize(
    ("column", "value"),
    [
        ("created_by", "team"),
        ("allowed_assignees", '["team","card_magentic"]'),
        ("tenant", "unrelated:run-one"),
    ],
)
def test_worker_tool_auth_rejects_a_widened_direct_team_root(
    native_task_store, monkeypatch, column: str, value: str,
) -> None:
    from hermes_cli import kanban_db_connect as task_db_connect

    case = _claimed_direct_team_auth_case(native_task_store, monkeypatch)
    assert column in {"created_by", "allowed_assignees", "tenant"}
    with task_db_connect.connect_closing(native_task_store) as connection:
        connection.execute(
            f"UPDATE tasks SET {column} = ? WHERE id = ?",
            (value, case["rootId"]),
        )
        connection.commit()

    with pytest.raises(
        magentic_execution.MagenticExecutionError,
        match="magentic_worker_tool_authentication_failed",
    ):
        magentic_execution.authenticate_magentic_worker_tool_request(
            _signed_worker_envelope(case["secret"], case["payload"]),
        )


@pytest.mark.parametrize(
    ("target", "offset"),
    [("task", 0), ("run", 0), ("run", 301)],
)
def test_worker_tool_auth_rejects_expired_or_inconsistent_native_leases(
    native_task_store, monkeypatch, target: str, offset: int,
) -> None:
    from hermes_cli import kanban_db_connect as task_db_connect

    case = _claimed_worker_auth_case(native_task_store, monkeypatch)
    with task_db_connect.connect_closing(native_task_store) as connection:
        if target == "task":
            connection.execute(
                "UPDATE tasks SET claim_expires = ? WHERE id = ?",
                (case["now"] + offset, case["workerId"]),
            )
        else:
            connection.execute(
                "UPDATE task_runs SET claim_expires = ? WHERE id = ?",
                (case["now"] + offset, case["sourceRunId"]),
            )
        connection.commit()
    with pytest.raises(
        magentic_execution.MagenticExecutionError,
        match="magentic_worker_tool_authentication_failed",
    ):
        magentic_execution.authenticate_magentic_worker_tool_request(
            _signed_worker_envelope(case["secret"], case["payload"]),
        )


def test_worker_tool_auth_ignores_unrelated_malformed_native_events(
    native_task_store, monkeypatch,
) -> None:
    from hermes_cli import kanban_db as task_db, kanban_db_connect as task_db_connect

    case = _claimed_worker_auth_case(native_task_store, monkeypatch)
    with task_db_connect.connect_closing(native_task_store) as connection:
        unrelated = task_db.create_task(
            connection, title="Unrelated task", assignee="worker-b",
            created_by="unrelated", tenant="another-tenant", initial_status="blocked",
        )
        connection.execute(
            "UPDATE task_events SET payload = ? WHERE task_id = ? AND kind = 'created'",
            ("{malformed", unrelated),
        )
        connection.commit()

    result = magentic_execution.authenticate_magentic_worker_tool_request(
        _signed_worker_envelope(case["secret"], case["payload"]),
    )
    assert result["sourceTaskId"] == case["workerId"]


@pytest.mark.parametrize("creator_task_id", ["t_missing_parent", "self"])
def test_worker_tool_auth_rejects_missing_or_cyclic_creator_lineage(
    native_task_store, monkeypatch, creator_task_id: str,
) -> None:
    from hermes_cli import kanban_db_connect as task_db_connect

    case = _claimed_worker_auth_case(native_task_store, monkeypatch)
    with task_db_connect.connect_closing(native_task_store) as connection:
        row = connection.execute(
            "SELECT id, payload FROM task_events WHERE task_id = ? AND kind = 'created'",
            (case["workerId"],),
        ).fetchone()
        payload = json.loads(row["payload"])
        payload["creator_task_id"] = (
            case["workerId"] if creator_task_id == "self" else creator_task_id
        )
        connection.execute(
            "UPDATE task_events SET payload = ? WHERE id = ?",
            (json.dumps(payload), row["id"]),
        )
        connection.commit()
    with pytest.raises(magentic_execution.MagenticExecutionError):
        magentic_execution.authenticate_magentic_worker_tool_request(
            _signed_worker_envelope(case["secret"], case["payload"]),
        )


def test_worker_tool_auth_rejects_tenant_discontinuity_inside_the_creator_chain(
    native_task_store, monkeypatch,
) -> None:
    from hermes_cli import kanban_db as task_db, kanban_db_connect as task_db_connect

    case = _claimed_worker_auth_case(native_task_store, monkeypatch)
    grandchild_secret = "dispatcher:grandchild:claim"
    with task_db_connect.connect_closing(native_task_store) as connection:
        middle_id = task_db.create_task(
            connection, title="Wrong-tenant middle", assignee="worker-a",
            created_by="worker-a", creator_task_id=case["workerId"],
            tenant="mag-one:another-run", initial_status="running",
        )
        grandchild_id = task_db.create_task(
            connection, title="Returned-tenant source", assignee="worker-a",
            created_by="worker-a", creator_task_id=middle_id,
            tenant="mag-one:run-one", initial_status="running",
        )
        claimed = task_db.claim_task(
            connection, grandchild_id, claimer=grandchild_secret,
        )
        assert claimed is not None and claimed.current_run_id is not None
        payload = {
            **case["payload"],
            "nonce": "d" * 32,
            "sourceTaskId": grandchild_id,
            "sourceTaskRunId": claimed.current_run_id,
        }
    with pytest.raises(magentic_execution.MagenticExecutionError):
        magentic_execution.authenticate_magentic_worker_tool_request(
            _signed_worker_envelope(grandchild_secret, payload),
        )


def test_worker_tool_auth_rejects_terminal_root_and_orchestrator_descendant(
    native_task_store, monkeypatch,
) -> None:
    from hermes_cli import kanban_db as task_db, kanban_db_connect as task_db_connect

    case = _claimed_worker_auth_case(native_task_store, monkeypatch)
    with task_db_connect.connect_closing(native_task_store) as connection:
        connection.execute(
            "UPDATE tasks SET status = 'done' WHERE id = ?", (case["rootId"],),
        )
        connection.commit()
    with pytest.raises(magentic_execution.MagenticExecutionError):
        magentic_execution.authenticate_magentic_worker_tool_request(
            _signed_worker_envelope(case["secret"], case["payload"]),
        )

    root_secret = "dispatcher:forbidden-orchestrator-child"
    with task_db_connect.connect_closing(native_task_store) as connection:
        connection.execute(
            "UPDATE tasks SET status = 'ready' WHERE id = ?", (case["rootId"],),
        )
        connection.commit()
        child_id = task_db.create_task(
            connection, title="Forbidden orchestrator child", assignee="card_magentic",
            created_by="card_magentic", creator_task_id=case["rootId"],
            tenant="mag-one:run-one", initial_status="running",
        )
        claimed = task_db.claim_task(connection, child_id, claimer=root_secret)
        assert claimed is not None and claimed.current_run_id is not None
        payload = {
            **case["payload"],
            "nonce": "e" * 32,
            "sourceTaskId": child_id,
            "sourceTaskRunId": claimed.current_run_id,
            "sourceProfile": "card_magentic",
        }
    with pytest.raises(magentic_execution.MagenticExecutionError):
        magentic_execution.authenticate_magentic_worker_tool_request(
            _signed_worker_envelope(root_secret, payload),
        )


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("version", 1),
        ("expiresAt", 1_999_999_999),
        ("expiresAt", 2_000_000_000),
        ("expiresAt", 2_000_000_301),
        ("nonce", "A" * 32),
        ("nonce", "a" * 31),
        ("sourceTaskId", "t_missing"),
        ("sourceTaskRunId", 0),
        ("sourceTaskRunId", 999_999),
        ("sourceProfile", "worker-b"),
        ("tool", " card__canvas_inspect"),
        ("arguments", []),
    ],
)
def test_worker_tool_auth_rejects_invalid_v2_payload_or_native_claim_identity(
    native_task_store, monkeypatch, field: str, value: Any,
) -> None:
    case = _claimed_worker_auth_case(native_task_store, monkeypatch)
    payload = {**case["payload"], field: value}
    with pytest.raises(
        magentic_execution.MagenticExecutionError,
        match="magentic_worker_tool_authentication_failed",
    ):
        magentic_execution.authenticate_magentic_worker_tool_request(
            _signed_worker_envelope(case["secret"], payload),
        )


def test_worker_tool_auth_rejects_noncanonical_envelopes_and_signatures(
    native_task_store, monkeypatch,
) -> None:
    case = _claimed_worker_auth_case(native_task_store, monkeypatch)
    valid = _signed_worker_envelope(case["secret"], case["payload"])
    invalid_envelopes = [
        {**valid, "extra": "not-allowed"},
        {**valid, "keyId": "0" * 64},
        {**valid, "signature": "0" * 64},
        {**valid, "keyId": valid["keyId"].upper()},
        {
            **valid,
            "payload": valid["payload"][:-1] + ',"tool":"duplicate"}',
        },
    ]
    for envelope in invalid_envelopes:
        with pytest.raises(
            magentic_execution.MagenticExecutionError,
            match="magentic_worker_tool_authentication_failed",
        ):
            magentic_execution.authenticate_magentic_worker_tool_request(envelope)


def test_worker_tool_auth_rejects_an_ended_claim_and_the_root_task_itself(
    native_task_store, monkeypatch,
) -> None:
    from hermes_cli import kanban_db as task_db, kanban_db_connect as task_db_connect

    case = _claimed_worker_auth_case(native_task_store, monkeypatch)
    envelope = _signed_worker_envelope(case["secret"], case["payload"])
    with task_db_connect.connect_closing(native_task_store) as connection:
        assert task_db.complete_task(
            connection,
            case["workerId"],
            summary="Finished.",
            expected_run_id=case["sourceRunId"],
        )
    with pytest.raises(magentic_execution.MagenticExecutionError):
        magentic_execution.authenticate_magentic_worker_tool_request(envelope)

    root_secret = "dispatcher:magnetic-root"
    with task_db_connect.connect_closing(native_task_store) as connection:
        root = task_db.claim_task(connection, case["rootId"], claimer=root_secret)
        assert root is not None
        root_payload = {
            **case["payload"],
            "sourceTaskId": case["rootId"],
            "sourceTaskRunId": root.current_run_id,
            "sourceProfile": "card_magentic",
        }
    with pytest.raises(magentic_execution.MagenticExecutionError):
        magentic_execution.authenticate_magentic_worker_tool_request(
            _signed_worker_envelope(root_secret, root_payload),
        )


def test_worker_tool_auth_rejects_a_mismatched_live_run_claim_or_widened_source_scope(
    native_task_store, monkeypatch,
) -> None:
    from hermes_cli import kanban_db_connect as task_db_connect

    case = _claimed_worker_auth_case(native_task_store, monkeypatch)
    envelope = _signed_worker_envelope(case["secret"], case["payload"])
    with task_db_connect.connect_closing(native_task_store) as connection:
        connection.execute(
            "UPDATE task_runs SET claim_lock = ? WHERE id = ?",
            ("different-live-claim", case["sourceRunId"]),
        )
        connection.commit()
    with pytest.raises(magentic_execution.MagenticExecutionError):
        magentic_execution.authenticate_magentic_worker_tool_request(envelope)

    case = _claimed_worker_auth_case(native_task_store, monkeypatch)
    envelope = _signed_worker_envelope(case["secret"], case["payload"])
    with task_db_connect.connect_closing(native_task_store) as connection:
        connection.execute(
            "UPDATE tasks SET allowed_assignees = ? WHERE id = ?",
            ('["worker-a","worker-b"]', case["workerId"]),
        )
        connection.commit()
    with pytest.raises(magentic_execution.MagenticExecutionError):
        magentic_execution.authenticate_magentic_worker_tool_request(envelope)


@pytest.mark.parametrize(
    "root_mutation",
    [
        ("tenant", "mag-one:another-run"),
        ("tenant", "unrelated:run-one"),
        ("allowed_assignees", '["card_magentic","worker-b"]'),
        ("assignee", "worker-a"),
    ],
)
def test_worker_tool_auth_rejects_wrong_native_lineage_authority(
    native_task_store, monkeypatch, root_mutation: tuple[str, str],
) -> None:
    from hermes_cli import kanban_db_connect as task_db_connect

    case = _claimed_worker_auth_case(native_task_store, monkeypatch)
    column, value = root_mutation
    assert column in {"tenant", "allowed_assignees", "assignee"}
    with task_db_connect.connect_closing(native_task_store) as connection:
        connection.execute(f"UPDATE tasks SET {column} = ? WHERE id = ?", (value, case["rootId"]))
        connection.commit()
    with pytest.raises(magentic_execution.MagenticExecutionError):
        magentic_execution.authenticate_magentic_worker_tool_request(
            _signed_worker_envelope(case["secret"], case["payload"]),
        )


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("run_id", "another-run"),
        ("state", "completed"),
        ("runtime_kind", "autogen"),
        ("runtime_mode", "delegate"),
        ("card_id", "card_builder"),
        ("runtime_profile", "builder"),
        ("provider_thread_ref", "t_wrong_root"),
        ("project_id", ""),
        ("deck_id", ""),
    ],
)
def test_worker_tool_auth_rejects_a_nonmatching_outer_run(
    native_task_store, monkeypatch, field: str, value: str,
) -> None:
    case = _claimed_worker_auth_case(native_task_store, monkeypatch)
    outer_run = {**case["outerRun"], field: value}
    monkeypatch.setattr(
        magentic_execution,
        "_read_outer_magentic_run",
        lambda _outer_run_id: outer_run,
    )
    with pytest.raises(magentic_execution.MagenticExecutionError):
        magentic_execution.authenticate_magentic_worker_tool_request(
            _signed_worker_envelope(case["secret"], case["payload"]),
        )


def test_worker_tool_auth_rejects_a_missing_outer_run(
    native_task_store, monkeypatch,
) -> None:
    case = _claimed_worker_auth_case(native_task_store, monkeypatch)
    monkeypatch.setattr(magentic_execution, "_read_outer_magentic_run", lambda _run_id: None)
    with pytest.raises(magentic_execution.MagenticExecutionError):
        magentic_execution.authenticate_magentic_worker_tool_request(
            _signed_worker_envelope(case["secret"], case["payload"]),
        )


def test_worker_tool_auth_route_returns_only_the_verified_proof(monkeypatch) -> None:
    from app import main as main_module

    proof = {
        "projectId": "project-one",
        "deckId": "deck-one",
        "outerRunId": "run-one",
        "nativeRootId": "t_root",
        "sourceTaskId": "t_worker",
        "sourceTaskRunId": 23,
        "sourceProfile": "worker-a",
        "authorityProfile": "worker-a",
        "authorityCardId": "worker-card-a",
        "authorityCardRevisionId": "worker-revision-a",
        "authorityConfigurationFingerprint": "a" * 64,
        "expiresAt": 2_000_000_300,
        "nonce": "a" * 32,
        "tool": "card__canvas_inspect",
        "arguments": {"depth": 1},
    }
    envelope = {"keyId": "1" * 64, "payload": "{}", "signature": "2" * 64}
    monkeypatch.setattr(
        main_module,
        "authenticate_magentic_worker_tool_request",
        lambda value: proof if value == envelope else None,
    )
    assert main_module.magentic_execution_worker_tool_auth(envelope) == proof

    def reject(_value):
        raise magentic_execution.MagenticExecutionError(
            "magentic_worker_tool_authentication_failed",
        )

    monkeypatch.setattr(main_module, "authenticate_magentic_worker_tool_request", reject)
    with pytest.raises(Exception) as caught:
        main_module.magentic_execution_worker_tool_auth(envelope)
    assert getattr(caught.value, "status_code", None) == 409
    assert getattr(caught.value, "detail", None) == "magentic_worker_tool_authentication_failed"


def test_same_root_waits_on_native_dependencies_then_returns_its_own_final_result(
    native_task_store, monkeypatch,
) -> None:
    from hermes_cli import kanban_db as task_db, kanban_db_connect as task_db_connect

    root_id = _submit_root(monkeypatch)
    with task_db_connect.connect_closing(native_task_store) as connection:
        first_attempt = task_db.claim_task(connection, root_id, claimer="dispatcher:first")
        assert first_attempt is not None
        first_run_id = first_attempt.current_run_id
        worker_a = task_db.create_task(
            connection,
            title="Worker A task",
            assignee="worker-a",
            created_by="card_magentic",
            creator_task_id=root_id,
            initial_status="running",
        )
        worker_b = task_db.create_task(
            connection,
            title="Worker B task",
            assignee="worker-b",
            created_by="card_magentic",
            creator_task_id=root_id,
            initial_status="running",
        )
        assert not task_db.link_tasks(connection, parent_id=worker_a, child_id=root_id)
        assert not task_db.link_tasks(connection, parent_id=worker_b, child_id=root_id)
        assert task_db.block_task(
            connection, root_id, reason="Waiting for the selected workers.",
            kind="dependency", expected_run_id=first_run_id,
        )
        assert task_db.get_task(connection, root_id).status == "todo"

    waiting = magentic_execution.read_magentic_execution({"nativeRootId": root_id})
    assert waiting["state"] == "running"
    assert waiting["nativeStatus"] == "todo"
    assert waiting["nativeRunId"] == first_run_id
    assert waiting["nativeTasks"] == [
        {
            "taskId": root_id,
            "title": "Mag One run-one",
            "assignee": "card_magentic",
            "status": "todo",
            "dependencyIds": sorted([worker_a, worker_b]),
            "latestAttempt": {
                "runId": first_run_id,
                "status": "blocked",
                "startedAt": waiting["nativeTasks"][0]["latestAttempt"]["startedAt"],
                "endedAt": waiting["nativeTasks"][0]["latestAttempt"]["endedAt"],
            },
            "resultAvailable": True,
            "workerSessionId": None,
            "handoffSummary": "Waiting for the selected workers.",
            "toolReceipts": [],
            "toolReceiptsComplete": False,
        },
        {
            "taskId": worker_a,
            "title": "Worker A task",
            "assignee": "worker-a",
            "status": "ready",
            "dependencyIds": [],
            "latestAttempt": None,
            "resultAvailable": False,
            "workerSessionId": None,
            "handoffSummary": None,
            "toolReceipts": [],
            "toolReceiptsComplete": False,
        },
        {
            "taskId": worker_b,
            "title": "Worker B task",
            "assignee": "worker-b",
            "status": "ready",
            "dependencyIds": [],
            "latestAttempt": None,
            "resultAvailable": False,
            "workerSessionId": None,
            "handoffSummary": None,
            "toolReceipts": [],
            "toolReceiptsComplete": False,
        },
    ]

    with task_db_connect.connect_closing(native_task_store) as connection:
        assert task_db.complete_task(
            connection, worker_a, summary="Worker A result", result="Worker A result",
        )
        assert task_db.get_task(connection, root_id).status == "todo"
        assert task_db.complete_task(
            connection, worker_b, summary="Worker B result", result="Worker B result",
        )
        assert task_db.get_task(connection, root_id).status == "ready"
        second_attempt = task_db.claim_task(connection, root_id, claimer="dispatcher:second")
        assert second_attempt is not None
        second_run_id = second_attempt.current_run_id
        context = task_db.build_worker_context(connection, root_id)
        assert "Worker A result" in context
        assert "Worker B result" in context
        assert task_db.complete_task(
            connection, root_id, summary="The real synthesized answer.",
            result="The real synthesized answer.",
            expected_run_id=second_run_id,
        )

    status = magentic_execution.read_magentic_execution({"nativeRootId": root_id})
    assert status["state"] == "completed"
    assert status["nativeStatus"] == "done"
    assert status["nativeRootId"] == root_id
    assert status["nativeRunId"] == second_run_id
    assert status["finalResult"] == "The real synthesized answer."
    assert status["effectiveProvider"] == "openai-codex"
    assert status["model"] == "gpt-5.6-sol"
    assert status["nativeTasks"][0] == {
        "taskId": root_id,
        "title": "Mag One run-one",
        "assignee": "card_magentic",
        "status": "done",
        "dependencyIds": sorted([worker_a, worker_b]),
        "latestAttempt": {
            "runId": second_run_id,
            "status": "done",
            "startedAt": status["nativeTasks"][0]["latestAttempt"]["startedAt"],
            "endedAt": status["nativeTasks"][0]["latestAttempt"]["endedAt"],
        },
        "resultAvailable": True,
        "workerSessionId": None,
        "handoffSummary": "The real synthesized answer.",
        "toolReceipts": [],
        "toolReceiptsComplete": False,
    }
    assert [task["resultAvailable"] for task in status["nativeTasks"]] == [True, True, True]
    assert "finalTaskId" not in status
    assert "tasksTotal" not in status
    assert "tasksCompleted" not in status
    assert "activeWorkers" not in status


def test_status_projects_only_the_correlated_redacted_worker_tool_receipts(
    native_task_store, tmp_path, monkeypatch,
) -> None:
    from hermes_cli import kanban_db as task_db, kanban_db_connect as task_db_connect
    from hermes_state import SessionDB

    root_id = _submit_root(monkeypatch)
    hermes_root = tmp_path / "Hermes"
    hermes_home = hermes_root / ".hermes"
    profile_home = hermes_home / "profiles" / "worker-a"
    profile_home.mkdir(parents=True)
    plugin_home = profile_home / "plugins" / "card-tools"
    plugin_home.mkdir(parents=True)
    (plugin_home / "tools.json").write_text(json.dumps({"tools": [{
        "canonicalName": "saved_card.read",
        "hermesName": "card__saved_card_read",
    }]}), encoding="utf-8")
    session_id = "worker-session-one"
    session_db = SessionDB(db_path=profile_home / "state.db")
    try:
        session_db.create_session(session_id, "kanban", profile_name="worker-a")
        session_db.append_message(
            session_id,
            "assistant",
            None,
            tool_calls=[{
                "id": "codex_dyn_saved_card_read_call-one",
                "type": "function",
                "function": {
                    "name": "card__saved_card_read",
                    "arguments": '{"query":"bounded"}',
                },
            }],
        )
        session_db.append_message(
            session_id,
            "tool",
            json.dumps([
                {
                    "type": "inputText",
                    "text": (
                        "OPENAI_API_KEY=sk-proj-abcdef1234567890abcdef1234567890abcdef12 "
                        "Found evidence. " + "r" * 1_100
                    ),
                },
                {
                    "type": "inputText",
                    "text": json.dumps({
                        "executionReceipt": {
                            "schema": "agent-runtime.execution-receipt.v1",
                            "tool": "saved_card.read",
                            "correlationId": "mcp:receipt-one",
                            "operationPhase": "dispatch",
                            "local": True,
                            "state": "completed",
                        },
                    }),
                },
            ]),
            tool_call_id="codex_dyn_saved_card_read_call-one",
        )
    finally:
        session_db.close()

    with task_db_connect.connect_closing(native_task_store) as connection:
        worker_id = task_db.create_task(
            connection,
            title="Worker receipt task",
            assignee="worker-a",
            created_by="card_magentic",
            creator_task_id=root_id,
            initial_status="running",
        )
        claimed = task_db.claim_task(connection, worker_id, claimer="dispatcher:worker-a")
        assert claimed is not None
        assert task_db.complete_task(
            connection,
            worker_id,
            summary=("Worker used the saved Card result. " + "x" * 2_100),
            expected_run_id=claimed.current_run_id,
            metadata={"worker_session_id": session_id},
        )

    monkeypatch.setattr(
        magentic_execution,
        "_runtime_paths",
        lambda: (hermes_root, hermes_home),
    )
    status = magentic_execution.read_magentic_execution({"nativeRootId": root_id})
    worker = next(task for task in status["nativeTasks"] if task["taskId"] == worker_id)

    assert worker["workerSessionId"] == session_id
    assert len(worker["handoffSummary"]) == 2_000
    assert worker["handoffSummary"].endswith("…")
    assert worker["toolReceiptsComplete"] is True
    assert worker["toolReceipts"] == [{
        "toolCallId": "codex_dyn_saved_card_read_call-one",
        "toolName": "card__saved_card_read",
        "state": "returned",
        "resultPreview": worker["toolReceipts"][0]["resultPreview"],
        "executionReceipt": {
            "schema": "agent-runtime.execution-receipt.v1",
            "tool": "saved_card.read",
            "correlationId": "mcp:receipt-one",
            "state": "completed",
        },
    }]
    assert len(worker["toolReceipts"][0]["resultPreview"]) == 1_000
    assert worker["toolReceipts"][0]["resultPreview"].endswith("…")
    assert "Found evidence." in worker["toolReceipts"][0]["resultPreview"]
    assert "sk-proj-abcdef1234567890abcdef1234567890abcdef12" not in (
        worker["toolReceipts"][0]["resultPreview"]
    )
    assert {receipt["toolName"] for receipt in worker["toolReceipts"]}.isdisjoint({
        "exec_command", "apply_patch",
    })


@pytest.mark.parametrize(
    "content",
    [
        json.dumps({"executionReceipt": {
            "schema": "agent-runtime.execution-receipt.v1",
            "tool": "another.tool",
            "correlationId": "mcp:mismatch",
            "state": "completed",
        }}),
        json.dumps([
            {"executionReceipt": {
                "schema": "agent-runtime.execution-receipt.v1",
                "tool": "saved_card.read",
                "correlationId": "mcp:one",
                "state": "completed",
            }},
            {"executionReceipt": {
                "schema": "agent-runtime.execution-receipt.v1",
                "tool": "saved_card.read",
                "correlationId": "mcp:two",
                "state": "completed",
            }},
        ]),
        json.dumps({"executionReceipt": {
            "schema": "wrong-schema",
            "tool": "saved_card.read",
            "correlationId": "",
            "state": "invented",
        }}),
    ],
)
def test_execution_receipt_parser_fails_closed_on_mismatch_duplicate_or_malformed_evidence(
    content: str,
) -> None:
    receipt, complete = magentic_execution._execution_receipt_from_tool_result(
        content, "saved_card.read",
    )
    assert receipt is None
    assert complete is False


def test_worker_receipt_parser_accepts_the_production_newline_delimited_card_output(
    tmp_path, monkeypatch,
) -> None:
    from hermes_state import SessionDB

    hermes_root = tmp_path / "Hermes"
    hermes_home = hermes_root / ".hermes"
    profile_home = hermes_home / "profiles" / "worker-a"
    profile_home.mkdir(parents=True)
    plugin_home = profile_home / "plugins" / "card-tools"
    plugin_home.mkdir(parents=True)
    (plugin_home / "tools.json").write_text(json.dumps({"tools": [{
        "canonicalName": "saved_card.read",
        "hermesName": "card__saved_card_read",
    }]}), encoding="utf-8")
    session_id = "worker-session-newline-output"
    call_id = "codex_dyn_saved_card_read_newline"
    session_db = SessionDB(db_path=profile_home / "state.db")
    try:
        session_db.create_session(session_id, "kanban", profile_name="worker-a")
        session_db.append_message(
            session_id,
            "assistant",
            None,
            tool_calls=[{
                "id": call_id,
                "type": "function",
                "function": {
                    "name": "card__saved_card_read",
                    "arguments": '{"query":"bounded"}',
                },
            }],
        )
        session_db.append_message(
            session_id,
            "tool",
            "\n".join([
                json.dumps({"ok": True, "cardId": "saved-card-one"}),
                json.dumps({
                    "executionReceipt": {
                        "schema": "agent-runtime.execution-receipt.v1",
                        "tool": "saved_card.read",
                        "correlationId": "mcp:newline-receipt",
                        "state": "completed",
                    },
                }),
            ]),
            tool_call_id=call_id,
        )
    finally:
        session_db.close()

    monkeypatch.setattr(
        magentic_execution,
        "_runtime_paths",
        lambda: (hermes_root, hermes_home),
    )
    receipts, complete = magentic_execution._worker_tool_receipts(
        "worker-a", session_id,
    )

    assert complete is True
    assert receipts[0]["toolCallId"] == call_id
    assert receipts[0]["toolName"] == "card__saved_card_read"
    assert receipts[0]["state"] == "returned"
    assert receipts[0]["executionReceipt"] == {
        "schema": "agent-runtime.execution-receipt.v1",
        "tool": "saved_card.read",
        "correlationId": "mcp:newline-receipt",
        "state": "completed",
    }


def test_unpaired_tool_call_preserves_the_nullable_execution_receipt_shape(
    tmp_path, monkeypatch,
) -> None:
    from hermes_state import SessionDB

    hermes_root = tmp_path / "Hermes"
    hermes_home = hermes_root / ".hermes"
    profile_home = hermes_home / "profiles" / "worker-a"
    profile_home.mkdir(parents=True)
    plugin_home = profile_home / "plugins" / "card-tools"
    plugin_home.mkdir(parents=True)
    (plugin_home / "tools.json").write_text(json.dumps({"tools": [{
        "canonicalName": "saved_card.read",
        "hermesName": "card__saved_card_read",
    }]}), encoding="utf-8")
    session_id = "worker-session-unpaired"
    session_db = SessionDB(db_path=profile_home / "state.db")
    try:
        session_db.create_session(session_id, "kanban", profile_name="worker-a")
        session_db.append_message(
            session_id,
            "assistant",
            None,
            tool_calls=[{
                "id": "codex_dyn_saved_card_read_unpaired",
                "type": "function",
                "function": {
                    "name": "card__saved_card_read",
                    "arguments": '{"query":"bounded"}',
                },
            }],
        )
    finally:
        session_db.close()

    monkeypatch.setattr(
        magentic_execution,
        "_runtime_paths",
        lambda: (hermes_root, hermes_home),
    )
    receipts, complete = magentic_execution._worker_tool_receipts(
        "worker-a", session_id,
    )

    assert receipts == [{
        "toolCallId": "codex_dyn_saved_card_read_unpaired",
        "toolName": "card__saved_card_read",
        "state": None,
        "resultPreview": "",
        "executionReceipt": None,
    }]
    assert complete is False


def test_status_fails_closed_on_malformed_worker_session_metadata(
    native_task_store, monkeypatch,
) -> None:
    from hermes_cli import kanban_db as task_db, kanban_db_connect as task_db_connect

    root_id = _submit_root(monkeypatch)
    with task_db_connect.connect_closing(native_task_store) as connection:
        worker_id = task_db.create_task(
            connection,
            title="Malformed receipt metadata",
            assignee="worker-a",
            created_by="card_magentic",
            creator_task_id=root_id,
            initial_status="running",
        )
        claimed = task_db.claim_task(connection, worker_id, claimer="dispatcher:worker-a")
        assert claimed is not None
        assert task_db.complete_task(
            connection,
            worker_id,
            summary="Bounded handoff.",
            expected_run_id=claimed.current_run_id,
            metadata={"worker_session_id": 7},
        )

    status = magentic_execution.read_magentic_execution({"nativeRootId": root_id})
    worker = next(task for task in status["nativeTasks"] if task["taskId"] == worker_id)
    assert worker["workerSessionId"] is None
    assert worker["handoffSummary"] == "Bounded handoff."
    assert worker["toolReceipts"] == []
    assert worker["toolReceiptsComplete"] is False


def test_completed_root_without_its_own_result_fails_closed(
    native_task_store, monkeypatch,
) -> None:
    from hermes_cli import kanban_db as task_db, kanban_db_connect as task_db_connect

    root_id = _submit_root(monkeypatch)
    with task_db_connect.connect_closing(native_task_store) as connection:
        assert task_db.complete_task(connection, root_id)

    status = magentic_execution.read_magentic_execution({"nativeRootId": root_id})
    assert status["state"] == "failed"
    assert status["nativeStatus"] == "done"
    assert status["error"] == "magentic_final_result_missing"


def test_native_allowed_assignees_reject_an_unwired_profile(
    native_task_store, monkeypatch,
) -> None:
    from hermes_cli import kanban_db as task_db, kanban_db_connect as task_db_connect

    root_id = _submit_root(monkeypatch)
    with task_db_connect.connect_closing(native_task_store) as connection:
        with pytest.raises(ValueError, match="outside this execution's allowed assignees"):
            task_db.create_task(
                connection, title="Ungrantable task", assignee="worker-c",
                created_by="card_magentic", creator_task_id=root_id,
                initial_status="running",
            )


def test_stop_archives_only_the_exact_execution_creator_tree(
    native_task_store, monkeypatch,
) -> None:
    from hermes_cli import kanban_db as task_db, kanban_db_connect as task_db_connect

    root_id = _submit_root(monkeypatch)
    with task_db_connect.connect_closing(native_task_store) as connection:
        child_id = task_db.create_task(
            connection, title="Worker task", assignee="worker-a", creator_task_id=root_id,
        )
        nested_id = task_db.create_task(
            connection, title="Nested task", assignee="worker-a", creator_task_id=child_id,
        )
        unrelated_id = task_db.create_task(
            connection, title="Unrelated native task", assignee="unrelated",
        )

    stopped = magentic_execution.stop_magentic_execution({"nativeRootId": root_id})
    assert stopped == {
        "ok": True,
        "nativeRootId": root_id,
        "state": "cancelled",
        "nativeStatus": "archived",
    }
    with task_db_connect.connect_closing(native_task_store) as connection:
        assert task_db.get_task(connection, root_id).status == "archived"
        assert task_db.get_task(connection, child_id).status == "archived"
        assert task_db.get_task(connection, nested_id).status == "archived"
        assert task_db.get_task(connection, unrelated_id).status == "ready"


def test_status_and_stop_resolve_the_task_store_before_importing_hermes(
    native_task_store, monkeypatch,
) -> None:
    root_id = _submit_root(monkeypatch)
    original_import = builtins.__import__
    path_resolved = False

    def cold_task_path():
        nonlocal path_resolved
        path_resolved = True
        return native_task_store

    def guarded_import(name, *args, **kwargs):
        if name == "hermes_cli" or name.startswith("hermes_cli."):
            assert path_resolved, f"Hermes import preceded task-store resolution: {name}"
        return original_import(name, *args, **kwargs)

    monkeypatch.setattr(magentic_execution, "_task_db_path", cold_task_path)
    monkeypatch.setattr(builtins, "__import__", guarded_import)

    status = magentic_execution.read_magentic_execution({"nativeRootId": root_id})
    assert status["nativeRootId"] == root_id
    assert len(status["nativeTasks"]) == 1

    path_resolved = False
    stopped = magentic_execution.stop_magentic_execution({"nativeRootId": root_id})
    assert stopped["state"] == "cancelled"
