"""Process/source observability and structurally typed MCP outcomes."""

# Graph + less = more: less code that does the same work as more code is more useful.
# Entity names the feature; Relationship explains why this file belongs and what it contributes.
# Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
# Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
# Entity: MCP Host
# Relationship: This file records bounded MCP process, session, authorization, and request outcomes while hashing sensitive identities and redacting secrets from diagnostic details.
# Entity: Tool Catalog
# Relationship: This file hashes the complete code-owned catalog source boundary and records catalog identity without exposing request arguments or credentials.

from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import sys
import threading
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from mcp.types import CallToolResult


_PACKAGE_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_REPO_ROOT = os.path.dirname(os.path.dirname(_PACKAGE_ROOT))
_APP_ROOT = os.path.dirname(os.path.abspath(__file__))
CATALOG_SOURCE_PATHS = (
    os.path.join(_APP_ROOT, "mcp_host.py"),
    os.path.join(_APP_ROOT, "mcp_auth.py"),
    os.path.join(_APP_ROOT, "mcp_catalog_runtime.py"),
    os.path.join(_APP_ROOT, "mcp_catalog_projection.py"),
    os.path.join(_APP_ROOT, "mcp_provider_operations.py"),
    os.path.join(_APP_ROOT, "application_operation_catalog.py"),
    os.path.join(_APP_ROOT, "agent_canvas_card_operations.py"),
    os.path.join(_APP_ROOT, "main_worldview_operations.py"),
    os.path.join(_APP_ROOT, "project_graph_operations.py"),
    os.path.join(_APP_ROOT, "saved_canvas_tools.py"),
    os.path.join(_APP_ROOT, "saved_card_operation_schema.py"),
    os.path.join(_APP_ROOT, "saved_card_operation_validation.py"),
    os.path.join(_APP_ROOT, "python_models", "engraphis_operations.py"),
    os.path.join(_APP_ROOT, "python_models", "general_tool_operations.py"),
    os.path.join(_APP_ROOT, "python_models", "graph_reference_contracts.py"),
    os.path.join(_APP_ROOT, "python_models", "market_sec_tool_operations.py"),
    os.path.join(_APP_ROOT, "python_models", "operation_definition.py"),
    os.path.join(_APP_ROOT, "python_models", "saved_card_contract.py"),
    os.path.join(_APP_ROOT, "python_models", "tool_catalog.py"),
    os.path.join(_APP_ROOT, "python_models", "tool_registry.py"),
    os.path.join(_APP_ROOT, "python_models", "trading_tool_operations.py"),
    os.path.join(_APP_ROOT, "python_models", "worldsignals_tool_operations.py"),
    os.path.join(_REPO_ROOT, "agent-products", "nrgsim", "services", "modeling_tools.py"),
)


def catalog_source_sha256() -> str:
    """Hash the complete code-owned catalog composition boundary."""
    digest = hashlib.sha256()
    try:
        for source_path in CATALOG_SOURCE_PATHS:
            relative = os.path.relpath(source_path, _REPO_ROOT).replace("\\", "/")
            digest.update(relative.encode("utf-8"))
            digest.update(b"\0")
            with open(source_path, "rb") as source_file:
                digest.update(source_file.read())
            digest.update(b"\0")
    except OSError:
        return ""
    return digest.hexdigest()


def _startup_source_identity() -> tuple[str, str]:
    """Capture the loaded checkout and complete catalog-source bundle once."""
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
    source_sha256 = catalog_source_sha256()
    return revision, source_sha256


STARTUP_ID = uuid4().hex
STARTUP_PROCESS_ID = os.getpid()
STARTUP_SOURCE_REVISION, STARTUP_SOURCE_SHA256 = _startup_source_identity()
TRACE_LOCK = threading.Lock()


def safe_hash(value: Any) -> str:
    text = str(value or "").strip()
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16] if text else ""


def trace(event: str, **fields: Any) -> None:
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
        "startupId": STARTUP_ID,
        "processId": STARTUP_PROCESS_ID,
        "event": event,
        **{
            key: value
            for key, value in fields.items()
            if key in allowed and value not in (None, "")
        },
    }
    with TRACE_LOCK:
        print(
            "[main-mcp-trace] "
            + json.dumps(payload, ensure_ascii=False, sort_keys=True),
            file=sys.stderr,
            flush=True,
        )


def sanitize_failure_detail(value: Any) -> str:
    detail = str(value or "").replace("\r", " ").replace("\n", " ")[:500]
    detail = re.sub(r"https?://[^\s/]+[^\s]*", "<remote-url>", detail)
    detail = re.sub(
        r"(?i)(api[-_ ]?key|authorization|bearer|token|password)\s*[:=]\s*[^\s,;]+",
        r"\1=<redacted>",
        detail,
    )
    return detail


def typed_failure(value: Any, *, dependency: str = "provider") -> dict[str, Any]:
    detail = sanitize_failure_detail(value)
    if isinstance(value, TimeoutError):
        code, category, retryable = "timeout", "TIMEOUT", True
    elif isinstance(value, PermissionError):
        code, category, retryable = "permission_denied", "AUTHORIZATION", False
    elif isinstance(value, ConnectionError):
        code, category, retryable = (
            "dependency_unavailable", "DEPENDENCY_UNAVAILABLE", True,
        )
    elif isinstance(value, (AttributeError, TypeError)):
        code, category, retryable = (
            "internal_handler_failure", "INTERNAL", False,
        )
    else:
        code, category, retryable = (
            ("internal_failure", "INTERNAL", False)
            if dependency in {"mcp", "tool-runtime"}
            else ("provider_failure", "PROVIDER", False)
        )
    return {
        "ok": False,
        "error": code,
        "failureCode": code,
        "errorCategory": category,
        "retryable": retryable,
        "dependency": dependency,
        "detail": detail,
    }


def tool_result_category(result: Any) -> str:
    return (
        "tool_error"
        if isinstance(result, CallToolResult) and result.is_error is True
        else "success"
    )
