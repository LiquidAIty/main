"""Dev participant spans: payload shape, gating, and non-blocking emission."""

from __future__ import annotations

import pytest

from app.python_models.dev_spans import (
    build_participant_span,
    emit_participant_span,
    spans_enabled,
    summarize,
)


def test_build_participant_span_shape_and_bounds() -> None:
    span = build_participant_span(
        correlation_id="mag_one_run_123",
        project_id="p1",
        source="Research_Agent",
        card_id="card_research_agent",
        provider="openrouter",
        model="z-ai/glm-5.2",
        output="  finding\n one " + "x" * 600,
        duration_ms=1234,
        turn_index=2,
        message_type="TextMessage",
    )
    assert span["correlationId"] == "mag_one_run_123"
    assert span["cardId"] == "card_research_agent"
    assert span["provider"] == "openrouter"
    assert span["model"] == "z-ai/glm-5.2"
    assert len(span["outputSummary"]) <= 300
    assert span["outputSummary"].startswith("finding one")
    assert span["durationMs"] == 1234
    assert span["metadata"]["source"] == "Research_Agent"
    assert span["metadata"]["turnIndex"] == 2
    assert span["metadata"]["timing"] == "stream_arrival_delta"


def test_negative_duration_clamped_to_zero() -> None:
    span = build_participant_span(
        correlation_id="c",
        project_id="p",
        source="s",
        card_id=None,
        provider=None,
        model=None,
        output="",
        duration_ms=-50,
        turn_index=0,
        message_type="TextMessage",
    )
    assert span["durationMs"] == 0


def test_spans_disabled_in_production(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("NODE_ENV", "production")
    assert spans_enabled() is False


def test_spans_disabled_by_flag(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("NODE_ENV", raising=False)
    monkeypatch.setenv("LIQUIDAITY_DEV_SPANS", "0")
    assert spans_enabled() is False


def test_emit_never_raises_when_backend_unreachable(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("NODE_ENV", raising=False)
    monkeypatch.delenv("LIQUIDAITY_DEV_SPANS", raising=False)
    monkeypatch.setenv("LIQUIDAITY_BACKEND_URL", "http://127.0.0.1:1")  # nothing listens here
    emit_participant_span({"correlationId": "c"})  # daemon thread swallows the failure


def test_summarize_collapses_whitespace() -> None:
    assert summarize("  a\n b\t c ") == "a b c"
    assert summarize(None) == ""
