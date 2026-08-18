"""Authenticated client primitives for the one official Python MCP host."""

from __future__ import annotations

import json
import os
import time
from collections.abc import Iterable
from typing import Any

import httpx
import jwt
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client

_INTERNAL_MCP_ISSUER = "liquidaity-runtime"
_INTERNAL_MCP_AUDIENCE = "liquidaity-internal-mcp"
_DEFAULT_INTERNAL_MCP_URL = "http://127.0.0.1:8765/mcp"
_TOKEN_LIFETIME_SECONDS = 12 * 60 * 60


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
    caller_runtime_binding: str,
    granted_tools: Iterable[str],
) -> str:
    principal = {
        "kind": "card-runtime",
        "projectId": str(project_id or "").strip(),
        "deckId": str(deck_id or "").strip(),
        "conversationId": str(conversation_id or "").strip(),
        "parentRunId": str(parent_run_id or "").strip(),
        "callerCardId": str(caller_card_id or "").strip(),
        "callerRuntimeBinding": str(caller_runtime_binding or "").strip(),
        "grantedTools": _unique_strings(granted_tools),
    }
    if any(not principal[field] for field in (
        "projectId", "deckId", "conversationId", "parentRunId",
        "callerCardId", "callerRuntimeBinding",
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


def _json_result(result: Any, tool_name: str) -> dict[str, Any]:
    content = list(getattr(result, "content", None) or [])
    text = str(getattr(content[0], "text", "") or "").strip() if content else ""
    if not text:
        raise RuntimeError(f"internal_mcp_empty_result: {tool_name}")
    try:
        parsed = json.loads(text)
    except (TypeError, ValueError) as error:
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
    caller_runtime_binding: str,
    target_card_id: str,
    input_text: str,
) -> dict[str, Any]:
    """Call one saved Card through the official MCP server, never directly."""
    token = create_card_runtime_token(
        project_id=project_id,
        deck_id=deck_id,
        conversation_id=conversation_id,
        parent_run_id=parent_run_id,
        caller_card_id=caller_card_id,
        caller_runtime_binding=caller_runtime_binding,
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
                    {"cardId": target_card_id, "input": input_text},
                )
    return _json_result(result, "card.run_assistant_agent")
