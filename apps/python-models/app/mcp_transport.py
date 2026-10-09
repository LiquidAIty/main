"""Official stdio and Streamable HTTP transport lifecycles for the MCP host."""

from __future__ import annotations

import asyncio
import json
import os
from contextlib import asynccontextmanager
from typing import Any
from urllib.parse import urlsplit

from app import mcp_auth, mcp_catalog_runtime, mcp_cbm_provider, mcp_graphiti_provider, mcp_observability, mcp_provider_operations
from mcp.server.lowlevel.server import Server
from mcp.server.stdio import stdio_server

HTTP_MCP_HOST = '127.0.0.1'
HTTP_MCP_PORT = int(os.environ.get("MCP_HTTP_PORT", "8765"))
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


async def run_streamable_http(
    server: Server,
    implementation_version: str,
    public_name: str,
) -> None:
    import uvicorn
    from mcp.server.streamable_http_manager import StreamableHTTPSessionManager
    from mcp.server.transport_security import TransportSecuritySettings
    from pydantic import AnyHttpUrl
    from starlette.authentication import AuthenticationBackend
    from starlette.applications import Starlette
    from starlette.middleware.authentication import AuthenticationMiddleware
    from starlette.responses import JSONResponse, PlainTextResponse
    from starlette.routing import Mount, Route

    from mcp.server.auth.middleware.auth_context import AuthContextMiddleware
    from mcp.server.auth.middleware.bearer_auth import BearerAuthBackend, RequireAuthMiddleware
    from mcp.server.auth.routes import build_resource_metadata_url, create_protected_resource_routes

    config_values = mcp_auth.oauth_config()

    local_authority = f"{HTTP_MCP_HOST}:{HTTP_MCP_PORT}"
    allowed_hosts = {
        HTTP_MCP_HOST,
        local_authority,
        "localhost",
        f"localhost:{HTTP_MCP_PORT}",
    }
    allowed_origins = {
        f"http://{local_authority}",
        f"http://localhost:{HTTP_MCP_PORT}",
    }
    if mcp_auth.PUBLIC_MCP_RESOURCE_URL:
        public_url = urlsplit(mcp_auth.PUBLIC_MCP_RESOURCE_URL)
        if public_url.netloc:
            allowed_hosts.add(public_url.netloc)
            allowed_origins.add(f"{public_url.scheme}://{public_url.netloc}")

    session_manager = StreamableHTTPSessionManager(
        app=server,
        json_response=True,
        stateless=True,
        security_settings=TransportSecuritySettings(
            enable_dns_rebinding_protection=True,
            allowed_hosts=sorted(allowed_hosts),
            allowed_origins=sorted(allowed_origins),
        ),
    )

    async def endpoint(scope: dict[str, Any], receive: Any, send: Any) -> None:
        if scope.get("path") != mcp_auth.HTTP_MCP_PATH:
            await PlainTextResponse("not_found", status_code=404)(scope, receive, send)
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

    if mcp_auth.OAUTH_ENFORCED:
        class ScopedRequireAuthMiddleware(RequireAuthMiddleware):
            """Emit the complete RFC 6750/MCP OAuth discovery challenge."""

            async def _send_auth_error(
                self,
                send: Any,
                status_code: int,
                error: str,
                description: str,
            ) -> None:
                challenge_parts = [
                    f'error="{error}"',
                    f'error_description="{description}"',
                    f'scope="{" ".join(self.required_scopes)}"',
                ]
                if self.resource_metadata_url:
                    challenge_parts.append(
                        f'resource_metadata="{self.resource_metadata_url}"'
                    )
                body = json.dumps(
                    {
                        "error": error,
                        "error_description": description,
                        "scope": " ".join(self.required_scopes),
                    }
                ).encode("utf-8")
                await send(
                    {
                        "type": "http.response.start",
                        "status": status_code,
                        "headers": [
                            (b"content-type", b"application/json"),
                            (b"content-length", str(len(body)).encode("ascii")),
                            (
                                b"www-authenticate",
                                f'Bearer {", ".join(challenge_parts)}'.encode("utf-8"),
                            ),
                        ],
                    }
                )
                await send({"type": "http.response.body", "body": body})

        resource_url = AnyHttpUrl(config_values.resource_url)
        metadata_url = build_resource_metadata_url(resource_url)
        protected_endpoint: Any = ScopedRequireAuthMiddleware(
            endpoint,
            required_scopes=[config_values.required_scope],
            resource_metadata_url=metadata_url,
        )
        protected_endpoint = AuthContextMiddleware(protected_endpoint)
        auth_backend: AuthenticationBackend = BearerAuthBackend(
            mcp_auth.Auth0TokenVerifier(config_values)
        )
        protected_endpoint = AuthenticationMiddleware(protected_endpoint, backend=auth_backend)
        protected_resource_routes = create_protected_resource_routes(
            resource_url=resource_url,
            authorization_servers=[AnyHttpUrl(config_values.issuer_url)],
            scopes_supported=list(mcp_auth.OAUTH_SCOPES),
                resource_name=public_name,
        )
        routes = [
            *health_routes,
            Route(
                "/.well-known/oauth-protected-resource",
                endpoint=protected_resource_routes[0].endpoint,
                methods=["GET", "OPTIONS"],
            ),
            *protected_resource_routes,
            Mount("/", app=protected_endpoint),
        ]
    else:
        routes = [*health_routes, Mount("/", app=endpoint)]
    http_app = _SafeRequestTraceMiddleware(
        Starlette(routes=routes, lifespan=lifespan)
    )
    config = uvicorn.Config(
        http_app,
        host=HTTP_MCP_HOST,
        port=HTTP_MCP_PORT,
        log_level="info",
        timeout_keep_alive=75,
    )
    await uvicorn.Server(config).serve()
