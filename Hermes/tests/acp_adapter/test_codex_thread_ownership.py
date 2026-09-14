"""Focused saved-Card ownership proof for native Codex App Server threads."""

from __future__ import annotations

import json
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace

import pytest

from acp_adapter.host_profiles import (
    bind_codex_thread_owner,
    ensure_cli_codex_thread_owner,
)
from acp_adapter.session import SessionManager
from agent.transports.codex_app_server_session import CodexAppServerSession
from hermes_state import SessionDB


class _Client:
    def __init__(
        self,
        *,
        start_error: BaseException | None = None,
        resume_error: BaseException | None = None,
        notifications: list[dict] | None = None,
    ) -> None:
        self.requests: list[tuple[str, dict]] = []
        self.start_error = start_error
        self.resume_error = resume_error
        self.notifications = list(notifications or [])
        self.closed = False

    def initialize(self, **_kwargs):
        return {}

    def request(self, method: str, params: dict | None = None, timeout: float = 30):
        del timeout
        self.requests.append((method, dict(params or {})))
        if method == "thread/start":
            if self.start_error is not None:
                raise self.start_error
            return {"thread": {"id": "thread-owned-001"}}
        if method == "thread/resume":
            if self.resume_error is not None:
                raise self.resume_error
            return {"thread": {"id": (params or {})["threadId"]}}
        if method == "turn/start":
            return {"turn": {"id": "turn-owned-001"}}
        return {}

    def close(self):
        self.closed = True

    def is_alive(self) -> bool:
        return not self.closed

    def stderr_tail(self, _count: int = 20):
        return []

    def take_notification(self, timeout: float = 0):
        del timeout
        return self.notifications.pop(0) if self.notifications else None

    def take_server_request(self, timeout: float = 0):
        del timeout
        return None


def _authority(tmp_path, *, fingerprint: str = "a" * 64) -> dict:
    cwd = str(tmp_path)
    return {
        "enabledToolsets": [],
        "enabledTools": [],
        "executionContextId": "context-1",
        "hostSessionKey": "project:conversation:card",
        "systemPrompt": "Saved Card prompt",
        "toolCallMeta": {},
        "hostScript": None,
        "delegationRoles": [],
        "profileTargets": [],
        "projectId": "project-1",
        "deckId": "deck-1",
        "cardId": "card-1",
        "cardRevisionId": "revision-1",
        "cardRevisionSha256": "b" * 64,
        "runtimeProfile": "card-profile",
        "executionAuthorityFingerprint": fingerprint,
        "savedProvider": "openai",
        "accessMode": "chatgpt-account",
        "effectiveProvider": "openai-codex",
        "model": "gpt-5.6-sol",
        "providerApiMode": "codex_app_server",
        "openaiRuntime": "codex_app_server",
        "workingDirectory": cwd,
    }


def _agent() -> SimpleNamespace:
    return SimpleNamespace(model="gpt-5.6-sol", provider="openai-codex")


def _config(db: SessionDB, session_id: str) -> dict:
    row = db.get_session(session_id)
    assert row is not None
    raw = row["model_config"]
    return dict(raw if isinstance(raw, dict) else json.loads(raw or "{}"))


def _initialize(db: SessionDB, session_id: str, authority: dict) -> SimpleNamespace:
    db.create_session(
        session_id,
        source="acp",
        model="gpt-5.6-sol",
        model_config={"cwd": authority["workingDirectory"]},
    )
    assert db.transition_codex_thread_state(
        session_id,
        session_key=authority["hostSessionKey"],
        authority_fingerprint=authority["executionAuthorityFingerprint"],
        expected_state=None,
        next_state="never_started",
        expected_source="acp",
        working_directory=authority["workingDirectory"],
    )
    agent = _agent()
    bind_codex_thread_owner(
        agent,
        session_db=db,
        session_id=session_id,
        config=authority,
    )
    return agent


def _session(client: _Client, agent: SimpleNamespace, authority: dict) -> CodexAppServerSession:
    return CodexAppServerSession(
        cwd=authority["workingDirectory"],
        client_factory=lambda **_kwargs: client,
        model=authority["model"],
        trusted_host_authority=True,
        resume_thread_id=getattr(agent, "_codex_thread_id", None),
        project_id=authority["projectId"],
        model_provider="openai",
        on_thread_starting=agent._claim_codex_thread_start,
        on_thread_ready=agent._persist_codex_thread,
    )


def test_first_turn_starts_once_and_next_session_resumes_exact_thread(tmp_path) -> None:
    db = SessionDB(tmp_path / "state.db")
    authority = _authority(tmp_path)
    agent = _initialize(db, "session-1", authority)

    first_client = _Client()
    first = _session(first_client, agent, authority)
    assert first.ensure_started() == "thread-owned-001"
    assert first.ensure_started() == "thread-owned-001"
    assert [method for method, _ in first_client.requests] == ["thread/start"]
    assert _config(db, "session-1")["codex_thread_state"] == "established"

    resumed_client = _Client()
    resumed = _session(resumed_client, agent, authority)
    assert resumed.ensure_started() == "thread-owned-001"
    assert [method for method, _ in resumed_client.requests] == ["thread/resume"]
    assert resumed_client.requests[0][1]["threadId"] == "thread-owned-001"


def test_restart_restores_exact_thread_and_callbacks(tmp_path) -> None:
    db = SessionDB(tmp_path / "state.db")
    authority = _authority(tmp_path)
    first_manager = SessionManager(agent_factory=_agent, db=db)
    state = first_manager.create_session(
        cwd=authority["workingDirectory"], host_config=authority
    )
    state.agent._claim_codex_thread_start()
    state.agent._persist_codex_thread("thread-owned-001")

    second_manager = SessionManager(agent_factory=_agent, db=db)
    restored = second_manager.get_session(state.session_id, host_config=authority)
    assert restored is not None
    assert restored.agent._codex_thread_id == "thread-owned-001"
    assert restored.agent._codex_thread_authority == authority[
        "executionAuthorityFingerprint"
    ]
    client = _Client()
    assert _session(client, restored.agent, authority).ensure_started() == "thread-owned-001"
    assert [method for method, _ in client.requests] == ["thread/resume"]


def test_resume_failure_never_starts_a_replacement_thread(tmp_path) -> None:
    db = SessionDB(tmp_path / "state.db")
    authority = _authority(tmp_path)
    agent = _initialize(db, "session-1", authority)
    agent._claim_codex_thread_start()
    agent._persist_codex_thread("thread-owned-001")
    client = _Client(resume_error=RuntimeError("native lookup failed"))

    turn = _session(client, agent, authority).run_turn("read only", turn_timeout=0.1)

    assert turn.error and "native lookup failed" in turn.error
    assert [method for method, _ in client.requests] == ["thread/resume"]
    assert _config(db, "session-1")["codex_thread_state"] == "established"
    assert _config(db, "session-1")["codex_thread_id"] == "thread-owned-001"


def test_store_enumeration_failure_fails_closed(tmp_path) -> None:
    authority = _authority(tmp_path)

    class BrokenStore:
        def get_session(self, _session_id):
            raise OSError("storage unavailable")

    with pytest.raises(OSError, match="storage unavailable"):
        bind_codex_thread_owner(
            _agent(),
            session_db=BrokenStore(),
            session_id="session-1",
            config=authority,
        )


def test_established_state_without_id_fails_closed(tmp_path) -> None:
    db = SessionDB(tmp_path / "state.db")
    authority = _authority(tmp_path)
    agent = _initialize(db, "session-1", authority)
    agent._claim_codex_thread_start()
    agent._persist_codex_thread("thread-owned-001")
    db.patch_session_model_config("session-1", {"codex_thread_id": None})

    with pytest.raises(RuntimeError, match="hermes_host_codex_thread_id_missing"):
        bind_codex_thread_owner(
            _agent(), session_db=db, session_id="session-1", config=authority
        )


def test_authority_mismatch_rejects_resume_without_overwrite(tmp_path) -> None:
    db = SessionDB(tmp_path / "state.db")
    authority = _authority(tmp_path)
    agent = _initialize(db, "session-1", authority)
    agent._claim_codex_thread_start()
    agent._persist_codex_thread("thread-owned-001")

    changed = _authority(tmp_path, fingerprint="c" * 64)
    with pytest.raises(RuntimeError, match="hermes_host_codex_thread_authority_mismatch"):
        bind_codex_thread_owner(
            _agent(), session_db=db, session_id="session-1", config=changed
        )
    assert _config(db, "session-1")["codex_thread_id"] == "thread-owned-001"


def test_working_directory_mismatch_rejects_resume(tmp_path) -> None:
    db = SessionDB(tmp_path / "state.db")
    authority = _authority(tmp_path)
    agent = _initialize(db, "session-1", authority)
    agent._claim_codex_thread_start()
    agent._persist_codex_thread("thread-owned-001")

    changed = dict(authority)
    changed["workingDirectory"] = str(tmp_path / "other")
    with pytest.raises(RuntimeError, match="hermes_host_working_directory_mismatch"):
        bind_codex_thread_owner(
            _agent(), session_db=db, session_id="session-1", config=changed
        )


def test_cli_legacy_transcript_and_marker_initialization_are_atomic(tmp_path) -> None:
    db = SessionDB(tmp_path / "state.db")
    authority = _authority(tmp_path)
    db.create_session(
        "session-1",
        source="cli",
        model="gpt-5.6-sol",
        model_config={"cwd": authority["workingDirectory"]},
    )
    db.append_message("session-1", role="user", content="legacy turn")
    agent = _agent()
    agent._session_db = db
    agent.session_id = "session-1"

    with pytest.raises(
        RuntimeError, match="hermes_host_codex_thread_legacy_state_ambiguous"
    ):
        ensure_cli_codex_thread_owner(agent, authority)
    assert "codex_thread_state" not in _config(db, "session-1")


def test_fresh_cli_session_row_is_initialized_with_cwd_and_bound(tmp_path) -> None:
    db = SessionDB(tmp_path / "state.db")
    authority = _authority(tmp_path)
    agent = _agent()
    agent._session_db = db
    agent.session_id = "session-1"

    assert ensure_cli_codex_thread_owner(agent, authority) == ("never_started", None)
    row = db.get_session("session-1")
    assert row is not None and row["source"] == "cli"
    assert _config(db, "session-1")["cwd"] == authority["workingDirectory"]
    assert _config(db, "session-1")["codex_thread_state"] == "never_started"


def test_ambiguous_start_stays_indeterminate_and_never_starts_replacement(tmp_path) -> None:
    db = SessionDB(tmp_path / "state.db")
    authority = _authority(tmp_path)
    agent = _initialize(db, "session-1", authority)
    client = _Client(start_error=TimeoutError("response lost"))
    turn = _session(client, agent, authority).run_turn("read only", turn_timeout=0.1)

    assert turn.error and "response lost" in turn.error
    assert [method for method, _ in client.requests] == ["thread/start"]
    assert _config(db, "session-1")["codex_thread_state"] == "indeterminate"
    with pytest.raises(RuntimeError, match="hermes_host_codex_thread_start_indeterminate"):
        bind_codex_thread_owner(
            _agent(), session_db=db, session_id="session-1", config=authority
        )


def test_observed_start_with_failed_persistence_is_not_canonical(tmp_path) -> None:
    db = SessionDB(tmp_path / "state.db")
    authority = _authority(tmp_path)
    agent = _initialize(db, "session-1", authority)
    client = _Client()

    def reject_persistence(_thread_id: str) -> None:
        raise RuntimeError("local commit failed")

    session = CodexAppServerSession(
        cwd=authority["workingDirectory"],
        client_factory=lambda **_kwargs: client,
        model=authority["model"],
        trusted_host_authority=True,
        project_id=authority["projectId"],
        model_provider="openai",
        on_thread_starting=agent._claim_codex_thread_start,
        on_thread_ready=reject_persistence,
    )
    turn = session.run_turn("read only", turn_timeout=0.1)

    assert turn.error and "local commit failed" in turn.error
    assert turn.thread_id is None
    assert turn.observed_thread_id == "thread-owned-001"
    assert _config(db, "session-1")["codex_thread_state"] == "indeterminate"
    assert [method for method, _ in client.requests] == ["thread/start"]
    with pytest.raises(RuntimeError, match="hermes_host_codex_thread_start_indeterminate"):
        bind_codex_thread_owner(
            _agent(), session_db=db, session_id="session-1", config=authority
        )


def test_trusted_turn_requires_native_terminal_completion(tmp_path) -> None:
    db = SessionDB(tmp_path / "state.db")
    authority = _authority(tmp_path)
    agent = _initialize(db, "session-1", authority)
    client = _Client(notifications=[{
        "method": "item/completed",
        "params": {
            "threadId": "thread-owned-001",
            "turnId": "turn-owned-001",
            "item": {"type": "agentMessage", "id": "message-1", "text": "draft"},
        },
    }])
    turn = _session(client, agent, authority).run_turn(
        "read only", turn_timeout=0.01, notification_poll_timeout=0.001
    )

    assert turn.final_text == "draft"
    assert turn.interrupted is True
    assert turn.error and "turn timed out" in turn.error
    assert turn.should_retire is True


def test_concurrent_first_requests_cannot_create_duplicate_threads(tmp_path) -> None:
    db = SessionDB(tmp_path / "state.db")
    authority = _authority(tmp_path)
    first_agent = _initialize(db, "session-1", authority)
    second_agent = _agent()
    bind_codex_thread_owner(
        second_agent, session_db=db, session_id="session-1", config=authority
    )
    clients = [_Client(), _Client()]
    sessions = [
        _session(clients[0], first_agent, authority),
        _session(clients[1], second_agent, authority),
    ]

    def attempt(session: CodexAppServerSession) -> str:
        try:
            return session.ensure_started()
        except RuntimeError as exc:
            return str(exc)

    with ThreadPoolExecutor(max_workers=2) as executor:
        outcomes = list(executor.map(attempt, sessions))

    assert outcomes.count("thread-owned-001") == 1
    assert outcomes.count("hermes_host_codex_thread_start_claim_rejected") == 1
    assert sum(
        method == "thread/start"
        for client in clients
        for method, _ in client.requests
    ) == 1
