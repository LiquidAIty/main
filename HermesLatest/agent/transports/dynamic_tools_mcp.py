"""Codex Dynamic Tool execution through one authenticated MCP connection.

The caller supplies an exact safe-name -> canonical MCP-name mapping plus a
short-lived bearer. This module owns only protocol transport and result
projection; the MCP server remains the tool catalog, authorization and
implementation authority.
"""

from __future__ import annotations

import asyncio
import json
import threading
from typing import Any, Callable
from urllib.parse import urlparse


_INTERRUPT_POLL_SECONDS = 0.05


def _validated_endpoint(value: str) -> str:
    parsed = urlparse(str(value or "").strip())
    if (
        parsed.scheme != "http"
        or (parsed.hostname or "").lower() not in {"127.0.0.1", "localhost", "::1"}
        or parsed.path != "/mcp"
        or parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError("dynamic_tool_mcp_endpoint_invalid")
    return parsed.geturl()


def _content_item(value: Any) -> dict[str, Any]:
    payload = (
        value.model_dump(by_alias=True, exclude_none=True)
        if hasattr(value, "model_dump")
        else value
    )
    if not isinstance(payload, dict):
        return {"type": "inputText", "text": json.dumps(payload, ensure_ascii=False)}
    kind = str(payload.get("type") or "")
    if kind == "text":
        return {"type": "inputText", "text": str(payload.get("text") or "")}
    if kind == "image":
        data = str(payload.get("data") or "")
        mime = str(payload.get("mimeType") or payload.get("mime_type") or "image/png")
        return {"type": "inputImage", "imageUrl": f"data:{mime};base64,{data}"}
    return {
        "type": "inputText",
        "text": json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
    }


async def _call(
    endpoint: str,
    authorization: str,
    canonical_name: str,
    arguments: dict[str, Any],
    interrupt_event: threading.Event,
) -> dict[str, Any]:
    import httpx2
    from mcp import ClientSession
    from mcp.client.streamable_http import streamable_http_client

    async def invoke() -> Any:
        async with httpx2.AsyncClient(
            headers={"Authorization": authorization},
            timeout=httpx2.Timeout(600.0),
            trust_env=False,
        ) as http_client:
            async with streamable_http_client(
                endpoint,
                http_client=http_client,
            ) as (read_stream, write_stream):
                async with ClientSession(
                    read_stream,
                    write_stream,
                    read_timeout_seconds=600.0,
                ) as session:
                    await session.initialize()
                    return await session.call_tool(
                        canonical_name,
                        dict(arguments),
                        read_timeout_seconds=600.0,
                    )

    if interrupt_event.is_set():
        return {
            "success": False,
            "contentItems": [{
                "type": "inputText",
                "text": json.dumps({"error": "dynamic_tool_cancelled"}),
            }],
        }
    call_task = asyncio.create_task(invoke())
    while not call_task.done():
        if interrupt_event.is_set():
            call_task.cancel()
            await asyncio.gather(call_task, return_exceptions=True)
            return {
                "success": False,
                "contentItems": [{
                    "type": "inputText",
                    "text": json.dumps({"error": "dynamic_tool_cancelled"}),
                }],
            }
        await asyncio.wait({call_task}, timeout=_INTERRUPT_POLL_SECONDS)
    result = call_task.result()
    content = list(getattr(result, "content", None) or [])
    is_error = bool(
        getattr(result, "isError", False)
        or getattr(result, "is_error", False)
    )
    return {
        "success": not is_error,
        "contentItems": [_content_item(item) for item in content] or [{
            "type": "inputText",
            "text": json.dumps({"error": "dynamic_tool_empty_result"}),
        }],
    }


def build_dynamic_tool_executor(
    *,
    endpoint: str,
    authorization: str,
    canonical_names: dict[str, str],
) -> Callable[[str, dict[str, Any], str, threading.Event], dict[str, Any]]:
    """Return the synchronous executor expected by CodexAppServerSession."""

    resolved_endpoint = _validated_endpoint(endpoint)
    token = str(authorization or "").strip()
    if not token.startswith("Bearer ") or len(token) <= len("Bearer "):
        raise ValueError("dynamic_tool_authorization_invalid")
    mapping = {
        str(name): str(canonical)
        for name, canonical in canonical_names.items()
        if str(name) and str(canonical)
    }

    def execute(
        name: str,
        arguments: dict[str, Any],
        _call_id: str,
        interrupt_event: threading.Event,
    ) -> dict[str, Any]:
        canonical_name = mapping.get(name)
        if canonical_name is None:
            raise ValueError("dynamic_tool_not_selected")
        return asyncio.run(_call(
            resolved_endpoint,
            token,
            canonical_name,
            arguments,
            interrupt_event,
        ))

    return execute


__all__ = ["build_dynamic_tool_executor"]
