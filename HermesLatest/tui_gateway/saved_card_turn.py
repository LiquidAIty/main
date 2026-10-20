"""Project-scoped saved-Card turn preparation through an existing application endpoint.

Hermes remains the executor. The configured application endpoint materializes the receiving
Card's canonical input and records the outer Run; this module only transports that prepared
turn into the already-owned Hermes session and reports its terminal result.
"""

from __future__ import annotations

import base64
from contextvars import ContextVar, Token
import hashlib
import hmac
import json
import mimetypes
import os
from pathlib import Path
import re
import time
from typing import Any
from urllib.error import HTTPError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen
from uuid import uuid4


_RUN_ID = re.compile(r"^[A-Za-z0-9:_-]{1,128}$")
_PROFILE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")
_CURRENT_CARD_TURN: ContextVar[dict[str, str] | None] = ContextVar(
    "current_saved_card_turn", default=None,
)
_MAX_IMAGES = 12
_MAX_IMAGE_BYTES = 1_000_000
_CARD_TURN_ENV = "HERMES_SAVED_CARD_TURN"


def normalize_card_turn_context(value: Any) -> dict[str, str] | None:
    if value is None:
        return None
    required = {
        "endpoint", "project_id", "deck_id", "conversation_id", "card_id", "profile",
    }
    if not isinstance(value, dict) or set(value) != required:
        raise ValueError("card_turn_context_invalid")
    context = {key: str(value.get(key) or "").strip() for key in required}
    if any(not item or len(item) > 512 for item in context.values()):
        raise ValueError("card_turn_context_invalid")
    if not _PROFILE.fullmatch(context["profile"]):
        raise ValueError("card_turn_context_invalid")
    parsed = urlsplit(context["endpoint"])
    loopback = (parsed.hostname or "").lower() in {"127.0.0.1", "::1", "localhost"}
    if (
        parsed.scheme not in {"http", "https"}
        or (parsed.scheme == "http" and not loopback)
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError("card_turn_endpoint_invalid")
    return context


def bind_card_turn(
    context: dict[str, str],
    run_id: str,
    *,
    externally_managed: bool = False,
) -> Token:
    if not _RUN_ID.fullmatch(str(run_id or "")):
        raise ValueError("card_run_identity_invalid")
    return _CURRENT_CARD_TURN.set({
        **context,
        "run_id": run_id,
        "externally_managed": "true" if externally_managed else "false",
    })


def reset_card_turn(token: Token | None) -> None:
    if token is not None:
        _CURRENT_CARD_TURN.reset(token)


def current_card_turn_headers() -> dict[str, str]:
    current = current_card_turn_context()
    if not current:
        return {}
    return {
        "X-LiquidAIty-Project-Id": current["project_id"],
        "X-LiquidAIty-Deck-Id": current["deck_id"],
        "X-LiquidAIty-Conversation-Id": current["conversation_id"],
        "X-LiquidAIty-Hermes-Profile": current["profile"],
        "X-LiquidAIty-Run-Id": current["run_id"],
    }


def current_card_turn_authorization() -> str:
    secret = _internal_secret().encode("utf-8")
    now = int(time.time())
    kind = "card-runtime" if current_card_turn_context() else "catalog-reader"
    header = base64.urlsafe_b64encode(json.dumps(
        {"alg": "HS256", "typ": "JWT"}, separators=(",", ":"),
    ).encode("utf-8")).rstrip(b"=").decode("ascii")
    payload = base64.urlsafe_b64encode(json.dumps({
        "iss": "liquidaity-runtime",
        "aud": "liquidaity-internal-mcp",
        "sub": kind,
        "iat": now,
        "exp": now + 300,
        "scope": "liquidaity.main",
        "principal": {"kind": kind},
    }, separators=(",", ":")).encode("utf-8")).rstrip(b"=").decode("ascii")
    unsigned = f"{header}.{payload}"
    signature = base64.urlsafe_b64encode(hmac.new(
        secret, unsigned.encode("ascii"), hashlib.sha256,
    ).digest()).rstrip(b"=").decode("ascii")
    return f"Bearer {unsigned}.{signature}"


def current_card_turn_context() -> dict[str, str] | None:
    current = _CURRENT_CARD_TURN.get()
    if current:
        return dict(current)
    raw = str(os.environ.get(_CARD_TURN_ENV) or "").strip()
    if not raw:
        return None
    try:
        payload = json.loads(raw)
    except (TypeError, ValueError):
        return None
    if not isinstance(payload, dict):
        return None
    context = normalize_card_turn_context(payload.get("context"))
    run_id = str(payload.get("run_id") or "").strip()
    if context is None or not _RUN_ID.fullmatch(run_id):
        return None
    return {
        **context,
        "run_id": run_id,
        "externally_managed": (
            "true" if payload.get("externally_managed") is True else "false"
        ),
    }


def saved_card_turn_environment(
    context: dict[str, str],
    run_id: str,
) -> dict[str, str]:
    """Serialize one validated process-scoped Card Run binding for a Team root."""

    normalized = normalize_card_turn_context(context)
    exact_run_id = str(run_id or "").strip()
    if normalized is None or not _RUN_ID.fullmatch(exact_run_id):
        raise ValueError("card_turn_environment_invalid")
    return {
        _CARD_TURN_ENV: json.dumps({
            "context": normalized,
            "run_id": exact_run_id,
            "externally_managed": True,
        }, separators=(",", ":")),
    }


def _internal_secret() -> str:
    secret = str(os.environ.get("LIQUIDAITY_INTERNAL_MCP_SECRET") or "").strip()
    if len(secret) < 32:
        raise RuntimeError("card_turn_internal_secret_unavailable")
    return secret


def _post(context: dict[str, str], action: str, payload: dict[str, Any]) -> dict[str, Any]:
    request = Request(
        context["endpoint"],
        data=json.dumps({
            "action": action,
            "projectId": context["project_id"],
            "deckId": context["deck_id"],
            "conversationId": context["conversation_id"],
            "cardId": context["card_id"],
            "profile": context["profile"],
            **payload,
        }, ensure_ascii=False, separators=(",", ":")).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "X-LiquidAIty-Internal-MCP-Secret": _internal_secret(),
        },
        method="POST",
    )
    try:
        with urlopen(request, timeout=300) as response:  # noqa: S310 - validated HTTPS/loopback only
            result = json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        try:
            failure = json.loads(error.read().decode("utf-8"))
        except (OSError, UnicodeDecodeError, ValueError):
            failure = {}
        detail = str(failure.get("error") or f"card_turn_{action}_unavailable") \
            if isinstance(failure, dict) else f"card_turn_{action}_unavailable"
        raise RuntimeError(detail) from error
    except Exception as error:
        raise RuntimeError(f"card_turn_{action}_unavailable") from error
    if not isinstance(result, dict) or result.get("ok") is not True:
        error = str(result.get("error") or f"card_turn_{action}_failed") if isinstance(result, dict) else ""
        raise RuntimeError(error or f"card_turn_{action}_failed")
    return result


def _images(image_paths: list[str] | None) -> list[dict[str, str]]:
    paths = list(image_paths or [])
    if len(paths) > _MAX_IMAGES:
        raise RuntimeError("card_turn_images_limit_exceeded")
    total = 0
    projected: list[dict[str, str]] = []
    for value in paths:
        path = Path(str(value)).resolve()
        media_type = mimetypes.guess_type(path.name)[0] or ""
        if media_type not in {"image/png", "image/jpeg", "image/webp", "image/gif"}:
            raise RuntimeError("card_turn_image_type_unsupported")
        data = path.read_bytes()
        total += len(data)
        if total > _MAX_IMAGE_BYTES:
            raise RuntimeError("card_turn_images_too_large")
        projected.append({
            "name": path.name,
            "dataUrl": f"data:{media_type};base64,{base64.b64encode(data).decode('ascii')}",
        })
    return projected


def _sender_profile(turn_author: dict | None) -> str:
    author_id = str((turn_author or {}).get("id") or "")
    if not author_id.startswith("bot:"):
        return ""
    profile = author_id.removeprefix("bot:").strip().lower()
    return profile if _PROFILE.fullmatch(profile) else ""


def prepare_saved_card_turn(
    session: dict,
    message: Any,
    *,
    submission_id: str | None,
    originating_run_id: str | None,
    turn_author: dict | None,
    image_paths: list[str] | None,
) -> dict[str, Any] | None:
    context = normalize_card_turn_context(session.get("card_turn_context"))
    if context is None:
        return None
    if not isinstance(message, str) or not message.strip():
        raise RuntimeError("card_turn_message_required")
    run_id = str(submission_id or "").strip()
    if not _RUN_ID.fullmatch(run_id):
        run_id = f"req_{uuid4().hex[:16]}"
    parent_run_id = str(originating_run_id or "").strip()
    if parent_run_id and not _RUN_ID.fullmatch(parent_run_id):
        raise RuntimeError("card_parent_run_identity_invalid")
    result = _post(context, "prepare", {
        "runId": run_id,
        "originatingRunId": parent_run_id,
        "message": message,
        "images": _images(image_paths),
        "senderProfile": _sender_profile(turn_author),
    })
    if (
        str(result.get("runId") or "") != run_id
        or str(result.get("cardId") or "") != context["card_id"]
        or str(result.get("profile") or "").lower() != context["profile"].lower()
        or not str(result.get("message") or "").strip()
    ):
        raise RuntimeError("card_turn_preparation_identity_mismatch")
    return {**result, "context": context}


def start_saved_card_turn(prepared: dict[str, Any], session_key: str) -> None:
    _post(prepared["context"], "start", {
        "runId": prepared["runId"],
        "submissionId": prepared["runId"],
        "hermesSessionRef": session_key,
    })


def finish_saved_card_turn(
    prepared: dict[str, Any],
    *,
    session_key: str,
    state: str,
    final_result: Any = None,
    error: str = "",
    provider: str = "",
    model: str = "",
    usage: Any = None,
    tool_call_count: int | None = None,
) -> None:
    _post(prepared["context"], "finish", {
        "runId": prepared["runId"],
        "state": state,
        "finalResult": final_result,
        "errorCode": "hermes_turn_failed" if state == "failed" else None,
        "errorSummary": error or None,
        "hermesSessionRef": session_key,
        "providerTurnRef": prepared["runId"],
        "provider": provider,
        "model": model,
        "usage": usage if isinstance(usage, dict) else {},
        "toolCallCount": tool_call_count,
    })


def count_tool_calls(result: Any, agent: Any = None) -> int:
    messages = result.get("messages") if isinstance(result, dict) else None
    if not isinstance(messages, list):
        direct = 0
    else:
        direct = sum(
            len(message.get("tool_calls") or [])
            for message in messages
            if isinstance(message, dict) and isinstance(message.get("tool_calls"), list)
        )
    nested = getattr(agent, "_card_script_nested_tool_calls", 0)
    return direct + (nested if isinstance(nested, int) and nested > 0 else 0)
