"""The one official Python MCP host for LiquidAIty runtimes and connectors.

The canonical supervised service tree launches one Streamable HTTP host for
the process lifetime. Hermes Cards use that same authenticated seam; no
per-turn spawn or fallback host exists.

Exposes this application tool surface plus the process-owned Engraphis
ThinkGraph adapter and dynamically discovered Codebase Memory and official
Graphiti MCP registries:
  * web_search                       (real Tavily search; Search Agent only by grant)
  * canvas.inspect / card.create / card.update_configuration / canvas.upsert_wire
                                      (handlers live in app.application_tools — Python)

Transport tools forward to the backend's Main, Card and Hermes domain routes
endpoints on loopback — the backend remains the single authority for deck state,
conversation store, card resolution, and graph persistence. Application tools dispatch
to Python handlers (app/application_tools.py) which own validation/policy and use the
existing backend deck routes. No semantics,
no fallback lives in this host.

Official Graphiti ingestion is an explicit Hermes-only grant. Provider tools keep their upstream schemas,
annotations, dispatch, and results; this host adds only provider namespaces and
authentication. Graph authorities never appear as cards or conversational agents.
"""

from __future__ import annotations

import asyncio
import copy
import hashlib
import inspect
from importlib import metadata as importlib_metadata
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
import tomllib
import traceback
from contextvars import ContextVar
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen
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

from app.application_tools import card_tool_schema
from app.python_models.provider_config import ensure_env_loaded
from app.python_models.tool_registry import (
    DEFAULT_TOOL_REGISTRY,
    OperationDefinition,
    project_server_injected_schema,
    replace_discovered_external_operations,
    static_tool_catalog,
    tool_access,
)
from mcp import Client, StdioServerParameters
from mcp.server.auth.middleware.auth_context import get_access_token
from mcp.server.auth.provider import AccessToken
from mcp.server.lowlevel.server import NotificationOptions, Server
from mcp.server.stdio import stdio_server
from mcp.types import (
    CallToolRequestParams,
    CallToolResult,
    Implementation,
    ListResourcesResult,
    ListToolsResult,
    PaginatedRequestParams,
    TextContent,
    Tool,
)

ensure_env_loaded()

_GRAPHITI_PROJECT_ID = re.compile(r"^[A-Za-z0-9_-]+$")


def graphiti_project_group_id(project_id: str) -> str:
    """Map a Main project to Graphiti's existing isolated group namespace."""
    if not isinstance(project_id, str) or not _GRAPHITI_PROJECT_ID.fullmatch(project_id):
        raise ValueError("projectId must contain only letters, numbers, underscores, and hyphens")
    return f"liquidaity-{project_id}"

BACKEND = os.environ.get("MAIN_BACKEND_URL", "http://127.0.0.1:4000").rstrip("/")
PYTHON_RAILS = os.environ.get(
    "PYTHON_RAILS_URL", "http://127.0.0.1:8003"
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
AUTH0_CLOCK_SKEW_SECONDS = 30
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
_CATALOG_UNAVAILABLE_FAMILIES: tuple[str, ...] = ()
_CATALOG_INITIALIZING_FAMILY: str | None = "liquidaity"
_CATALOG_TOOLS: tuple[Tool, ...] | None = None
_CATALOG_INITIALIZATION_TASK: asyncio.Task[None] | None = None
_PROVIDER_TOOL_TIMEOUT_SECONDS = 30.0
_CBM_REQUEST_TIMEOUT_SECONDS = 300.0
_MCP_CALL_TIMEOUT_SECONDS = 30.0
_SPECIALIST_CARD_HTTP_TIMEOUT_SECONDS = 540.0
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
_ACTIVE_AUTHENTICATED_CONTEXT: ContextVar[dict[str, Any] | None] = ContextVar(
    "active_authenticated_mcp_context", default=None
)
_MAIN_CONTEXT_FIELDS = frozenset(
    {"projectId", "deckId", "conversationId", "parentRunId", "mainCardId"}
)
_TRUSTED_STDIO_OPTIONAL_CONTEXT_FIELDS = frozenset(
    {"callerRuntimeKind", "callerRuntimeMode"}
)
_AUTHENTICATED_OPTIONAL_CONTEXT_FIELDS = frozenset(
    {"callerRuntimeKind", "callerRuntimeMode", "principalKind", "grantedTools",
     "hermesChildId", "hermesRunId"}
)


def _configured_tool_allowlist() -> frozenset[str] | None:
    """Return the exact process-owned invocation grant, when configured.

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
        unavailable_families = list(_CATALOG_UNAVAILABLE_FAMILIES)
        initializing_family = _CATALOG_INITIALIZING_FAMILY
    try:
        with open(__file__, "rb") as source_file:
            current_source_sha256 = hashlib.sha256(source_file.read()).hexdigest()
    except OSError:
        current_source_sha256 = None
    catalog_ready = bool(
        state == "ready"
        and identity
        and "liquidaity" in completed_families
    )
    return {
        "state": state,
        "catalogState": state,
        "catalogReady": catalog_ready,
        **({"catalogFailure": failure} if failure else {}),
        **({"failureCode": failure_code} if failure_code else {}),
        **({"failureSummary": failure_summary} if failure_summary else {}),
        "completedCatalogFamilies": completed_families,
        "unavailableCatalogFamilies": unavailable_families,
        "initializingCatalogFamily": initializing_family,
        **(identity if state == "ready" else {}),
        "processId": _STARTUP_PROCESS_ID,
        "startupId": _STARTUP_ID,
        "sourceRevision": _STARTUP_SOURCE_REVISION,
        "sourceSha256": _STARTUP_SOURCE_SHA256,
        "currentSourceSha256": current_source_sha256,
        "sourceCurrent": (current_source_sha256 == _STARTUP_SOURCE_SHA256
                          if current_source_sha256 and _STARTUP_SOURCE_SHA256 else None),
        "graphitiVersions": _graphiti_runtime_versions(),
    }


def _graphiti_runtime_versions() -> dict[str, str | None]:
    """Expose resolved Graphiti packages, never an expected or hard-coded pin."""

    def resolved(distribution: str) -> str | None:
        try:
            return importlib_metadata.version(distribution)
        except importlib_metadata.PackageNotFoundError:
            return None

    return {
        "core": resolved("graphiti-core"),
        "mcp": resolved("mcp-server"),
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
        code = "cbm_daemon_start_timeout"
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
    global _CATALOG_UNAVAILABLE_FAMILIES
    with _CATALOG_DIAGNOSTIC_LOCK:
        if family not in _CATALOG_COMPLETED_FAMILIES:
            _CATALOG_COMPLETED_FAMILIES = (*_CATALOG_COMPLETED_FAMILIES, family)
        _CATALOG_UNAVAILABLE_FAMILIES = tuple(
            value for value in _CATALOG_UNAVAILABLE_FAMILIES if value != family
        )
        _CATALOG_INITIALIZING_FAMILY = None
    _trace("catalog_family_ready", catalog_family=family, completed=True)


def _mark_catalog_family_unavailable(
    family: str,
    *,
    failure_code: str,
    failure_summary: str,
) -> None:
    """Record one provider family as unavailable for readiness diagnostics."""

    global _CATALOG_UNAVAILABLE_FAMILIES, _CATALOG_INITIALIZING_FAMILY
    with _CATALOG_DIAGNOSTIC_LOCK:
        if family not in _CATALOG_UNAVAILABLE_FAMILIES:
            _CATALOG_UNAVAILABLE_FAMILIES = (
                *_CATALOG_UNAVAILABLE_FAMILIES,
                family,
            )
        _CATALOG_INITIALIZING_FAMILY = None
    _trace(
        "catalog_family_unavailable",
        catalog_family=family,
        failure_code=failure_code,
        failure_summary=failure_summary,
        completed=True,
    )


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
    elif any(term in lowered for term in (
        "service unavailable",
        "connection refused",
        "actively refused",
        "backend_unreachable",
        "worldsignals_unreachable",
        "winerror 10061",
    )):
        code, retryable = "service_unavailable", True
    elif any(term in lowered for term in ("neo4j", "database")):
        code, retryable = "database_failure", True
    elif isinstance(value, (AttributeError, TypeError)):
        code, retryable = "internal_handler_failure", False
    else:
        code, retryable = (
            ("internal_failure", False)
            if dependency in {"mcp", "tool-runtime"}
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
    if isinstance(internal, dict) and internal.get("kind") == "card-runtime":
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
            "hermesChildId": internal.get("hermesChildId"),
            "hermesRunId": internal.get("hermesRunId"),
        }
    else:
        context = claims.get("main") if isinstance(claims, dict) else None
    required_fields = _MAIN_CONTEXT_FIELDS
    if not isinstance(context, dict) or not required_fields.issubset(context):
        return None
    resolved: dict[str, Any] = {
        field: str(context[field]) for field in required_fields
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


def _published_mcp_tool_names() -> frozenset[str]:
    """Read the exact frozen external publication surface without rebuilding it."""

    with _CATALOG_DIAGNOSTIC_LOCK:
        if _CATALOG_STATE != "ready" or _CATALOG_TOOLS is None:
            return frozenset()
        return frozenset(tool.name for tool in _CATALOG_TOOLS)


def _request_tool_is_allowed(name: str) -> bool:
    if not _tool_is_allowed(name):
        return False
    access = tool_access(name)
    principal = _internal_mcp_principal()
    # The public host preserves the canonical unknown-tool error from dispatch.
    # An internal Card-scoped connection fails closed before dispatch because it
    # may call only operations present in the live registry and its exact grants.
    if access is None:
        return principal is None
    if principal is None:
        if not OAUTH_ENFORCED:
            return True
        # Preserve the canonical unknown-tool result for names the registry has
        # never owned, but do not let a stale external client invoke a known
        # internal-only operation that is absent from this process's frozen
        # MCP publication catalog.
        return access is None or name in _published_mcp_tool_names()
    kind = str(principal.get("kind") or "")
    if kind == "catalog-reader":
        return False
    if kind == "materializer-read":
        grants = principal.get("grantedTools")
        return access == "read" and isinstance(grants, list) and name in {
            str(value).strip() for value in grants if str(value).strip()
        }
    if kind != "card-runtime":
        return False
    grants = principal.get("grantedTools")
    return isinstance(grants, list) and name in {
        str(value).strip() for value in grants if str(value).strip()
    }


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


_CBM_CLIENT: Client | None = None
_CBM_TOOLS: tuple[Tool, ...] | None = None
_CBM_NAMES: frozenset[str] = frozenset()
_CBM_STARTUP_FAILURE: str | None = None
_CBM_INDEX_IN_FLIGHT: tuple[str, asyncio.Task[CallToolResult]] | None = None
_CBM_HOST_REPO_ROOT = os.path.normpath(_REPO_ROOT)
_CBM_PROJECT = "C-Projects-LiquidAIty-main"
_GRAPHITI_MODULE: Any | None = None
_GRAPHITI_TOOLS: tuple[Tool, ...] | None = None
_GRAPHITI_NAMES: frozenset[str] = frozenset()
_GRAPHITI_UNAVAILABLE: dict[str, Any] | None = None
_GRAPHITI_SERVICE_READY = False
_GRAPHITI_SERVICE_INIT_LOCK = asyncio.Lock()
_PROVIDER_PREFIXES = {
    "cbm": "cbm.",
    "graphiti": "graphiti.",
}
_CARD_CATALOG_PROVIDER_TOOL_NAMES = {
    "cbm": frozenset({
        "check_index_coverage",
        "detect_changes",
        "get_architecture",
        "get_code_snippet",
        "get_graph_schema",
        "query_graph",
        "search_code",
        "search_graph",
        "trace_path",
    }),
    "graphiti": frozenset({
        "add_memory",
        "get_entity_edge",
        "get_episode_entities",
        "get_episodes",
        "search_memory_facts",
        "search_nodes",
        "summarize_saga",
    }),
}
_GRAPHITI_SERVER_INJECTED_ARGUMENTS = frozenset({"group_id", "group_ids"})


def _namespace_provider_tools(provider: str, tools: list[Tool]) -> list[Tool]:
    """Project the deliberate model-facing provider subset with its routing prefix."""
    prefix = _PROVIDER_PREFIXES[provider]
    exposed_names = _CARD_CATALOG_PROVIDER_TOOL_NAMES[provider]
    result: list[Tool] = []
    for tool in tools:
        if tool.name not in exposed_names:
            continue
        payload = tool.model_dump(by_alias=True, exclude_none=True)
        provider_tool_name = tool.name
        payload["name"] = prefix + provider_tool_name
        meta = dict(payload.get("_meta") or {})
        meta["liquidaitySource"] = {
            "sourceId": provider,
            "namespace": provider,
            "providerToolName": tool.name,
            "connectionKind": "external-mcp",
        }
        payload["_meta"] = meta
        if provider == "graphiti" and provider_tool_name == "get_episodes":
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


def _external_mcp_operation_unavailable(**_arguments: Any) -> Any:
    raise RuntimeError("external_operation_requires_mcp_owner")


def _register_cbm_catalog(tools: list[Tool]) -> None:
    """Project the current official CBM catalog into runtime authorization.

    Access comes only from the standardized provider MCP annotation. A positive
    read-only hint maps to read; absent or non-read-only metadata stays
    conservatively write/restricted without guessing from a tool name.
    """

    definitions: list[OperationDefinition] = []
    for tool in tools:
        payload = tool.model_dump(by_alias=True, exclude_none=True)
        annotations = dict(payload.get("annotations") or {})
        read_only = (
            annotations.get("readOnlyHint")
        )
        if read_only is None:
            # Unknown provider effects stay on the restricted/write side. This
            # is an explicit fail-closed annotation, never a safe/read label.
            read_only = False
            annotations["readOnlyHint"] = False
        annotations.setdefault("destructiveHint", read_only is not True)
        annotations.setdefault("idempotentHint", read_only is True)
        annotations.setdefault("openWorldHint", False)
        definitions.append(OperationDefinition(
            canonical_id=tool.name,
            description=str(tool.description or "").strip(),
            parameters_schema=copy.deepcopy(tool.input_schema),
            handler=_external_mcp_operation_unavailable,
            available=True,
            publishers=frozenset({"external-mcp"}),
            access="read" if read_only is True else "write",
            namespace="cbm",
            external_source_id="cbm",
            output_schema=(
                copy.deepcopy(tool.output_schema)
                if tool.output_schema is not None
                else None
            ),
            title=str(
                tool.title
                or (payload.get("annotations") or {}).get("title")
                or tool.name
            ),
            annotations=copy.deepcopy(annotations),
            dispatcher_owner="app.mcp_host._call_cbm",
        ))
    replace_discovered_external_operations("cbm", definitions)


def _register_graphiti_catalog(tools: list[Tool]) -> None:
    """Bind exact live Graphiti schemas to the explicit provider adapter contract."""
    from app.python_models.tool_registry import graphiti_operation_policy

    definitions: list[OperationDefinition] = []
    for tool in tools:
        policy = graphiti_operation_policy(tool.name)
        if policy is None:
            raise RuntimeError(f"graphiti_operation_definition_missing:{tool.name}")
        payload = tool.model_dump(by_alias=True, exclude_none=True)
        annotations = dict(payload.get("annotations") or {})
        for key, value in policy["annotations"].items():
            if key in annotations and annotations[key] is not value:
                raise RuntimeError(f"graphiti_annotation_mismatch:{tool.name}:{key}")
            annotations[key] = copy.deepcopy(value)
        properties = tool.input_schema.get("properties", {})
        if not isinstance(properties, dict):
            raise RuntimeError(f"graphiti_input_schema_invalid:{tool.name}")
        server_injected = frozenset(properties) & _GRAPHITI_SERVER_INJECTED_ARGUMENTS
        definitions.append(OperationDefinition(
            canonical_id=tool.name,
            description=str(tool.description or "").strip(),
            parameters_schema=copy.deepcopy(tool.input_schema),
            handler=_external_mcp_operation_unavailable,
            available=True,
            publishers=frozenset({"external-mcp"}),
            access=str(policy["access"]),
            namespace="graphiti",
            external_source_id="graphiti",
            output_schema=(
                copy.deepcopy(tool.output_schema)
                if tool.output_schema is not None else None
            ),
            title=str(tool.title or tool.name),
            annotations=annotations,
            server_injected_arguments=server_injected,
            dispatcher_context_arguments=server_injected,
            dispatcher_owner="app.mcp_host._call_graphiti",
        ))
    replace_discovered_external_operations("graphiti", definitions)


def _bind_repo_tool_source(
    tool: Tool,
    *,
    source_id: str = "main_mcp",
    provider_tool_name: str | None = None,
) -> Tool:
    """Attach factual connection identity to a repo-owned MCP declaration."""
    payload = tool.model_dump(by_alias=True, exclude_none=True)
    meta = dict(payload.get("_meta") or {})
    meta["liquidaitySource"] = {
        "sourceId": source_id,
        "providerToolName": provider_tool_name or tool.name,
        "connectionKind": "external-mcp",
    }
    payload["_meta"] = meta
    return Tool.model_validate(payload)


def _bind_operation_access(tool: Tool) -> Tool:
    """Attach access from the canonical operation or provider definition."""
    from app.python_models.tool_registry import operation_definition

    definition = operation_definition(tool.name)
    access = definition.access if definition is not None else None
    if access is None:
        raise RuntimeError(f"mcp_tool_missing_operation_access:{tool.name}")
    payload = tool.model_dump(by_alias=True, exclude_none=True)
    if definition.title and not payload.get("title"):
        payload["title"] = definition.title
    annotations = dict(payload.get("annotations") or {})
    for key, value in (definition.annotations or {}).items():
        if key in annotations and annotations[key] != value:
            raise RuntimeError(f"mcp_tool_annotation_mismatch:{tool.name}:{key}")
        annotations[key] = copy.deepcopy(value)
    required_hints = {
        "readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint",
    }
    if not required_hints.issubset(annotations):
        missing = ",".join(sorted(required_hints - set(annotations)))
        raise RuntimeError(f"mcp_tool_annotations_missing:{tool.name}:{missing}")
    payload["annotations"] = annotations
    meta = dict(payload.get("_meta") or {})
    meta["liquidaityAccess"] = access
    source = dict(meta.get("liquidaitySource") or {})
    canonical_input_schema = copy.deepcopy(definition.parameters_schema)
    if definition.external_source_id == "main_mcp":
        canonical_input_schema.setdefault("additionalProperties", False)
    source.update({
        "namespace": definition.namespace,
        "publication": "external-mcp",
        "access": access,
        "available": definition.available,
        "grantEligible": definition.grant_eligible,
        "canonicalInputSchema": canonical_input_schema,
        "serverInjectedArguments": sorted(definition.server_injected_arguments),
        "dispatcherContextArguments": sorted(definition.dispatcher_context_arguments),
        "dispatcherOwner": definition.dispatcher_owner,
        "authenticatedProjection": False,
    })
    if definition.required_caller_runtime is not None:
        source.update({
            "requiredCallerRuntimeKind": definition.required_caller_runtime[0],
            "requiredCallerRuntimeMode": definition.required_caller_runtime[1],
        })
    meta["liquidaitySource"] = source
    payload["_meta"] = meta
    return Tool.model_validate(payload)


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


async def _initialize_graphiti() -> None:
    """Discover the Graphiti catalog without opening provider connections."""
    global _GRAPHITI_MODULE, _GRAPHITI_NAMES, _GRAPHITI_TOOLS
    global _GRAPHITI_UNAVAILABLE
    if _GRAPHITI_TOOLS is not None:
        return
    if not os.environ.get("OPENROUTER_API_KEY", "").strip():
        _GRAPHITI_TOOLS = ()
        _GRAPHITI_NAMES = frozenset()
        _GRAPHITI_UNAVAILABLE = {
            "ok": False,
            "failureCode": "optional_capability_unavailable",
            "errorCategory": "DEPENDENCY_UNAVAILABLE",
            "retryable": False,
            "dependency": "graphiti",
            "detail": "Graphiti provider credentials are not configured.",
        }
        return

    graphiti_module_ref: Any | None = None
    try:
        def load_catalog() -> tuple[Any, tuple[Tool, ...]]:
            # Importing Graphiti loads its provider modules and can take several
            # seconds on Windows. Keep that work with the already-threaded
            # descriptor read so the MCP listener and health routes remain
            # responsive while the provider catalog is initializing.
            import graphiti_mcp_server as graphiti_module

            return graphiti_module, tuple(asyncio.run(graphiti_module.mcp.list_tools()))

        graphiti_module_ref, tools = await asyncio.to_thread(load_catalog)
        names = [tool.name for tool in tools]
        if len(names) != len(set(names)):
            raise RuntimeError("graphiti_duplicate_tool_name")
    except Exception as error:
        client = (
            getattr(graphiti_module_ref, "graphiti_client", None)
            if graphiti_module_ref is not None else None
        )
        close = getattr(getattr(client, "driver", None), "close", None)
        if callable(close):
            close_result = close()
            if inspect.isawaitable(close_result):
                await close_result
        _GRAPHITI_MODULE = None
        _GRAPHITI_TOOLS = ()
        _GRAPHITI_NAMES = frozenset()
        _GRAPHITI_UNAVAILABLE = {
            "ok": False,
            "failureCode": "optional_capability_unavailable",
            "errorCategory": "DEPENDENCY_UNAVAILABLE",
            "retryable": False,
            "dependency": "graphiti",
            "detail": f"Graphiti initialization failed ({error.__class__.__name__}).",
        }
        return

    _GRAPHITI_MODULE = graphiti_module_ref
    _GRAPHITI_TOOLS = tools
    _GRAPHITI_NAMES = frozenset(names)
    _GRAPHITI_UNAVAILABLE = None


async def _ensure_graphiti_service() -> None:
    """Open Graphiti providers lazily on the first Graphiti tool call."""
    global _GRAPHITI_SERVICE_READY, _GRAPHITI_UNAVAILABLE
    if _GRAPHITI_SERVICE_READY:
        return
    await _initialize_graphiti()
    graphiti_module_ref = _GRAPHITI_MODULE
    if graphiti_module_ref is None:
        detail = (_GRAPHITI_UNAVAILABLE or {}).get(
            "detail", "Graphiti catalog is unavailable."
        )
        raise RuntimeError(f"graphiti_unavailable:{detail}")
    async with _GRAPHITI_SERVICE_INIT_LOCK:
        if _GRAPHITI_SERVICE_READY:
            return
        try:
            graphiti_module_ref.config = _graphiti_config()
            graphiti_module_ref.graphiti_service = graphiti_module_ref.GraphitiService(
                graphiti_module_ref.config, graphiti_module_ref.SEMAPHORE_LIMIT
            )
            graphiti_module_ref.queue_service = graphiti_module_ref.QueueService()
            await graphiti_module_ref.graphiti_service.initialize()
            graphiti_module_ref.graphiti_client = await graphiti_module_ref.graphiti_service.get_client()
            graphiti_module_ref.semaphore = graphiti_module_ref.graphiti_service.semaphore
            await graphiti_module_ref.queue_service.initialize(graphiti_module_ref.graphiti_client)
        except BaseException as error:
            client = getattr(graphiti_module_ref, "graphiti_client", None)
            close = getattr(getattr(client, "driver", None), "close", None)
            if callable(close):
                close_result = close()
                if inspect.isawaitable(close_result):
                    await close_result
            graphiti_module_ref.graphiti_client = None
            _GRAPHITI_SERVICE_READY = False
            _GRAPHITI_UNAVAILABLE = {
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
                f"graphiti_initialization_failed:{error.__class__.__name__}"
            ) from error
        _GRAPHITI_SERVICE_READY = True
        _GRAPHITI_UNAVAILABLE = None


async def _graphiti_tools() -> list[Tool]:
    await _initialize_graphiti()
    return list(_GRAPHITI_TOOLS or ())


async def _call_graphiti(name: str, arguments: dict[str, Any]):
    arguments = dict(arguments)
    try:
        await asyncio.wait_for(
            _ensure_graphiti_service(),
            timeout=_PROVIDER_TOOL_TIMEOUT_SECONDS,
        )
    except TimeoutError as error:
        raise RuntimeError("graphiti_initialization_timeout") from error
    if _GRAPHITI_MODULE is None:
        raise RuntimeError("graphiti_not_initialized")
    try:
        result = await asyncio.wait_for(
            _GRAPHITI_MODULE.mcp.call_tool(name, arguments),
            timeout=_PROVIDER_TOOL_TIMEOUT_SECONDS,
        )
    except TimeoutError as error:
        raise RuntimeError(f"graphiti_timeout:{name}") from error
    return _normalize_graphiti_result(result)


def _normalize_graphiti_result(result: Any) -> Any:
    return _normalize_provider_tool_result(result, dependency="graphiti")


def _bounded_graphiti_episodes(
    result: CallToolResult,
    *,
    include_body: bool,
    preview_chars: int,
    response_budget: int,
) -> CallToolResult:
    """Project Graphiti episodes into a stable, context-bounded public response."""
    if result.is_error or not isinstance(result.structured_content, dict):
        return result
    graphiti_payload = result.structured_content.get("result")
    if not isinstance(graphiti_payload, dict) or not isinstance(graphiti_payload.get("episodes"), list):
        return result
    projected: list[dict[str, Any]] = []
    for graphiti_episode in graphiti_payload["episodes"]:
        if not isinstance(graphiti_episode, dict):
            continue
        content = str(graphiti_episode.get("content") or "")
        episode = {
            key: graphiti_episode.get(key)
            for key in (
                "uuid", "name", "source", "source_description", "created_at", "valid_at",
                "reference_time", "group_id", "saga_uuid",
            )
            if graphiti_episode.get(key) is not None
        }
        episode["content_chars"] = len(content)
        if include_body:
            episode["content"] = content
        else:
            episode["content_preview"] = content[:preview_chars]
            episode["content_truncated"] = len(content) > preview_chars
        projected.append(episode)
    payload: dict[str, Any] = {
        "message": graphiti_payload.get("message") or "Episodes retrieved successfully",
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


def _normalize_provider_tool_result(result: Any, *, dependency: str) -> Any:
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






async def _close_graphiti() -> None:
    global _GRAPHITI_MODULE, _GRAPHITI_NAMES, _GRAPHITI_TOOLS
    global _GRAPHITI_UNAVAILABLE
    global _GRAPHITI_SERVICE_READY
    graphiti_module_ref = _GRAPHITI_MODULE
    _GRAPHITI_MODULE = None
    _GRAPHITI_TOOLS = None
    _GRAPHITI_NAMES = frozenset()
    _GRAPHITI_UNAVAILABLE = None
    _GRAPHITI_SERVICE_READY = False
    client = (
        getattr(graphiti_module_ref, "graphiti_client", None)
        if graphiti_module_ref is not None else None
    )
    driver = getattr(client, "driver", None)
    close = getattr(driver, "close", None)
    if callable(close):
        result = close()
        if inspect.isawaitable(result):
            await result


def _cbm_config() -> tuple[str, list[str], str]:
    """Open the one current official user-installed CBM frontend owned by this host."""
    command = os.environ.get("MCP_CBM_BINARY", "").strip() or "codebase-memory-mcp"
    binary = shutil.which(command) or command
    return (binary, [], _CBM_HOST_REPO_ROOT)


def _normalize_cbm_index_arguments(
    arguments: dict[str, Any],
) -> dict[str, Any]:
    """Pin indexing to the one canonical host checkout and project identity."""
    normalized = dict(arguments or {})
    repo_path = normalized.get("repo_path")
    if not isinstance(repo_path, str):
        return normalized

    requested_path = repo_path.strip().rstrip("/\\")
    host_path = os.path.normcase(os.path.normpath(requested_path))
    canonical_host_path = os.path.normcase(_CBM_HOST_REPO_ROOT)
    if host_path == canonical_host_path:
        normalized["repo_path"] = _CBM_HOST_REPO_ROOT
        normalized["name"] = _CBM_PROJECT
    return normalized


async def _open_cbm_client(
    command: str,
    args: list[str],
    cwd: str,
) -> tuple[Client, tuple[Tool, ...], list[str]]:
    """Open the one CBM frontend through the official SDK v2 client."""
    client = Client(
        StdioServerParameters(command=command, args=args, cwd=cwd),
        mode="auto",
        client_info=Implementation(
            name="main-cbm",
            version=_MCP_IMPLEMENTATION_VERSION,
        ),
        read_timeout_seconds=_CBM_REQUEST_TIMEOUT_SECONDS,
    )
    try:
        await client.__aenter__()
        tools: list[Tool] = []
        cursor: str | None = None
        seen_cursors: set[str] = set()
        while True:
            page = await client.list_tools(cursor=cursor, cache_mode="refresh")
            tools.extend(Tool.model_validate(tool) for tool in page.tools)
            cursor = page.next_cursor
            if not cursor:
                break
            if cursor in seen_cursors:
                raise RuntimeError("cbm_tools_cursor_cycle")
            seen_cursors.add(cursor)
        names = [tool.name for tool in tools]
        if len(names) != len(set(names)):
            raise RuntimeError("cbm_duplicate_tool_name")
        return client, tuple(tools), names
    except Exception:
        await client.__aexit__(*sys.exc_info())
        raise


async def _start_cbm_client() -> None:
    """Enter the SDK client once from the owning server-lifespan task."""
    global _CBM_CLIENT, _CBM_NAMES, _CBM_STARTUP_FAILURE, _CBM_TOOLS
    if _CBM_CLIENT is not None and _CBM_TOOLS is not None:
        return
    command, args, cwd = _cbm_config()
    try:
        client, tools, names = await _open_cbm_client(command, args, cwd)
    except Exception as error:
        _CBM_STARTUP_FAILURE = f"{error.__class__.__name__}: {error}"
        raise
    _CBM_CLIENT = client
    _CBM_TOOLS = tools
    _CBM_NAMES = frozenset(names)
    _CBM_STARTUP_FAILURE = None


async def _cbm_tools() -> list[Tool]:
    if _CBM_CLIENT is None or _CBM_TOOLS is None:
        detail = _CBM_STARTUP_FAILURE or "CBM SDK client is not connected."
        raise RuntimeError(f"cbm_unavailable:{detail}")
    return list(_CBM_TOOLS or ())


async def _call_cbm(name: str, arguments: dict[str, Any]) -> CallToolResult:
    if name == "index_repository":
        return await _call_cbm_index(arguments)
    client = _CBM_CLIENT
    if client is None:
        raise RuntimeError("cbm_client_unavailable")
    return await client.call_tool(
        name,
        dict(arguments),
        read_timeout_seconds=_CBM_REQUEST_TIMEOUT_SECONDS,
    )


async def _call_cbm_index(arguments: dict[str, Any]) -> CallToolResult:
    """Coalesce identical indexing requests without spawning another CBM process."""
    global _CBM_INDEX_IN_FLIGHT
    arguments = _normalize_cbm_index_arguments(arguments)
    request_key = json.dumps(arguments, sort_keys=True, separators=(",", ":"), default=str)
    in_flight = _CBM_INDEX_IN_FLIGHT
    if in_flight is None:
        client = _CBM_CLIENT
        if client is None:
            raise RuntimeError("cbm_client_unavailable")
        task = asyncio.create_task(client.call_tool(
            "index_repository",
            arguments,
            read_timeout_seconds=_CBM_REQUEST_TIMEOUT_SECONDS,
        ))
        _CBM_INDEX_IN_FLIGHT = (request_key, task)
    else:
        active_key, task = in_flight
        if active_key != request_key:
            raise RuntimeError("cbm_index_already_in_progress")
    try:
        return await asyncio.shield(task)
    finally:
        if task.done() and _CBM_INDEX_IN_FLIGHT == (request_key, task):
            _CBM_INDEX_IN_FLIGHT = None


async def _close_cbm() -> None:
    global _CBM_CLIENT, _CBM_NAMES, _CBM_STARTUP_FAILURE, _CBM_TOOLS
    client = _CBM_CLIENT
    _CBM_CLIENT = None
    _CBM_TOOLS = None
    _CBM_NAMES = frozenset()
    _CBM_STARTUP_FAILURE = None
    if client is not None:
        await client.__aexit__(None, None, None)


def _backend_bridge_timeout_seconds(path: str) -> float:
    if path == "external_main_chat":
        return _CBM_REQUEST_TIMEOUT_SECONDS
    if path == "worldview_action":
        return 40.0
    return _MCP_CALL_TIMEOUT_SECONDS


_BACKEND_ROUTES = {
    "external_main_context": "/api/main/context",
    "external_main_chat": "/api/main/chat",
    "saved_specialist_card": "/api/saved-specialists/invoke",
    "worldview_action": "/api/worldview/internal/actions",
}


def _bridge_sync(path: str, payload: dict[str, Any]) -> str:
    headers = {"Content-Type": "application/json"}
    if path == "worldview_action" and len(INTERNAL_MCP_SECRET) < 32:
        raise RuntimeError("internal_mcp_secret_missing")
    if path in {
        "external_main_context", "external_main_chat",
        "worldview_action",
    } and INTERNAL_MCP_SECRET:
        headers["X-LiquidAIty-Internal-MCP-Secret"] = INTERNAL_MCP_SECRET
    request = Request(
        f"{BACKEND}{_BACKEND_ROUTES[path]}",
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


def _thinkgraph_via_python_rails_sync(
    name: str,
    project_id: str,
    arguments: dict[str, Any],
) -> dict[str, Any]:
    operation = str(name or "").strip()
    request = Request(
        f"{PYTHON_RAILS}/thinkgraph/operation",
        data=json.dumps({
            "projectId": project_id,
            "operation": operation,
            "arguments": arguments,
        }).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    timeout = _mcp_tool_timeout_seconds(operation)
    try:
        with urlopen(request, timeout=timeout) as response:  # noqa: S310 - configured Python rails only
            result = json.loads(response.read().decode("utf-8"))
    except HTTPError as err:
        try:
            body = json.loads(err.read().decode("utf-8"))
        except Exception:
            body = {}
        raise RuntimeError(
            str(body.get("detail") or f"thinkgraph_python_rails_http_{err.code}")
        ) from err
    except URLError as err:
        raise RuntimeError(f"thinkgraph_python_rails_unreachable:{err.reason}") from err
    if not isinstance(result, dict):
        raise RuntimeError("thinkgraph_python_rails_result_invalid")
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
    """Verify Auth0 JWTs and attach an authorized Main context when one exists."""

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
                    "catalog-reader", "materializer-read", "card-runtime",
                }:
                    return None
                if principal.get("kind") == "materializer-read":
                    required = ("projectId", "deckId", "callerCardId")
                    if any(not str(principal.get(field) or "").strip() for field in required):
                        return None
                    grants = principal.get("grantedTools")
                    if not isinstance(grants, list) or any(
                        not isinstance(value, str) or not value.strip() for value in grants
                    ):
                        return None
                    connections = principal.get("grantedConnections", [])
                    if not isinstance(connections, list) or any(
                        not isinstance(value, str) or not value.strip()
                        for value in connections
                    ):
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
                leeway=AUTH0_CLOCK_SKEW_SECONDS,
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
            # Project context is optional enrichment after the OAuth/JWT
            # contract has already been verified. A transient backend lookup
            # failure must not turn a valid access token into an invalid one;
            # context-dependent tools fail closed when no binding is present.
            try:
                context = self._principal_context(subject)
            except Exception:
                context = None
            access_token = AccessToken(
                token=token,
                client_id=client_id,
                scopes=scopes,
                expires_at=int(claims["exp"]),
                resource=self.config.resource_url,
            )
            object.__setattr__(access_token, "subject", subject)
            verified_claims = dict(claims)
            if context is not None:
                verified_claims["main"] = context
            object.__setattr__(access_token, "claims", verified_claims)
            return access_token
        except Exception:
            return None

    async def verify_token(self, token: str) -> AccessToken | None:
        return await asyncio.to_thread(self._verify_sync, token)


async def _bridge(path: str, payload: dict[str, Any]) -> list[TextContent]:
    text = await asyncio.to_thread(_bridge_sync, path, payload)
    return [TextContent(type="text", text=text)]


async def _saved_specialist_card_bridge(payload: dict[str, Any]) -> dict[str, Any]:
    """Await one saved specialist Run through cancellable loopback HTTP."""

    if len(INTERNAL_MCP_SECRET) < 32:
        raise RuntimeError("internal_mcp_secret_missing")
    import httpx2

    async with httpx2.AsyncClient(
        headers={
            "Content-Type": "application/json",
            "X-LiquidAIty-Internal-MCP-Secret": INTERNAL_MCP_SECRET,
        },
        timeout=httpx2.Timeout(_SPECIALIST_CARD_HTTP_TIMEOUT_SECONDS),
        trust_env=False,
    ) as client:
        response = await client.post(
            f"{BACKEND}{_BACKEND_ROUTES['saved_specialist_card']}",
            json=payload,
        )
        try:
            result = response.json()
        except (TypeError, ValueError) as error:
            raise RuntimeError("saved_specialist_backend_result_invalid") from error
    if not isinstance(result, dict):
        raise RuntimeError("saved_specialist_backend_result_invalid")
    if response.status_code >= 400 and not result.get("error"):
        result = {
            "ok": False,
            "error": f"saved_specialist_backend_http_{response.status_code}",
        }
    return result


def _grounded_data_anchors_schema() -> dict[str, Any]:
    """One optional exact provider-record list shared by review and execution."""

    id_fields = {
        "engraphisMemoryId": {"type": "string", "minLength": 1},
        "engraphisEntityId": {"type": "string", "minLength": 1},
        "engraphisRelationshipId": {"type": "string", "minLength": 1},
        "graphitiEpisodeId": {"type": "string", "minLength": 1},
        "graphitiEntityId": {"type": "string", "minLength": 1},
        "graphitiRelationshipId": {"type": "string", "minLength": 1},
        "cbmQualifiedName": {"type": "string", "minLength": 1},
    }

    return {
        "type": "array",
        "minItems": 0,
        "maxItems": 16,
        "items": {
            "type": "object",
            "properties": {
                **id_fields,
                "reason": {"type": "string", "minLength": 1, "maxLength": 2000},
                "priority": {"type": "integer"},
                "boundedExpansion": {"type": "integer", "minimum": 0, "maximum": 3},
                "resultLimit": {"type": "integer", "minimum": 1, "maximum": 24},
            },
            "required": [
                "reason", "priority", "boundedExpansion", "resultLimit",
            ],
            "oneOf": [{"required": [field]} for field in id_fields],
            "additionalProperties": False,
        },
    }


def _application_tools() -> list[Tool]:
    return [
        Tool(
            name="main.context",
            title="Read Main request context",
            annotations={
                "title": "Read Main request context",
                "readOnlyHint": True,
                "destructiveHint": False,
                "idempotentHint": True,
                "openWorldHint": False,
            },
            description=(
                "Read the compact server-owned Main entry context for this authenticated "
                "Main request: project, deck, conversation, parent run, and saved "
                "Main-card identities, plus the exact served catalog/process/source identity. "
                "Accepts no caller-supplied identity or context payload."
            ),
            inputSchema={"type": "object", "properties": {}, "required": []},
        ),
        Tool(
            name="worldview.set_capability",
            title="Set a WorldView capability",
            annotations={
                "title": "Set a WorldView capability",
                "readOnlyHint": False,
                "destructiveHint": False,
                "idempotentHint": True,
                "openWorldHint": False,
            },
            description=(
                "Main only: set Main's ON/OFF choice for one exact capability in the "
                "current authenticated Project WorldView. The server supplies Project "
                "identity. Call only when the current user turn explicitly asks to "
                "change that shared spatial layer. An explicit user choice remains "
                "authoritative over this value."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "capabilityId": {
                        "type": "string",
                        "pattern": r"^[a-z0-9][a-z0-9._:-]{0,127}$",
                    },
                    "enabled": {"type": "boolean"},
                    "reason": {
                        "type": "string",
                        "minLength": 1,
                        "maxLength": 1000,
                    },
                },
                "required": ["capabilityId", "enabled", "reason"],
                "additionalProperties": False,
            },
        ),
        Tool(
            name="worldview.action",
            title="Run a WorldView action",
            annotations={
                "title": "Run a WorldView action",
                "readOnlyHint": False,
                "destructiveHint": False,
                "idempotentHint": False,
                "openWorldHint": False,
            },
            description=(
                "Saved WorldView Hermes Card only: execute one existing God's Eye action "
                "against the currently mounted WorldView in this Project. Examples: "
                "get_current_view_state, get_entity_context, track_entity, "
                "focus_satellites, "
                "set_layer_visibility, zoom_to_globe. The current Project source "
                "OFF ceiling is enforced; an absent or ambiguous mount fails closed. "
                "set_layer_visibility changes the shared Project choice and is only "
                "for an explicit request in the current user turn to change that layer; "
                "never enable a layer for passive scene questions or analysis. Returns "
                "the real action readback, not an inferred success. "
                "focus_satellites takes exactly {noradIds: [positive safe integer]} "
                "with at most 50 exact NORAD IDs; [] clears transient agent focus. "
                "Establish bounded IDs from existing context before calling it."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "enum": [
                            "get_current_view_state",
                            "get_entity_context",
                            "zoom_to_globe",
                            "track_entity",
                            "stop_tracking",
                            "focus_satellites",
                            "set_layer_visibility",
                        ],
                    },
                    "arguments": {"type": "object", "additionalProperties": True},
                },
                "required": ["name", "arguments"],
                "additionalProperties": False,
            },
        ),
        Tool(
            name="agentgraph.inspect",
            title="Inspect AgentGraph",
            annotations={
                "title": "Inspect AgentGraph",
                "readOnlyHint": True,
                "destructiveHint": False,
                "idempotentHint": True,
                "openWorldHint": False,
            },
            description=(
                "Read a bounded, authenticated Project-scoped view of current PostgreSQL/AGE "
                "Card relationships plus available run, lineage, "
                "tool, and artifact telemetry. runId selects one exact Run; otherwise the "
                "authenticated conversation is selected. cardId filters its direct Runs. "
                "projectWide reads across the authenticated Project, before limits. "
                "No prompt or model input is returned."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "runId": {"type": "string"},
                    "cardId": {"type": "string"},
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
            name="run_mag_one",
            title="Mag One",
            annotations={
                "title": "Mag One",
                "readOnlyHint": False,
                "destructiveHint": False,
                "idempotentHint": False,
                "openWorldHint": False,
            },
            description=(
                "Main only: submit one explicitly approved mission and any deliberately selected "
                "graph references to the saved Magnetic Card's existing Hermes Mag One execution. "
                "The authenticated runtime supplies Project, Card, conversation, and Run authority; "
                "the saved blue topology supplies the exact worker ceiling. This starts real work "
                "and returns its actual accepted execution state."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "input": {"type": "string", "minLength": 1},
                    "dataAnchors": _grounded_data_anchors_schema(),
                },
                "required": ["input"],
                "additionalProperties": False,
            },
        ),
        Tool(
            name="thinkgraph.reason",
            title="Reason with ThinkGraph",
            annotations={
                "title": "Reason with ThinkGraph",
                "readOnlyHint": False,
                "destructiveHint": False,
                "idempotentHint": False,
                "openWorldHint": False,
            },
            description=(
                "Ask the one enabled saved ThinkGraph Card to reason over bounded project "
                "history through its normal saved Hermes Run. The authenticated Card runtime "
                "supplies source and Project identity; the caller supplies only the request "
                "and optional exact data anchors. Returns the actual target result and Run IDs."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "request": {"type": "string", "minLength": 1, "maxLength": 20000},
                    "dataAnchors": _grounded_data_anchors_schema(),
                },
                "required": ["request"],
                "additionalProperties": False,
            },
        ),
        Tool(
            name="knowgraph.research",
            title="Research with KnowGraph",
            annotations={
                "title": "Research with KnowGraph",
                "readOnlyHint": False,
                "destructiveHint": False,
                "idempotentHint": False,
                "openWorldHint": True,
            },
            description=(
                "Ask the one enabled saved KnowGraph Card to perform bounded sourced research "
                "through its normal saved Hermes Run. The authenticated Card runtime supplies "
                "source and Project identity; the caller supplies only the request and optional "
                "exact data anchors. Returns the actual target result and Run IDs."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "request": {"type": "string", "minLength": 1, "maxLength": 20000},
                    "dataAnchors": _grounded_data_anchors_schema(),
                },
                "required": ["request"],
                "additionalProperties": False,
            },
        ),
        Tool(
            name="write_mag_one_instructions",
            title="Stage Magnetic instructions for review",
            annotations={
                "title": "Stage Magnetic instructions for review",
                "readOnlyHint": False,
                "destructiveHint": False,
                "idempotentHint": True,
                "openWorldHint": False,
            },
            description=(
                "Optional review only: place one exact mission and its resolved provider graph projection "
                "into the receiving saved Card's existing Invocation and Knowledge "
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
            title="Load graph references into a Card",
            annotations={
                "title": "Load graph references into a Card",
                "readOnlyHint": False,
                "destructiveHint": False,
                "idempotentHint": True,
                "openWorldHint": False,
            },
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
                    "engraphisMemoryId": {"type": "string", "minLength": 1},
                    "engraphisEntityId": {"type": "string", "minLength": 1},
                    "engraphisRelationshipId": {"type": "string", "minLength": 1},
                    "graphitiEpisodeId": {"type": "string", "minLength": 1},
                    "graphitiEntityId": {"type": "string", "minLength": 1},
                    "graphitiRelationshipId": {"type": "string", "minLength": 1},
                    "cbmQualifiedName": {"type": "string", "minLength": 1},
                    "reason": {"type": "string", "minLength": 1, "maxLength": 2000},
                    "order": {"type": "integer", "minimum": 0, "maximum": 255},
                    "depth": {"type": "integer", "minimum": 0, "maximum": 3},
                    "resultLimit": {"type": "integer", "minimum": 1, "maximum": 24},
                    "required": {"type": "boolean"},
                },
                "required": [
                    "targetCardId", "reason",
                    "order", "depth", "resultLimit", "required",
                ],
                "oneOf": [{"required": [field]} for field in (
                    "engraphisMemoryId", "engraphisEntityId", "engraphisRelationshipId",
                    "graphitiEpisodeId", "graphitiEntityId", "graphitiRelationshipId",
                    "cbmQualifiedName",
                )],
                "additionalProperties": False,
            },
        ),
        Tool(
            name="canvas.inspect",
            title="Inspect the saved Canvas",
            annotations={
                "title": "Inspect the saved Canvas",
                "readOnlyHint": True,
                "destructiveHint": False,
                "idempotentHint": True,
                "openWorldHint": False,
            },
            description='Read the saved deck; optionally inspect one exact Card with its editable configuration, revisions and current IDD/catalog choices.',
            inputSchema=card_tool_schema("canvas.inspect"),
        ),
        Tool(
            name="card.create",
            title="Create a saved Card",
            annotations={
                "title": "Create a saved Card",
                "readOnlyHint": False,
                "destructiveHint": False,
                "idempotentHint": False,
                "openWorldHint": False,
            },
            description='Create one saved Card with explicit configuration and expected deck revision. Honor its requested Hermes profile. Does not run the Card or create wires.',
            inputSchema=card_tool_schema("card.create"),
        ),
        Tool(
            name="card.update_configuration",
            title="Update saved Card configuration",
            annotations={
                "title": "Update saved Card configuration",
                "readOnlyHint": False,
                "destructiveHint": True,
                "idempotentHint": True,
                "openWorldHint": False,
            },
            description='Update one exact saved Card using current deck and Card revision IDs. Preserve unspecified fields. Does not run the Card.',
            inputSchema=card_tool_schema("card.update_configuration"),
        ),
        Tool(
            name="canvas.upsert_wire",
            title="Change a saved Canvas wire",
            annotations={
                "title": "Change a saved Canvas wire",
                "readOnlyHint": False,
                "destructiveHint": True,
                "idempotentHint": True,
                "openWorldHint": False,
            },
            description=(
                "Create/update/remove ONE saved canvas wire. Supported wire types only: 'flow' and "
                "'magentic_option'. Blue means worker availability to Magnetic and endpoint order has no runtime meaning. "
                "A wire is persisted visible configuration — it never runs agents."
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
                            "sourceHandle": {"type": ["string", "null"]},
                            "targetHandle": {"type": ["string", "null"]},
                            "enabled": {"type": "boolean"},
                            "edgeType": {
                                "type": "string",
                                "enum": ["flow", "magentic_option"],
                            },
                        },
                        "additionalProperties": True,
                    },
                },
                "required": ["projectId", "deckId", "op", "wire"],
            },
        ),
    ]


_APPLICATION_OPERATION_ACCESS = {
    "main.context": "read",
    "worldview.set_capability": "write",
    "worldview.action": "write",
    "agentgraph.inspect": "read",
    "run_mag_one": "write",
    "thinkgraph.reason": "write",
    "knowgraph.research": "write",
    "write_mag_one_instructions": "write",
    "card.load_graph_references": "write",
    "canvas.inspect": "read",
    "card.create": "write",
    "card.update_configuration": "write",
    "canvas.upsert_wire": "write",
}

_APPLICATION_SERVER_INJECTED_ARGUMENTS = {
    "canvas.inspect": frozenset({"projectId", "deckId"}),
    "canvas.upsert_wire": frozenset({"projectId", "deckId"}),
    "card.create": frozenset({"projectId", "deckId"}),
    "card.update_configuration": frozenset({"projectId", "deckId"}),
}

_DISPATCHER_CONTEXT_ARGUMENTS_BY_TOOL = {
    "agentgraph.inspect": frozenset({"projectId", "deckId", "conversationId"}),
    "canvas.inspect": frozenset({"projectId", "deckId"}),
    "canvas.upsert_wire": frozenset({"projectId", "deckId"}),
    "card.create": frozenset({"projectId", "deckId"}),
    "card.load_graph_references": frozenset({
        "projectId", "deckId", "conversationId", "_sourceCardId", "_sourceRunId",
    }),
    "card.update_configuration": frozenset({"projectId", "deckId"}),
    "run_mag_one": frozenset({"projectId", "deckId", "conversationId"}),
    "thinkgraph.reason": frozenset({
        "projectId", "deckId", "conversationId", "_sourceCardId", "_sourceRunId",
    }),
    "knowgraph.research": frozenset({
        "projectId", "deckId", "conversationId", "_sourceCardId", "_sourceRunId",
    }),
    "trading.accept_assignment": frozenset({"projectId", "deckId", "_sourceRunId"}),
    "trading.get_state": frozenset({"projectId", "deckId", "_sourceRunId"}),
    "trading.record_decision": frozenset({"projectId", "deckId", "_sourceRunId"}),
    "worldsignals.package": frozenset({
        "projectId", "deckId", "_sourceCardId", "_sourceRunId",
    }),
    "worldview.action": frozenset({"projectId", "deckId", "parentRunId"}),
    "worldview.set_capability": frozenset({"projectId"}),
    "write_mag_one_instructions": frozenset({
        "projectId", "deckId", "conversationId", "_sourceCardId",
    }),
}


def dispatcher_context_arguments_for(name: str) -> frozenset[str]:
    """Return the exact authenticated context fields injected for one operation."""

    return _DISPATCHER_CONTEXT_ARGUMENTS_BY_TOOL.get(name, frozenset())


def application_operation_definitions() -> list[OperationDefinition]:
    """Contribute application operations without making MCP their owner."""

    definitions: list[OperationDefinition] = []
    for tool in _application_tools():
        access = _APPLICATION_OPERATION_ACCESS.get(tool.name)
        if access is None:
            raise RuntimeError(f"application_operation_access_missing:{tool.name}")

        async def dispatch(*, _name: str = tool.name, **arguments: Any) -> Any:
            return await _dispatch_tool(_name, arguments)

        payload = tool.model_dump(by_alias=True, exclude_none=True)
        definitions.append(OperationDefinition(
            canonical_id=tool.name,
            description=tool.description or tool.name,
            parameters_schema=copy.deepcopy(tool.input_schema),
            handler=dispatch,
            available=True,
            publishers=(
                frozenset({"internal-plugin"})
                if tool.name in {
                    "worldview.action", "thinkgraph.reason", "knowgraph.research",
                }
                else frozenset({"internal-plugin", "external-mcp"})
            ),
            access=access,
            namespace="worldview" if tool.name == "worldview.action" else "main",
            external_source_id="main_mcp",
            output_schema=(
                copy.deepcopy(tool.output_schema)
                if tool.output_schema is not None
                else None
            ),
            title=str(
                tool.title
                or (payload.get("annotations") or {}).get("title")
                or tool.name
            ),
            annotations=copy.deepcopy(payload.get("annotations") or {}),
            grant_eligible=tool.name != "main.context",
            server_injected_arguments=_APPLICATION_SERVER_INJECTED_ARGUMENTS.get(
                tool.name, frozenset()
            ),
            dispatcher_context_arguments=dispatcher_context_arguments_for(tool.name),
            dispatcher_owner="app.mcp_host._dispatch_tool",
            required_caller_runtime=(
                ("hermes", "main")
                if tool.name in {"run_mag_one", "worldview.set_capability"}
                else ("hermes", "delegate") if tool.name == "worldview.action"
                else None
            ),
        ))
    return definitions


async def _materialize_complete_catalog() -> list[Tool]:
    global _LATEST_CATALOG_DIAGNOSTIC

    external_descriptors = [
        descriptor for descriptor in await asyncio.to_thread(static_tool_catalog)
        if "external-mcp" in descriptor["publications"]
    ]
    tools = [
        _bind_repo_tool_source(Tool(
            name=descriptor["canonicalId"],
            title=descriptor.get("displayName"),
            description=descriptor["description"],
            inputSchema=copy.deepcopy(descriptor["inputSchema"]),
            outputSchema=copy.deepcopy(descriptor.get("outputSchema")),
            annotations=copy.deepcopy(descriptor.get("annotations")),
        ),
            source_id=descriptor["provider"],
            provider_tool_name=descriptor["providerToolName"],
        )
        for descriptor in external_descriptors
    ]
    for tool in tools:
        tool.input_schema.setdefault("additionalProperties", False)
        public_keys = set(tool.input_schema.get("properties", {}))
        dispatch_keys = _ALLOWED_KEYS.get(tool.name)
        if dispatch_keys is None:
            _ALLOWED_KEYS[tool.name] = public_keys
        elif not public_keys <= dispatch_keys:
            missing = sorted(public_keys - dispatch_keys)
            raise RuntimeError(
                f"mcp_tool_dispatch_keys_missing:{tool.name}:{','.join(missing)}"
            )
    _complete_catalog_family("liquidaity")
    tools = [_bind_operation_access(tool) for tool in tools]
    provider_tools = await _materialize_requested_provider_catalog(
        tuple(_PROVIDER_PREFIXES)
    )
    existing_names = {tool.name for tool in tools}
    tools.extend(
        tool for tool in provider_tools if tool.name not in existing_names
    )
    names = [tool.name for tool in tools]
    if len(names) != len(set(names)):
        duplicates = sorted({name for name in names if names.count(name) > 1})
        raise RuntimeError("federated_duplicate_tool_name:" + ",".join(duplicates))
    context = _authenticated_main_context()
    # OAuth security metadata belongs to the canonical catalog even when this
    # request has not resolved application-level Main project authorization.
    catalog = (
        _bind_authenticated_catalog(tools)
        if OAUTH_ENFORCED or context is not None
        else tools
    )
    catalog_count, catalog_hash = _catalog_identity(catalog)
    with _CATALOG_DIAGNOSTIC_LOCK:
        _LATEST_CATALOG_DIAGNOSTIC = {
            "toolCount": catalog_count,
            "uniqueToolCount": len({tool.name for tool in catalog}),
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
    return catalog


def _requested_provider_catalog_families() -> tuple[str, ...]:
    """Resolve external families only from an authorized live MCP request."""
    principal = _internal_mcp_principal()
    if principal is None:
        # A public authenticated MCP client explicitly listing this product's
        # tools is allowed to discover the complete external surface. Process
        # startup itself has no request token and never reaches this branch.
        return ("cbm", "graphiti") if get_access_token() is not None else ()
    kind = str(principal.get("kind") or "")
    if kind == "catalog-reader":
        # The catalog reader can inspect every loaded provider contract but
        # cannot execute any tool. Card-specific principals remain narrowed to
        # their saved grants below.
        return tuple(_PROVIDER_PREFIXES)
    if kind not in {"materializer-read", "card-runtime"}:
        return ()
    grants = principal.get("grantedTools")
    granted = {
        str(value).strip() for value in grants if str(value).strip()
    } if isinstance(grants, list) else set()
    connections = principal.get("grantedConnections", [])
    granted_connections = {
        str(value).strip() for value in connections if str(value).strip()
    } if kind == "materializer-read" and isinstance(connections, list) else set()
    return tuple(
        family
        for family, prefix in _PROVIDER_PREFIXES.items()
        if family in granted_connections
        or any(name.startswith(prefix) for name in granted)
    )


async def _materialize_requested_provider_catalog(
    families: tuple[str, ...],
) -> list[Tool]:
    """Late-bind only the provider families selected by the authorized request."""
    tools: list[Tool] = []
    for provider in families:
        _set_catalog_initializing_family(provider)
        try:
            provider_tools = (
                await _cbm_tools()
                if provider == "cbm"
                else await _graphiti_tools()
            )
        except Exception as error:
            failure_code, failure_summary = _catalog_failure_details(error)
            _mark_catalog_family_unavailable(
                provider,
                failure_code=failure_code,
                failure_summary=failure_summary,
            )
            continue
        if provider == "graphiti" and not provider_tools and _GRAPHITI_UNAVAILABLE:
            _mark_catalog_family_unavailable(
                provider,
                failure_code=str(
                    _GRAPHITI_UNAVAILABLE.get("failureCode")
                    or "optional_capability_unavailable"
                ),
                failure_summary=str(
                    _GRAPHITI_UNAVAILABLE.get("detail")
                    or "Graphiti catalog is unavailable."
                ),
            )
            continue
        _complete_catalog_family(provider)
        namespaced = _namespace_provider_tools(provider, provider_tools)
        if provider == "cbm":
            _register_cbm_catalog(namespaced)
        elif provider == "graphiti":
            _register_graphiti_catalog(namespaced)
        tools.extend(namespaced)

    tools = [_bind_operation_access(tool) for tool in tools]
    return (
        _bind_authenticated_catalog(tools)
        if OAUTH_ENFORCED or _authenticated_main_context() is not None
        else tools
    )


async def _initialize_catalog_once() -> None:
    """Freeze the one canonical MCP catalog for all clients."""
    global _CATALOG_COMPLETED_FAMILIES, _CATALOG_UNAVAILABLE_FAMILIES
    global _CATALOG_FAILURE, _CATALOG_FAILURE_CODE
    global _CATALOG_FAILURE_SUMMARY, _CATALOG_INITIALIZING_FAMILY, _CATALOG_STATE
    global _CATALOG_TOOLS
    global _LATEST_CATALOG_DIAGNOSTIC
    with _CATALOG_DIAGNOSTIC_LOCK:
        _CATALOG_STATE = "initializing"
        _CATALOG_FAILURE = None
        _CATALOG_FAILURE_CODE = None
        _CATALOG_FAILURE_SUMMARY = None
        _CATALOG_COMPLETED_FAMILIES = ()
        _CATALOG_UNAVAILABLE_FAMILIES = ()
        _CATALOG_INITIALIZING_FAMILY = "liquidaity"
        _CATALOG_TOOLS = None
        _LATEST_CATALOG_DIAGNOSTIC = None
    try:
        tools = tuple(await _materialize_complete_catalog())
        canonical_names = [tool.name for tool in tools]
        if not tools or len(set(canonical_names)) != len(canonical_names):
            raise RuntimeError(
                "canonical_catalog_invalid: "
                f"actual={len(tools)} "
                f"unique={len(set(canonical_names))}"
            )
        catalog_count, catalog_hash = _catalog_identity(list(tools))
    except asyncio.CancelledError:
        with _CATALOG_DIAGNOSTIC_LOCK:
            if _CATALOG_STATE == "initializing":
                _CATALOG_STATE = "failed"
                _CATALOG_FAILURE = "CancelledError: catalog initialization cancelled"
                _CATALOG_FAILURE_CODE = "catalog_initialization_cancelled"
                _CATALOG_FAILURE_SUMMARY = _CATALOG_FAILURE
                _CATALOG_TOOLS = None
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
            _CATALOG_TOOLS = None
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
        _CATALOG_TOOLS = tools
        _LATEST_CATALOG_DIAGNOSTIC = {
            "toolCount": catalog_count,
            "uniqueToolCount": len(set(canonical_names)),
            "catalogHash": catalog_hash,
        }
        _CATALOG_FAILURE = None
        _CATALOG_FAILURE_CODE = None
        _CATALOG_FAILURE_SUMMARY = None
        _CATALOG_INITIALIZING_FAMILY = None
        _CATALOG_STATE = "ready"


def _observe_catalog_initialization(task: asyncio.Task[None]) -> None:
    """Fail closed if the one initializer ends without publishing a terminal state."""
    global _CATALOG_FAILURE, _CATALOG_FAILURE_CODE, _CATALOG_FAILURE_SUMMARY
    global _CATALOG_STATE, _CATALOG_TOOLS, _LATEST_CATALOG_DIAGNOSTIC
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
        _CATALOG_TOOLS = None
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


def _start_catalog_initialization() -> asyncio.Task[None]:
    """Return the one process-wide canonical catalog initialization task."""
    global _CATALOG_INITIALIZATION_TASK
    task = _CATALOG_INITIALIZATION_TASK
    if task is None:
        task = asyncio.create_task(
            _initialize_catalog_once(),
            name="liquidaity-mcp-catalog-initialization",
        )
        task.add_done_callback(_observe_catalog_initialization)
        _CATALOG_INITIALIZATION_TASK = task
    return task


def _catalog_or_error() -> list[Tool]:
    with _CATALOG_DIAGNOSTIC_LOCK:
        state = _CATALOG_STATE
        failure = _CATALOG_FAILURE
        tools = _CATALOG_TOOLS
        completed_families = set(_CATALOG_COMPLETED_FAMILIES)
    if state == "initializing":
        raise RuntimeError("mcp_catalog_initializing")
    if state == "failed":
        raise RuntimeError(
            f"mcp_catalog_initialization_failed: {failure or 'unknown'}"
        )
    if state != "ready" or tools is None:
        raise RuntimeError("mcp_catalog_readiness_invalid")
    if "liquidaity" not in completed_families:
        raise RuntimeError("mcp_catalog_incomplete:liquidaity")
    return list(tools)


async def list_tools() -> list[Tool]:
    """Return one frozen catalog, narrowed only for internal scoped callers."""
    with _CATALOG_DIAGNOSTIC_LOCK:
        initializing = _CATALOG_STATE == "initializing"
    if initializing:
        # HTTP binds before its providers finish initializing so health
        # can report truthful progress. A tools/list client, however, must not
        # observe an incomplete catalog or turn a transient startup state into
        # missing saved grants. Shield the one process-wide initializer from a
        # client cancellation, then return only its frozen terminal catalog.
        await asyncio.shield(_start_catalog_initialization())
    tools = _catalog_or_error()
    families = set(_requested_provider_catalog_families())
    tools = [
        tool for tool in tools
        if not any(
            tool.name.startswith(prefix) and family not in families
            for family, prefix in _PROVIDER_PREFIXES.items()
        )
    ]
    names = [tool.name for tool in tools]
    if len(names) != len(set(names)):
        raise RuntimeError("federated_duplicate_tool_name:" + ",".join(sorted({
            name for name in names if names.count(name) > 1
        })))
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
    "_effectTargetCardId",
    "_effectTargetCardRevisionId",
    "_effectTargetDeckRevision",
    "_builderOperation",
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
        source = dict(meta.get("liquidaitySource") or {})
        canonical_schema = source.get("canonicalInputSchema")
        declared = source.get("serverInjectedArguments")
        if not isinstance(canonical_schema, dict) or not isinstance(declared, list):
            raise RuntimeError(f"mcp_tool_projection_metadata_missing:{tool.name}")
        projected_schema = project_server_injected_schema(
            canonical_schema,
            frozenset(declared),
        )
        if tool.input_schema not in (canonical_schema, projected_schema):
            raise RuntimeError(f"mcp_tool_pre_projection_schema_mismatch:{tool.name}")
        payload["inputSchema"] = projected_schema
        source["authenticatedProjection"] = True
        meta["liquidaitySource"] = source
        meta["securitySchemes"] = security_schemes
        payload["_meta"] = meta
        result.append(Tool.model_validate(payload))
    return result


# Structural allow-list per tool: unexpected keys are rejected honestly, never
# silently forwarded (prevents smuggling prompts/models/patches through the host).
_ALLOWED_KEYS: dict[str, set[str]] = {
    "main.context": set(),
    "worldview.set_capability": {
        "projectId", "capabilityId", "enabled", "reason",
    },
    "worldview.action": {
        "projectId", "deckId", "parentRunId", "name", "arguments",
    },
    "agentgraph.inspect": {
        "projectId",
        "deckId",
        "conversationId",
        "runId",
        "cardId",
        "limit",
        "projectWide",
    },
    "run_mag_one": {
        "projectId", "deckId", "conversationId", "input", "dataAnchors",
    },
    "thinkgraph.reason": {
        "projectId", "deckId", "conversationId", "request", "dataAnchors",
        "_sourceCardId", "_sourceRunId",
    },
    "knowgraph.research": {
        "projectId", "deckId", "conversationId", "request", "dataAnchors",
        "_sourceCardId", "_sourceRunId",
    },
    "write_mag_one_instructions": {
        "projectId", "deckId", "conversationId", "targetCardId", "mission",
        "dataAnchors", "_sourceCardId",
    },
    "card.load_graph_references": {
        "projectId", "deckId", "conversationId", "targetCardId",
        "engraphisMemoryId", "engraphisEntityId", "engraphisRelationshipId",
        "graphitiEpisodeId", "graphitiEntityId", "graphitiRelationshipId",
        "cbmQualifiedName", "reason", "order", "depth", "resultLimit", "required",
        "_sourceCardId", "_sourceRunId",
    },
    "canvas.inspect": set(card_tool_schema("canvas.inspect")["properties"]),
    "card.create": set(card_tool_schema("card.create")["properties"]),
    "card.update_configuration": set(card_tool_schema("card.update_configuration")["properties"]),
    "canvas.upsert_wire": {"projectId", "deckId", "op", "wire"},
    "worldsignals.package": {
        "command", "reason", "arguments", "domains", "sourceRefs",
        "maxAgeSeconds", "limit", "projectId", "deckId", "_sourceCardId",
        "_sourceRunId",
    },
    "web_search": {"query", "max_results"},

}

for _runtime_definition in DEFAULT_TOOL_REGISTRY.operation_definitions():
    _runtime_properties = _runtime_definition.parameters_schema.get("properties")
    if isinstance(_runtime_properties, dict):
        _ALLOWED_KEYS.setdefault(
            _runtime_definition.canonical_id,
            set(_runtime_properties),
        )
for _trading_name in (
    "trading.get_state", "trading.accept_assignment", "trading.record_decision",
):
    _ALLOWED_KEYS[_trading_name].update({"projectId", "deckId", "_sourceRunId"})

# Application tools dispatch to their Python handlers (app/application_tools.py).
# Imported lazily so catalog discovery does not require the psycopg dependency chain.
_CONTROL_HANDLER_NAMES: dict[str, str] = {
    "agentgraph.inspect": "agentgraph_inspect",
    "canvas.inspect": "canvas_inspect",
    "card.create": "card_create",
    "card.update_configuration": "card_update_configuration",
    "canvas.upsert_wire": "canvas_upsert_wire",
    "write_mag_one_instructions": "write_mag_one_instructions",
    "card.load_graph_references": "card_load_graph_references",
}

async def _dispatch_tool(
    name: str,
    arguments: dict[str, Any],
) -> Any:
    context = _authenticated_main_context()
    principal = _internal_mcp_principal()
    if context is None and principal and principal.get("kind") == "materializer-read":
        # Pre-dispatch reads have real project/Card identity but no Run yet.
        # Keep their provider graph scope without fabricating runtime telemetry.
        context = {
            "projectId": principal["projectId"], "deckId": principal["deckId"],
            "mainCardId": principal["callerCardId"],
            "conversationId": principal.get("conversationId", ""),
        }
    if name.startswith(_PROVIDER_PREFIXES["cbm"]):
        await _cbm_tools()
        provider_tool_name = name.removeprefix(_PROVIDER_PREFIXES["cbm"])
        if provider_tool_name in _CBM_NAMES:
            provider_arguments = dict(arguments or {})
            return await _call_cbm(provider_tool_name, provider_arguments)
    if name.startswith(_PROVIDER_PREFIXES["graphiti"]):
        await _initialize_graphiti()
        await _graphiti_tools()
        provider_tool_name = name.removeprefix(_PROVIDER_PREFIXES["graphiti"])
        if provider_tool_name in _GRAPHITI_NAMES:
            from app.python_models.tool_registry import operation_definition

            definition = operation_definition(name)
            if definition is None:
                raise RuntimeError(f"graphiti_operation_definition_missing:{name}")
            server_injected = definition.server_injected_arguments
            provider_arguments = dict(arguments or {})
            include_body = bool(provider_arguments.pop("include_body", False))
            preview_chars = max(0, min(2000, int(provider_arguments.pop("body_preview_chars", 400))))
            response_budget = max(2000, min(100000, int(provider_arguments.pop("max_response_chars", 20000))))
            if context is not None:
                supplied_scope = sorted(server_injected & provider_arguments.keys())
                if supplied_scope:
                    return [
                        TextContent(
                            type="text",
                            text=json.dumps(
                                {
                                    "ok": False,
                                    "error": "caller_identity_rejected: " + ",".join(supplied_scope),
                                }
                            ),
                        )
                    ]
                group_id = graphiti_project_group_id(str(context["projectId"]))
                if "group_id" in server_injected:
                    provider_arguments["group_id"] = group_id
                if "group_ids" in server_injected:
                    provider_arguments["group_ids"] = [group_id]
                missing_scope = sorted(server_injected - provider_arguments.keys())
                if missing_scope:
                    raise RuntimeError(
                        "server_injected_argument_unavailable:" + ",".join(missing_scope)
                    )
            result = await _call_graphiti(provider_tool_name, provider_arguments)
            if provider_tool_name == "get_episodes" and isinstance(result, CallToolResult):
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
    from app.python_models.tool_registry import operation_definition, required_tool_caller_runtime

    definition = operation_definition(name)
    if definition is None:
        return [TextContent(type="text", text=json.dumps({
            "ok": False, "error": f"tool_definition_missing: {name}",
        }))]
    server_injected = definition.server_injected_arguments
    dispatcher_context = definition.dispatcher_context_arguments
    args = dict(arguments or {})
    if name in {"worldview.set_capability", "worldview.action"} and context is None:
        return [TextContent(type="text", text=json.dumps({
            "ok": False,
            "error": (
                "authenticated_main_context_required"
                if name == "worldview.set_capability"
                else "authenticated_card_context_required"
            ),
        }))]
    if context is not None:
        try:
            supplied_identity = sorted(_SERVER_OWNED_ARGUMENTS & args.keys())
            if supplied_identity:
                raise ValueError(f"caller_identity_rejected: {','.join(supplied_identity)}")
            for field in ("projectId", "deckId", "conversationId"):
                if field in dispatcher_context:
                    if (name == "agentgraph.inspect" and field == "conversationId"
                            and (args.get("runId") or args.get("projectWide") is True)):
                        continue
                    args[field] = str(context[field])
            if name == "worldview.action":
                args["parentRunId"] = str(context.get("parentRunId") or "")
            if name in {
                "write_mag_one_instructions", "card.load_graph_references", "worldsignals.package",
                "thinkgraph.reason", "knowgraph.research",
            }:
                args["_sourceCardId"] = str(context["mainCardId"])
            if name in {
                "card.load_graph_references", "worldsignals.package",
                "thinkgraph.reason", "knowgraph.research",
            }:
                args["_sourceRunId"] = str(context["parentRunId"])
            if name.startswith("trading."):
                args["_sourceRunId"] = str(context["parentRunId"])
            if "senderAgentId" in allowed:
                args["senderAgentId"] = str(context["mainCardId"])
            if "correlationId" in allowed:
                args["correlationId"] = f"external-mcp:{uuid4()}"
            if required_tool_caller_runtime(name) is not None:
                args["_callerCardId"] = str(context["mainCardId"])
                args["_callerRuntimeKind"] = str(
                    context.get("callerRuntimeKind") or "hermes"
                )
                args["_callerRuntimeMode"] = str(
                    context.get("callerRuntimeMode") or "main"
                )
            missing_injected = sorted(server_injected - args.keys())
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
    extra = [k for k in args.keys() if k not in allowed]
    if extra:
        return [
            TextContent(
                type="text",
                text=json.dumps({"ok": False, "error": f"tool_arguments_rejected: {','.join(sorted(extra))}"}),
            )
        ]
    if name in {"thinkgraph.reason", "knowgraph.research"}:
        if context is None or context.get("principalKind") != "card-runtime":
            return CallToolResult(
                content=[TextContent(
                    type="text",
                    text=json.dumps({
                        "ok": False,
                        "error": "authenticated_card_context_required",
                    }),
                )],
                isError=True,
            )
        result = await _saved_specialist_card_bridge({
            "operation": name,
            "request": str(args.get("request") or ""),
            "dataAnchors": (
                args.get("dataAnchors")
                if isinstance(args.get("dataAnchors"), list)
                else []
            ),
            "projectId": str(args.get("projectId") or ""),
            "deckId": str(args.get("deckId") or ""),
            "conversationId": str(args.get("conversationId") or ""),
            "sourceCardId": str(args.get("_sourceCardId") or ""),
            "sourceRunId": str(args.get("_sourceRunId") or ""),
        })
        result_text = json.dumps(result, ensure_ascii=False)
        return CallToolResult(
            content=[TextContent(type="text", text=result_text)],
            structuredContent=result,
            isError=result.get("ok") is False or bool(result.get("error")),
        )
    if name.startswith("engraphis_"):
        if context is None or not str(context.get("projectId") or "").strip():
            return [TextContent(
                type="text",
                text=json.dumps({
                    "ok": False,
                    "error": "authenticated_project_required",
                }),
            )]
        try:
            result = await asyncio.to_thread(
                _thinkgraph_via_python_rails_sync,
                name,
                str(context["projectId"]),
                args,
            )
        except RuntimeError as error:
            # The provider operation reports why it rejected the request. Keep
            # that actionable result; the outer handler otherwise replaces it
            # with internal_failure and the caller cannot correct its input.
            result = {"ok": False, "error": _sanitize_failure_detail(error)}
        result_text = json.dumps(result, ensure_ascii=False)
        return CallToolResult(
            content=[TextContent(type="text", text=result_text)],
            structuredContent={"result": result_text},
            isError=result.get("ok") is False or bool(result.get("error")),
        )
    if name == "run_mag_one":
        from app.python_models.card_domain import (
            CardDomainError,
            begin_run,
            finish_run,
            resolve_magentic_target_card,
        )
        from app.python_models.magentic_execution import (
            MagenticExecutionError,
            submit_magentic_execution,
        )

        run_id = f"req_{uuid4().hex[:16]}"
        run_prepared = False
        raw_anchors = args.get("dataAnchors")
        data_anchors = (
            [
                {**anchor, "required": True}
                if isinstance(anchor, dict) else anchor
                for anchor in raw_anchors
            ]
            if isinstance(raw_anchors, list) else []
        )
        try:
            target = await asyncio.to_thread(
                resolve_magentic_target_card,
                str(args.get("projectId") or ""),
                str(args.get("deckId") or ""),
            )
            prepared = await asyncio.to_thread(begin_run, {
                "projectId": target["projectId"],
                "deckId": target["deckId"],
                "cardId": target["cardId"],
                "senderCardId": caller_card_id,
                "runId": run_id,
                "correlationId": run_id,
                "acceptedAt": datetime.now(timezone.utc).isoformat(),
                "conversationId": str(args.get("conversationId") or "main"),
                "assignment": str(args.get("input") or ""),
                "dataAnchors": data_anchors,
                "discoveredTools": [],
                "discoveredToolCatalogState": "unavailable",
                "unavailableToolCatalogFamilies": [],
            })
            run_prepared = True
            execution = prepared.get("magenticExecution")
            if not isinstance(execution, dict):
                raise MagenticExecutionError("magentic_execution_contract_missing")
            result = await asyncio.to_thread(
                submit_magentic_execution,
                execution,
            )
        except (CardDomainError, MagenticExecutionError) as error:
            if run_prepared:
                try:
                    await asyncio.to_thread(
                        finish_run,
                        {
                            "runId": run_id,
                            "state": "failed",
                            "errorCode": "magentic_execution_failed",
                            "errorSummary": str(error),
                        },
                    )
                except CardDomainError:
                    pass
            result = {"ok": False, "error": str(error)}
        result_text = json.dumps(result, ensure_ascii=False)
        return CallToolResult(
            content=[TextContent(type="text", text=result_text)],
            structuredContent={"result": result_text},
            isError=result.get("ok") is False,
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
    if name == "worldview.set_capability":
        from app.python_models.project_worldview import (
            ProjectWorldviewError,
            set_main_project_worldview_capability,
        )

        try:
            result = await asyncio.to_thread(
                set_main_project_worldview_capability,
                str(args.get("projectId") or ""),
                str(args.get("capabilityId") or ""),
                args.get("enabled"),
                str(args.get("reason") or ""),
            )
            return [TextContent(type="text", text=json.dumps(result))]
        except ProjectWorldviewError as error:
            return [TextContent(type="text", text=json.dumps({
                "ok": False,
                "error": str(error),
            }))]
    if name == "worldview.action":
        if not all((
            str(args.get("projectId") or "").strip(),
            str(args.get("deckId") or "").strip(),
            caller_card_id,
            str(args.get("parentRunId") or "").strip(),
        )):
            return [TextContent(type="text", text=json.dumps({
                "ok": False, "error": "worldview_card_run_context_required",
            }))]
        return await _bridge("worldview_action", {
            "projectId": str(args["projectId"]),
            "deckId": str(args["deckId"]),
            "cardId": caller_card_id,
            "parentRunId": str(args["parentRunId"]),
            "name": str(args.get("name") or ""),
            "arguments": args.get("arguments") if isinstance(args.get("arguments"), dict) else {},
        })
    if name == "web_search":
        from app.python_models.web_search import web_search

        result_text = await web_search(
            query=str(args.get("query") or ""),
            max_results=int(args.get("max_results") or 5),
        )
        result = json.loads(result_text)
        if not isinstance(result, dict):
            raise RuntimeError("web_search_result_invalid")
        return CallToolResult(
            content=[TextContent(type="text", text=result_text)],
            structuredContent=result,
            isError=result.get("ok") is False,
        )
    if name == "worldsignals.package":
        from app.python_models.worldsignals_client import collect_worldsignals_signal_package

        try:
            source_card_id = str(args.pop("_sourceCardId", "") or "").strip()
            source_run_id = str(args.pop("_sourceRunId", "") or "").strip()
            project_id = str(args.pop("projectId", "") or "").strip()
            deck_id = str(args.pop("deckId", "") or "").strip()
            if not all((source_card_id, source_run_id, project_id, deck_id)):
                raise ValueError("worldsignals_package_card_context_required")
            package = await asyncio.to_thread(
                collect_worldsignals_signal_package,
                command=str(args.get("command") or ""),
                arguments=args.get("arguments") if isinstance(args.get("arguments"), dict) else {},
                project_id=project_id,
                deck_id=deck_id,
                requesting_card_id=source_card_id,
                requesting_run_id=source_run_id,
                reason=str(args.get("reason") or ""),
                producer_card_id=source_card_id,
                producer_run_id=source_run_id,
                domains=[str(value) for value in (args.get("domains") or [])],
                source_refs=[str(value) for value in (args.get("sourceRefs") or [])],
                max_age_seconds=args.get("maxAgeSeconds"),
                limit=int(args.get("limit") or 25),
            )
            return [TextContent(type="text", text=package.model_dump_json())]
        except Exception as error:
            return [TextContent(type="text", text=json.dumps({
                "ok": False, "error": str(error),
            }))]
    if name.startswith("trading."):
        from app.python_models.trading_runtime import (
            accept_trade_assignment,
            read_trading_state,
            record_trade_decision,
        )

        try:
            source_run_id = str(args.pop("_sourceRunId", "") or "")
            common = {
                "project_id": str(args.pop("projectId", "") or ""),
                "deck_id": str(args.pop("deckId", "") or ""),
                "card_id": caller_card_id,
            }
            if name == "trading.get_state":
                result = await asyncio.to_thread(read_trading_state, **common)
            elif name == "trading.accept_assignment":
                result = await asyncio.to_thread(
                    accept_trade_assignment,
                    **common,
                    source_run_id=source_run_id,
                    plan=args["plan"],
                    idempotency_key=str(args["idempotencyKey"]),
                )
            else:
                result = await asyncio.to_thread(
                    record_trade_decision,
                    **common,
                    source_run_id=source_run_id,
                    job_id=str(args["jobId"]),
                    action=str(args["action"]),
                    rationale=str(args["rationale"]),
                    confidence=args["confidence"],
                    evidence=args["evidence"],
                    missing_terms=args["missingTerms"],
                    idempotency_key=str(args["idempotencyKey"]),
                )
            return [TextContent(type="text", text=json.dumps(result, default=str))]
        except Exception as error:
            return [TextContent(type="text", text=json.dumps({
                "ok": False, "error": str(error),
            }))]
    handler_name = _CONTROL_HANDLER_NAMES.get(name)
    if handler_name is not None:
        from app import application_tools

        try:
            result = await (
                application_tools.card_create(
                    args,
                    caller_card_id=caller_card_id,
                )
                if name == "card.create"
                else
                application_tools.card_update_configuration(
                    args,
                    authenticated_user_edit=bool(
                        context is not None
                        and context.get("principalKind") is None
                        and principal is None
                    ),
                    caller_card_id=caller_card_id,
                )
                if name == "card.update_configuration"
                else
                application_tools.canvas_inspect(
                    args,
                    caller_card_id=caller_card_id,
                )
                if name == "canvas.inspect"
                else getattr(application_tools, handler_name)(args)
            )
            return [TextContent(type="text", text=json.dumps(result))]
        except application_tools.ApplicationToolError as err:
            return [TextContent(type="text", text=json.dumps({"ok": False, "error": str(err)}))]
    if DEFAULT_TOOL_REGISTRY.spec(name) is not None:
        try:
            result = await DEFAULT_TOOL_REGISTRY.invoke(name, args)
            return [TextContent(type="text", text=json.dumps(result, default=str))]
        except Exception as error:
            if name.startswith("worldsignals."):
                failure = _typed_failure(error, dependency="worldsignals")
                payload = {
                    key: failure[key]
                    for key in (
                        "ok",
                        "error",
                        "failureCode",
                        "errorCategory",
                        "retryable",
                        "dependency",
                    )
                }
                return CallToolResult(
                    content=[TextContent(type="text", text=json.dumps(payload))],
                    structuredContent={"error_code": failure["errorCategory"]},
                    isError=False,
                )
            return [TextContent(type="text", text=json.dumps({
                "ok": False, "error": str(error),
            }))]
    raise KeyError(f"configured_tool_unknown:{name}")


def _tool_result_category(result: Any) -> str:
    try:
        if isinstance(result, CallToolResult):
            if result.is_error:
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


def _mcp_tool_timeout_seconds(name: str) -> float:
    if name in {"thinkgraph.reason", "knowgraph.research"}:
        return _SPECIALIST_CARD_TOOL_TIMEOUT_SECONDS
    if name in {"engraphis_remember", "engraphis_update_memory", "engraphis_correct", "engraphis_ingest"}:
        # Preserve the existing semantic-write allowance through both transports.
        # Ingest includes the extractor's 135-second account transport before storage.
        # Optional Main preload remains governed by its separate two-second budget.
        return 190.0
    if name in {"cbm.index_repository", "run_mag_one"}:
        return _CBM_REQUEST_TIMEOUT_SECONDS
    return _MCP_CALL_TIMEOUT_SECONDS


async def _execute_tool_request(
    name: str,
    arguments: dict[str, Any],
    *,
    authenticated_context: dict[str, Any] | None,
    granted_tools: set[str] | None,
    transport: str,
) -> Any:
    context_token = _ACTIVE_AUTHENTICATED_CONTEXT.set(authenticated_context)
    tool_name = str(name or "").strip()
    trace_fields = {
        "tool_transport": transport,
        "tool_name": tool_name[:160],
        **(_oauth_trace_fields() if transport == "mcp" else {}),
    }
    _trace("tool_call_started", **trace_fields)
    try:
        allowed = (
            _request_tool_is_allowed(tool_name)
            if granted_tools is None
            else _tool_is_allowed(tool_name) and tool_name in granted_tools
        )
        if not allowed:
            raise PermissionError(f"tool_not_granted: {tool_name}")
        result = await asyncio.wait_for(
            _dispatch_tool(tool_name, arguments),
            timeout=_mcp_tool_timeout_seconds(tool_name),
        )
        result_category = _tool_result_category(result)
        _trace(
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
        failure = _typed_failure(
            error,
            dependency="mcp" if transport == "mcp" else "tool-runtime",
        )
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
        return result
    finally:
        _ACTIVE_AUTHENTICATED_CONTEXT.reset(context_token)


async def call_tool(name: str, arguments: dict[str, Any]) -> Any:
    return await _execute_tool_request(
        name,
        arguments,
        authenticated_context=None,
        granted_tools=None,
        transport="mcp",
    )


def _listed_tool_input_schema(name: str) -> dict[str, Any] | None:
    """Return the frozen model-visible schema used by SDK header validation."""
    tools = _CATALOG_TOOLS or ()
    match = next((tool for tool in tools if tool.name == name), None)
    return copy.deepcopy(match.input_schema) if match is not None else None


async def _server_list_resources(
    _context: Any,
    _params: PaginatedRequestParams | None,
) -> ListResourcesResult:
    return ListResourcesResult(resources=await list_resources())


async def _server_list_tools(
    _context: Any,
    _params: PaginatedRequestParams | None,
) -> ListToolsResult:
    return ListToolsResult(tools=await list_tools())


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
    get_tool_input_schema=_listed_tool_input_schema,
    on_list_resources=_server_list_resources,
    on_list_tools=_server_list_tools,
    on_call_tool=_server_call_tool,
)


async def _run_stdio() -> None:
    try:
        try:
            await _start_cbm_client()
        except Exception:
            # The provider family is reported unavailable by catalog materialization;
            # the SDK client failure must not remove the base model/tool surface.
            pass
        # Nested FastMCP registries cannot be discovered from this outer
        # server's active tools/list request without deadlocking the stdio
        # request lifecycle. Complete the same canonical catalog once before
        # accepting the outer stdio session; the CBM frontend remains
        # process-owned and indexing is still an explicit cbm.index_repository
        # tool call.
        await _initialize_catalog_once()
        _catalog_or_error()
        async with stdio_server() as (read_stream, write_stream):
            await server.run(read_stream, write_stream, server.create_initialization_options())
    finally:
        await _close_graphiti()
        await _close_cbm()


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

    @asynccontextmanager
    async def lifespan(_app: Starlette):
        try:
            await _start_cbm_client()
        except Exception:
            # Catalog diagnostics retain the exact dependency failure while the
            # MCP transport and non-CBM capabilities remain available.
            pass
        catalog_task = _start_catalog_initialization()
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
            await _close_graphiti()
            await _close_cbm()

    async def health_endpoint(_request: Any) -> JSONResponse:
        diagnostics = _catalog_diagnostics()
        return JSONResponse(
            {
                "ok": diagnostics["catalogState"] != "failed",
                **diagnostics,
            },
            status_code=200,
        )

    async def readiness_endpoint(_request: Any) -> JSONResponse:
        diagnostics = _catalog_diagnostics()
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
        diagnostics = _catalog_diagnostics()
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
    internal_routes: list[Any] = []

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
            *internal_routes,
            Route(
                "/.well-known/oauth-protected-resource",
                endpoint=protected_resource_routes[0].endpoint,
                methods=["GET", "OPTIONS"],
            ),
            *protected_resource_routes,
            Mount("/", app=protected_endpoint),
        ]
    else:
        routes = [*health_routes, *internal_routes, Mount("/", app=endpoint)]
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
