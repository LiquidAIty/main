"""OAuth, internal-principal, and authenticated Main-context authority for MCP."""

from __future__ import annotations

import asyncio
import json
import os
import time
from dataclasses import dataclass
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from app import mcp_observability
from mcp.server.auth.middleware.auth_context import get_access_token
from mcp.server.auth.provider import AccessToken


BACKEND = os.environ.get("MAIN_BACKEND_URL", "http://127.0.0.1:4000").rstrip("/")
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
_MAIN_CONTEXT_FIELDS = frozenset(
    {"projectId", "deckId", "conversationId", "parentRunId", "mainCardId"}
)
_AUTHENTICATED_OPTIONAL_CONTEXT_FIELDS = frozenset({
    "callerRuntimeKind", "callerRuntimeMode", "principalKind", "grantedTools",
    "presentedTools",
})


def _oauth_trace_fields() -> dict[str, str]:
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


def _authenticated_main_context() -> dict[str, Any] | None:
    access_token = get_access_token()
    if access_token is None:
        return None
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
            "presentedTools": internal.get("presentedTools", []),
        }
    else:
        context = claims.get("main") if isinstance(claims, dict) else None
    if not isinstance(context, dict) or not _MAIN_CONTEXT_FIELDS.issubset(context):
        return None
    resolved: dict[str, Any] = {
        field: str(context[field]) for field in _MAIN_CONTEXT_FIELDS
    }
    for field in _AUTHENTICATED_OPTIONAL_CONTEXT_FIELDS:
        value = context.get(field)
        if field in {"grantedTools", "presentedTools"} and isinstance(value, list):
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


def _validated_principal_tool_names(value: Any) -> frozenset[str] | None:
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


def _resolve_external_main_context_sync(
    issuer: str,
    subject: str,
) -> dict[str, Any] | None:
    try:
        headers = {"Content-Type": "application/json"}
        if INTERNAL_MCP_SECRET:
            headers["X-LiquidAIty-Internal-MCP-Secret"] = INTERNAL_MCP_SECRET
        request = Request(
            f"{BACKEND}/api/main/context",
            data=json.dumps({"issuer": issuer, "subject": subject}).encode("utf-8"),
            headers=headers,
            method="POST",
        )
        with urlopen(request, timeout=_MAIN_CONTEXT_TIMEOUT_SECONDS) as response:  # noqa: S310
            payload = json.loads(response.read().decode("utf-8"))
    except (HTTPError, URLError, TypeError, ValueError):
        return None
    context = (
        payload.get("context")
        if isinstance(payload, dict) and payload.get("ok") is True
        else None
    )
    return (
        context
        if isinstance(context, dict) and _MAIN_CONTEXT_FIELDS.issubset(context)
        else None
    )


class Auth0TokenVerifier:
    """Verify Auth0 JWTs and attach an authorized Main context when one exists."""

    def __init__(self, config: OAuthConfig, jwk_client: Any | None = None):
        from jwt import PyJWKClient

        self.config = config
        self.jwk_client = jwk_client or PyJWKClient(
            f"{config.issuer_url}.well-known/jwks.json"
        )

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
                    if any(
                        not str(principal.get(field) or "").strip()
                        for field in required
                    ):
                        return None
                    if _validated_principal_tool_names(
                        principal.get("grantedTools")
                    ) is None:
                        return None
                elif principal.get("kind") != "catalog-reader":
                    required = (
                        "projectId", "deckId", "conversationId", "parentRunId",
                        "callerCardId", "callerRuntimeKind", "callerRuntimeMode",
                    )
                    if any(
                        not str(principal.get(field) or "").strip()
                        for field in required
                    ):
                        return None
                    grants = _validated_principal_tool_names(
                        principal.get("grantedTools")
                    )
                    presented = _validated_principal_tool_names(
                        principal.get("presentedTools")
                    )
                    if (
                        grants is None
                        or presented is None
                        or not presented.issubset(grants)
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
                object.__setattr__(
                    access_token, "claims", {**claims, "internal": principal},
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
                verified_claims["main"] = context
            object.__setattr__(access_token, "claims", verified_claims)
            return access_token
        except Exception:
            return None

    async def verify_token(self, token: str) -> AccessToken | None:
        return await asyncio.to_thread(self._verify_sync, token)
