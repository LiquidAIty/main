"""MCP Streamable HTTP and protocol contract tests."""

# Entity: MCP Host
# Relationship: This file exercises the real local Streamable HTTP host with official clients to verify stateless requests, transport security, protocol compatibility, readiness, and provider lifecycle.
# Entity: Authentication
# Relationship: This file verifies OAuth-protected MCP clients receive only the exact Project and Card context established by their verified bearer token.
# Entity: Tool Catalog
# Relationship: This file verifies each authenticated client sees the exact unique subset of the canonical catalog granted to its saved Card context.
# Entity: CodeGraph
# Relationship: This file verifies separate authenticated clients can call the granted CBM search operation through one host-owned CodeGraph provider connection.

import json
import os
import socket
import sys
import time

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
    mcp_provider_operations,
)
from app.python_models.test_mcp_contract_support import (
    clear_live_provider_operations,
    tool_result_wire_text,
)


def test_public_streamable_http_resource_requires_oauth(monkeypatch):
    monkeypatch.setattr(
        mcp_auth,
        "PUBLIC_MCP_RESOURCE_URL",
        "https://public.example/mcp",
    )
    monkeypatch.setattr(mcp_auth, "OAUTH_ENFORCED", False)

    with pytest.raises(RuntimeError, match="public_mcp_resource_requires_oauth"):
        mcp_auth.oauth_config()


def test_unauthenticated_transport_has_no_external_resource_allowlist(monkeypatch):
    monkeypatch.setattr(mcp_auth, "PUBLIC_MCP_RESOURCE_URL", "")
    monkeypatch.setattr(mcp_auth, "OAUTH_ENFORCED", False)

    config = mcp_auth.oauth_config()

    assert config.resource_url == ""


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
    from mcp.server.auth.provider import AccessToken

    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    main_context = {
        "projectId": "project-1",
        "deckId": "deck_builder",
        "conversationId": "project-1",
        "parentRunId": "main-run-one",
        "callerCardId": "card_main_chat",
        "grantedTools": ["calculator", "cbm.search_graph", "main.context"],
        "mainEntryAuthorized": True,
    }
    project_contexts = {
        "external-main-token": main_context,
        "external-card-one": {
            "projectId": "project-1",
            "deckId": "deck_builder",
            "conversationId": "card-session-one",
            "parentRunId": "card-run-one",
            "callerCardId": "card-one",
            "grantedTools": ["cbm.search_graph"],
        },
        "external-card-two": {
            "projectId": "project-1",
            "deckId": "deck_builder",
            "conversationId": "card-session-two",
            "parentRunId": "card-run-two",
            "callerCardId": "card-two",
            "grantedTools": ["cbm.search_graph"],
        },
    }

    class VerifiedToken:
        async def verify_token(self, token):
            project_context = project_contexts.get(token)
            if project_context is None:
                return None
            return AccessToken(
                token=token,
                client_id="chatgpt-client",
                scopes=["liquidaity.main"],
                expires_at=4102444800,
                subject=f"auth0|{project_context['callerCardId']}",
                claims={"project": project_context},
            )

    monkeypatch.setattr(mcp_host, "MCP_TRANSPORT", "streamable-http")
    monkeypatch.setattr(mcp_transport, "HTTP_MCP_PORT", port)
    monkeypatch.setattr(
        mcp_auth,
        "PUBLIC_MCP_RESOURCE_URL",
        "https://example.test/mcp",
    )
    monkeypatch.setattr(mcp_auth, "AUTH0_ISSUER_URL", "https://tenant.example/")
    monkeypatch.setattr(mcp_auth, "AUTH0_AUDIENCE", "https://example.test/mcp")
    monkeypatch.setattr(mcp_auth, "AUTH0_CLIENT_ID", "chatgpt-client")
    monkeypatch.setattr(mcp_auth, "AUTH0_REQUIRED_SCOPE", "liquidaity.main")
    monkeypatch.setattr(mcp_auth, "OAUTH_ENFORCED", True)
    monkeypatch.setattr(mcp_auth, "Auth0TokenVerifier", lambda _config: VerifiedToken())
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

            async with httpx.AsyncClient(
                headers={"Authorization": "Bearer external-main-token"},
                timeout=2,
            ) as security_client:
                invalid_host = await security_client.post(
                    f"http://127.0.0.1:{port}/mcp",
                    headers={"host": "untrusted.example"},
                    json={},
                )
                assert invalid_host.status_code == 421
                assert invalid_host.text == "Invalid Host header"

                invalid_origin = await security_client.post(
                    f"http://127.0.0.1:{port}/mcp",
                    headers={"origin": "https://untrusted.example"},
                    json={},
                )
                assert invalid_origin.status_code == 403
                assert invalid_origin.text == "Invalid Origin header"

            async def fresh_client(token, *, mode="auto", inspect_main=False):
                response_session_ids = []

                async def observe(response):
                    response_session_ids.append(response.headers.get("mcp-session-id"))

                async with httpx2.AsyncClient(
                    headers={"Authorization": f"Bearer {token}"},
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
                            "query": "MCP session lifecycle",
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
                "external-main-token", mode="auto", inspect_main=True,
            )
            card_one = await fresh_client("external-card-one")
            card_two = await fresh_client("external-card-two")
            second = await fresh_client(
                "external-main-token", mode="legacy", inspect_main=True,
            )
            first_catalog, first_context, first_identity, first_cbm_client, first_protocol = first
            second_catalog, second_context, second_identity, second_cbm_client, second_protocol = second
            assert first_catalog == second_catalog
            assert first_catalog == [
                "calculator", "cbm.search_graph", "main.context", "main.submit",
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
        finally:
            server_task.cancel()
            try:
                await server_task
            except asyncio.CancelledError:
                pass

    asyncio.run(check())

def test_auth0_token_verifier_checks_jwt_contract_and_establishes_server_owned_principal(monkeypatch):
    import jwt
    import mcp_host
    from cryptography.hazmat.primitives.asymmetric import rsa

    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    other_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)

    class StaticJwkClient:
        def get_signing_key_from_jwt(self, _token):
            return type("SigningKey", (), {"key": private_key.public_key()})()

    config = mcp_auth.OAuthConfig(
        resource_url="https://exemption-unstable-wolverine.ngrok-free.dev/mcp",
        issuer_url="https://tenant.auth0.com/",
        audience="https://exemption-unstable-wolverine.ngrok-free.dev/mcp",
        client_id="chatgpt-client",
        required_scope="main",
    )
    verifier = mcp_auth.Auth0TokenVerifier(config, StaticJwkClient())
    monkeypatch.setattr(
        mcp_auth,
        "_resolve_external_project_context_sync",
        lambda issuer, subject: {
            "projectId": "project-1",
            "deckId": "deck_builder",
            "conversationId": "project-1",
            "parentRunId": "run-one",
            "callerCardId": "card_main_chat",
            "grantedTools": ["cbm.search_graph", "main.context"],
        } if issuer == config.issuer_url and subject == "auth0|jeremiah" else None,
    )
    now = int(time.time())
    base = {
        "iss": config.issuer_url,
        "sub": "auth0|jeremiah",
        "aud": config.audience,
        "iat": now,
        "exp": now + 300,
        "azp": config.client_id,
        "scope": "openid main",
    }

    def encoded(claims, key=private_key):
        return jwt.encode(claims, key, algorithm="RS256", headers={"kid": "test-key"})

    verified = verifier._verify_sync(encoded(base))
    assert verified is not None
    assert verified.subject == "auth0|jeremiah"
    assert verified.claims["project"]["projectId"] == "project-1"
    assert verified.claims["project"]["callerCardId"] == "card_main_chat"
    within_clock_skew = verifier._verify_sync(encoded({**base, "iat": now + 2}))
    assert within_clock_skew is not None
    monkeypatch.setattr(
        mcp_auth,
        "_resolve_external_project_context_sync",
        lambda _issuer, _subject: None,
    )
    verified_without_project = verifier._verify_sync(encoded(base))
    assert verified_without_project is not None
    assert verified_without_project.subject == "auth0|jeremiah"
    assert "project" not in verified_without_project.claims
    invalid_claims = [
        {**base, "iss": "https://wrong.auth0.com/"},
        {**base, "aud": "https://wrong.example/mcp"},
        {**base, "exp": now - mcp_auth.AUTH0_CLOCK_SKEW_SECONDS - 1},
            {
                **base,
                "iat": now + mcp_auth.AUTH0_CLOCK_SKEW_SECONDS + 60,
            },
        {**base, "nbf": now + 300},
        {**base, "azp": "wrong-client"},
        {**base, "scope": "openid profile"},
    ]
    assert verifier._verify_sync(encoded(base, other_key)) is None
    assert all(verifier._verify_sync(encoded(claims)) is None for claims in invalid_claims)
