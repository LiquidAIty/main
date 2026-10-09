"""MCP external OAuth, catalog, and dispatch contract tests."""

import json
import os
import socket
import sys

import pytest

_APP_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _APP_DIR not in sys.path:
    sys.path.insert(0, _APP_DIR)

from app.python_models.provider_config import ensure_env_loaded

ensure_env_loaded()

from app import (
    mcp_auth,
    mcp_catalog_runtime,
    mcp_cbm_provider,
    mcp_graphiti_provider,
    mcp_observability,
    mcp_provider_operations,
)
from app.python_models import tool_catalog
from app.python_models.mcp_contract_test_support import (
    clear_live_provider_operations,
    tool_result_wire_text,
)
from app.python_models.operation_definition import allowed_operation_keys
from mcp.types import Tool


def test_authenticated_catalog_is_complete_and_dispatch_uses_server_identity(
    monkeypatch, clear_live_provider_operations,
):
    import asyncio
    import mcp_host
    from app.python_models import engraphis_operations
    from mcp.server.auth.provider import AccessToken

    context = {
        "projectId": "project-1",
        "deckId": "deck_builder",
        "conversationId": "external-mcp:grant-1",
        "parentRunId": "external-main:grant-1",
        "mainCardId": "card_main_chat",
    }
    active_scopes = ["main"]
    monkeypatch.setattr(
        mcp_auth,
        "get_access_token",
        lambda: AccessToken(
            token="verified",
            client_id="chatgpt-client",
            scopes=list(active_scopes),
            subject="auth0|jeremiah",
            claims={"main": context},
        ),
    )
    cbm_tools = [
        Tool(
            name="search_graph",
            title="Search graph",
            description="Provider search description.",
            inputSchema={
                "type": "object",
                "properties": {"project": {"type": "string"}},
                "required": ["project"],
            },
            annotations={"readOnlyHint": True},
        ),
        Tool(
            name="index_status",
            title="Index status",
            description="Provider status description.",
            inputSchema={
                "type": "object",
                "properties": {"project": {"type": "string"}},
                "required": ["project"],
            },
            annotations={"readOnlyHint": True},
        ),
    ]
    graphiti_tools = [
        Tool(
            name="get_status",
            title="Get status",
            description="Graphiti status.",
            inputSchema={"type": "object", "properties": {}},
        ),
        Tool(
            name="search_nodes",
            title="Search nodes",
            description="Graphiti node search.",
            inputSchema={
                "type": "object",
                "properties": {
                    "query": {"type": "string"},
                    "group_ids": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["query"],
            },
        ),
    ]

    monkeypatch.setattr(
        mcp_cbm_provider,
        "_CBM_NAMES",
        frozenset(tool.name for tool in cbm_tools),
    )

    async def cbm_catalog():
        return cbm_tools

    monkeypatch.setattr(mcp_cbm_provider, "_cbm_tools", cbm_catalog)
    monkeypatch.setattr(
        mcp_graphiti_provider,
        "_GRAPHITI_NAMES",
        frozenset(tool.name for tool in graphiti_tools),
    )
    monkeypatch.setattr(
        mcp_graphiti_provider,
        "_graphiti_tools",
        lambda: asyncio.sleep(0, result=graphiti_tools),
    )
    asyncio.run(mcp_catalog_runtime._initialize_catalog_once())
    tools = asyncio.run(mcp_catalog_runtime.list_tools())
    by_name = {tool.name: tool for tool in tools}
    from app.python_models.tool_registry import (
        operation_definitions,
        operation_definition,
    )
    assert len(tools) == len(by_name)
    assert len(operation_definitions()) == len({
        definition.canonical_id for definition in operation_definitions()
    })
    assert "card.run_assistant_agent" not in by_name
    assert "card.run_agent" not in by_name
    for tool in tools:
        assert "liquidaitySource" in tool.meta
        assert "runtimeExecution" not in tool.meta
        assert "runtimeCapability" not in tool.meta
        assert "runtimeAccess" not in tool.meta
        source = tool.meta["liquidaitySource"]
        definition = operation_definition(tool.name)
        assert definition is not None, f"published without canonical definition: {tool.name}"
        assert source["dispatcherOwner"] == definition.dispatcher_owner
        assert source["serverInjectedArguments"] == sorted(
            definition.server_injected_arguments
        )
        assert source["dispatcherContextArguments"] == sorted(
            definition.dispatcher_context_arguments
        )
        assert source["authenticatedProjection"] is True
        assert tool.input_schema == tool_catalog.project_server_injected_schema(
            source["canonicalInputSchema"],
            frozenset(source["serverInjectedArguments"]),
        )
        assert source["available"] is definition.available is True
        assert source["grantEligible"] is definition.grant_eligible
        assert source["access"] == definition.access
        if tool.name.startswith("cbm."):
            assert source["dispatcherOwner"] == "app.mcp_provider_operations._call_cbm"
        elif tool.name.startswith("graphiti."):
            assert source["dispatcherOwner"] == "app.mcp_provider_operations._call_graphiti"
        else:
            allowed = allowed_operation_keys(definition)
            assert set(tool.input_schema.get("properties", {})) <= allowed
            assert definition.dispatcher_context_arguments == frozenset(
                allowed & mcp_host._SERVER_OWNED_ARGUMENTS
            )
    assert "main.context" in by_name
    assert "agentgraph.inspect" in by_name
    assert not any(name.startswith("mcp__") for name in by_name)
    provider_tool_names = {
        f"cbm.{tool.name}" for tool in cbm_tools
    } | {
        f"graphiti.{tool.name}" for tool in graphiti_tools
    }
    assert all(
        tool.input_schema.get("additionalProperties") is False
        for name, tool in by_name.items()
        if name not in provider_tool_names
    )
    assert "worldsignals.package" not in by_name
    assert {"engraphis_recall_context", "engraphis_get_memory", "engraphis_remember"}.issubset(by_name)
    assert "projectId" not in by_name["engraphis_recall_context"].input_schema["properties"]
    assert "projectId" not in by_name["engraphis_remember"].input_schema["properties"]
    assert "codegraph.status" not in by_name
    assert "codegraph.search" not in by_name
    assert "cbm.search_graph" in by_name
    assert "cbm.index_status" not in by_name
    assert by_name["cbm.search_graph"].meta["liquidaitySource"] == {
        "sourceId": "cbm",
        "namespace": "cbm",
        "providerToolName": "search_graph",
        "connectionKind": "external-mcp",
        "publication": "external-mcp",
        "access": "read",
        "available": True,
        "grantEligible": True,
        "canonicalInputSchema": cbm_tools[0].input_schema,
        "serverInjectedArguments": [],
        "dispatcherContextArguments": [],
        "dispatcherOwner": "app.mcp_provider_operations._call_cbm",
        "authenticatedProjection": True,
    }
    assert "graphiti.search_nodes" in by_name
    assert "graphiti.get_status" not in by_name
    assert "run_mag_one" in by_name
    assert {scheme["scopes"][0] for scheme in by_name["engraphis_recall_context"].model_dump(by_alias=True, exclude_none=True)["_meta"]["securitySchemes"]} == {"liquidaity.main"}
    assert {scheme["scopes"][0] for scheme in by_name["cbm.search_graph"].model_dump(by_alias=True, exclude_none=True)["_meta"]["securitySchemes"]} == {"liquidaity.main"}
    assert {scheme["scopes"][0] for scheme in by_name["graphiti.search_nodes"].model_dump(by_alias=True, exclude_none=True)["_meta"]["securitySchemes"]} == {"liquidaity.main"}
    assert by_name["cbm.search_graph"].description == "Provider search description."
    assert by_name["cbm.search_graph"].input_schema == cbm_tools[0].input_schema
    assert by_name["cbm.search_graph"].annotations.model_dump(by_alias=True, exclude_none=True) == {
        "readOnlyHint": True,
        "destructiveHint": False,
        "idempotentHint": True,
        "openWorldHint": False,
    }
    assert by_name["graphiti.search_nodes"].annotations.model_dump(by_alias=True, exclude_none=True) == {
        "readOnlyHint": True,
        "destructiveHint": False,
        "idempotentHint": True,
        "openWorldHint": False,
    }
    assert by_name["cbm.search_graph"].meta["liquidaityAccess"] == "read"

    active_scopes[:] = ["main"]
    main_names = {tool.name for tool in asyncio.run(mcp_catalog_runtime.list_tools())}
    assert {
        "main.context", "canvas.inspect",
        "run_mag_one", "cbm.search_graph",
        "graphiti.search_nodes",
    }.issubset(main_names)
    assert {
        "engraphis_recall_context", "graphiti.search_nodes",
        "card.create", "card.update_configuration", "canvas.upsert_wire",
    }.issubset(main_names)
    active_scopes[:] = ["main"]

    calls = []
    async def thinkgraph_call(project_id, name, arguments):
        calls.append((name, project_id, arguments))
        return {"ok": True, "id": arguments.get("id"), "nodes": []}

    monkeypatch.setattr(engraphis_operations, "invoke_tool", thinkgraph_call)

    async def call_cbm(name, arguments):
        calls.append((name, arguments))
        return mcp_host.CallToolResult(
            content=[
                mcp_host.TextContent(
                    type="text",
                    text=json.dumps({"ok": True, "provider": name}),
                )
            ]
        )

    monkeypatch.setattr(mcp_provider_operations, "_call_cbm", call_cbm)

    async def initialize_graphiti():
        return None

    async def call_graphiti(name, arguments):
        calls.append((name, arguments))
        return [mcp_host.TextContent(type="text", text=json.dumps({"ok": True}))]

    monkeypatch.setattr(
        mcp_graphiti_provider, "_initialize_graphiti", initialize_graphiti
    )
    monkeypatch.setattr(mcp_provider_operations, "_call_graphiti", call_graphiti)

    asyncio.run(mcp_host.call_tool("engraphis_recall_context", {"query": "Main", "token_budget": 2000}))
    assert calls[-1] == (
        "engraphis_recall_context",
        "project-1",
        {"query": "Main", "token_budget": 2000},
    )

    memory = {
        "content": "Approved fact", "importance": 0.5,
    }
    asyncio.run(mcp_host.call_tool("engraphis_remember", memory))
    assert calls[-1] == (
        "engraphis_remember",
        "project-1",
        memory,
    )
    rejected_scope = asyncio.run(mcp_host.call_tool(
        "engraphis_remember",
        {**memory, "projectId": "other-project"},
    ))
    assert json.loads(rejected_scope.content[0].text) == {
        "ok": False,
        "error": "caller_identity_rejected: projectId",
    }

    cbm_result = asyncio.run(
        mcp_host.call_tool("cbm.search_graph", {"project": "C-Projects-main"})
    )
    assert calls[-1] == ("search_graph", {"project": "C-Projects-main"})
    assert len(cbm_result.content) == 1
    assert "executionReceipt" not in tool_result_wire_text(cbm_result)

    asyncio.run(mcp_host.call_tool("graphiti.search_nodes", {"query": "Main"}))
    assert calls[-1] == (
        "search_nodes",
        {"query": "Main", "group_ids": ["liquidaity-project-1"]},
    )

    removed_adapter = asyncio.run(
        mcp_host.call_tool("codegraph.search", {"query": "Main"})
    )
    assert removed_adapter.is_error is True
    assert "unknown_tool: codegraph.search" in removed_adapter.content[0].text

    main_context = asyncio.run(mcp_host.call_tool("main.context", {}))
    assert json.loads(main_context[0].text)["context"] == {
        "projectId": "project-1",
        "deckId": "deck_builder",
        "conversationId": "external-mcp:grant-1",
        "parentRunId": "external-main:grant-1",
        "mainCardId": "card_main_chat",
    }

def test_authenticated_catalog_uses_one_main_scope_for_the_full_registry(
    monkeypatch, clear_live_provider_operations,
):
    import asyncio
    import mcp_host
    from app import mcp_observability
    from mcp.server.auth.provider import AccessToken

    context = {
        "projectId": "project-1",
        "deckId": "deck_builder",
        "conversationId": "external-mcp:grant-1",
        "parentRunId": "external-main:grant-1",
        "mainCardId": "card_main_chat",
    }
    active_scopes: list[str] = []

    def access_token():
        if not active_scopes:
            return None
        return AccessToken(
            token="verified",
            client_id="chatgpt-client",
            scopes=list(active_scopes),
            subject="auth0|jeremiah",
            claims={"main": context},
        )

    cbm_tools = [Tool(
        name="search_graph",
        description="CBM search.",
        inputSchema={"type": "object", "properties": {}},
        annotations={"readOnlyHint": True},
    )]
    graphiti_tools = [Tool(
        name="search_nodes",
        description="Graphiti node search.",
        inputSchema={
            "type": "object",
            "properties": {
                "query": {"type": "string"},
                "group_ids": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["query"],
        },
    )]

    monkeypatch.setattr(mcp_auth, "get_access_token", access_token)
    monkeypatch.setattr(
        mcp_cbm_provider,
        "_cbm_tools",
        lambda: asyncio.sleep(0, result=cbm_tools),
    )
    monkeypatch.setattr(
        mcp_graphiti_provider,
        "_graphiti_tools",
        lambda: asyncio.sleep(0, result=graphiti_tools),
    )
    # Process startup freezes the complete external catalog once. Public OAuth
    # changes only which frozen view is returned; it never adds late metadata.
    asyncio.run(mcp_catalog_runtime._initialize_catalog_once())
    frozen = list(mcp_catalog_runtime._CATALOG_TOOLS or ())
    frozen_names = {tool.name for tool in frozen}
    assert {"cbm.search_graph", "graphiti.search_nodes"}.issubset(frozen_names)
    canonical = asyncio.run(mcp_catalog_runtime.list_tools())
    canonical_names = {tool.name for tool in canonical}
    assert canonical
    assert "card.run_assistant_agent" not in canonical_names
    assert "card.run_agent" not in canonical_names
    assert not any(name.startswith("mcp__") for name in canonical_names)

    active_scopes[:] = ["main"]
    authenticated = asyncio.run(mcp_catalog_runtime.list_tools())
    assert len(authenticated) == len(frozen)
    assert {tool.name for tool in authenticated} == frozen_names
    assert canonical_names < frozen_names
    assert {"cbm.search_graph", "graphiti.search_nodes"}.issubset(
        {tool.name for tool in authenticated}
    )
    main_context = asyncio.run(mcp_host.call_tool("main.context", {}))
    main_payload = json.loads(main_context[0].text)
    assert main_payload["ok"] is True
    expected_count, expected_hash = mcp_catalog_runtime._catalog_identity(frozen)
    assert main_payload["diagnostics"] == {
        "state": "ready",
        "catalogState": "ready",
        "catalogReady": True,
        "completedCatalogFamilies": [
            "liquidaity",
            "cbm",
            "graphiti",
        ],
        "unavailableCatalogFamilies": [],
        "initializingCatalogFamily": None,
        "toolCount": expected_count,
        "uniqueToolCount": len(frozen_names),
        "catalogHash": expected_hash,
        "processId": mcp_observability.STARTUP_PROCESS_ID,
        "startupId": mcp_observability.STARTUP_ID,
        "sourceRevision": mcp_observability.STARTUP_SOURCE_REVISION,
        "sourceSha256": mcp_observability.STARTUP_SOURCE_SHA256,
        "currentSourceSha256": mcp_observability.STARTUP_SOURCE_SHA256,
        "sourceCurrent": True,
        "graphitiVersions": mcp_graphiti_provider._graphiti_runtime_versions(),
    }

def test_canonical_tunnel_is_transport_only_and_mcp_owns_public_metadata():
    from urllib.parse import urlsplit

    repo_root = os.path.dirname(
        os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__))))
    )
    with open(os.path.join(repo_root, "package.json"), encoding="utf-8") as package_file:
        package = json.load(package_file)

    resource_url = package["config"]["mcp_public_resource_url"]
    parsed = urlsplit(resource_url)
    assert parsed.scheme == "https"
    assert parsed.path == "/mcp"
    assert not parsed.query and not parsed.fragment
    public_origin = f"{parsed.scheme}://{parsed.netloc}"

    tunnel_command = package["scripts"]["dev:tunnel"]
    assert tunnel_command == (
        f"ngrok http http://127.0.0.1:8765 --url {public_origin}"
    )
    assert "start-mcp-tunnel.ps1" not in tunnel_command
    assert not os.path.exists(os.path.join(repo_root, "scripts", "start-mcp-tunnel.ps1"))

    dependent_services = package["scripts"]["dev:dependent-services"]
    assert dependent_services.count("npm run dev:mcp") == 1
    assert "--kill-others-on-fail" not in dependent_services
    assert (
        "powershell -NoProfile -ExecutionPolicy Bypass -File "
        "scripts/start-dependent-services.ps1 -WaitForMcpReadiness"
    ) in dependent_services
    assert dependent_services.count("npm run dev:tunnel") == 0
    readiness_gate = os.path.join(repo_root, "scripts", "start-dependent-services.ps1")
    with open(readiness_gate, encoding="utf-8-sig") as gate_file:
        gate_source = gate_file.read()
    assert "http://127.0.0.1:8765/health/ready" in gate_source
    assert "if ($WaitForMcpReadiness)" in gate_source
    assert "& npm.cmd run dev:tunnel" in gate_source
    assert "$tunnelExitCode = $LASTEXITCODE" in gate_source
    assert "the local MCP host and internal clients remain running" in gate_source
    assert "exit 0" in gate_source
    assert gate_source.index("Invoke-WebRequest") < gate_source.index("& npm.cmd run dev:tunnel")
    assert "Start-Process" not in gate_source
    assert "npm.cmd run dev:mcp" not in gate_source
    assert "/api/coder/input-data-dictionary/tools" not in gate_source
    assert "/.well-known/oauth-protected-resource" not in gate_source
    assert "server/discover" not in gate_source
    assert "tools/list" not in gate_source

    mcp_command = package["scripts"]["dev:mcp"]
    assert "MCP_PUBLIC_RESOURCE_URL=%npm_package_config_mcp_public_resource_url%" in mcp_command
    assert "MCP_AUTH0_AUDIENCE=%npm_package_config_mcp_public_resource_url%" in mcp_command
    assert "MCP_OAUTH_ENFORCED=true" in mcp_command

def test_oauth_catalog_declares_security_before_main_context_resolution(monkeypatch):
    import asyncio
    import mcp_host

    async def empty_catalog():
        return []

    monkeypatch.setattr(mcp_auth, "OAUTH_ENFORCED", True)
    monkeypatch.setattr(mcp_auth, "_authenticated_main_context", lambda: None)
    monkeypatch.setattr(mcp_graphiti_provider, "_graphiti_tools", empty_catalog)
    monkeypatch.setattr(mcp_cbm_provider, "_cbm_tools", empty_catalog)

    tools = asyncio.run(mcp_catalog_runtime._materialize_complete_catalog())
    assert tools
    assert all(
        tool.model_dump(by_alias=True, exclude_none=True)["_meta"]["securitySchemes"]
        == [{"type": "oauth2", "scopes": [mcp_auth.AUTH0_REQUIRED_SCOPE]}]
        for tool in tools
    )

def test_graphiti_episode_projection_is_bounded_and_full_body_is_explicit():
    import json
    from mcp.types import CallToolResult, TextContent
    import mcp_host

    graphiti_payload = {
        "message": "Episodes retrieved successfully",
        "episodes": [{
            "uuid": "episode-1",
            "name": "Large source",
            "content": "x" * 24000,
            "created_at": "2026-08-02T00:00:00Z",
            "source": "text",
            "source_description": "A source",
            "group_id": "project-1",
        }],
    }
    providerTool = CallToolResult(
        content=[TextContent(type="text", text=json.dumps(graphiti_payload))],
        structuredContent={"result": graphiti_payload},
    )

    compact = mcp_provider_operations._bounded_graphiti_episodes(
        providerTool, include_body=False, preview_chars=120, response_budget=2000,
    )
    compact_episode = compact.structured_content["result"]["episodes"][0]
    assert "content" not in compact_episode
    assert compact_episode["content_preview"] == "x" * 120
    assert compact_episode["content_truncated"] is True
    assert len(compact.content[0].text) <= 2000

    explicit = mcp_provider_operations._bounded_graphiti_episodes(
        providerTool, include_body=True, preview_chars=120, response_budget=3000,
    )
    explicit_episode = explicit.structured_content["result"]["episodes"][0]
    assert "content" in explicit_episode
    assert explicit_episode["content_truncated"] is True
    assert explicit.structured_content["result"]["truncated"] is True
    assert len(explicit.content[0].text) <= 3000

def test_oauth_principal_context_is_reloaded_for_each_verified_request(monkeypatch):
    import mcp_host

    calls: list[tuple[str, str]] = []
    config = mcp_auth.OAuthConfig(
        resource_url="https://example.test/mcp",
        issuer_url="https://tenant.example/",
        audience="https://example.test/mcp",
        client_id="client",
        required_scope="main",
    )
    verifier = mcp_auth.Auth0TokenVerifier(
        config,
        type("JwkClient", (), {})(),
    )
    monkeypatch.setattr(
        mcp_auth,
        "_resolve_external_main_context_sync",
        lambda issuer, subject: (
            calls.append((issuer, subject))
            or {
                "projectId": "project-1",
                "deckId": "deck_builder",
                "conversationId": "external-mcp:grant-1",
                "parentRunId": "external-main:grant-1",
                "mainCardId": "card_main_chat",
            }
        ),
    )

    first = verifier._principal_context("auth0|jeremiah")
    second = verifier._principal_context("auth0|jeremiah")

    assert first == second
    assert calls == [
        ("https://tenant.example/", "auth0|jeremiah"),
        ("https://tenant.example/", "auth0|jeremiah"),
    ]

def test_one_handler_exception_returns_a_tool_error_and_later_calls_still_work(monkeypatch):
    import asyncio
    import mcp_host
    from app import saved_canvas_tools

    attempts = 0

    async def inspect(_args, **_authority):
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            raise RuntimeError("database_connection_lost")
        return {"ok": True, "cards": []}

    monkeypatch.setattr(mcp_auth, "_authenticated_main_context", lambda: None)
    monkeypatch.setattr(saved_canvas_tools, "canvas_inspect", inspect)

    failed = asyncio.run(mcp_host.call_tool("canvas.inspect", {}))
    succeeded = asyncio.run(mcp_host.call_tool("canvas.inspect", {}))

    assert failed.is_error is True
    failed_payload = json.loads(failed.content[0].text)
    assert failed_payload["error"] == "database_failure"
    assert failed_payload["failureCode"] == "database_failure"
    assert succeeded[0].type == "text"
    assert json.loads(succeeded[0].text) == {"ok": True, "cards": []}

def test_oauth_http_publishes_metadata_and_rejects_anonymous_mcp(monkeypatch):
    import asyncio
    import httpx
    import mcp_host

    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    resource = "https://exemption-unstable-wolverine.ngrok-free.dev/mcp"

    async def empty_catalog():
        return []

    async def initialized():
        return None

    monkeypatch.setattr(mcp_host, "MCP_TRANSPORT", "streamable-http")
    monkeypatch.setattr(mcp_host, "HTTP_MCP_PORT", port)
    monkeypatch.setattr(mcp_auth, "PUBLIC_MCP_RESOURCE_URL", resource)
    monkeypatch.setattr(mcp_auth, "AUTH0_ISSUER_URL", "https://tenant.auth0.com/")
    monkeypatch.setattr(mcp_auth, "AUTH0_AUDIENCE", resource)
    monkeypatch.setattr(mcp_auth, "AUTH0_CLIENT_ID", "chatgpt-client")
    monkeypatch.setattr(mcp_auth, "AUTH0_REQUIRED_SCOPE", "liquidaity.main")
    monkeypatch.setattr(mcp_auth, "OAUTH_ENFORCED", True)
    monkeypatch.setattr(mcp_graphiti_provider, "_initialize_graphiti", initialized)
    monkeypatch.setattr(mcp_graphiti_provider, "_graphiti_tools", empty_catalog)
    monkeypatch.setattr(mcp_cbm_provider, "_cbm_tools", empty_catalog)

    async def check():
        server_task = asyncio.create_task(mcp_host.main())
        try:
            base_url = f"http://127.0.0.1:{port}"
            failure = None
            async with httpx.AsyncClient(base_url=base_url, timeout=2) as client:
                for _ in range(30):
                    try:
                        response = await client.get(
                            "/.well-known/oauth-protected-resource/mcp"
                        )
                        if response.status_code == 200:
                            break
                    except Exception as error:
                        failure = error
                    await asyncio.sleep(0.1)
                else:
                    raise failure or RuntimeError("oauth_metadata_not_ready")

                metadata = response.json()
                assert metadata["resource"] == resource
                assert metadata["authorization_servers"] == [
                    "https://tenant.auth0.com/"
                ]
                assert metadata["scopes_supported"] == [
                    "openid",
                    "profile",
                    "email",
                    "offline_access",
                    "liquidaity.main",
                ]
                assert metadata["resource_name"] == "LiquidAIty"

                root_metadata = await client.get(
                    "/.well-known/oauth-protected-resource"
                )
                assert root_metadata.json() == metadata

                anonymous = await client.post("/mcp", json={})
                assert anonymous.status_code == 401
                challenge = anonymous.headers["www-authenticate"]
                assert 'scope="liquidaity.main"' in challenge
                assert (
                    f'resource_metadata="{resource.replace("/mcp", "/.well-known/oauth-protected-resource/mcp")}"'
                    in challenge
                )
        finally:
            server_task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await server_task

    asyncio.run(check())

def test_script_bootstrap_imports_card_schema_without_pythonpath(tmp_path):
    import subprocess
    host = os.path.join(_APP_DIR, "mcp_host.py")
    # Isolated Python reproduces the supervised script's missing app-package path.
    # run_path imports definitions only: no host, CBM frontend or listener starts.
    probe = (
        "import runpy; runpy.run_path(" + repr(host)
        + ", run_name='bootstrap_probe'); "
        "from app.saved_card_tools import saved_card_operation_schema; "
        "assert saved_card_operation_schema('card.create')['additionalProperties'] is False"
    )
    result = subprocess.run([sys.executable, "-I", "-c", probe], cwd=tmp_path,
                            capture_output=True, text=True, timeout=45)
    assert result.returncode == 0, result.stderr
