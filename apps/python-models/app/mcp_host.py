"""The one official Python MCP host for LiquidAIty runtimes and connectors.

The canonical supervised service tree launches one Streamable HTTP host for
the process lifetime. Hermes and AutoGen use that same authenticated seam; no
per-turn spawn or fallback host exists.

Exposes this application tool surface plus the process-owned Constellation
ThinkGraph adapter and dynamically discovered Codebase Memory and official
Graphiti MCP registries:
  * mag_one.describe_connected_agents (read connected, bus-eligible Mag One cards)
  * run_mag_one                      (Main-only transient Mag One mission)
  * web_search                       (real Tavily search; Search Agent only by grant)
  * canvas.inspect / card.create / card.update_configuration / canvas.upsert_wire /
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
import functools
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
import traceback
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
from app.python_models.tool_registry import (
    external_mcp_tool_ids,
    readable_tool_ids,
    tool_publication,
    tool_access,
)
from app.python_models.card_script import CardScript
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
PYTHON_RAILS = os.environ.get(
    "AUTOGEN_ORCHESTRATOR_URL", "http://127.0.0.1:8003"
).rstrip("/")
MCP_TRANSPORT = os.environ.get("MCP_TRANSPORT", "stdio").strip().lower()
HTTP_MCP_HOST = "127.0.0.1"
HTTP_MCP_PORT = int(os.environ.get("MCP_HTTP_PORT", "8765"))
HTTP_MCP_PATH = "/mcp"
PUBLIC_MCP_RESOURCE_URL = os.environ.get("MCP_PUBLIC_RESOURCE_URL", "").strip()
AUTH0_ISSUER_URL = os.environ.get("MCP_AUTH0_ISSUER_URL", "").strip()
AUTH0_AUDIENCE = os.environ.get("MCP_AUTH0_AUDIENCE", "").strip()
AUTH0_CLIENT_ID = os.environ.get("MCP_AUTH0_CLIENT_ID", "").strip()
AUTH0_REQUIRED_SCOPE = os.environ.get(
    "MCP_AUTH0_REQUIRED_SCOPE", "liquidaity.main"
).strip()
INTERNAL_MCP_SECRET = os.environ.get("LIQUIDAITY_INTERNAL_MCP_SECRET", "").strip()
INTERNAL_MCP_ISSUER = "liquidaity-runtime"
INTERNAL_MCP_AUDIENCE = "liquidaity-internal-mcp"
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
_CATALOG_STATE = "initializing"
_CATALOG_FAILURE: str | None = None
_CATALOG_FAILURE_CODE: str | None = None
_CATALOG_FAILURE_SUMMARY: str | None = None
_CATALOG_COMPLETED_FAMILIES: tuple[str, ...] = ()
_CATALOG_INITIALIZING_FAMILY: str | None = "liquidaity"
_HTTP_CATALOG_TOOLS: tuple[Tool, ...] | None = None
_HTTP_CATALOG_INITIALIZATION_TASK: asyncio.Task[None] | None = None
_NATIVE_TOOL_TIMEOUT_SECONDS = 30.0
_NATIVE_CBM_REQUEST_TIMEOUT_SECONDS = 300.0
_NATIVE_CBM_HEALTH_TIMEOUT_SECONDS = 5.0
_MCP_CALL_TIMEOUT_SECONDS = 30.0
_PUBLIC_MCP_NAME = "LiquidAIty"
_PUBLIC_MCP_DESCRIPTION = (
    "Connect ChatGPT to LiquidAIty projects, saved agent cards, CodeGraph, "
    "ThinkGraph, KnowGraph, and supported agent runtimes."
)
_ACTIVE_EXECUTION_RECEIPT: ContextVar[dict[str, Any] | None] = ContextVar(
    "mcp_execution_receipt", default=None
)
_ACTIVE_AUTHENTICATED_CONTEXT: ContextVar[dict[str, Any] | None] = ContextVar(
    "active_authenticated_mcp_context", default=None
)
_ACTIVE_GRAPHITI_ATTENTION: ContextVar[dict[str, Any] | None] = ContextVar(
    "active_graphiti_attention", default=None
)
_GRAPHITI_PROVIDER_HEALTH_LOCK = threading.Lock()
_GRAPHITI_PROVIDER_HEALTH: dict[str, Any] = {
    "last_success": None,
    "last_failure": None,
}
_MAIN_CONTEXT_FIELDS = frozenset(
    {"projectId", "deckId", "conversationId", "parentRunId", "mainCardId"}
)
_TRUSTED_STDIO_OPTIONAL_CONTEXT_FIELDS = frozenset(
    {"callerRuntimeKind", "callerRuntimeMode"}
)
_AUTHENTICATED_OPTIONAL_CONTEXT_FIELDS = frozenset(
    {"callerRuntimeKind", "callerRuntimeMode", "principalKind", "grantedTools",
     "nativeChildId", "nativeRunId"}
)


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
    if tool_publication(name) == "private-admin":
        return False
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
        "catalog_family",
        "catalog_hash",
        "client_hash",
        "completed",
        "exception_class",
        "failure_code",
        "http_method",
        "mcp_method",
        "response_status",
        "result_category",
        "session_hash",
        "source_revision",
        "source_sha256",
        "subject_hash",
        "canonical_tool_name",
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
    """Return bounded process/catalog readiness without exposing membership."""
    with _CATALOG_DIAGNOSTIC_LOCK:
        identity = dict(_LATEST_CATALOG_DIAGNOSTIC or {})
        state = _CATALOG_STATE
        failure = _CATALOG_FAILURE
        failure_code = _CATALOG_FAILURE_CODE
        failure_summary = _CATALOG_FAILURE_SUMMARY
        completed_families = list(_CATALOG_COMPLETED_FAMILIES)
        initializing_family = _CATALOG_INITIALIZING_FAMILY
    return {
        "state": state,
        "catalogState": state,
        "catalogReady": state == "ready" and bool(identity),
        **({"catalogFailure": failure} if failure else {}),
        **({"failureCode": failure_code} if failure_code else {}),
        **({"failureSummary": failure_summary} if failure_summary else {}),
        "completedCatalogFamilies": completed_families,
        "initializingCatalogFamily": initializing_family,
        **(identity if state == "ready" else {}),
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


def _catalog_failure_details(error: Exception) -> tuple[str, str]:
    """Return a stable failure code and an HTTP-safe bounded summary."""
    detail = _sanitize_failure_detail(error)
    if "CBM daemon could not start within 30000 ms" in str(error):
        code = "native_cbm_daemon_start_timeout"
    else:
        match = re.match(r"^([a-z][a-z0-9_]+)(?::|$)", detail)
        if match is not None:
            code = match.group(1)
        else:
            with _CATALOG_DIAGNOSTIC_LOCK:
                family = _CATALOG_INITIALIZING_FAMILY
            code = (
                f"{family}_catalog_initialization_failed"
                if family
                else "catalog_initialization_failed"
            )
    return code, f"{error.__class__.__name__}: {detail or 'no detail'}"


def _set_catalog_initializing_family(family: str) -> None:
    global _CATALOG_INITIALIZING_FAMILY
    with _CATALOG_DIAGNOSTIC_LOCK:
        _CATALOG_INITIALIZING_FAMILY = family
    _trace("catalog_family_initializing", catalog_family=family, completed=False)


def _complete_catalog_family(family: str) -> None:
    global _CATALOG_COMPLETED_FAMILIES, _CATALOG_INITIALIZING_FAMILY
    with _CATALOG_DIAGNOSTIC_LOCK:
        if family not in _CATALOG_COMPLETED_FAMILIES:
            _CATALOG_COMPLETED_FAMILIES = (*_CATALOG_COMPLETED_FAMILIES, family)
        _CATALOG_INITIALIZING_FAMILY = None
    _trace("catalog_family_ready", catalog_family=family, completed=True)


def _typed_failure(value: Any, *, dependency: str = "provider") -> dict[str, Any]:
    detail = _sanitize_failure_detail(value)
    lowered = detail.lower()
    if "local_embedding_model_unavailable" in lowered:
        code, retryable = "local_embedding_model_unavailable", False
    elif "tool_not_granted" in lowered:
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
    if code in {
        "database_failure",
        "queue_failure",
        "service_unavailable",
        "local_embedding_model_unavailable",
    }:
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
    active = _ACTIVE_AUTHENTICATED_CONTEXT.get()
    if active is not None:
        return dict(active)
    access_token = get_access_token()
    if access_token is None:
        return _trusted_stdio_main_context()
    expires_at = getattr(access_token, "expires_at", None)
    if expires_at is not None and float(expires_at) <= time.time():
        return None
    claims = getattr(access_token, "claims", None)
    internal = claims.get("internal") if isinstance(claims, dict) else None
    if isinstance(internal, dict) and internal.get("kind") in {"card-runtime", "system-root"}:
        context = {
            "projectId": internal.get("projectId"),
            "deckId": internal.get("deckId"),
            "conversationId": internal.get("conversationId"),
            "parentRunId": internal.get("parentRunId"),
            "mainCardId": internal.get("callerCardId"),
            "callerRuntimeKind": internal.get("callerRuntimeKind"),
            "callerRuntimeMode": internal.get("callerRuntimeMode"),
            "principalKind": internal.get("kind"),
            "grantedTools": internal.get("grantedTools", []),
            "nativeChildId": internal.get("nativeChildId"),
            "nativeRunId": internal.get("nativeRunId"),
        }
    else:
        context = claims.get("main") if isinstance(claims, dict) else None
    if not isinstance(context, dict) or not _MAIN_CONTEXT_FIELDS.issubset(context):
        return None
    resolved: dict[str, Any] = {
        field: str(context[field]) for field in _MAIN_CONTEXT_FIELDS
    }
    for field in _AUTHENTICATED_OPTIONAL_CONTEXT_FIELDS:
        value = context.get(field)
        if field == "grantedTools" and isinstance(value, list):
            resolved[field] = sorted(
                {str(item).strip() for item in value if str(item).strip()}
            )
        elif str(value or "").strip():
            resolved[field] = str(value)
    return resolved


def _internal_mcp_principal() -> dict[str, Any] | None:
    access_token = get_access_token()
    claims = getattr(access_token, "claims", None) if access_token is not None else None
    principal = claims.get("internal") if isinstance(claims, dict) else None
    return dict(principal) if isinstance(principal, dict) else None


def _request_execution_context() -> dict[str, Any] | None:
    """Resolve trusted per-call MCP metadata through the active host registry."""

    principal = _internal_mcp_principal()
    if principal is None or principal.get("requiresExecutionContext") is not True:
        return None
    try:
        meta = server.request_context.meta
    except LookupError:
        meta = None
    if hasattr(meta, "model_dump"):
        meta = meta.model_dump(exclude_none=True)
    if not isinstance(meta, dict):
        meta = {}
    meta_context_id = str(meta.get("liquidaity/execution") or "").strip()
    principal_context_id = str(principal.get("executionContextId") or "").strip()
    if meta_context_id and principal_context_id and meta_context_id != principal_context_id:
        raise PermissionError("mcp_execution_context_invalid")
    context_id = meta_context_id or principal_context_id
    if not context_id:
        raise PermissionError("mcp_execution_context_missing")
    try:
        response = json.loads(_bridge_sync(
            "internal_execution_context",
            {"contextId": context_id, "principal": principal},
        ))
    except (TypeError, ValueError, json.JSONDecodeError) as error:
        raise PermissionError("mcp_execution_context_invalid") from error
    context = response.get("context") if isinstance(response, dict) and response.get("ok") is True else None
    required = {
        "projectId", "deckId", "conversationId", "runId", "cardId",
        "grantedTools", "rootRunId",
    }
    if not isinstance(context, dict) or not required.issubset(context):
        raise PermissionError("mcp_execution_context_rejected")
    grants = context.get("grantedTools")
    if not isinstance(grants, list):
        raise PermissionError("mcp_execution_context_grants_invalid")
    return {
        "projectId": str(context["projectId"]),
        "deckId": str(context["deckId"]),
        "conversationId": str(context["conversationId"]),
        "parentRunId": str(context["runId"]),
        "rootRunId": str(context["rootRunId"]),
        "mainCardId": str(context["cardId"]),
        "callerRuntimeKind": "hermes",
        "callerRuntimeMode": str(context.get("runtimeMode") or ""),
        "principalKind": "card-runtime",
        "nativeChildId": str(context.get("nativeChildId") or ""),
        "grantedTools": sorted({str(item).strip() for item in grants if str(item).strip()}),
    }


def _request_tool_is_allowed(name: str) -> bool:
    if not _tool_is_allowed(name):
        return False
    access = tool_access(name)
    principal = _internal_mcp_principal()
    # The public host preserves the canonical unknown-tool error from dispatch.
    # An internal Card-scoped connection fails closed before dispatch because it
    # may call only operations declared by the literal IDD.
    if access is None:
        return principal is None
    if principal is None:
        return True
    kind = str(principal.get("kind") or "")
    if kind == "catalog-reader":
        return False
    if kind == "materializer-read":
        return access == "read"
    if kind == "system-root":
        return name == "card.run_assistant_agent"
    if kind != "card-runtime":
        return False
    active = _ACTIVE_AUTHENTICATED_CONTEXT.get()
    if principal.get("requiresExecutionContext") is True:
        grants = active.get("grantedTools") if isinstance(active, dict) else None
        return isinstance(grants, list) and name in grants
    grants = principal.get("grantedTools")
    return isinstance(grants, list) and name in {
        str(value).strip() for value in grants if str(value).strip()
    }


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

_NATIVE_CBM_CLIENT: "_NativeStdioMcpClient | None" = None
_NATIVE_CBM_TOOLS: tuple[Tool, ...] | None = None
_NATIVE_CBM_NAMES: frozenset[str] = frozenset()
_NATIVE_CBM_INIT_LOCK = threading.Lock()
_NATIVE_CBM_INDEX_LOCK = threading.Lock()
_NATIVE_CBM_INDEX_IN_FLIGHT: tuple[str, Future[CallToolResult]] | None = None
_NATIVE_CBM_HOST_REPO_ROOT = os.path.normpath(_REPO_ROOT)
_NATIVE_CBM_PROJECT = "C-Projects-LiquidAIty-main"
_NATIVE_CBM_EXPECTED_VERSION = "0.10.8"
_NATIVE_CBM_EXPECTED_SHA256 = "b4b403b1d7c4def3785f148b93f345ce8427858f4f5489ce28580c4387a336a6"
_NATIVE_CBM_BINARY = os.environ.get("MCP_CBM_BINARY", "").strip() or os.path.join(
    os.environ.get("LOCALAPPDATA", ""),
    "LiquidAIty",
    "cbm",
    _NATIVE_CBM_EXPECTED_VERSION,
    "codebase-memory-mcp.exe",
)
_NATIVE_CBM_CACHE_ROOT = os.path.join(
    os.path.expanduser("~"), ".cache", "codebase-memory-mcp"
)
_NATIVE_CBM_DAEMON_LOG = os.path.join(_NATIVE_CBM_CACHE_ROOT, "logs", "cbm-daemon.log")
_NATIVE_GRAPHITI_MODULE: Any | None = None
_NATIVE_GRAPHITI_TOOLS: tuple[Tool, ...] | None = None
_NATIVE_GRAPHITI_NAMES: frozenset[str] = frozenset()
_NATIVE_GRAPHITI_UNAVAILABLE: dict[str, Any] | None = None
_NATIVE_GRAPHITI_SERVICE_READY = False
_NATIVE_GRAPHITI_SERVICE_INIT_LOCK = asyncio.Lock()
_NATIVE_PREFIXES = {
    "cbm": "cbm.",
    "graphiti": "graphiti.",
}


def _namespace_native_tools(provider: str, tools: list[Tool]) -> list[Tool]:
    """Add the established public routing prefix while preserving native tools."""
    prefix = _NATIVE_PREFIXES[provider]
    result: list[Tool] = []
    for tool in tools:
        payload = tool.model_dump(by_alias=True, exclude_none=True)
        native_name = tool.name
        payload["name"] = prefix + native_name
        meta = dict(payload.get("_meta") or {})
        meta["liquidaitySource"] = {
            "sourceId": provider,
            "namespace": provider,
            "nativeName": tool.name,
            "connectionKind": "external-mcp",
        }
        payload["_meta"] = meta
        if provider == "cbm":
            schema = copy.deepcopy(payload.get("inputSchema") or {})
            format_schema = schema.get("properties", {}).get("format", {})
            if "json" in format_schema.get("enum", []):
                format_schema["default"] = "json"
                payload["inputSchema"] = schema
                payload["description"] = (payload.get("description") or "") + (
                    " LiquidAIty defaults to native JSON for exact attention IDs; an explicit format is preserved."
                )
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


def _bind_idd_access(tool: Tool) -> Tool:
    """Keep authorization metadata separate from native side-effect hints."""
    access = tool_access(tool.name)
    if access is None:
        raise RuntimeError(f"mcp_tool_missing_idd_access:{tool.name}")
    payload = tool.model_dump(by_alias=True, exclude_none=True)
    meta = dict(payload.get("_meta") or {})
    meta["liquidaityAccess"] = access
    payload["_meta"] = meta
    return Tool.model_validate(payload)


def _gpt_public_catalog(tools: list[Tool]) -> list[Tool]:
    """Project the canonical catalog through the IDD external-MCP policy."""
    published = external_mcp_tool_ids()
    return [tool for tool in tools if tool.name in published]


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
    """Discover the native Graphiti catalog without opening provider connections."""
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
        tools = tuple(
            await asyncio.to_thread(
                asyncio.run,
                native.mcp.list_tools(),
            )
        )
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


async def _ensure_native_graphiti_service() -> None:
    """Open Graphiti providers lazily on the first Graphiti tool call."""
    global _NATIVE_GRAPHITI_SERVICE_READY, _NATIVE_GRAPHITI_UNAVAILABLE
    if _NATIVE_GRAPHITI_SERVICE_READY:
        return
    await _initialize_native_graphiti()
    native = _NATIVE_GRAPHITI_MODULE
    if native is None:
        detail = (_NATIVE_GRAPHITI_UNAVAILABLE or {}).get(
            "detail", "Graphiti catalog is unavailable."
        )
        raise RuntimeError(f"native_graphiti_unavailable:{detail}")
    async with _NATIVE_GRAPHITI_SERVICE_INIT_LOCK:
        if _NATIVE_GRAPHITI_SERVICE_READY:
            return
        try:
            native.config = _graphiti_config()
            native.graphiti_service = native.GraphitiService(
                native.config, native.SEMAPHORE_LIMIT
            )
            native.queue_service = native.QueueService()
            await native.graphiti_service.initialize()
            native.graphiti_client = await native.graphiti_service.get_client()
            native.semaphore = native.graphiti_service.semaphore
            await native.queue_service.initialize(native.graphiti_client)
            _instrument_graphiti_attention(native.graphiti_client, native.queue_service)
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
                    str(native.config.embedder.provider),
                    str(embedder_provider.api_url or ""),
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
        except BaseException as error:
            client = getattr(native, "graphiti_client", None)
            close = getattr(getattr(client, "driver", None), "close", None)
            if callable(close):
                close_result = close()
                if inspect.isawaitable(close_result):
                    await close_result
            native.graphiti_client = None
            _NATIVE_GRAPHITI_SERVICE_READY = False
            _NATIVE_GRAPHITI_UNAVAILABLE = {
                "ok": False,
                "failureCode": "optional_capability_unavailable",
                "errorCategory": "DEPENDENCY_UNAVAILABLE",
                "retryable": True,
                "dependency": "graphiti",
                "detail": (
                    "Graphiti provider initialization failed "
                    f"({error.__class__.__name__})."
                ),
            }
            if isinstance(error, asyncio.CancelledError):
                raise
            raise RuntimeError(
                f"native_graphiti_initialization_failed:{error.__class__.__name__}"
            ) from error
        _NATIVE_GRAPHITI_SERVICE_READY = True
        _NATIVE_GRAPHITI_UNAVAILABLE = None


async def _native_graphiti_tools() -> list[Tool]:
    await _initialize_native_graphiti()
    return list(_NATIVE_GRAPHITI_TOOLS or ())


async def _call_native_graphiti(name: str, arguments: dict[str, Any]):
    try:
        await asyncio.wait_for(
            _ensure_native_graphiti_service(),
            timeout=_NATIVE_TOOL_TIMEOUT_SECONDS,
        )
    except TimeoutError as error:
        raise RuntimeError("native_graphiti_initialization_timeout") from error
    if _NATIVE_GRAPHITI_MODULE is None:
        raise RuntimeError("native_graphiti_not_initialized")
    observation: dict[str, Any] | None = (
        {"context": _authenticated_main_context(), "event": None}
        if name == "add_memory" else None
    )
    token = _ACTIVE_GRAPHITI_ATTENTION.set(observation)
    try:
        try:
            result = await asyncio.wait_for(
                _NATIVE_GRAPHITI_MODULE.mcp.call_tool(name, arguments),
                timeout=_NATIVE_TOOL_TIMEOUT_SECONDS,
            )
        except TimeoutError as error:
            raise RuntimeError(f"native_graphiti_timeout:{name}") from error
        result = _normalize_graphiti_result(result)
        if observation and observation.get("event") and isinstance(result, CallToolResult):
            result.meta = {**(result.meta or {}), "nativeAttention": observation["event"]}
        return result
    finally:
        _ACTIVE_GRAPHITI_ATTENTION.reset(token)


async def _persist_native_attention(event: dict[str, Any], context: dict[str, Any] | None) -> bool:
    from app.python_models.card_domain import observe_native_attention

    options = {}
    if (context and not context.get("principalKind")
            and str(context.get("parentRunId") or "").startswith("external-main:")):
        options["external_context"] = context
    try:
        written = await asyncio.to_thread(observe_native_attention, event, **options)
    except Exception:
        # Observation cannot turn a completed native write into a retryable
        # tool failure. Surface the missing AGE evidence separately.
        written = False
    event.pop("persisted", None)
    if not written:
        event["persisted"] = False
    _trace("native_attention_observed", tool_name=event["toolName"],
           result_category="age_observed" if written else "age_observation_failed", completed=True)
    return written


def _instrument_graphiti_attention(client: Any, queue: Any) -> None:
    """Observe public native queue/SDK completion without owning their lifecycle.

    The existing queue retains the request's observation alongside its own
    process function. Native add_episode results, not inferred graph queries or
    model prose, resolve the same pending AGE event with concrete IDs.
    """
    if getattr(queue, "_liquidaity_attention_bound", False):
        return
    enqueue = queue.add_episode_task
    add_episode = client.add_episode

    async def observed_add_episode(*args: Any, **kwargs: Any) -> Any:
        result = await add_episode(*args, **kwargs)
        observation = _ACTIVE_GRAPHITI_ATTENTION.get()
        if observation and observation.get("event"):
            from app.python_models.native_attention import build_native_attention_event

            payload = {
                "phase": "completed",
                "episodes": [{"uuid": getattr(getattr(result, "episode", None), "uuid", None)}],
                "nodes": [{"uuid": getattr(node, "uuid", None)} for node in (getattr(result, "nodes", None) or [])],
                "edges": [{"uuid": getattr(edge, "uuid", None),
                           "source_node_uuid": getattr(edge, "source_node_uuid", None),
                           "target_node_uuid": getattr(edge, "target_node_uuid", None),
                           "name": getattr(edge, "name", None)} for edge in (getattr(result, "edges", None) or [])],
            }
            event = build_native_attention_event("graphiti.add_memory", payload, observation["context"])
            if event is not None:
                event["eventId"] = observation["event"]["eventId"]
                observation["event"] = event
                await _persist_native_attention(event, observation["context"])
        return result

    async def observed_enqueue(group_id: str, process_func: Any) -> int:
        observation = _ACTIVE_GRAPHITI_ATTENTION.get()
        if not observation:
            return await enqueue(group_id, process_func)
        from app.python_models.native_attention import build_native_attention_event

        event = build_native_attention_event("graphiti.add_memory", {"phase": "pending"}, observation["context"])
        observation["event"] = event
        if event:
            await _persist_native_attention(event, observation["context"])

        async def failed() -> None:
            if observation.get("event"):
                failure = {**observation["event"], "phase": "failed",
                           "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")}
                observation["event"] = failure
                await _persist_native_attention(failure, observation["context"])

        async def observed_process() -> None:
            current = _ACTIVE_GRAPHITI_ATTENTION.set(observation)
            try:
                await process_func()
            except BaseException:
                await failed()
                raise
            finally:
                _ACTIVE_GRAPHITI_ATTENTION.reset(current)

        try:
            return await enqueue(group_id, observed_process)
        except BaseException:
            await failed()
            raise

    client.add_episode = observed_add_episode
    queue.add_episode_task = observed_enqueue
    queue._liquidaity_attention_bound = True


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
    global _NATIVE_GRAPHITI_SERVICE_READY
    native = _NATIVE_GRAPHITI_MODULE
    _NATIVE_GRAPHITI_MODULE = None
    _NATIVE_GRAPHITI_TOOLS = None
    _NATIVE_GRAPHITI_NAMES = frozenset()
    _NATIVE_GRAPHITI_UNAVAILABLE = None
    _NATIVE_GRAPHITI_SERVICE_READY = False
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
        self.server_info: dict[str, Any] = {}
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
        try:
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
                timeout_seconds=None,
            )
            server_info = initialized.get("serverInfo")
            if not isinstance(server_info, dict):
                raise RuntimeError("native_cbm_initialize_invalid")
            self.server_info = dict(server_info)
            self._notify("notifications/initialized", {})
        except Exception:
            self.close()
            raise

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

    def _request(
        self,
        method: str,
        params: dict[str, Any],
        *,
        timeout_seconds: float | None = _NATIVE_CBM_REQUEST_TIMEOUT_SECONDS,
    ) -> dict[str, Any]:
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
            deadline = (
                time.monotonic() + timeout_seconds
                if timeout_seconds is not None
                else None
            )
            while True:
                remaining = deadline - time.monotonic() if deadline is not None else None
                if remaining is not None and remaining <= 0:
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

    def call_tool(
        self,
        name: str,
        arguments: dict[str, Any],
        *,
        timeout_seconds: float = _NATIVE_CBM_REQUEST_TIMEOUT_SECONDS,
    ) -> CallToolResult:
        result = self._request(
            "tools/call",
            {"name": name, "arguments": dict(arguments or {})},
            timeout_seconds=timeout_seconds,
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
    """Open the one AppData-installed native CBM frontend owned by this host."""
    return (os.path.abspath(_NATIVE_CBM_BINARY), [], _NATIVE_CBM_HOST_REPO_ROOT)


def _normalize_native_cbm_index_arguments(
    arguments: dict[str, Any],
) -> dict[str, Any]:
    """Pin indexing to the one canonical host checkout and project identity."""
    normalized = dict(arguments or {})
    repo_path = normalized.get("repo_path")
    if not isinstance(repo_path, str):
        return normalized

    requested_path = repo_path.strip().rstrip("/\\")
    host_path = os.path.normcase(os.path.normpath(requested_path))
    canonical_host_path = os.path.normcase(_NATIVE_CBM_HOST_REPO_ROOT)
    if host_path == canonical_host_path:
        normalized["repo_path"] = _NATIVE_CBM_HOST_REPO_ROOT
        normalized["name"] = _NATIVE_CBM_PROJECT
    return normalized


def _open_native_cbm_client(
    command: str,
    args: list[str],
    cwd: str,
) -> tuple[_NativeStdioMcpClient, tuple[Tool, ...], list[str]]:
    """Open exactly one native frontend; native startup failures stay terminal."""
    client: _NativeStdioMcpClient | None = None
    try:
        client = _NativeStdioMcpClient(command, args, cwd)
        tools = tuple(client.list_tools())
        names = [tool.name for tool in tools]
        if len(names) != len(set(names)):
            raise RuntimeError("native_cbm_duplicate_tool_name")
        return client, tools, names
    except Exception:
        if client is not None:
            client.close()
        raise


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
        client, tools, names = _open_native_cbm_client(command, args, cwd)
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
    native_arguments = dict(arguments)
    native_tool = next((tool for tool in (_NATIVE_CBM_TOOLS or ()) if tool.name == name), None)
    format_schema = (native_tool.inputSchema.get("properties", {}).get("format", {})
                     if native_tool is not None else {})
    if "format" not in native_arguments and "json" in format_schema.get("enum", []):
        native_arguments["format"] = "json"
    return client.call_tool(name, native_arguments)


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


def _native_result_payload(result: CallToolResult) -> dict[str, Any]:
    if result.isError:
        detail = next(
            (
                block.text
                for block in result.content
                if isinstance(block, TextContent) and block.text
            ),
            "native_cbm_tool_error",
        )
        raise RuntimeError(detail)
    structured = result.structuredContent
    if isinstance(structured, dict):
        payload = structured.get("result", structured)
        if isinstance(payload, dict):
            return payload
    for block in result.content:
        if not isinstance(block, TextContent) or not block.text:
            continue
        try:
            payload = json.loads(block.text)
        except json.JSONDecodeError:
            continue
        if isinstance(payload, dict):
            return payload
    raise RuntimeError("native_cbm_health_payload_invalid")


@functools.lru_cache(maxsize=1)
def _native_cbm_binary_sha256() -> str:
    digest = hashlib.sha256()
    with open(_NATIVE_CBM_BINARY, "rb") as binary:
        for chunk in iter(lambda: binary.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _host_codegraph_runtime() -> dict[str, Any]:
    binary_path = os.path.abspath(_NATIVE_CBM_BINARY)
    binary_exists = os.path.isfile(binary_path)
    binary_sha256 = _native_cbm_binary_sha256() if binary_exists else ""
    binary_ready = binary_sha256 == _NATIVE_CBM_EXPECTED_SHA256
    return {
        "runtimeReady": binary_ready,
        "runtimeState": "ready" if binary_ready else (
            "checksum_mismatch" if binary_exists else "missing"
        ),
        "binaryPath": binary_path,
        "binaryReady": binary_ready,
        "binaryState": "ready" if binary_ready else (
            "checksum_mismatch" if binary_exists else "missing"
        ),
        "binarySha256": binary_sha256,
        "cachePath": _NATIVE_CBM_CACHE_ROOT,
    }


def _native_codegraph_watcher_status() -> dict[str, Any]:
    try:
        with open(_NATIVE_CBM_DAEMON_LOG, "r", encoding="utf-8", errors="replace") as log:
            lines = list(deque(log, maxlen=500))
    except OSError as error:
        return {
            "watcherActive": False,
            "watcherState": "unavailable",
            "watcherFailure": str(error),
        }
    latest_start = max(
        (index for index, line in enumerate(lines) if "msg=watcher.start " in line),
        default=-1,
    )
    registration = (
        f"msg=watcher.watch project={_NATIVE_CBM_PROJECT} "
        f"path={_NATIVE_CBM_HOST_REPO_ROOT}"
    )
    latest_registration = max(
        (
            index
            for index, line in enumerate(lines)
            if index > latest_start and registration in line
        ),
        default=-1,
    )
    if latest_start < 0 or latest_registration < 0:
        return {"watcherActive": False, "watcherState": "inactive"}

    failure_marker = f"msg=watcher.git.failed project={_NATIVE_CBM_PROJECT} "
    failures = [
        line
        for line in lines[latest_registration + 1 :]
        if failure_marker in line
    ]
    if failures:
        reason = next(
            (
                token.removeprefix("reason=")
                for token in failures[-1].split()
                if token.startswith("reason=")
            ),
            "unknown",
        )
        return {
            "watcherActive": False,
            "watcherState": "failed",
            "watcherFailure": reason,
        }
    return {"watcherActive": True, "watcherState": "active"}


def _project_count(payload: dict[str, Any], *keys: str) -> int:
    for key in keys:
        value = payload.get(key)
        if isinstance(value, bool):
            continue
        if isinstance(value, (int, float)):
            return int(value)
        if isinstance(value, str) and value.isdigit():
            return int(value)
    return 0


def _codegraph_diagnostics() -> dict[str, Any]:
    diagnostics: dict[str, Any] = {
        "runtimeReady": False,
        "runtimeState": "unavailable",
        "binaryReady": False,
        "binaryState": "unavailable",
        "binaryVersion": "",
        "binaryPath": os.path.abspath(_NATIVE_CBM_BINARY),
        "binarySha256": "",
        "cachePath": _NATIVE_CBM_CACHE_ROOT,
        "daemonAttached": False,
        "daemonState": "unattached",
        "nativeFrontendAttached": False,
        "nativeFrontendState": "unattached",
        "canonicalProjectRegistered": False,
        "projectState": "missing",
        "indexReady": False,
        "indexState": "missing",
        "watcherActive": False,
        "watcherState": "inactive",
        "codeGraphReady": False,
    }
    try:
        diagnostics.update(_host_codegraph_runtime())
    except Exception as error:
        diagnostics["runtimeFailure"] = str(error)

    client = _NATIVE_CBM_CLIENT
    if client is None or not client.is_running():
        return diagnostics

    diagnostics["nativeFrontendAttached"] = True
    diagnostics["nativeFrontendState"] = "attached"
    server_info = dict(getattr(client, "server_info", {}) or {})
    binary_version = str(server_info.get("version") or "")
    diagnostics["binaryVersion"] = binary_version
    diagnostics["binaryReady"] = binary_version == _NATIVE_CBM_EXPECTED_VERSION
    diagnostics["binaryState"] = (
        "ready" if diagnostics["binaryReady"] else "version_mismatch"
    )
    try:
        projects = _native_result_payload(
            client.call_tool(
                "list_projects",
                {},
                timeout_seconds=_NATIVE_CBM_HEALTH_TIMEOUT_SECONDS,
            )
        )
        diagnostics["daemonAttached"] = True
        diagnostics["daemonState"] = "attached"
        rows = projects.get("projects")
        project = next(
            (
                row
                for row in rows
                if isinstance(row, dict) and row.get("name") == _NATIVE_CBM_PROJECT
            ),
            None,
        ) if isinstance(rows, list) else None
        if project is None:
            return diagnostics
        root_path = str(project.get("root_path") or project.get("rootPath") or "")
        diagnostics["projectRoot"] = root_path
        diagnostics["canonicalProjectRegistered"] = (
            os.path.normcase(os.path.normpath(root_path))
            == os.path.normcase(_NATIVE_CBM_HOST_REPO_ROOT)
        )
        diagnostics["projectState"] = (
            "registered" if diagnostics["canonicalProjectRegistered"] else "wrong_root"
        )
        status = _native_result_payload(
            client.call_tool(
                "index_status",
                {"project": _NATIVE_CBM_PROJECT},
                timeout_seconds=_NATIVE_CBM_HEALTH_TIMEOUT_SECONDS,
            )
        )
        status_name = str(status.get("status") or "").strip().lower()
        nodes = _project_count(status, "nodes", "node_count", "nodeCount") or _project_count(
            project, "nodes", "node_count", "nodeCount"
        )
        edges = _project_count(status, "edges", "edge_count", "edgeCount") or _project_count(
            project, "edges", "edge_count", "edgeCount"
        )
        diagnostics["indexStatus"] = status_name
        diagnostics["indexNodes"] = nodes
        diagnostics["indexEdges"] = edges
        for source_key, target_key in (
            ("generation", "indexGeneration"),
            ("revision", "indexRevision"),
            ("indexed_at", "indexedAt"),
            ("indexedAt", "indexedAt"),
        ):
            if status.get(source_key) is not None:
                diagnostics[target_key] = status[source_key]
        diagnostics["indexReady"] = status_name == "ready" and nodes > 0 and edges > 0
        diagnostics["indexState"] = "ready" if diagnostics["indexReady"] else (
            status_name or "not_ready"
        )
        diagnostics.update(_native_codegraph_watcher_status())
    except Exception as error:
        diagnostics["nativeFailure"] = str(error)

    diagnostics["codeGraphReady"] = all(
        bool(diagnostics[key])
        for key in (
            "runtimeReady",
            "binaryReady",
            "daemonAttached",
            "nativeFrontendAttached",
            "canonicalProjectRegistered",
            "indexReady",
            "watcherActive",
        )
    )
    return diagnostics


atexit.register(_close_native_cbm)


def _backend_bridge_timeout_seconds(path: str) -> float:
    if path in {"run_configured_card", "external_main_chat"}:
        return _NATIVE_CBM_REQUEST_TIMEOUT_SECONDS
    return _MCP_CALL_TIMEOUT_SECONDS


def _bridge_sync(path: str, payload: dict[str, Any]) -> str:
    headers = {"Content-Type": "application/json"}
    if path == "external_main_chat" and INTERNAL_MCP_SECRET:
        headers["X-LiquidAIty-Internal-MCP-Secret"] = INTERNAL_MCP_SECRET
    request = Request(
        f"{BACKEND}/api/coder/mcp-bridge/{path}",
        data=json.dumps(payload).encode("utf-8"),
        headers=headers,
        method="POST",
    )
    try:
        with urlopen(
            request,
            timeout=_backend_bridge_timeout_seconds(path),
        ) as response:  # noqa: S310 — loopback backend only
            return response.read().decode("utf-8")
    except HTTPError as err:
        try:
            body = err.read().decode("utf-8")
        except Exception:
            body = ""
        return body or json.dumps({"ok": False, "error": f"backend_http_{err.code}"})
    except URLError as err:
        return json.dumps({"ok": False, "error": f"backend_unreachable: {err.reason}"})


def _constellation_via_python_rails_sync(
    name: str,
    project_id: str,
    arguments: dict[str, Any],
) -> dict[str, Any]:
    operation = str(name or "").removeprefix("constellation.").strip()
    request = Request(
        f"{PYTHON_RAILS}/constellation/operation",
        data=json.dumps({
            "projectId": project_id,
            "operation": operation,
            "arguments": arguments,
        }).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    timeout = 210.0 if operation in {
        "identity_apply", "inject_message", "reembed_start", "remember_semantic",
        "semantic_context", "semantic_start",
    } else _MCP_CALL_TIMEOUT_SECONDS
    try:
        with urlopen(request, timeout=timeout) as response:  # noqa: S310 - configured Python rails only
            result = json.loads(response.read().decode("utf-8"))
    except HTTPError as err:
        try:
            body = json.loads(err.read().decode("utf-8"))
        except Exception:
            body = {}
        raise RuntimeError(
            str(body.get("detail") or f"constellation_python_rails_http_{err.code}")
        ) from err
    except URLError as err:
        raise RuntimeError(f"constellation_python_rails_unreachable:{err.reason}") from err
    if not isinstance(result, dict):
        raise RuntimeError("constellation_python_rails_result_invalid")
    return result


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
            if header.get("alg") == "HS256":
                if len(INTERNAL_MCP_SECRET) < 32:
                    return None
                claims = jwt.decode(
                    token,
                    INTERNAL_MCP_SECRET,
                    algorithms=["HS256"],
                    audience=INTERNAL_MCP_AUDIENCE,
                    issuer=INTERNAL_MCP_ISSUER,
                    options={"require": ["exp", "iat", "sub", "principal"]},
                )
                principal = claims.get("principal")
                if not isinstance(principal, dict) or principal.get("kind") not in {
                    "catalog-reader", "materializer-read", "system-root", "card-runtime"
                }:
                    return None
                if principal.get("kind") == "materializer-read":
                    required = ("projectId", "deckId", "callerCardId")
                    if any(not str(principal.get(field) or "").strip() for field in required):
                        return None
                elif principal.get("kind") != "catalog-reader":
                    required = (
                        "projectId", "deckId", "conversationId", "parentRunId",
                        "callerCardId", "callerRuntimeKind", "callerRuntimeMode",
                    )
                    if any(not str(principal.get(field) or "").strip() for field in required):
                        return None
                    grants = principal.get("grantedTools")
                    if not isinstance(grants, list) or any(
                        not isinstance(value, str) or not value.strip() for value in grants
                    ):
                        return None
                access_token = AccessToken(
                    token=token,
                    client_id="liquidaity-internal-runtime",
                    scopes=[self.config.required_scope],
                    expires_at=int(claims["exp"]),
                    resource=self.config.resource_url,
                )
                object.__setattr__(access_token, "subject", str(claims["sub"]))
                object.__setattr__(access_token, "claims", {**claims, "internal": principal})
                return access_token
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


def _grounded_data_anchors_schema() -> dict[str, Any]:
    """One optional public native-reference list shared by review and execution."""

    return {
        "type": "array",
        "minItems": 0,
        "maxItems": 16,
        "items": {
            "type": "object",
            "properties": {
                "authority": {
                    "type": "string",
                    "enum": ["ThinkGraph", "KnowGraph", "CodeGraph"],
                },
                "nativeId": {"type": "string", "minLength": 1},
                "reason": {"type": "string", "minLength": 1, "maxLength": 2000},
                "priority": {"type": "integer"},
                "boundedExpansion": {"type": "integer", "minimum": 0, "maximum": 3},
                "resultLimit": {"type": "integer", "minimum": 1, "maximum": 24},
            },
            "required": [
                "authority", "nativeId", "reason", "priority",
                "boundedExpansion", "resultLimit",
            ],
            "additionalProperties": False,
        },
    }


def _card_team_schema() -> dict[str, Any]:
    model = {
        "type": "object",
        "properties": {
            "provider": {"type": "string", "minLength": 1},
            "accessMode": {
                "type": "string",
                "enum": ["chatgpt-account", "openai-api", "openrouter-api"],
            },
            "modelKey": {"type": "string", "minLength": 1},
            "providerModelId": {"type": "string", "minLength": 1},
        },
        "required": ["provider", "accessMode", "modelKey", "providerModelId"],
        "additionalProperties": False,
    }
    return {
        "type": "object",
        "description": (
            "Saved Hermes Team defaults and ceilings. Hermes decides whether and "
            "when to invoke Team; Python Script cannot invoke it."
        ),
        "properties": {
            "mode": {"type": "string", "enum": ["off", "auto"]},
            "maxWorkers": {"type": "integer", "enum": [2, 3, 4]},
            "retryLimit": {"type": "integer", "minimum": 0, "maximum": 4},
            "workerModel": copy.deepcopy(model),
            "leadModel": copy.deepcopy(model),
        },
        "required": [
            "mode", "maxWorkers", "retryLimit", "workerModel", "leadModel",
        ],
        "additionalProperties": False,
    }


async def _materialize_complete_catalog() -> list[Tool]:
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
            name="agentgraph.inspect",
            description=(
                "Read a bounded, authenticated Project-scoped view of current PostgreSQL/AGE "
                "Card relationships plus available run, native-reference attention, lineage, "
                "tool, and artifact telemetry. runId selects one exact Run; otherwise the "
                "authenticated conversation is selected. cardId filters its direct Runs. "
                "projectWide reads across the authenticated Project, before limits. The retired "
                "assignmentId field is accepted only to report honestly that it is no longer "
                "a current AgentGraph identity. No prompt or model input is returned."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "runId": {"type": "string"},
                    "cardId": {"type": "string"},
                    "assignmentId": {"type": "string"},
                    "limit": {
                        "type": "integer",
                        "minimum": 1,
                        "maximum": 50,
                        "default": 20,
                    },
                    "projectWide": {"type": "boolean", "default": False},
                },
                "required": [],
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
                "Main Chat only: submit one explicit mission and any deliberately selected native graph anchors "
                "to the AGE-connected Magentic-One "
                "Card and invoke native MagenticOneGroupChat. Python materializes the saved "
                "Card plus this input exactly once before execution. "
                "The backend resolves the live worker roster from blue SIDE connections; never type "
                "a roster. Use only for the current user-directed mission. This tool executes "
                "immediately unless optional Card-editor review was explicitly requested first."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "projectId": {"type": "string"},
                    "deckId": {"type": "string"},
                    "input": {"type": "string"},
                    "conversationId": {"type": "string"},
                    "dataAnchors": _grounded_data_anchors_schema(),
                },
                "required": ["input", "projectId", "deckId"],
                "additionalProperties": False,
            },
        ),
        Tool(
            name="write_mag_one_instructions",
            description=(
                "Optional review only: place one exact mission and its resolved native graph projection "
                "into the saved Coder or Mag One Card's existing Invocation and Knowledge "
                "editors for Main to review. This tool creates no proposal record, persists "
                "nothing, and never starts either Card."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "targetCardId": {"type": "string", "minLength": 1},
                    "mission": {"type": "string", "minLength": 1},
                    "dataAnchors": _grounded_data_anchors_schema(),
                },
                "required": ["targetCardId", "mission"],
                "additionalProperties": False,
            },
        ),
        Tool(
            name="card.load_graph_references",
            description=(
                "Resolve one bounded current ThinkGraph, KnowGraph, or CodeGraph reference "
                "into a saved target Card's transient Knowledge context. The server injects "
                "source Card/Run/project/deck identity. This tool never executes the target, "
                "persists runtime-input files, writes graph data, or creates Cards or wires."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "targetCardId": {"type": "string", "minLength": 1},
                    "authority": {
                        "type": "string",
                        "enum": ["ThinkGraph", "KnowGraph", "CodeGraph"],
                    },
                    "nativeId": {"type": "string", "minLength": 1},
                    "reason": {"type": "string", "minLength": 1, "maxLength": 2000},
                    "order": {"type": "integer", "minimum": 0, "maximum": 255},
                    "depth": {"type": "integer", "minimum": 0, "maximum": 3},
                    "resultLimit": {"type": "integer", "minimum": 1, "maximum": 24},
                    "required": {"type": "boolean"},
                },
                "required": [
                    "targetCardId", "authority", "nativeId", "reason",
                    "order", "depth", "resultLimit", "required",
                ],
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
            name="card.create",
            description=(
                "Create ONE explicitly configured saved Card through the canonical PostgreSQL "
                "deck authority using optimistic locking. The server mints the Card identity; "
                "only explicitly selected capabilities enter the saved grant list. This operation "
                "never launches the Card or Mag One."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "projectId": {"type": "string", "minLength": 1},
                    "deckId": {"type": "string", "minLength": 1},
                    "expectedRevision": {"type": "string", "minLength": 1},
                    "templateId": {"type": "string", "minLength": 1},
                    "title": {"type": "string", "minLength": 1},
                    "role": {"type": "string", "minLength": 1},
                    "prompt": {"type": "string", "minLength": 1},
                    "runtime": {
                        "type": "object",
                        "properties": {
                            "kind": {"type": "string", "enum": ["hermes", "autogen"]},
                            "mode": {
                                "type": "string",
                                "enum": ["main", "delegate", "assistant", "magentic_one"],
                            },
                            "profile": {"type": "string", "minLength": 1},
                        },
                        "required": ["kind", "mode"],
                        "additionalProperties": False,
                    },
                    "model": {
                        "type": "object",
                        "properties": {
                            "provider": {"type": "string", "minLength": 1},
                            "modelKey": {"type": "string", "minLength": 1},
                            "accessMode": {"type": "string", "minLength": 1},
                            "providerModelId": {"type": "string", "minLength": 1},
                            "reasoningEffort": {
                                "type": "string",
                                "enum": ["low", "medium", "high", "xhigh"],
                            },
                        },
                        "required": ["provider", "modelKey", "accessMode"],
                        "additionalProperties": False,
                    },
                    "subagentModel": {
                        "type": "object",
                        "description": (
                            "Saved desired model for bounded native Hermes delegated children and "
                            "background skill review. Omit for AutoGen Cards."
                        ),
                        "properties": {
                            "provider": {"type": "string", "minLength": 1},
                            "accessMode": {
                                "type": "string",
                                "enum": ["chatgpt-account", "openai-api", "openrouter-api"],
                            },
                            "modelKey": {"type": "string", "minLength": 1},
                            "providerModelId": {"type": "string", "minLength": 1},
                        },
                        "required": ["provider", "accessMode", "modelKey", "providerModelId"],
                        "additionalProperties": False,
                    },
                    "team": _card_team_schema(),
                    "tools": {
                        "type": "array",
                        "items": {"type": "string", "minLength": 1},
                        "default": [],
                    },
                    "nativeTools": {
                        "type": "array",
                        "items": {"type": "string", "minLength": 1},
                        "default": [],
                    },
                    "skills": {
                        "type": "array",
                        "items": {"type": "string", "minLength": 1},
                        "default": [],
                    },
                    "toolsets": {
                        "type": "array",
                        "items": {"type": "string", "minLength": 1},
                        "default": [],
                    },
                    "mcpConnectionIds": {
                        "type": "array",
                        "items": {"type": "string", "minLength": 1},
                        "default": [],
                    },
                    "position": {
                        "type": "object",
                        "properties": {
                            "x": {"type": "number"},
                            "y": {"type": "number"},
                        },
                        "additionalProperties": False,
                    },
                },
                "required": [
                    "projectId", "deckId", "expectedRevision", "title", "role",
                    "prompt", "runtime", "model",
                ],
                "additionalProperties": False,
            },
        ),
        Tool(
            name="card.update_configuration",
            description=(
                "User-directed strict-allowlist update of one persisted card: prompt, title, "
                "modelKey, providerModelId, provider, accessMode, reasoningEffort, "
                "temperature, maxTokens, the Hermes subagent model, saved Team "
                "defaults and ceilings, explicit "
                "tool/native-tool/skill/toolset/MCP selections, "
                "optional Python Card Script source. "
                "Everything else (runtime code, "
                "shell config, hidden tools, run authority, worker selection) is rejected."
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
                            "providerModelId": {"type": "string", "minLength": 1},
                            "provider": {"type": "string"},
                            "accessMode": {
                                "type": "string",
                                "enum": [
                                    "chatgpt-account", "openai-api", "openrouter-api",
                                ],
                            },
                            "reasoningEffort": {
                                "type": "string",
                                "enum": ["low", "medium", "high", "xhigh"],
                            },
                            "temperature": {"type": "number"},
                            "maxTokens": {"type": "integer", "minimum": 1},
                            "subagentModel": {
                                "type": "object",
                                "properties": {
                                    "provider": {"type": "string", "minLength": 1},
                                    "accessMode": {
                                        "type": "string",
                                        "enum": ["chatgpt-account", "openai-api", "openrouter-api"],
                                    },
                                    "modelKey": {"type": "string", "minLength": 1},
                                    "providerModelId": {"type": "string", "minLength": 1},
                                },
                                "required": ["provider", "accessMode", "modelKey", "providerModelId"],
                                "additionalProperties": False,
                            },
                            "team": _card_team_schema(),
                            "script": CardScript.model_json_schema(),
                            "tools": {
                                "type": "array",
                                "items": {"type": "string", "minLength": 1},
                            },
                            "nativeTools": {
                                "type": "array",
                                "items": {"type": "string", "minLength": 1},
                            },
                            "skills": {
                                "type": "array",
                                "items": {"type": "string", "minLength": 1},
                            },
                            "toolsets": {
                                "type": "array",
                                "items": {"type": "string", "minLength": 1},
                            },
                            "mcpConnectionIds": {
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
                "Submit or rejoin ONE saved, enabled Card through its saved runtime adapter "
                "with its saved identity, prompt, provider/model/profile, and tools. "
                "No prompt/model/tool/card overrides "
                "exist on this path — extra arguments are rejected structurally. deckId defaults to "
                "the canonical Agent Canvas deck. On the Harness saved-card doorway path, the "
                "server injects projectId/correlationId/conversationId; the model supplies the "
                "bound cardId, one mission, and optional selected native graph references only. "
                "conversationId is the real live "
                "conversation this run belongs to, when one exists. Python re-resolves that "
                "exact bounded graph selection and the receiving Card materializes, retains, "
                "and reloads one graph-first in.idf before its selected runtime receives it. Native "
                "Team delegation remains inside that Card Run and is rejoined through its persisted "
                "Run lineage rather than a separate product Card mode."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "projectId": {"type": "string"},
                    "deckId": {"type": "string"},
                    "cardId": {"type": "string"},
                    "action": {"type": "string", "enum": ["execute", "status"]},
                    "runId": {"type": "string"},
                    "nativeRootId": {"type": "string"},
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
                    "dataAnchors": {
                        "type": "array",
                        "maxItems": 16,
                        "items": {
                            "type": "object",
                            "properties": {
                                "authority": {
                                    "type": "string",
                                    "enum": ["ThinkGraph", "KnowGraph", "CodeGraph"],
                                },
                                "nativeId": {"type": "string", "minLength": 1},
                                "reason": {"type": "string", "minLength": 1},
                                "priority": {"type": "integer"},
                                "boundedExpansion": {
                                    "type": "integer", "minimum": 0, "maximum": 3,
                                },
                                "resultLimit": {
                                    "type": "integer", "minimum": 1, "maximum": 24,
                                },
                                "required": {"type": "boolean"},
                            },
                            "required": [
                                "authority", "nativeId", "reason", "priority",
                                "boundedExpansion", "required",
                            ],
                            "additionalProperties": False,
                        },
                    },
                },
                "anyOf": [
                    {"required": ["cardId", "input"]},
                    {"required": ["runId"]},
                    {"required": ["nativeRootId"]},
                ],
            },
        ),
        Tool(
            name="constellation.context",
            description=(
                "Read a bounded native Constellation Engine context by exact memory ID, "
                "tag, or text focus. The authenticated Project scope is server-owned. "
                "Returns native IDs, weighted topology, provenance, and explicit semantic "
                "degradation state; it does not fabricate embeddings."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "focus": {
                        "oneOf": [
                            {"type": "string", "minLength": 1, "maxLength": 500},
                            {
                                "type": "array", "minItems": 1, "maxItems": 16,
                                "items": {"type": "string", "minLength": 1, "maxLength": 500},
                            },
                        ]
                    },
                    "budget": {"type": "integer", "minimum": 100, "maximum": 12000, "default": 2000},
                    "maxDepth": {"type": "integer", "minimum": 0, "maximum": 5, "default": 3},
                    "maxL2": {"type": "integer", "minimum": 0, "maximum": 128, "default": 12},
                },
                "required": ["focus"],
            },
        ),
        Tool(
            name="constellation.inspect",
            description=(
                "Read one exact native Constellation memory and its bounded weighted "
                "neighborhood for the authenticated Project."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "nativeId": {"type": "string", "minLength": 1, "maxLength": 300},
                    "budget": {"type": "integer", "minimum": 100, "maximum": 12000, "default": 2000},
                    "maxDepth": {"type": "integer", "minimum": 0, "maximum": 5, "default": 1},
                    "maxL2": {"type": "integer", "minimum": 0, "maximum": 128, "default": 12},
                },
                "required": ["nativeId"],
            },
        ),
        Tool(
            name="constellation.remember",
            description=(
                "Write one explicitly structured memory through the single process-owned "
                "Constellation Engine writer for the authenticated Project."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "id": {"type": "string", "minLength": 1, "maxLength": 300},
                    "l0": {"type": "string", "minLength": 1, "maxLength": 1000},
                    "l1": {"type": "string", "minLength": 1, "maxLength": 8000},
                    "l2": {"type": "string", "minLength": 1, "maxLength": 50000},
                    "tags": {
                        "type": "array", "maxItems": 32,
                        "items": {"type": "string", "minLength": 1, "maxLength": 120},
                    },
                    "tone": {"type": "string", "minLength": 1, "maxLength": 80},
                    "valence": {"type": "number", "minimum": -1, "maximum": 1},
                    "arousal": {"type": "number", "minimum": 0, "maximum": 1},
                    "weight": {"type": "number", "exclusiveMinimum": 0, "maximum": 10},
                    "source": {"type": "string", "minLength": 1, "maxLength": 160},
                    "nodeType": {"type": "string", "minLength": 1, "maxLength": 100},
                    "eventAt": {"type": "string", "minLength": 1, "maxLength": 100},
                    "subkind": {"type": "string", "minLength": 1, "maxLength": 100},
                    "skipDedup": {"type": "boolean"},
                    "edges": {
                        "type": "array", "maxItems": 64,
                        "items": {
                            "type": "object",
                            "properties": {
                                "target": {"type": "string", "minLength": 1, "maxLength": 300},
                                "type": {
                                    "type": "string",
                                    "enum": ["causal", "contrastive", "hierarchical", "associative", "temporal", "supersedes", "coactivation", "collision", "builds_on", "resolves", "contradicts"],
                                },
                                "strength": {"type": "number", "minimum": 0.01, "maximum": 1},
                            },
                            "required": ["target", "type"],
                            "additionalProperties": False,
                        },
                    },
                },
                "required": ["id", "l0", "l1", "l2"],
            },
        ),
    ]
    constellation_edge_schema = {
        "type": "object",
        "properties": {
            "target": {"type": "string", "minLength": 1, "maxLength": 300},
            "type": {
                "type": "string",
                "enum": [
                    "causal", "contrastive", "hierarchical", "associative",
                    "temporal", "supersedes", "coactivation", "collision",
                    "builds_on", "resolves", "contradicts",
                ],
            },
            "strength": {"type": "number", "minimum": 0.01, "maximum": 1},
        },
        "required": ["target", "type"],
        "additionalProperties": False,
    }
    tools.extend([
        Tool(
            name="constellation.capabilities",
            description=(
                "Read the pinned Constellation Engine version, lifecycle modes, exact "
                "bounded operation surface, and honest blockers for semantic, autonomous, "
                "identity-changing, launcher-owned, or unbounded native operations."
            ),
            inputSchema={"type": "object", "properties": {}},
        ),
        Tool(
            name="constellation.stats",
            description=(
                "Read native Constellation node, edge, dormancy, and embedding counts for "
                "the authenticated Project without opening a second database owner."
            ),
            inputSchema={"type": "object", "properties": {}},
        ),
        Tool(
            name="constellation.semantic_status",
            description=(
                "Read the authoritative pinned Mimir/BGE-M3 lifecycle, model, dimension, "
                "port, database ownership, and readiness without starting it."
            ),
            inputSchema={"type": "object", "properties": {}},
        ),
        Tool(
            name="constellation.semantic_start",
            description=(
                "Explicitly start the pinned local Mimir/BGE-M3 child under the existing "
                "Constellation process owner. Requires the saved effect grant and confirmation."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "confirmStart": {"type": "boolean", "const": True},
                    "waitForReady": {"type": "boolean", "default": True},
                    "maxWaitSeconds": {"type": "integer", "minimum": 1, "maximum": 180, "default": 90},
                },
                "required": ["confirmStart"],
            },
        ),
        Tool(
            name="constellation.semantic_stop",
            description="Stop the process-owned local Mimir embedding child explicitly.",
            inputSchema={
                "type": "object",
                "properties": {"confirmStop": {"type": "boolean", "const": True}},
                "required": ["confirmStop"],
            },
        ),
        Tool(
            name="constellation.semantic_context",
            description=(
                "Read bounded native Constellation context with the real pinned BGE-M3 vector "
                "path enabled. It lazily starts the process-owned embedder and fails honestly."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "focus": {
                        "oneOf": [
                            {"type": "string", "minLength": 1, "maxLength": 500},
                            {"type": "array", "minItems": 1, "maxItems": 16, "items": {"type": "string", "minLength": 1, "maxLength": 500}},
                        ]
                    },
                    "budget": {"type": "integer", "minimum": 100, "maximum": 12000, "default": 2000},
                    "maxDepth": {"type": "integer", "minimum": 0, "maximum": 5, "default": 3},
                    "maxL2": {"type": "integer", "minimum": 0, "maximum": 128, "default": 12},
                    "maxWaitSeconds": {"type": "integer", "minimum": 1, "maximum": 180, "default": 90},
                },
                "required": ["focus"],
            },
        ),
        Tool(
            name="constellation.remember_semantic",
            description=(
                "Write one bounded Constellation memory through the native asynchronous "
                "remember path and persist its real BGE-M3 embedding."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "id": {"type": "string", "minLength": 1, "maxLength": 300},
                    "l0": {"type": "string", "minLength": 1, "maxLength": 1000},
                    "l1": {"type": "string", "minLength": 1, "maxLength": 8000},
                    "l2": {"type": "string", "minLength": 1, "maxLength": 50000},
                    "tags": {"type": "array", "maxItems": 32, "items": {"type": "string", "minLength": 1, "maxLength": 120}},
                    "tone": {"type": "string", "minLength": 1, "maxLength": 80},
                    "valence": {"type": "number", "minimum": -1, "maximum": 1},
                    "arousal": {"type": "number", "minimum": 0, "maximum": 1},
                    "weight": {"type": "number", "exclusiveMinimum": 0, "maximum": 10},
                    "source": {"type": "string", "minLength": 1, "maxLength": 160},
                    "nodeType": {"type": "string", "minLength": 1, "maxLength": 100},
                    "eventAt": {"type": "string", "minLength": 1, "maxLength": 100},
                    "subkind": {"type": "string", "minLength": 1, "maxLength": 100},
                    "skipDedup": {"type": "boolean"},
                    "edges": {"type": "array", "maxItems": 64, "items": constellation_edge_schema},
                    "maxWaitSeconds": {"type": "integer", "minimum": 1, "maximum": 180, "default": 90},
                },
                "required": ["id", "l0", "l1", "l2"],
            },
        ),
        Tool(
            name="constellation.reembed_start",
            description=(
                "Start one bounded cancellable native BGE-M3 re-embedding job for the exact "
                "authenticated Project database, with progress and a hard node/time ceiling."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "confirmReembed": {"type": "boolean", "const": True},
                    "maxNodes": {"type": "integer", "minimum": 1, "maximum": 1000, "default": 100},
                    "maxDurationSeconds": {"type": "integer", "minimum": 10, "maximum": 3600, "default": 300},
                    "maxWaitSeconds": {"type": "integer", "minimum": 1, "maximum": 180, "default": 90},
                },
                "required": ["confirmReembed"],
            },
        ),
        Tool(
            name="constellation.reembed_status",
            description="Read exact progress and receipts for the current or most recent bounded re-embedding job.",
            inputSchema={"type": "object", "properties": {}},
        ),
        Tool(
            name="constellation.reembed_cancel",
            description="Cancel one exact in-process re-embedding job at its next native node boundary.",
            inputSchema={
                "type": "object",
                "properties": {
                    "jobId": {"type": "string", "minLength": 1, "maxLength": 100},
                    "confirmCancel": {"type": "boolean", "const": True},
                },
                "required": ["jobId", "confirmCancel"],
            },
        ),
        Tool(
            name="constellation.identity_preview",
            description=(
                "Preview exact native Soul Core identity changes against current readback and "
                "return a short-lived digest without mutating the database."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "segments": {
                        "type": "object",
                        "properties": {key: {"type": "string", "minLength": 1, "maxLength": 1200} for key in ["name", "values", "direction", "relationship"]},
                        "minProperties": 1,
                        "additionalProperties": False,
                    },
                    "batchId": {"type": "string", "minLength": 1, "maxLength": 100},
                    "reason": {"type": "string", "minLength": 1, "maxLength": 500},
                },
                "required": ["segments", "reason"],
            },
        ),
        Tool(
            name="constellation.identity_apply",
            description=(
                "Apply one exact unexpired Soul Core preview through native saveSoulCore, with "
                "saved grant, explicit confirmation, provenance, and exact database readback."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "previewId": {"type": "string", "minLength": 1, "maxLength": 100},
                    "digest": {"type": "string", "pattern": "^[0-9a-f]{64}$"},
                    "confirmIdentityMutation": {"type": "boolean", "const": True},
                    "maxWaitSeconds": {"type": "integer", "minimum": 1, "maximum": 180, "default": 90},
                },
                "required": ["previewId", "digest", "confirmIdentityMutation"],
            },
        ),
        Tool(
            name="constellation.autonomy_status",
            description="Read the exact state, limits, progress, and latest receipt for bounded native Constellation autonomy.",
            inputSchema={"type": "object", "properties": {}},
        ),
        Tool(
            name="constellation.autonomy_start",
            description=(
                "Start one bounded process-owned native collision or maintenance loop with "
                "explicit time, cycle, context-token, depth, concurrency, and write limits."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "mode": {"type": "string", "enum": ["collide", "maintenance"], "default": "collide"},
                    "confirmAutonomy": {"type": "boolean", "const": True},
                    "confirmWrites": {"type": "boolean"},
                    "maxCycles": {"type": "integer", "minimum": 1, "maximum": 100, "default": 3},
                    "maxDurationSeconds": {"type": "integer", "minimum": 5, "maximum": 86400, "default": 300},
                    "intervalSeconds": {"type": "integer", "minimum": 1, "maximum": 3600, "default": 30},
                    "maxDepth": {"type": "integer", "minimum": 0, "maximum": 5, "default": 3},
                    "maxTokens": {"type": "integer", "minimum": 100, "maximum": 100000, "default": 6000},
                    "perCycleTokens": {"type": "integer", "minimum": 100, "maximum": 4000, "default": 1000},
                    "numFoci": {"type": "integer", "minimum": 2, "maximum": 8, "default": 3},
                    "decayFactor": {"type": "number", "minimum": 0.9, "maximum": 1, "default": 0.95},
                    "pruneThreshold": {"type": "number", "minimum": 0, "maximum": 0.2, "default": 0.05},
                    "dormantThreshold": {"type": "number", "minimum": 0, "maximum": 0.05, "default": 0.001},
                },
                "required": ["confirmAutonomy"],
            },
        ),
        *[
            Tool(
                name=f"constellation.autonomy_{action}",
                description=f"{action.title()} one exact bounded native Constellation autonomy run.",
                inputSchema={
                    "type": "object",
                    "properties": {
                        "runId": {"type": "string", "minLength": 1, "maxLength": 100},
                        f"confirm{action.title()}": {"type": "boolean", "const": True},
                    },
                    "required": ["runId", f"confirm{action.title()}"],
                },
            )
            for action in ["pause", "resume", "stop"]
        ],
        Tool(
            name="constellation.notification_status",
            description="Read the existing native launcher outbox setting and pending count without changing it.",
            inputSchema={"type": "object", "properties": {}},
        ),
        Tool(
            name="constellation.notify",
            description=(
                "Queue one bounded OS notification through the pinned engine's existing launcher "
                "outbox. Disabled launcher settings return an honest non-queued receipt."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "kind": {"type": "string", "minLength": 1, "maxLength": 64},
                    "title": {"type": "string", "minLength": 1, "maxLength": 120},
                    "body": {"type": "string", "minLength": 1, "maxLength": 500},
                    "deeplink": {"type": "string", "minLength": 1, "maxLength": 500},
                    "confirmNotification": {"type": "boolean", "const": True},
                },
                "required": ["kind", "title", "body", "confirmNotification"],
            },
        ),
        Tool(
            name="constellation.edge_review",
            description=(
                "Use the pinned engine's native stale, verified, or fine-type proposal review "
                "contract for one exact edge with an explicit saved effect grant."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "action": {"type": "string", "enum": ["flag_stale", "verify", "propose_fine_type"]},
                    "edgeId": {"type": "integer", "minimum": 1},
                    "coarseType": {"type": "string", "minLength": 1, "maxLength": 80},
                    "proposedFineType": {"type": "string", "minLength": 1, "maxLength": 80},
                },
                "required": ["action", "edgeId"],
            },
        ),
        Tool(
            name="constellation.adjust_edge_pair",
            description=(
                "Apply one bounded native strength delta to both directions of an exact "
                "Constellation edge pair, preserving the pinned engine's paired contract."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "nodeA": {"type": "string", "minLength": 1, "maxLength": 300},
                    "nodeB": {"type": "string", "minLength": 1, "maxLength": 300},
                    "edgeType": {"type": "string", "enum": ["causal", "contrastive", "hierarchical", "associative", "temporal", "supersedes", "coactivation", "collision", "builds_on", "resolves", "contradicts"]},
                    "delta": {"type": "number", "minimum": -0.5, "maximum": 0.5},
                },
                "required": ["nodeA", "nodeB", "edgeType", "delta"],
            },
        ),
        Tool(
            name="constellation.classify_edge_pair",
            description=(
                "Apply one allowed fine type to both directions of an exact native edge pair "
                "and return the before/after receipts for every matched direction."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "nodeA": {"type": "string", "minLength": 1, "maxLength": 300},
                    "nodeB": {"type": "string", "minLength": 1, "maxLength": 300},
                    "edgeType": {"type": "string", "enum": ["causal", "contrastive", "hierarchical", "associative", "temporal", "supersedes", "coactivation", "collision", "builds_on", "resolves", "contradicts"]},
                    "fineType": {"type": "string", "minLength": 1, "maxLength": 80},
                    "fineConfidence": {"type": "number", "minimum": 0, "maximum": 1},
                },
                "required": ["nodeA", "nodeB", "edgeType", "fineType"],
            },
        ),
        Tool(
            name="constellation.inject_message",
            description=(
                "Persist one explicitly confirmed bounded native alignment-message memory. "
                "The receipt discloses whether launcher chat or Telegram delivery is actually wired."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "text": {"type": "string", "minLength": 1, "maxLength": 8000},
                    "source": {"type": "string", "minLength": 1, "maxLength": 160},
                    "batchId": {"type": "string", "minLength": 1, "maxLength": 100},
                    "confirmInject": {"type": "boolean", "const": True},
                    "maxWaitSeconds": {"type": "integer", "minimum": 1, "maximum": 180, "default": 90},
                },
                "required": ["text", "confirmInject"],
            },
        ),
        Tool(
            name="constellation.inspect_edge",
            description="Read one exact native Constellation edge and its classification metadata.",
            inputSchema={
                "type": "object",
                "properties": {
                    "edgeId": {"type": "integer", "minimum": 1},
                },
                "required": ["edgeId"],
            },
        ),
        Tool(
            name="constellation.check_duplicate",
            description=(
                "Run the pinned engine's deterministic exact-title and FTS duplicate guard "
                "before a proposed Constellation memory write."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "l0": {"type": "string", "minLength": 1, "maxLength": 1000},
                    "l2": {"type": "string", "minLength": 1, "maxLength": 50000},
                },
                "required": ["l0", "l2"],
            },
        ),
        Tool(
            name="constellation.edge_types",
            description="Read the pinned engine's native coarse-to-fine edge type vocabulary.",
            inputSchema={"type": "object", "properties": {}},
        ),
        Tool(
            name="constellation.collide",
            description=(
                "Run one bounded native dream-collision exploration over existing Project "
                "memories. It returns real focal IDs, bridges, and an insight prompt; it "
                "does not call a model or create a memory."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "numFoci": {"type": "integer", "minimum": 2, "maximum": 8, "default": 3},
                    "budget": {"type": "integer", "minimum": 100, "maximum": 4000, "default": 800},
                    "maxDepth": {"type": "integer", "minimum": 0, "maximum": 5, "default": 3},
                },
            },
        ),
        Tool(
            name="constellation.update_memory",
            description=(
                "Update bounded non-embedding fields on one exact native Constellation memory. "
                "This is an effect tool and remains subject to saved Card grant and confirmation."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "nativeId": {"type": "string", "minLength": 1, "maxLength": 300},
                    "l2": {"type": "string", "minLength": 1, "maxLength": 50000},
                    "tags": {"type": "array", "maxItems": 32, "items": {"type": "string", "minLength": 1, "maxLength": 120}},
                    "tone": {"type": "string", "minLength": 1, "maxLength": 80},
                    "valence": {"type": "number", "minimum": -1, "maximum": 1},
                    "arousal": {"type": "number", "minimum": 0, "maximum": 1},
                    "weight": {"type": "number", "minimum": 0.01, "maximum": 10},
                    "nodeType": {"type": "string", "minLength": 1, "maxLength": 100},
                },
                "required": ["nativeId"],
                "minProperties": 2,
            },
        ),
        Tool(
            name="constellation.link",
            description=(
                "Add bounded native typed edges between existing Constellation memories. "
                "Missing endpoints fail closed; this is an effect tool."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "sourceId": {"type": "string", "minLength": 1, "maxLength": 300},
                    "edges": {"type": "array", "minItems": 1, "maxItems": 64, "items": constellation_edge_schema},
                },
                "required": ["sourceId", "edges"],
            },
        ),
        Tool(
            name="constellation.adjust_edge",
            description=(
                "Apply one bounded native strength adjustment to an exact Constellation edge. "
                "The engine clamps its policy range and reports stale candidates without silently pruning."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "edgeId": {"type": "integer", "minimum": 1},
                    "delta": {"type": "number", "minimum": -0.5, "maximum": 0.5},
                },
                "required": ["edgeId", "delta"],
            },
        ),
        Tool(
            name="constellation.classify_edge",
            description=(
                "Set one exact native edge's fine type within the pinned coarse-type vocabulary. "
                "Out-of-vocabulary classifications fail closed."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "edgeId": {"type": "integer", "minimum": 1},
                    "fineType": {"type": "string", "minLength": 1, "maxLength": 80},
                    "fineConfidence": {"type": "number", "minimum": 0, "maximum": 1},
                },
                "required": ["edgeId", "fineType"],
            },
        ),
        Tool(
            name="constellation.forget",
            description=(
                "Mark one exact Constellation memory and its edges dormant. This destructive "
                "effect requires both the saved Card grant/confirmation gate and confirmDormant=true."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "nativeId": {"type": "string", "minLength": 1, "maxLength": 300},
                    "confirmDormant": {"type": "boolean", "const": True},
                },
                "required": ["nativeId", "confirmDormant"],
            },
        ),
        Tool(
            name="constellation.maintain",
            description=(
                "Run one explicitly confirmed, bounded native Project maintenance cycle for "
                "decay, dormancy, and orphan-edge cleanup. No background loop is started."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "confirmProjectMaintenance": {"type": "boolean", "const": True},
                    "decayFactor": {"type": "number", "minimum": 0.9, "maximum": 1, "default": 0.95},
                    "pruneThreshold": {"type": "number", "minimum": 0, "maximum": 0.2, "default": 0.05},
                    "dormantThreshold": {"type": "number", "minimum": 0, "maximum": 0.05, "default": 0.001},
                },
                "required": ["confirmProjectMaintenance"],
            },
        ),
    ])
    tools = [_bind_repo_tool_source(tool) for tool in tools]
    for tool in tools:
        tool.inputSchema.setdefault("additionalProperties", False)
    allowlist = _configured_tool_allowlist()
    if allowlist is not None:
        tools = [tool for tool in tools if tool.name in allowlist]
    _complete_catalog_family("liquidaity")
    native_catalogs: dict[str, list[Tool]] = {}
    if allowlist is None or any(name.startswith("cbm.") for name in allowlist):
        _set_catalog_initializing_family("cbm")
        native_catalogs["cbm"] = await _native_cbm_tools()
        _complete_catalog_family("cbm")
    if allowlist is None or any(name.startswith("graphiti.") for name in allowlist):
        _set_catalog_initializing_family("graphiti")
        native_catalogs["graphiti"] = await _native_graphiti_tools()
        _complete_catalog_family("graphiti")
    for provider, native_tools in native_catalogs.items():
        tools.extend(_namespace_native_tools(provider, native_tools))
    tools = [_bind_idd_access(tool) for tool in tools
             if tool_publication(tool.name) != "private-admin"]
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


async def _initialize_http_catalog_once() -> None:
    """Freeze the complete public HTTP catalog once without delaying the bind."""
    global _CATALOG_COMPLETED_FAMILIES, _CATALOG_FAILURE, _CATALOG_FAILURE_CODE
    global _CATALOG_FAILURE_SUMMARY, _CATALOG_INITIALIZING_FAMILY, _CATALOG_STATE
    global _HTTP_CATALOG_TOOLS
    global _LATEST_CATALOG_DIAGNOSTIC
    with _CATALOG_DIAGNOSTIC_LOCK:
        _CATALOG_STATE = "initializing"
        _CATALOG_FAILURE = None
        _CATALOG_FAILURE_CODE = None
        _CATALOG_FAILURE_SUMMARY = None
        _CATALOG_COMPLETED_FAMILIES = ()
        _CATALOG_INITIALIZING_FAMILY = "liquidaity"
        _HTTP_CATALOG_TOOLS = None
        _LATEST_CATALOG_DIAGNOSTIC = None
    try:
        tools = tuple(await _materialize_complete_catalog())
        canonical_names = [tool.name for tool in tools]
        if not tools or len(set(canonical_names)) != len(canonical_names):
            raise RuntimeError(
                "public_catalog_invalid: "
                f"actual={len(tools)} "
                f"unique={len(set(canonical_names))}"
            )
        public_tools = _gpt_public_catalog(list(tools))
        public_names = [tool.name for tool in public_tools]
        if not public_tools or len(set(public_names)) != len(public_names):
            raise RuntimeError(
                "public_connector_catalog_invalid: "
                f"actual={len(public_tools)} "
                f"unique={len(set(public_names))}"
            )
        catalog_count, catalog_hash = _catalog_identity(public_tools)
    except asyncio.CancelledError:
        with _CATALOG_DIAGNOSTIC_LOCK:
            if _CATALOG_STATE == "initializing":
                _CATALOG_STATE = "failed"
                _CATALOG_FAILURE = "CancelledError: catalog initialization cancelled"
                _CATALOG_FAILURE_CODE = "catalog_initialization_cancelled"
                _CATALOG_FAILURE_SUMMARY = _CATALOG_FAILURE
                _HTTP_CATALOG_TOOLS = None
                _LATEST_CATALOG_DIAGNOSTIC = None
        raise
    except Exception as error:
        failure_code, failure = _catalog_failure_details(error)
        with _TRACE_LOCK:
            print(
                "[main-mcp] catalog initialization failed; full local traceback follows",
                file=sys.stderr,
                flush=True,
            )
            traceback.print_exception(
                error.__class__, error, error.__traceback__, file=sys.stderr
            )
        with _CATALOG_DIAGNOSTIC_LOCK:
            _CATALOG_STATE = "failed"
            _CATALOG_FAILURE = failure
            _CATALOG_FAILURE_CODE = failure_code
            _CATALOG_FAILURE_SUMMARY = failure
            _HTTP_CATALOG_TOOLS = None
            _LATEST_CATALOG_DIAGNOSTIC = None
        _trace(
            "catalog_initialization_failed",
            exception_class=error.__class__.__name__,
            failure_code=failure_code,
            result_category=failure_code,
            completed=True,
        )
        return
    with _CATALOG_DIAGNOSTIC_LOCK:
        _HTTP_CATALOG_TOOLS = tools
        _LATEST_CATALOG_DIAGNOSTIC = {
            "publicToolCount": catalog_count,
            "publicToolUniqueCount": len(set(public_names)),
            "catalogHash": catalog_hash,
        }
        _CATALOG_FAILURE = None
        _CATALOG_FAILURE_CODE = None
        _CATALOG_FAILURE_SUMMARY = None
        _CATALOG_INITIALIZING_FAMILY = None
        _CATALOG_STATE = "ready"


def _observe_http_catalog_initialization(task: asyncio.Task[None]) -> None:
    """Fail closed if the one initializer ends without publishing a terminal state."""
    global _CATALOG_FAILURE, _CATALOG_FAILURE_CODE, _CATALOG_FAILURE_SUMMARY
    global _CATALOG_STATE, _HTTP_CATALOG_TOOLS, _LATEST_CATALOG_DIAGNOSTIC
    with _CATALOG_DIAGNOSTIC_LOCK:
        if _CATALOG_STATE != "initializing":
            return
    if task.cancelled():
        failure_code = "catalog_initialization_cancelled"
        failure = "CancelledError: catalog initialization cancelled"
        error: BaseException | None = None
    else:
        error = task.exception()
        if error is None:
            failure_code = "catalog_initializer_ended_without_state"
            failure = "RuntimeError: catalog initializer ended without a terminal state"
        elif isinstance(error, Exception):
            failure_code, failure = _catalog_failure_details(error)
        else:
            failure_code = "catalog_initializer_crashed"
            failure = f"{error.__class__.__name__}: {_sanitize_failure_detail(error)}"
    with _CATALOG_DIAGNOSTIC_LOCK:
        if _CATALOG_STATE != "initializing":
            return
        _CATALOG_STATE = "failed"
        _CATALOG_FAILURE = failure
        _CATALOG_FAILURE_CODE = failure_code
        _CATALOG_FAILURE_SUMMARY = failure
        _HTTP_CATALOG_TOOLS = None
        _LATEST_CATALOG_DIAGNOSTIC = None
    if error is not None:
        with _TRACE_LOCK:
            print(
                "[main-mcp] catalog initializer crashed; full local traceback follows",
                file=sys.stderr,
                flush=True,
            )
            traceback.print_exception(
                error.__class__, error, error.__traceback__, file=sys.stderr
            )
    _trace(
        "catalog_initializer_terminated",
        exception_class=error.__class__.__name__ if error is not None else None,
        failure_code=failure_code,
        result_category=failure_code,
        completed=True,
    )


def _start_http_catalog_initialization() -> asyncio.Task[None]:
    """Return the one process-wide HTTP catalog initialization task."""
    global _HTTP_CATALOG_INITIALIZATION_TASK
    task = _HTTP_CATALOG_INITIALIZATION_TASK
    if task is None:
        task = asyncio.create_task(
            _initialize_http_catalog_once(),
            name="liquidaity-mcp-catalog-initialization",
        )
        task.add_done_callback(_observe_http_catalog_initialization)
        _HTTP_CATALOG_INITIALIZATION_TASK = task
    return task


def _http_catalog_or_error() -> list[Tool]:
    with _CATALOG_DIAGNOSTIC_LOCK:
        state = _CATALOG_STATE
        failure = _CATALOG_FAILURE
        tools = _HTTP_CATALOG_TOOLS
    if state == "initializing":
        raise RuntimeError("mcp_catalog_initializing")
    if state == "failed":
        raise RuntimeError(
            f"mcp_catalog_initialization_failed: {failure or 'unknown'}"
        )
    if state != "ready" or tools is None:
        raise RuntimeError("mcp_catalog_readiness_invalid")
    return list(tools)


@server.list_tools()
async def list_tools() -> list[Tool]:
    """Return no HTTP catalog until the one complete frozen catalog is ready."""
    global _CATALOG_FAILURE, _CATALOG_FAILURE_CODE, _CATALOG_FAILURE_SUMMARY
    global _CATALOG_INITIALIZING_FAMILY, _CATALOG_STATE
    if MCP_TRANSPORT == "streamable-http":
        tools = _http_catalog_or_error()
        principal = _internal_mcp_principal()
        if principal is None or principal.get("kind") == "catalog-reader":
            return _gpt_public_catalog(tools)
        if principal.get("kind") == "materializer-read":
            readable = readable_tool_ids()
            return [tool for tool in tools if tool.name in readable]
        if principal.get("kind") == "system-root":
            return [tool for tool in tools if tool.name == "card.run_assistant_agent"]
        grants = principal.get("presentedTools")
        if not isinstance(grants, list):
            grants = principal.get("grantedTools")
        allowed = {
            str(value).strip() for value in grants or [] if str(value).strip()
        } if isinstance(grants, list) else set()
        return [tool for tool in tools if tool_publication(tool.name) != "private-admin"
                and tool.name in allowed]
    try:
        tools = await _materialize_complete_catalog()
    except Exception as error:
        failure_code, failure = _catalog_failure_details(error)
        with _CATALOG_DIAGNOSTIC_LOCK:
            _CATALOG_STATE = "failed"
            _CATALOG_FAILURE = failure
            _CATALOG_FAILURE_CODE = failure_code
            _CATALOG_FAILURE_SUMMARY = failure
        raise
    with _CATALOG_DIAGNOSTIC_LOCK:
        _CATALOG_STATE = "ready"
        _CATALOG_FAILURE = None
        _CATALOG_FAILURE_CODE = None
        _CATALOG_FAILURE_SUMMARY = None
        _CATALOG_INITIALIZING_FAMILY = None
    return tools


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
}


def _enforce_tool_caller(
    name: str,
    args: dict[str, Any],
    *,
    authenticated_external: bool = False,
) -> str | None:
    from app.python_models.tool_registry import required_tool_caller_runtime

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
            server_owned_scope_fields = {"group_id", "group_ids"}
            if isinstance(properties, dict):
                for field in server_owned_scope_fields:
                    properties.pop(field, None)
            required = schema.get("required")
            if isinstance(required, list):
                schema["required"] = [
                    field for field in required
                    if field not in server_owned_scope_fields
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
    "agentgraph.inspect": {
        "projectId",
        "deckId",
        "conversationId",
        "runId",
        "cardId",
        "assignmentId",
        "limit",
        "projectWide",
    },
    "mag_one.describe_connected_agents": {"projectId", "deckId"},
    "run_mag_one": {
        "projectId", "deckId", "input", "conversationId", "dataAnchors",
    },
    "write_mag_one_instructions": {
        "projectId", "deckId", "conversationId", "targetCardId", "mission",
        "dataAnchors", "_sourceCardId",
    },
    "card.load_graph_references": {
        "projectId", "deckId", "conversationId", "targetCardId", "authority",
        "nativeId", "reason", "order", "depth", "resultLimit", "required",
        "_sourceCardId", "_sourceRunId",
    },
    "canvas.inspect": {"projectId", "deckId"},
    "card.create": {
        "projectId", "deckId", "expectedRevision", "title", "role", "prompt",
        "runtime", "model", "subagentModel", "team", "tools", "nativeTools",
        "skills", "toolsets", "mcpConnectionIds", "position", "templateId",
    },
    "card.update_configuration": {"projectId", "deckId", "cardId", "updates"},
    "canvas.upsert_wire": {"projectId", "deckId", "op", "wire"},
    "card.run_assistant_agent": {
        "action",
        "projectId",
        "deckId",
        "cardId",
        "runId",
        "nativeRootId",
        "correlationId",
        "conversationId",
        "originatingAgentId",
        "originatingRunId",
        "input",
        "dataAnchors",
    },
    "web_search": {"query", "max_results"},
    "constellation.context": {"focus", "budget", "maxDepth", "maxL2"},
    "constellation.inspect": {"nativeId", "budget", "maxDepth", "maxL2"},
    "constellation.capabilities": set(),
    "constellation.stats": set(),
    "constellation.semantic_status": set(),
    "constellation.semantic_start": {"confirmStart", "waitForReady", "maxWaitSeconds"},
    "constellation.semantic_stop": {"confirmStop"},
    "constellation.semantic_context": {"focus", "budget", "maxDepth", "maxL2", "maxWaitSeconds"},
    "constellation.inspect_edge": {"edgeId"},
    "constellation.check_duplicate": {"l0", "l2"},
    "constellation.edge_types": set(),
    "constellation.collide": {"numFoci", "budget", "maxDepth"},
    "constellation.remember": {
        "id", "l0", "l1", "l2", "tags", "tone", "valence", "arousal",
        "weight", "source", "nodeType", "eventAt", "subkind", "skipDedup",
        "edges",
    },
    "constellation.remember_semantic": {
        "id", "l0", "l1", "l2", "tags", "tone", "valence", "arousal",
        "weight", "source", "nodeType", "eventAt", "subkind", "skipDedup",
        "edges", "maxWaitSeconds",
    },
    "constellation.reembed_start": {
        "confirmReembed", "maxNodes", "maxDurationSeconds", "maxWaitSeconds",
    },
    "constellation.reembed_status": set(),
    "constellation.reembed_cancel": {"jobId", "confirmCancel"},
    "constellation.identity_preview": {"segments", "batchId", "reason"},
    "constellation.identity_apply": {
        "previewId", "digest", "confirmIdentityMutation", "maxWaitSeconds",
    },
    "constellation.autonomy_status": set(),
    "constellation.autonomy_start": {
        "mode", "confirmAutonomy", "confirmWrites", "maxCycles",
        "maxDurationSeconds", "intervalSeconds", "maxDepth", "maxTokens",
        "perCycleTokens", "numFoci", "decayFactor", "pruneThreshold",
        "dormantThreshold",
    },
    "constellation.autonomy_pause": {"runId", "confirmPause"},
    "constellation.autonomy_resume": {"runId", "confirmResume"},
    "constellation.autonomy_stop": {"runId", "confirmStop"},
    "constellation.notification_status": set(),
    "constellation.notify": {
        "kind", "title", "body", "deeplink", "confirmNotification",
    },
    "constellation.edge_review": {
        "action", "edgeId", "coarseType", "proposedFineType",
    },
    "constellation.update_memory": {
        "nativeId", "l2", "tags", "tone", "valence", "arousal", "weight", "nodeType",
    },
    "constellation.link": {"sourceId", "edges"},
    "constellation.adjust_edge": {"edgeId", "delta"},
    "constellation.adjust_edge_pair": {"nodeA", "nodeB", "edgeType", "delta"},
    "constellation.classify_edge": {"edgeId", "fineType", "fineConfidence"},
    "constellation.classify_edge_pair": {
        "nodeA", "nodeB", "edgeType", "fineType", "fineConfidence",
    },
    "constellation.inject_message": {
        "text", "source", "batchId", "confirmInject", "maxWaitSeconds",
    },
    "constellation.forget": {"nativeId", "confirmDormant"},
    "constellation.maintain": {
        "confirmProjectMaintenance", "decayFactor", "pruneThreshold", "dormantThreshold",
    },
}

_BRIDGE_PATHS: dict[str, str] = {
    "mag_one.describe_connected_agents": "describe_connected_agents",
}

# Control tools dispatch to the Python control-plane handlers (app/control_plane.py).
# Imported lazily so bridge-only usage never requires the psycopg dependency chain.
_CONTROL_HANDLER_NAMES: dict[str, str] = {
    "agentgraph.inspect": "agentgraph_inspect",
    "canvas.inspect": "canvas_inspect",
    "card.create": "card_create",
    "card.update_configuration": "card_update_configuration",
    "canvas.upsert_wire": "canvas_upsert_wire",
    "card.run_assistant_agent": "card_run_assistant_agent",
    "write_mag_one_instructions": "write_mag_one_instructions",
    "card.load_graph_references": "card_load_graph_references",
}


async def _dispatch_tool(
    name: str,
    arguments: dict[str, Any],
) -> Any:
    context = _authenticated_main_context()
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
                    if (name == "agentgraph.inspect" and field == "conversationId"
                            and (args.get("runId") or args.get("projectWide") is True)):
                        continue
                    args[field] = str(context[field])
            if name in {"write_mag_one_instructions", "card.load_graph_references"}:
                args["_sourceCardId"] = str(context["mainCardId"])
            if name == "card.load_graph_references":
                args["_sourceRunId"] = str(context["parentRunId"])
            if "senderAgentId" in allowed:
                args["senderAgentId"] = str(context["mainCardId"])
            if "correlationId" in allowed:
                args["correlationId"] = f"external-mcp:{uuid4()}"
            if name == "card.run_assistant_agent":
                if context.get("principalKind") != "system-root":
                    args["originatingAgentId"] = str(context["mainCardId"])
                    args["originatingRunId"] = str(context["parentRunId"])
            from app.python_models.tool_registry import required_tool_caller_runtime

            if required_tool_caller_runtime(name) is not None:
                args["_callerCardId"] = str(context["mainCardId"])
                args["_callerRuntimeKind"] = str(
                    context.get("callerRuntimeKind") or "hermes"
                )
                args["_callerRuntimeMode"] = str(
                    context.get("callerRuntimeMode") or "main"
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
    extra = [k for k in args.keys() if k not in allowed]
    if extra:
        return [
            TextContent(
                type="text",
                text=json.dumps({"ok": False, "error": f"tool_arguments_rejected: {','.join(sorted(extra))}"}),
            )
        ]
    if name.startswith("constellation."):
        if context is None or not str(context.get("projectId") or "").strip():
            return [TextContent(
                type="text",
                text=json.dumps({
                    "ok": False,
                    "error": "authenticated_project_required",
                }),
            )]
        result = await asyncio.to_thread(
            _constellation_via_python_rails_sync,
            name,
            str(context["projectId"]),
            args,
        )
        return [TextContent(
            type="text",
            text=json.dumps(result, ensure_ascii=False),
        )]
    if (
        name == "card.run_assistant_agent"
        and context is not None
        and str(args.get("action") or "execute") == "execute"
        and str(args.get("cardId") or "") == str(context.get("mainCardId") or "")
    ):
        return await _bridge(
            "external_main_chat",
            {
                "projectId": str(context["projectId"]),
                "deckId": str(context["deckId"]),
                "conversationId": str(context["conversationId"]),
                "mainCardId": str(context["mainCardId"]),
                "message": str(args.get("input") or ""),
                **(
                    {"dataAnchors": args["dataAnchors"]}
                    if isinstance(args.get("dataAnchors"), list)
                    else {}
                ),
            },
        )
    if name == "run_mag_one":
        from app.python_models.card_domain import (
            CardDomainError,
            resolve_magentic_target_card,
        )

        raw_anchors = args.get("dataAnchors")
        data_anchors = [
            {**anchor, "required": True}
            if isinstance(anchor, dict)
            else anchor
            for anchor in raw_anchors
        ] if isinstance(raw_anchors, list) else raw_anchors
        try:
            target = await asyncio.to_thread(
                resolve_magentic_target_card,
                str(args.get("projectId") or ""),
                str(args.get("deckId") or ""),
                caller_card_id,
            )
        except CardDomainError as error:
            return [TextContent(
                type="text",
                text=json.dumps({"ok": False, "error": str(error)}),
            )]
        return await _bridge(
            "run_configured_card",
            {
                "action": "execute",
                "projectId": target["projectId"],
                "deckId": target["deckId"],
                "cardId": target["cardId"],
                "senderCardId": caller_card_id,
                "correlationId": f"mag_one:{uuid4()}",
                "conversationId": str(args.get("conversationId") or "main"),
                "input": str(args.get("input") or ""),
                **(
                    {"dataAnchors": data_anchors}
                    if isinstance(data_anchors, list)
                    else {}
                ),
            },
        )
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
            result = await (
                control_plane.card_update_configuration(
                    args, caller_card_id=caller_card_id
                )
                if name == "card.update_configuration"
                else getattr(control_plane, handler_name)(args)
            )
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


def _attach_execution_receipt(
    result: Any,
    receipt: dict[str, Any],
    native_attention: dict[str, Any] | None = None,
) -> Any:
    block = TextContent(
        type="text",
        text=json.dumps({"executionReceipt": receipt}, ensure_ascii=False),
    )
    if isinstance(result, CallToolResult):
        payload = result.model_dump(exclude_none=True)
        payload["content"] = [*result.content, block]
        if native_attention is not None:
            payload["_meta"] = {
                **(result.meta or {}),
                "nativeAttention": native_attention,
            }
        return CallToolResult.model_validate(payload)
    if isinstance(result, list):
        content = [*result, block]
        if native_attention is None:
            return content
        return CallToolResult(
            content=content,
            meta={"nativeAttention": native_attention},
        )
    return CallToolResult(
        content=[TextContent(type="text", text=str(result)), block],
        meta={"nativeAttention": native_attention} if native_attention is not None else None,
    )


def _mcp_tool_timeout_seconds(name: str) -> float:
    if name in {
        "cbm.index_repository",
        "card.run_assistant_agent",
        "run_mag_one",
    }:
        return _NATIVE_CBM_REQUEST_TIMEOUT_SECONDS
    return _MCP_CALL_TIMEOUT_SECONDS


@server.call_tool()
async def call_tool(name: str, arguments: dict[str, Any]) -> Any:
    started_clock = time.monotonic()
    context_token = _ACTIVE_AUTHENTICATED_CONTEXT.set(None)
    tool_name = str(name or "").strip()
    receipt = _execution_receipt(tool_name)
    receipt_token = _ACTIVE_EXECUTION_RECEIPT.set(receipt)
    trace_fields = {
        "mcp_method": "tools/call",
        "tool_name": tool_name[:160],
        **_oauth_trace_fields(),
    }
    _trace("tool_call_started", **trace_fields)
    try:
        resolved_context = _request_execution_context()
        _ACTIVE_AUTHENTICATED_CONTEXT.reset(context_token)
        context_token = _ACTIVE_AUTHENTICATED_CONTEXT.set(resolved_context)
        if not _request_tool_is_allowed(tool_name):
            raise PermissionError(f"tool_not_granted: {tool_name}")
        result = await asyncio.wait_for(
            _dispatch_tool(tool_name, arguments),
            timeout=_mcp_tool_timeout_seconds(tool_name),
        )
        result_category = _tool_result_category(result)
        native_attention = None
        if result_category == "success":
            from app.python_models.native_attention import build_native_attention_event

            attention_context = _authenticated_main_context()
            native_attention = (
                (result.meta or {}).get("nativeAttention")
                if tool_name == "graphiti.add_memory" and isinstance(result, CallToolResult) else None
            )
            already_observed = native_attention is not None
            native_arguments = dict(arguments or {})
            if tool_name == "graphiti.clear_graph" and attention_context:
                native_arguments["group_ids"] = [graphiti_project_group_id(str(attention_context["projectId"]))]
            if native_attention is None:
                native_attention = build_native_attention_event(
                    tool_name, result, attention_context, arguments=native_arguments,
                )
            if native_attention is not None:
                telemetry_written = (native_attention.get("persisted") is not False
                                     if already_observed else
                                     await _persist_native_attention(native_attention, attention_context))
                if not telemetry_written:
                    # The native operation already happened. Report observation
                    # failure separately, never invite a duplicate write retry.
                    native_attention["persisted"] = False
                    receipt["attentionFailureCode"] = "native_attention_persistence_failed"
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
        return _attach_execution_receipt(result, receipt, native_attention)
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
        _ACTIVE_AUTHENTICATED_CONTEXT.reset(context_token)


async def _run_stdio() -> None:
    try:
        # Nested FastMCP registries cannot be discovered from this outer
        # server's active tools/list request without deadlocking the stdio
        # request lifecycle. Complete the same canonical catalog once before
        # accepting the outer stdio session; the native CBM frontend remains
        # process-owned and indexing is still an explicit cbm.index_repository
        # tool call.
        await _materialize_complete_catalog()
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
    from starlette.responses import JSONResponse, PlainTextResponse
    from starlette.routing import Mount, Route

    from mcp.server.auth.middleware.auth_context import AuthContextMiddleware
    from mcp.server.auth.middleware.bearer_auth import BearerAuthBackend, RequireAuthMiddleware
    from mcp.server.auth.routes import build_resource_metadata_url, create_protected_resource_routes

    config_values = _oauth_config()

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
    if PUBLIC_MCP_RESOURCE_URL:
        public_url = urlsplit(PUBLIC_MCP_RESOURCE_URL)
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
        if scope.get("path") != HTTP_MCP_PATH:
            await PlainTextResponse("not_found", status_code=404)(scope, receive, send)
            return
        await session_manager.handle_request(scope, receive, send)

    async def lifespan(_app: Starlette):
        catalog_task = _start_http_catalog_initialization()
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
            await _close_native_graphiti()
            await asyncio.to_thread(_close_native_cbm)

    async def health_endpoint(_request: Any) -> JSONResponse:
        diagnostics = _catalog_diagnostics()
        codegraph = await asyncio.to_thread(_codegraph_diagnostics)
        return JSONResponse(
            {
                "ok": diagnostics["catalogState"] != "failed",
                **diagnostics,
                "publicCatalogReady": diagnostics["catalogReady"],
                **codegraph,
            },
            status_code=200,
        )

    async def readiness_endpoint(_request: Any) -> JSONResponse:
        diagnostics = _catalog_diagnostics()
        codegraph = await asyncio.to_thread(_codegraph_diagnostics)
        ready = bool(
            diagnostics["catalogReady"]
            and int(diagnostics.get("publicToolCount") or 0) > 0
            and diagnostics.get("publicToolCount")
            == diagnostics.get("publicToolUniqueCount")
            and codegraph["codeGraphReady"]
        )
        return JSONResponse(
            {
                "ok": ready,
                **diagnostics,
                "publicCatalogReady": diagnostics["catalogReady"],
                **codegraph,
            },
            status_code=200 if ready else 503,
        )

    health_routes = [
        Route("/health", endpoint=health_endpoint, methods=["GET"]),
        Route("/health/ready", endpoint=readiness_endpoint, methods=["GET"]),
    ]

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
