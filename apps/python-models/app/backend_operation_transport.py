"""Generic loopback backend transport for application-owned operations."""

from __future__ import annotations

import asyncio
import json
import os
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from mcp.types import TextContent


BACKEND = os.environ.get("MAIN_BACKEND_URL", "http://127.0.0.1:4000").rstrip("/")
DEFAULT_BACKEND_OPERATION_TIMEOUT_SECONDS = 30.0
WORLDVIEW_ACTION_HTTP_TIMEOUT_SECONDS = 40.0
SPECIALIST_CARD_HTTP_TIMEOUT_SECONDS = 540.0


def _internal_secret(*, required: bool) -> str:
    secret = os.environ.get("LIQUIDAITY_INTERNAL_MCP_SECRET", "").strip()
    if required and len(secret) < 32:
        raise RuntimeError("internal_mcp_secret_missing")
    return secret


def _request_headers(*, require_internal_secret: bool) -> dict[str, str]:
    secret = _internal_secret(required=require_internal_secret)
    headers = {"Content-Type": "application/json"}
    if secret:
        headers["X-LiquidAIty-Internal-MCP-Secret"] = secret
    return headers


def _loopback_url(route: str) -> str:
    if not route.startswith("/api/"):
        raise KeyError(route)
    return f"{BACKEND}{route}"


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
        with urlopen(
            request,
            timeout=timeout_seconds,
        ) as response:  # noqa: S310 — loopback backend only
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


async def post_backend_json(
    route: str,
    payload: dict[str, Any],
    *,
    timeout_seconds: float,
    invalid_result_error: str,
    http_error_prefix: str,
) -> dict[str, Any]:
    secret = _internal_secret(required=True)
    import httpx2

    async with httpx2.AsyncClient(
        headers={
            "Content-Type": "application/json",
            "X-LiquidAIty-Internal-MCP-Secret": secret,
        },
        timeout=httpx2.Timeout(timeout_seconds),
        trust_env=False,
    ) as client:
        response = await client.post(
            _loopback_url(route),
            json=payload,
        )
        try:
            result = response.json()
        except (TypeError, ValueError) as error:
            raise RuntimeError(invalid_result_error) from error
    if not isinstance(result, dict):
        raise RuntimeError(invalid_result_error)
    if response.status_code >= 400 and not result.get("error"):
        return {
            "ok": False,
            "error": f"{http_error_prefix}_{response.status_code}",
        }
    return result
