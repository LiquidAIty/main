"""Process/source observability and wire-safe MCP failure/result classification."""

from __future__ import annotations

import asyncio
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
_MCP_HOST_SOURCE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "mcp_host.py")


def _startup_source_identity() -> tuple[str, str]:
    """Capture the exact loaded checkout and mcp_host.py source bytes once."""
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
        with open(_MCP_HOST_SOURCE, "rb") as source_file:
            source_sha256 = hashlib.sha256(source_file.read()).hexdigest()
    except OSError:
        source_sha256 = ""
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
            "session terminated", "session not found", "session expired",
            "session closed", "transport closed", "connection closed",
        )
    ):
        code, retryable = "session_terminated", False
    elif any(
        term in lowered
        for term in (
            "token expired", "token has expired", "expired token",
            "authentication expired", "auth expired",
        )
    ):
        code, retryable = "authentication_expired", False
    elif any(
        term in lowered
        for term in (
            "invalid argument", "invalid arguments", "invalid_argument", "invalid params",
        )
    ):
        code, retryable = "invalid_arguments", False
    elif any(
        term in lowered
        for term in (
            "no workspace named", "workspace not found", "no repo named",
            "repository not found",
        )
    ):
        code, retryable = "resource_not_found", False
    elif any(term in lowered for term in ("insufficient", "credit", "quota exceeded")):
        code, retryable = "insufficient_credits", False
    elif any(
        term in lowered
        for term in ("unauthorized", "authentication", "invalid api key", "401")
    ):
        code, retryable = "authentication_failed", False
    elif any(term in lowered for term in ("rate limit", "too many requests", "429")):
        code, retryable = "rate_limited", True
    elif "dimension" in lowered and any(term in lowered for term in ("embedding", "vector")):
        code, retryable = "embedding_dimension_mismatch", False
    elif any(
        term in lowered
        for term in ("malformed", "invalid json", "model output", "validation error")
    ):
        code, retryable = "malformed_model_output", False
    elif any(term in lowered for term in ("queue", "worker")):
        code, retryable = "queue_failure", True
    elif any(term in lowered for term in (
        "service unavailable", "connection refused", "actively refused",
        "backend_unreachable", "worldsignals_unreachable", "winerror 10061",
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
        "database_failure", "queue_failure", "service_unavailable",
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


def tool_result_category(result: Any) -> str:
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
                    payload.get("ok") is False or bool(payload.get("error"))
                ):
                    return "tool_error"
    except Exception:
        return "tool_error"
    return "success"
