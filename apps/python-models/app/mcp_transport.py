"""Official stdio and Streamable HTTP transport lifecycles for the MCP host."""

# Entity: MCP Host
# Relationship: This file owns the MCP host's stdio and Streamable HTTP lifecycles, readiness endpoints, request context, transport security, and provider cleanup.
# Entity: Authentication
# Relationship: Resolves the existing signed MCP credential without OAuth discovery, timed expiry, or host/origin restrictions.
# Entity: Tool Catalog
# Relationship: This file initializes the canonical tool catalog before accepting requests and exposes catalog health and readiness without rebuilding the catalog per client.
# Entity: Card Profiles
# Relationship: Binds Project/profile headers to saved-Card requests.

from __future__ import annotations

import asyncio
import os
import re
from contextlib import asynccontextmanager
from typing import Any

from app import mcp_auth, mcp_catalog_runtime, mcp_cbm_provider, mcp_graphiti_provider, mcp_observability, mcp_provider_operations
from mcp.server.lowlevel.server import Server
from mcp.server.stdio import stdio_server

HTTP_MCP_HOST = '127.0.0.1'


def validated_http_mcp_port(value: str) -> int:
    try:
        port = int(str(value).strip())
    except (TypeError, ValueError) as error:
        raise RuntimeError("mcp_http_port_invalid") from error
    if port < 1 or port > 65535:
        raise RuntimeError("mcp_http_port_invalid")
    return port


HTTP_MCP_PORT = validated_http_mcp_port(os.environ.get("MCP_HTTP_PORT", "8765"))
async def run_stdio(server: Server, implementation_version: str) -> None:
    try:
        try:
            command, args, cwd = mcp_provider_operations.cbm_config()
            await mcp_cbm_provider.start_cbm_client(
                command,
                args,
                cwd,
                implementation_version=implementation_version,
                request_timeout_seconds=(
                    mcp_provider_operations.CBM_REQUEST_TIMEOUT_SECONDS
                ),
            )
        except Exception:
            # The provider family is reported unavailable by catalog materialization;
            # the SDK client failure must not remove the base model/tool surface.
            pass
        # Nested FastMCP registries cannot be discovered from this outer
        # server's active tools/list request without deadlocking the stdio
        # request lifecycle. Complete the same canonical catalog once before
        # accepting the outer stdio session; the CBM frontend remains
        # process-owned and catalog discovery never initiates indexing.
        await mcp_catalog_runtime.initialize_catalog_once()
        mcp_catalog_runtime.catalog_or_error()
        async with stdio_server() as (read_stream, write_stream):
            await server.run(read_stream, write_stream, server.create_initialization_options())
    finally:
        await mcp_graphiti_provider.close_graphiti()
        await mcp_cbm_provider.close_cbm()
        mcp_catalog_runtime.reset_catalog_lifecycle()


def _safe_request_header(scope: dict[str, Any], name: bytes) -> str:
    for key, value in scope.get("headers") or []:
        if key.lower() == name:
            return value.decode("utf-8", errors="replace")
    return ""


class _SafeRequestTraceMiddleware:
    """Trace HTTP completion without reading bodies, auth headers, or arguments."""

    def __init__(self, app: Any):
        self.app = app

    async def __call__(self, scope: dict[str, Any], receive: Any, send: Any) -> None:
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return
        status = 500
        completed = False

        async def traced_send(message: dict[str, Any]) -> None:
            nonlocal status, completed
            if message.get("type") == "http.response.start":
                status = int(message.get("status") or 500)
            if (
                message.get("type") == "http.response.body"
                and not message.get("more_body", False)
            ):
                completed = True
            await send(message)

        exception_class = ""
        try:
            await self.app(scope, receive, traced_send)
        except Exception as error:
            exception_class = error.__class__.__name__
            raise
        finally:
            mcp_observability.trace(
                "http_request",
                http_method=str(scope.get("method") or ""),
                session_hash=mcp_observability.safe_hash(
                    _safe_request_header(scope, b"mcp-session-id")
                ),
                user_agent=_safe_request_header(scope, b"user-agent")[:240],
                response_status=status,
                result_category="http_error" if status >= 400 else "http_success",
                exception_class=exception_class,
                completed=completed,
            )


class _CardProfileContextMiddleware:
    """Bind one profile name from the profile-owned MCP connection to this request."""

    _PROFILE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")

    def __init__(self, app: Any):
        self.app = app

    async def __call__(self, scope: dict[str, Any], receive: Any, send: Any) -> None:
        raw = _safe_request_header(scope, b"x-liquidaity-hermes-profile").strip()
        profile = raw if not raw or self._PROFILE.fullmatch(raw) else "__invalid__"
        raw_project = _safe_request_header(scope, b"x-liquidaity-project-id").strip()
        project_id = raw_project if not raw_project or re.fullmatch(
            r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
            raw_project,
            re.IGNORECASE,
        ) else "__invalid__"
        raw_deck = _safe_request_header(scope, b"x-liquidaity-deck-id").strip()
        deck_id = raw_deck if not raw_deck or re.fullmatch(
            r"^[A-Za-z0-9:_-]{1,128}$", raw_deck,
        ) else "__invalid__"
        raw_conversation = _safe_request_header(
            scope, b"x-liquidaity-conversation-id"
        ).strip()
        conversation_id = raw_conversation if not raw_conversation or re.fullmatch(
            r"^[A-Za-z0-9:_-]{1,128}$", raw_conversation,
        ) else "__invalid__"
        profile_token = mcp_auth.set_requested_card_profile(profile)
        project_token = mcp_auth.set_requested_project_id(project_id)
        deck_token = mcp_auth.set_requested_deck_id(deck_id)
        conversation_token = mcp_auth.set_requested_conversation_id(conversation_id)
        try:
            await self.app(scope, receive, send)
        finally:
            mcp_auth.reset_requested_conversation_id(conversation_token)
            mcp_auth.reset_requested_deck_id(deck_token)
            mcp_auth.reset_requested_project_id(project_token)
            mcp_auth.reset_requested_card_profile(profile_token)


async def run_streamable_http(
    server: Server,
    implementation_version: str,
    public_name: str,
) -> None:
    import uvicorn
    from mcp.server.streamable_http_manager import StreamableHTTPSessionManager
    from mcp.server.transport_security import TransportSecuritySettings
    from starlette.applications import Starlette
    from starlette.middleware.authentication import AuthenticationMiddleware
    from starlette.responses import JSONResponse, PlainTextResponse
    from starlette.routing import Mount, Route

    from mcp.server.auth.middleware.auth_context import AuthContextMiddleware
    from mcp.server.auth.middleware.bearer_auth import BearerAuthBackend

    session_manager = StreamableHTTPSessionManager(
        app=server,
        json_response=True,
        stateless=True,
        security_settings=TransportSecuritySettings(
            enable_dns_rebinding_protection=False,
        ),
    )

    async def endpoint(scope: dict[str, Any], receive: Any, send: Any) -> None:
        if scope.get("path") != mcp_auth.HTTP_MCP_PATH:
            await PlainTextResponse("not_found", status_code=404)(scope, receive, send)
            return
        if not mcp_auth.access_token_available():
            await JSONResponse({"error": "mcp_credential_required"}, status_code=403)(scope, receive, send)
            return
        await session_manager.handle_request(scope, receive, send)

    @asynccontextmanager
    async def lifespan(_app: Starlette):
        try:
            command, args, cwd = mcp_provider_operations.cbm_config()
            await mcp_cbm_provider.start_cbm_client(
                command,
                args,
                cwd,
                implementation_version=implementation_version,
                request_timeout_seconds=(
                    mcp_provider_operations.CBM_REQUEST_TIMEOUT_SECONDS
                ),
            )
        except Exception:
            # Catalog diagnostics retain the exact dependency failure while the
            # MCP transport and non-CBM capabilities remain available.
            pass
        catalog_task = mcp_catalog_runtime.start_catalog_initialization()
        try:
            async with session_manager.run():
                yield
        finally:
            if not catalog_task.done():
                catalog_task.cancel()
                try:
                    await catalog_task
                except asyncio.CancelledError:
                    pass
            await mcp_graphiti_provider.close_graphiti()
            await mcp_cbm_provider.close_cbm()
            mcp_catalog_runtime.reset_catalog_lifecycle()

    async def health_endpoint(_request: Any) -> JSONResponse:
        diagnostics = mcp_catalog_runtime.catalog_diagnostics()
        return JSONResponse(
            {
                "ok": diagnostics["catalogState"] != "failed",
                **diagnostics,
            },
            status_code=200,
        )

    async def readiness_endpoint(_request: Any) -> JSONResponse:
        diagnostics = mcp_catalog_runtime.catalog_diagnostics()
        ready = bool(
            diagnostics["catalogReady"]
            and int(diagnostics.get("toolCount") or 0) > 0
            and diagnostics.get("toolCount")
            == diagnostics.get("uniqueToolCount")
        )
        return JSONResponse(
            {
                "ok": ready,
                **diagnostics,
            },
            status_code=200 if ready else 503,
        )

    health_routes = [
        Route("/health", endpoint=health_endpoint, methods=["GET"]),
        Route("/health/catalog", endpoint=readiness_endpoint, methods=["GET"]),
        Route("/health/ready", endpoint=readiness_endpoint, methods=["GET"]),
    ]

    credential_endpoint = AuthenticationMiddleware(
        AuthContextMiddleware(endpoint),
        backend=BearerAuthBackend(mcp_auth.McpTokenVerifier()),
    )
    routes = [*health_routes, Mount("/", app=credential_endpoint)]
    http_app = _SafeRequestTraceMiddleware(_CardProfileContextMiddleware(
        Starlette(routes=routes, lifespan=lifespan)
    ))
    config = uvicorn.Config(
        http_app,
        host=HTTP_MCP_HOST,
        port=HTTP_MCP_PORT,
        log_level="info",
        timeout_keep_alive=75,
    )
    await uvicorn.Server(config).serve()
