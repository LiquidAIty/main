"""Signed MCP credentials and saved Project/profile context without OAuth or expiry."""

# Entity: Authentication
# Relationship: Verifies signed MCP principals without a timed login cutoff.
# Entity: MCP Host
# Relationship: Supplies the MCP host's credential verifier and saved request context without an external login provider.
# Entity: Projects
# Relationship: This file validates owner-scoped Project bindings from verified tokens and exposes their exact saved Card grants to MCP dispatch.
# Entity: Card Profiles
# Relationship: This file carries the validated saved-profile identity requested by a profile-owned MCP connection into the backend context lookup.
# Entity: Tool Catalog
# Relationship: This file validates the exact granted-tool set carried by authenticated external and graph-read principals.

from __future__ import annotations

import asyncio
from contextvars import ContextVar, Token
import json
import os
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request

from app import mcp_observability
from app.backend_operation_transport import (
    open_backend_request,
    validated_backend_origin,
)
from mcp.server.auth.middleware.auth_context import get_access_token
from mcp.server.auth.provider import AccessToken


BACKEND = validated_backend_origin(
    os.environ.get("MAIN_BACKEND_URL", "http://127.0.0.1:4000")
)
HTTP_MCP_PATH = "/mcp"
INTERNAL_MCP_SECRET = os.environ.get("LIQUIDAITY_INTERNAL_MCP_SECRET", "").strip()
INTERNAL_MCP_ISSUER = "liquidaity-runtime"
INTERNAL_MCP_AUDIENCE = "liquidaity-internal-mcp"
_MAIN_CONTEXT_TIMEOUT_SECONDS = 30.0
PROJECT_CONTEXT_FIELDS = frozenset(
    {"projectId", "deckId", "conversationId", "callerCardId"}
)
PROJECT_CONTEXT_TOOLS_FIELD = "grantedTools"
PROJECT_CONTEXT_MAIN_ENTRY_FIELD = "mainEntryAuthorized"
_REQUESTED_HERMES_PROFILE: ContextVar[str] = ContextVar(
    "requested_card_profile", default="",
)
_REQUESTED_PROJECT_ID: ContextVar[str] = ContextVar(
    "requested_project_id", default="",
)
_REQUESTED_DECK_ID: ContextVar[str] = ContextVar(
    "requested_deck_id", default="",
)
_REQUESTED_CONVERSATION_ID: ContextVar[str] = ContextVar(
    "requested_conversation_id", default="",
)


def set_requested_card_profile(profile: str) -> Token[str]:
    return _REQUESTED_HERMES_PROFILE.set(str(profile or "").strip())


def reset_requested_card_profile(token: Token[str]) -> None:
    _REQUESTED_HERMES_PROFILE.reset(token)


def requested_card_profile() -> str:
    return _REQUESTED_HERMES_PROFILE.get()


def set_requested_project_id(project_id: str) -> Token[str]:
    return _REQUESTED_PROJECT_ID.set(str(project_id or "").strip())


def reset_requested_project_id(token: Token[str]) -> None:
    _REQUESTED_PROJECT_ID.reset(token)


def requested_project_id() -> str:
    return _REQUESTED_PROJECT_ID.get()


def set_requested_deck_id(deck_id: str) -> Token[str]:
    return _REQUESTED_DECK_ID.set(str(deck_id or "").strip())


def reset_requested_deck_id(token: Token[str]) -> None:
    _REQUESTED_DECK_ID.reset(token)


def requested_deck_id() -> str:
    return _REQUESTED_DECK_ID.get()


def set_requested_conversation_id(conversation_id: str) -> Token[str]:
    return _REQUESTED_CONVERSATION_ID.set(str(conversation_id or "").strip())


def reset_requested_conversation_id(token: Token[str]) -> None:
    _REQUESTED_CONVERSATION_ID.reset(token)


def requested_conversation_id() -> str:
    return _REQUESTED_CONVERSATION_ID.get()


def credential_trace_fields() -> dict[str, str]:
    access_token = get_access_token()
    if access_token is None:
        return {}
    subject = getattr(access_token, "subject", "")
    if not subject:
        claims = getattr(access_token, "claims", None)
        subject = claims.get("sub", "") if isinstance(claims, dict) else ""
    return {
        "subject_hash": mcp_observability.safe_hash(subject),
        "client_hash": mcp_observability.safe_hash(
            getattr(access_token, "client_id", ""),
        ),
    }


def access_token_available() -> bool:
    return get_access_token() is not None


def validated_principal_tool_names(value: Any) -> frozenset[str] | None:
    """Validate one exact normalized tool-name set from a signed principal."""
    if not isinstance(value, list):
        return None
    if any(
        not isinstance(item, str) or not item.strip() or item != item.strip()
        for item in value
    ):
        return None
    if len(value) != len(set(value)):
        return None
    return frozenset(value)


def _validated_project_context(value: Any) -> dict[str, Any] | None:
    if not isinstance(value, dict) or not PROJECT_CONTEXT_FIELDS.issubset(value):
        return None
    granted_tools = validated_principal_tool_names(
        value.get(PROJECT_CONTEXT_TOOLS_FIELD)
    )
    if granted_tools is None:
        return None
    return {
        **{field: str(value[field]) for field in PROJECT_CONTEXT_FIELDS},
        PROJECT_CONTEXT_TOOLS_FIELD: sorted(granted_tools),
        PROJECT_CONTEXT_MAIN_ENTRY_FIELD: (
            value.get(PROJECT_CONTEXT_MAIN_ENTRY_FIELD) is True
        ),
    }


def authenticated_project_context() -> dict[str, Any] | None:
    access_token = get_access_token()
    if access_token is None:
        return None
    claims = getattr(access_token, "claims", None)
    context = claims.get("project") if isinstance(claims, dict) else None
    return _validated_project_context(context)


def internal_mcp_principal() -> dict[str, Any] | None:
    access_token = get_access_token()
    claims = getattr(access_token, "claims", None) if access_token is not None else None
    principal = claims.get("internal") if isinstance(claims, dict) else None
    return dict(principal) if isinstance(principal, dict) else None


def _resolve_internal_card_context_sync(principal: dict[str, Any]) -> dict[str, Any] | None:
    try:
        request = Request(
            f"{BACKEND}/api/mcp/card-context",
            data=json.dumps({
                "ownerUserId": principal["ownerUserId"],
                "projectId": principal["projectId"],
                "deckId": principal["deckId"],
                "profile": principal["profile"],
                "conversationId": requested_conversation_id(),
            }).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "X-LiquidAIty-Internal-MCP-Secret": INTERNAL_MCP_SECRET,
            },
            method="POST",
        )
        with open_backend_request(
            request,
            timeout_seconds=_MAIN_CONTEXT_TIMEOUT_SECONDS,
        ) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except (HTTPError, URLError, TypeError, ValueError):
        return None
    context = (
        payload.get("context")
        if isinstance(payload, dict) and payload.get("ok") is True
        else None
    )
    return _validated_project_context(context)


class McpTokenVerifier:
    """Verify the existing signed credential and resolve its saved Card grants."""

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
                    options={"require": ["iat", "sub", "principal"], "verify_exp": False},
                )
                principal = claims.get("principal")
                if not isinstance(principal, dict) or principal.get("kind") not in {
                    "catalog-reader", "graph-read", "card-runtime",
                }:
                    return None
                if principal.get("kind") == "graph-read":
                    required = ("projectId", "deckId", "callerCardId")
                    if any(
                        not str(principal.get(field) or "").strip()
                        for field in required
                    ):
                        return None
                    if validated_principal_tool_names(
                        principal.get("grantedTools")
                    ) is None:
                        return None
                card_context = None
                if principal.get("kind") == "card-runtime":
                    if any(not isinstance(principal.get(field), str) or not principal[field].strip()
                           for field in ("ownerUserId", "projectId", "deckId", "profile")):
                        return None
                    if requested_card_profile() != principal["profile"]:
                        return None
                    card_context = _resolve_internal_card_context_sync(principal)
                    if card_context is None:
                        return None
                access_token = AccessToken(
                    token=token,
                    client_id="liquidaity-internal-runtime",
                    scopes=[],
                    expires_at=None,
                )
                object.__setattr__(access_token, "subject", str(claims["sub"]))
                object.__setattr__(
                    access_token,
                    "claims",
                    {
                        **claims,
                        "internal": principal,
                        **({"project": card_context} if card_context is not None else {}),
                    },
                )
                return access_token
            return None
        except Exception:
            return None

    async def verify_token(self, token: str) -> AccessToken | None:
        return await asyncio.to_thread(self._verify_sync, token)
