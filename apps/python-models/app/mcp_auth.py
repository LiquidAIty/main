"""OAuth, internal-principal, and authenticated Project/profile context for MCP."""

# Graph + less = more: less code that does the same work as more code is more useful.
# Entity names the feature; Relationship explains why this file belongs and what it contributes.
# Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
# Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
# Entity: Authentication
# Relationship: This file verifies Auth0 bearer tokens and internal signed principals before any MCP request receives Project, Card, Run, or tool authority.
# Entity: MCP Host
# Relationship: This file supplies the MCP host's OAuth resource contract, token verifier, authenticated request context, and internal-principal validation.
# Entity: Projects
# Relationship: This file resolves a verified external identity to one owner-scoped Project context and rejects absent or malformed Project bindings.
# Entity: Card Profiles
# Relationship: This file carries the validated saved-profile identity requested by a profile-owned MCP connection into the backend context lookup.
# Entity: Tool Catalog
# Relationship: This file validates the exact granted-tool set carried by authenticated external and materializer-read principals.

from __future__ import annotations

import asyncio
from contextvars import ContextVar, Token
import json
import os
import time
from dataclasses import dataclass
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
_MAIN_CONTEXT_TIMEOUT_SECONDS = 30.0
PROJECT_CONTEXT_FIELDS = frozenset(
    {"projectId", "deckId", "conversationId", "parentRunId", "callerCardId"}
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
_REQUESTED_RUN_ID: ContextVar[str] = ContextVar(
    "requested_run_id", default="",
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


def set_requested_run_id(run_id: str) -> Token[str]:
    return _REQUESTED_RUN_ID.set(str(run_id or "").strip())


def reset_requested_run_id(token: Token[str]) -> None:
    _REQUESTED_RUN_ID.reset(token)


def requested_run_id() -> str:
    return _REQUESTED_RUN_ID.get()


def oauth_trace_fields() -> dict[str, str]:
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


def authenticated_external_identity() -> dict[str, str] | None:
    """Return the verified external issuer/subject without exposing token material."""

    access_token = get_access_token()
    if access_token is None or internal_mcp_principal() is not None:
        return None
    expires_at = getattr(access_token, "expires_at", None)
    if expires_at is not None and float(expires_at) <= time.time():
        return None
    claims = getattr(access_token, "claims", None)
    issuer = str(claims.get("iss") or "").strip() if isinstance(claims, dict) else ""
    subject = str(getattr(access_token, "subject", "") or "").strip()
    if not subject and isinstance(claims, dict):
        subject = str(claims.get("sub") or "").strip()
    if not issuer or not subject:
        return None
    return {"issuer": issuer, "subject": subject}


@dataclass(frozen=True)
class OAuthConfig:
    resource_url: str
    issuer_url: str
    audience: str
    client_id: str
    required_scope: str


def oauth_config() -> OAuthConfig:
    issuer = AUTH0_ISSUER_URL.rstrip("/") + "/" if AUTH0_ISSUER_URL else ""
    config = OAuthConfig(
        resource_url=PUBLIC_MCP_RESOURCE_URL.rstrip("/"),
        issuer_url=issuer,
        audience=AUTH0_AUDIENCE.rstrip("/"),
        client_id=AUTH0_CLIENT_ID,
        required_scope=AUTH0_REQUIRED_SCOPE,
    )
    if not OAUTH_ENFORCED:
        if config.resource_url:
            raise RuntimeError("public_mcp_resource_requires_oauth")
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
    if (
        not config.resource_url.startswith("https://")
        or not config.resource_url.endswith(HTTP_MCP_PATH)
    ):
        raise RuntimeError("oauth_resource_url_must_be_canonical_https_mcp")
    if config.audience != config.resource_url:
        raise RuntimeError("oauth_audience_must_equal_resource_url")
    if not config.issuer_url.startswith("https://"):
        raise RuntimeError("oauth_issuer_must_be_https")
    if config.required_scope not in OAUTH_SCOPES:
        raise RuntimeError("oauth_required_scope_not_supported")
    return config


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
    expires_at = getattr(access_token, "expires_at", None)
    if expires_at is not None and float(expires_at) <= time.time():
        return None
    claims = getattr(access_token, "claims", None)
    context = claims.get("project") if isinstance(claims, dict) else None
    return _validated_project_context(context)


def internal_mcp_principal() -> dict[str, Any] | None:
    access_token = get_access_token()
    claims = getattr(access_token, "claims", None) if access_token is not None else None
    principal = claims.get("internal") if isinstance(claims, dict) else None
    return dict(principal) if isinstance(principal, dict) else None


def _resolve_external_project_context_sync(
    issuer: str,
    subject: str,
) -> dict[str, Any] | None:
    try:
        headers = {"Content-Type": "application/json"}
        if INTERNAL_MCP_SECRET:
            headers["X-LiquidAIty-Internal-MCP-Secret"] = INTERNAL_MCP_SECRET
        request = Request(
            f"{BACKEND}/api/mcp/context",
            data=json.dumps({
                "issuer": issuer,
                "subject": subject,
                "projectId": requested_project_id(),
                "profile": requested_card_profile(),
                "runId": requested_run_id(),
            }).encode("utf-8"),
            headers=headers,
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
                "runId": requested_run_id(),
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


class Auth0TokenVerifier:
    """Verify Auth0 JWTs and attach an authorized Project/profile context when one exists."""

    def __init__(self, config: OAuthConfig, jwk_client: Any | None = None):
        from jwt import PyJWKClient

        self.config = config
        self.jwk_client = jwk_client or PyJWKClient(
            f"{config.issuer_url}.well-known/jwks.json"
        )

    def _principal_context(self, subject: str) -> dict[str, Any] | None:
        return _resolve_external_project_context_sync(self.config.issuer_url, subject)

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
                    scopes=[self.config.required_scope],
                    expires_at=int(claims["exp"]),
                    resource=self.config.resource_url,
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
            client_id = str(
                claims.get("azp") or claims.get("client_id") or ""
            ).strip()
            raw_scope = claims.get("scope") or ""
            scopes = (
                raw_scope.split()
                if isinstance(raw_scope, str)
                else [str(value) for value in raw_scope]
            )
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
                verified_claims["project"] = context
            object.__setattr__(access_token, "claims", verified_claims)
            return access_token
        except Exception:
            return None

    async def verify_token(self, token: str) -> AccessToken | None:
        return await asyncio.to_thread(self._verify_sync, token)
