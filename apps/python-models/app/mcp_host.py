"""Main Python MCP host (stdio) — THE one MCP host the Harness launches.

Launch shape: localcoder/scripts/start-grpc.ts resolves this venv's python.exe
and this file's absolute path from the real repo layout, validates both exist,
and the gRPC Harness (localcoder/src/grpc/server.ts) spawns them as ONE stdio
MCP client for the server's lifetime — before any chat work is accepted. No
env vars, no .env, no per-turn spawn, no fallback host.

Exposes this application tool surface plus the dynamically discovered native
Engraphis, Codebase Memory, and official Graphiti MCP registries:
  * mag_one.describe_connected_agents (read connected, bus-eligible Mag One cards)
  * run_mag_one                      (Main-only approved canonical IDF)
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

Official Graphiti ingestion is an explicit Hermes-only grant. Native tools keep their upstream schemas,
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
import re
import subprocess
import sys
import threading
import time
from collections import deque
from concurrent.futures import Future
from contextvars import ContextVar
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen
from uuid import uuid4

# Bootstrap the package root onto sys.path. The gRPC harness launches this host as a
# SCRIPT (`python .../apps/python-models/app/mcp_host.py`), so sys.path[0] is the
# `app/` dir and the `app` package (rooted at apps/python-models) is NOT importable —
# which broke every `from app...` control handler at call time ("No module named
# 'app'"). Adding the package root here (the ONE launch/bootstrap boundary) makes all
# `app.*` imports resolve, for every tool. Not a per-tool sys.path hack.
_PACKAGE_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_REPO_ROOT = os.path.dirname(os.path.dirname(_PACKAGE_ROOT))
if _PACKAGE_ROOT not in sys.path:
    sys.path.insert(0, _PACKAGE_ROOT)


def _startup_source_identity() -> tuple[str, str]:
    """Capture the exact loaded checkout and source bytes once per host process."""
    try:
        revision = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=_REPO_ROOT,
            capture_output=True,
            text=True,
            timeout=10,
            check=True,
        ).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        revision = ""
    try:
        with open(__file__, "rb") as source_file:
            source_sha256 = hashlib.sha256(source_file.read()).hexdigest()
    except OSError:
        source_sha256 = ""
    return revision, source_sha256

from app.python_models.provider_config import ensure_env_loaded
from mcp.server import Server
from mcp.server.auth.middleware.auth_context import get_access_token
from mcp.server.auth.provider import AccessToken
from mcp.server.lowlevel.server import NotificationOptions
from mcp.server.stdio import stdio_server
from mcp.types import CallToolResult, TextContent, Tool

ensure_env_loaded()

_GRAPHITI_PROJECT_ID = re.compile(r"^[A-Za-z0-9_-]+$")


def graphiti_project_group_id(project_id: str) -> str:
    """Map a Main project to Graphiti's existing isolated group namespace."""
    if not isinstance(project_id, str) or not _GRAPHITI_PROJECT_ID.fullmatch(project_id):
        raise ValueError("projectId must contain only letters, numbers, underscores, and hyphens")
    return f"liquidaity-{project_id}"

BACKEND = os.environ.get("MAIN_BACKEND_URL", "http://127.0.0.1:4000").rstrip("/")
MCP_TRANSPORT = os.environ.get("MCP_TRANSPORT", "stdio").strip().lower()
HTTP_MCP_HOST = "127.0.0.1"
HTTP_MCP_PORT = int(os.environ.get("MCP_HTTP_PORT", "8765"))
HTTP_MCP_PATH = "/mcp"
PUBLIC_MCP_RESOURCE_URL = os.environ.get(
    "MCP_PUBLIC_RESOURCE_URL",
    "https://exemption-unstable-wolverine.ngrok-free.dev/mcp",
).strip()
AUTH0_ISSUER_URL = os.environ.get("MCP_AUTH0_ISSUER_URL", "").strip()
AUTH0_AUDIENCE = os.environ.get("MCP_AUTH0_AUDIENCE", "").strip()
AUTH0_CLIENT_ID = os.environ.get("MCP_AUTH0_CLIENT_ID", "").strip()
AUTH0_REQUIRED_SCOPE = os.environ.get(
    "MCP_AUTH0_REQUIRED_SCOPE", "liquidaity.main"
).strip()
OAUTH_SCOPES = (
    "openid",
    "profile",
    "email",
    "offline_access",
    "liquidaity.main",
)
OAUTH_ENFORCED = os.environ.get("MCP_OAUTH_ENFORCED", "false").strip().lower() in {
    "1", "true", "yes", "on",
}
_STARTUP_ID = uuid4().hex
_STARTUP_PROCESS_ID = os.getpid()
_STARTUP_SOURCE_REVISION, _STARTUP_SOURCE_SHA256 = _startup_source_identity()
_TRACE_LOCK = threading.Lock()
_CATALOG_DIAGNOSTIC_LOCK = threading.Lock()
_LATEST_CATALOG_DIAGNOSTIC: dict[str, Any] | None = None
_NATIVE_TOOL_TIMEOUT_SECONDS = 30.0
_NATIVE_CBM_REQUEST_TIMEOUT_SECONDS = 300.0
_MCP_CALL_TIMEOUT_SECONDS = 30.0
_PUBLIC_MCP_NAME = "LiquidAIty"
_PUBLIC_MCP_DESCRIPTION = (
    "Connect ChatGPT to LiquidAIty projects, saved agent cards, CodeGraph, "
    "ThinkGraph, KnowGraph, and supported agent runtimes."
)
_ACTIVE_EXECUTION_RECEIPT: ContextVar[dict[str, Any] | None] = ContextVar(
    "mcp_execution_receipt", default=None
)
_GRAPHITI_PROVIDER_HEALTH_LOCK = threading.Lock()
_GRAPHITI_PROVIDER_HEALTH: dict[str, Any] = {
    "last_success": None,
    "last_failure": None,
}
_MAIN_CONTEXT_FIELDS = frozenset(
    {"projectId", "deckId", "conversationId", "parentRunId", "mainCardId"}
)
_TRUSTED_STDIO_OPTIONAL_CONTEXT_FIELDS = frozenset({"callerRuntimeBinding"})


def _configured_tool_allowlist() -> frozenset[str] | None:
    """Return the exact process-owned publication grant, when configured.

    The allowlist is a per-Hermes-session capability boundary, not a global
    stdio-host setting. Require the matching trusted Main context so stale or
    ambient ``MCP_TOOL_ALLOWLIST`` values cannot narrow the canonical host.
    """
    if _trusted_stdio_main_context() is None:
        return None
    raw = os.environ.get("MCP_TOOL_ALLOWLIST")
    if raw is None:
        return None
    return frozenset(name.strip() for name in raw.split(",") if name.strip())


def _tool_is_allowed(name: str) -> bool:
    allowlist = _configured_tool_allowlist()
    return allowlist is None or name in allowlist


def _trusted_stdio_main_context() -> dict[str, Any] | None:
    if MCP_TRANSPORT != "stdio":
        return None
    raw = os.environ.get("MCP_TRUSTED_MAIN_CONTEXT", "").strip()
    if not raw:
        return None
    try:
        value = json.loads(raw)
    except (TypeError, ValueError, json.JSONDecodeError):
        return None
    if not isinstance(value, dict) or not _MAIN_CONTEXT_FIELDS.issubset(value):
        return None
    context = {field: str(value[field]) for field in _MAIN_CONTEXT_FIELDS}
    for field in _TRUSTED_STDIO_OPTIONAL_CONTEXT_FIELDS:
        if str(value.get(field, "") or "").strip():
            context[field] = str(value[field])
    return context


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
        "source_revision",
        "source_sha256",
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
            "[main-mcp-trace] "
            + json.dumps(payload, ensure_ascii=False, sort_keys=True),
            file=sys.stderr,
            flush=True,
        )


def _oauth_trace_fields() -> dict[str, str]:
    access_token = get_access_token()
    if access_token is None:
        return {}
    subject = getattr(access_token, "subject", "")
    if not subject:
        claims = getattr(access_token, "claims", None)
        subject = claims.get("sub", "") if isinstance(claims, dict) else ""
    return {
        "subject_hash": _safe_hash(subject),
        "client_hash": _safe_hash(getattr(access_token, "client_id", "")),
    }


def _catalog_diagnostics() -> dict[str, Any]:
    """Return identity only; catalog membership remains owned by ``list_tools``."""
    with _CATALOG_DIAGNOSTIC_LOCK:
        identity = dict(_LATEST_CATALOG_DIAGNOSTIC or {})
    return {
        "catalogReady": bool(identity),
        **identity,
        "processId": _STARTUP_PROCESS_ID,
        "startupId": _STARTUP_ID,
        "sourceRevision": _STARTUP_SOURCE_REVISION,
        "sourceSha256": _STARTUP_SOURCE_SHA256,
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


def _safe_hostname(url: str) -> str:
    try:
        return str(urlsplit(str(url or "")).hostname or "")
    except ValueError:
        return ""


def _provider_identity(configured_provider: str, base_url: str) -> str:
    """Expose the transport provider while preserving Graphiti's client type."""
    hostname = _safe_hostname(base_url).lower()
    if hostname == "openrouter.ai" or hostname.endswith(".openrouter.ai"):
        return "openrouter"
    if hostname == "api.openai.com" or hostname.endswith(".api.openai.com"):
        return "openai"
    return str(configured_provider or "unknown")


def _sanitize_failure_detail(value: Any) -> str:
    detail = str(value or "").replace("\r", " ").replace("\n", " ")[:500]
    detail = re.sub(r"https?://[^\s/]+[^\s]*", "<remote-url>", detail)
    detail = re.sub(
        r"(?i)(api[-_ ]?key|authorization|bearer|token|password)\s*[:=]\s*[^\s,;]+",
        r"\1=<redacted>",
        detail,
    )
    return detail


def _typed_failure(value: Any, *, dependency: str = "provider") -> dict[str, Any]:
    detail = _sanitize_failure_detail(value)
    lowered = detail.lower()
    if "tool_not_granted" in lowered:
        code, retryable = "tool_not_granted", False
    elif isinstance(value, (asyncio.TimeoutError, TimeoutError)) or any(
        term in lowered for term in ("timeout", "timed out", "deadline")
    ):
        code, retryable = "timeout", True
    elif any(
        term in lowered
        for term in (
            "session terminated",
            "session not found",
            "session expired",
            "session closed",
            "transport closed",
            "connection closed",
        )
    ):
        code, retryable = "session_terminated", False
    elif any(
        term in lowered
        for term in ("token expired", "token has expired", "expired token", "authentication expired", "auth expired")
    ):
        code, retryable = "authentication_expired", False
    elif any(
        term in lowered
        for term in ("invalid argument", "invalid arguments", "invalid_argument", "invalid params")
    ):
        code, retryable = "invalid_arguments", False
    elif any(
        term in lowered
        for term in (
            "no workspace named",
            "workspace not found",
            "no repo named",
            "repository not found",
        )
    ):
        code, retryable = "resource_not_found", False
    elif any(term in lowered for term in ("insufficient", "credit", "quota exceeded")):
        code, retryable = "insufficient_credits", False
    elif any(term in lowered for term in ("unauthorized", "authentication", "invalid api key", "401")):
        code, retryable = "authentication_failed", False
    elif any(term in lowered for term in ("rate limit", "too many requests", "429")):
        code, retryable = "rate_limited", True
    elif "dimension" in lowered and any(term in lowered for term in ("embedding", "vector")):
        code, retryable = "embedding_dimension_mismatch", False
    elif any(term in lowered for term in ("malformed", "invalid json", "model output", "validation error")):
        code, retryable = "malformed_model_output", False
    elif any(term in lowered for term in ("queue", "worker")):
        code, retryable = "queue_failure", True
    elif any(term in lowered for term in ("service unavailable", "connection refused", "backend_unreachable")):
        code, retryable = "service_unavailable", True
    elif any(term in lowered for term in ("neo4j", "database")):
        code, retryable = "database_failure", True
    elif isinstance(value, (AttributeError, TypeError)):
        code, retryable = "internal_handler_failure", False
    else:
        code, retryable = (
            ("internal_failure", False)
            if dependency == "mcp"
            else ("provider_failure", False)
        )
    if code in {"database_failure", "queue_failure", "service_unavailable"}:
        category = "DEPENDENCY_UNAVAILABLE"
    elif code in {"authentication_expired", "authentication_failed"}:
        category = "AUTHENTICATION"
    elif code == "session_terminated":
        category = "SESSION_LIFECYCLE"
    elif code == "timeout":
        category = "TIMEOUT"
    elif code == "invalid_arguments":
        category = "INVALID_ARGUMENT"
    elif code == "resource_not_found":
        category = "NOT_FOUND"
    elif code in {"internal_handler_failure", "internal_failure"}:
        category = "INTERNAL"
    else:
        category = "PROVIDER"
    return {
        "ok": False,
        "error": code,
        "failureCode": code,
        "errorCategory": category,
        "retryable": retryable,
        "dependency": dependency,
        "detail": detail,
    }


def _observe_provider_call(
    *,
    compute: str,
    dependency: str,
    provider: str,
    model: str,
    base_url: str,
    credential_configured: bool,
    state: str,
    started_at: str,
    duration_ms: int | None = None,
    failure: dict[str, Any] | None = None,
    usage: Any = None,
) -> None:
    event = {
        "compute": compute,
        "dependency": dependency,
        "provider": provider,
        "model": model,
        "local": not bool(_safe_hostname(base_url)),
        "baseUrlHostname": _safe_hostname(base_url),
        "credentialConfigured": bool(credential_configured),
        "state": state,
        "startedAt": started_at,
        "providerSubstitution": False,
    }
    if duration_ms is not None:
        event["durationMs"] = duration_ms
    if usage is not None:
        event["usage"] = usage
    if failure is not None:
        event["failureCode"] = failure.get("failureCode")
    receipt = _ACTIVE_EXECUTION_RECEIPT.get()
    if receipt is not None:
        calls = receipt.setdefault("providerCalls", [])
        calls.append(event)
        observed = {call.get("compute") for call in calls if call.get("compute")}
        receipt["compute"] = next(iter(observed)) if len(observed) == 1 else "mixed"
        receipt["providerSubstitution"] = False
    if state in {"completed", "failed"}:
        record = dict(event)
        if failure is not None:
            record["failure"] = failure
        with _GRAPHITI_PROVIDER_HEALTH_LOCK:
            _GRAPHITI_PROVIDER_HEALTH[
                "last_success" if state == "completed" else "last_failure"
            ] = record
            _GRAPHITI_PROVIDER_HEALTH[
                f"{dependency}:{'last_success' if state == 'completed' else 'last_failure'}"
            ] = record


def _instrument_graphiti_provider_client(
    client: Any,
    *,
    method_names: tuple[str, ...],
    compute: str,
    dependency: str,
    provider: str,
    model: str,
    base_url: str,
    credential_configured: bool,
) -> None:
    marker = "_main_mcp_observed_methods"
    observed = set(getattr(client, marker, set()))
    for method_name in method_names:
        if method_name in observed:
            continue
        original = getattr(client, method_name, None)
        if not callable(original):
            continue

        async def observed_call(*args: Any, _original=original, **kwargs: Any):
            started_clock = time.monotonic()
            started_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
            _observe_provider_call(
                compute=compute,
                dependency=dependency,
                provider=provider,
                model=model,
                base_url=base_url,
                credential_configured=credential_configured,
                state="started",
                started_at=started_at,
            )
            try:
                result = await _original(*args, **kwargs)
            except Exception as error:
                failure = _typed_failure(error, dependency=dependency)
                _observe_provider_call(
                    compute=compute,
                    dependency=dependency,
                    provider=provider,
                    model=model,
                    base_url=base_url,
                    credential_configured=credential_configured,
                    state="failed",
                    started_at=started_at,
                    duration_ms=int((time.monotonic() - started_clock) * 1000),
                    failure=failure,
                )
                raise
            usage = getattr(result, "usage", None)
            if hasattr(usage, "model_dump"):
                usage = usage.model_dump(exclude_none=True)
            _observe_provider_call(
                compute=compute,
                dependency=dependency,
                provider=provider,
                model=model,
                base_url=base_url,
                credential_configured=credential_configured,
                state="completed",
                started_at=started_at,
                duration_ms=int((time.monotonic() - started_clock) * 1000),
                usage=usage,
            )
            return result

        setattr(client, method_name, observed_call)
        observed.add(method_name)
    setattr(client, marker, observed)


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
            ("MCP_PUBLIC_RESOURCE_URL", config.resource_url),
            ("MCP_AUTH0_ISSUER_URL", config.issuer_url),
            ("MCP_AUTH0_AUDIENCE", config.audience),
            ("MCP_AUTH0_CLIENT_ID", config.client_id),
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
    if config.required_scope not in OAUTH_SCOPES:
        raise RuntimeError("oauth_required_scope_not_supported")
    return config


def _authenticated_main_context() -> dict[str, Any] | None:
    access_token = get_access_token()
    if access_token is None:
        return _trusted_stdio_main_context()
    expires_at = getattr(access_token, "expires_at", None)
    if expires_at is not None and float(expires_at) <= time.time():
        return None
    claims = getattr(access_token, "claims", None)
    context = claims.get("main") if isinstance(claims, dict) else None
    if not isinstance(context, dict) or not _MAIN_CONTEXT_FIELDS.issubset(context):
        return None
    return {field: str(context[field]) for field in _MAIN_CONTEXT_FIELDS}


class AgentRuntimeServer(Server):
    def create_initialization_options(
        self,
        notification_options: NotificationOptions | None = None,
        experimental_capabilities: dict[str, dict[str, Any]] | None = None,
    ):
        return super().create_initialization_options(
            notification_options or NotificationOptions(tools_changed=True),
            experimental_capabilities,
        )


server = AgentRuntimeServer(
    _PUBLIC_MCP_NAME,
    instructions=_PUBLIC_MCP_DESCRIPTION,
)

_NATIVE_ENGRAPHIS_MCP: Any | None = None
_NATIVE_ENGRAPHIS_TOOLS: tuple[Tool, ...] | None = None
_NATIVE_ENGRAPHIS_NAMES: frozenset[str] = frozenset()
_NATIVE_ENGRAPHIS_WARMUP_TASK: asyncio.Task[None] | None = None
_NATIVE_CBM_CLIENT: "_NativeStdioMcpClient | None" = None
_NATIVE_CBM_TOOLS: tuple[Tool, ...] | None = None
_NATIVE_CBM_NAMES: frozenset[str] = frozenset()
_NATIVE_CBM_INIT_LOCK = threading.Lock()
_NATIVE_CBM_INDEX_LOCK = threading.Lock()
_NATIVE_CBM_INDEX_IN_FLIGHT: tuple[str, Future[CallToolResult]] | None = None
_NATIVE_CBM_CONTAINER_REPO_ROOT = "/workspace/main"
_NATIVE_CBM_PROJECT = "C-Projects-LiquidAIty-main"
_NATIVE_GRAPHITI_MODULE: Any | None = None
_NATIVE_GRAPHITI_TOOLS: tuple[Tool, ...] | None = None
_NATIVE_GRAPHITI_NAMES: frozenset[str] = frozenset()
_NATIVE_GRAPHITI_UNAVAILABLE: dict[str, Any] | None = None
_NATIVE_PREFIXES = {
    "cbm": "cbm.",
    "engraphis": "engraphis.",
    "graphiti": "graphiti.",
}


def _namespace_native_tools(provider: str, tools: list[Tool]) -> list[Tool]:
    """Add the established public routing prefix while preserving native tools."""
    prefix = _NATIVE_PREFIXES[provider]
    result: list[Tool] = []
    for tool in tools:
        payload = tool.model_dump(by_alias=True, exclude_none=True)
        native_name = tool.name
        if provider == "engraphis":
            native_name = native_name.removeprefix("engraphis_")
        payload["name"] = prefix + native_name
        meta = dict(payload.get("_meta") or {})
        meta["liquidaitySource"] = {
            "sourceId": provider,
            "namespace": provider,
            "nativeName": tool.name,
            "connectionKind": "external-mcp",
        }
        payload["_meta"] = meta
        if provider == "graphiti" and native_name == "get_episodes":
            schema = copy.deepcopy(payload.get("inputSchema") or {})
            properties = schema.setdefault("properties", {})
            properties.update({
                "include_body": {
                    "type": "boolean",
                    "default": False,
                    "description": "Explicitly include episode bodies; ordinary reads return previews.",
                },
                "body_preview_chars": {
                    "type": "integer",
                    "minimum": 0,
                    "maximum": 2000,
                    "default": 400,
                },
                "max_response_chars": {
                    "type": "integer",
                    "minimum": 2000,
                    "maximum": 100000,
                    "default": 20000,
                },
            })
            payload["inputSchema"] = schema
        result.append(Tool.model_validate(payload))
    return result


def _bind_repo_tool_source(tool: Tool) -> Tool:
    """Attach factual connection identity to a repo-owned MCP declaration."""
    payload = tool.model_dump(by_alias=True, exclude_none=True)
    meta = dict(payload.get("_meta") or {})
    meta["liquidaitySource"] = {
        "sourceId": "main_mcp",
        "namespace": "main",
        "nativeName": tool.name,
        "connectionKind": "external-mcp",
    }
    payload["_meta"] = meta
    return Tool.model_validate(payload)


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
    """Import Engraphis' FastMCP registry with its repository-owned database."""
    repo_root = os.path.dirname(os.path.dirname(_PACKAGE_ROOT))
    # This host is the local workbench boundary. The configured
    # SentenceTransformer model is already cached locally; allowing Hugging Face
    # metadata requests here can leave the first external MCP tool call waiting on
    # the network long enough for ChatGPT to disable the otherwise healthy connector.
    os.environ.setdefault("HF_HUB_OFFLINE", "1")
    os.environ.setdefault(
        "ENGRAPHIS_DB_PATH",
        os.path.join(repo_root, "db", "thinkgraph-engraphis-v2.sqlite"),
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


def _load_native_engraphis_service():
    """Return Engraphis' existing lazy service constructor."""
    from engraphis.mcp_server import service

    return service


async def _warm_native_engraphis() -> None:
    """Build the configured Engraphis service before accepting MCP requests.

    Engraphis deliberately constructs its MemoryService lazily.  That construction
    loads the configured local SentenceTransformer, which can take longer than the
    public MCP call deadline even when the model is already cached and Hugging Face
    networking is disabled.  Paying that one-time cost during host startup keeps the
    first ordinary database-read tool from timing out while initialization continues
    invisibly in a worker thread.
    """
    service = _load_native_engraphis_service()
    await asyncio.to_thread(service)


def _start_native_engraphis_warmup() -> None:
    """Start exactly one warmup without delaying the public MCP listener."""
    global _NATIVE_ENGRAPHIS_WARMUP_TASK
    if _NATIVE_ENGRAPHIS_WARMUP_TASK is None:
        _NATIVE_ENGRAPHIS_WARMUP_TASK = asyncio.create_task(
            _warm_native_engraphis(),
            name="main-engraphis-warmup",
        )


def _native_engraphis_readiness_failure() -> CallToolResult | None:
    """Return a typed, immediate failure until the one startup warmup is ready."""
    task = _NATIVE_ENGRAPHIS_WARMUP_TASK
    if task is None:
        return None
    if not task.done():
        failure = {
            "ok": False,
            "error": "dependency_initializing",
            "failureCode": "dependency_initializing",
            "errorCategory": "DEPENDENCY_UNAVAILABLE",
            "retryable": True,
            "dependency": "engraphis",
        }
    else:
        try:
            task.result()
        except asyncio.CancelledError:
            failure = {
                "ok": False,
                "error": "dependency_unavailable",
                "failureCode": "dependency_unavailable",
                "errorCategory": "DEPENDENCY_UNAVAILABLE",
                "retryable": True,
                "dependency": "engraphis",
            }
        except Exception as error:
            failure = _typed_failure(error, dependency="engraphis")
            failure["errorCategory"] = "DEPENDENCY_UNAVAILABLE"
        else:
            return None
    return CallToolResult(
        content=[TextContent(type="text", text=json.dumps(failure))],
        isError=True,
    )


def _native_engraphis_mcp():
    """Return the initialized native Engraphis FastMCP registry."""
    if _NATIVE_ENGRAPHIS_MCP is None:
        raise RuntimeError("native_engraphis_not_initialized")
    return _NATIVE_ENGRAPHIS_MCP


async def _native_engraphis_tools() -> list[Tool]:
    """Return the original native Engraphis Tool objects discovered at startup."""
    await _initialize_native_engraphis()
    return list(_NATIVE_ENGRAPHIS_TOOLS or ())


def _graphiti_config():
    """Build the official Graphiti config from the existing authorities."""
    from config.schema import GraphitiConfig

    openrouter_key = os.environ.get("OPENROUTER_API_KEY") or None
    openrouter_url = (
        os.environ.get("OPENROUTER_OPENAI_BASE_URL")
        or os.environ.get("OPENROUTER_BASE_URL")
        or "https://openrouter.ai/api/v1"
    )
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
            "model": (
                os.environ.get("GRAPHITI_EMBEDDER_MODEL")
                or os.environ.get("KNOWGRAPH_OPENROUTER_EMBEDDING_MODEL")
                or "openai/text-embedding-3-large"
            ),
            "dimensions": int(
                os.environ.get("KNOWGRAPH_OPENROUTER_EMBEDDING_DIM") or 3072
            ),
            "providers": {
                "openai": {
                    "api_key": openrouter_key,
                    "api_url": openrouter_url,
                }
            },
        },
        graphiti={
            "group_id": "liquidaity",
            "user_id": "liquidaity-mcp",
        },
    )


def _graphiti_provider_settings(section: Any) -> Any:
    provider_name = str(section.provider).lower()
    settings = getattr(section.providers, provider_name, None)
    if settings is None:
        raise RuntimeError(f"graphiti_provider_configuration_missing:{provider_name}")
    return settings


async def _initialize_native_graphiti() -> None:
    """Initialize optional Graphiti once without making it an MCP boot dependency."""
    global _NATIVE_GRAPHITI_MODULE, _NATIVE_GRAPHITI_NAMES, _NATIVE_GRAPHITI_TOOLS
    global _NATIVE_GRAPHITI_UNAVAILABLE
    if _NATIVE_GRAPHITI_TOOLS is not None:
        return
    if not os.environ.get("OPENROUTER_API_KEY", "").strip():
        _NATIVE_GRAPHITI_TOOLS = ()
        _NATIVE_GRAPHITI_NAMES = frozenset()
        _NATIVE_GRAPHITI_UNAVAILABLE = {
            "ok": False,
            "failureCode": "optional_capability_unavailable",
            "errorCategory": "DEPENDENCY_UNAVAILABLE",
            "retryable": False,
            "dependency": "graphiti",
            "detail": "Graphiti provider credentials are not configured.",
        }
        return

    native: Any | None = None
    try:
        import graphiti_mcp_server as native_module

        native = native_module
        native.config = _graphiti_config()
        native.graphiti_service = native.GraphitiService(native.config, native.SEMAPHORE_LIMIT)
        native.queue_service = native.QueueService()
        await native.graphiti_service.initialize()
        native.graphiti_client = await native.graphiti_service.get_client()
        native.semaphore = native.graphiti_service.semaphore
        await native.queue_service.initialize(native.graphiti_client)
        llm_provider = _graphiti_provider_settings(native.config.llm)
        embedder_provider = _graphiti_provider_settings(native.config.embedder)
        _instrument_graphiti_provider_client(
            native.graphiti_client.llm_client,
            method_names=("generate_response",),
            compute="api_llm",
            dependency="graphiti_llm",
            provider=_provider_identity(
                str(native.config.llm.provider), str(llm_provider.api_url or "")
            ),
            model=str(native.config.llm.model),
            base_url=str(llm_provider.api_url or ""),
            credential_configured=bool(llm_provider.api_key),
        )
        _instrument_graphiti_provider_client(
            native.graphiti_client.embedder,
            method_names=("create", "create_batch"),
            compute="api_embedding",
            dependency="graphiti_embedding",
            provider=_provider_identity(
                str(native.config.embedder.provider), str(embedder_provider.api_url or "")
            ),
            model=str(native.config.embedder.model),
            base_url=str(embedder_provider.api_url or ""),
            credential_configured=bool(embedder_provider.api_key),
        )
        _instrument_graphiti_provider_client(
            native.graphiti_client.cross_encoder,
            method_names=("rank",),
            compute="api_llm",
            dependency="graphiti_reranker",
            provider=_provider_identity(
                str(native.config.llm.provider), str(llm_provider.api_url or "")
            ),
            model=str(native.config.llm.model),
            base_url=str(llm_provider.api_url or ""),
            credential_configured=bool(llm_provider.api_key),
        )
        tools = tuple(await native.mcp.list_tools())
        names = [tool.name for tool in tools]
        if len(names) != len(set(names)):
            raise RuntimeError("native_graphiti_duplicate_tool_name")
    except Exception as error:
        client = getattr(native, "graphiti_client", None) if native is not None else None
        close = getattr(getattr(client, "driver", None), "close", None)
        if callable(close):
            close_result = close()
            if inspect.isawaitable(close_result):
                await close_result
        _NATIVE_GRAPHITI_MODULE = None
        _NATIVE_GRAPHITI_TOOLS = ()
        _NATIVE_GRAPHITI_NAMES = frozenset()
        _NATIVE_GRAPHITI_UNAVAILABLE = {
            "ok": False,
            "failureCode": "optional_capability_unavailable",
            "errorCategory": "DEPENDENCY_UNAVAILABLE",
            "retryable": False,
            "dependency": "graphiti",
            "detail": f"Graphiti initialization failed ({error.__class__.__name__}).",
        }
        return

    _NATIVE_GRAPHITI_MODULE = native
    _NATIVE_GRAPHITI_TOOLS = tools
    _NATIVE_GRAPHITI_NAMES = frozenset(names)
    _NATIVE_GRAPHITI_UNAVAILABLE = None


async def _native_graphiti_tools() -> list[Tool]:
    await _initialize_native_graphiti()
    return list(_NATIVE_GRAPHITI_TOOLS or ())


async def _call_native_graphiti(name: str, arguments: dict[str, Any]):
    if _NATIVE_GRAPHITI_MODULE is None:
        raise RuntimeError("native_graphiti_not_initialized")
    try:
        result = await asyncio.wait_for(
            _NATIVE_GRAPHITI_MODULE.mcp.call_tool(name, arguments),
            timeout=_NATIVE_TOOL_TIMEOUT_SECONDS,
        )
    except TimeoutError as error:
        raise RuntimeError(f"native_graphiti_timeout:{name}") from error
    return _normalize_graphiti_result(result)


def _normalize_graphiti_result(result: Any) -> Any:
    return _normalize_native_tool_result(result, dependency="graphiti")


def _bounded_graphiti_episodes(
    result: CallToolResult,
    *,
    include_body: bool,
    preview_chars: int,
    response_budget: int,
) -> CallToolResult:
    """Project native episodes into a stable, context-bounded public response."""
    if result.isError or not isinstance(result.structuredContent, dict):
        return result
    native_payload = result.structuredContent.get("result")
    if not isinstance(native_payload, dict) or not isinstance(native_payload.get("episodes"), list):
        return result
    projected: list[dict[str, Any]] = []
    for native_episode in native_payload["episodes"]:
        if not isinstance(native_episode, dict):
            continue
        content = str(native_episode.get("content") or "")
        episode = {
            key: native_episode.get(key)
            for key in (
                "uuid", "name", "source", "source_description", "created_at", "valid_at",
                "reference_time", "group_id", "saga_uuid",
            )
            if native_episode.get(key) is not None
        }
        episode["content_chars"] = len(content)
        if include_body:
            episode["content"] = content
        else:
            episode["content_preview"] = content[:preview_chars]
            episode["content_truncated"] = len(content) > preview_chars
        projected.append(episode)
    payload: dict[str, Any] = {
        "message": native_payload.get("message") or "Episodes retrieved successfully",
        "episodes": projected,
        "bodyIncluded": include_body,
        "responseBudgetChars": response_budget,
        "truncated": False,
        "omittedEpisodes": 0,
    }
    serialized = json.dumps(payload, ensure_ascii=False)
    if len(serialized) > response_budget and include_body and projected:
        overhead = len(serialized) - len(str(projected[0].get("content") or ""))
        allowed_body = max(0, response_budget - overhead - 100)
        original = str(projected[0].get("content") or "")
        projected[0]["content"] = original[:allowed_body]
        projected[0]["content_truncated"] = len(original) > allowed_body
        payload["truncated"] = payload["truncated"] or len(original) > allowed_body
        serialized = json.dumps(payload, ensure_ascii=False)
    while len(serialized) > response_budget and projected:
        projected.pop()
        payload["omittedEpisodes"] += 1
        payload["truncated"] = True
        serialized = json.dumps(payload, ensure_ascii=False)
    return CallToolResult(
        content=[TextContent(type="text", text=json.dumps(payload, ensure_ascii=False))],
        structuredContent={"result": payload},
        isError=False,
    )


def _normalize_native_tool_result(result: Any, *, dependency: str) -> Any:
    structured: Any = None
    if isinstance(result, tuple) and len(result) == 2 and isinstance(result[0], list):
        blocks = result[0]
        structured = result[1]
    else:
        blocks = result.content if isinstance(result, CallToolResult) else result
    if not isinstance(blocks, list):
        return result
    for block in blocks:
        text = getattr(block, "text", "")
        if not isinstance(text, str) or not text:
            continue
        try:
            payload = json.loads(text)
        except json.JSONDecodeError:
            if text.startswith("Error:"):
                failure = _typed_failure(text, dependency=dependency)
                return CallToolResult(
                    content=[TextContent(type="text", text=json.dumps(failure))],
                    isError=True,
                )
            continue
        if isinstance(payload, dict) and payload.get("error"):
            failure = (
                payload
                if payload.get("failureCode")
                else _typed_failure(payload["error"], dependency=dependency)
            )
            return CallToolResult(
                content=[TextContent(type="text", text=json.dumps(failure))],
                isError=True,
            )
    if isinstance(result, CallToolResult):
        return result
    return CallToolResult(
        content=blocks,
        structuredContent=structured if isinstance(structured, dict) else None,
        isError=False,
    )






async def _close_native_graphiti() -> None:
    global _NATIVE_GRAPHITI_MODULE, _NATIVE_GRAPHITI_NAMES, _NATIVE_GRAPHITI_TOOLS
    global _NATIVE_GRAPHITI_UNAVAILABLE
    native = _NATIVE_GRAPHITI_MODULE
    _NATIVE_GRAPHITI_MODULE = None
    _NATIVE_GRAPHITI_TOOLS = None
    _NATIVE_GRAPHITI_NAMES = frozenset()
    _NATIVE_GRAPHITI_UNAVAILABLE = None
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
            name="main-native-cbm-stdout",
            daemon=True,
        ).start()
        threading.Thread(
            target=self._read_stderr,
            name="main-native-cbm-stderr",
            daemon=True,
        ).start()
        initialized = self._request(
            "initialize",
            {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {
                    "name": "main-native-cbm",
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
            deadline = time.monotonic() + _NATIVE_CBM_REQUEST_TIMEOUT_SECONDS
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

    def is_running(self) -> bool:
        return self._process.poll() is None

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
    """Connect catalog discovery to the Compose-owned CodeGraph service."""
    repo_root = os.path.dirname(os.path.dirname(_PACKAGE_ROOT))
    return (
        "docker",
        [
            "exec",
            "-i",
            "codegraph",
            "/opt/cbm/codebase-memory-mcp",
        ],
        repo_root,
    )


def _normalize_native_cbm_index_arguments(
    arguments: dict[str, Any],
) -> dict[str, Any]:
    """Translate the one mounted Main checkout into the CodeGraph container."""
    normalized = dict(arguments or {})
    repo_path = normalized.get("repo_path")
    if not isinstance(repo_path, str):
        return normalized

    requested_path = repo_path.strip().rstrip("/\\")
    host_path = os.path.normcase(os.path.normpath(requested_path))
    canonical_host_path = os.path.normcase(os.path.normpath(_REPO_ROOT))
    container_path = requested_path.replace("\\", "/")
    if (
        host_path == canonical_host_path
        or container_path == _NATIVE_CBM_CONTAINER_REPO_ROOT
    ):
        normalized["repo_path"] = _NATIVE_CBM_CONTAINER_REPO_ROOT
        normalized["name"] = _NATIVE_CBM_PROJECT
    return normalized


def _initialize_native_cbm_sync() -> None:
    global _NATIVE_CBM_CLIENT, _NATIVE_CBM_NAMES, _NATIVE_CBM_TOOLS
    if (
        _NATIVE_CBM_TOOLS is not None
        and _NATIVE_CBM_CLIENT is not None
        and _NATIVE_CBM_CLIENT.is_running()
    ):
        return
    with _NATIVE_CBM_INIT_LOCK:
        if (
            _NATIVE_CBM_TOOLS is not None
            and _NATIVE_CBM_CLIENT is not None
            and _NATIVE_CBM_CLIENT.is_running()
        ):
            return
        stale_client = _NATIVE_CBM_CLIENT
        _NATIVE_CBM_CLIENT = None
        _NATIVE_CBM_TOOLS = None
        _NATIVE_CBM_NAMES = frozenset()
        if stale_client is not None:
            stale_client.close()
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
    if name == "index_repository":
        return _call_native_cbm_index(arguments)
    _initialize_native_cbm_sync()
    client = _NATIVE_CBM_CLIENT
    if client is None:
        raise RuntimeError("native_cbm_client_unavailable")
    return client.call_tool(name, arguments)


def _call_native_cbm_index(arguments: dict[str, Any]) -> CallToolResult:
    """Coalesce identical indexing requests without spawning another CBM process."""
    global _NATIVE_CBM_INDEX_IN_FLIGHT
    arguments = _normalize_native_cbm_index_arguments(arguments)
    request_key = json.dumps(arguments, sort_keys=True, separators=(",", ":"), default=str)
    leader = False
    with _NATIVE_CBM_INDEX_LOCK:
        in_flight = _NATIVE_CBM_INDEX_IN_FLIGHT
        if in_flight is None:
            future: Future[CallToolResult] = Future()
            _NATIVE_CBM_INDEX_IN_FLIGHT = (request_key, future)
            leader = True
        else:
            active_key, future = in_flight
            if active_key != request_key:
                raise RuntimeError("native_cbm_index_already_in_progress")
    if not leader:
        return future.result()
    try:
        _initialize_native_cbm_sync()
        client = _NATIVE_CBM_CLIENT
        if client is None:
            raise RuntimeError("native_cbm_client_unavailable")
        result = client.call_tool("index_repository", arguments)
        future.set_result(result)
        return result
    except BaseException as error:
        future.set_exception(error)
        raise
    finally:
        with _NATIVE_CBM_INDEX_LOCK:
            if _NATIVE_CBM_INDEX_IN_FLIGHT == (request_key, future):
                _NATIVE_CBM_INDEX_IN_FLIGHT = None


def _close_native_cbm() -> None:
    global _NATIVE_CBM_CLIENT, _NATIVE_CBM_NAMES, _NATIVE_CBM_TOOLS
    with _NATIVE_CBM_INIT_LOCK:
        client = _NATIVE_CBM_CLIENT
        _NATIVE_CBM_CLIENT = None
        _NATIVE_CBM_TOOLS = None
        _NATIVE_CBM_NAMES = frozenset()
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
        with urlopen(request, timeout=_MCP_CALL_TIMEOUT_SECONDS) as response:  # noqa: S310 — loopback backend only
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
    """Verify Auth0 JWTs and bind the principal to one owned Main project."""

    def __init__(self, config: OAuthConfig, jwk_client: Any | None = None):
        from jwt import PyJWKClient

        self.config = config
        self.jwk_client = jwk_client or PyJWKClient(f"{config.issuer_url}.well-known/jwks.json")

    def _principal_context(self, subject: str) -> dict[str, Any] | None:
        return _resolve_external_main_context_sync(self.config.issuer_url, subject)

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
            raw_scope = claims.get("scope") or ""
            scopes = raw_scope.split() if isinstance(raw_scope, str) else [str(value) for value in raw_scope]
            if client_id != self.config.client_id:
                return None
            if self.config.required_scope not in scopes:
                return None
            subject = str(claims.get("sub") or "").strip()
            if not subject:
                return None
            context = self._principal_context(subject)
            if context is None:
                return None
            access_token = AccessToken(
                token=token,
                client_id=client_id,
                scopes=scopes,
                expires_at=int(claims["exp"]),
                resource=self.config.resource_url,
            )
            object.__setattr__(access_token, "subject", subject)
            object.__setattr__(access_token, "claims", {**claims, "main": context})
            return access_token
        except Exception:
            return None

    async def verify_token(self, token: str) -> AccessToken | None:
        return await asyncio.to_thread(self._verify_sync, token)


async def _bridge(path: str, payload: dict[str, Any]) -> list[TextContent]:
    text = await asyncio.to_thread(_bridge_sync, path, payload)
    return [TextContent(type="text", text=text)]


@server.list_tools()
async def list_tools() -> list[Tool]:
    global _LATEST_CATALOG_DIAGNOSTIC

    tools = [
        Tool(
            name="main.context",
            description=(
                "Read the compact server-owned Main entry context for this authenticated "
                "Main request: project, deck, conversation, parent run, and saved "
                "Main-card identities, plus the exact served catalog/process/source identity. "
                "Accepts no caller-supplied identity or context payload."
            ),
            inputSchema={"type": "object", "properties": {}, "required": []},
        ),
        Tool(
            name="coder.status",
            description=(
                "Read the canonical OpenClaude Coder session/process state. Reports running only "
                "when the backend's live session owner has a starting or running process."
            ),
            inputSchema={"type": "object", "properties": {}, "required": []},
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
                "Main Chat only: submit one existing canonical Input Data File identity to "
                "native MagenticOneGroupChat. "
                "The backend resolves the live worker roster from blue SIDE connections; never type "
                "a roster. Execute only on an explicit user request — Hermes never launches Mag One."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "projectId": {"type": "string"},
                    "deckId": {"type": "string"},
                    "idfId": {"type": "string"},
                    "conversationId": {"type": "string"},
                },
                "required": ["idfId", "projectId", "deckId"],
            },
        ),
        Tool(
            name="write_mag_one_instructions",
            description=(
                "Hermes Run Plan preparation: persist the exact proposed Mag One task as "
                "a canonical PostgreSQL Input Data File. Main owns presentation, review, and approval; "
                "creating the IDF never starts Mag One. Returns the stable idfId "
                "for Main to pass to run_mag_one."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "instructions": {"type": "string"},
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
                "modelKey, provider, reasoningEffort, temperature, maxTokens, tools. "
                "Everything else (runtime code, "
                "shell config, hidden tools, authority grants, worker selection) is rejected."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "projectId": {"type": "string"},
                    "deckId": {"type": "string"},
                    "cardId": {"type": "string"},
                    "updates": {
                        "type": "object",
                        "properties": {
                            "prompt": {"type": "string"},
                            "title": {"type": "string"},
                            "modelKey": {"type": "string"},
                            "provider": {"type": "string"},
                            "reasoningEffort": {
                                "type": "string",
                                "enum": ["low", "medium", "high", "xhigh"],
                            },
                            "temperature": {"type": "number"},
                            "maxTokens": {"type": "integer", "minimum": 1},
                            "tools": {
                                "type": "array",
                                "items": {"type": "string", "minLength": 1},
                            },
                        },
                        "additionalProperties": False,
                    },
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
                    "wire": {
                        "type": "object",
                        "properties": {
                            "id": {"type": "string"},
                            "source": {"type": "string"},
                            "target": {"type": "string"},
                            "edgeType": {
                                "type": "string",
                                "enum": ["flow", "magentic_option"],
                                "default": "flow",
                            },
                        },
                        "additionalProperties": False,
                    },
                },
                "required": ["projectId", "deckId", "op", "wire"],
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
                    "max_results": {
                        "type": "integer",
                        "minimum": 1,
                        "maximum": 10,
                        "default": 5,
                    },
                },
                "required": ["query"],
            },
        ),
        Tool(
            name="card.run_assistant_agent",
            description=(
                "Run ONE saved, enabled AutoGen AssistantAgent card "
                "with its saved identity, prompt, model, and tools. "
                "No prompt/model/tool/card overrides "
                "exist on this path — extra arguments are rejected structurally. deckId defaults to "
                "the canonical Agent Canvas deck. On the Harness saved-card doorway path, the "
                "server injects projectId/correlationId/conversationId; the model supplies the "
                "bound cardId plus the task input only. conversationId is the real live "
                "conversation this run belongs to, when one exists. The backend persists one "
                "canonical IDF before the selected runtime receives the input."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "projectId": {"type": "string"},
                    "deckId": {"type": "string"},
                    "cardId": {"type": "string"},
                    "correlationId": {"type": "string"},
                    "conversationId": {"type": "string"},
                    "originatingAgentId": {
                        "type": "string",
                        "description": "Server-owned saved-card identity for an inter-agent doorway call.",
                    },
                    "originatingRunId": {
                        "type": "string",
                        "description": "Server-owned parent Harness turn identity for an inter-agent doorway call.",
                    },
                    "input": {"type": "string"},
                },
                "required": ["cardId", "input"],
            },
        ),
    ]
    tools = [_bind_repo_tool_source(tool) for tool in tools]
    for tool in tools:
        tool.inputSchema.setdefault("additionalProperties", False)
    allowlist = _configured_tool_allowlist()
    if allowlist is not None:
        tools = [tool for tool in tools if tool.name in allowlist]
    native_catalogs: dict[str, list[Tool]] = {}
    if allowlist is None or any(name.startswith("engraphis.") for name in allowlist):
        native_catalogs["engraphis"] = await _native_engraphis_tools()
    if allowlist is None or any(name.startswith("cbm.") for name in allowlist):
        native_catalogs["cbm"] = await _native_cbm_tools()
    if allowlist is None or any(name.startswith("graphiti.") for name in allowlist):
        native_catalogs["graphiti"] = await _native_graphiti_tools()
    for provider, native_tools in native_catalogs.items():
        tools.extend(_namespace_native_tools(provider, native_tools))
    if allowlist is not None:
        tools = [tool for tool in tools if tool.name in allowlist]
    names = [tool.name for tool in tools]
    if len(names) != len(set(names)):
        duplicates = sorted({name for name in names if names.count(name) > 1})
        raise RuntimeError("federated_duplicate_tool_name:" + ",".join(duplicates))
    context = _authenticated_main_context()
    # The public catalog is an OAuth-protected resource contract, independent
    # of whether this particular principal has resolved a Main project yet.
    # ChatGPT discovers securitySchemes from tools/list; omitting them until
    # after application-context resolution makes the live metadata circular.
    published = (
        _bind_authenticated_catalog(tools)
        if OAUTH_ENFORCED or context is not None
        else tools
    )
    catalog_count, catalog_hash = _catalog_identity(published)
    with _CATALOG_DIAGNOSTIC_LOCK:
        _LATEST_CATALOG_DIAGNOSTIC = {
            "publicToolCount": catalog_count,
            "publicToolUniqueCount": len({tool.name for tool in published}),
            "catalogHash": catalog_hash,
        }
    _trace(
        "catalog",
        mcp_method="tools/list",
        catalog_count=catalog_count,
        catalog_hash=catalog_hash,
        source_revision=_STARTUP_SOURCE_REVISION,
        source_sha256=_STARTUP_SOURCE_SHA256,
        response_status=200,
        completed=True,
        **_oauth_trace_fields(),
    )
    return published


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
    "_callerRuntimeBinding",
}


def _enforce_tool_caller(
    name: str,
    args: dict[str, Any],
    *,
    authenticated_external: bool = False,
) -> str | None:
    from app.python_models.idd import required_tool_caller_runtime_binding

    expected = required_tool_caller_runtime_binding(name)
    card_id = str(args.pop("_callerCardId", "") or "").strip()
    binding = str(args.pop("_callerRuntimeBinding", "") or "").strip()
    if authenticated_external and not binding:
        # The authenticated account MCP surface is the Main doorway. Hermes
        # stdio processes supply their exact saved runtime binding instead.
        binding = "main_chat"
    if expected is None:
        return None
    if not card_id or not binding:
        return "tool_caller_identity_unavailable"
    if binding != expected:
        return f"tool_caller_not_authorized: {name} requires {expected}"
    return None


def _bind_authenticated_catalog(tools: list[Tool]) -> list[Tool]:
    """Attach OAuth metadata without projecting or filtering the canonical registry."""
    result: list[Tool] = []
    for tool in tools:
        payload = tool.model_dump(by_alias=True, exclude_none=True)
        meta = dict(payload.get("_meta") or {})
        security_schemes = [
            {"type": "oauth2", "scopes": [AUTH0_REQUIRED_SCOPE]}
        ]
        native_system = next(
            (system for system, prefix in _NATIVE_PREFIXES.items() if tool.name.startswith(prefix)),
            None,
        )
        is_native = native_system is not None
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
            payload["inputSchema"] = schema
        elif native_system == "graphiti":
            schema = copy.deepcopy(tool.inputSchema)
            properties = schema.get("properties")
            if isinstance(properties, dict):
                properties.pop("group_id", None)
                properties.pop("group_ids", None)
            required = schema.get("required")
            if isinstance(required, list):
                schema["required"] = [
                    field for field in required if field not in {"group_id", "group_ids"}
                ]
            payload["inputSchema"] = schema
        payload["securitySchemes"] = security_schemes
        meta["securitySchemes"] = security_schemes
        payload["_meta"] = meta
        result.append(Tool.model_validate(payload))
    return result


# Structural allow-list per tool: unexpected keys are rejected honestly, never
# silently forwarded (prevents smuggling prompts/models/patches through the host).
_ALLOWED_KEYS: dict[str, set[str]] = {
    "main.context": set(),
    "coder.status": set(),
    "mag_one.describe_connected_agents": {"projectId", "deckId"},
    "run_mag_one": {"projectId", "deckId", "idfId", "conversationId"},
    "write_mag_one_instructions": {
        "projectId",
        "deckId",
        "conversationId",
        "instructions",
    },
    "canvas.inspect": {"projectId", "deckId"},
    "card.update_configuration": {"projectId", "deckId", "cardId", "updates"},
    "canvas.upsert_wire": {"projectId", "deckId", "op", "wire"},
    "card.run_assistant_agent": {
        "projectId",
        "deckId",
        "cardId",
        "correlationId",
        "conversationId",
        "originatingAgentId",
        "originatingRunId",
        "input",
    },
    "web_search": {"query", "max_results"},
}

_BRIDGE_PATHS: dict[str, str] = {
    "coder.status": "coder_status",
    "mag_one.describe_connected_agents": "describe_connected_agents",
    "run_mag_one": "run_mag_one",
}

# Control tools dispatch to the Python control-plane handlers (app/control_plane.py).
# Imported lazily so bridge-only usage never requires the psycopg dependency chain.
_CONTROL_HANDLER_NAMES: dict[str, str] = {
    "canvas.inspect": "canvas_inspect",
    "card.update_configuration": "card_update_configuration",
    "canvas.upsert_wire": "canvas_upsert_wire",
    "card.run_assistant_agent": "card_run_assistant_agent",
}


async def _dispatch_tool(
    name: str,
    arguments: dict[str, Any],
) -> Any:
    context = _authenticated_main_context()
    if name.startswith(_NATIVE_PREFIXES["engraphis"]):
        readiness_failure = _native_engraphis_readiness_failure()
        if readiness_failure is not None:
            return readiness_failure
        await _initialize_native_engraphis()
        native_name = "engraphis_" + name.removeprefix(_NATIVE_PREFIXES["engraphis"])
        if native_name in _NATIVE_ENGRAPHIS_NAMES:
            result = await asyncio.to_thread(
                asyncio.run,
                _native_engraphis_mcp().call_tool(
                    native_name,
                    dict(arguments or {}),
                ),
            )
            return _normalize_native_tool_result(result, dependency="engraphis")
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
        native_tools = await _native_graphiti_tools()
        native_name = name.removeprefix(_NATIVE_PREFIXES["graphiti"])
        if native_name in _NATIVE_GRAPHITI_NAMES:
            native_args = dict(arguments or {})
            include_body = bool(native_args.pop("include_body", False))
            preview_chars = max(0, min(2000, int(native_args.pop("body_preview_chars", 400))))
            response_budget = max(2000, min(100000, int(native_args.pop("max_response_chars", 20000))))
            if context is not None:
                if "group_id" in native_args or "group_ids" in native_args:
                    return [
                        TextContent(
                            type="text",
                            text=json.dumps(
                                {
                                    "ok": False,
                                    "error": "caller_identity_rejected: group_id,group_ids",
                                }
                            ),
                        )
                    ]
                group_id = graphiti_project_group_id(str(context["projectId"]))
                native_tool = next(
                    (
                        tool
                        for tool in native_tools
                        if tool.name == native_name
                    ),
                    None,
                )
                native_properties = (
                    native_tool.inputSchema.get("properties", {})
                    if native_tool is not None
                    and isinstance(native_tool.inputSchema, dict)
                    else {}
                )
                if "group_id" in native_properties:
                    native_args["group_id"] = group_id
                if "group_ids" in native_properties:
                    native_args["group_ids"] = [group_id]
            result = await _call_native_graphiti(native_name, native_args)
            if native_name == "get_episodes" and isinstance(result, CallToolResult):
                return _bounded_graphiti_episodes(
                    result,
                    include_body=include_body,
                    preview_chars=preview_chars,
                    response_budget=response_budget,
                )
            return result
    allowed = _ALLOWED_KEYS.get(name)
    if allowed is None:
        return [TextContent(type="text", text=json.dumps({"ok": False, "error": f"unknown_tool: {name}"}))]
    args = dict(arguments or {})
    if context is not None:
        try:
            supplied_identity = sorted(_SERVER_OWNED_ARGUMENTS & args.keys())
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
            from app.python_models.idd import required_tool_caller_runtime_binding

            if required_tool_caller_runtime_binding(name) is not None:
                args["_callerCardId"] = str(context["mainCardId"])
                args["_callerRuntimeBinding"] = str(
                    context.get("callerRuntimeBinding") or "main_chat"
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
    extra = [k for k in args.keys() if k not in allowed]
    if extra:
        return [
            TextContent(
                type="text",
                text=json.dumps({"ok": False, "error": f"tool_arguments_rejected: {','.join(sorted(extra))}"}),
            )
        ]
    if name == "write_mag_one_instructions":
        from app.python_models import idf

        try:
            result = await asyncio.to_thread(
                idf.create_input_data_file,
                project_id=str(args.get("projectId") or ""),
                deck_id=str(args.get("deckId") or ""),
                conversation_id=str(args.get("conversationId") or ""),
                run_id=f"idf-preparation:{uuid4().hex[:20]}",
                originating_card_id=caller_card_id,
                system_text="",
                user_text=str(args.get("instructions") or ""),
            )
            return [TextContent(type="text", text=json.dumps(result))]
        except idf.InputDataFileError:
            return [TextContent(type="text", text=json.dumps({"ok": False, "error": "idf_persistence_failed"}))]
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
                        "diagnostics": _catalog_diagnostics(),
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
                try:
                    payload = json.loads(text)
                except json.JSONDecodeError:
                    continue
                if isinstance(payload, dict) and (
                    payload.get("ok") is False
                    or bool(payload.get("error"))
                ):
                    return "tool_error"
    except Exception:
        return "tool_error"
    return "success"


def _execution_receipt(name: str) -> dict[str, Any]:
    return {
        "schema": "agent-runtime.execution-receipt.v1",
        "tool": name,
        "correlationId": f"mcp:{uuid4()}",
        "operationPhase": "dispatch",
        "local": True,
        "startedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "state": "running",
        "providerSubstitution": False,
        "providerCalls": [],
    }


def _failure_code_from_result(result: Any) -> str | None:
    blocks = result.content if isinstance(result, CallToolResult) else result
    if not isinstance(blocks, list):
        return None
    for block in blocks:
        try:
            payload = json.loads(str(getattr(block, "text", "") or ""))
        except (TypeError, ValueError, json.JSONDecodeError):
            continue
        if isinstance(payload, dict):
            failure = payload.get("failureCode") or payload.get("error")
            if failure:
                return str(failure)[:160]
    return None


def _attach_execution_receipt(result: Any, receipt: dict[str, Any]) -> Any:
    block = TextContent(
        type="text",
        text=json.dumps({"executionReceipt": receipt}, ensure_ascii=False),
    )
    if isinstance(result, CallToolResult):
        payload = result.model_dump(exclude_none=True)
        payload["content"] = [*result.content, block]
        return CallToolResult.model_validate(payload)
    if isinstance(result, list):
        return [*result, block]
    return CallToolResult(content=[TextContent(type="text", text=str(result)), block])


def _mcp_tool_timeout_seconds(name: str) -> float:
    if name == "cbm.index_repository":
        return _NATIVE_CBM_REQUEST_TIMEOUT_SECONDS
    return _MCP_CALL_TIMEOUT_SECONDS


@server.call_tool()
async def call_tool(name: str, arguments: dict[str, Any]) -> Any:
    started_clock = time.monotonic()
    receipt = _execution_receipt(str(name or ""))
    receipt_token = _ACTIVE_EXECUTION_RECEIPT.set(receipt)
    trace_fields = {
        "mcp_method": "tools/call",
        "tool_name": str(name or "")[:160],
        **_oauth_trace_fields(),
    }
    _trace("tool_call_started", **trace_fields)
    try:
        if not _tool_is_allowed(name):
            raise PermissionError(f"tool_not_granted: {name}")
        result = await asyncio.wait_for(
            _dispatch_tool(name, arguments),
            timeout=_mcp_tool_timeout_seconds(name),
        )
        result_category = _tool_result_category(result)
        receipt["durationMs"] = int((time.monotonic() - started_clock) * 1000)
        receipt["state"] = "failed" if result_category == "tool_error" else "completed"
        receipt["failureCode"] = (
            _failure_code_from_result(result) if result_category == "tool_error" else None
        )
        _trace(
            "tool_call_completed",
            **trace_fields,
            response_status=500 if result_category == "tool_error" else 200,
            result_category=result_category,
            completed=True,
        )
        if result_category == "tool_error" and isinstance(result, list):
            result = CallToolResult(content=result, isError=True)
        return _attach_execution_receipt(result, receipt)
    except Exception as error:
        receipt["durationMs"] = int((time.monotonic() - started_clock) * 1000)
        receipt["state"] = "failed"
        failure = _typed_failure(error, dependency="mcp")
        receipt["failureCode"] = failure.get("failureCode")
        _trace(
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
        return _attach_execution_receipt(result, receipt)
    finally:
        _ACTIVE_EXECUTION_RECEIPT.reset(receipt_token)


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
    from starlette.routing import Mount, Route

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
        auth_backend: AuthenticationBackend = BearerAuthBackend(Auth0TokenVerifier(config_values))
        protected_endpoint = AuthenticationMiddleware(protected_endpoint, backend=auth_backend)
        protected_resource_routes = create_protected_resource_routes(
            resource_url=resource_url,
            authorization_servers=[AnyHttpUrl(config_values.issuer_url)],
            scopes_supported=list(OAUTH_SCOPES),
            resource_name=_PUBLIC_MCP_NAME,
        )
        routes = [
            Route(
                "/.well-known/oauth-protected-resource",
                endpoint=protected_resource_routes[0].endpoint,
                methods=["GET", "OPTIONS"],
            ),
            *protected_resource_routes,
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
    if MCP_TRANSPORT == "stdio":
        # The Harness connection deadline protects the MCP protocol handshake,
        # not native provider startup.  Graphiti/Neo4j initialization can take
        # longer than that deadline when the external HTTP host is starting at
        # the same time.  Begin serving stdio immediately; the existing
        # list_tools path discovers the complete native catalogs before it
        # returns them to the Harness.
        _start_native_engraphis_warmup()
        await _run_stdio()
        return
    await _initialize_native_engraphis()
    _start_native_engraphis_warmup()
    await _initialize_native_graphiti()
    if MCP_TRANSPORT == "streamable-http":
        await _native_cbm_tools()
        await _run_streamable_http()
        return
    raise RuntimeError(f"unsupported_mcp_transport: {MCP_TRANSPORT}")


if __name__ == "__main__":
    asyncio.run(main())
