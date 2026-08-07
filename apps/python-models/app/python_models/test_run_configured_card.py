"""Focused single-card runtime coverage. No network/model call.

Proves: the structural guard is honest (magentic runtime rejected, orchestrator
mismatch rejected, participant count enforced, empty task rejected), a guard
failure starts no model, and the single participant is built
through the SAME shared builder the Mag One path uses (same tool registry with
loud unknown-tool failure — never silently dropped).
"""
import asyncio
from types import SimpleNamespace

import pytest

from app.python_models import magentic_agentchat as mac
from app.python_models.orchestration_contracts import (
    CardRuntimeConfig,
    CardRuntimeParticipant,
    ContextPack,
    ProjectSession,
)

MODEL = "deepseek/deepseek-v4-flash-0731"


class _FakeToolClient:
    """Minimal model client: AssistantAgent only checks model_info for tools."""

    model_info = {"function_calling": True}


def _session(orchestrator: str = "assistant_agent") -> ProjectSession:
    return ProjectSession(
        sessionId="s", projectId="p", turnId="corr-1", route="single_card",
        orchestrator=orchestrator, modelProvider="openrouter",
        modelKey="deepseek/deepseek-v4-flash-0731", providerModelId=MODEL, startedAt="now",
    )


def _participant(tools: list[str] | None = None) -> CardRuntimeParticipant:
    return CardRuntimeParticipant(
        cardId="tg", title="ThinkGraph Agent", runtimeType="assistant_agent",
        role="thinkgraph", tools=tools or [], provider="openrouter", providerModelId=MODEL,
    )


def _context(
    user_text: str = "run",
    runtime_type: str = "assistant_agent",
    participants: list[CardRuntimeParticipant] | None = None,
    orchestrator: str = "assistant_agent",
) -> ContextPack:
    card = CardRuntimeConfig(
        cardId="tg", title="ThinkGraph Agent", runtimeType=runtime_type,
        participants=[_participant()] if participants is None else participants,
    )
    return ContextPack(session=_session(orchestrator), userText=user_text, cardRuntime=card)


@pytest.fixture(autouse=True)
def _durable_outer_boundaries(monkeypatch):
    monkeypatch.setattr(
        mac.ag,
        "create_instruction",
        lambda **_kwargs: {"instructionId": "instruction:test"},
    )
    monkeypatch.setattr(
        mac.ag,
        "create_assignment",
        lambda **kwargs: {"assignmentId": f"assignment:{kwargs['correlation_id']}"},
    )
    monkeypatch.setattr(
        mac.ag,
        "read_assignment",
        lambda **_kwargs: {"instruction": "run", "contextReferences": []},
    )
    monkeypatch.setattr(
        mac.ag,
        "claim_assignment",
        lambda **_kwargs: {"claimToken": "claim:test"},
    )
    monkeypatch.setattr(mac.ag, "record_assignment_runtime_context", lambda **_kwargs: None)
    monkeypatch.setattr(
        mac.ag,
        "finish_assignment",
        lambda **kwargs: {
            "resultId": f"agentresult:{kwargs['assignment_id']}",
            "artifacts": [],
        },
    )


# --------------------------------------------------------------------------- #
# structural guard — pure, honest, no model construction
# --------------------------------------------------------------------------- #
class TestSingleCardGuard:
    def test_valid_single_card_context_passes(self):
        assert mac._validate_single_card_context(_context()) is None

    def test_magentic_runtime_type_is_rejected(self):
        err = mac._validate_single_card_context(_context(runtime_type="magentic_one"))
        assert err is not None and "single_card_runtime_invalid" in err

    def test_orchestrator_mismatch_is_rejected(self):
        err = mac._validate_single_card_context(_context(orchestrator="magentic_one"))
        assert err is not None and "single_card_orchestrator_invalid" in err

    def test_zero_participants_rejected(self):
        err = mac._validate_single_card_context(_context(participants=[]))
        assert err is not None and "single_card_participant_count_invalid: 0" in err

    def test_two_participants_rejected(self):
        err = mac._validate_single_card_context(
            _context(participants=[_participant(), _participant()])
        )
        assert err is not None and "single_card_participant_count_invalid: 2" in err

    def test_empty_task_rejected(self):
        err = mac._validate_single_card_context(_context(user_text="   "))
        assert err is not None and err == "empty_user_message"


# --------------------------------------------------------------------------- #
# guard failure path — honest error, no model client built
# --------------------------------------------------------------------------- #
class TestGuardFailureResponse:
    def test_guard_failure_returns_honest_error(self):
        response = asyncio.run(mac.run_configured_card(_context(participants=[])))
        assert response.ok is False
        assert "single_card_participant_count_invalid" in (response.error or "")
        assert response.finalResponseText == ""
        assert response.session.turnId == "corr-1"  # correlation preserved

    def test_assignment_read_failure_starts_no_model(self, monkeypatch):
        model_calls: list[str] = []
        cancelled: list[dict[str, object]] = []
        monkeypatch.setattr(
            mac.ag,
            "read_assignment",
            lambda **_kwargs: (_ for _ in ()).throw(
                RuntimeError("assignment_reference_read_failed")
            ),
        )
        monkeypatch.setattr(
            mac,
            "_build_model_client",
            lambda _config: model_calls.append("model"),
        )
        monkeypatch.setattr(
            mac.ag,
            "cancel_assignment",
            lambda **kwargs: (
                cancelled.append(kwargs)
                or {
                    "resultId": f"agentresult:{kwargs['assignment_id']}",
                    "status": "cancelled",
                }
            ),
        )

        response = asyncio.run(mac.run_configured_card(_context()))

        assert response.ok is False
        assert "assignment_reference_read_failed" in (response.error or "")
        assert model_calls == []
        assert response.assignmentId == "assignment:corr-1"
        assert response.resultId == "agentresult:assignment:corr-1"
        assert cancelled == [
            {
                "project_id": "p",
                "assignment_id": "assignment:corr-1",
                "requested_by_card_id": "tg",
                "reason": (
                    "agentgraph_assignment_begin_failed: "
                    "assignment_reference_read_failed"
                ),
            }
        ]

    def test_model_client_construction_failure_finishes_assignment(self, monkeypatch):
        finished: list[dict[str, object]] = []
        monkeypatch.setattr(
            mac,
            "_build_model_client",
            lambda _config: (_ for _ in ()).throw(RuntimeError("provider config invalid")),
        )
        monkeypatch.setattr(
            mac.ag,
            "finish_assignment",
            lambda **kwargs: (
                finished.append(kwargs)
                or {
                    "resultId": f"agentresult:{kwargs['assignment_id']}",
                    "artifacts": [],
                }
            ),
        )

        response = asyncio.run(mac.run_configured_card(_context()))

        assert response.ok is False
        assert "provider config invalid" in (response.error or "")
        assert response.assignmentId == "assignment:corr-1"
        assert response.instructionId == "instruction:test"
        assert response.resultId == "agentresult:assignment:corr-1"
        assert finished == [
            {
                "project_id": "p",
                "assignment_id": "assignment:corr-1",
                "claim_token": "claim:test",
                "status": "failed",
                "error_code": "run_failed",
                "error_detail": "single_card_run_failed: provider config invalid",
            }
        ]

# --------------------------------------------------------------------------- #
# shared builder reuse — the SAME code path Mag One participants use
# --------------------------------------------------------------------------- #
class TestSharedBuilderReuse:
    def test_single_card_uses_its_saved_temperature_and_max_tokens(self, monkeypatch):
        context = _context()
        context.cardRuntime.participants[0].temperature = 0.7
        context.cardRuntime.participants[0].maxTokens = 3210
        captured = []

        class FakeAgent:
            async def run(self, *, task):
                return SimpleNamespace(messages=[SimpleNamespace(content="done")])

        def build_client(config):
            captured.append(config)
            return _FakeToolClient()

        monkeypatch.setattr(mac, "_build_model_client", build_client)
        monkeypatch.setattr(
            mac,
            "_build_participants",
            lambda _context, _client: [FakeAgent()],
        )

        response = asyncio.run(mac.run_configured_card(context))

        assert response.ok is True
        assert len(captured) == 1
        assert captured[0].provider == "openrouter"
        assert captured[0].provider_model_id == MODEL
        assert captured[0].temperature == 0.7
        assert captured[0].max_tokens == 3210

    def test_single_participant_built_via_shared_builder(self):
        agents = mac._build_participants(_context(), _FakeToolClient())
        assert len(agents) == 1
        assert agents[0].name == "ThinkGraph_Agent"

    def test_unknown_tool_fails_loudly_never_silently_dropped(self):
        ctx = _context(participants=[_participant(tools=["not_a_real_tool"])])
        with pytest.raises(RuntimeError):
            mac._build_participants(ctx, _FakeToolClient())

    def test_local_coder_single_run_skips_python_model_and_calls_openclaude_authority(
        self, monkeypatch
    ):
        participant = CardRuntimeParticipant(
            cardId="card_local_coder",
            title="Coder",
            runtimeType="assistant_agent",
            runtimeBinding="local_coder",
            role="coder",
            tools=["run_local_coder"],
            provider="openai",
            providerModelId="gpt-5.6-luna",
        )
        context = _context(participants=[participant])
        backend_calls: list[tuple[str, dict]] = []
        monkeypatch.setattr(
            mac,
            "_build_model_client",
            lambda _config: (_ for _ in ()).throw(
                AssertionError("local_coder must not start a Python model client")
            ),
        )

        def fake_post(path: str, payload: dict) -> str:
            backend_calls.append((path, payload))
            return '{"report":{"status":"succeeded"}}'

        monkeypatch.setitem(
            mac.build_local_coder_tool.__globals__,
            "_post_backend_json_sync",
            fake_post,
        )

        response = asyncio.run(mac.run_configured_card(context))

        assert response.ok is True
        assert backend_calls[0][0] == "/api/coder/localcoder/run"
        packet = backend_calls[0][1]["coderPacket"]
        assert packet["modelProvider"] == "openai"
        assert packet["providerModelId"] == "gpt-5.6-luna"
        assert response.finalResponseText == '{"report":{"status":"succeeded"}}'


class TestAssignmentToolAuthority:
    def test_assignment_authority_is_scoped_to_the_model_pass_and_reset(
        self, monkeypatch
    ):
        observed: list[dict[str, str] | None] = []

        class FakeAgent:
            async def run(self, *, task):
                observed.append(
                    mac.ACTIVE_AGENT_ASSIGNMENT_CONTEXT.get()
                )
                return SimpleNamespace(messages=[SimpleNamespace(content="done")])

        monkeypatch.setattr(mac, "_build_model_client", lambda _config: _FakeToolClient())
        monkeypatch.setattr(
            mac,
            "_build_participants",
            lambda _context, _client: [FakeAgent()],
        )

        response = asyncio.run(mac.run_configured_card(_context()))

        assert response.ok is True
        assert observed == [
            {
                "projectId": "p",
                "assignmentId": "assignment:corr-1",
                "receiverCardId": "tg",
            }
        ]
        assert mac.ACTIVE_AGENT_ASSIGNMENT_CONTEXT.get() is None
