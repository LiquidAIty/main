"""Focused coverage of the generic profile executor + ThinkGraph profile v1.

No network/model/DB call. Proves: the executor runs only DECLARED hooks and
contracts (unknown ones fail honestly), profile selection is deterministic from
the persisted runtime binding (no profile → plain run, never a fallback), the
ThinkGraph profile's declared pair-authority hook and PATCH/NO_PATCH contract
behave as assigned, exactly one bounded repair happens inside the same run, and
the assigned post-hook pins exact profile/skill/data versions into the trace.
"""

import asyncio
import json

import pytest

from app.python_models import magentic_agentchat as mac
from app.python_models import runtime_assignments as ra
from app.python_models import runtime_profile_executor as rpe
from app.python_models import thinkgraph_profile as tg
from app.python_models import tool_registry as tr
from app.python_models.orchestration_contracts import (
    CardRuntimeConfig,
    CardRuntimeParticipant,
    ContextPack,
    ProjectSession,
)

MODEL = "openai/gpt-5.1-chat"

AUTHORITY = {
    "kind": "thinkgraph_pair",
    "projectId": "proj",
    "deckId": "deck_builder",
    "cardId": "tg-card",
    "correlationId": "tg:a1",
    "conversationId": "conv",
    "userMessageId": "u1",
    "assistantMessageId": "a1",
}


def _skill(**overrides) -> ra.RuntimeSkill:
    base = dict(
        skill_id="thinkgraph.compact_patch_discipline", version=1, status="promoted",
        applies_to_binding="thinkgraph_agent", guidance="be compact", proof_refs=["p"],
    )
    base.update(overrides)
    return ra.RuntimeSkill(**base)


def _bindings() -> list[dict]:
    return [
        {"bindingType": "conversation_source", "bindingRef": {"scope": "current_exchange"}},
        {"bindingType": "thinkgraph_project_slice", "bindingRef": {"limit": 300}},
    ]


# --------------------------------------------------------------------------- #
# Profile-declared pair-authority hook (ThinkGraph v1 behavior, not a global law)
# --------------------------------------------------------------------------- #
class TestPairAuthorityHook:
    def test_valid_authority_passes(self):
        assert tg.validate_pair_authority(AUTHORITY) is None

    def test_missing_and_wrong_kind_rejected(self):
        assert tg.validate_pair_authority(None) == "thinkgraph_pair_authority_missing"
        assert "kind_invalid" in tg.validate_pair_authority({"kind": "other"})

    @pytest.mark.parametrize("missing", ["projectId", "cardId", "correlationId", "conversationId", "userMessageId", "assistantMessageId"])
    def test_each_required_reference_enforced(self, missing):
        broken = {**AUTHORITY, missing: " "}
        assert f"thinkgraph_pair_authority_{missing}_missing" == tg.validate_pair_authority(broken)

    def test_hook_is_registered_under_its_declared_id(self):
        # The profile ASSIGNS this hook id; the executor never assumes it.
        assert "thinkgraph.verify_pair_authority" in rpe.HOOK_REGISTRY
        assert "thinkgraph.verify_pair_authority" in tg.PROFILE_V1.pre_hooks


# --------------------------------------------------------------------------- #
# Generic executor mechanics
# --------------------------------------------------------------------------- #
def _state(**overrides) -> rpe.HookState:
    base = dict(
        project_id="proj", deck_id="deck_builder", card_id="tg-card", correlation_id="tg:a1",
        runtime_binding="thinkgraph_agent",
        selected_tools=["read_thinkgraph_scope", "apply_thinkgraph_patch"],
        runtime_scope=dict(AUTHORITY), profile=tg.PROFILE_V1,
    )
    base.update(overrides)
    return rpe.HookState(**base)


class TestExecutorMechanics:
    def test_tool_enforcement_is_exact(self):
        rpe.HOOK_REGISTRY["runtime.enforce_allowed_tools"](_state())  # exact match passes
        with pytest.raises(ValueError, match="profile_tools_invalid"):
            rpe.HOOK_REGISTRY["runtime.enforce_allowed_tools"](_state(selected_tools=["read_thinkgraph_scope"]))
        with pytest.raises(ValueError, match="profile_tools_invalid"):
            rpe.HOOK_REGISTRY["runtime.enforce_allowed_tools"](
                _state(selected_tools=["read_thinkgraph_scope", "apply_thinkgraph_patch", "coder_console_task"])
            )

    def test_unknown_pre_hook_fails_honestly(self, monkeypatch):
        rogue = ra.RuntimeProfile(
            profile_id="p", version=1, runtime_binding="b", execution_mode="assistant_agent",
            enabled=True, pre_hooks=["nonexistent.hook"], terminal_contract=tg.THINKGRAPH_TERMINAL_CONTRACT,
        )
        monkeypatch.setattr(ra, "find_profile", lambda binding: rogue)
        with pytest.raises(ValueError, match="runtime_hook_unknown"):
            rpe.prepare(runtime_binding="b", project_id="p", deck_id="d", card_id="c",
                        correlation_id="x", selected_tools=[], runtime_scope=None)

    def test_unknown_terminal_contract_fails_honestly(self, monkeypatch):
        rogue = ra.RuntimeProfile(
            profile_id="p", version=1, runtime_binding="b", execution_mode="assistant_agent",
            enabled=True, pre_hooks=[], terminal_contract="nonexistent.contract",
        )
        monkeypatch.setattr(ra, "find_profile", lambda binding: rogue)
        with pytest.raises(ValueError, match="terminal_contract_unknown"):
            rpe.prepare(runtime_binding="b", project_id="p", deck_id="d", card_id="c",
                        correlation_id="x", selected_tools=[], runtime_scope=None)

    def test_no_binding_or_no_profile_means_plain_run_not_fallback(self, monkeypatch):
        assert rpe.prepare(runtime_binding=None, project_id="p", deck_id="d", card_id="c",
                           correlation_id="x", selected_tools=[], runtime_scope=None) is None
        monkeypatch.setattr(ra, "find_profile", lambda binding: None)
        assert rpe.prepare(runtime_binding="plain_card", project_id="p", deck_id="d", card_id="c",
                           correlation_id="x", selected_tools=[], runtime_scope=None) is None

    def test_unknown_post_hook_fails_honestly(self):
        rogue_profile = ra.RuntimeProfile(
            profile_id="p", version=1, runtime_binding="b", execution_mode="assistant_agent",
            enabled=True, post_hooks=["nonexistent.post"], terminal_contract=tg.THINKGRAPH_TERMINAL_CONTRACT,
        )
        plan = rpe.ProfiledRunPlan(profile=rogue_profile, state=_state(profile=rogue_profile),
                                   packet="", pinned_skill_versions=[])
        with pytest.raises(ValueError, match="runtime_post_hook_unknown"):
            rpe.finalize(plan, outcome="no_patch", detail="{}")


class TestRuntimePacket:
    def test_packet_contains_only_assigned_records(self):
        packet = rpe.build_runtime_packet(tg.PROFILE_V1, [_skill(version=2)], _bindings())
        assert "thinkgraph.project_turn.v1" in packet
        assert "thinkgraph.compact_patch_discipline@v2: be compact" in packet
        assert "conversation_source" in packet and "thinkgraph_project_slice" in packet
        assert "TERMINAL CONTRACT" in packet

    def test_empty_assignments_are_stated_not_invented(self):
        packet = rpe.build_runtime_packet(tg.PROFILE_V1, [], [])
        assert "ASSIGNED RUNTIME SKILLS: none" in packet
        assert "ASSIGNED DATA BINDINGS: none" in packet


# --------------------------------------------------------------------------- #
# ThinkGraph terminal contract (declared by profile v1)
# --------------------------------------------------------------------------- #
def _evaluate(final_text: str, events: list[dict]) -> rpe.TerminalVerdict:
    token = tr.THINKGRAPH_PATCH_EVENTS.set(events)
    try:
        return tg.evaluate_terminal_result(final_text)
    finally:
        tr.THINKGRAPH_PATCH_EVENTS.reset(token)


class TestTerminalContract:
    def test_authorized_applied_patch_is_patch(self):
        verdict = _evaluate("done", [{"status": "applied", "storedResourceIds": ["r1"], "storedStatementIds": [], "relationCount": 0}])
        assert verdict.outcome == "accepted" and verdict.record == "patched"
        assert verdict.stored_refs

    def test_applied_patch_without_stored_refs_is_not_patch(self):
        verdict = _evaluate("prose", [{"status": "applied", "storedResourceIds": [], "storedStatementIds": [], "relationCount": 0}])
        assert verdict.outcome == "invalid"

    def test_structured_no_patch_with_specific_reason(self):
        text = json.dumps({"outcome": "no_patch", "reason": "pair restates existing hypothesis h1"})
        verdict = _evaluate(text, [])
        assert verdict.outcome == "accepted" and verdict.record == "no_patch"
        assert "h1" in verdict.reason

    def test_fenced_no_patch_accepted(self):
        text = '```json\n{"outcome": "no_patch", "reason": "nothing durable"}\n```'
        assert _evaluate(text, []).record == "no_patch"

    def test_prose_and_reasonless_results_are_invalid(self):
        assert _evaluate("I think no patch is needed here.", []).outcome == "invalid"
        assert _evaluate(json.dumps({"outcome": "no_patch", "reason": ""}), []).outcome == "invalid"
        assert _evaluate("", []).outcome == "invalid"

    def test_contract_registered_under_profile_declared_id(self):
        contract = rpe.TERMINAL_CONTRACTS[tg.THINKGRAPH_TERMINAL_CONTRACT]
        assert contract.repair_instruction == tg.REPAIR_INSTRUCTION
        assert contract.invalid_error == tg.INVALID_TERMINAL_ERROR
        assert tg.PROFILE_V1.terminal_contract == tg.THINKGRAPH_TERMINAL_CONTRACT


# --------------------------------------------------------------------------- #
# Profiled single-card run through the generic executor (stub agent, no model).
# --------------------------------------------------------------------------- #


class _StubResult:
    def __init__(self, text: str):
        self.messages = [type("Msg", (), {"content": text})()]


class _StubAgent:
    """Stands in for the AssistantAgent: scripted terminal texts, optional
    patch-event side effect (what the real authorized tool call records)."""

    def __init__(self, texts, patch_on_call=None):
        self.texts = list(texts)
        self.tasks = []
        self.patch_on_call = patch_on_call  # 0-based call index that "applies a patch"

    async def run(self, task: str):
        call_index = len(self.tasks)
        self.tasks.append(task)
        if self.patch_on_call == call_index:
            events = tr.THINKGRAPH_PATCH_EVENTS.get()
            assert events is not None  # runtime must have armed the recorder
            events.append({"status": "applied", "storedResourceIds": ["r1"], "storedStatementIds": [], "relationCount": 1})
        return _StubResult(self.texts[min(call_index, len(self.texts) - 1)])


def _context() -> ContextPack:
    participant = CardRuntimeParticipant(
        cardId="tg-card", title="ThinkGraph Agent", runtimeType="assistant_agent",
        runtimeBinding="thinkgraph_agent", tools=["read_thinkgraph_scope", "apply_thinkgraph_patch"],
        prompt="You are the ThinkGraph agent.", provider="openrouter", providerModelId=MODEL,
    )
    card = CardRuntimeConfig(
        cardId="tg-card", title="ThinkGraph Agent", runtimeType="assistant_agent",
        runtimeScope=dict(AUTHORITY), runtimeOptions={"deckId": "deck_builder"},
        participants=[participant],
    )
    session = ProjectSession(
        sessionId="s", projectId="proj", turnId="tg:a1", route="single_card",
        orchestrator="assistant_agent", modelProvider="openrouter",
        modelKey="gpt-5.1-chat", providerModelId=MODEL, startedAt="now",
    )
    return ContextPack(session=session, userText="pair text", cardRuntime=card)


def _plan() -> rpe.ProfiledRunPlan:
    skills = [_skill()]
    state = _state()
    state.skills = skills
    state.data_bindings = _bindings()
    return rpe.ProfiledRunPlan(
        profile=tg.PROFILE_V1, state=state,
        packet=rpe.build_runtime_packet(tg.PROFILE_V1, skills, state.data_bindings),
        pinned_skill_versions=["thinkgraph.compact_patch_discipline@v1"],
    )


@pytest.fixture()
def profiled_run(monkeypatch):
    traces: list[dict] = []
    plan = _plan()
    monkeypatch.setattr(rpe, "prepare", lambda **kwargs: plan)
    monkeypatch.setattr(
        rpe, "finalize",
        lambda p, *, outcome, detail: traces.append({"plan": p, "outcome": outcome, "detail": detail}),
    )
    monkeypatch.setattr(mac, "_build_model_client", lambda config: object())

    def run(agent: _StubAgent):
        monkeypatch.setattr(mac, "_build_participants", lambda context, client: [agent])
        return asyncio.run(mac.run_configured_card(_context())), traces

    return run


class TestProfiledRepairLoop:
    def test_prose_then_structured_no_patch_uses_exactly_one_repair(self, profiled_run):
        agent = _StubAgent([
            "Sure! Here is my analysis of the pair...",
            json.dumps({"outcome": "no_patch", "reason": "pair restates stored hypothesis"}),
        ])
        response, traces = profiled_run(agent)
        assert response.ok is True
        assert len(agent.tasks) == 2  # one real turn + exactly one repair
        assert agent.tasks[1] == tg.REPAIR_INSTRUCTION
        assert traces[-1]["outcome"] == "no_patch"
        assert json.loads(traces[-1]["detail"])["repairUsed"] is True

    def test_second_invalid_result_is_invalid_terminal_with_trace(self, profiled_run):
        agent = _StubAgent(["prose one", "prose two", "prose three"])
        response, traces = profiled_run(agent)
        assert response.ok is False
        assert response.error == tg.INVALID_TERMINAL_ERROR
        assert len(agent.tasks) == 2  # never retries endlessly
        assert traces[-1]["outcome"] == "invalid_terminal"

    def test_authorized_patch_is_terminal_without_repair(self, profiled_run):
        agent = _StubAgent(["patched the graph"], patch_on_call=0)
        response, traces = profiled_run(agent)
        assert response.ok is True
        assert len(agent.tasks) == 1
        assert traces[-1]["outcome"] == "patched"
        # Pinned assignment versions travel with the post-hook plan.
        assert traces[-1]["plan"].pinned_skill_versions == ["thinkgraph.compact_patch_discipline@v1"]
        assert traces[-1]["plan"].state.correlation_id == "tg:a1"

    def test_packet_travels_with_the_task(self, profiled_run):
        agent = _StubAgent([json.dumps({"outcome": "no_patch", "reason": "r"})])
        profiled_run(agent)
        assert "RUNTIME PROFILE: thinkgraph.project_turn.v1" in agent.tasks[0]
        assert "pair text" in agent.tasks[0]

    def test_prehook_failure_is_honest_and_runs_nothing(self, monkeypatch):
        monkeypatch.setattr(
            rpe, "prepare",
            lambda **kwargs: (_ for _ in ()).throw(ValueError("thinkgraph_pair_authority_missing")),
        )
        called = []
        monkeypatch.setattr(mac, "_build_model_client", lambda config: called.append("client"))
        response = asyncio.run(mac.run_configured_card(_context()))
        assert response.ok is False
        assert "runtime_profile_prehook_failed" in response.error
        assert "thinkgraph_pair_authority_missing" in response.error
        assert called == []  # no model client, no agent, no run

    def test_unprofiled_card_runs_plain_without_contract(self, monkeypatch):
        monkeypatch.setattr(rpe, "prepare", lambda **kwargs: None)
        monkeypatch.setattr(mac, "_build_model_client", lambda config: object())
        agent = _StubAgent(["ordinary assistant reply"])
        monkeypatch.setattr(mac, "_build_participants", lambda context, client: [agent])
        response = asyncio.run(mac.run_configured_card(_context()))
        assert response.ok is True
        assert response.finalResponseText == "ordinary assistant reply"
        assert len(agent.tasks) == 1
        assert "RUNTIME PROFILE" not in agent.tasks[0]  # no packet, no contract

    def test_authority_and_patch_recorder_never_leak(self, profiled_run):
        agent = _StubAgent([json.dumps({"outcome": "no_patch", "reason": "r"})])
        profiled_run(agent)
        assert tr.THINKGRAPH_RUN_AUTHORITY.get() is None
        assert tr.THINKGRAPH_PATCH_EVENTS.get() is None
