"""Authenticated client primitives for the one official Python MCP host."""

from __future__ import annotations

import asyncio
import json
import os
import time
from collections.abc import Iterable
from typing import Any

import httpx
import jwt
import anyio
from mcp import ClientSession
from mcp import types as mcp_types
from mcp.client.streamable_http import streamable_http_client

_INTERNAL_MCP_ISSUER = "liquidaity-runtime"
_INTERNAL_MCP_AUDIENCE = "liquidaity-internal-mcp"
_DEFAULT_INTERNAL_MCP_URL = "http://127.0.0.1:8765/mcp"
_TOKEN_LIFETIME_SECONDS = 12 * 60 * 60
_MATERIALIZER_TOKEN_LIFETIME_SECONDS = 60


def _required_secret() -> str:
    secret = os.environ.get("LIQUIDAITY_INTERNAL_MCP_SECRET", "").strip()
    if len(secret) < 32:
        raise RuntimeError("internal_mcp_secret_missing")
    return secret


def _unique_strings(values: Iterable[str]) -> list[str]:
    return sorted({str(value or "").strip() for value in values if str(value or "").strip()})


def internal_mcp_url() -> str:
    value = os.environ.get("LIQUIDAITY_INTERNAL_MCP_URL", _DEFAULT_INTERNAL_MCP_URL).strip()
    parsed = httpx.URL(value)
    if parsed.scheme != "http" or parsed.host not in {"127.0.0.1", "localhost"}:
        raise RuntimeError("internal_mcp_url_must_be_loopback_http")
    if parsed.path != "/mcp":
        raise RuntimeError("internal_mcp_url_path_invalid")
    return value


def create_card_runtime_token(
    *,
    project_id: str,
    deck_id: str,
    conversation_id: str,
    parent_run_id: str,
    caller_card_id: str,
    caller_runtime_kind: str,
    caller_runtime_mode: str,
    granted_tools: Iterable[str],
) -> str:
    principal = {
        "kind": "card-runtime",
        "projectId": str(project_id or "").strip(),
        "deckId": str(deck_id or "").strip(),
        "conversationId": str(conversation_id or "").strip(),
        "parentRunId": str(parent_run_id or "").strip(),
        "callerCardId": str(caller_card_id or "").strip(),
        "callerRuntimeKind": str(caller_runtime_kind or "").strip(),
        "callerRuntimeMode": str(caller_runtime_mode or "").strip(),
        "grantedTools": _unique_strings(granted_tools),
    }
    if any(not principal[field] for field in (
        "projectId", "deckId", "conversationId", "parentRunId",
        "callerCardId", "callerRuntimeKind", "callerRuntimeMode",
    )):
        raise RuntimeError("internal_mcp_principal_incomplete")
    now = int(time.time())
    return jwt.encode(
        {
            "iss": _INTERNAL_MCP_ISSUER,
            "aud": _INTERNAL_MCP_AUDIENCE,
            "sub": f"card-runtime:{principal['callerCardId']}",
            "iat": now,
            "exp": now + _TOKEN_LIFETIME_SECONDS,
            "scope": "liquidaity.main",
            "principal": principal,
        },
        _required_secret(),
        algorithm="HS256",
    )


def create_materializer_read_token(
    *,
    project_id: str,
    deck_id: str,
    card_id: str,
    conversation_id: str = "",
) -> str:
    """Issue a short-lived read-only principal for pre-dispatch graph hydration.

    A materialization preview has no Run yet, so this token deliberately carries
    no invented Run or conversation identity.  The official MCP host accepts it
    for IDD-declared reads only and rejects every write/effect operation.
    """
    principal = {
        "kind": "materializer-read",
        "projectId": str(project_id or "").strip(),
        "deckId": str(deck_id or "").strip(),
        "callerCardId": str(card_id or "").strip(),
        **({"conversationId": conversation_id} if conversation_id else {}),
    }
    if any(not principal[field] for field in ("projectId", "deckId", "callerCardId")):
        raise RuntimeError("internal_mcp_materializer_principal_incomplete")
    now = int(time.time())
    return jwt.encode(
        {
            "iss": _INTERNAL_MCP_ISSUER,
            "aud": _INTERNAL_MCP_AUDIENCE,
            "sub": f"materializer-read:{principal['callerCardId']}",
            "iat": now,
            "exp": now + _MATERIALIZER_TOKEN_LIFETIME_SECONDS,
            "scope": "liquidaity.main",
            "principal": principal,
        },
        _required_secret(),
        algorithm="HS256",
    )


def _json_result(result: Any, tool_name: str) -> dict[str, Any]:
    content = list(getattr(result, "content", None) or [])
    text = str(getattr(content[0], "text", "") or "").strip() if content else ""
    if not text:
        raise RuntimeError(f"internal_mcp_empty_result: {tool_name}")
    try:
        parsed = json.loads(text)
    except (TypeError, ValueError) as error:
        # query_graph supplies a column-labelled text table, unlike CBM's
        # JSON search/trace responses. Its reader validates those columns.
        if tool_name == "cbm.query_graph":
            return {"text": text}
        raise RuntimeError(f"internal_mcp_invalid_json_result: {tool_name}") from error
    if not isinstance(parsed, dict):
        raise RuntimeError(f"internal_mcp_invalid_result: {tool_name}")
    return parsed


async def call_saved_card_via_mcp(
    *,
    project_id: str,
    deck_id: str,
    conversation_id: str,
    parent_run_id: str,
    caller_card_id: str,
    caller_runtime_kind: str,
    caller_runtime_mode: str,
    target_card_id: str,
    input_text: str,
    data_anchors: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Call one saved Card through the official MCP server, never directly."""
    token = create_card_runtime_token(
        project_id=project_id,
        deck_id=deck_id,
        conversation_id=conversation_id,
        parent_run_id=parent_run_id,
        caller_card_id=caller_card_id,
        caller_runtime_kind=caller_runtime_kind,
        caller_runtime_mode=caller_runtime_mode,
        granted_tools=("card.run_assistant_agent",),
    )
    async with httpx.AsyncClient(
        headers={"Authorization": f"Bearer {token}"},
        timeout=httpx.Timeout(300.0),
    ) as http_client:
        async with streamable_http_client(
            internal_mcp_url(),
            http_client=http_client,
        ) as (read_stream, write_stream, _):
            async with ClientSession(read_stream, write_stream) as session:
                await session.initialize()
                result = await session.call_tool(
                    "card.run_assistant_agent",
                    {
                        "cardId": target_card_id,
                        "input": input_text,
                        **(
                            {"dataAnchors": list(data_anchors)}
                            if data_anchors
                            else {}
                        ),
                    },
                )
    return _json_result(result, "card.run_assistant_agent")


async def _call_read_tools_via_mcp_async(
    *,
    project_id: str,
    deck_id: str,
    card_id: str,
    calls: list[tuple[str, dict[str, Any]]],
    concurrent: bool = False,
    deadline_seconds: float | None = None,
    conversation_id: str = "",
) -> list[dict[str, Any]]:
    from app.python_models.tool_registry import tool_access

    for name, _arguments in calls:
        if tool_access(name) != "read":
            raise RuntimeError(f"materializer_mcp_read_required:{name}")
    token = create_materializer_read_token(
        project_id=project_id,
        deck_id=deck_id,
        card_id=card_id,
        conversation_id=conversation_id,
    )
    if deadline_seconds is not None and not 0 < deadline_seconds <= 30:
        raise ValueError("materializer_deadline_invalid")
    started = time.monotonic()
    results = [{"ok": False, "error": "read_timeout"} for _ in calls]
    mcp_url = internal_mcp_url()

    async def read():
        async with httpx.AsyncClient(
            headers={"Authorization": f"Bearer {token}"},
            timeout=httpx.Timeout(deadline_seconds or 30.0),
            # internal_mcp_url rejects HTTPS and non-loopback hosts. There is
            # no TLS connection here; loading the Windows CA store is wasted.
            **({"verify": False} if deadline_seconds is not None else {}),
        ) as http_client:
            async with streamable_http_client(
                mcp_url, http_client=http_client,
            ) as (read_stream, write_stream, _):
                async with ClientSession(read_stream, write_stream) as session:
                    await session.initialize()

                    async def call(index, name, arguments):
                        try:
                            if deadline_seconds is None:
                                result = await session.call_tool(name, dict(arguments or {}))
                            else:
                                # These known read results are decoded below by
                                # their graph owner. The public typed request
                                # avoids call_tool's extra catalog round trip;
                                # it retains MCP transport/result validation.
                                result = await session.send_request(
                                    mcp_types.ClientRequest(mcp_types.CallToolRequest(
                                        params=mcp_types.CallToolRequestParams(
                                            name=name, arguments=dict(arguments or {}),
                                        ),
                                    )),
                                    mcp_types.CallToolResult,
                                )
                            if getattr(result, "isError", False):
                                raise RuntimeError(f"materializer_mcp_read_failed:{name}")
                            results[index] = _json_result(result, name)
                        except Exception:
                            if deadline_seconds is None:
                                raise
                            results[index] = {"ok": False, "error": "read_failed"}
                        if deadline_seconds is not None:
                            results[index]["_readDurationMs"] = round((time.monotonic() - started) * 1000)

                    if concurrent:
                        async with anyio.create_task_group() as group:
                            for index, (name, arguments) in enumerate(calls):
                                group.start_soon(call, index, name, arguments)
                    else:
                        for index, (name, arguments) in enumerate(calls):
                            await call(index, name, arguments)

    if deadline_seconds is None:
        await read()
    else:
        try:
            with anyio.move_on_after(deadline_seconds):
                await read()
        except Exception:
            # Optional preload must not discard sources which already returned.
            for result in results:
                if result.get("error") == "read_timeout":
                    result["error"] = "read_failed"
        for result in results:
            result.setdefault("_readDurationMs", round((time.monotonic() - started) * 1000))
    return results


def call_read_tools_via_mcp(
    *,
    project_id: str,
    deck_id: str,
    card_id: str,
    calls: list[tuple[str, dict[str, Any]]],
    concurrent: bool = False,
    deadline_seconds: float | None = None,
    conversation_id: str = "",
) -> list[dict[str, Any]]:
    """Use one authenticated session on the one official MCP host."""
    if not calls:
        return []
    return asyncio.run(_call_read_tools_via_mcp_async(
        project_id=project_id,
        deck_id=deck_id,
        card_id=card_id,
        calls=calls,
        concurrent=concurrent,
        deadline_seconds=deadline_seconds,
        conversation_id=conversation_id,
    ))
