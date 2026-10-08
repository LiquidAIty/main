from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import patch

from agent import codex_runtime
from agent.transports import codex_app_server_session as session_mod


def _tool(name: str) -> dict:
    return {
        "type": "function",
        "function": {
            "name": name,
            "description": name,
            "parameters": {"type": "object", "properties": {}},
        },
    }


def test_projects_only_effective_signed_localhost_native_mcp_tools():
    graphiti_add = "mcp__graphiti__graphiti_add_memory"
    graphiti_sibling = "mcp__graphiti__graphiti_clear_graph"
    remote_tool = "mcp__remote__write"
    agent = SimpleNamespace(
        tools=[_tool(graphiti_add), _tool(remote_tool)],
        valid_tool_names={graphiti_add, remote_tool},
    )
    config = {
        "mcp_servers": {
            "graphiti": {
                "url": "http://127.0.0.1:8765/mcp",
                "headers": {"Authorization": "Bearer signed-run-token"},
                "trust": "full",
                "default_tools_approval_mode": "approve",
                "tools": {
                    "include": ["graphiti.add_memory", "graphiti.clear_graph"],
                    "prompts": False,
                    "resources": False,
                },
            },
            "remote": {
                "url": "https://remote.example/mcp",
                "headers": {"Authorization": "Bearer external"},
                "trust": "full",
                "default_tools_approval_mode": "approve",
                "tools": {"include": ["write"], "prompts": False, "resources": False},
            },
        },
    }

    with patch("hermes_cli.config.load_config_readonly", return_value=config):
        assert codex_runtime._codex_native_mcp_servers(agent) == {
            "graphiti": {
                "url": "http://127.0.0.1:8765/mcp",
                "http_headers": {"Authorization": "Bearer signed-run-token"},
                "default_tools_approval_mode": "approve",
                "enabled_tools": ["graphiti.add_memory"],
            },
        }

    assert graphiti_sibling not in agent.valid_tool_names


def test_changed_native_mcp_fingerprint_retires_and_recreates_session(monkeypatch):
    projection = {
        "graphiti": {
            "url": "http://127.0.0.1:8765/mcp",
            "http_headers": {"Authorization": "Bearer new-token"},
            "default_tools_approval_mode": "approve",
            "enabled_tools": ["graphiti.add_memory"],
        },
    }
    old_projection = {
        "graphiti": {
            **projection["graphiti"],
            "http_headers": {"Authorization": "Bearer old-token"},
        },
    }
    closed = []
    prior = SimpleNamespace(
        native_mcp_fingerprint=session_mod.CodexAppServerSession.native_mcp_fingerprint_for(old_projection),
        close=lambda: closed.append(True),
    )
    agent = SimpleNamespace(
        _codex_session=prior,
        session_cwd="C:/repo",
        tools=[],
        valid_tool_names=set(),
        model="saved-model",
        reasoning_config={},
    )
    captured = {}
    real_session = session_mod.CodexAppServerSession

    class ReplacementSession:
        native_mcp_fingerprint_for = staticmethod(real_session.native_mcp_fingerprint_for)

        def __init__(self, **kwargs):
            captured.update(kwargs)
            self.native_mcp_fingerprint = self.native_mcp_fingerprint_for(
                kwargs.get("native_mcp_servers") or {},
            )

        def close(self):
            pass

    monkeypatch.setattr(session_mod, "CodexAppServerSession", ReplacementSession)
    monkeypatch.setattr(codex_runtime, "_codex_native_mcp_servers", lambda _agent: projection)
    monkeypatch.setattr(codex_runtime, "_codex_dynamic_tools", lambda _agent: [])

    codex_runtime._ensure_codex_session(
        agent,
        messages=[],
        effective_task_id="run-two",
        active_system_prompt="Saved prompt",
    )

    assert closed == [True]
    assert isinstance(agent._codex_session, ReplacementSession)
    assert captured["native_mcp_servers"] == projection

