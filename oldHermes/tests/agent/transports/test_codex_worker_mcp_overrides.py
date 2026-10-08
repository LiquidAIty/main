"""Codex workers must not re-export first-party Hermes tools through an internal MCP server.

Saved Card tools use app-server ``dynamicTools`` and the ordinary Hermes executor. The worker
process may still use native external MCP connections, but its launcher must not manufacture a
second Hermes tool transport or copy task ownership into Codex MCP configuration.
"""

import subprocess

import pytest

from agent.delegation_context import DELEGATED_CHILD_ENV_MARKER, KANBAN_ENV_KEYS, non_dispatcher_owned_context
from agent.transports import codex_app_server as cas


class _RecordingPopen:
    commands: list[list[str]] = []

    def __init__(self, cmd, *args, **kwargs):
        type(self).commands.append(list(cmd))
        self.stdin = self.stdout = self.stderr = None
        self.pid = 1
        self.returncode = None

    def poll(self):
        return None

    def terminate(self):
        pass

    def wait(self, timeout=None):
        return 0

    def kill(self):
        pass


@pytest.fixture
def launch(monkeypatch, tmp_path):
    """Return ``launch(env) -> list[str]`` of the ``mcp_servers.*`` overrides in the worker argv."""
    _RecordingPopen.commands = []
    monkeypatch.setattr(subprocess, "Popen", _RecordingPopen)
    for key in (*KANBAN_ENV_KEYS, DELEGATED_CHILD_ENV_MARKER, "HERMES_KANBAN_DB", "HERMES_KANBAN_BOARD"):
        monkeypatch.delenv(key, raising=False)

    def _launch(env: dict[str, str]) -> list[str]:
        with monkeypatch.context() as ctx:
            for key, value in env.items():
                ctx.setenv(key, value)
            client = cas.CodexAppServerClient(codex_bin="codex", codex_home=str(tmp_path / "codex"))
            client._closed = True
        cmd = _RecordingPopen.commands.pop()
        return [arg for arg in cmd if arg.startswith("mcp_servers.")]

    return _launch


def test_dispatcher_owned_worker_does_not_inject_hermes_mcp_overrides(launch, tmp_path):
    overrides = launch({
        "HERMES_KANBAN_TASK": "11111111-1111-4111-8111-111111111111",
        "HERMES_KANBAN_RUN_ID": "42",
        "HERMES_KANBAN_DB": str(tmp_path / "board" / "kanban.db"),
    })
    assert overrides == []


def test_other_contexts_also_do_not_get_hermes_mcp_overrides(launch):
    """Ordinary and non-owner launches also leave native MCP configuration untouched."""
    assert launch({}) == []
    with non_dispatcher_owned_context():
        assert launch({"HERMES_KANBAN_TASK": "11111111-1111-4111-8111-111111111111"}) == []
