"""Focused single-card runtime coverage. No network/model call.

Proves: the structural guard is honest (magentic runtime rejected, orchestrator
mismatch rejected, participant count enforced, empty task rejected), a guard
failure produces zero Task Ledger output, and the single participant is built
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

MODEL = "openai/gpt-5.1-chat"


class _FakeToolClient:
    """Minimal model client: AssistantAgent only checks model_info for tools."""

    model_info = {"function_calling": True}


def _session(orchestrator: str = "assistant_agent") -> ProjectSession:
    return ProjectSession(
        sessionId="s", projectId="p", turnId="corr-1", route="single_card",
        orchestrator=orchestrator, modelProvider="openrouter",
        modelKey="gpt-5.1-chat", providerModelId=MODEL, startedAt="now",
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
        mac.rq,
        "hydrate_assignment_context",
        lambda **kwargs: mac.rq.HydratedAssignmentContext(
            assignment_id=kwargs["assignment_id"],
            instruction_id="instruction:test",
            instruction_sha256="sha256:test",
            correlation_id="corr-1",
            receiver_card_id=kwargs["receiver_card_id"],
            instruction="run",
            lease_token="lease:test",
            lease_expires_at="later",
            attempt=1,
            required_bindings=(),
            optional_bindings=(),
            executions=(),
            graph_view_ids=(),
            query_execution_ids=(),
            card_grants=(),
            model_context="run",
        ),
    )
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
# guard failure path — honest error, zero Task Ledger, no model client built
# --------------------------------------------------------------------------- #
class TestGuardFailureResponse:
    def test_guard_failure_returns_honest_error_and_no_task_ledger(self):
        response = asyncio.run(mac.run_configured_card(_context(participants=[])))
        assert response.ok is False
        assert "single_card_participant_count_invalid" in (response.error or "")
        assert response.finalResponseText == ""
        assert response.taskLedgerArtifact is None
        assert response.session.turnId == "corr-1"  # correlation preserved

    def test_assignment_hydration_failure_starts_no_model(self, monkeypatch):
        model_calls: list[str] = []
        monkeypatch.setattr(
            mac.rq,
            "hydrate_assignment_context",
            lambda **_kwargs: (_ for _ in ()).throw(
                RuntimeError("registered_operation_materialization_failed")
            ),
        )
        monkeypatch.setattr(
            mac,
            "_build_model_client",
            lambda _config: model_calls.append("model"),
        )

        response = asyncio.run(mac.run_configured_card(_context()))

        assert response.ok is False
        assert "registered_operation_materialization_failed" in (response.error or "")
        assert model_calls == []

# --------------------------------------------------------------------------- #
# shared builder reuse — the SAME code path Mag One participants use
# --------------------------------------------------------------------------- #
class TestSharedBuilderReuse:
    def test_single_participant_built_via_shared_builder(self):
        agents = mac._build_participants(_context(), _FakeToolClient())
        assert len(agents) == 1
        assert agents[0].name == "ThinkGraph_Agent"

    def test_unknown_tool_fails_loudly_never_silently_dropped(self):
        ctx = _context(participants=[_participant(tools=["not_a_real_tool"])])
        with pytest.raises(RuntimeError):
            mac._build_participants(ctx, _FakeToolClient())


class TestRegisteredQueryContext:
    def test_required_view_materializes_before_model_and_optional_stays_callable(
        self, monkeypatch
    ):
        events: list[str] = []
        tasks: list[str] = []
        attached_tools: list[str] = []
        required = mac.rq.QueryBinding(
            project_id="p",
            deck_id="deck_builder",
            card_id="tg",
            binding_id="required_context",
            query_id="project.context",
            query_version=2,
            delivery_mode="required",
            parameters={"project_id": "p"},
        )
        optional = mac.rq.QueryBinding(
            project_id="p",
            deck_id="deck_builder",
            card_id="tg",
            binding_id="optional_detail",
            query_id="project.detail",
            query_version=1,
            delivery_mode="optional",
            parameters={},
        )
        execution = mac.rq.QueryExecution(
            execution_id="queryexec:one",
            binding_id=required.binding_id,
            query_id=required.query_id,
            query_version=required.query_version,
            parameters=required.parameters,
            graph_view_id="graphview:query:one",
            rows=[{"fact": "bounded"}],
            truncated=False,
        )

        class FakeAgent:
            async def run(self, *, task):
                tasks.append(task)
                return SimpleNamespace(messages=[SimpleNamespace(content="done")])

        def hydrate(**kwargs):
            events.append("materialized")
            return mac.rq.HydratedAssignmentContext(
                assignment_id=kwargs["assignment_id"],
                instruction_id="instruction:test",
                instruction_sha256="sha256:test",
                correlation_id="corr-1",
                receiver_card_id=kwargs["receiver_card_id"],
                instruction="Use registered context.",
                lease_token="lease:test",
                lease_expires_at="later",
                attempt=1,
                required_bindings=(required,),
                optional_bindings=(optional,),
                executions=(execution,),
                graph_view_ids=(execution.graph_view_id,),
                query_execution_ids=(execution.execution_id,),
                card_grants=(),
                model_context=(
                    "materialized context\n"
                    "graphview:query:one\n"
                    '{"fact":"bounded"}\n'
                    "optional_detail: project.detail@v1"
                ),
            )

        monkeypatch.setattr(mac.rq, "hydrate_assignment_context", hydrate)
        monkeypatch.setattr(mac.rpe, "prepare", lambda **_kwargs: None)
        monkeypatch.setattr(
            mac,
            "_build_model_client",
            lambda _config: (events.append("model") or _FakeToolClient()),
        )

        def build(_context, _client, *, extra_tools=None):
            attached_tools.extend(tool.name for tool in (extra_tools or []))
            return [FakeAgent()]

        monkeypatch.setattr(mac, "_build_participants", build)

        response = asyncio.run(mac.run_configured_card(_context("Use registered context.")))

        assert response.ok is True
        assert events == ["materialized", "model"]
        assert attached_tools == ["execute_registered_query"]
        assert "graphview:query:one" in tasks[0]
        assert '{"fact":"bounded"}' in tasks[0]
        assert "optional_detail: project.detail@v1" in tasks[0]
