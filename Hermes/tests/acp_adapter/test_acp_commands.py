import sys
import asyncio
import os
import threading
from types import ModuleType, SimpleNamespace

import pytest
from acp.schema import TextContentBlock

from acp_adapter.server import HermesACPAgent
from acp_adapter.session import SessionManager


class FakeAgent:
    def __init__(self):
        self.model = "fake-model"
        self.provider = "fake-provider"
        self.enabled_toolsets = ["hermes-acp"]
        self.disabled_toolsets = []
        self.tools = []
        self.valid_tool_names = set()
        self._supports_active_turn_redirect = True
        self.steers = []
        self.redirects = []
        self.runs = []

    def steer(self, text):
        self.steers.append(text)
        return True

    def redirect(self, text):
        self.redirects.append(text)
        return True

    def run_conversation(self, *, user_message, conversation_history, task_id, **kwargs):
        self.runs.append(user_message)
        messages = list(conversation_history or [])
        messages.append({"role": "user", "content": user_message})
        final = f"ran: {user_message}"
        messages.append({"role": "assistant", "content": final})
        return {"final_response": final, "messages": messages}


class CaptureConn:
    def __init__(self):
        self.updates = []

    async def session_update(self, *args, **kwargs):
        if kwargs:
            self.updates.append((kwargs.get("session_id"), kwargs.get("update")))
        else:
            self.updates.append((args[0], args[1]))

    async def request_permission(self, *args, **kwargs):
        return SimpleNamespace(outcome="allow")


class NoopDb:
    def get_session(self, *_args, **_kwargs):
        return None

    def create_session(self, *_args, **_kwargs):
        return None

    def update_session(self, *_args, **_kwargs):
        return None


def make_agent_and_state():
    fake = FakeAgent()
    manager = SessionManager(agent_factory=lambda **kwargs: fake, db=NoopDb())
    acp_agent = HermesACPAgent(session_manager=manager)
    state = manager.create_session(cwd=".")
    conn = CaptureConn()
    acp_agent.on_connect(conn)
    return acp_agent, state, fake, conn


def test_acp_real_agent_gets_session_db_for_recall(monkeypatch):
    """ACP sessions persist to SessionDB; recall must receive the same DB handle."""
    captured = {}
    sentinel_db = NoopDb()

    class CapturingAgent(FakeAgent):
        def __init__(self, **kwargs):
            super().__init__()
            captured.update(kwargs)

    def mod(name, **attrs):
        module = ModuleType(name)
        for key, value in attrs.items():
            setattr(module, key, value)
        return module

    monkeypatch.setitem(sys.modules, "run_agent", mod("run_agent", AIAgent=CapturingAgent))
    monkeypatch.setitem(
        sys.modules,
        "hermes_cli.config",
        mod("hermes_cli.config", load_config=lambda: {"model": {"default": "m", "provider": "p"}}),
    )
    monkeypatch.setitem(
        sys.modules,
        "hermes_cli.runtime_provider",
        mod(
            "hermes_cli.runtime_provider",
            resolve_runtime_provider=lambda **_kwargs: {
                "provider": "p",
                "api_mode": "chat_completions",
                "base_url": "u",
                "api_key": "k",
                "command": None,
                "args": [],
            },
        ),
    )

    manager = SessionManager(db=sentinel_db)
    agent = manager._make_agent(session_id="acp-session", cwd=".")

    assert isinstance(agent, CapturingAgent)
    assert captured["session_db"] is sentinel_db
    assert captured["platform"] == "acp"
    assert captured["session_id"] == "acp-session"


@pytest.mark.asyncio
async def test_acp_steer_slash_command_injects_into_running_agent():
    acp_agent, state, fake, _conn = make_agent_and_state()
    state.is_running = True

    response = await acp_agent.prompt(
        session_id=state.session_id,
        prompt=[TextContentBlock(type="text", text="/steer prefer the simpler fix")],
    )

    assert response.stop_reason == "end_turn"
    assert fake.steers == ["prefer the simpler fix"]
    assert fake.runs == []


@pytest.mark.asyncio
async def test_one_acp_process_isolates_two_concurrent_native_session_contexts(monkeypatch):
    barrier = threading.Barrier(2)
    observations = []

    class ConcurrentAgent(FakeAgent):
        def run_conversation(self, *, user_message, conversation_history, task_id, **kwargs):
            from gateway.session_context import get_session_env

            barrier.wait(timeout=5)
            observations.append((
                task_id,
                get_session_env("HERMES_SESSION_ID"),
                os.environ.get("HERMES_SESSION_ID"),
            ))
            return super().run_conversation(
                user_message=user_message,
                conversation_history=conversation_history,
                task_id=task_id,
                **kwargs,
            )

    monkeypatch.setenv("HERMES_SESSION_ID", "process-sentinel")
    manager = SessionManager(agent_factory=ConcurrentAgent, db=NoopDb())
    acp_agent = HermesACPAgent(session_manager=manager)
    acp_agent.on_connect(CaptureConn())
    left = manager.create_session(cwd=".")
    right = manager.create_session(cwd=".")

    await asyncio.gather(
        acp_agent.prompt(
            session_id=left.session_id,
            prompt=[TextContentBlock(type="text", text="left")],
        ),
        acp_agent.prompt(
            session_id=right.session_id,
            prompt=[TextContentBlock(type="text", text="right")],
        ),
    )

    assert {item[0] for item in observations} == {left.session_id, right.session_id}
    assert all(task_id == context_id for task_id, context_id, _ in observations)
    assert all(process_id == "process-sentinel" for _, _, process_id in observations)
    assert os.environ.get("HERMES_SESSION_ID") == "process-sentinel"


def test_shared_home_recovers_exact_host_session_key_when_cwd_matches(tmp_path):
    from hermes_state import SessionDB

    db = SessionDB(db_path=tmp_path / "state.db")
    try:
        manager = SessionManager(agent_factory=FakeAgent, db=db)
        left = manager.create_session(
            cwd=str(tmp_path),
            host_config={"hostSessionKey": "project:conversation:main"},
        )
        left.history = [{"role": "user", "content": "main history"}]
        manager._persist(left)
        right = manager.create_session(
            cwd=str(tmp_path),
            host_config={"hostSessionKey": "project:conversation:coder"},
        )
        right.history = [{"role": "user", "content": "coder history"}]
        manager._persist(right)

        restarted = SessionManager(agent_factory=FakeAgent, db=db)
        main_rows = restarted.list_sessions(
            cwd=str(tmp_path),
            host_session_key="project:conversation:main",
        )
        coder_rows = restarted.list_sessions(
            cwd=str(tmp_path),
            host_session_key="project:conversation:coder",
        )

        assert [row["session_id"] for row in main_rows] == [left.session_id]
        assert [row["session_id"] for row in coder_rows] == [right.session_id]
    finally:
        db.close()


@pytest.mark.asyncio
async def test_acp_cancel_publishes_hard_stop_while_holding_runtime_lock():
    acp_agent, state, fake, _conn = make_agent_and_state()
    state.is_running = True
    state.current_prompt_text = "original request"
    observed = {}

    def interrupt():
        acquired = state.runtime_lock.acquire(blocking=False)
        observed["lock_held"] = not acquired
        if acquired:
            state.runtime_lock.release()

    fake.interrupt = interrupt

    await acp_agent.cancel(state.session_id)

    assert observed["lock_held"] is True
    assert state.cancel_event.is_set()
    assert state.interrupted_prompt_text == "original request"
