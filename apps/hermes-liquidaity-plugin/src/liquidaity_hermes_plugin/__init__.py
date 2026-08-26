"""Card-scoped LiquidAIty MCP authorization for native Kanban workers.

The backend remains the only bearer issuer and saved-Card grant authority.
This provider sends bounded native claim identity over loopback and returns one
ephemeral value for the child process environment. It stores and logs neither
the bearer nor the Card configuration.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from typing import Mapping


_DEFAULT_ENDPOINT = "http://127.0.0.1:4000/api/internal/hermes-kanban/worker-bearer"
_TIMEOUT_SECONDS = 3.0
_MAX_RESPONSE_BYTES = 64 * 1024


def _endpoint() -> str:
    return os.environ.get(
        "LIQUIDAITY_HERMES_WORKER_BEARER_URL", _DEFAULT_ENDPOINT
    ).strip()


def _worker_environment(context) -> Mapping[str, str] | None:
    payload = json.dumps(
        {
            "taskId": context.task_id,
            "nativeRunId": context.run_id,
            "board": context.board,
            "assignee": context.assignee,
            "profile": context.profile,
            "workspace": context.workspace,
            "claimLock": context.claim_lock,
        },
        separators=(",", ":"),
    ).encode("utf-8")
    request = urllib.request.Request(
        _endpoint(),
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        with opener.open(request, timeout=_TIMEOUT_SECONDS) as response:
            body = response.read(_MAX_RESPONSE_BYTES + 1)
    except urllib.error.HTTPError as error:
        if error.code == 404:
            # An ordinary Hermes task with no LiquidAIty Card Run correlation
            # keeps the stock worker lane unchanged.
            return None
        raise RuntimeError(
            f"liquidaity_card_bearer_lookup_http_{error.code}"
        ) from error
    except (OSError, urllib.error.URLError) as error:
        raise RuntimeError("liquidaity_card_bearer_lookup_unavailable") from error

    if len(body) > _MAX_RESPONSE_BYTES:
        raise RuntimeError("liquidaity_card_bearer_lookup_response_too_large")
    try:
        decoded = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise RuntimeError("liquidaity_card_bearer_lookup_response_invalid") from error
    bearer = decoded.get("bearer") if isinstance(decoded, dict) else None
    if (
        decoded.get("ok") is not True
        or not isinstance(bearer, str)
        or not 64 <= len(bearer) <= 8192
        or any(character.isspace() for character in bearer)
    ):
        raise RuntimeError("liquidaity_card_bearer_lookup_response_invalid")
    return {"LIQUIDAITY_CARD_BEARER": bearer}


def register(ctx) -> None:
    ctx.register_kanban_worker_environment_provider(_worker_environment)

