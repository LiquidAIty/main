"""Native execution metadata reaches operations only with matching authenticated Card scope."""
# Entity: MCP Host
# Relationship: Exercises the real host/dispatcher metadata boundary with SDK request objects and isolated principals, without claiming a live agent run.
import asyncio

import pytest
from mcp.types import CallToolRequestParams

from app import mcp_auth, mcp_catalog_runtime, mcp_host, mcp_request_dispatch
from app.python_models.operation_definition import OperationDefinition


@pytest.fixture
def boundary(monkeypatch):
    calls = []
    context = {"projectId": "project-a", "deckId": "deck-a", "callerCardId": "quant-a",
               "conversationId": "conversation-a", "grantedTools": ["test.record"]}
    principal = {"kind": "card-runtime", "profile": "quant-analyst"}

    def record(**kwargs):
        calls.append(kwargs)
        return {"ok": True, "received": kwargs}

    definition = OperationDefinition(
        canonical_id="test.record", description="Record an isolated test result.",
        parameters_schema={"type": "object", "properties": {"value": {"type": "integer"}}},
        handler=record, available=True, publishers=frozenset({"internal-plugin"}),
        access="write", namespace="test", grant_eligible=True,
        dispatcher_context_arguments=frozenset({"projectId", "deckId", "_callerCardId", "_sourceExecution"}),
    )
    monkeypatch.setattr(mcp_auth, "authenticated_project_context", lambda: context)
    monkeypatch.setattr(mcp_auth, "internal_mcp_principal", lambda: principal)
    monkeypatch.setattr(mcp_request_dispatch, "operation_definition", lambda _: definition)
    monkeypatch.setattr(mcp_catalog_runtime, "published_mcp_tool_names", lambda: frozenset({"test.record"}))
    return context, principal, calls


def invoke(meta=None, arguments=None):
    params = CallToolRequestParams(name="test.record", arguments=arguments or {"value": 7}, meta=meta)
    return asyncio.run(mcp_host._server_call_tool(None, params)).model_dump(by_alias=True)


def reference(**changes):
    return {"profile": "quant-analyst", "sessionId": "session-original",
            "turnId": "turn-original", "toolCallId": "call-original", **changes}


def test_actual_metadata_and_authenticated_scope_are_not_replaced(boundary):
    _, _, calls = boundary
    result = invoke({"hermes.execution": reference(), "progressToken": "not-an-execution-id"})
    assert result["isError"] is False
    assert calls == [{"value": 7, "projectId": "project-a", "deckId": "deck-a", "_callerCardId": "quant-a",
                      "_sourceExecution": {"runtime": "hermes", **reference()}}]


@pytest.mark.parametrize("meta", [None, {}, {"hermes.execution": {}},
    {"hermes.execution": reference(sessionId="")},
    {"hermes.execution": reference(turnId=" guessed ")},
    {"hermes.execution": reference(toolCallId="a" * 257)},
    {"hermes.execution": reference(turnId="line\nbreak")},
])
def test_missing_or_malformed_reference_never_reaches_writer(boundary, meta):
    result = invoke(meta)
    assert result["isError"] is True
    assert result["structuredContent"]["failureCode"] == "hermes_execution_reference_required"
    assert boundary[2] == []


def test_foreign_profile_cannot_claim_the_authenticated_cards_write(boundary):
    result = invoke({"hermes.execution": reference(profile="trading")})
    assert result["structuredContent"]["failureCode"] == "hermes_execution_profile_mismatch"
    assert boundary[2] == []


def test_model_arguments_cannot_override_execution_provenance(boundary):
    result = invoke({"hermes.execution": reference()}, {"value": 7, "_sourceExecution": reference()})
    assert result["structuredContent"]["failureCode"] == "caller_identity_rejected"
    assert boundary[2] == []


def test_execution_metadata_does_not_grant_a_tool(boundary):
    boundary[0]["grantedTools"] = []
    result = invoke({"hermes.execution": reference()})
    assert result["structuredContent"]["failureCode"] == "tool_not_granted"
    assert boundary[2] == []
