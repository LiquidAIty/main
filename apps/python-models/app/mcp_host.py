"""The one official Python MCP host for LiquidAIty runtimes and connectors.

The canonical supervised service tree launches one Streamable HTTP host for
the process lifetime. Hermes Cards use that same authenticated seam; no
per-turn spawn or fallback host exists.

Exposes this application tool surface plus the process-owned Engraphis
ThinkGraph adapter and dynamically discovered Codebase Memory and official
Graphiti MCP registries:
  * web_search                       (real Tavily search; Search Agent only by grant)
  * canvas.inspect / card.create / card.update_configuration / canvas.upsert_wire
                                      (handlers live in responsibility-specific Python modules)

Transport tools forward to the backend's Main, Card and Hermes domain routes
endpoints on loopback — the backend remains the single authority for deck state,
conversation store, card resolution, and graph persistence. Application tools dispatch
to responsibility-specific Python handlers which own validation/policy and use the
existing backend deck routes. No semantics,
no fallback lives in this host.

Official Graphiti ingestion is an explicit Hermes-only grant. Provider tools keep their upstream schemas,
annotations, dispatch, and results; this host adds only provider namespaces and
authentication. Graph authorities never appear as cards or conversational agents.
"""

from __future__ import annotations

import asyncio
import inspect
import json
import os
import sys
import tomllib
from contextlib import asynccontextmanager
from typing import Any
from urllib.parse import urlsplit
from uuid import uuid4

# Bootstrap the package root onto sys.path. The service command launches this host as a
# script (`python .../apps/python-models/app/mcp_host.py`), so sys.path[0] is the
# `app/` dir and the `app` package (rooted at apps/python-models) is NOT importable —
# otherwise makes every `from app...` handler fail at call time ("No module named
# 'app'"). Adding the package root here (the ONE launch/bootstrap boundary) makes all
# `app.*` imports resolve for every tool. This is the one process bootstrap boundary.
_PACKAGE_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_REPO_ROOT = os.path.dirname(os.path.dirname(_PACKAGE_ROOT))
if _PACKAGE_ROOT not in sys.path:
    sys.path.insert(0, _PACKAGE_ROOT)


from app import (
    mcp_cbm_provider,
    mcp_graphiti_provider,
    mcp_observability,
    mcp_provider_operations,
)
from app.application_tool_error import ApplicationToolError
from app.python_models.provider_config import ensure_env_loaded
from app.python_models.operation_definition import (
    OperationDefinition,
    allowed_operation_keys,
)
from app.python_models.tool_registry import (
    operation_definition,
    required_tool_caller_runtime,
    tool_access,
)
from mcp.server.lowlevel.server import NotificationOptions, Server
from mcp.server.stdio import stdio_server
from mcp.types import (
    CallToolRequestParams,
    CallToolResult,
    ListResourcesResult,
    ListToolsResult,
    PaginatedRequestParams,
    TextContent,
)

ensure_env_loaded()

# Auth configuration is captured after the canonical dotenv owner has loaded
# the same environment that formerly fed the in-host auth constants.
from app import mcp_auth
from app import mcp_catalog_runtime

MCP_TRANSPORT = os.environ.get("MCP_TRANSPORT", "stdio").strip().lower()
HTTP_MCP_HOST = "127.0.0.1"
HTTP_MCP_PORT = int(os.environ.get("MCP_HTTP_PORT", "8765"))
_MCP_CALL_TIMEOUT_SECONDS = 30.0
_MAG_ONE_SUBMISSION_TIMEOUT_SECONDS = 300.0
_SPECIALIST_CARD_TOOL_TIMEOUT_SECONDS = 570.0
_PUBLIC_MCP_NAME = "LiquidAIty"


def _hermes_package_version() -> str:
    """Read the checked-in HermesLatest package version used by this product."""
    try:
        with open(
            os.path.join(_REPO_ROOT, "HermesLatest", "pyproject.toml"),
            "rb",
        ) as package_file:
            package = tomllib.load(package_file)
        version = str((package.get("project") or {}).get("version") or "").strip()
        return version or "unknown"
    except (OSError, ValueError, TypeError):
        return "unknown"


_MCP_IMPLEMENTATION_VERSION = _hermes_package_version()
_PUBLIC_MCP_DESCRIPTION = (
    "Connect ChatGPT to LiquidAIty projects, saved agent cards, CodeGraph, "
    "ThinkGraph, KnowGraph, and supported agent runtimes. "
    "Start with main.context to resolve the authenticated Main conversation and project scope. "
    "Use the currently published tool names and schemas; preserve returned provider IDs and provenance. "
    "Saved Cards own their configuration and granted capabilities. "
    "An accepted operation is not proof of completion; use its returned status and evidence."
)

def _request_tool_is_allowed(
    name: str,
    definition: OperationDefinition | None = None,
) -> bool:
    access = definition.access if definition is not None else tool_access(name)
    principal = mcp_auth._internal_mcp_principal()
    if (
        mcp_provider_operations._is_provider_operation_name(name)
        and name not in mcp_catalog_runtime._published_mcp_tool_names()
    ):
        return False
    # The public host preserves the canonical unknown-tool error from dispatch.
    # An internal Card-scoped connection fails closed before dispatch because it
    # may call only operations present in the live registry and its exact grants.
    if access is None:
        return principal is None
    if principal is None:
        if not mcp_auth.OAUTH_ENFORCED:
            return True
        # Preserve the canonical unknown-tool result for names the registry has
        # never owned, but do not let a stale external client invoke a known
        # internal-only operation that is absent from this process's frozen
        # MCP publication catalog.
        return name in mcp_catalog_runtime._published_mcp_tool_names()
    kind = str(principal.get("kind") or "")
    if kind == "catalog-reader":
        return False
    if kind == "materializer-read":
        grants = mcp_auth._validated_principal_tool_names(
            principal.get("grantedTools")
        )
        return access == "read" and grants is not None and name in grants
    if kind != "card-runtime":
        return False
    grants = mcp_auth._validated_principal_tool_names(principal.get("grantedTools"))
    presented = mcp_auth._validated_principal_tool_names(principal.get("presentedTools"))
    return (
        grants is not None
        and presented is not None
        and name in grants
        and name in presented
    )


class ToolChangeNotificationServer(Server):
    def create_initialization_options(
        self,
        notification_options: NotificationOptions | None = None,
        experimental_capabilities: dict[str, dict[str, Any]] | None = None,
        extensions: dict[str, dict[str, Any]] | None = None,
    ):
        return super().create_initialization_options(
            notification_options or NotificationOptions(tools_changed=True),
            experimental_capabilities,
            extensions,
        )


async def list_resources() -> list[Any]:
    mcp_observability.trace(
        "resources_list",
        mcp_method="resources/list",
        response_status=200,
        result_category="empty_catalog",
        completed=True,
        **mcp_auth._oauth_trace_fields(),
    )
    return []


_SERVER_OWNED_ARGUMENTS = {
    "projectId",
    "deckId",
    "conversationId",
    "correlationId",
    "senderAgentId",
    "senderCardId",
    "parentRunId",
    "originatingAgentId",
    "originatingRunId",
    "_callerCardId",
    "_callerRuntimeKind",
    "_callerRuntimeMode",
    "_sourceCardId",
    "_sourceRunId",
    "_effectTargetCardId",
    "_effectTargetCardRevisionId",
    "_effectTargetDeckRevision",
    "_builderOperation",
    "_mainContext",
    "_catalogDiagnostics",
    "_authenticatedUserEdit",
    "_authenticatedProjectId",
    "_principalKind",
}


def _enforce_tool_caller(
    name: str,
    args: dict[str, Any],
    *,
    authenticated_external: bool = False,
) -> str | None:
    expected = required_tool_caller_runtime(name)
    card_id = str(args.pop("_callerCardId", "") or "").strip()
    kind = str(args.pop("_callerRuntimeKind", "") or "").strip()
    mode = str(args.pop("_callerRuntimeMode", "") or "").strip()
    if authenticated_external and not kind and not mode:
        # The authenticated account MCP surface is the Main doorway. Internal
        # runtimes supply their exact saved runtime union instead.
        kind, mode = "hermes", "main"
    if expected is None:
        return None
    if not card_id or not kind or not mode:
        return "tool_caller_identity_unavailable"
    if {"kind": kind, "mode": mode} != expected:
        return (
            f"tool_caller_not_authorized: {name} requires "
            f"{expected['kind']}/{expected['mode']}"
        )
    return None


async def _dispatch_tool(
    name: str,
    arguments: dict[str, Any],
) -> Any:
    context = mcp_auth._authenticated_main_context()
    principal = mcp_auth._internal_mcp_principal()
    if context is None and principal and principal.get("kind") == "materializer-read":
        # Pre-dispatch reads have real project/Card identity but no Run yet.
        # Keep their provider graph scope without fabricating runtime telemetry.
        context = {
            "projectId": principal["projectId"], "deckId": principal["deckId"],
            "mainCardId": principal["callerCardId"],
            "conversationId": principal.get("conversationId", ""),
        }
    if (
        mcp_provider_operations._is_provider_operation_name(name)
        and name not in mcp_catalog_runtime._published_mcp_tool_names()
    ):
        return [TextContent(type="text", text=json.dumps({
            "ok": False, "error": f"unknown_tool: {name}",
        }))]
    definition = operation_definition(name)
    if definition is None:
        return [TextContent(type="text", text=json.dumps({
            "ok": False, "error": f"unknown_tool: {name}",
        }))]
    if not _request_tool_is_allowed(name, definition):
        raise PermissionError(f"tool_not_granted: {name}")
    allowed = allowed_operation_keys(definition)
    server_injected = definition.server_injected_arguments
    dispatcher_context = definition.dispatcher_context_arguments
    args = dict(arguments or {})
    supplied_identity = sorted(
        (_SERVER_OWNED_ARGUMENTS | set(server_injected)) & args.keys()
    )
    if supplied_identity:
        return [TextContent(type="text", text=json.dumps({
            "ok": False,
            "error": "caller_identity_rejected: "
            + ",".join(supplied_identity),
        }))]
    required_runtime = required_tool_caller_runtime(name)
    if context is None and required_runtime is not None:
        surface = "main" if required_runtime.get("mode") == "main" else "card"
        return [TextContent(type="text", text=json.dumps({
            "ok": False,
            "error": f"authenticated_{surface}_context_required",
        }))]
    if context is not None:
        try:
            for field in ("projectId", "deckId", "conversationId"):
                if field in dispatcher_context:
                    if (name == "agentgraph.inspect" and field == "conversationId"
                            and (args.get("runId") or args.get("projectWide") is True)):
                        continue
                    args[field] = str(context[field])
            if "parentRunId" in dispatcher_context:
                args["parentRunId"] = str(context.get("parentRunId") or "")
            if "_sourceCardId" in dispatcher_context:
                args["_sourceCardId"] = str(context["mainCardId"])
            if "_sourceRunId" in dispatcher_context:
                args["_sourceRunId"] = str(context["parentRunId"])
            if "_callerCardId" in dispatcher_context:
                args["_callerCardId"] = str(context["mainCardId"])
            if "_authenticatedProjectId" in dispatcher_context:
                args["_authenticatedProjectId"] = str(context["projectId"])
            if "_principalKind" in dispatcher_context:
                args["_principalKind"] = str(context.get("principalKind") or "")
            if "_authenticatedUserEdit" in dispatcher_context:
                args["_authenticatedUserEdit"] = bool(
                    context.get("principalKind") is None and principal is None
                )
            if "_mainContext" in dispatcher_context:
                args["_mainContext"] = {
                    field: str(context[field]) for field in mcp_auth._MAIN_CONTEXT_FIELDS
                }
            if "_catalogDiagnostics" in dispatcher_context:
                args["_catalogDiagnostics"] = (
                    mcp_catalog_runtime._catalog_diagnostics()
                )
            if "senderAgentId" in allowed:
                args["senderAgentId"] = str(context["mainCardId"])
            if "correlationId" in allowed:
                args["correlationId"] = f"external-mcp:{uuid4()}"
            if required_runtime is not None:
                args["_callerCardId"] = str(context["mainCardId"])
                args["_callerRuntimeKind"] = str(
                    context.get("callerRuntimeKind") or "hermes"
                )
                args["_callerRuntimeMode"] = str(
                    context.get("callerRuntimeMode") or "main"
                )
            missing_injected = sorted(
                server_injected - args.keys()
                if definition.external_source_id != "graphiti"
                else frozenset()
            )
            if missing_injected:
                raise ValueError(
                    "server_injected_argument_unavailable:" + ",".join(missing_injected)
                )
        except (KeyError, RuntimeError, ValueError) as err:
            return [TextContent(type="text", text=json.dumps({"ok": False, "error": str(err)}))]
    caller_card_id = str(args.get("_callerCardId", "") or "").strip()
    caller_error = _enforce_tool_caller(
        name,
        args,
        authenticated_external=context is not None,
    )
    if caller_error:
        return [
            TextContent(
                type="text",
                text=json.dumps({"ok": False, "error": caller_error}),
            )
        ]
    if not caller_card_id and context is not None:
        caller_card_id = str(context.get("mainCardId") or "").strip()
    if "_callerCardId" in dispatcher_context:
        args["_callerCardId"] = caller_card_id
    extra = [k for k in args.keys() if k not in allowed]
    if extra:
        return [
            TextContent(
                type="text",
                text=json.dumps({"ok": False, "error": f"tool_arguments_rejected: {','.join(sorted(extra))}"}),
            )
        ]
    try:
        result = definition.handler(**args)
        if inspect.isawaitable(result):
            result = await result
    except ApplicationToolError as error:
        return [TextContent(type="text", text=json.dumps({
            "ok": False, "error": str(error),
        }))]
    if isinstance(result, CallToolResult):
        return result
    if isinstance(result, list):
        return result
    result_text = json.dumps(result, default=str, ensure_ascii=False)
    return CallToolResult(
        content=[TextContent(type="text", text=result_text)],
        structuredContent=result if isinstance(result, dict) else None,
        isError=(
            isinstance(result, dict)
            and (result.get("ok") is False or bool(result.get("error")))
        ),
    )


def _mcp_tool_timeout_seconds(name: str) -> float:
    if name in {"thinkgraph.reason", "knowgraph.research"}:
        return _SPECIALIST_CARD_TOOL_TIMEOUT_SECONDS
    if name == "engraphis_remember":
        # Semantic extraction and storage can exceed the ordinary read deadline.
        return 190.0
    if name == "run_mag_one":
        return _MAG_ONE_SUBMISSION_TIMEOUT_SECONDS
    return _MCP_CALL_TIMEOUT_SECONDS


async def _execute_tool_request(
    name: str,
    arguments: dict[str, Any],
    *,
    transport: str,
) -> Any:
    tool_name = str(name or "").strip()
    trace_fields = {
        "tool_transport": transport,
        "tool_name": tool_name[:160],
        **(mcp_auth._oauth_trace_fields() if transport == "mcp" else {}),
    }
    mcp_observability.trace("tool_call_started", **trace_fields)
    try:
        result = await asyncio.wait_for(
            _dispatch_tool(tool_name, arguments),
            timeout=_mcp_tool_timeout_seconds(tool_name),
        )
        result_category = mcp_observability.tool_result_category(result)
        mcp_observability.trace(
            "tool_call_completed",
            **trace_fields,
            response_status=500 if result_category == "tool_error" else 200,
            result_category=result_category,
            completed=True,
        )
        if result_category == "tool_error" and isinstance(result, list):
            result = CallToolResult(content=result, isError=True)
        return result
    except Exception as error:
        failure = mcp_observability.typed_failure(
            error,
            dependency="mcp" if transport == "mcp" else "tool-runtime",
        )
        mcp_observability.trace(
            "tool_call_failed",
            **trace_fields,
            response_status=500,
            result_category="tool_error",
            exception_class=error.__class__.__name__,
            completed=True,
        )
        result = CallToolResult(
            content=[
                TextContent(
                    type="text",
                    text=json.dumps({
                        key: failure[key]
                        for key in (
                            "ok",
                            "error",
                            "failureCode",
                            "errorCategory",
                            "retryable",
                            "dependency",
                        )
                    }),
                )
            ],
            isError=True,
        )
        return result


async def call_tool(name: str, arguments: dict[str, Any]) -> Any:
    return await _execute_tool_request(
        name,
        arguments,
        transport="mcp",
    )


async def _server_list_resources(
    _context: Any,
    _params: PaginatedRequestParams | None,
) -> ListResourcesResult:
    return ListResourcesResult(resources=await list_resources())


async def _server_list_tools(
    _context: Any,
    _params: PaginatedRequestParams | None,
) -> ListToolsResult:
    return ListToolsResult(tools=await mcp_catalog_runtime.list_tools())


async def _server_call_tool(
    _context: Any,
    params: CallToolRequestParams,
) -> CallToolResult:
    result = await call_tool(params.name, dict(params.arguments or {}))
    if isinstance(result, CallToolResult):
        return result
    if isinstance(result, list):
        return CallToolResult(content=result)
    raise RuntimeError(f"mcp_tool_result_invalid:{params.name}")


server = ToolChangeNotificationServer(
    _PUBLIC_MCP_NAME,
    version=_MCP_IMPLEMENTATION_VERSION,
    description=_PUBLIC_MCP_DESCRIPTION,
    instructions=_PUBLIC_MCP_DESCRIPTION,
    get_tool_input_schema=mcp_catalog_runtime._listed_tool_input_schema,
    on_list_resources=_server_list_resources,
    on_list_tools=_server_list_tools,
    on_call_tool=_server_call_tool,
)


async def _run_stdio() -> None:
    try:
        try:
            command, args, cwd = mcp_provider_operations._cbm_config()
            await mcp_cbm_provider._start_cbm_client(
                command,
                args,
                cwd,
                implementation_version=_MCP_IMPLEMENTATION_VERSION,
                request_timeout_seconds=(
                    mcp_provider_operations._CBM_REQUEST_TIMEOUT_SECONDS
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
        await mcp_catalog_runtime._initialize_catalog_once()
        mcp_catalog_runtime._catalog_or_error()
        async with stdio_server() as (read_stream, write_stream):
            await server.run(read_stream, write_stream, server.create_initialization_options())
    finally:
        await mcp_graphiti_provider._close_graphiti()
        await mcp_cbm_provider._close_cbm()


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


async def _run_streamable_http() -> None:
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

    config_values = mcp_auth._oauth_config()

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
            command, args, cwd = mcp_provider_operations._cbm_config()
            await mcp_cbm_provider._start_cbm_client(
                command,
                args,
                cwd,
                implementation_version=_MCP_IMPLEMENTATION_VERSION,
                request_timeout_seconds=(
                    mcp_provider_operations._CBM_REQUEST_TIMEOUT_SECONDS
                ),
            )
        except Exception:
            # Catalog diagnostics retain the exact dependency failure while the
            # MCP transport and non-CBM capabilities remain available.
            pass
        catalog_task = mcp_catalog_runtime._start_catalog_initialization()
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
            await mcp_graphiti_provider._close_graphiti()
            await mcp_cbm_provider._close_cbm()

    async def health_endpoint(_request: Any) -> JSONResponse:
        diagnostics = mcp_catalog_runtime._catalog_diagnostics()
        return JSONResponse(
            {
                "ok": diagnostics["catalogState"] != "failed",
                **diagnostics,
            },
            status_code=200,
        )

    async def readiness_endpoint(_request: Any) -> JSONResponse:
        diagnostics = mcp_catalog_runtime._catalog_diagnostics()
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

    async def catalog_readiness_endpoint(_request: Any) -> JSONResponse:
        diagnostics = mcp_catalog_runtime._catalog_diagnostics()
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
        Route("/health/catalog", endpoint=catalog_readiness_endpoint, methods=["GET"]),
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
            resource_name=_PUBLIC_MCP_NAME,
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


async def main() -> None:
    if MCP_TRANSPORT == "stdio":
        # The stdio boundary performs schema-only catalog discovery before the
        # protocol handshake. Live Graphiti providers remain lazy, and CBM
        # indexing remains an explicit application-MCP administrative call.
        await _run_stdio()
        return
    if MCP_TRANSPORT == "streamable-http":
        await _run_streamable_http()
        return
    raise RuntimeError(f"unsupported_mcp_transport: {MCP_TRANSPORT}")


if __name__ == "__main__":
    asyncio.run(main())
