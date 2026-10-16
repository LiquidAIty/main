"""Generic loopback backend transport for application-owned operations."""

from __future__ import annotations

import asyncio
import json
import os
from typing import Any
from urllib.parse import urlsplit
from urllib.error import HTTPError, URLError
from urllib.request import HTTPRedirectHandler, Request, build_opener

from app.application_tool_error import ApplicationToolError
from mcp.types import TextContent


DEFAULT_BACKEND_OPERATION_TIMEOUT_SECONDS = 30.0
WORLDVIEW_ACTION_HTTP_TIMEOUT_SECONDS = 40.0


def validated_backend_origin(value: str) -> str:
    raw = str(value or "").strip()
    try:
        parsed = urlsplit(raw)
        port = parsed.port
    except ValueError as error:
        raise RuntimeError("main_backend_url_invalid") from error
    if (
        parsed.scheme != "http"
        or parsed.hostname not in {"127.0.0.1", "localhost", "::1"}
        or parsed.username is not None
        or parsed.password is not None
        or parsed.path not in {"", "/"}
        or parsed.query
        or parsed.fragment
        or port is None
    ):
        raise RuntimeError("main_backend_url_must_be_loopback_http_origin")
    return raw.rstrip("/")


class _RejectRedirects(HTTPRedirectHandler):
    def redirect_request(self, *_args: Any, **_kwargs: Any) -> None:
        return None


_BACKEND_OPENER = build_opener(_RejectRedirects())
BACKEND = validated_backend_origin(
    os.environ.get("MAIN_BACKEND_URL", "http://127.0.0.1:4000")
)


def open_backend_request(request: Request, *, timeout_seconds: float):
    return _BACKEND_OPENER.open(request, timeout=timeout_seconds)


def _internal_secret(*, required: bool) -> str:
    secret = os.environ.get("LIQUIDAITY_INTERNAL_MCP_SECRET", "").strip()
    if required and len(secret) < 32:
        raise RuntimeError("internal_mcp_secret_missing")
    return secret


def _request_headers(*, require_internal_secret: bool) -> dict[str, str]:
    secret = _internal_secret(required=require_internal_secret)
    headers = {"Content-Type": "application/json"}
    if require_internal_secret:
        headers["X-LiquidAIty-Internal-MCP-Secret"] = secret
    return headers


def _loopback_url(route: str) -> str:
    if not route.startswith("/api/"):
        raise KeyError(route)
    return f"{BACKEND}{route}"


def request_backend_json(
    method: str,
    route: str,
    payload: dict[str, Any] | None = None,
    *,
    require_internal_secret: bool = False,
    timeout_seconds: float = DEFAULT_BACKEND_OPERATION_TIMEOUT_SECONDS,
) -> dict[str, Any]:
    request = Request(
        _loopback_url(route),
        data=json.dumps(payload).encode("utf-8") if payload is not None else None,
        headers=_request_headers(
            require_internal_secret=require_internal_secret,
        ),
        method=method,
    )
    try:
        with open_backend_request(request, timeout_seconds=timeout_seconds) as response:
            value = json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        try:
            value = json.loads(error.read().decode("utf-8"))
        except Exception as decode_error:
            raise ApplicationToolError(
                f"backend_http_{error.code}: {route}"
            ) from decode_error
    except URLError as error:
        raise ApplicationToolError(
            f"backend_unreachable: {error.reason}"
        ) from error
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ApplicationToolError("backend_response_invalid") from error
    if not isinstance(value, dict):
        raise ApplicationToolError("backend_response_invalid")
    return value


def post_backend_text_sync(
    route: str,
    payload: dict[str, Any],
    *,
    timeout_seconds: float = DEFAULT_BACKEND_OPERATION_TIMEOUT_SECONDS,
    require_internal_secret: bool = False,
) -> str:
    request = Request(
        _loopback_url(route),
        data=json.dumps(payload).encode("utf-8"),
        headers=_request_headers(
            require_internal_secret=require_internal_secret,
        ),
        method="POST",
    )
    try:
        with open_backend_request(
            request,
            timeout_seconds=timeout_seconds,
        ) as response:
            return response.read().decode("utf-8")
    except HTTPError as error:
        try:
            body = error.read().decode("utf-8")
        except Exception:
            body = ""
        return body or json.dumps({
            "ok": False, "error": f"backend_http_{error.code}",
        })
    except URLError as error:
        return json.dumps({
            "ok": False, "error": f"backend_unreachable: {error.reason}",
        })


async def post_backend_text(
    route: str,
    payload: dict[str, Any],
    *,
    timeout_seconds: float = DEFAULT_BACKEND_OPERATION_TIMEOUT_SECONDS,
    require_internal_secret: bool = False,
) -> list[TextContent]:
    text = await asyncio.to_thread(
        post_backend_text_sync,
        route,
        payload,
        timeout_seconds=timeout_seconds,
        require_internal_secret=require_internal_secret,
    )
    return [TextContent(type="text", text=text)]
