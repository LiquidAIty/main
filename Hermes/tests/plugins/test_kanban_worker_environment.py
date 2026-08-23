"""Generic Kanban child-environment seam and LiquidAIty bearer provider proof."""

from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from types import SimpleNamespace

import pytest

from hermes_cli import kanban_db as kb
from hermes_cli.plugins import (
    KanbanWorkerEnvironmentContext,
    PluginContext,
    PluginManager,
    PluginManifest,
)


def _context(**overrides) -> KanbanWorkerEnvironmentContext:
    values = {
        "task_id": "t_worker",
        "run_id": "7",
        "board": "default",
        "assignee": "liquidaity-hermes-steward",
        "profile": "liquidaity-hermes-steward",
        "workspace": r"C:\Projects\LiquidAIty\main",
        "claim_lock": "worker:claim-7",
    }
    values.update(overrides)
    return KanbanWorkerEnvironmentContext(**values)


def _task() -> kb.Task:
    return kb.Task(
        id="t_worker",
        title="worker",
        body="bounded task",
        assignee="liquidaity-hermes-steward",
        status="running",
        priority=0,
        created_by="auto-decomposer",
        created_at=1,
        started_at=1,
        completed_at=None,
        workspace_kind="dir",
        workspace_path=None,
        claim_lock="worker:claim-7",
        claim_expires=None,
        tenant=None,
        current_run_id=7,
    )


def _load_liquidaity_provider():
    plugin_file = (
        Path(__file__).resolve().parents[2]
        / "plugins"
        / "liquidaity-card-mcp"
        / "__init__.py"
    )
    spec = importlib.util.spec_from_file_location(
        "liquidaity_card_mcp_provider_test", plugin_file
    )
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_registered_provider_is_additive_and_disposable():
    manager = PluginManager()
    ctx = PluginContext(PluginManifest(name="test-provider"), manager)
    handle = ctx.register_kanban_worker_environment_provider(
        lambda context: {"SCOPED_VALUE": f"{context.task_id}:{context.run_id}"}
    )

    assert manager.resolve_kanban_worker_environment(_context()) == {
        "SCOPED_VALUE": "t_worker:7"
    }
    handle.dispose()
    assert manager.resolve_kanban_worker_environment(_context()) == {}


def test_provider_rejects_stock_or_duplicate_environment_keys():
    manager = PluginManager()
    first = PluginContext(PluginManifest(name="first"), manager)
    first.register_kanban_worker_environment_provider(
        lambda _context: {"HERMES_KANBAN_TASK": "replacement"}
    )
    with pytest.raises(ValueError, match="cannot replace"):
        manager.resolve_kanban_worker_environment(_context())

    manager = PluginManager()
    first = PluginContext(PluginManifest(name="first"), manager)
    second = PluginContext(PluginManifest(name="second"), manager)
    first.register_kanban_worker_environment_provider(
        lambda _context: {"SCOPED_VALUE": "one"}
    )
    second.register_kanban_worker_environment_provider(
        lambda _context: {"SCOPED_VALUE": "two"}
    )
    with pytest.raises(ValueError, match="cannot replace"):
        manager.resolve_kanban_worker_environment(_context())


def test_default_spawn_adds_only_provider_value_and_removes_signing_secret(
    monkeypatch, tmp_path
):
    root = tmp_path / ".hermes"
    profile = root / "profiles" / "liquidaity-hermes-steward"
    profile.mkdir(parents=True)
    profile.joinpath("config.yaml").write_text("{}\n", encoding="utf-8")
    root.joinpath("config.yaml").write_text("{}\n", encoding="utf-8")
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    monkeypatch.setenv("HERMES_HOME", str(root))
    monkeypatch.setenv("LIQUIDAITY_INTERNAL_MCP_SECRET", "host-signing-secret")
    monkeypatch.setattr(kb, "_resolve_hermes_argv", lambda: ["hermes"])

    from hermes_cli import plugins as plugins_module

    seen = []

    def provide(context):
        seen.append(context)
        return {"LIQUIDAITY_CARD_BEARER": "scoped-child-bearer"}

    monkeypatch.setattr(
        plugins_module, "resolve_kanban_worker_environment", provide
    )
    captured = {}

    class FakeProc:
        pid = 4242

    def fake_popen(cmd, *args, **kwargs):
        captured["cmd"] = list(cmd)
        captured["env"] = dict(kwargs["env"])
        return FakeProc()

    monkeypatch.setattr(subprocess, "Popen", fake_popen)
    assert kb._default_spawn(_task(), str(workspace), board="default") == 4242

    assert seen == [_context(workspace=str(workspace))]
    assert captured["env"]["LIQUIDAITY_CARD_BEARER"] == "scoped-child-bearer"
    assert "LIQUIDAITY_INTERNAL_MCP_SECRET" not in captured["env"]
    assert captured["env"]["HERMES_KANBAN_TASK"] == "t_worker"
    assert captured["env"]["HERMES_KANBAN_RUN_ID"] == "7"
    assert captured["env"]["HERMES_KANBAN_CLAIM_LOCK"] == "worker:claim-7"


def test_default_spawn_without_provider_preserves_stock_lane(monkeypatch, tmp_path):
    root = tmp_path / ".hermes"
    (root / "profiles" / "liquidaity-hermes-steward").mkdir(parents=True)
    root.joinpath("config.yaml").write_text("{}\n", encoding="utf-8")
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    monkeypatch.setenv("HERMES_HOME", str(root))
    monkeypatch.setattr(kb, "_resolve_hermes_argv", lambda: ["hermes"])
    from hermes_cli import plugins as plugins_module

    monkeypatch.setattr(
        plugins_module, "resolve_kanban_worker_environment", lambda _context: {}
    )
    captured = {}

    class FakeProc:
        pid = 4243

    def fake_popen(cmd, *args, **kwargs):
        captured["env"] = dict(kwargs["env"])
        return FakeProc()

    monkeypatch.setattr(subprocess, "Popen", fake_popen)
    assert kb._default_spawn(_task(), str(workspace)) == 4243
    assert "LIQUIDAITY_CARD_BEARER" not in captured["env"]
    assert captured["env"]["HERMES_KANBAN_TASK"] == "t_worker"


def test_liquidaity_provider_fails_closed_without_leaking_response(monkeypatch):
    provider = _load_liquidaity_provider()

    class FailingOpener:
        def open(self, *_args, **_kwargs):
            raise OSError("Bearer should-never-escape")

    monkeypatch.setattr(
        provider.urllib.request, "build_opener", lambda *_args: FailingOpener()
    )
    with pytest.raises(RuntimeError) as caught:
        provider._worker_environment(_context())
    assert str(caught.value) == "liquidaity_card_bearer_lookup_unavailable"
    assert "should-never-escape" not in str(caught.value)


def test_real_child_interpolates_bearer_and_calls_stub_mcp_without_leaking_it():
    bearer = "provider-free-child-bearer-" + ("x" * 64)
    observations: list[tuple[str, bool]] = []

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            return

        def do_POST(self):  # noqa: N802 - BaseHTTPRequestHandler contract
            size = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(size).decode("utf-8"))
            method = str(payload.get("method") or "")
            authorized = self.headers.get("Authorization") == f"Bearer {bearer}"
            observations.append((method, authorized))
            if method == "initialize":
                result = {
                    "protocolVersion": "2025-06-18",
                    "capabilities": {"tools": {}},
                    "serverInfo": {"name": "stub", "version": "1"},
                }
                response = {"jsonrpc": "2.0", "id": payload["id"], "result": result}
            elif method == "tools/list":
                response = {
                    "jsonrpc": "2.0", "id": payload["id"],
                    "result": {"tools": [{"name": "allowed.read"}]},
                }
            elif payload.get("params", {}).get("name") == "allowed.read":
                response = {
                    "jsonrpc": "2.0", "id": payload["id"],
                    "result": {"content": [{"type": "text", "text": "ok"}]},
                }
            else:
                response = {
                    "jsonrpc": "2.0", "id": payload["id"],
                    "error": {"code": -32003, "message": "tool_not_granted"},
                }
            encoded = json.dumps(response).encode("utf-8")
            self.send_response(200 if authorized else 401)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(encoded)))
            self.end_headers()
            self.wfile.write(encoded)

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        port = server.server_address[1]
        script = r'''
import json, urllib.request
from tools.mcp_tool import _interpolate_env_vars
headers = _interpolate_env_vars({"Authorization": "Bearer ${LIQUIDAITY_CARD_BEARER}"})
url = __import__("os").environ["STUB_MCP_URL"]
out = []
for idx, (method, params) in enumerate([
    ("initialize", {}),
    ("tools/list", {}),
    ("tools/call", {"name": "allowed.read", "arguments": {}}),
    ("tools/call", {"name": "denied.write", "arguments": {}}),
], 1):
    body = json.dumps({"jsonrpc": "2.0", "id": idx, "method": method, "params": params}).encode()
    request = urllib.request.Request(url, data=body, headers={**headers, "Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=3) as response:
        out.append(json.loads(response.read().decode()))
print(json.dumps({"listed": out[1]["result"]["tools"][0]["name"], "allowed": out[2]["result"]["content"][0]["text"], "denied": out[3]["error"]["message"]}))
'''
        child_env = dict(os.environ)
        child_env["LIQUIDAITY_CARD_BEARER"] = bearer
        child_env["STUB_MCP_URL"] = f"http://127.0.0.1:{port}/mcp"
        child_env["PYTHONPATH"] = str(Path(__file__).resolve().parents[2])
        completed = subprocess.run(
            [sys.executable, "-c", script],
            cwd=Path(__file__).resolve().parents[2],
            env=child_env,
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=3)

    assert completed.returncode == 0, completed.stderr
    assert json.loads(completed.stdout) == {
        "listed": "allowed.read",
        "allowed": "ok",
        "denied": "tool_not_granted",
    }
    assert observations == [
        ("initialize", True),
        ("tools/list", True),
        ("tools/call", True),
        ("tools/call", True),
    ]
    assert bearer not in completed.stdout
    assert bearer not in completed.stderr
