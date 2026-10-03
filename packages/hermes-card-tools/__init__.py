"""Native Hermes tools backed by the authenticated saved Card runtime."""

from __future__ import annotations

import hashlib
import hmac
import ipaddress
import json
import math
import os
import queue
import re
import secrets
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path
from datetime import datetime, timezone
from typing import Any, Callable
from urllib.parse import urlparse


PLUGIN_KEY = "card-tools"
TOOLSET = "card-tools"
REQUEST_TTL_SECONDS = 300
MAX_REQUEST_BYTES = 512 * 1024
MAX_RESPONSE_BYTES = 2 * 1024 * 1024
VISIBLE_CARD_TARGETS_SECTION = "card-tools.visible-card-targets"
VISIBLE_CARD_TARGETS_MAX_CHARS = 4_000
PROJECT_ROSTER_TOOL = "project_roster.resolve"
RUNTIME_OBSERVATION_TOOL = "runtime.observe_attempt"
OBSERVATION_QUEUE_LIMIT = 256
OBSERVATION_RECORD_LIMIT_BYTES = 32_000
OBSERVATION_RESPONSE_LIMIT_BYTES = 64 * 1024
OBSERVATION_DELIVERY_TIMEOUT_SECONDS = 0.5
OBSERVATION_BATCH_LIMIT = 1
OBSERVATION_RETRY_LIMIT = 0
_VISIBLE_CARD_TITLE_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$", re.ASCII)
_WORKER_AUTH_ENV = (
    "HERMES_KANBAN_TASK",
    "HERMES_KANBAN_RUN_ID",
    "HERMES_KANBAN_CLAIM_LOCK",
    "HERMES_PROFILE",
)
_OBSERVATION_QUEUE: "queue.Queue[tuple[str, str, str, int, dict[str, Any]]]" = queue.Queue(
    maxsize=OBSERVATION_QUEUE_LIMIT
)
_OBSERVATION_THREAD: threading.Thread | None = None
_OBSERVATION_LOCK = threading.Lock()
_OBSERVATION_QUEUE_DROPPED = 0
_OBSERVATION_DELIVERY_FAILURES = 0
_OBSERVATION_WORKER_START_FAILURES = 0
_OBSERVATION_DELIVERED = 0
_OBSERVATION_QUEUE_LAG_COUNT = 0
_OBSERVATION_QUEUE_LAG_TOTAL_NS = 0
_OBSERVATION_QUEUE_LAG_MAX_NS = 0
_OBSERVATION_WORKER_STARTUP_NS: int | None = None


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _failure(code: str) -> str:
    return _json({"ok": False, "error": code})


def _bounded_text(value: Any, limit: int) -> str | None:
    if not isinstance(value, str):
        return None
    bounded = value[:limit].strip()
    return bounded or None


def _safe_number(value: Any, *, integer: bool = False) -> int | float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    number = float(value)
    if not math.isfinite(number) or number < 0:
        return None
    return int(number) if integer else number


def _iso_time(value: Any = None) -> str:
    seconds = value if isinstance(value, (int, float)) and math.isfinite(float(value)) else time.time()
    return datetime.fromtimestamp(float(seconds), timezone.utc).isoformat().replace("+00:00", "Z")


def _usage_cost(attempt: dict[str, Any]) -> dict[str, Any]:
    fields: dict[str, Any] = {}
    try:
        from agent.usage_pricing import CanonicalUsage, estimate_usage_cost

        canonical = CanonicalUsage(
            input_tokens=int(attempt.get("inputTokens", 0)),
            output_tokens=int(attempt.get("outputTokens", 0)),
            cache_read_tokens=int(attempt.get("cachedTokens", 0)),
            cache_write_tokens=int(attempt.get("cacheWriteTokens", 0)),
            reasoning_tokens=int(attempt.get("reasoningTokens", 0)),
        )
        cost = estimate_usage_cost(
            str(attempt.get("model") or ""), canonical,
            provider=str(attempt.get("provider") or ""), base_url="",
        )
        fields.update({
            "costStatus": cost.status,
            "costSource": cost.source,
            **({"costUsd": float(cost.amount_usd)} if cost.amount_usd is not None else {}),
            **({"pricingVersion": cost.pricing_version} if cost.pricing_version else {}),
        })
    except Exception:
        fields.update({"costStatus": "unknown", "costSource": "none"})
    return fields


def _llm_attempt(context: dict[str, Any], *, failed: bool) -> dict[str, Any] | None:
    attempt_id = _bounded_text(context.get("api_request_id"), 512)
    if not attempt_id:
        return None
    retry_count = _safe_number(context.get("retry_count"), integer=True)
    suffix = f"failed:{retry_count or 0}" if failed else "completed"
    started_at = _safe_number(context.get("started_at"))
    ended_at = _safe_number(context.get("ended_at"))
    duration_ms = _safe_number(context.get("api_duration"))
    first_chunk_at = _safe_number(context.get("first_chunk_at"))
    attempt: dict[str, Any] = {
        "eventId": f"llm:{attempt_id}:{suffix}"[:512],
        "attemptId": attempt_id,
        "kind": "llm",
        "phase": "failed" if failed else "completed",
        "provider": _bounded_text(context.get("provider"), 256),
        "model": _bounded_text(context.get("response_model"), 256)
            or _bounded_text(context.get("model"), 256),
        "apiMode": _bounded_text(context.get("api_mode"), 128),
        "apiCallCount": _safe_number(context.get("api_call_count"), integer=True),
        "retryCount": retry_count,
        "turnId": _bounded_text(context.get("turn_id"), 512),
        "estimatedInputTokens": _safe_number(context.get("approx_input_tokens"), integer=True),
        "redaction": "metadata_only_references_unavailable",
        "_observedAtSeconds": ended_at if ended_at is not None else time.time(),
    }
    if started_at is not None:
        attempt["_startedAtSeconds"] = started_at
    if ended_at is not None:
        attempt["_endedAtSeconds"] = ended_at
    if duration_ms is not None:
        attempt["durationMs"] = duration_ms * 1000
    if started_at is not None and first_chunk_at is not None and first_chunk_at >= started_at:
        attempt["firstTokenMs"] = (first_chunk_at - started_at) * 1000
    if failed:
        error = context.get("error") if isinstance(context.get("error"), dict) else {}
        attempt.update({
            "status": "error",
            "errorType": _bounded_text(error.get("type"), 128),
            "errorMessage": _bounded_text(error.get("message"), 512),
            "retryable": context.get("retryable") if isinstance(context.get("retryable"), bool) else None,
        })
    else:
        usage = context.get("usage") if isinstance(context.get("usage"), dict) else {}
        attempt.update({
            "status": "ok",
            **{
                key: value for key, value in {
                    "inputTokens": _safe_number(usage.get("input_tokens"), integer=True),
                    "outputTokens": _safe_number(usage.get("output_tokens"), integer=True),
                    "cachedTokens": _safe_number(usage.get("cache_read_tokens"), integer=True),
                    "cacheWriteTokens": _safe_number(usage.get("cache_write_tokens"), integer=True),
                    "reasoningTokens": _safe_number(usage.get("reasoning_tokens"), integer=True),
                    "totalTokens": _safe_number(usage.get("total_tokens"), integer=True),
                }.items() if value is not None
            },
        })
    return {key: value for key, value in attempt.items() if value is not None}


def _tool_attempt(context: dict[str, Any]) -> dict[str, Any] | None:
    attempt_id = _bounded_text(context.get("tool_call_id"), 512)
    name = _bounded_text(context.get("tool_name"), 256)
    if not attempt_id or not name:
        return None
    status = _bounded_text(context.get("status"), 64) or "unknown"
    phase = "completed" if status == "ok" else (
        "cancelled" if status == "cancelled" else "failed"
    )
    attempt = {
        "eventId": f"tool:{attempt_id}:{phase}"[:512],
        "attemptId": attempt_id,
        "kind": "tool",
        "phase": phase,
        "turnId": _bounded_text(context.get("turn_id"), 512),
        "toolName": name,
        "toolCallId": attempt_id,
        "durationMs": _safe_number(context.get("duration_ms")),
        "status": status,
        "errorType": _bounded_text(context.get("error_type"), 128),
        "errorMessage": _bounded_text(context.get("error_message"), 512),
        "redaction": "metadata_only_references_unavailable",
        "_observedAtSeconds": time.time(),
    }
    return {key: value for key, value in attempt.items() if value is not None}


def _post_observation_once(host_url: str, envelope: dict[str, str]) -> bool:
    if not _is_loopback_url(host_url):
        return False
    body = _json(envelope).encode("utf-8")
    if len(body) > MAX_REQUEST_BYTES:
        return False
    request = urllib.request.Request(
        host_url, data=body, headers={"Content-Type": "application/json"}, method="POST",
    )
    try:
        with urllib.request.build_opener(_NoRedirect()).open(
            request, timeout=OBSERVATION_DELIVERY_TIMEOUT_SECONDS,
        ) as response:
            response.read(OBSERVATION_RESPONSE_LIMIT_BYTES)
            return 200 <= int(response.status) < 300
    except Exception:
        return False


def _prepare_delivery_attempt(attempt: dict[str, Any]) -> dict[str, Any]:
    prepared = {key: value for key, value in attempt.items() if not key.startswith("_")}
    prepared["observedAt"] = _iso_time(attempt.get("_observedAtSeconds"))
    if attempt.get("_startedAtSeconds") is not None:
        prepared["startedAt"] = _iso_time(attempt["_startedAtSeconds"])
    if attempt.get("_endedAtSeconds") is not None:
        prepared["endedAt"] = _iso_time(attempt["_endedAtSeconds"])
    gap_total = (
        _OBSERVATION_QUEUE_DROPPED
        + _OBSERVATION_DELIVERY_FAILURES
        + _OBSERVATION_WORKER_START_FAILURES
    )
    if gap_total:
        prepared["observationGap"] = gap_total
    return prepared


def _process_observation_item(
    item: tuple[str, str, str, int, dict[str, Any]],
) -> bool:
    global _OBSERVATION_DELIVERY_FAILURES, _OBSERVATION_DELIVERED
    global _OBSERVATION_QUEUE_LAG_COUNT, _OBSERVATION_QUEUE_LAG_TOTAL_NS
    global _OBSERVATION_QUEUE_LAG_MAX_NS
    host_url, token, session_id, captured_ns, attempt = item
    lag_ns = max(0, time.perf_counter_ns() - captured_ns)
    _OBSERVATION_QUEUE_LAG_COUNT += 1
    _OBSERVATION_QUEUE_LAG_TOTAL_NS += lag_ns
    _OBSERVATION_QUEUE_LAG_MAX_NS = max(_OBSERVATION_QUEUE_LAG_MAX_NS, lag_ns)
    try:
        delivered = _deliver_observation(host_url, token, session_id, attempt)
    except Exception:
        delivered = False
    if delivered:
        _OBSERVATION_DELIVERED += 1
    else:
        _OBSERVATION_DELIVERY_FAILURES += 1
    return delivered


def _observation_worker() -> None:
    while True:
        for _index in range(OBSERVATION_BATCH_LIMIT):
            item = _OBSERVATION_QUEUE.get()
            try:
                _process_observation_item(item)
            finally:
                _OBSERVATION_QUEUE.task_done()


def _deliver_observation(
    host_url: str,
    token: str,
    session_id: str,
    attempt: dict[str, Any],
) -> bool:
    prepared = _prepare_delivery_attempt(attempt)
    if prepared.get("kind") == "llm" and prepared.get("phase") == "completed":
        prepared = {**prepared, **_usage_cost(prepared)}
    if len(_json(prepared).encode("utf-8")) > OBSERVATION_RECORD_LIMIT_BYTES:
        return False
    payload = _json({
        "version": 1,
        "expiresAt": int(time.time()) + REQUEST_TTL_SECONDS,
        "nonce": secrets.token_hex(16),
        "sourceStoredSessionId": session_id,
        "tool": RUNTIME_OBSERVATION_TOOL,
        "arguments": {"attempt": prepared},
    })
    return _post_observation_once(host_url, _signed_envelope(token, payload))


def _ensure_observation_worker() -> None:
    global _OBSERVATION_THREAD, _OBSERVATION_WORKER_STARTUP_NS
    global _OBSERVATION_WORKER_START_FAILURES
    if os.getenv("CARD_TOOLS_MANAGED") != "1":
        return
    if not os.getenv("CARD_TOOLS_HOST_URL", "").strip():
        return
    if not os.getenv("HERMES_DASHBOARD_SESSION_TOKEN", ""):
        return
    if any(os.getenv(name, "").strip() for name in _WORKER_AUTH_ENV):
        return
    if _OBSERVATION_THREAD is not None and _OBSERVATION_THREAD.is_alive():
        return
    with _OBSERVATION_LOCK:
        if _OBSERVATION_THREAD is None or not _OBSERVATION_THREAD.is_alive():
            started_ns = time.perf_counter_ns()
            try:
                thread = threading.Thread(
                    target=_observation_worker,
                    name="card-runtime-observer",
                    daemon=True,
                )
                thread.start()
                _OBSERVATION_THREAD = thread
                _OBSERVATION_WORKER_STARTUP_NS = time.perf_counter_ns() - started_ns
            except Exception:
                _OBSERVATION_THREAD = None
                _OBSERVATION_WORKER_STARTUP_NS = time.perf_counter_ns() - started_ns
                _OBSERVATION_WORKER_START_FAILURES += 1


def _observation_destination(session_id: Any) -> tuple[str, str, str] | None:
    if os.getenv("CARD_TOOLS_MANAGED") != "1":
        return None
    bounded_session_id = _bounded_text(session_id, 512)
    if not bounded_session_id:
        return None
    if any(os.getenv(name, "").strip() for name in _WORKER_AUTH_ENV):
        # Detached Magnetic workers have native task receipts but no Gateway Run
        # session authority. Never misattribute their calls to the outer Run.
        return None
    host_url = os.getenv("CARD_TOOLS_HOST_URL", "").strip()
    token = os.getenv("HERMES_DASHBOARD_SESSION_TOKEN", "")
    if not host_url or not token:
        return None
    return host_url, token, bounded_session_id


def _enqueue_observation(
    destination: tuple[str, str, str],
    attempt: dict[str, Any] | None,
    *,
    captured_ns: int,
) -> None:
    global _OBSERVATION_QUEUE_DROPPED, _OBSERVATION_WORKER_START_FAILURES
    if not attempt:
        return
    thread = _OBSERVATION_THREAD
    if thread is None or not thread.is_alive():
        _OBSERVATION_WORKER_START_FAILURES += 1
        return
    try:
        host_url, token, session_id = destination
        _OBSERVATION_QUEUE.put_nowait((host_url, token, session_id, captured_ns, attempt))
    except queue.Full:
        _OBSERVATION_QUEUE_DROPPED += 1


def _capture_observation(
    context: dict[str, Any],
    builder: Callable[[dict[str, Any]], dict[str, Any] | None],
) -> None:
    destination = _observation_destination(context.get("session_id"))
    if destination is None:
        return
    captured_ns = time.perf_counter_ns()
    _enqueue_observation(destination, builder(context), captured_ns=captured_ns)


def _observe_post_api_request(**context: Any) -> None:
    _capture_observation(context, lambda values: _llm_attempt(values, failed=False))


def _observe_api_request_error(**context: Any) -> None:
    _capture_observation(context, lambda values: _llm_attempt(values, failed=True))


def _observe_post_tool_call(**context: Any) -> None:
    _capture_observation(context, _tool_attempt)


def _observation_stats() -> dict[str, int | None]:
    return {
        "queueCapacity": _OBSERVATION_QUEUE.maxsize,
        "queueDepth": _OBSERVATION_QUEUE.qsize(),
        "queueDropped": _OBSERVATION_QUEUE_DROPPED,
        "deliveryFailures": _OBSERVATION_DELIVERY_FAILURES,
        "workerStartFailures": _OBSERVATION_WORKER_START_FAILURES,
        "delivered": _OBSERVATION_DELIVERED,
        "queueLagSamples": _OBSERVATION_QUEUE_LAG_COUNT,
        "queueLagCumulativeNs": _OBSERVATION_QUEUE_LAG_TOTAL_NS,
        "queueLagMaxNs": _OBSERVATION_QUEUE_LAG_MAX_NS,
        "workerStartupNs": _OBSERVATION_WORKER_STARTUP_NS,
        "batchLimit": OBSERVATION_BATCH_LIMIT,
        "retryLimit": OBSERVATION_RETRY_LIMIT,
    }


def _is_loopback_url(value: str) -> bool:
    try:
        parsed = urlparse(value)
        if parsed.scheme != "http" or parsed.username or parsed.password or parsed.fragment:
            return False
        host = parsed.hostname
        if not host:
            return False
        return host.lower() == "localhost" or ipaddress.ip_address(host).is_loopback
    except (TypeError, ValueError):
        return False


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise urllib.error.HTTPError(req.full_url, code, "redirect refused", headers, fp)


def _post_once(host_url: str, envelope: dict[str, str]) -> tuple[int, dict[str, Any]]:
    if not _is_loopback_url(host_url):
        raise ValueError("host URL must be loopback HTTP")
    body = _json(envelope).encode("utf-8")
    if len(body) > MAX_REQUEST_BYTES:
        raise ValueError("tool request exceeds the input limit")
    request = urllib.request.Request(
        host_url,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    opener = urllib.request.build_opener(_NoRedirect())
    try:
        response = opener.open(request)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        raw = response.read(MAX_RESPONSE_BYTES + 1)
        if len(raw) > MAX_RESPONSE_BYTES:
            raise ValueError("tool response exceeds the output limit")
        value = json.loads(raw.decode("utf-8"))
        if not isinstance(value, dict):
            raise ValueError("tool response must be an object")
        return int(response.status), value


def _load_tools(config_path: Path | None = None) -> list[dict[str, Any]]:
    path = config_path or Path(__file__).with_name("tools.json")
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict) or set(value) != {"tools"} or not isinstance(value["tools"], list):
        raise ValueError("card_tools_configuration_invalid")
    tools: list[dict[str, Any]] = []
    names: set[str] = set()
    for raw in value["tools"]:
        if not isinstance(raw, dict) or set(raw) != {
            "canonicalName", "hermesName", "description", "inputSchema",
        }:
            raise ValueError("card_tools_configuration_invalid")
        canonical_name = raw["canonicalName"]
        hermes_name = raw["hermesName"]
        description = raw["description"]
        schema = raw["inputSchema"]
        if (
            not isinstance(canonical_name, str) or not canonical_name
            or not isinstance(hermes_name, str) or not hermes_name
            or not isinstance(description, str)
            or not isinstance(schema, dict)
            or hermes_name in names
        ):
            raise ValueError("card_tools_configuration_invalid")
        names.add(hermes_name)
        tools.append({
            "canonicalName": canonical_name,
            "hermesName": hermes_name,
            "description": description,
            "inputSchema": schema,
        })
    return tools


def _signed_envelope(secret: str, payload: str) -> dict[str, str]:
    secret_bytes = secret.encode("utf-8")
    return {
        "keyId": hashlib.sha256(secret_bytes).hexdigest(),
        "payload": payload,
        "signature": hmac.new(
            secret_bytes,
            payload.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest(),
    }


def _worker_envelope(
    hermes_name: str,
    args: dict[str, Any],
) -> tuple[dict[str, str] | None, str | None]:
    """Build the detached native worker envelope, or report its exact env failure.

    A dispatcher claim is an all-or-nothing capability.  Never fall back to the
    persistent Gateway credential when only part of the native worker identity is
    present, and never put that Gateway credential or a Bot Chat session id in the
    worker payload.
    """
    values = {name: os.getenv(name, "").strip() for name in _WORKER_AUTH_ENV}
    present = {name for name, value in values.items() if value}
    if not present:
        return None, None
    if len(present) != len(_WORKER_AUTH_ENV):
        return None, "card_tool_worker_identity_incomplete"
    try:
        source_run_id = int(values["HERMES_KANBAN_RUN_ID"])
    except ValueError:
        return None, "card_tool_worker_identity_invalid"
    if source_run_id <= 0:
        return None, "card_tool_worker_identity_invalid"
    payload = _json({
        "version": 2,
        "expiresAt": int(time.time()) + REQUEST_TTL_SECONDS,
        "nonce": secrets.token_hex(16),
        "sourceTaskId": values["HERMES_KANBAN_TASK"],
        "sourceTaskRunId": source_run_id,
        "sourceProfile": values["HERMES_PROFILE"],
        "tool": hermes_name,
        "arguments": args,
    })
    return _signed_envelope(values["HERMES_KANBAN_CLAIM_LOCK"], payload), None


def _invoke(hermes_name: str, args: Any, *, task_id: str) -> str:
    if os.getenv("CARD_TOOLS_MANAGED") != "1":
        return _failure("managed_card_runtime_required")
    if not isinstance(args, dict):
        return _failure("card_tool_arguments_invalid")
    host_url = os.getenv("CARD_TOOLS_HOST_URL", "").strip()
    if not host_url:
        return _failure("card_tool_host_url_missing")
    worker_envelope, worker_error = _worker_envelope(hermes_name, args)
    if worker_error:
        return _failure(worker_error)
    if worker_envelope is not None:
        envelope = worker_envelope
    else:
        token = os.getenv("HERMES_DASHBOARD_SESSION_TOKEN", "")
        if not token:
            return _failure("card_tool_gateway_credential_missing")
        if not task_id:
            return _failure("card_tool_runtime_identity_missing")
        payload = _json({
            "version": 1,
            "expiresAt": int(time.time()) + REQUEST_TTL_SECONDS,
            "nonce": secrets.token_hex(16),
            "sourceStoredSessionId": task_id,
            "tool": hermes_name,
            "arguments": args,
        })
        envelope = _signed_envelope(token, payload)
    try:
        status, response = _post_once(host_url, envelope)
    except Exception:
        return _failure("card_tool_host_unavailable")
    output = response.get("output")
    if status != 200 or response.get("ok") is not True or not isinstance(output, str):
        return _failure(str(response.get("error") or "card_tool_execution_failed"))
    return output


def _handler(hermes_name: str) -> Callable[..., str]:
    def invoke(args: Any, **context: Any) -> str:
        return _invoke(
            hermes_name,
            args,
            # Gateway supplies its durable ``session_key`` as the turn task_id.
            # ``session_id`` is the mutable AIAgent continuation identity and may
            # rotate during compression while this turn is still dispatching.
            task_id=str(context.get("task_id") or ""),
        )

    return invoke


def _request_project_roster_payload(
    source_stored_session_id: str,
    arguments: dict[str, Any],
) -> dict[str, Any]:
    """Resolve the current Project roster through the signed Card-session seam.

    The backend owns Project/deck/Card topology.  The plugin supplies only the exact
    Hermes stored-session identity and never reads or unions profile-global config.
    """
    if os.getenv("CARD_TOOLS_MANAGED") != "1" or not source_stored_session_id:
        raise ValueError("managed project session required")
    host_url = os.getenv("CARD_TOOLS_HOST_URL", "").strip()
    token = os.getenv("HERMES_DASHBOARD_SESSION_TOKEN", "")
    if not host_url or not token:
        raise ValueError("managed project session credential missing")
    payload = _json({
        "version": 1,
        "expiresAt": int(time.time()) + REQUEST_TTL_SECONDS,
        "nonce": secrets.token_hex(16),
        "sourceStoredSessionId": source_stored_session_id,
        "tool": PROJECT_ROSTER_TOOL,
        "arguments": arguments,
    })
    status, response = _post_once(host_url, _signed_envelope(token, payload))
    output = response.get("output")
    if status != 200 or response.get("ok") is not True or not isinstance(output, str):
        raise ValueError("project roster unavailable")
    decoded = json.loads(output)
    if not isinstance(decoded, dict):
        raise ValueError("project roster response invalid")
    return decoded


def _validated_project_roster(decoded: dict[str, Any]) -> list[tuple[str, str]]:
    raw_targets = decoded["targets"]
    if not isinstance(raw_targets, list):
        raise ValueError("project roster response invalid")
    targets: list[tuple[str, str]] = []
    seen_titles: set[str] = set()
    seen_profiles: set[str] = set()
    for raw in raw_targets:
        if not isinstance(raw, dict) or set(raw) != {"profile", "title"}:
            raise ValueError("project roster response invalid")
        title, profile = raw.get("title"), raw.get("profile")
        if (
            not isinstance(title, str) or not _VISIBLE_CARD_TITLE_RE.fullmatch(title)
            or not isinstance(profile, str)
            or not re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,63}", profile, re.ASCII)
            or title.casefold() in seen_titles
            or profile in seen_profiles
        ):
            raise ValueError("project roster response invalid")
        seen_titles.add(title.casefold())
        seen_profiles.add(profile)
        targets.append((title, profile))
    return targets


def _request_project_roster(source_stored_session_id: str) -> list[tuple[str, str]]:
    decoded = _request_project_roster_payload(source_stored_session_id, {})
    if set(decoded) != {"targets"}:
        raise ValueError("project roster response invalid")
    return _validated_project_roster(decoded)


def _request_project_target(
    source_stored_session_id: str,
    visible_target: str,
) -> tuple[list[tuple[str, str]], str, str]:
    decoded = _request_project_roster_payload(
        source_stored_session_id, {"target": visible_target},
    )
    if set(decoded) != {"resolved", "targets"} or not isinstance(decoded["resolved"], dict):
        raise ValueError("project roster response invalid")
    targets = _validated_project_roster(decoded)
    resolved = decoded["resolved"]
    if set(resolved) != {"profile", "storedSessionId"}:
        raise ValueError("project roster response invalid")
    profile, stored_session_id = resolved.get("profile"), resolved.get("storedSessionId")
    if (
        not isinstance(profile, str)
        or profile not in {target_profile for _title, target_profile in targets}
        or not isinstance(stored_session_id, str)
        or not stored_session_id
        or len(stored_session_id) > 512
    ):
        raise ValueError("project roster response invalid")
    return targets, profile, stored_session_id


def _visible_card_targets(source_stored_session_id: str | None) -> list[tuple[str, str]]:
    """Return exact ``(visible title, stable profile)`` pairs for one Project session."""
    if not source_stored_session_id:
        return []
    try:
        return _request_project_roster(source_stored_session_id)
    except Exception:
        return []


def _resolve_message_agent_target(
    *,
    target: Any = None,
    session_id: str = "",
    **_context: Any,
) -> dict[str, Any]:
    """Resolve one visible Card title through one authenticated Project session."""
    if not isinstance(target, str) or not session_id:
        raise ValueError("project roster request invalid")
    visible_target = target.strip()
    if visible_target.startswith("@"):
        visible_target = visible_target[1:]
    if not visible_target:
        raise ValueError("project roster request invalid")
    targets, stable_profile, stored_session_id = _request_project_target(
        session_id, visible_target,
    )
    return {
        "profile": stable_profile,
        "roster": [profile for _title, profile in targets],
        "stored_session_id": stored_session_id,
    }


def _visible_card_targets_prompt(source_stored_session_id: str | None) -> str:
    """Render only exact public Card addresses; stable runtime identities stay private."""
    targets = _visible_card_targets(source_stored_session_id)
    if not targets:
        return ""
    prompt = (
        "Use `message_agent` with one of these exact visible saved-Card addresses:\n"
        + "\n".join(f"- `@{title}`" for title, _stable_profile in targets)
    )
    return prompt if len(prompt) <= VISIBLE_CARD_TARGETS_MAX_CHARS else ""


def register(ctx: Any) -> None:
    for tool in _load_tools():
        ctx.register_tool(
            name=tool["hermesName"],
            toolset=TOOLSET,
            schema={
                "name": tool["hermesName"],
                "description": tool["description"],
                "parameters": tool["inputSchema"],
            },
            handler=_handler(tool["hermesName"]),
            description=tool["description"],
        )
    ctx.register_hook(
        "resolve_message_agent_target",
        _resolve_message_agent_target,
    )
    # Observer-only hooks capture fixed-size metadata and already-computed usage,
    # then perform one bounded put_nowait. Worker startup, JSON, pricing and HTTP
    # remain outside the Card's event path; raw request/tool bodies are ignored.
    ctx.register_hook("post_api_request", _observe_post_api_request)
    ctx.register_hook("api_request_error", _observe_api_request_error)
    ctx.register_hook("post_tool_call", _observe_post_tool_call)
    _ensure_observation_worker()
    ctx.register_system_prompt_section(
        VISIBLE_CARD_TARGETS_SECTION,
        lambda session_info: _visible_card_targets_prompt(
            str(session_info.get("session_id") or ""),
        ),
        max_chars=VISIBLE_CARD_TARGETS_MAX_CHARS,
    )
