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
    ResultFolder,
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
        mac.ra,
        "begin_agent_assignment",
        lambda **kwargs: f"assignment:{kwargs['correlation_id']}",
    )
    monkeypatch.setattr(mac.ra, "finish_agent_assignment", lambda **_kwargs: "agentresult:corr-1")
    monkeypatch.setattr(mac.rq, "assigned_query_bindings", lambda **_kwargs: [])


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

    def test_invalid_result_folder_fails_honestly_before_any_model_call(self):
        # A standalone run assigned a returns folder it cannot resolve fails honestly
        # (never silently writes elsewhere). This runs before the model client is built.
        ctx = _context()
        ctx.resultFolder = ResultFolder(workspaceRoot="C:/does/not/exist/xyz123", runId="run_x")
        response = asyncio.run(mac.run_configured_card(ctx))
        assert response.ok is False
        assert "result_folder_unresolved" in (response.error or "")


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


class TestAgentGraphRuntimeContext:
    def test_python_resolves_exact_handoff_into_task_and_records_result(self, monkeypatch):
        tasks: list[str] = []
        recorded: list[dict] = []

        class FakeAgent:
            async def run(self, *, task):
                tasks.append(task)
                return SimpleNamespace(
                    messages=[SimpleNamespace(content="Completed from the stored handoff.")]
                )

        ctx = _context(user_text="Approved task.")
        ctx.conversationId = "conv-1"
        ctx.agentContextId = "agentctx:one"

        monkeypatch.setattr(mac.ag, "read_context", lambda context_id, project_id: {
            "contextId": context_id,
            "projectId": project_id,
            "conversationId": "conv-1",
            "receivingAgentId": "tg",
            "markdown": "# Exact stored handoff\n\nUse source refs unchanged.",
        })
        monkeypatch.setattr(mac.ag, "record_result", lambda **kwargs: recorded.append(kwargs))
        monkeypatch.setattr(mac.ag, "mark_context_status", lambda *_args: None)
        monkeypatch.setattr(mac.rpe, "prepare", lambda **_kwargs: None)
        monkeypatch.setattr(mac, "_build_model_client", lambda _config: _FakeToolClient())
        monkeypatch.setattr(mac, "_build_participants", lambda _context, _client: [FakeAgent()])

        response = asyncio.run(mac.run_configured_card(ctx))

        assert response.ok is True
        assert tasks == ["# Exact stored handoff\n\nUse source refs unchanged."]
        assert recorded == [{
            "context_id": "agentctx:one",
            "project_id": "p",
            "result_id": "result:corr-1",
            "run_id": "corr-1",
            "status": "completed",
            "markdown": "Completed from the stored handoff.",
            "result_ref": None,
            "error": None,
        }]

    def test_scope_mismatch_fails_before_model_runtime(self, monkeypatch):
        ctx = _context(user_text="Approved task.")
        ctx.conversationId = "conv-1"
        ctx.agentContextId = "agentctx:wrong"

        monkeypatch.setattr(mac.ag, "read_context", lambda _context_id, project_id: {
            "projectId": project_id,
            "conversationId": "another-conversation",
            "receivingAgentId": "tg",
            "markdown": "Misdirected.",
        })
        monkeypatch.setattr(
            mac,
            "_build_model_client",
            lambda _config: pytest.fail("model runtime must not start for a misdirected context"),
        )

        response = asyncio.run(mac.run_configured_card(ctx))

        assert response.ok is False
        assert response.error == "agentgraph_context_scope_mismatch: agentctx:wrong"


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

        monkeypatch.setattr(
            mac.rq,
            "assigned_query_bindings",
            lambda **_kwargs: [required, optional],
        )
        monkeypatch.setattr(
            mac.rq,
            "execute_binding",
            lambda *_args, **_kwargs: (events.append("materialized") or execution),
        )
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
