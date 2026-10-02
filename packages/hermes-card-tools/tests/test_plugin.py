from __future__ import annotations

import hashlib
import hmac
import importlib.util
import json
import queue
import statistics
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest


PLUGIN_DIR = Path(__file__).resolve().parents[1]


def _load_plugin():
    path = PLUGIN_DIR / "__init__.py"
    spec = importlib.util.spec_from_file_location("card_tools_plugin", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def plugin():
    return _load_plugin()


@pytest.fixture(autouse=True)
def _clear_environment(monkeypatch):
    for name in (
        "CARD_TOOLS_MANAGED",
        "CARD_TOOLS_HOST_URL",
        "HERMES_DASHBOARD_SESSION_TOKEN",
        "HERMES_KANBAN_TASK",
        "HERMES_KANBAN_RUN_ID",
        "HERMES_KANBAN_CLAIM_LOCK",
        "HERMES_PROFILE",
    ):
        monkeypatch.delenv(name, raising=False)


class RegistrationContext:
    def __init__(self):
        self.tools = []
        self.hooks = []
        self.prompt_sections = []

    def register_tool(self, **kwargs):
        self.tools.append(kwargs)

    def register_hook(self, name, callback):
        self.hooks.append((name, callback))

    def register_system_prompt_section(self, name, content, **kwargs):
        self.prompt_sections.append((name, content, kwargs))


class AliveThread:
    def is_alive(self):
        return True


def _configure_observer(plugin, monkeypatch, *, capacity=4):
    monkeypatch.setenv("CARD_TOOLS_MANAGED", "1")
    monkeypatch.setenv("CARD_TOOLS_HOST_URL", "http://127.0.0.1:4000/api/hermes-card-tools")
    monkeypatch.setenv("HERMES_DASHBOARD_SESSION_TOKEN", "secret-token")
    monkeypatch.setattr(plugin, "_OBSERVATION_QUEUE", queue.Queue(maxsize=capacity))
    monkeypatch.setattr(plugin, "_OBSERVATION_THREAD", AliveThread())


def _llm_context(**overrides):
    context = {
        "session_id": "stored-project-conversation",
        "turn_id": "turn-one",
        "api_request_id": "turn-one:api:1",
        "provider": "openai",
        "model": "gpt-5.6-sol",
        "response_model": "gpt-5.6-sol",
        "api_mode": "codex_responses",
        "api_call_count": 1,
        "retry_count": 0,
        "started_at": 1_000.0,
        "ended_at": 1_001.25,
        "first_chunk_at": 1_000.3,
        "api_duration": 1.25,
        "request": {"body": {"messages": [{"content": "private input"}]}},
        "response": {"assistant_message": {"content": "private output"}},
        "usage": {"input_tokens": 120, "output_tokens": 30, "total_tokens": 150},
    }
    context.update(overrides)
    return context


def _configure_roster(plugin, monkeypatch, entries):
    stored_session_id = "stored-project-conversation"
    profiles = [stable_profile for stable_profile, _title in entries]
    titles = {stable_profile: title for stable_profile, title in entries}
    def payload(actual_session, arguments):
        if actual_session != stored_session_id:
            raise ValueError("session mismatch")
        targets = [{"title": titles[profile], "profile": profile} for profile in profiles]
        if not arguments:
            return {"targets": targets}
        visible_target = arguments["target"]
        matches = [
            profile for profile in profiles
            if titles[profile].casefold() == visible_target.casefold()
        ]
        if len(matches) != 1:
            raise ValueError("message_agent target not authorized by project roster")
        return {
            "targets": targets,
            "resolved": {
                "profile": matches[0],
                "storedSessionId": f"stored-{matches[0]}",
            },
        }
    monkeypatch.setattr(plugin, "_request_project_roster_payload", payload)
    return stored_session_id, titles


def test_registers_exact_materialized_tools(plugin, monkeypatch):
    tools = [{
        "canonicalName": "card.create",
        "hermesName": "card__card_create",
        "description": "Create a saved Card.",
        "inputSchema": {"type": "object", "properties": {"title": {"type": "string"}}},
    }]
    monkeypatch.setattr(plugin, "_load_tools", lambda: tools)
    stored_session_id, _titles = _configure_roster(
        plugin, monkeypatch, [("builder_profile", "Builder")],
    )
    context = RegistrationContext()

    plugin.register(context)

    assert len(context.tools) == 1
    assert {key: value for key, value in context.tools[0].items() if key != "handler"} == {
        "name": "card__card_create",
        "toolset": "card-tools",
        "schema": {
            "name": "card__card_create",
            "description": "Create a saved Card.",
            "parameters": tools[0]["inputSchema"],
        },
        "description": "Create a saved Card.",
    }
    assert [name for name, _callback in context.hooks] == [
        "resolve_message_agent_target", "post_api_request", "api_request_error", "post_tool_call",
    ]
    assert context.hooks[0][1](
        target="@builder",
        session_id=stored_session_id,
    ) == {
        "profile": "builder_profile",
        "roster": ["builder_profile"],
        "stored_session_id": "stored-builder_profile",
    }
    assert len(context.prompt_sections) == 1
    section_name, render, options = context.prompt_sections[0]
    assert section_name == "card-tools.visible-card-targets"
    assert options == {"max_chars": 4_000}
    assert render({"session_id": stored_session_id}) == (
        "Use `message_agent` with one of these exact visible saved-Card addresses:\n"
        "- `@Builder`"
    )


def test_runtime_observer_queues_only_bounded_metadata_and_background_enriches(
    plugin, monkeypatch,
):
    _configure_observer(plugin, monkeypatch)
    monkeypatch.setattr(
        plugin,
        "_ensure_observation_worker",
        lambda: pytest.fail("first event must not start the worker"),
    )
    monkeypatch.setattr(plugin, "_usage_cost", lambda _context: {
        "costUsd": 0.0015, "costStatus": "estimated",
        "costSource": "official_docs_snapshot", "pricingVersion": "test-rates-v1",
    })
    posted = {}
    monkeypatch.setattr(
        plugin,
        "_post_observation_once",
        lambda host_url, envelope: posted.update(host_url=host_url, envelope=envelope) or True,
    )

    assert plugin._observe_post_api_request(**_llm_context()) is None

    host_url, token, session_id, _captured_ns, queued_attempt = plugin._OBSERVATION_QUEUE.get_nowait()
    assert host_url == "http://127.0.0.1:4000/api/hermes-card-tools"
    assert "costUsd" not in queued_attempt
    assert "requestHash" not in queued_attempt
    assert "responseHash" not in queued_attempt
    assert queued_attempt["redaction"] == "metadata_only_references_unavailable"
    assert len(json.dumps(plugin._prepare_delivery_attempt(queued_attempt)).encode("utf-8")) <= (
        plugin.OBSERVATION_RECORD_LIMIT_BYTES
    )
    assert plugin._deliver_observation(host_url, token, session_id, queued_attempt) is True
    envelope = posted["envelope"]
    decoded = json.loads(envelope["payload"])
    assert decoded["tool"] == "runtime.observe_attempt"
    attempt = decoded["arguments"]["attempt"]
    assert attempt["attemptId"] == "turn-one:api:1"
    assert attempt["durationMs"] == 1250.0
    assert attempt["firstTokenMs"] == pytest.approx(300.0)
    assert attempt["inputTokens"] == 120
    assert attempt["costStatus"] == "estimated"
    serialized = json.dumps(attempt)
    assert "private input" not in serialized
    assert "private output" not in serialized
    assert "requestHash" not in attempt
    assert "responseHash" not in attempt
    assert attempt["redaction"] == "metadata_only_references_unavailable"


def test_runtime_observer_never_reads_or_serializes_large_bodies(plugin, monkeypatch):
    _configure_observer(plugin, monkeypatch)
    huge = "x" * 8_000_000
    body = {"huge": huge}
    result = {"huge": huge}
    monkeypatch.setattr(
        plugin.json,
        "dumps",
        lambda *_args, **_kwargs: pytest.fail("capture path must not serialize"),
    )
    monkeypatch.setattr(
        plugin,
        "_usage_cost",
        lambda *_args: pytest.fail("capture path must not price usage"),
    )
    monkeypatch.setattr(
        plugin,
        "_post_observation_once",
        lambda *_args: pytest.fail("capture path must not perform HTTP"),
    )

    plugin._observe_post_api_request(**_llm_context(request=body, response=result))
    llm_item = plugin._OBSERVATION_QUEUE.get_nowait()
    plugin._observe_post_tool_call(
        session_id="stored-project-conversation",
        turn_id="turn-one",
        tool_call_id="tool-one",
        tool_name="large_tool",
        args=body,
        result=result,
        duration_ms=10,
        status="ok",
    )
    tool_item = plugin._OBSERVATION_QUEUE.get_nowait()

    assert llm_item[4]["attemptId"] == "turn-one:api:1"
    assert tool_item[4]["attemptId"] == "tool-one"
    assert not ({"requestHash", "responseHash", "requestBytes", "responseBytes"} & llm_item[4].keys())
    assert not ({"argumentsHash", "resultHash", "argumentsBytes", "resultBytes"} & tool_item[4].keys())


@pytest.mark.parametrize(
    "status,phase",
    [("ok", "completed"), ("error", "failed"), ("cancelled", "cancelled")],
)
def test_runtime_observer_captures_native_message_agent_terminal_attempt(
    plugin, monkeypatch, status, phase,
):
    _configure_observer(plugin, monkeypatch)

    plugin._observe_post_tool_call(
        session_id="stored-project-conversation",
        turn_id="turn-one",
        tool_call_id=f"message-agent-{status}",
        tool_name="message_agent",
        args={"target": "Builder", "message": "private body"},
        result={"private": "result"},
        duration_ms=12,
        status=status,
        error_type="delivery_error" if status == "error" else None,
        error_message="bounded failure" if status == "error" else None,
    )

    attempt = plugin._OBSERVATION_QUEUE.get_nowait()[4]
    assert attempt == {
        "eventId": f"tool:message-agent-{status}:{phase}",
        "attemptId": f"message-agent-{status}",
        "kind": "tool",
        "phase": phase,
        "turnId": "turn-one",
        "toolName": "message_agent",
        "toolCallId": f"message-agent-{status}",
        "durationMs": 12.0,
        "status": status,
        **({
            "errorType": "delivery_error",
            "errorMessage": "bounded failure",
        } if status == "error" else {}),
        "redaction": "metadata_only_references_unavailable",
        "_observedAtSeconds": attempt["_observedAtSeconds"],
    }
    assert "args" not in attempt
    assert "result" not in attempt


def test_runtime_observer_bounds_maximum_error_metadata(plugin, monkeypatch):
    _configure_observer(plugin, monkeypatch)
    huge = "e" * 100_000
    plugin._observe_api_request_error(**_llm_context(
        session_id="s" * 100_000,
        turn_id="t" * 100_000,
        api_request_id="a" * 100_000,
        provider="p" * 100_000,
        model="m" * 100_000,
        response_model="r" * 100_000,
        error={"type": huge, "message": huge},
        retryable=True,
    ))

    attempt = plugin._OBSERVATION_QUEUE.get_nowait()[4]
    assert attempt["phase"] == "failed"
    assert len(attempt["eventId"]) == 512
    assert len(attempt["attemptId"]) == 512
    assert len(attempt["turnId"]) == 512
    assert len(attempt["provider"]) == 256
    assert len(attempt["model"]) == 256
    assert len(attempt["errorType"]) == 128
    assert len(attempt["errorMessage"]) == 512
    assert attempt["retryable"] is True


def test_runtime_observer_queue_saturation_records_gap_and_never_changes_prompt_result(
    plugin, monkeypatch,
):
    def complete_prompt(observer):
        result = {"answer": "unchanged", "usage": {"total_tokens": 3}}
        observer()
        return result

    disabled_result = complete_prompt(
        lambda: plugin._observe_post_api_request(**_llm_context())
    )
    _configure_observer(plugin, monkeypatch, capacity=1)
    filler = ("host", "token", "session", time.perf_counter_ns(), {"attemptId": "filler"})
    plugin._OBSERVATION_QUEUE.put_nowait(filler)
    enabled_result = complete_prompt(
        lambda: plugin._observe_post_api_request(**_llm_context())
    )
    assert enabled_result == disabled_result
    assert plugin._observation_stats()["queueDropped"] == 1

    assert plugin._OBSERVATION_QUEUE.get_nowait() is filler
    plugin._observe_post_api_request(**_llm_context(api_request_id="turn-one:api:2"))
    next_attempt = plugin._OBSERVATION_QUEUE.get_nowait()[4]
    assert plugin._prepare_delivery_attempt(next_attempt)["observationGap"] == 1


def test_runtime_observer_delivery_failure_has_no_retry_or_recursive_logging(
    plugin, monkeypatch,
):
    _configure_observer(plugin, monkeypatch)
    posts = []
    monkeypatch.setattr(
        plugin,
        "_post_observation_once",
        lambda host_url, envelope: posts.append((host_url, envelope)) or False,
    )
    plugin._observe_post_api_request(**_llm_context())
    item = plugin._OBSERVATION_QUEUE.get_nowait()

    assert plugin._process_observation_item(item) is False
    assert len(posts) == 1
    stats = plugin._observation_stats()
    assert stats["deliveryFailures"] == 1
    assert stats["retryLimit"] == 0
    followup = plugin._llm_attempt(_llm_context(api_request_id="turn-one:api:2"), failed=False)
    assert followup is not None
    assert plugin._prepare_delivery_attempt(followup)["observationGap"] == 1


def test_runtime_observer_records_queue_lag_and_delivery_without_waiting_in_capture(
    plugin, monkeypatch,
):
    _configure_observer(plugin, monkeypatch)
    monkeypatch.setattr(plugin, "_post_observation_once", lambda *_args: True)
    plugin._observe_post_api_request(**_llm_context())
    item = plugin._OBSERVATION_QUEUE.get_nowait()
    time.sleep(0.01)

    assert plugin._process_observation_item(item) is True
    stats = plugin._observation_stats()
    assert stats["delivered"] == 1
    assert stats["queueLagSamples"] == 1
    assert stats["queueLagCumulativeNs"] >= 10_000_000
    assert stats["queueLagMaxNs"] >= 10_000_000
    print(json.dumps({
        "queueLagSamples": stats["queueLagSamples"],
        "queueLagCumulativeMs": stats["queueLagCumulativeNs"] / 1_000_000,
        "queueLagMaxMs": stats["queueLagMaxNs"] / 1_000_000,
        "delivered": stats["delivered"],
    }))


def test_runtime_observer_worker_startup_is_measured_outside_first_event(
    plugin, monkeypatch,
):
    monkeypatch.setenv("CARD_TOOLS_MANAGED", "1")
    monkeypatch.setenv("CARD_TOOLS_HOST_URL", "http://127.0.0.1:4000/api/hermes-card-tools")
    monkeypatch.setenv("HERMES_DASHBOARD_SESSION_TOKEN", "secret-token")

    plugin._ensure_observation_worker()

    stats = plugin._observation_stats()
    assert plugin._OBSERVATION_THREAD is not None
    assert plugin._OBSERVATION_THREAD.is_alive()
    assert isinstance(stats["workerStartupNs"], int)
    assert stats["workerStartFailures"] == 0
    print(json.dumps({"workerStartupMs": stats["workerStartupNs"] / 1_000_000}))


def test_runtime_observer_capture_benchmark_under_declared_limits(plugin, monkeypatch):
    huge = "z" * 8_000_000
    huge_context = _llm_context(request={"huge": huge}, response={"huge": huge})
    maximum_context = _llm_context(
        session_id="s" * 100_000,
        turn_id="t" * 100_000,
        api_request_id="a" * 100_000,
        provider="p" * 100_000,
        model="m" * 100_000,
        response_model="r" * 100_000,
        api_mode="x" * 100_000,
    )

    def summarize(samples):
        ordered = sorted(samples)
        return {
            "samples": len(samples),
            "p50Ms": statistics.median(ordered) / 1_000_000,
            "p95Ms": ordered[int((len(ordered) - 1) * 0.95)] / 1_000_000,
            "maxMs": ordered[-1] / 1_000_000,
            "cumulativeMs": sum(ordered) / 1_000_000,
        }

    def measure(name, context, *, samples=1_000, capacity=1, drain=False, prefill=False):
        _configure_observer(plugin, monkeypatch, capacity=capacity)
        dropped_before = plugin._observation_stats()["queueDropped"]
        if prefill:
            plugin._OBSERVATION_QUEUE.put_nowait(
                ("host", "token", "session", time.perf_counter_ns(), {"attemptId": "filler"})
            )
        timings = []
        for _index in range(samples):
            started = time.perf_counter_ns()
            plugin._observe_post_api_request(**context)
            timings.append(time.perf_counter_ns() - started)
            if drain:
                plugin._OBSERVATION_QUEUE.get_nowait()
        result = summarize(timings)
        stats = plugin._observation_stats()
        result["queueDepth"] = stats["queueDepth"]
        result["queueDropped"] = stats["queueDropped"] - dropped_before
        assert result["p95Ms"] <= 1.0, (name, result)
        return result

    def measure_contention():
        _configure_observer(plugin, monkeypatch, capacity=1)
        plugin._OBSERVATION_QUEUE.put_nowait(
            ("host", "token", "session", time.perf_counter_ns(), {"attemptId": "filler"})
        )
        dropped_before = plugin._observation_stats()["queueDropped"]

        def capture_many():
            timings = []
            for _index in range(500):
                started = time.perf_counter_ns()
                plugin._observe_post_api_request(**_llm_context())
                timings.append(time.perf_counter_ns() - started)
            return timings

        with ThreadPoolExecutor(max_workers=4) as executor:
            timings = [sample for batch in executor.map(lambda _index: capture_many(), range(4)) for sample in batch]
        result = summarize(timings)
        stats = plugin._observation_stats()
        result["queueDepth"] = stats["queueDepth"]
        result["queueDropped"] = stats["queueDropped"] - dropped_before
        assert result["p95Ms"] <= 1.0, result
        return result

    def measure_disabled():
        monkeypatch.delenv("CARD_TOOLS_MANAGED", raising=False)
        timings = []
        context = _llm_context()
        for _index in range(1_000):
            started = time.perf_counter_ns()
            plugin._observe_post_api_request(**context)
            timings.append(time.perf_counter_ns() - started)
        result = summarize(timings)
        assert result["p95Ms"] <= 1.0, result
        return result

    _configure_observer(plugin, monkeypatch, capacity=1)
    cold_started = time.perf_counter_ns()
    plugin._observe_post_api_request(**_llm_context())
    cold = summarize([time.perf_counter_ns() - cold_started])
    assert cold["maxMs"] <= 1.0

    results = {
        "coldCapture": cold,
        "disabledCapture": measure_disabled(),
        "warmEmptyQueue": measure("warmEmptyQueue", _llm_context(), drain=True),
        "maximumMetadata": measure("maximumMetadata", maximum_context, drain=True),
        "hugeIrrelevantBodies": measure("hugeIrrelevantBodies", huge_context, drain=True),
        "fullQueue": measure("fullQueue", _llm_context(), prefill=True),
        "slowUndrainedQueue": measure(
            "slowUndrainedQueue", _llm_context(), capacity=8, samples=1_000,
        ),
        "contendedFullQueue": measure_contention(),
    }
    print(json.dumps({"runtimeObserverBenchmark": results}, sort_keys=True))


def test_visible_titles_translate_case_insensitively_with_optional_at(plugin, monkeypatch):
    stored_session_id, _titles = _configure_roster(
        plugin,
        monkeypatch,
        [("profile_builder_7", "Builder"), ("profile_signal_9", "Signal")],
    )

    for target in ("Builder", "builder", "@BUILDER", "  @Builder  "):
        assert plugin._resolve_message_agent_target(
            target=target,
            session_id=stored_session_id,
        ) == {
            "profile": "profile_builder_7",
            "roster": ["profile_builder_7", "profile_signal_9"],
            "stored_session_id": "stored-profile_builder_7",
        }


def test_visible_title_resolver_refuses_every_target_outside_exact_roster(plugin, monkeypatch):
    stored_session_id, _titles = _configure_roster(
        plugin,
        monkeypatch,
        [("profile_builder_7", "Builder")],
    )

    for target in (
        "profile_builder_7",
        "Unknown",
        "@Unknown",
        "peer/agent",
        "Builder@another-machine",
        "@@Builder",
    ):
        with pytest.raises(ValueError, match="not authorized"):
            plugin._resolve_message_agent_target(
                target=target,
                session_id=stored_session_id,
            )


@pytest.mark.parametrize("bad_title", [
    "",
    "World Signals",
    "Signal!",
    "@Signal",
    "Sígnal",
    "a" * 65,
])
def test_malformed_visible_title_fails_closed_for_the_whole_projection(
    plugin,
    monkeypatch,
    bad_title,
):
    stored_session_id, _titles = _configure_roster(
        plugin,
        monkeypatch,
        [("valid_profile", "Valid"), ("invalid_profile", bad_title)],
    )

    assert plugin._visible_card_targets(stored_session_id) == []
    assert plugin._visible_card_targets_prompt(stored_session_id) == ""
    with pytest.raises(ValueError, match="response invalid|not authorized"):
        plugin._resolve_message_agent_target(
            target="@Valid", session_id=stored_session_id,
        )


def test_duplicate_visible_titles_fail_closed_case_insensitively(plugin, monkeypatch):
    stored_session_id, _titles = _configure_roster(
        plugin,
        monkeypatch,
        [("profile_one", "Signal"), ("profile_two", "sIgNaL")],
    )

    assert plugin._visible_card_targets(stored_session_id) == []
    with pytest.raises(ValueError, match="response invalid|not authorized"):
        plugin._resolve_message_agent_target(
            target="Signal", session_id=stored_session_id,
        )


def test_prompt_lists_only_exact_visible_titles_and_no_internal_ids(plugin, monkeypatch):
    stored_session_id, _titles = _configure_roster(
        plugin,
        monkeypatch,
        [("profile_builder_7", "Builder"), ("profile_world_9", "WorldSignals")],
    )

    prompt = plugin._visible_card_targets_prompt(stored_session_id)

    assert "@Builder" in prompt
    assert "@WorldSignals" in prompt
    assert "profile_builder_7" not in prompt
    assert "profile_world_9" not in prompt


def test_title_changes_are_read_live_by_prompt_and_translation(plugin, monkeypatch):
    stored_session_id, titles = _configure_roster(
        plugin,
        monkeypatch,
        [("stable_profile", "Signal")],
    )
    assert "@Signal" in plugin._visible_card_targets_prompt(stored_session_id)
    titles["stable_profile"] = "WorldSignals"

    prompt = plugin._visible_card_targets_prompt(stored_session_id)
    assert "@WorldSignals" in prompt
    assert "@Signal`" not in prompt
    with pytest.raises(ValueError, match="not authorized"):
        plugin._resolve_message_agent_target(
            target="Signal", session_id=stored_session_id,
        )
    assert plugin._resolve_message_agent_target(
        target="@worldsignals", session_id=stored_session_id,
    ) == {
        "profile": "stable_profile",
        "roster": ["stable_profile"],
        "stored_session_id": "stored-stable_profile",
    }


def test_empty_or_unreadable_roster_has_no_aliases_or_prompt(plugin, monkeypatch):
    stored_session_id, _titles = _configure_roster(plugin, monkeypatch, [])

    assert plugin._visible_card_targets(stored_session_id) == []
    assert plugin._visible_card_targets_prompt(stored_session_id) == ""
    monkeypatch.setattr(
        plugin,
        "_request_project_roster",
        lambda _session_id: (_ for _ in ()).throw(RuntimeError("unavailable")),
    )
    assert plugin._visible_card_targets(stored_session_id) == []
    with pytest.raises(ValueError, match="not authorized"):
        plugin._resolve_message_agent_target(
            target="Builder", session_id=stored_session_id,
        )


def test_handler_posts_one_signed_request_and_returns_native_output(plugin, monkeypatch):
    monkeypatch.setenv("CARD_TOOLS_MANAGED", "1")
    monkeypatch.setenv("CARD_TOOLS_HOST_URL", "http://127.0.0.1:4000/api/hermes-card-tools")
    monkeypatch.setenv("HERMES_DASHBOARD_SESSION_TOKEN", "gateway-secret")
    monkeypatch.setattr(plugin.secrets, "token_hex", lambda _size: "a" * 32)
    monkeypatch.setattr(plugin.time, "time", lambda: 1_000)
    calls = []

    def post_once(url, envelope):
        calls.append((url, envelope))
        return 200, {"ok": True, "output": '{"ok":true,"cardId":"new"}'}

    monkeypatch.setattr(plugin, "_post_once", post_once)
    result = plugin._handler("card__card_create")(
        {"title": "New Card"},
        task_id="stored-main",
    )
    assert result == '{"ok":true,"cardId":"new"}'
    assert len(calls) == 1
    url, envelope = calls[0]
    assert url == "http://127.0.0.1:4000/api/hermes-card-tools"
    payload = json.loads(envelope["payload"])
    assert payload == {
        "version": 1,
        "expiresAt": 1_300,
        "nonce": "a" * 32,
        "sourceStoredSessionId": "stored-main",
        "tool": "card__card_create",
        "arguments": {"title": "New Card"},
    }
    assert envelope["keyId"] == hashlib.sha256(b"gateway-secret").hexdigest()
    assert envelope["signature"] == hmac.new(
        b"gateway-secret", envelope["payload"].encode("utf-8"), hashlib.sha256,
    ).hexdigest()


def test_project_target_resolution_is_signed_to_exact_source_and_returns_exact_target_session(
    plugin, monkeypatch,
):
    monkeypatch.setenv("CARD_TOOLS_MANAGED", "1")
    monkeypatch.setenv("CARD_TOOLS_HOST_URL", "http://127.0.0.1:4000/api/hermes-card-tools")
    monkeypatch.setenv("HERMES_DASHBOARD_SESSION_TOKEN", "gateway-secret")
    monkeypatch.setattr(plugin.secrets, "token_hex", lambda _size: "d" * 32)
    monkeypatch.setattr(plugin.time, "time", lambda: 3_000)
    captured = {}

    def post_once(_url, envelope):
        captured.update(envelope)
        return 200, {"ok": True, "output": json.dumps({
            "targets": [{"title": "KnowGraph", "profile": "knowgraph"}],
            "resolved": {
                "profile": "knowgraph",
                "storedSessionId": "stored-knowgraph-project-conversation",
            },
        })}

    monkeypatch.setattr(plugin, "_post_once", post_once)

    assert plugin._request_project_target("stored-main-project-conversation", "KnowGraph") == (
        [("KnowGraph", "knowgraph")],
        "knowgraph",
        "stored-knowgraph-project-conversation",
    )
    payload = json.loads(captured["payload"])
    assert payload == {
        "version": 1,
        "expiresAt": 3_300,
        "nonce": "d" * 32,
        "sourceStoredSessionId": "stored-main-project-conversation",
        "tool": "project_roster.resolve",
        "arguments": {"target": "KnowGraph"},
    }


def test_dispatcher_worker_posts_v2_claim_envelope_without_gateway_identity(plugin, monkeypatch):
    monkeypatch.setenv("CARD_TOOLS_MANAGED", "1")
    monkeypatch.setenv("CARD_TOOLS_HOST_URL", "http://127.0.0.1:4000/api/hermes-card-tools")
    monkeypatch.setenv("HERMES_KANBAN_TASK", "t_worker")
    monkeypatch.setenv("HERMES_KANBAN_RUN_ID", "23")
    monkeypatch.setenv("HERMES_KANBAN_CLAIM_LOCK", "native-claim")
    monkeypatch.setenv("HERMES_PROFILE", "saved-worker")
    monkeypatch.setattr(plugin.secrets, "token_hex", lambda _size: "b" * 32)
    monkeypatch.setattr(plugin.time, "time", lambda: 2_000)
    calls = []

    def post_once(url, envelope):
        calls.append((url, envelope))
        return 200, {"ok": True, "output": '{"ok":true,"value":"native"}'}

    monkeypatch.setattr(plugin, "_post_once", post_once)
    result = plugin._handler("graph__read")({"node": "n1"}, task_id="detached-cli-session")

    assert result == '{"ok":true,"value":"native"}'
    assert len(calls) == 1
    url, envelope = calls[0]
    assert url == "http://127.0.0.1:4000/api/hermes-card-tools"
    payload = json.loads(envelope["payload"])
    assert payload == {
        "version": 2,
        "expiresAt": 2_300,
        "nonce": "b" * 32,
        "sourceTaskId": "t_worker",
        "sourceTaskRunId": 23,
        "sourceProfile": "saved-worker",
        "tool": "graph__read",
        "arguments": {"node": "n1"},
    }
    assert "detached-cli-session" not in envelope["payload"]
    assert "sourceStoredSessionId" not in payload
    assert "native-claim" not in envelope["payload"]
    assert envelope["keyId"] == hashlib.sha256(b"native-claim").hexdigest()
    assert envelope["signature"] == hmac.new(
        b"native-claim", envelope["payload"].encode("utf-8"), hashlib.sha256,
    ).hexdigest()


def test_complete_worker_identity_wins_over_gateway_v1(plugin, monkeypatch):
    monkeypatch.setenv("CARD_TOOLS_MANAGED", "1")
    monkeypatch.setenv("CARD_TOOLS_HOST_URL", "http://127.0.0.1:4000/api/hermes-card-tools")
    monkeypatch.setenv("HERMES_DASHBOARD_SESSION_TOKEN", "must-not-be-used")
    monkeypatch.setenv("HERMES_KANBAN_TASK", "t_worker")
    monkeypatch.setenv("HERMES_KANBAN_RUN_ID", "9")
    monkeypatch.setenv("HERMES_KANBAN_CLAIM_LOCK", "worker-claim")
    monkeypatch.setenv("HERMES_PROFILE", "worker-profile")
    captured = {}

    def post_once(_url, envelope):
        captured.update(envelope)
        return 200, {"ok": True, "output": "done"}

    monkeypatch.setattr(plugin, "_post_once", post_once)
    assert plugin._handler("saved__tool")({}, task_id="stored-bot-chat") == "done"

    payload = json.loads(captured["payload"])
    assert payload["version"] == 2
    assert "sourceStoredSessionId" not in payload
    assert "stored-bot-chat" not in captured["payload"]
    assert "must-not-be-used" not in json.dumps(captured)
    assert captured["keyId"] == hashlib.sha256(b"worker-claim").hexdigest()


@pytest.mark.parametrize("present_name", [
    "HERMES_KANBAN_TASK",
    "HERMES_KANBAN_RUN_ID",
    "HERMES_KANBAN_CLAIM_LOCK",
    "HERMES_PROFILE",
])
def test_partial_worker_identity_fails_closed_without_v1_fallback(
    plugin,
    monkeypatch,
    present_name,
):
    monkeypatch.setenv("CARD_TOOLS_MANAGED", "1")
    monkeypatch.setenv("CARD_TOOLS_HOST_URL", "http://127.0.0.1:4000/api/hermes-card-tools")
    monkeypatch.setenv("HERMES_DASHBOARD_SESSION_TOKEN", "gateway-secret")
    monkeypatch.setenv(present_name, "7" if present_name == "HERMES_KANBAN_RUN_ID" else "present")
    monkeypatch.setattr(
        plugin,
        "_post_once",
        lambda *_args: pytest.fail("partial worker identity must not reach the host"),
    )

    result = json.loads(plugin._handler("saved__tool")({}, task_id="stored-bot-chat"))

    assert result == {"ok": False, "error": "card_tool_worker_identity_incomplete"}


@pytest.mark.parametrize("run_id", ["0", "-1", "not-an-integer"])
def test_invalid_worker_run_identity_fails_closed(plugin, monkeypatch, run_id):
    monkeypatch.setenv("CARD_TOOLS_MANAGED", "1")
    monkeypatch.setenv("CARD_TOOLS_HOST_URL", "http://127.0.0.1:4000/api/hermes-card-tools")
    monkeypatch.setenv("HERMES_KANBAN_TASK", "t_worker")
    monkeypatch.setenv("HERMES_KANBAN_RUN_ID", run_id)
    monkeypatch.setenv("HERMES_KANBAN_CLAIM_LOCK", "native-claim")
    monkeypatch.setenv("HERMES_PROFILE", "saved-worker")

    result = json.loads(plugin._handler("saved__tool")({}, task_id="detached-cli-session"))

    assert result == {"ok": False, "error": "card_tool_worker_identity_invalid"}


def test_handler_fails_closed_without_managed_runtime(plugin):
    result = json.loads(plugin._handler("card__card_create")({}, task_id="stored-main"))
    assert result == {"ok": False, "error": "managed_card_runtime_required"}


def test_configuration_rejects_duplicate_names(plugin, tmp_path):
    config = tmp_path / "tools.json"
    tool = {
        "canonicalName": "card.create",
        "hermesName": "card__card_create",
        "description": "Create",
        "inputSchema": {"type": "object"},
    }
    config.write_text(json.dumps({"tools": [tool, tool]}), encoding="utf-8")
    with pytest.raises(ValueError, match="configuration_invalid"):
        plugin._load_tools(config)


def test_non_loopback_transport_is_rejected(plugin):
    with pytest.raises(ValueError, match="loopback"):
        plugin._post_once(
            "https://example.com/tool",
            {"keyId": "a", "payload": "{}", "signature": "b"},
        )
