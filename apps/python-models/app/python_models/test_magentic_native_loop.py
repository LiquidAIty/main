"""Pinned native orchestration, deterministic model only; never a product receipt."""

import asyncio
import json

import pytest
from autogen_agentchat.teams import MagenticOneGroupChat
from autogen_ext.models.replay import ReplayChatCompletionClient

from app.python_models import magentic_agentchat as mac
from app.python_models.orchestration_contracts import RuntimeParticipant
from app.python_models.test_autogen_adapter import _context


ROLES = [
    ("WorldSignals Agent", "Live-world intelligence briefings"),
    ("Local Coder", "Controlled code patch/test execution"),
    ("Trading Agent", "Paper-trading decisions and deterministic Trade Jobs"),
    ("WorldView", "Signal discovery and globe presentation"),
    ("Signal Analyst", "Sourced evidence assessment"),
    ("Quant Analyst", "Bounded numerical signal assessment"),
]


def context():
    value = _context()
    value.participants = [RuntimeParticipant(
        cardId=f"test-card-{i}", title=title, description=description,
        runtime={"kind": "hermes", "mode": "delegate", "profile": f"test-{i}"},
    ) for i, (title, description) in enumerate(ROLES)]
    return value


def ledger(speaker="Signal_Analyst", *, done=False, progress=True, loop=False):
    return json.dumps({key: {"answer": value, "reason": "test observation"} for key, value in {
        "is_request_satisfied": done,
        "is_in_loop": loop,
        "is_progress_being_made": progress,
        "next_speaker": speaker,
        "instruction_or_question": "Inspect the bounded test evidence.",
    }.items()})


def install_worker(monkeypatch, *, fail=False):
    calls = []

    async def invoke(**kwargs):
        calls.append(kwargs)
        return {"ok": not fail, "result": {
            "status": "failed" if fail else "completed",
            "output": "test worker evidence",
            "correlationId": f"test-child-{len(calls)}",
            "errorSummary": "SECRET provider detail must not escape",
        }}

    monkeypatch.setattr(mac, "call_saved_card_via_mcp", invoke)
    return calls


def native_run(client, participants, **options):
    async def run():
        team = MagenticOneGroupChat(participants, model_client=client, emit_team_events=True, **options)
        return [event async for event in team.run_stream(task="bounded test mission")]
    return asyncio.run(run())


def test_full_team_native_plan_progress_child_lineage_and_completion(monkeypatch):
    calls = install_worker(monkeypatch)
    participants = mac._build_participants(context(), outer_run_id="test-root")
    assert len(participants) == len({p.name for p in participants}) == 6
    assert [p.description for p in participants] == [description for _, description in ROLES]
    client = ReplayChatCompletionClient([
        "test facts", "test plan", ledger(), ledger("Quant_Analyst"),
        ledger(done=True), "test final evidence-backed INCONCLUSIVE",
    ])
    events = native_run(client, participants)
    assert [c["target_card_id"] for c in calls] == ["test-card-4", "test-card-5"]
    assert all(c["parent_run_id"] == "test-root" for c in calls)
    # Inspect public model inputs in this isolated fixture, not private runtime ledgers.
    plan_request = str(client.create_calls[1]["messages"])
    for participant in participants:
        assert participant.name in plan_request
        assert participant.description in plan_request
    assert "test worker evidence" in str(client.create_calls[3]["messages"])
    selected = [e.content for e in events if type(e).__name__ == "SelectSpeakerEvent"]
    assert selected == [["Signal_Analyst"], ["Quant_Analyst"]]
    workers = [e for e in events if getattr(e, "source", None) in {p.name for p in participants}]
    assert [e.metadata["childRunId"] for e in workers] == ["test-child-1", "test-child-2"]
    assert events[-1].stop_reason == "test observation"
    assert events[-1].messages[-1].content == "test final evidence-backed INCONCLUSIVE"
    assert len(participants) == 6  # Unused workers stay available.


def test_native_stall_replans_without_custom_orchestrator(monkeypatch):
    calls = install_worker(monkeypatch)
    participants = mac._build_participants(context(), outer_run_id="test-root")
    client = ReplayChatCompletionClient([
        "test facts", "test plan", ledger(progress=False), ledger(progress=False),
        ledger(progress=False), "updated test facts", "revised test plan",
        ledger("Quant_Analyst"), ledger(done=True), "test final after replan",
    ])
    events = native_run(client, participants)  # Pinned default max_stalls=3.
    assert len(calls) == 3
    assert "updated test facts" in str(client.create_calls[6]["messages"])
    assert "revised test plan" in str(client.create_calls[7]["messages"])
    assert events[-1].messages[-1].content == "test final after replan"


@pytest.mark.parametrize("bad", ["not JSON", ledger("Unknown_Worker")])
def test_native_invalid_progress_or_speaker_fails(monkeypatch, bad):
    calls = install_worker(monkeypatch)
    client = ReplayChatCompletionClient(["test facts", "test plan", bad] * 4)
    with pytest.raises((ValueError, RuntimeError)):
        native_run(client, mac._build_participants(context(), outer_run_id="test-root"))
    assert calls == []


def test_native_worker_failure_has_no_success_or_secret(monkeypatch):
    install_worker(monkeypatch, fail=True)
    client = ReplayChatCompletionClient(["test facts", "test plan", ledger()])
    with pytest.raises(RuntimeError) as caught:
        native_run(client, mac._build_participants(context(), outer_run_id="test-root"))
    assert "saved_card_mcp_run_failed" in str(caught.value)
    assert "SECRET" not in str(caught.value)


def test_adapter_exhaustion_is_not_success(monkeypatch):
    install_worker(monkeypatch)
    value = context()
    value.idf.stableSavedCardContext.runtimeOptions["maxTurns"] = 2
    client = ReplayChatCompletionClient([
        "test facts", "test plan", ledger(), ledger(), ledger(),
        "INCONCLUSIVE: test budget exhausted",
    ])
    monkeypatch.setattr(mac, "_build_model_client", lambda *a, **kw: client)
    result = asyncio.run(mac.run_native_magentic_mission(value))
    assert result.stopReason == "Max rounds reached."
    assert result.ok is False
    assert result.error == "magentic_turn_budget_exhausted"
    assert result.finalResponseText == "INCONCLUSIVE: test budget exhausted"


def test_native_provider_error_is_visible_without_model_fallback(monkeypatch):
    calls = install_worker(monkeypatch)
    client = ReplayChatCompletionClient([])
    monkeypatch.setattr(mac, "_build_model_client", lambda *a, **kw: client)
    result = asyncio.run(mac.run_native_magentic_mission(context()))
    assert result.ok is False
    assert result.error == "magentic_run_failed"
    assert calls == []


def test_native_default_budget_can_continue_past_two(monkeypatch):
    calls = install_worker(monkeypatch)
    client = ReplayChatCompletionClient([
        "test facts", "test plan", ledger(), ledger(), ledger(), ledger(),
        ledger(done=True), "test final",
    ])
    events = native_run(client, mac._build_participants(context(), outer_run_id="test-root"))
    assert len(calls) == 4
    assert events[-1].stop_reason == "test observation"
