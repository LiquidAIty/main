"""MCP dispatch, error, and timeout contract tests."""

import json
import os
import sys

import pytest

_APP_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _APP_DIR not in sys.path:
    sys.path.insert(0, _APP_DIR)

from app.python_models.provider_config import ensure_env_loaded

ensure_env_loaded()

from app import (
    mcp_auth,
    mcp_observability,
    mcp_provider_operations,
)


def test_agentgraph_and_mag_one_dispatch_use_current_python_owners(
    monkeypatch,
):
    import asyncio
    import mcp_host
    from app import application_operations
    from app.python_models import card_invocation, card_runs, magnetic_taskgraph
    from app.python_models import agentgraph_inspection

    context = {
        "projectId": "project-1",
        "deckId": "deck_builder",
        "conversationId": "external-mcp:grant-1",
        "parentRunId": "external-main:grant-1",
        "mainCardId": "card_main_chat",
    }
    calls = []
    monkeypatch.setattr(mcp_auth, "_authenticated_main_context", lambda: dict(context))

    def inspect(args):
        calls.append(("agentgraph.inspect", dict(args)))
        return {"ok": True, "authority": "postgresql-age-agentgraph", "runs": []}

    async def bridge(path, payload):
        calls.append((path, dict(payload)))
        return [mcp_host.TextContent(type="text", text=json.dumps({"ok": True}))]

    monkeypatch.setattr(agentgraph_inspection, "inspect_agentgraph", inspect)
    monkeypatch.setattr(application_operations, "_bridge", bridge)

    monkeypatch.setattr(
        card_invocation,
        "resolve_magnetic_taskgraph_card",
        lambda project_id, deck_id: {
            "projectId": project_id,
            "deckId": deck_id,
            "cardId": "card_mag_one",
        },
    )
    magnetic_calls = []

    def begin(payload):
        magnetic_calls.append(("begin", dict(payload)))
        return {
            "magneticTaskGraph": {
                "runId": payload["runId"],
                "projectId": payload["projectId"],
                "deckId": payload["deckId"],
                "mission": payload["assignment"],
                "workers": [{"cardId": "worker"}],
                "workerAuthorities": [{"cardId": "worker"}],
            },
        }

    def submit(payload):
        magnetic_calls.append(("submit", dict(payload)))
        return {
            "ok": True,
            "runId": payload["runId"],
            "hermesRootId": "t_root",
            "state": "pending",
        }

    monkeypatch.setattr(card_runs, "begin_run", begin)
    monkeypatch.setattr(magnetic_taskgraph, "submit_magnetic_taskgraph", submit)

    inspected = asyncio.run(
        mcp_host._dispatch_tool("agentgraph.inspect", {"runId": "run-1", "limit": 5})
    )
    assert json.loads(inspected[0].text)["authority"] == "postgresql-age-agentgraph"
    assert calls[-1] == (
        "agentgraph.inspect",
        {
            "runId": "run-1",
            "limit": 5,
            "projectId": "project-1",
            "deckId": "deck_builder",
        },
    )
    asyncio.run(mcp_host._dispatch_tool("agentgraph.inspect", {"limit": 5}))
    assert calls[-1][1] == {"limit": 5, "projectId": "project-1", "deckId": "deck_builder",
                            "conversationId": "external-mcp:grant-1"}
    asyncio.run(mcp_host._dispatch_tool("agentgraph.inspect", {"projectWide": True, "limit": 5}))
    assert calls[-1][1] == {"projectWide": True, "limit": 5, "projectId": "project-1", "deckId": "deck_builder"}

    executed = asyncio.run(
        mcp_host._dispatch_tool(
            "run_mag_one",
            {
                "input": "exact proposed mission",
                "dataAnchors": [{
                    "graphitiEpisodeId": "episode-1",
                    "reason": "Current sourced evidence", "priority": 0,
                    "boundedExpansion": 1, "resultLimit": 8,
                }],
            },
        )
    )
    executed_payload = json.loads(executed.content[0].text)
    assert executed_payload["ok"] is True
    assert executed_payload["state"] == "pending"
    assert executed.structured_content == executed_payload
    assert [call[0] for call in magnetic_calls] == ["begin", "submit"]
    assert magnetic_calls[0][1] == {
        "projectId": "project-1",
        "deckId": "deck_builder",
        "cardId": "card_mag_one",
        "senderCardId": "card_main_chat",
        "runId": magnetic_calls[0][1]["runId"],
        "correlationId": magnetic_calls[0][1]["runId"],
        "acceptedAt": magnetic_calls[0][1]["acceptedAt"],
        "conversationId": "external-mcp:grant-1",
        "assignment": "exact proposed mission",
        "dataAnchors": [{
            "graphitiEpisodeId": "episode-1",
            "reason": "Current sourced evidence", "priority": 0,
            "boundedExpansion": 1, "resultLimit": 8, "required": True,
        }],
        "discoveredTools": [],
        "discoveredToolCatalogState": "unavailable",
        "unavailableToolCatalogFamilies": [],
    }

    magnetic_calls.clear()
    executed_without_graph = asyncio.run(
        mcp_host._dispatch_tool(
            "run_mag_one",
            {"input": "mission with no selected graph data"},
        )
    )
    assert json.loads(executed_without_graph.content[0].text)["ok"] is True
    assert executed_without_graph.structured_content == json.loads(
        executed_without_graph.content[0].text
    )
    assert magnetic_calls[0][0] == "begin"
    assert magnetic_calls[0][1]["cardId"] == "card_mag_one"
    assert magnetic_calls[0][1]["assignment"] == "mission with no selected graph data"
    assert magnetic_calls[0][1]["dataAnchors"] == []

def test_lifecycle_errors_remain_typed_and_distinct(monkeypatch):
    import asyncio
    import mcp_host

    async def dispatch(_name, arguments):
        raise RuntimeError(str(arguments["error"]))

    monkeypatch.setattr(mcp_host, "_dispatch_tool", dispatch)

    async def check():
        results = {}
        for name, message in {
            "session": "Session terminated",
            "auth": "authentication expired",
            "arguments": "invalid arguments",
            "resource": "no workspace named 'missing' yet",
            "service": "service unavailable",
            "internal": "unexpected handler failure",
        }.items():
            # Exercise failure classification through a declared read-plane tool so
            # the access gate remains part of the contract under test.
            result = await mcp_host.call_tool("canvas.inspect", {"error": message})
            results[name] = json.loads(result.content[0].text)
        return results

    results = asyncio.run(check())
    assert results["session"]["failureCode"] == "session_terminated"
    assert results["auth"]["failureCode"] == "authentication_expired"
    assert results["arguments"]["failureCode"] == "invalid_arguments"
    assert results["resource"]["failureCode"] == "resource_not_found"
    assert results["resource"]["errorCategory"] == "NOT_FOUND"
    assert results["service"]["failureCode"] == "service_unavailable"
    assert results["internal"]["failureCode"] == "internal_failure"
    assert results["session"]["failureCode"] != "invalid_arguments"
    assert results["auth"]["failureCode"] != "invalid_arguments"

def test_worldsignals_connection_refusal_is_dependency_unavailable(monkeypatch):
    import asyncio
    import mcp_host

    async def refuse(name, _arguments):
        assert name == "worldsignals.capabilities"
        raise RuntimeError(
            "worldsignals_unreachable: <urlopen error [WinError 10061] "
            "No connection could be made because the target machine actively refused it>"
        )

    monkeypatch.setattr(mcp_host, "_dispatch_tool", refuse)
    result = asyncio.run(mcp_host.call_tool("worldsignals.capabilities", {}))

    assert isinstance(result, mcp_host.CallToolResult)
    assert result.is_error is True
    assert json.loads(result.content[0].text) == {
        "ok": False,
        "error": "service_unavailable",
        "failureCode": "service_unavailable",
        "errorCategory": "DEPENDENCY_UNAVAILABLE",
        "retryable": True,
        "dependency": "mcp",
    }

def test_timed_out_call_does_not_block_completed_sibling(monkeypatch):
    import asyncio
    import mcp_host

    async def dispatch(name, arguments):
        if arguments.get("speed") == "slow":
            await asyncio.sleep(60)
        return [mcp_host.TextContent(type="text", text=json.dumps({"ok": True, "name": name}))]

    monkeypatch.setattr(mcp_host, "_dispatch_tool", dispatch)
    monkeypatch.setattr(mcp_host, "_MCP_CALL_TIMEOUT_SECONDS", 0.02)

    async def check():
        slow = asyncio.create_task(mcp_host.call_tool("canvas.inspect", {"speed": "slow"}))
        sibling = await asyncio.wait_for(
            mcp_host.call_tool("agentgraph.inspect", {"speed": "sibling"}),
            timeout=0.5,
        )
        timed_out = await asyncio.wait_for(slow, timeout=0.5)
        return sibling, timed_out

    sibling, timed_out = asyncio.run(check())
    assert json.loads(sibling[0].text) == {"ok": True, "name": "agentgraph.inspect"}
    assert timed_out.is_error is True
    assert json.loads(timed_out.content[0].text)["failureCode"] == "timeout"

def test_long_running_provider_tools_use_their_owned_timeouts(monkeypatch):
    import mcp_host
    from app import application_operations

    monkeypatch.setattr(mcp_host, "_MCP_CALL_TIMEOUT_SECONDS", 30.0)
    monkeypatch.setattr(
        mcp_provider_operations, "_CBM_REQUEST_TIMEOUT_SECONDS", 300.0,
    )
    monkeypatch.setattr(mcp_host, "_MAG_ONE_SUBMISSION_TIMEOUT_SECONDS", 300.0)

    assert mcp_host._mcp_tool_timeout_seconds("run_mag_one") == 300.0
    assert mcp_provider_operations._CBM_REQUEST_TIMEOUT_SECONDS == 300.0
    assert application_operations._SPECIALIST_CARD_HTTP_TIMEOUT_SECONDS == 540.0
    assert mcp_host._mcp_tool_timeout_seconds("thinkgraph.reason") == 570.0
    assert mcp_host._mcp_tool_timeout_seconds("knowgraph.research") == 570.0
    assert mcp_host._mcp_tool_timeout_seconds("engraphis_remember") == 190.0
    assert mcp_host._mcp_tool_timeout_seconds("cbm.search_graph") == 30.0
    assert mcp_host._mcp_tool_timeout_seconds("graphiti.search_nodes") == 30.0

def test_removed_generic_card_bridge_has_no_route_or_long_running_policy(monkeypatch):
    import mcp_host
    from app import application_operations

    monkeypatch.setattr(mcp_host, "_MCP_CALL_TIMEOUT_SECONDS", 30.0)

    assert "run_configured_card" not in application_operations._BACKEND_ROUTES
    assert "describe_connected_agents" not in application_operations._BACKEND_ROUTES
    assert application_operations._backend_bridge_timeout_seconds(
        "run_configured_card"
    ) == 30.0

@pytest.mark.parametrize("operation,route,has_secret", [
    ("external_main_context", "/api/main/context", True),
])
def test_backend_domain_routes_preserve_payload_and_process_owned_secret(
    monkeypatch, operation, route, has_secret,
):
    import mcp_host

    secret = "external-main-test-secret-0123456789abcdef"
    captured = {}

    class Response:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def read(self):
            return b'{"ok":true}'

    def open_request(request, *, timeout):
        captured["request"] = request
        captured["timeout"] = timeout
        return Response()

    monkeypatch.setattr(mcp_auth, "INTERNAL_MCP_SECRET", secret)
    monkeypatch.setattr(mcp_auth, "urlopen", open_request)

    assert mcp_auth._resolve_external_main_context_sync(
        "https://issuer.example/", "auth0|subject",
    ) is None
    assert captured["request"].full_url == f"{mcp_auth.BACKEND}{route}"
    assert captured["request"].get_method() == "POST"
    assert json.loads(captured["request"].data) == {
        "issuer": "https://issuer.example/", "subject": "auth0|subject",
    }
    assert captured["request"].get_header(
        "X-liquidaity-internal-mcp-secret"
    ) == (secret if has_secret else None)
    assert captured["timeout"] == mcp_auth._MAIN_CONTEXT_TIMEOUT_SECONDS

def test_removed_generic_card_bridge_cannot_dispatch(monkeypatch):
    from app import application_operations

    monkeypatch.setenv("LIQUIDAITY_INTERNAL_MCP_SECRET", "short")

    with pytest.raises(KeyError, match="run_configured_card"):
        application_operations._bridge_sync(
            "run_configured_card", {"action": "execute"},
        )

def test_plain_text_does_not_hide_a_later_structured_tool_error():
    import json
    import mcp_host
    from app import mcp_observability

    result = [
        mcp_host.TextContent(type="text", text="provider diagnostic"),
        mcp_host.TextContent(
            type="text",
            text=json.dumps({"ok": False, "error": "provider_failure"}),
        ),
    ]

    assert mcp_observability.tool_result_category(result) == "tool_error"
