"""MCP Streamable HTTP and protocol contract tests."""

# Entity: MCP Host
# Relationship: This file exercises the real local Streamable HTTP host with official clients to verify stateless requests, transport security, protocol compatibility, readiness, and provider lifecycle.
# Entity: Authentication
# Relationship: Exercises real signed-credential verification, exact saved Project/profile grants, request isolation and key rotation without restoring OAuth or timed expiry.
# Entity: Tool Catalog
# Relationship: This file verifies each authenticated client sees the exact unique subset of the canonical catalog granted to its saved Card context.
# Entity: CodeGraph
# Relationship: Verifies host-owned provider reuse with a bounded CBM test double; this HTTP contract suite never launches another CBM frontend or claims live CodeGraph proof.

import json
import os
import socket
import sys
import time
import jwt

import pytest

_APP_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _APP_DIR not in sys.path:
    sys.path.insert(0, _APP_DIR)

from app.python_models.provider_config import ensure_env_loaded

ensure_env_loaded()

from app import mcp_transport

from app import (
    mcp_auth,
    mcp_catalog_projection,
    mcp_catalog_runtime,
    mcp_cbm_provider,
    mcp_graphiti_provider,
    mcp_provider_operations,
)
from app.python_models.test_mcp_contract_support import (
    clear_live_provider_operations,
    tool_result_wire_text,
)


TEST_SECRET = "http-contract-only-not-a-product-secret" * 2


def signed(profile="main", **changes):
    claims = {"iss": mcp_auth.INTERNAL_MCP_ISSUER, "aud": mcp_auth.INTERNAL_MCP_AUDIENCE,
        "sub": f"card:{profile}", "iat": int(time.time()), "principal": {"kind": "card-runtime",
            "ownerUserId": "owner", "projectId": "project-1", "deckId": "deck_builder", "profile": profile}}
    claims.update(changes)
    return jwt.encode(claims, TEST_SECRET, algorithm="HS256")


def test_missing_signing_secret_or_malformed_bearer_never_becomes_anonymous_access(monkeypatch):
    monkeypatch.setattr(mcp_auth, "INTERNAL_MCP_SECRET", "")
    assert mcp_auth.McpTokenVerifier()._verify_sync(signed()) is None
    monkeypatch.setattr(mcp_auth, "INTERNAL_MCP_SECRET", TEST_SECRET)
    assert all(mcp_auth.McpTokenVerifier()._verify_sync(token) is None for token in ("", "not-a-jwt", "a.b.c"))


def test_profile_context_is_reset_even_when_a_request_fails():
    import asyncio
    async def rejected(_scope, _receive, _send):
        assert mcp_auth.requested_card_profile() == "card-one"
        raise RuntimeError("request failed")
    with pytest.raises(RuntimeError, match="request failed"):
        asyncio.run(mcp_transport._CardProfileContextMiddleware(rejected)(
            {"type": "http", "headers": [(b"x-liquidaity-hermes-profile", b"card-one")]}, None, None))
    assert mcp_auth.requested_card_profile() == ""
    assert mcp_auth.requested_project_id() == ""


@pytest.mark.parametrize("value", ("0", "65536", "-1", "not-a-port", ""))
def test_streamable_http_port_rejects_invalid_values(value):
    with pytest.raises(RuntimeError, match="mcp_http_port_invalid"):
        mcp_transport.validated_http_mcp_port(value)


def test_streamable_http_port_accepts_valid_value():
    assert mcp_transport.validated_http_mcp_port("8765") == 8765


def test_authenticated_streamable_http_is_stateless_across_fresh_official_sdk_clients(
    monkeypatch, clear_live_provider_operations,
):
    import asyncio
    import httpx
    import httpx2
    import mcp_host
    from mcp import Client
    from mcp.client.streamable_http import streamable_http_client
    from mcp.types import Tool, CallToolResult, TextContent

    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    main_context = {
        "projectId": "project-1",
        "deckId": "deck_builder",
        "conversationId": "project-1",
        "callerCardId": "card_main_chat",
        "grantedTools": ["calculator", "cbm.search_graph", "main.context"],
        "mainEntryAuthorized": True,
    }
    project_contexts = {
        "main": main_context,
        "card-one": {
            "projectId": "project-1",
            "deckId": "deck_builder",
            "conversationId": "card-session-one",
            "callerCardId": "card-one",
            "grantedTools": ["cbm.search_graph"],
        },
        "card-two": {
            "projectId": "project-1",
            "deckId": "deck_builder",
            "conversationId": "card-session-two",
            "callerCardId": "card-two",
            "grantedTools": ["cbm.search_graph"],
        },
    }

    provider_calls = {"open": 0, "close": 0}
    class TestProvider:
        async def call_tool(self, name, arguments, **_kwargs):
            assert name == "search_graph" and arguments["limit"] == 1
            return CallToolResult(content=[TextContent(type="text", text=json.dumps({"testProvider": True, "nodes": []}))])
        async def __aexit__(self, *_):
            provider_calls["close"] += 1
    async def open_provider(*_args, **_kwargs):
        provider_calls["open"] += 1
        return TestProvider(), (Tool(name="search_graph", description="Test-owned provider seam",
            inputSchema={"type": "object", "properties": {"project": {"type": "string"},
                "name_pattern": {"type": "string"}, "limit": {"type": "integer"}, "format": {"type": "string"}},
                "additionalProperties": False}),)
    async def no_graphiti():
        return []

    monkeypatch.setattr(mcp_host, "MCP_TRANSPORT", "streamable-http")
    monkeypatch.setattr(mcp_transport, "HTTP_MCP_PORT", port)
    monkeypatch.setattr(mcp_auth, "INTERNAL_MCP_SECRET", TEST_SECRET)
    monkeypatch.setattr(mcp_auth, "_resolve_internal_card_context_sync", lambda principal: project_contexts.get(principal['profile']))
    monkeypatch.setattr(mcp_cbm_provider, "_open_cbm_client", open_provider)
    monkeypatch.setattr(mcp_graphiti_provider, "graphiti_tools", no_graphiti)
    monkeypatch.setattr(mcp_catalog_runtime, "_CATALOG_STATE", "initializing")
    monkeypatch.setattr(mcp_catalog_runtime, "_CATALOG_FAILURE", None)
    monkeypatch.setattr(mcp_catalog_runtime, "_CATALOG_TOOLS", None)
    monkeypatch.setattr(mcp_catalog_runtime, "_CATALOG_INITIALIZATION_TASK", None)

    async def check():
        server_task = asyncio.create_task(mcp_host.main())
        try:
            failure = None
            for _ in range(50):
                try:
                    with socket.create_connection(("127.0.0.1", port), timeout=0.2):
                        pass
                    break
                except Exception as error:
                    failure = error
                    await asyncio.sleep(0.1)
            else:
                raise failure or RuntimeError("http_mcp_not_ready")

            async with httpx.AsyncClient(timeout=2) as readiness_client:
                for _ in range(450):
                    readiness = await readiness_client.get(
                        f"http://127.0.0.1:{port}/health/ready"
                    )
                    if readiness.status_code == 200:
                        break
                    if readiness.json().get("catalogState") == "failed":
                        raise RuntimeError(readiness.text)
                    await asyncio.sleep(0.1)
                else:
                    raise RuntimeError("http_mcp_catalog_not_ready")

            async with httpx.AsyncClient(timeout=2) as security_client:
                for headers in ({}, {"Authorization": "Bearer invalid"},
                    {"Authorization": f"Bearer {signed()}", "X-LiquidAIty-Hermes-Profile": "wrong"}):
                    denied = await security_client.post(f"http://127.0.0.1:{port}/mcp", headers=headers, json={})
                    assert denied.status_code == 403
                    assert "www-authenticate" not in denied.headers
                for extra in ({"host": "untrusted.example"}, {"origin": "https://untrusted.example"}):
                    accepted = await security_client.post(f"http://127.0.0.1:{port}/mcp",
                        headers={"Authorization": f"Bearer {signed()}", "X-LiquidAIty-Hermes-Profile": "main",
                                 "Accept": "application/json, text/event-stream", **extra},
                        json={"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
                            "protocolVersion": "2025-11-25", "capabilities": {}, "clientInfo": {"name": "contract-test", "version": "1"}}})
                    assert accepted.status_code == 200

            async def fresh_client(profile, *, mode="auto", inspect_main=False):
                response_session_ids = []

                async def observe(response):
                    response_session_ids.append(response.headers.get("mcp-session-id"))

                async with httpx2.AsyncClient(
                    headers={"Authorization": f"Bearer {signed(profile)}", "X-LiquidAIty-Hermes-Profile": profile},
                    event_hooks={"response": [observe]},
                    timeout=60,
                ) as http_client:
                    transport = streamable_http_client(
                        f"http://127.0.0.1:{port}/mcp",
                        http_client=http_client,
                    )
                    async with Client(
                        transport,
                        mode=mode,
                        read_timeout_seconds=60,
                    ) as session:
                        listed_tools = (
                            await session.list_tools(cache_mode="refresh")
                        ).tools
                        actual = sorted(tool.name for tool in listed_tools)
                        catalog_identity = mcp_catalog_projection.catalog_identity(
                            listed_tools
                        )
                        cbm_project = "-".join(
                            part.rstrip(":")
                            for part in mcp_provider_operations._CBM_HOST_REPO_ROOT
                            .replace("\\", "/")
                            .split("/")
                            if part
                        )
                        cbm_result = await session.call_tool("cbm.search_graph", {
                            "project": cbm_project,
                            "name_pattern": ".*lifecycle.*",
                            "limit": 1,
                            "format": "json",
                        })
                        assert cbm_result.is_error is not True
                        cbm_payload = json.loads(cbm_result.content[0].text)
                        visible_context = None
                        if inspect_main:
                            calculator_result = await session.call_tool(
                                "calculator", {"expression": "2 + 3 * 4"}
                            )
                            assert calculator_result.is_error is not True
                            assert json.loads(calculator_result.content[0].text) == "14.0"
                            result = await session.call_tool("main.context", {})
                            visible_context = json.loads(result.content[0].text)["context"]
                            forged = await session.call_tool("main.context", {"projectId": "other-project"})
                            assert forged.is_error is True
                            invalid = await session.call_tool("not_a_real_tool", {})
                        else:
                            calculator_denied = await session.call_tool(
                                "calculator", {"expression": "2 + 3 * 4"}
                            )
                            assert calculator_denied.is_error is True
                        protocol_version = session.protocol_version
                assert response_session_ids
                assert all(value is None for value in response_session_ids)
                assert isinstance(cbm_payload, dict)
                if inspect_main:
                    assert len(result.content) == 1
                    assert "executionReceipt" not in tool_result_wire_text(result)
                    assert invalid.is_error is True
                    assert len(invalid.content) == 1
                    assert "executionReceipt" not in tool_result_wire_text(invalid)
                assert mcp_cbm_provider._CBM_CLIENT is not None
                return (
                    actual,
                    visible_context,
                    catalog_identity,
                    id(mcp_cbm_provider._CBM_CLIENT),
                    protocol_version,
                )

            # Close and recreate the Main client around two distinct saved-Card
            # Project contexts. All four requests remain stateless at the outer
            # HTTP boundary and use the same host-owned CBM child.
            first = await fresh_client(
                "main", mode="auto", inspect_main=True,
            )
            card_one, card_two = await asyncio.gather(fresh_client("card-one"), fresh_client("card-two"))
            second = await fresh_client(
                "main", mode="legacy", inspect_main=True,
            )
            first_catalog, first_context, first_identity, first_cbm_client, first_protocol = first
            second_catalog, second_context, second_identity, second_cbm_client, second_protocol = second
            assert first_catalog == second_catalog
            assert first_catalog == [
                "calculator", "cbm.search_graph", "main.context",
            ]
            assert card_one[0] == card_two[0]
            assert card_one[0] == ["cbm.search_graph"]
            assert len(first_catalog) == len(set(first_catalog))
            assert not any(name.startswith("liquidaity.") for name in first_catalog)
            assert not any(name.startswith("liquidaity_liquidaity_") for name in first_catalog)
            assert not any(name.startswith("mcp__") for name in first_catalog)
            assert first_context == second_context == {
                key: value for key, value in main_context.items()
                if key not in {"grantedTools", "mainEntryAuthorized"}
            }
            assert first_identity == second_identity
            assert card_one[2] == card_two[2]
            assert first_cbm_client == card_one[3] == card_two[3] == second_cbm_client
            assert first_protocol == "2026-07-28"
            assert second_protocol in {
                "2024-11-05", "2025-03-26", "2025-06-18", "2025-11-25",
            }
            base_identity = mcp_catalog_projection.catalog_identity(
                list(mcp_catalog_runtime._CATALOG_TOOLS or ())
            )
            assert len(first_catalog) <= base_identity[0]
            assert readiness.json()["toolCount"] == base_identity[0]
            assert readiness.json()["uniqueToolCount"] == base_identity[0]
            assert readiness.json()["catalogHash"] == base_identity[1]
            # Saved grant changes are re-read for each HTTP request, not frozen
            # into a connection or shared with another profile's concurrent call.
            async with httpx2.AsyncClient(headers={"Authorization": f"Bearer {signed()}",
                "X-LiquidAIty-Hermes-Profile": "main"}) as http_client:
                async with Client(streamable_http_client(f"http://127.0.0.1:{port}/mcp", http_client=http_client)) as session:
                    assert len((await session.list_tools(cache_mode="refresh")).tools) == 3
                    main_context["grantedTools"] = ["main.context"]
                    assert [tool.name for tool in (await session.list_tools(cache_mode="refresh")).tools] == ["main.context"]
                    assert (await session.call_tool("calculator", {"expression": "1 + 1"})).is_error is True
            async with httpx2.AsyncClient(headers={"Authorization": f"Bearer {signed(principal={'kind': 'catalog-reader'})}"}) as http_client:
                async with Client(streamable_http_client(f"http://127.0.0.1:{port}/mcp", http_client=http_client)) as session:
                    assert len((await session.list_tools(cache_mode="refresh")).tools) == base_identity[0]
                    denied = await session.call_tool("calculator", {"expression": "1 + 1"})
                    assert denied.is_error is True
                    assert "tool_not_granted" in tool_result_wire_text(denied)
        finally:
            server_task.cancel()
            try:
                await server_task
            except asyncio.CancelledError:
                pass

    asyncio.run(check())
    assert provider_calls == {"open": 1, "close": 1}

def test_signed_token_verifier_enforces_identity_grants_clock_and_rotation(monkeypatch):
    monkeypatch.setattr(mcp_auth, "INTERNAL_MCP_SECRET", TEST_SECRET)
    context = {"projectId": "project-1", "deckId": "deck_builder", "conversationId": "project-1",
               "callerCardId": "card_main_chat", "grantedTools": ["main.context"]}
    monkeypatch.setattr(mcp_auth, "_resolve_internal_card_context_sync", lambda _: context)
    verifier = mcp_auth.McpTokenVerifier()
    assert verifier._verify_sync(signed()) is None  # A profile-owned connection must name its profile.
    profile_token = mcp_auth.set_requested_card_profile("main")
    try:
        verified = verifier._verify_sync(signed())
        assert verified is not None and verified.claims['project'] == context
        assert verified.expires_at is None
        assert verifier._verify_sync(signed(exp=1)) is not None  # Explicit current non-expiring contract.
        assert verifier._verify_sync(signed(iss="wrong")) is None
        assert verifier._verify_sync(signed(aud="wrong")) is None
        assert verifier._verify_sync(signed(iat=int(time.time())+300)) is None
        assert verifier._verify_sync(signed(nbf=int(time.time())+300)) is None
        assert verifier._verify_sync(signed("other-profile")) is None
        assert verifier._verify_sync(signed(principal={"kind": "unknown"})) is None
        unsupported = jwt.decode(signed(), TEST_SECRET, algorithms=["HS256"], audience=mcp_auth.INTERNAL_MCP_AUDIENCE)
        assert verifier._verify_sync(jwt.encode(unsupported, TEST_SECRET, algorithm="HS384")) is None
        for grants in (["main.context", "main.context"], [" main.context"], [None], "main.context"):
            assert verifier._verify_sync(signed(principal={"kind": "graph-read", "projectId": "project-1",
                "deckId": "deck_builder", "callerCardId": "main", "grantedTools": grants})) is None
        for field in ("ownerUserId", "projectId", "deckId", "profile"):
            claims = jwt.decode(signed(), TEST_SECRET, algorithms=["HS256"], audience=mcp_auth.INTERNAL_MCP_AUDIENCE)
            claims['principal'].pop(field)
            assert verifier._verify_sync(jwt.encode(claims, TEST_SECRET, algorithm="HS256")) is None
        monkeypatch.setattr(mcp_auth, "_resolve_internal_card_context_sync", lambda _: None)
        assert verifier._verify_sync(signed()) is None
        monkeypatch.setattr(mcp_auth, "INTERNAL_MCP_SECRET", "rotated-secret" * 4)
        assert verifier._verify_sync(signed()) is None
    finally:
        mcp_auth.reset_requested_card_profile(profile_token)
