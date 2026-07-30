"""LiquidAIty Python MCP host (stdio) — THE one MCP host the Harness launches.

Launch shape: localcoder/scripts/start-grpc.ts resolves this venv's python.exe
and this file's absolute path from the real repo layout, validates both exist,
and the gRPC Harness (localcoder/src/grpc/server.ts) spawns them as ONE stdio
MCP client for the server's lifetime — before any chat work is accepted. No
env vars, no .env, no per-turn spawn, no fallback host.

Exposes this application tool surface plus the dynamically discovered native
Engraphis, Codebase Memory, and official Graphiti MCP registries:
  * mag_one.describe_connected_agents (read connected, bus-eligible Mag One cards)
  * run_mag_one                      (Main-only approved AgentGraph assignment)
  * thinkgraph.get_graph_slice       (bounded product projection)
  * web_search                       (real Tavily search; Search Agent only by grant)
  * canvas.inspect / card.update_configuration / canvas.upsert_wire /
    card.run_assistant_agent         (user-directed Harness control surface;
                                      handlers live in app.control_plane — Python)

Bridge tools are thin transport to the backend's existing /api/coder/mcp-bridge/*
endpoints on loopback — the backend remains the single authority for deck state,
conversation store, card resolution, and graph persistence. Control tools dispatch
to Python handlers (app/control_plane.py) which own validation/policy and use the
existing backend deck routes. No semantics,
no fallback lives in this host.

ThinkGraph mutation is an explicit Main Chat grant; official Graphiti ingestion
is an explicit Hermes-only grant. Native tools keep their upstream schemas,
annotations, dispatch, and results; this host adds only provider namespaces and
authentication. Graph authorities never appear as cards or conversational agents.
"""

from __future__ import annotations

import asyncio
import atexit
import copy
import hashlib
import inspect
import json
import os
import queue
import subprocess
import sys
import threading
import time
from collections import deque
from dataclasses import dataclass
from datetime import datetime, timezone
from uuid import uuid4

# Bootstrap the package root onto sys.path. The gRPC harness launches this host as a
# SCRIPT (`python .../apps/python-models/app/mcp_host.py`), so sys.path[0] is the
# `app/` dir and the `app` package (rooted at apps/python-models) is NOT importable —
# which broke every `from app...` control handler at call time ("No module named
# 'app'"). Adding the package root here (the ONE launch/bootstrap boundary) makes all
# `app.*` imports resolve, for every tool. Not a per-tool sys.path hack.
_PACKAGE_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _PACKAGE_ROOT not in sys.path:
    sys.path.insert(0, _PACKAGE_ROOT)

from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from dotenv import load_dotenv
from mcp.server import Server
from mcp.server.auth.middleware.auth_context import get_access_token
from mcp.server.auth.provider import AccessToken
from mcp.server.lowlevel.server import NotificationOptions
from mcp.server.stdio import stdio_server
from mcp.types import CallToolResult, TextContent, Tool

_REPO_ROOT = os.path.dirname(os.path.dirname(_PACKAGE_ROOT))
load_dotenv(os.path.join(_REPO_ROOT, "apps", "backend", ".env"), override=False)

BACKEND = os.environ.get("LIQUIDAITY_BACKEND_URL", "http://127.0.0.1:4000").rstrip("/")
MCP_TRANSPORT = os.environ.get("LIQUIDAITY_MCP_TRANSPORT", "stdio").strip().lower()
HTTP_MCP_HOST = "127.0.0.1"
HTTP_MCP_PORT = int(os.environ.get("LIQUIDAITY_HTTP_MCP_PORT", "8765"))
HTTP_MCP_PATH = "/mcp"
PUBLIC_MCP_RESOURCE_URL = os.environ.get(
    "LIQUIDAITY_PUBLIC_MCP_RESOURCE_URL",
    "https://exemption-unstable-wolverine.ngrok-free.dev/mcp",
).strip()
AUTH0_ISSUER_URL = os.environ.get("LIQUIDAITY_AUTH0_ISSUER_URL", "").strip()
AUTH0_AUDIENCE = os.environ.get("LIQUIDAITY_AUTH0_AUDIENCE", "").strip()
AUTH0_CLIENT_ID = os.environ.get("LIQUIDAITY_AUTH0_CLIENT_ID", "").strip()
AUTH0_REQUIRED_SCOPE = os.environ.get("LIQUIDAITY_AUTH0_REQUIRED_SCOPE", "liquidaity.main").strip()
OAUTH_ENFORCED = os.environ.get("LIQUIDAITY_MCP_OAUTH_ENFORCED", "false").strip().lower() in {
    "1", "true", "yes", "on",
}
_STARTUP_ID = uuid4().hex
_STARTUP_PROCESS_ID = os.getpid()
_TRACE_LOCK = threading.Lock()


def _safe_hash(value: Any) -> str:
    text = str(value or "").strip()
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16] if text else ""


def _trace(event: str, **fields: Any) -> None:
    """Emit bounded MCP diagnostics to stderr without request or product data."""
    allowed = {
        "catalog_count",
        "catalog_hash",
        "client_hash",
        "completed",
        "exception_class",
        "http_method",
        "mcp_method",
        "response_status",
        "result_category",
        "session_hash",
        "subject_hash",
        "tool_name",
        "user_agent",
    }
    payload = {
        "utc": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "startupId": _STARTUP_ID,
        "processId": _STARTUP_PROCESS_ID,
        "event": event,
        **{
            key: value
            for key, value in fields.items()
            if key in allowed and value not in (None, "")
        },
    }
    with _TRACE_LOCK:
        print(
            "[liquidaity-mcp-trace] "
            + json.dumps(payload, ensure_ascii=False, sort_keys=True),
            file=sys.stderr,
            flush=True,
        )


def _oauth_trace_fields() -> dict[str, str]:
    access_token = get_access_token()
    if access_token is None:
        return {}
    return {
        "subject_hash": _safe_hash(access_token.subject),
        "client_hash": _safe_hash(access_token.client_id),
    }


def _catalog_identity(tools: list[Tool]) -> tuple[int, str]:
    descriptors = sorted(
        (
            tool.model_dump(by_alias=True, exclude_none=True)
            for tool in tools
        ),
        key=lambda descriptor: str(descriptor.get("name") or ""),
    )
    digest = hashlib.sha256(
        json.dumps(
            descriptors,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    ).hexdigest()
    return len(descriptors), digest


@dataclass(frozen=True)
class OAuthConfig:
    resource_url: str
    issuer_url: str
    audience: str
    client_id: str
    required_scope: str


def _oauth_config() -> OAuthConfig:
    issuer = AUTH0_ISSUER_URL.rstrip("/") + "/" if AUTH0_ISSUER_URL else ""
    config = OAuthConfig(
        resource_url=PUBLIC_MCP_RESOURCE_URL.rstrip("/"),
        issuer_url=issuer,
        audience=AUTH0_AUDIENCE.rstrip("/"),
        client_id=AUTH0_CLIENT_ID,
        required_scope=AUTH0_REQUIRED_SCOPE,
    )
    if not OAUTH_ENFORCED:
        return config
    missing = [
        name
        for name, value in (
            ("LIQUIDAITY_PUBLIC_MCP_RESOURCE_URL", config.resource_url),
            ("LIQUIDAITY_AUTH0_ISSUER_URL", config.issuer_url),
            ("LIQUIDAITY_AUTH0_AUDIENCE", config.audience),
            ("LIQUIDAITY_AUTH0_CLIENT_ID", config.client_id),
        )
        if not value
    ]
    if missing:
        raise RuntimeError(f"oauth_config_missing: {','.join(missing)}")
    if not config.resource_url.startswith("https://") or not config.resource_url.endswith(HTTP_MCP_PATH):
        raise RuntimeError("oauth_resource_url_must_be_canonical_https_mcp")
    if config.audience != config.resource_url:
        raise RuntimeError("oauth_audience_must_equal_resource_url")
    if not config.issuer_url.startswith("https://"):
        raise RuntimeError("oauth_issuer_must_be_https")
    if config.required_scope != "liquidaity.main":
        raise RuntimeError("oauth_required_scope_must_be_liquidaity.main")
    return config


def _authenticated_main_context() -> dict[str, Any] | None:
    access_token = get_access_token()
    context = (access_token.claims or {}).get("liquidaity") if access_token else None
    return context if isinstance(context, dict) else None


class LiquidAItyServer(Server):
    def create_initialization_options(
        self,
        notification_options: NotificationOptions | None = None,
        experimental_capabilities: dict[str, dict[str, Any]] | None = None,
    ):
        options = super().create_initialization_options(
            notification_options or NotificationOptions(tools_changed=True),
            experimental_capabilities,
        )
        context = _authenticated_main_context()
        if context is not None:
            options.instructions = str(context.get("instructions") or "") or None
        return options


server = LiquidAItyServer("liquidaity")

_NATIVE_ENGRAPHIS_MCP: Any | None = None
_NATIVE_ENGRAPHIS_TOOLS: tuple[Tool, ...] | None = None
_NATIVE_ENGRAPHIS_NAMES: frozenset[str] = frozenset()
_NATIVE_ENGRAPHIS_CALL_LOCK = threading.Lock()
_NATIVE_CBM_CLIENT: "_NativeStdioMcpClient | None" = None
_NATIVE_CBM_TOOLS: tuple[Tool, ...] | None = None
_NATIVE_CBM_NAMES: frozenset[str] = frozenset()
_NATIVE_CBM_INIT_LOCK = threading.Lock()
_NATIVE_GRAPHITI_MODULE: Any | None = None
_NATIVE_GRAPHITI_TOOLS: tuple[Tool, ...] | None = None
_NATIVE_GRAPHITI_NAMES: frozenset[str] = frozenset()

_NATIVE_PREFIXES = {
    "cbm": "cbm.",
    "engraphis": "engraphis.",
    "graphiti": "graphiti.",
}


def _namespace_native_tools(provider: str, tools: list[Tool]) -> list[Tool]:
    """Add only a generated routing prefix; preserve every upstream field."""
    prefix = _NATIVE_PREFIXES[provider]
    result: list[Tool] = []
    for tool in tools:
        payload = tool.model_dump(by_alias=True, exclude_none=True)
        payload["name"] = prefix + tool.name
        result.append(Tool.model_validate(payload))
    return result


@server.list_resources()
async def list_resources() -> list[Any]:
    _trace(
        "resources_list",
        mcp_method="resources/list",
        response_status=200,
        result_category="empty_catalog",
        completed=True,
        **_oauth_trace_fields(),
    )
    return []


def _load_native_engraphis_mcp():
    """Import Engraphis' FastMCP registry after binding ThinkGraph's database."""
    repo_root = os.path.dirname(os.path.dirname(_PACKAGE_ROOT))
    # This host is the local LiquidAIty workbench boundary. The configured
    # SentenceTransformer model is already cached locally; allowing Hugging Face
    # metadata requests here can leave the first external MCP tool call waiting on
    # the network long enough for ChatGPT to disable the otherwise healthy connector.
    os.environ.setdefault("HF_HUB_OFFLINE", "1")
    os.environ.setdefault(
        "ENGRAPHIS_DB_PATH",
        os.environ.get(
            "THINKGRAPH_ENGRAPHIS_DB",
            os.path.join(repo_root, "db", "thinkgraph-engraphis-v2.sqlite"),
        ),
    )
    from engraphis.mcp_server import mcp

    return mcp


async def _initialize_native_engraphis() -> None:
    """Discover Engraphis once, before the outer MCP server accepts requests.

    The installed MCP SDK has no public server-mount/import API. Calling the
    nested FastMCP ``list_tools`` method from the outer low-level server's own
    ``tools/list`` callback stalls that stdio request. Startup discovery keeps
    Engraphis' original Tool objects and handlers while removing that nested
    request-lifecycle interaction.
    """
    global _NATIVE_ENGRAPHIS_MCP, _NATIVE_ENGRAPHIS_NAMES, _NATIVE_ENGRAPHIS_TOOLS
    if _NATIVE_ENGRAPHIS_TOOLS is not None:
        return
    native_mcp = _load_native_engraphis_mcp()
    tools = tuple(await native_mcp.list_tools())
    names = [tool.name for tool in tools]
    if len(names) != len(set(names)):
        raise RuntimeError("native_engraphis_duplicate_tool_name")
    _NATIVE_ENGRAPHIS_MCP = native_mcp
    _NATIVE_ENGRAPHIS_TOOLS = tools
    _NATIVE_ENGRAPHIS_NAMES = frozenset(names)


def _native_engraphis_mcp():
    """Return the initialized native Engraphis FastMCP registry."""
    if _NATIVE_ENGRAPHIS_MCP is None:
        raise RuntimeError("native_engraphis_not_initialized")
    return _NATIVE_ENGRAPHIS_MCP


async def _native_engraphis_tools() -> list[Tool]:
    """Return the original native Engraphis Tool objects discovered at startup."""
    await _initialize_native_engraphis()
    return list(_NATIVE_ENGRAPHIS_TOOLS or ())


def _call_native_engraphis(name: str, arguments: dict[str, Any]):
    """Run Engraphis' native dispatcher without blocking the outer MCP loop.

    FastMCP 1.28 executes synchronous registered functions inline. Engraphis
    initializes its local embedding model on the first tool call, so delegating
    on the outer server's event loop prevents stdio from sending any response.
    One serialized worker preserves FastMCP's native validation/handler path and
    the service's original single-request execution semantics.
    """
    with _NATIVE_ENGRAPHIS_CALL_LOCK:
        return asyncio.run(_native_engraphis_mcp().call_tool(name, arguments))


def _graphiti_config():
    """Build the official Graphiti config from LiquidAIty's existing authorities."""
    from config.schema import GraphitiConfig

    openrouter_key = os.environ.get("OPENROUTER_API_KEY") or None
    openrouter_url = os.environ.get("OPENROUTER_BASE_URL") or "https://openrouter.ai/api/v1"
    openai_key = os.environ.get("OPENAI_API_KEY") or None
    return GraphitiConfig(
        database={
            "provider": "neo4j",
            "providers": {
                "neo4j": {
                    "uri": os.environ.get("NEO4J_URI", "bolt://localhost:7687"),
                    "username": os.environ.get("NEO4J_USER", "neo4j"),
                    "password": os.environ.get("NEO4J_PASSWORD") or None,
                    "database": os.environ.get("NEO4J_DATABASE", "neo4j"),
                }
            },
        },
        llm={
            "provider": "openai",
            "model": os.environ.get(
                "OPENROUTER_DEFAULT_KG_MODEL_KEY",
                os.environ.get("OPENROUTER_DEFAULT_MODEL", "z-ai/glm-5.2"),
            ),
            "providers": {
                "openai": {
                    "api_key": openrouter_key,
                    "api_url": openrouter_url,
                }
            },
        },
        embedder={
            "provider": "openai",
            "model": os.environ.get("GRAPHITI_EMBEDDER_MODEL", "text-embedding-3-small"),
            "providers": {
                "openai": {
                    "api_key": openai_key,
                    "api_url": os.environ.get("OPENAI_BASE_URL", "https://api.openai.com/v1"),
                }
            },
        },
        graphiti={
            "group_id": "liquidaity",
            "user_id": "liquidaity-mcp",
        },
    )


async def _initialize_native_graphiti() -> None:
    """Initialize the installed official Graphiti MCP server exactly once."""
    global _NATIVE_GRAPHITI_MODULE, _NATIVE_GRAPHITI_NAMES, _NATIVE_GRAPHITI_TOOLS
    if _NATIVE_GRAPHITI_TOOLS is not None:
        return
    import graphiti_mcp_server as native

    native.config = _graphiti_config()
    native.graphiti_service = native.GraphitiService(native.config, native.SEMAPHORE_LIMIT)
    native.queue_service = native.QueueService()
    await native.graphiti_service.initialize()
    native.graphiti_client = await native.graphiti_service.get_client()
    native.semaphore = native.graphiti_service.semaphore
    await native.queue_service.initialize(native.graphiti_client)
    tools = tuple(await native.mcp.list_tools())
    names = [tool.name for tool in tools]
    if len(names) != len(set(names)):
        raise RuntimeError("native_graphiti_duplicate_tool_name")
    _NATIVE_GRAPHITI_MODULE = native
    _NATIVE_GRAPHITI_TOOLS = tools
    _NATIVE_GRAPHITI_NAMES = frozenset(names)


async def _native_graphiti_tools() -> list[Tool]:
    await _initialize_native_graphiti()
    return list(_NATIVE_GRAPHITI_TOOLS or ())


async def _call_native_graphiti(name: str, arguments: dict[str, Any]):
    if _NATIVE_GRAPHITI_MODULE is None:
        raise RuntimeError("native_graphiti_not_initialized")
    return await _NATIVE_GRAPHITI_MODULE.mcp.call_tool(name, arguments)


async def _close_native_graphiti() -> None:
    global _NATIVE_GRAPHITI_MODULE, _NATIVE_GRAPHITI_NAMES, _NATIVE_GRAPHITI_TOOLS
    native = _NATIVE_GRAPHITI_MODULE
    _NATIVE_GRAPHITI_MODULE = None
    _NATIVE_GRAPHITI_TOOLS = None
    _NATIVE_GRAPHITI_NAMES = frozenset()
    client = getattr(native, "graphiti_client", None) if native is not None else None
    driver = getattr(client, "driver", None)
    close = getattr(driver, "close", None)
    if callable(close):
        result = close()
        if inspect.isawaitable(result):
            await result


class _NativeStdioMcpClient:
    """One serialized JSON-RPC session to the installed native CBM server."""

    def __init__(self, command: str, args: list[str], cwd: str):
        creation_flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
        self._process = subprocess.Popen(
            [command, *args],
            cwd=cwd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
            creationflags=creation_flags,
        )
        self._responses: queue.Queue[dict[str, Any]] = queue.Queue()
        self._stderr: deque[str] = deque(maxlen=12)
        self._request_lock = threading.Lock()
        self._next_id = 0
        threading.Thread(
            target=self._read_stdout,
            name="liquidaity-native-cbm-stdout",
            daemon=True,
        ).start()
        threading.Thread(
            target=self._read_stderr,
            name="liquidaity-native-cbm-stderr",
            daemon=True,
        ).start()
        initialized = self._request(
            "initialize",
            {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {
                    "name": "liquidaity-native-cbm",
                    "version": "1.0.0",
                },
            },
        )
        if not isinstance(initialized.get("serverInfo"), dict):
            raise RuntimeError("native_cbm_initialize_invalid")
        self._notify("notifications/initialized", {})

    def _read_stdout(self) -> None:
        stream = self._process.stdout
        if stream is None:
            self._responses.put({"__eof__": True})
            return
        try:
            for line in stream:
                text = line.strip()
                if not text:
                    continue
                try:
                    message = json.loads(text)
                except json.JSONDecodeError:
                    self._responses.put(
                        {"__protocol_error__": "native_cbm_invalid_json_response"}
                    )
                    continue
                if isinstance(message, dict):
                    self._responses.put(message)
        finally:
            self._responses.put({"__eof__": True})

    def _read_stderr(self) -> None:
        stream = self._process.stderr
        if stream is None:
            return
        for line in stream:
            text = line.strip()
            if text:
                self._stderr.append(text[:500])

    def _write(self, payload: dict[str, Any]) -> None:
        stream = self._process.stdin
        if stream is None or self._process.poll() is not None:
            raise RuntimeError("native_cbm_process_not_running")
        stream.write(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n")
        stream.flush()

    def _notify(self, method: str, params: dict[str, Any]) -> None:
        self._write({"jsonrpc": "2.0", "method": method, "params": params})

    def _request(self, method: str, params: dict[str, Any]) -> dict[str, Any]:
        with self._request_lock:
            self._next_id += 1
            request_id = self._next_id
            self._write(
                {
                    "jsonrpc": "2.0",
                    "id": request_id,
                    "method": method,
                    "params": params,
                }
            )
            deadline = time.monotonic() + 30.0
            while True:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise RuntimeError(f"native_cbm_timeout:{method}")
                try:
                    message = self._responses.get(timeout=remaining)
                except queue.Empty as exc:
                    raise RuntimeError(f"native_cbm_timeout:{method}") from exc
                if message.get("__eof__"):
                    tail = " | ".join(self._stderr)
                    raise RuntimeError(
                        f"native_cbm_process_exited:{self._process.poll()}:{tail}"
                    )
                if message.get("__protocol_error__"):
                    raise RuntimeError(str(message["__protocol_error__"]))
                if message.get("id") != request_id:
                    continue
                error = message.get("error")
                if isinstance(error, dict):
                    raise RuntimeError(
                        "native_cbm_protocol_error:"
                        + json.dumps(error, ensure_ascii=False, sort_keys=True)
                    )
                result = message.get("result")
                if not isinstance(result, dict):
                    raise RuntimeError(f"native_cbm_invalid_result:{method}")
                return result

    def list_tools(self) -> list[Tool]:
        tools: list[Tool] = []
        cursor: str | None = None
        seen_cursors: set[str] = set()
        while True:
            params = {"cursor": cursor} if cursor else {}
            result = self._request("tools/list", params)
            page = result.get("tools")
            if not isinstance(page, list):
                raise RuntimeError("native_cbm_tools_list_invalid")
            tools.extend(Tool.model_validate(tool) for tool in page)
            next_cursor = result.get("nextCursor")
            if not isinstance(next_cursor, str) or not next_cursor:
                return tools
            if next_cursor in seen_cursors:
                raise RuntimeError("native_cbm_tools_cursor_cycle")
            seen_cursors.add(next_cursor)
            cursor = next_cursor

    def call_tool(self, name: str, arguments: dict[str, Any]) -> CallToolResult:
        result = self._request(
            "tools/call",
            {"name": name, "arguments": dict(arguments or {})},
        )
        return CallToolResult.model_validate(result)

    def close(self) -> None:
        if self._process.poll() is not None:
            return
        self._process.terminate()
        try:
            self._process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self._process.kill()
            self._process.wait(timeout=5)


def _native_cbm_config() -> tuple[str, list[str], str]:
    """Read the same native CBM stdio command used by the backend."""
    repo_root = os.path.dirname(os.path.dirname(_PACKAGE_ROOT))
    config_path = os.path.join(repo_root, "apps", "backend", "mcp.config.json")
    with open(config_path, encoding="utf-8") as stream:
        configured = (json.load(stream).get("mcpServers") or {}).get("codebase-memory")
    if not isinstance(configured, dict) or configured.get("transport") not in (None, "stdio"):
        raise RuntimeError("native_cbm_stdio_config_missing")
    command = os.path.expandvars(str(configured.get("command") or "")).strip()
    args = configured.get("args") or []
    if not command or not isinstance(args, list):
        raise RuntimeError("native_cbm_stdio_config_invalid")
    return command, [str(arg) for arg in args], repo_root


def _initialize_native_cbm_sync() -> None:
    global _NATIVE_CBM_CLIENT, _NATIVE_CBM_NAMES, _NATIVE_CBM_TOOLS
    if _NATIVE_CBM_TOOLS is not None:
        return
    with _NATIVE_CBM_INIT_LOCK:
        if _NATIVE_CBM_TOOLS is not None:
            return
        command, args, cwd = _native_cbm_config()
        client = _NativeStdioMcpClient(command, args, cwd)
        try:
            tools = tuple(client.list_tools())
            names = [tool.name for tool in tools]
            if len(names) != len(set(names)):
                raise RuntimeError("native_cbm_duplicate_tool_name")
        except Exception:
            client.close()
            raise
        _NATIVE_CBM_CLIENT = client
        _NATIVE_CBM_TOOLS = tools
        _NATIVE_CBM_NAMES = frozenset(names)


async def _native_cbm_tools() -> list[Tool]:
    await asyncio.to_thread(_initialize_native_cbm_sync)
    return list(_NATIVE_CBM_TOOLS or ())


def _call_native_cbm(name: str, arguments: dict[str, Any]) -> CallToolResult:
    _initialize_native_cbm_sync()
    if _NATIVE_CBM_CLIENT is None:
        raise RuntimeError("native_cbm_not_initialized")
    return _NATIVE_CBM_CLIENT.call_tool(name, arguments)


def _close_native_cbm() -> None:
    global _NATIVE_CBM_CLIENT
    client = _NATIVE_CBM_CLIENT
    _NATIVE_CBM_CLIENT = None
    if client is not None:
        client.close()


atexit.register(_close_native_cbm)


def _bridge_sync(path: str, payload: dict[str, Any]) -> str:
    request = Request(
        f"{BACKEND}/api/coder/mcp-bridge/{path}",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=300) as response:  # noqa: S310 — loopback backend only
            return response.read().decode("utf-8")
    except HTTPError as err:
        try:
            body = err.read().decode("utf-8")
        except Exception:
            body = ""
        return body or json.dumps({"ok": False, "error": f"backend_http_{err.code}"})
    except URLError as err:
        return json.dumps({"ok": False, "error": f"backend_unreachable: {err.reason}"})


def _resolve_external_main_context_sync(issuer: str, subject: str) -> dict[str, Any] | None:
    try:
        payload = json.loads(_bridge_sync("external_main_context", {"issuer": issuer, "subject": subject}))
    except (TypeError, ValueError):
        return None
    context = payload.get("context") if isinstance(payload, dict) and payload.get("ok") is True else None
    required = {
        "projectId",
        "deckId",
        "conversationId",
        "parentRunId",
        "mainCardId",
    }
    return context if isinstance(context, dict) and required.issubset(context) else None


class Auth0TokenVerifier:
    """Verify Auth0 JWTs and bind the principal to one owned LiquidAIty project."""

    def __init__(self, config: OAuthConfig, jwk_client: Any | None = None):
        from jwt import PyJWKClient

        self.config = config
        self.jwk_client = jwk_client or PyJWKClient(f"{config.issuer_url}.well-known/jwks.json")
        self._context_cache: dict[tuple[str, str], tuple[float, dict[str, Any]]] = {}
        self._context_cache_lock = threading.Lock()

    def _principal_context(
        self,
        subject: str,
        *,
        token_expires_at: int,
    ) -> dict[str, Any] | None:
        key = (self.config.issuer_url, subject)
        now = time.time()
        with self._context_cache_lock:
            cached = self._context_cache.get(key)
            if cached is not None and cached[0] > now:
                return dict(cached[1])
        context = _resolve_external_main_context_sync(*key)
        if context is None:
            return None
        expires_at = min(float(token_expires_at), now + 300.0)
        with self._context_cache_lock:
            self._context_cache[key] = (expires_at, dict(context))
        return context

    def _verify_sync(self, token: str) -> AccessToken | None:
        import jwt

        try:
            header = jwt.get_unverified_header(token)
            if header.get("alg") != "RS256":
                return None
            signing_key = self.jwk_client.get_signing_key_from_jwt(token).key
            claims = jwt.decode(
                token,
                signing_key,
                algorithms=["RS256"],
                audience=self.config.audience,
                issuer=self.config.issuer_url,
                options={"require": ["exp", "iat", "sub"]},
            )
            client_id = str(claims.get("azp") or claims.get("client_id") or "").strip()
            if client_id != self.config.client_id:
                return None
            raw_scope = claims.get("scope") or ""
            scopes = raw_scope.split() if isinstance(raw_scope, str) else [str(value) for value in raw_scope]
            if self.config.required_scope not in scopes:
                return None
            subject = str(claims.get("sub") or "").strip()
            if not subject:
                return None
            context = self._principal_context(
                subject,
                token_expires_at=int(claims["exp"]),
            )
            if context is None:
                return None
            return AccessToken(
                token=token,
                client_id=client_id,
                scopes=scopes,
                expires_at=int(claims["exp"]),
                resource=self.config.resource_url,
                subject=subject,
                claims={**claims, "liquidaity": context},
            )
        except Exception:
            return None

    async def verify_token(self, token: str) -> AccessToken | None:
        return await asyncio.to_thread(self._verify_sync, token)


async def _bridge(path: str, payload: dict[str, Any]) -> list[TextContent]:
    text = await asyncio.to_thread(_bridge_sync, path, payload)
    return [TextContent(type="text", text=text)]


@server.list_tools()
async def list_tools() -> list[Tool]:
    tools = [
        Tool(
            name="main.context",
            description=(
                "Read the compact server-owned Main entry context for this authenticated "
                "LiquidAIty connection: project, deck, conversation, parent run, and saved "
                "Main-card identities. Accepts no caller-supplied identity or context payload."
            ),
            inputSchema={"type": "object", "properties": {}, "required": []},
        ),
        Tool(
            name="agentgraph.inspect",
            description=(
                "Read AgentGraph assignments and correlated results from the existing PostgreSQL/AGE "
                "runtime fabric. Returns one exact assignment when assignmentId is supplied, otherwise "
                "a bounded conversation or project summary. Project, deck, and conversation identity "
                "are supplied by the authenticated server."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "assignmentId": {"type": "string"},
                    "limit": {"type": "integer", "minimum": 1, "maximum": 50, "default": 20},
                    "projectWide": {"type": "boolean", "default": False},
                },
                "required": [],
            },
        ),
        Tool(
            name="graphview.list",
            description=(
                "List bounded AgentGraph reference views for the current project and conversation. "
                "Returns stable view identities and pointers only; source graph records and "
                "artifacts remain in their canonical authorities."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "projectId": {"type": "string"},
                    "conversationId": {"type": "string"},
                    "limit": {"type": "integer", "minimum": 1, "maximum": 50, "default": 20},
                    "projectWide": {"type": "boolean", "default": False},
                },
                "required": ["projectId", "conversationId"],
            },
        ),
        Tool(
            name="graphview.get",
            description=(
                "Read one exact AgentGraph reference view by stable viewId. Returns pointer "
                "identities only and fails honestly when the view is absent."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "projectId": {"type": "string"},
                    "conversationId": {"type": "string"},
                    "viewId": {"type": "string"},
                    "projectWide": {"type": "boolean", "default": False},
                },
                "required": ["projectId", "conversationId", "viewId"],
            },
        ),
        Tool(
            name="graphview.create",
            description=(
                "Create one bounded AgentGraph view containing stable references to canonical "
                "graphs, artifacts, or real-time outputs. Never accepts copied graph records, "
                "relationships, raw SQL, or raw Cypher."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "projectId": {"type": "string"},
                    "conversationId": {"type": "string"},
                    "correlationId": {"type": "string"},
                    "displayLabel": {"type": "string"},
                    "receivingRole": {"type": "string"},
                    "references": {
                        "type": "array",
                        "maxItems": 128,
                        "items": {
                            "type": "object",
                            "additionalProperties": False,
                            "properties": {
                                "referenceId": {"type": "string"},
                                "referenceType": {
                                    "type": "string",
                                    "enum": [
                                        "artifact",
                                        "codegraph",
                                        "conversation_message",
                                        "database",
                                        "knowgraph",
                                        "native_session",
                                        "query_execution",
                                        "registered_query",
                                        "thinkgraph",
                                        "worldsignals",
                                    ],
                                },
                                "required": {"type": "boolean", "default": False},
                            },
                            "required": ["referenceId", "referenceType"],
                        },
                    },
                    "note": {"type": "string"},
                    "parentViewId": {"type": "string"},
                },
                "required": [
                    "projectId",
                    "conversationId",
                    "correlationId",
                    "displayLabel",
                    "references",
                ],
            },
        ),
        Tool(
            name="coder.status",
            description=(
                "Read the canonical OpenClaude Coder session/process state. Reports running only "
                "when the backend's live session owner has a starting or running process; historical "
                "AgentGraph assignments are not process evidence."
            ),
            inputSchema={"type": "object", "properties": {}, "required": []},
        ),
        Tool(
            name="run_coder_subagent",
            description=(
                "Main Chat only: send one approved coding assignment from the saved connected Coder card "
                "directly to the existing visible OpenClaude Code terminal. The server owns project, deck, "
                "conversation, parent-run, and Main-card identity. Callers provide approvedPrompt, the saved "
                "Coder cardId, optional authority, and optional persisted graphViewIds. Returns the linked child "
                "run, the coder session/thread id, structured command evidence, and the CoderReport verbatim."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "parentRunId": {"type": "string"},
                    "projectId": {"type": "string"},
                    "deckId": {"type": "string"},
                    "conversationId": {"type": "string"},
                    "cardId": {"type": "string"},
                    "approvedPrompt": {"type": "string"},
                    "authority": {"type": "string", "enum": ["direct_main_audit", "mag_one_execution"]},
                    "graphViewIds": {
                        "type": "array",
                        "items": {"type": "string"},
                            "description": "AgentGraph reference-view ids to attach. IDs only; canonical graph and artifact payloads remain behind their native tools.",
                    },
                },
                "required": ["parentRunId", "projectId", "deckId", "conversationId", "cardId", "approvedPrompt"],
            },
        ),
        Tool(
            name="mag_one.describe_connected_agents",
            description=(
                "Read the currently connected, bus-eligible (magentic_option) Mag One Agent Cards and "
                "their actual capabilities before writing a run_mag_one prompt: cardId, title, "
                "role/capability, selected model, configured Python tools, and connected status. "
                "Read-only and deck-authentic — never invents agents, tools, models, or outputs. "
                "deckId is optional and defaults to the one canonical Agent Canvas deck; never "
                "guess a deckId."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "projectId": {"type": "string"},
                    "deckId": {"type": "string"},
                },
                "required": ["projectId"],
            },
        ),
        Tool(
            name="run_mag_one",
            description=(
                "Main Chat only: submit one existing AgentGraph instruction identity. "
                "Python creates and transactionally claims the assignment, hydrates the exact "
                "relational instruction, and gives that text to native MagenticOneGroupChat. "
                "The backend resolves the live worker roster from blue SIDE connections; never type "
                "a roster. Execute only on an explicit user request — Hermes never launches Mag One."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "projectId": {"type": "string"},
                    "deckId": {"type": "string"},
                    "instructionId": {"type": "string"},
                    "conversationId": {"type": "string"},
                },
                "required": ["instructionId", "projectId", "deckId"],
            },
        ),
        Tool(
            name="write_mag_one_instructions",
            description=(
                "Hermes Run Plan preparation: persist the exact proposed Mag One task as "
                "an AgentGraph instruction. Main owns presentation, review, and approval; "
                "creating the instruction never starts Mag One. Returns the stable instructionId "
                "for Main to pass to run_mag_one."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "instructions": {"type": "string"},
                    "operationReferences": {
                        "type": "array",
                        "maxItems": 16,
                        "items": {
                            "type": "object",
                            "properties": {
                                "operationId": {"type": "string"},
                                "version": {"type": "integer", "minimum": 1},
                                "executionRole": {
                                    "type": "string",
                                    "enum": ["required_context", "optional_tool"],
                                },
                                "parameters": {"type": "object"},
                                "explanation": {"type": "string"},
                            },
                            "required": [
                                "operationId",
                                "version",
                                "executionRole",
                            ],
                            "additionalProperties": False,
                        },
                    },
                },
                "required": ["instructions"],
                "additionalProperties": False,
            },
        ),
        Tool(
            name="canvas.inspect",
            description=(
                "Bounded saved canvas/deck view: cards (id, title, runtime binding/type, tools) and wires. "
                "Read-only, project-scoped, no secrets."
            ),
            inputSchema={
                "type": "object",
                "properties": {"projectId": {"type": "string"}, "deckId": {"type": "string"}},
                "required": ["projectId", "deckId"],
            },
        ),
        Tool(
            name="card.update_configuration",
            description=(
                "User-directed strict-allowlist update of one persisted card: prompt, title, "
                "modelKey, provider, temperature, maxTokens, tools. Everything else (runtime code, "
                "shell config, hidden tools, authority grants, worker selection) is rejected."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "projectId": {"type": "string"},
                    "deckId": {"type": "string"},
                    "cardId": {"type": "string"},
                    "updates": {"type": "object"},
                },
                "required": ["projectId", "deckId", "cardId", "updates"],
            },
        ),
        Tool(
            name="canvas.upsert_wire",
            description=(
                "Create/update/remove ONE saved canvas wire. Supported wire types only: 'flow' and "
                "'magentic_option'. A wire is persisted visible configuration — it never runs agents."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "projectId": {"type": "string"},
                    "deckId": {"type": "string"},
                    "op": {"type": "string", "enum": ["upsert", "remove"]},
                    "wire": {"type": "object"},
                },
                "required": ["projectId", "deckId", "op", "wire"],
            },
        ),
        Tool(
            name="thinkgraph.get_graph_slice",
            description=(
                "Bounded READ-ONLY slice of stored ThinkGraph project reasoning (resources, "
                "statements, relations, provenance pointers). No write authority exists here."
            ),
            inputSchema={
                "type": "object",
                "properties": {"projectId": {"type": "string"}, "limit": {"type": "integer"}},
                "required": ["projectId"],
            },
        ),
        Tool(
            name="thinkgraph.submit_update",
            description=(
                "Main Chat only: submit zero or ONE bounded structured ThinkGraph update after "
                "reviewing the turn or Hermes findings. Required shape: "
                "each resource is {id, label, kind?, properties?}; each relation is {a, b, tag?}; "
                "each statement is {id, subject, predicateTerm, object, rationale?, review?, tag?, properties?}. "
                "Statement subject and object MUST be resource ids in this update or existing project resources; "
                "labels and ids must be short, stable, and never paragraph text. Minimal valid example: "
                "resources:[{id:'investigation:dup-entity',label:'Duplicate entity handling',kind:'question'},"
                "{id:'system:knowgraph',label:'KnowGraph',kind:'system'}], "
                "statements:[{id:'statement:dup-entity-question',subject:'investigation:dup-entity',"
                "predicateTerm:'term:questions',object:'system:knowgraph',rationale:'Verify entity identity merge behavior.',"
                "review:'provisional'}]. To update an investigation, reuse its stable resource id and add only compact "
                "resources/statements. An empty resources/relations/statements payload is an explicit no-op. "
                "Pass real projectId and conversationId; authority/correlation are server-minted. Never store a transcript, "
                "raw tool output, hidden reasoning, or an unchanged generic summary. If validation fails, "
                "return that one error and finish—never retry by guessing another shape."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "projectId": {"type": "string"},
                    "conversationId": {"type": "string"},
                    "resources": {"type": "array", "items": {"type": "object", "required": ["id", "label"], "properties": {"id": {"type": "string"}, "label": {"type": "string"}, "kind": {"type": "string"}, "properties": {"type": "object", "additionalProperties": {"type": ["string", "number", "boolean"]}}}}},
                    "relations": {"type": "array", "items": {"type": "object", "required": ["a", "b"], "properties": {"a": {"type": "string"}, "b": {"type": "string"}, "tag": {"type": "string"}}}},
                    "statements": {"type": "array", "items": {"type": "object", "required": ["id", "subject", "predicateTerm", "object"], "properties": {"id": {"type": "string"}, "subject": {"type": "string"}, "predicateTerm": {"type": "string"}, "object": {"type": "string"}, "rationale": {"type": "string"}, "review": {"type": "string"}, "tag": {"type": "string"}, "properties": {"type": "object", "additionalProperties": {"type": ["string", "number", "boolean"]}}}}},
                },
                "required": ["projectId", "conversationId"],
            },
        ),
        Tool(
            name="hermes.memory_read",
            description=(
                "Hermes only: read your project-scoped SQL memory (private steward continuity — "
                "prior judgments, patterns, draft state). Omit key to list recent items."
            ),
            inputSchema={
                "type": "object",
                "properties": {"projectId": {"type": "string"}, "key": {"type": "string"}},
                "required": ["projectId"],
            },
        ),
        Tool(
            name="hermes.memory_write",
            description=(
                "Hermes only: upsert one key/value item in your project-scoped SQL memory. "
                "Separate from ThinkGraph — this is your private continuity, not shared project "
                "reasoning."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "projectId": {"type": "string"},
                    "key": {"type": "string"},
                    "value": {},
                },
                "required": ["projectId", "key", "value"],
            },
        ),
        Tool(
            name="hermes.read_report",
            description=(
                "Hermes only: read the exact durable result linked to this native parentRunId. "
                "The server resolves its AgentGraph assignment directly; no latest-report scan."
            ),
            inputSchema={
                "type": "object",
                "properties": {"parentRunId": {"type": "string"}},
                "required": ["parentRunId"],
            },
        ),
        Tool(
            name="hermes.write_report",
            description=(
                "Hermes only: finish one exact AgentGraph assignment with a durable report result. "
                "The server resolves project, conversation, instruction, and native session identity "
                "from parentRunId; never supply them. Include only real stable "
                "ThinkGraph node ids, KnowGraph refs, and CodeGraph refs. On success, return "
                "the completion metadata exactly; do not repeat the report body to Main Chat."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "parentRunId": {"type": "string"},
                    "reportMarkdown": {"type": "string"},
                    "summary": {"type": "string"},
                    "thinkGraphNodeIds": {"type": "array", "items": {"type": "string"}},
                    "knowGraphRefs": {"type": "array", "items": {"type": "string"}},
                    "codeGraphRefs": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["parentRunId", "reportMarkdown", "summary"],
            },
        ),
        Tool(
            name="web_search",
            description=(
                "Search the live web through Tavily and return real URLs, titles, domains, "
                "content excerpts, and available dates. Read-only; never fabricates sources."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "query": {"type": "string"},
                    "max_results": {"type": "integer", "default": 5},
                },
                "required": ["query"],
            },
        ),
        Tool(
            name="worldsignals.capabilities",
            description=(
                "Read a bounded live WorldSignals capability/command view. Filter by domain, "
                "exact command, keyword, or read/write operation class; an exact command match "
                "returns that command's current parameter schema."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "domain": {"type": "string"},
                    "command": {"type": "string"},
                    "keyword": {"type": "string"},
                    "operation_class": {"type": "string", "enum": ["read", "write"]},
                    "limit": {"type": "integer", "minimum": 1, "maximum": 50, "default": 25},
                },
                "required": [],
            },
        ),
        Tool(
            name="worldsignals.command",
            description="Run one real command from the live WorldSignals command manifest.",
            inputSchema={
                "type": "object",
                "properties": {"command": {"type": "string"}, "arguments": {"type": "object"}},
                "required": ["command"],
            },
        ),
        Tool(
            name="worldsignals.batch",
            description="Run up to twenty real WorldSignals commands through its batch channel.",
            inputSchema={
                "type": "object",
                "properties": {"commands": {"type": "array", "items": {"type": "object"}, "maxItems": 20}},
                "required": ["commands"],
            },
        ),
        Tool(
            name="worldsignals.poll",
            description="Poll completed command results and pending WorldSignals tasks.",
            inputSchema={"type": "object", "properties": {}, "required": []},
        ),
        Tool(
            name="worldsignals.stream_events",
            description="Read a bounded set of real-time events from the WorldSignals SSE channel.",
            inputSchema={
                "type": "object",
                "properties": {"max_events": {"type": "integer", "default": 1}, "timeout_seconds": {"type": "integer", "default": 15}},
                "required": [],
            },
        ),
        Tool(
            name="card.run_assistant_agent",
            description=(
                "Run ONE saved, enabled assistant_agent card with its saved prompt/model/tools. "
                "No prompt/model/tool/card overrides "
                "exist on this path — extra arguments are rejected structurally. deckId defaults to "
                "the canonical Agent Canvas deck. On the Harness saved-card doorway path, the "
                "server injects projectId/correlationId/conversationId; the model supplies the "
                "bound cardId plus the task input only. conversationId is the real live "
                "conversation this run belongs to, when one exists. Inter-agent doorway calls "
                "create an exact AgentGraph instruction and transport only its identity."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "projectId": {"type": "string"},
                    "deckId": {"type": "string"},
                    "cardId": {"type": "string"},
                    "correlationId": {"type": "string"},
                    "conversationId": {"type": "string"},
                    "instructionId": {
                        "type": "string",
                        "description": (
                            "Existing canonical AgentGraph instruction identity. "
                            "The tool transports the id unchanged."
                        ),
                    },
                    "originatingAgentId": {
                        "type": "string",
                        "description": "Server-owned saved-card identity for an inter-agent doorway call.",
                    },
                    "originatingRunId": {
                        "type": "string",
                        "description": "Server-owned parent Harness turn identity for an inter-agent doorway call.",
                    },
                    "graphViewIds": {
                        "type": "array",
                        "items": {"type": "string"},
                        "maxItems": 16,
                        "description": (
                            "Stable AgentGraph reference-view identities selected for this assignment. "
                            "Referenced data stays in its canonical authority and is resolved on demand."
                        ),
                    },
                    "input": {"type": "string"},
                },
                "required": ["cardId", "input"],
            },
        ),
    ]
    for tool in tools:
        tool.inputSchema.setdefault("additionalProperties", False)
    native_catalogs = {
        "engraphis": await _native_engraphis_tools(),
        "cbm": await _native_cbm_tools(),
        "graphiti": await _native_graphiti_tools(),
    }
    for provider, native_tools in native_catalogs.items():
        tools.extend(_namespace_native_tools(provider, native_tools))
    names = [tool.name for tool in tools]
    if len(names) != len(set(names)):
        duplicates = sorted({name for name in names if names.count(name) > 1})
        raise RuntimeError("federated_duplicate_tool_name:" + ",".join(duplicates))
    context = _authenticated_main_context()
    if context is None:
        published = tools
    else:
        published = _bind_authenticated_catalog(tools)
    catalog_count, catalog_hash = _catalog_identity(published)
    _trace(
        "catalog",
        mcp_method="tools/list",
        catalog_count=catalog_count,
        catalog_hash=catalog_hash,
        response_status=200,
        completed=True,
        **_oauth_trace_fields(),
    )
    return published


_READ_ONLY_TOOLS = {
    "main.context",
    "agentgraph.inspect",
    "graphview.list",
    "graphview.get",
    "coder.status",
    "mag_one.describe_connected_agents",
    "canvas.inspect",
    "thinkgraph.get_graph_slice",
    "worldsignals.capabilities",
    "worldsignals.poll",
    "worldsignals.stream_events",
}
_SERVER_OWNED_ARGUMENTS = {
    "projectId",
    "deckId",
    "conversationId",
    "correlationId",
    "senderAgentId",
    "originatingAgentId",
    "originatingRunId",
}


def _bind_authenticated_catalog(tools: list[Tool]) -> list[Tool]:
    """Bind OAuth metadata and hide only identities owned by the server.

    Tool names and handlers still come from the one canonical catalog assembled
    by ``list_tools``.
    """
    security_schemes = [{"type": "oauth2", "scopes": [AUTH0_REQUIRED_SCOPE]}]
    result: list[Tool] = []
    for tool in tools:
        payload = tool.model_dump(by_alias=True, exclude_none=True)
        is_native = any(tool.name.startswith(prefix) for prefix in _NATIVE_PREFIXES.values())
        if not is_native:
            schema = copy.deepcopy(tool.inputSchema)
            properties = schema.get("properties")
            if isinstance(properties, dict):
                for field in _SERVER_OWNED_ARGUMENTS:
                    properties.pop(field, None)
            required = schema.get("required")
            if isinstance(required, list):
                schema["required"] = [
                    field for field in required if field not in _SERVER_OWNED_ARGUMENTS
                ]
            if tool.name == "run_coder_subagent":
                if isinstance(properties, dict):
                    properties.pop("parentRunId", None)
                if isinstance(schema.get("required"), list):
                    schema["required"] = [
                        field for field in schema["required"] if field != "parentRunId"
                    ]
            if tool.name == "card.run_assistant_agent":
                if isinstance(properties, dict):
                    properties.pop("instructionId", None)
                if isinstance(schema.get("required"), list):
                    schema["required"] = [
                        field for field in schema["required"] if field != "instructionId"
                    ]
            payload["inputSchema"] = schema
        payload["securitySchemes"] = security_schemes
        if not is_native and tool.name in _READ_ONLY_TOOLS:
            annotations = dict(payload.get("annotations") or {})
            annotations["readOnlyHint"] = True
            payload["annotations"] = annotations
        meta = dict(payload.get("_meta") or {})
        meta["securitySchemes"] = security_schemes
        payload["_meta"] = meta
        result.append(Tool.model_validate(payload))
    return result


# Structural allow-list per tool: unexpected keys are rejected honestly, never
# silently forwarded (prevents smuggling prompts/models/patches through the host).
_ALLOWED_KEYS: dict[str, set[str]] = {
    "main.context": set(),
    "agentgraph.inspect": {
        "projectId",
        "deckId",
        "conversationId",
        "assignmentId",
        "limit",
        "projectWide",
    },
    "graphview.list": {"projectId", "conversationId", "limit", "projectWide"},
    "graphview.get": {"projectId", "conversationId", "viewId", "projectWide"},
    "graphview.create": {
        "projectId",
        "conversationId",
        "correlationId",
        "displayLabel",
        "receivingRole",
        "references",
        "note",
        "parentViewId",
    },
    "coder.status": set(),
    "run_coder_subagent": {"parentRunId", "projectId", "deckId", "conversationId", "cardId", "approvedPrompt", "authority", "graphViewIds"},
    "mag_one.describe_connected_agents": {"projectId", "deckId"},
    "run_mag_one": {"projectId", "deckId", "instructionId", "conversationId"},
    "thinkgraph.submit_update": {"projectId", "conversationId", "resources", "relations", "statements"},
    "hermes.memory_read": {"projectId", "key"},
    "hermes.memory_write": {"projectId", "key", "value"},
    "hermes.read_report": {"parentRunId"},
    "hermes.write_report": {"parentRunId", "reportMarkdown", "summary", "thinkGraphNodeIds", "knowGraphRefs", "codeGraphRefs"},
    "write_mag_one_instructions": {"instructions", "operationReferences"},
    "canvas.inspect": {"projectId", "deckId"},
    "card.update_configuration": {"projectId", "deckId", "cardId", "updates"},
    "canvas.upsert_wire": {"projectId", "deckId", "op", "wire"},
    "card.run_assistant_agent": {
        "projectId",
        "deckId",
        "cardId",
        "correlationId",
        "conversationId",
        "instructionId",
        "originatingAgentId",
        "originatingRunId",
        "graphViewIds",
        "input",
    },
    "thinkgraph.get_graph_slice": {"projectId", "limit"},
    "web_search": {"query", "max_results"},
    "worldsignals.capabilities": {"domain", "command", "keyword", "operation_class", "limit"},
    "worldsignals.command": {"command", "arguments"},
    "worldsignals.batch": {"commands"},
    "worldsignals.poll": set(),
    "worldsignals.stream_events": {"max_events", "timeout_seconds"},
}

_BRIDGE_PATHS: dict[str, str] = {
    "coder.status": "coder_status",
    "run_coder_subagent": "run_coder_subagent",
    "mag_one.describe_connected_agents": "describe_connected_agents",
    "run_mag_one": "run_mag_one",
    "thinkgraph.submit_update": "thinkgraph_submit_update",
    "hermes.memory_read": "hermes_memory_read",
    "hermes.memory_write": "hermes_memory_write",
    "hermes.read_report": "hermes_read_report",
    "hermes.write_report": "hermes_write_report",
}

# Control tools dispatch to the Python control-plane handlers (app/control_plane.py).
# Imported lazily so bridge-only usage never requires the psycopg dependency chain.
_CONTROL_HANDLER_NAMES: dict[str, str] = {
    "agentgraph.inspect": "agentgraph_inspect",
    "graphview.list": "graph_view_list",
    "graphview.get": "graph_view_get",
    "graphview.create": "graph_view_create",
    "canvas.inspect": "canvas_inspect",
    "card.update_configuration": "card_update_configuration",
    "canvas.upsert_wire": "canvas_upsert_wire",
    "card.run_assistant_agent": "card_run_assistant_agent",
    "thinkgraph.get_graph_slice": "thinkgraph_get_graph_slice",
}


async def _dispatch_tool(name: str, arguments: dict[str, Any]) -> Any:
    context = _authenticated_main_context()
    if name.startswith(_NATIVE_PREFIXES["engraphis"]):
        await _initialize_native_engraphis()
        native_name = name.removeprefix(_NATIVE_PREFIXES["engraphis"])
        if native_name in _NATIVE_ENGRAPHIS_NAMES:
            return await asyncio.to_thread(
                _call_native_engraphis,
                native_name,
                dict(arguments or {}),
            )
    if name.startswith(_NATIVE_PREFIXES["cbm"]):
        await _native_cbm_tools()
        native_name = name.removeprefix(_NATIVE_PREFIXES["cbm"])
        if native_name in _NATIVE_CBM_NAMES:
            return await asyncio.to_thread(
                _call_native_cbm,
                native_name,
                dict(arguments or {}),
            )
    if name.startswith(_NATIVE_PREFIXES["graphiti"]):
        await _initialize_native_graphiti()
        native_name = name.removeprefix(_NATIVE_PREFIXES["graphiti"])
        if native_name in _NATIVE_GRAPHITI_NAMES:
            native_args = dict(arguments or {})
            if context is not None:
                group_id = f"liquidaity:{context['projectId']}"
                if native_name in {"add_memory", "add_triplet", "summarize_saga"}:
                    native_args["group_id"] = group_id
                elif native_name in {
                    "search_nodes",
                    "search_memory_facts",
                    "get_episodes",
                    "build_communities",
                    "clear_graph",
                }:
                    native_args["group_ids"] = [group_id]
            return await _call_native_graphiti(native_name, native_args)
    allowed = _ALLOWED_KEYS.get(name)
    if allowed is None:
        return [TextContent(type="text", text=json.dumps({"ok": False, "error": f"unknown_tool: {name}"}))]
    args = dict(arguments or {})
    if context is not None:
        try:
            supplied_identity = sorted(_SERVER_OWNED_ARGUMENTS & args.keys())
            if name == "run_coder_subagent" and "parentRunId" in args:
                supplied_identity.append("parentRunId")
            if supplied_identity:
                raise ValueError(f"caller_identity_rejected: {','.join(supplied_identity)}")
            for field in ("projectId", "deckId", "conversationId"):
                if field in allowed:
                    args[field] = str(context[field])
            if "senderAgentId" in allowed:
                args["senderAgentId"] = str(context["mainCardId"])
            if "correlationId" in allowed:
                args["correlationId"] = f"external-mcp:{uuid4()}"
            if name == "card.run_assistant_agent":
                args["originatingAgentId"] = str(context["mainCardId"])
                args["originatingRunId"] = str(context["parentRunId"])
            if name == "run_coder_subagent":
                args["parentRunId"] = f"req_external_main_{uuid4()}"
        except (KeyError, RuntimeError, ValueError) as err:
            return [TextContent(type="text", text=json.dumps({"ok": False, "error": str(err)}))]
    extra = [k for k in args.keys() if k not in allowed]
    if extra:
        return [
            TextContent(
                type="text",
                text=json.dumps({"ok": False, "error": f"tool_arguments_rejected: {','.join(sorted(extra))}"}),
            )
        ]
    if name == "write_mag_one_instructions":
        if context is None:
            return [TextContent(type="text", text=json.dumps({"ok": False, "error": "main_context_unavailable"}))]
        from app.python_models import agentgraph

        try:
            result = await asyncio.to_thread(
                agentgraph.create_instruction,
                project_id=str(context["projectId"]),
                deck_id=str(context["deckId"]),
                conversation_id=str(context["conversationId"]),
                body=args.get("instructions"),
                prepared_by_card_id=str(context["mainCardId"]),
                operation_references=args.get("operationReferences"),
            )
            return [TextContent(type="text", text=json.dumps(result))]
        except agentgraph.AgentGraphError as err:
            return [TextContent(type="text", text=json.dumps({"ok": False, "error": str(err)}))]
    if name == "main.context":
        if context is None:
            return [
                TextContent(
                    type="text",
                    text=json.dumps({"ok": False, "error": "main_context_unavailable"}),
                )
            ]
        return [
            TextContent(
                type="text",
                text=json.dumps(
                    {
                        "ok": True,
                        "context": {
                            "projectId": str(context["projectId"]),
                            "deckId": str(context["deckId"]),
                            "conversationId": str(context["conversationId"]),
                            "parentRunId": str(context["parentRunId"]),
                            "mainCardId": str(context["mainCardId"]),
                        },
                    }
                ),
            )
        ]
    if name == "web_search":
        from app.python_models.web_search import web_search

        result = await web_search(
            query=str(args.get("query") or ""),
            max_results=int(args.get("max_results") or 5),
        )
        return [TextContent(type="text", text=result)]
    if name.startswith("worldsignals."):
        from app.python_models.worldsignals_client import (
            WorldSignalsClient,
            WorldSignalsError,
            worldsignals_capabilities,
        )

        client = WorldSignalsClient()
        try:
            if name == "worldsignals.capabilities":
                result = await asyncio.to_thread(
                    worldsignals_capabilities,
                    domain=args.get("domain"),
                    command=args.get("command"),
                    keyword=args.get("keyword"),
                    operation_class=args.get("operation_class"),
                    limit=int(args.get("limit") or 25),
                )
            elif name == "worldsignals.command":
                result = client.command(str(args.get("command") or ""), args.get("arguments") or {})
            elif name == "worldsignals.batch":
                result = client.batch(list(args.get("commands") or []))
            else:
                result = client.stream_events(
                    int(args.get("max_events") or 1),
                    int(args.get("timeout_seconds") or 15),
                ) if name == "worldsignals.stream_events" else client.poll()
            return [TextContent(type="text", text=json.dumps({"ok": True, "result": result}))]
        except WorldSignalsError as err:
            return [TextContent(type="text", text=json.dumps({"ok": False, "error": str(err)}))]
    handler_name = _CONTROL_HANDLER_NAMES.get(name)
    if handler_name is not None:
        from app import control_plane

        try:
            result = await getattr(control_plane, handler_name)(args)
            return [TextContent(type="text", text=json.dumps(result))]
        except control_plane.ControlPlaneError as err:
            return [TextContent(type="text", text=json.dumps({"ok": False, "error": str(err)}))]
    return await _bridge(_BRIDGE_PATHS[name], args)


def _tool_result_category(result: Any) -> str:
    try:
        if isinstance(result, CallToolResult):
            if result.isError:
                return "tool_error"
            blocks = result.content
        else:
            blocks = result if isinstance(result, list) else []
        for block in blocks:
            text = getattr(block, "text", "")
            if isinstance(text, str) and text:
                payload = json.loads(text)
                if isinstance(payload, dict) and payload.get("ok") is False:
                    return "tool_error"
    except Exception:
        return "success"
    return "success"


@server.call_tool()
async def call_tool(name: str, arguments: dict[str, Any]) -> Any:
    trace_fields = {
        "mcp_method": "tools/call",
        "tool_name": str(name or "")[:160],
        **_oauth_trace_fields(),
    }
    _trace("tool_call_started", **trace_fields)
    try:
        result = await _dispatch_tool(name, arguments)
        result_category = _tool_result_category(result)
        _trace(
            "tool_call_completed",
            **trace_fields,
            response_status=500 if result_category == "tool_error" else 200,
            result_category=result_category,
            completed=True,
        )
        if result_category == "tool_error" and isinstance(result, list):
            return CallToolResult(content=result, isError=True)
        return result
    except Exception as error:
        _trace(
            "tool_call_failed",
            **trace_fields,
            response_status=500,
            result_category="tool_error",
            exception_class=error.__class__.__name__,
            completed=True,
        )
        return CallToolResult(
            content=[
                TextContent(
                    type="text",
                    text=json.dumps(
                        {
                            "ok": False,
                            "error": f"tool_handler_failed:{error.__class__.__name__}",
                        }
                    ),
                )
            ],
            isError=True,
        )


async def _run_stdio() -> None:
    try:
        async with stdio_server() as (read_stream, write_stream):
            await server.run(read_stream, write_stream, server.create_initialization_options())
    finally:
        await _close_native_graphiti()
        await asyncio.to_thread(_close_native_cbm)


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
            _trace(
                "http_request",
                http_method=str(scope.get("method") or ""),
                session_hash=_safe_hash(
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
    from starlette.responses import PlainTextResponse
    from starlette.routing import Mount

    from mcp.server.auth.middleware.auth_context import AuthContextMiddleware
    from mcp.server.auth.middleware.bearer_auth import BearerAuthBackend, RequireAuthMiddleware
    from mcp.server.auth.routes import build_resource_metadata_url, create_protected_resource_routes

    config_values = _oauth_config()

    session_manager = StreamableHTTPSessionManager(
        app=server,
        json_response=True,
        stateless=True,
        security_settings=TransportSecuritySettings(enable_dns_rebinding_protection=False),
    )

    async def endpoint(scope: dict[str, Any], receive: Any, send: Any) -> None:
        if scope.get("path") != HTTP_MCP_PATH:
            await PlainTextResponse("not_found", status_code=404)(scope, receive, send)
            return
        await session_manager.handle_request(scope, receive, send)

    async def lifespan(_app: Starlette):
        try:
            async with session_manager.run():
                yield
        finally:
            await _close_native_graphiti()
            await asyncio.to_thread(_close_native_cbm)

    if OAUTH_ENFORCED:
        resource_url = AnyHttpUrl(config_values.resource_url)
        metadata_url = build_resource_metadata_url(resource_url)
        protected_endpoint: Any = RequireAuthMiddleware(
            endpoint,
            required_scopes=[config_values.required_scope],
            resource_metadata_url=metadata_url,
        )
        protected_endpoint = AuthContextMiddleware(protected_endpoint)
        auth_backend: AuthenticationBackend = BearerAuthBackend(Auth0TokenVerifier(config_values))
        protected_endpoint = AuthenticationMiddleware(protected_endpoint, backend=auth_backend)
        routes = [
            *create_protected_resource_routes(
                resource_url=resource_url,
                authorization_servers=[AnyHttpUrl(config_values.issuer_url)],
                scopes_supported=[config_values.required_scope],
                resource_name="LiquidAIty Main",
            ),
            Mount("/", app=protected_endpoint),
        ]
    else:
        routes = [Mount("/", app=endpoint)]
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
    await _initialize_native_engraphis()
    await _initialize_native_graphiti()
    if MCP_TRANSPORT == "stdio":
        await _run_stdio()
        return
    if MCP_TRANSPORT == "streamable-http":
        await _native_cbm_tools()
        await _run_streamable_http()
        return
    raise RuntimeError(f"unsupported_mcp_transport: {MCP_TRANSPORT}")


if __name__ == "__main__":
    asyncio.run(main())
