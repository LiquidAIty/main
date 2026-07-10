"""Dev-only participant spans — Python rails → backend agent telemetry.

Emits one span per participant turn observed in OUR run_stream consumption
(magentic_agentchat.py — never vendored AutoGen code) to the backend's
dev-only /api/dev/agent-harness/span route, which records it as a
'participant_turn' telemetry event.

Rules:
 - never blocks and never raises: each POST runs on a daemon thread with a
   short timeout, and every failure is swallowed — a span is evidence, the
   run is the product;
 - dev-only twice over: this module refuses when NODE_ENV=production or
   LIQUIDAITY_DEV_SPANS=0, and the backend route itself 403s in production;
 - bounded + safe: output is summarized to 300 chars (the backend redacts and
   re-bounds), no hidden chain-of-thought, no secrets, no full prompts.
"""

from __future__ import annotations

import json
import os
import threading
from typing import Any
from urllib.request import Request, urlopen

_SUMMARY_MAX = 300


def _backend_base() -> str:
    return os.environ.get("LIQUIDAITY_BACKEND_URL", "http://127.0.0.1:4000").rstrip("/")


def spans_enabled() -> bool:
    if os.environ.get("NODE_ENV", "").strip().lower() == "production":
        return False
    return os.environ.get("LIQUIDAITY_DEV_SPANS", "1").strip() != "0"


def summarize(value: Any, max_length: int = _SUMMARY_MAX) -> str:
    text = " ".join(str(value or "").split())
    return text if len(text) <= max_length else text[: max_length - 3] + "..."


def build_participant_span(
    *,
    correlation_id: str,
    project_id: str,
    source: str,
    card_id: str | None,
    provider: str | None,
    model: str | None,
    output: str,
    duration_ms: int,
    turn_index: int,
    message_type: str,
) -> dict[str, Any]:
    """Pure span payload builder (unit-tested; emission is separate)."""
    return {
        "correlationId": correlation_id,
        "projectId": project_id,
        "cardId": card_id,
        "provider": provider,
        "model": model,
        "outputSummary": summarize(output),
        # Honest timing: arrival delta between streamed messages, not an
        # internal model latency the stream does not expose.
        "durationMs": max(0, int(duration_ms)),
        "metadata": {
            "source": source,
            "turnIndex": turn_index,
            "messageType": message_type,
            "timing": "stream_arrival_delta",
        },
    }


def emit_participant_span(payload: dict[str, Any]) -> None:
    """Fire-and-forget POST. Never blocks the run, never raises."""
    if not spans_enabled():
        return

    def _post() -> None:
        try:
            request = Request(
                f"{_backend_base()}/api/dev/agent-harness/span",
                data=json.dumps(payload).encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            urlopen(request, timeout=3).read()  # noqa: S310 — loopback backend only
        except Exception:
            pass  # dev telemetry must never disturb the run

    threading.Thread(target=_post, daemon=True).start()
