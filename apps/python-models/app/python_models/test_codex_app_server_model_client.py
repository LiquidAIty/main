"""Provider-free protocol coverage for the Codex app-server model client."""

from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path

import pytest
from autogen_core import CancellationToken
from autogen_core.models import AssistantMessage, SystemMessage, UserMessage
from autogen_agentchat.teams._group_chat._magentic_one._magentic_one_orchestrator import (
    LedgerEntry,
)
from pydantic import BaseModel

from app.python_models.codex_app_server_model_client import (
    _APP_SERVER_CONFIG_ARGS,
    CodexAppServerChatCompletionClient,
    CodexAppServerError,
)


_FAKE_SERVER = r'''
import json
import os
import sys

log_path = os.environ["FAKE_CODEX_LOG"]
account_type = os.environ.get("FAKE_CODEX_ACCOUNT", "chatgpt")
account_plan = os.environ.get("FAKE_CODEX_PLAN", "pro")
listed_model = os.environ.get("FAKE_CODEX_MODEL", "gpt-5.6-sol")
active = None

def record(value):
    with open(log_path, "a", encoding="utf-8") as handle:
        handle.write(json.dumps(value, separators=(",", ":")) + "\n")

def send(value):
    print(json.dumps(value, separators=(",", ":")), flush=True)

record({"event": "start", "openaiApiKeyPresent": bool(os.environ.get("OPENAI_API_KEY"))})
for raw in sys.stdin:
    message = json.loads(raw)
    record(message)
    method = message.get("method")
    request_id = message.get("id")
    params = message.get("params", {})
    if request_id is None:
        continue
    if method == "initialize":
        send({"id": request_id, "result": {"serverInfo": {"name": "fake", "version": "1"}}})
    elif method == "account/read":
        account = None if account_type == "none" else (
            {"type": "apiKey"} if account_type == "apiKey" else
            {"type": "chatgpt", "email": "never-returned", "planType": account_plan}
        )
        send({"id": request_id, "result": {"account": account, "requiresOpenaiAuth": True}})
    elif method == "model/list":
        send({"id": request_id, "result": {"data": [{"id": listed_model, "model": listed_model}], "nextCursor": None}})
    elif method == "mcpServerStatus/list":
        send({"id": request_id, "result": {"data": [], "nextCursor": None}})
    elif method == "thread/start":
        send({"id": request_id, "result": {"thread": {"id": "thread-1", "ephemeral": True}}})
    elif method == "thread/inject_items":
        send({"id": request_id, "result": {}})
    elif method == "turn/start":
        active = "turn-1"
        send({"id": request_id, "result": {"turn": {"id": active, "status": "inProgress", "items": []}}})
        if params.get("input", [{}])[0].get("text") != "WAIT":
            send({"method": "thread/tokenUsage/updated", "params": {
                "threadId": "thread-1", "turnId": active,
                "tokenUsage": {"last": {"inputTokens": 11, "outputTokens": 7}, "total": {}}
            }})
            send({"method": "turn/completed", "params": {
                "threadId": "thread-1",
                "turn": {"id": active, "status": "completed", "items": [
                    {"type": "reasoning", "summary": []},
                    {"type": "agentMessage", "id": "item-1", "text": "MODEL_OK"}
                ]}
            }})
    elif method == "turn/interrupt":
        send({"id": request_id, "result": {}})
        send({"method": "turn/completed", "params": {
            "threadId": "thread-1",
            "turn": {"id": active, "status": "interrupted", "items": []}
        }})
    else:
        send({"id": request_id, "error": {"code": -32601, "message": "unknown"}})
record({"event": "exit"})
'''


class Ledger(BaseModel):
    answer: str


def _client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, **env: str):
    fake = tmp_path / "fake_codex_server.py"
    fake.write_text(_FAKE_SERVER, encoding="utf-8")
    log = tmp_path / "protocol.jsonl"
    monkeypatch.setenv("FAKE_CODEX_LOG", str(log))
    for key, value in env.items():
        monkeypatch.setenv(key, value)
    return (
        CodexAppServerChatCompletionClient(
            model="gpt-5.6-sol",
            command=(sys.executable, str(fake)),
            request_timeout_seconds=5,
        ),
        log,
    )


def _records(log: Path) -> list[dict]:
    return [json.loads(line) for line in log.read_text(encoding="utf-8").splitlines()]


def test_protocol_preserves_roles_schema_usage_and_owned_lifecycle(tmp_path, monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "must-not-reach-child")
    client, log = _client(tmp_path, monkeypatch)

    async def run():
        metadata = await client.preflight_metadata()
        result = await client.create(
            [
                SystemMessage(content="saved system"),
                UserMessage(content="prior user", source="user"),
                AssistantMessage(content="prior assistant", source="assistant"),
                UserMessage(content="current user", source="user"),
            ],
            json_output=Ledger,
        )
        assert metadata == {
            "authMode": "chatgpt",
            "planType": "pro",
            "model": "gpt-5.6-sol",
        }
        assert result.content == "MODEL_OK"
        assert result.usage.prompt_tokens == 11
        assert result.usage.completion_tokens == 7
        assert client.actual_usage() == result.usage
        await client.close()

    asyncio.run(run())
    records = _records(log)
    assert records[0] == {"event": "start", "openaiApiKeyPresent": False}
    account_read = next(record for record in records if record.get("method") == "account/read")
    assert account_read["params"] == {"refreshToken": True}
    injected = next(record for record in records if record.get("method") == "thread/inject_items")
    assert [item["role"] for item in injected["params"]["items"]] == [
        "developer", "user", "assistant"
    ]
    started = next(record for record in records if record.get("method") == "thread/start")
    assert started["params"]["ephemeral"] is True
    assert started["params"]["allowProviderModelFallback"] is False
    assert started["params"]["dynamicTools"] == []
    assert started["params"]["selectedCapabilityRoots"] == []
    turn = next(record for record in records if record.get("method") == "turn/start")
    assert turn["params"]["input"] == [{"type": "text", "text": "current user"}]
    assert turn["params"]["outputSchema"] == {
        **Ledger.model_json_schema(),
        "additionalProperties": False,
    }
    assert records[-1] == {"event": "exit"}


@pytest.mark.parametrize("account_type", ["none", "apiKey"])
def test_preflight_requires_chatgpt_managed_account(tmp_path, monkeypatch, account_type):
    client, _ = _client(tmp_path, monkeypatch, FAKE_CODEX_ACCOUNT=account_type)

    async def run():
        with pytest.raises(CodexAppServerError, match="codex_chatgpt_auth_required"):
            await client.preflight_metadata()
        await client.close()

    asyncio.run(run())


def test_preflight_requires_exact_saved_model(tmp_path, monkeypatch):
    client, _ = _client(tmp_path, monkeypatch, FAKE_CODEX_MODEL="gpt-5.6-terra")

    async def run():
        with pytest.raises(CodexAppServerError, match="model_unavailable:gpt-5.6-sol"):
            await client.preflight_metadata()
        await client.close()

    asyncio.run(run())


def test_preflight_requires_pro_chatgpt_plan(tmp_path, monkeypatch):
    client, _ = _client(tmp_path, monkeypatch, FAKE_CODEX_PLAN="plus")

    async def run():
        with pytest.raises(CodexAppServerError, match="plan_required:pro"):
            await client.preflight_metadata()
        await client.close()

    asyncio.run(run())


def test_preflight_requires_exact_mag_one_model(tmp_path, monkeypatch):
    fake = tmp_path / "fake_codex_server.py"
    fake.write_text(_FAKE_SERVER, encoding="utf-8")
    monkeypatch.setenv("FAKE_CODEX_LOG", str(tmp_path / "protocol.jsonl"))
    client = CodexAppServerChatCompletionClient(
        model="gpt-5.6-terra",
        command=(sys.executable, str(fake)),
        request_timeout_seconds=5,
    )

    async def run():
        with pytest.raises(CodexAppServerError, match="model_required:gpt-5.6-sol"):
            await client.preflight_metadata()
        await client.close()

    asyncio.run(run())


def test_cancellation_interrupts_the_matching_turn(tmp_path, monkeypatch):
    client, log = _client(tmp_path, monkeypatch)
    token = CancellationToken()

    async def run():
        task = asyncio.create_task(client.create(
            [UserMessage(content="WAIT", source="user")],
            cancellation_token=token,
        ))
        await asyncio.sleep(0.05)
        token.cancel()
        with pytest.raises(CodexAppServerError, match="turn_interrupted"):
            await task
        await client.close()

    asyncio.run(run())
    interrupts = [record for record in _records(log) if record.get("method") == "turn/interrupt"]
    assert interrupts == [{
        "method": "turn/interrupt",
        "id": interrupts[0]["id"],
        "params": {"threadId": "thread-1", "turnId": "turn-1"},
    }]


def test_launch_configuration_removes_model_tools():
    joined = " ".join(_APP_SERVER_CONFIG_ARGS)
    assert 'web_search="disabled"' in joined
    assert "features.shell_tool=false" in joined
    assert "features.remote_plugin=false" in joined
    assert "agents.enabled=false" in joined


def test_generic_json_mode_uses_a_valid_object_schema():
    assert CodexAppServerChatCompletionClient._output_schema(True) == {
        "type": "object",
        "properties": {},
        "additionalProperties": False,
    }


def test_native_mag_one_ledger_schema_is_strict_for_app_server():
    schema = CodexAppServerChatCompletionClient._output_schema(LedgerEntry)
    assert schema is not None
    assert schema["additionalProperties"] is False
    assert all(
        definition["additionalProperties"] is False
        for definition in schema["$defs"].values()
    )


def test_windows_resolves_the_repository_owned_native_binary(tmp_path, monkeypatch):
    if os.name != "nt":
        pytest.skip("Windows-specific npm Codex layout")
    native = (
        tmp_path
        / "node_modules/@openai/codex-win32-x64"
        / "vendor/x86_64-pc-windows-msvc/bin/codex.exe"
    )
    native.parent.mkdir(parents=True)
    native.write_bytes(b"")
    monkeypatch.setattr(
        CodexAppServerChatCompletionClient,
        "_repository_root",
        staticmethod(lambda: tmp_path),
    )
    client = CodexAppServerChatCompletionClient(model="gpt-5.6-sol")
    try:
        assert client._resolve_executable() == str(native)
        assert tmp_path.resolve() in Path(client._temp_dir.name).resolve().parents
    finally:
        asyncio.run(client.close())


def test_codex_binary_override_must_stay_inside_repository(tmp_path, monkeypatch):
    repository = tmp_path / "repo"
    repository.mkdir()
    outside = tmp_path / "outside-codex.exe"
    outside.write_bytes(b"")
    monkeypatch.setenv("LIQUIDAITY_CODEX_BIN", str(outside))
    monkeypatch.setattr(
        CodexAppServerChatCompletionClient,
        "_repository_root",
        staticmethod(lambda: repository),
    )
    client = CodexAppServerChatCompletionClient(model="gpt-5.6-sol")
    try:
        with pytest.raises(CodexAppServerError, match="outside_repository"):
            client._resolve_executable()
    finally:
        asyncio.run(client.close())


def test_repository_binary_missing_does_not_fall_back_to_global_path(
    tmp_path, monkeypatch
):
    repository = tmp_path / "repo"
    repository.mkdir()
    global_bin = tmp_path / "global"
    global_bin.mkdir()
    (global_bin / "codex.exe").write_bytes(b"")
    monkeypatch.delenv("LIQUIDAITY_CODEX_BIN", raising=False)
    monkeypatch.setenv("PATH", str(global_bin))
    monkeypatch.setattr(
        CodexAppServerChatCompletionClient,
        "_repository_root",
        staticmethod(lambda: repository),
    )
    client = CodexAppServerChatCompletionClient(model="gpt-5.6-sol")
    try:
        with pytest.raises(CodexAppServerError, match="not_installed"):
            client._resolve_executable()
    finally:
        asyncio.run(client.close())
