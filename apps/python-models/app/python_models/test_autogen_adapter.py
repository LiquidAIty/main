"""Focused coverage for the real AutoGen 0.7.5 Magentic-One adapter.

No network/model calls: card compilation -> participant metadata, and verbatim
message serialization. The adapter must never invent ledgers or status text.
"""
from app.python_models import magentic_agentchat as mac
from app.python_models.orchestration_contracts import (
    AutoGenMessage,
    CardRuntimeConfig,
    CardRuntimeGraph,
    CardRuntimeParticipant,
    ContextPack,
    GraphEdgeInput,
    GraphNodeInput,
    ProjectSession,
)

MODEL = "openai/gpt-5.1-chat"


def test_autogen_0_7_5_imports_load():
    import autogen_agentchat
    import autogen_core
    import autogen_ext

    assert autogen_core.__version__.startswith("0.7")
    assert autogen_agentchat.__version__.startswith("0.7")
    assert autogen_ext.__version__.startswith("0.7")


def _context_pack(run_approved: bool = False) -> ContextPack:
    graph = CardRuntimeGraph(
        nodes=[
            GraphNodeInput(cardId="orch", title="Orchestrator", runtimeType="magentic_one",
                           provider="openrouter", providerModelId=MODEL),
            GraphNodeInput(cardId="researcher", title="Research Agent", runtimeType="assistant_agent",
                           role="research", prompt="You research things.",
                           provider="openrouter", providerModelId=MODEL),
        ],
        edges=[GraphEdgeInput(id="e1", source="orch", target="researcher", edgeType="magentic_option")],
    )
    card = CardRuntimeConfig(
        cardId="orch", title="Mag One", runtimeType="magentic_one", graph=graph,
        participants=[
            CardRuntimeParticipant(cardId="researcher", title="Research Agent",
                                   runtimeType="assistant_agent", role="research",
                                   provider="openrouter", providerModelId=MODEL),
        ],
    )
    return ContextPack(
        session=ProjectSession(
            sessionId="s", projectId="p", turnId="t", route="r",
            modelProvider="openrouter", modelKey="gpt-5.1-chat", providerModelId=MODEL,
            startedAt="now",
        ),
        userText="Create a Task Ledger for a safe read-only audit of this repo.",
        cardRuntime=card, runApproved=run_approved,
    )


def test_connected_cards_compile_into_participant_metadata():
    specs = mac.compile_connected_agents(_context_pack())
    assert len(specs) == 1
    spec = specs[0]
    assert spec["id"] == "researcher"
    assert spec["name"] == "Research_Agent"  # identifier-safe, from the real card title
    assert spec["provider"] == "openrouter"
    assert spec["provider_model_id"] == MODEL
    # The adapter exposes no fact/plan/ledger shaping helpers anymore.
    assert not hasattr(mac, "parse_facts_sheet")
    assert not hasattr(mac, "build_task_ledger")
    assert not hasattr(mac, "build_progress_ledger")
    assert not hasattr(mac, "parse_plan_steps")


class _FakeMsg:
    def __init__(self, source: str, content: str) -> None:
        self.source = source
        self._content = content

    def to_text(self) -> str:
        return self._content


def test_message_to_event_is_verbatim():
    event = mac._message_to_event(_FakeMsg("Research_Agent", "scanned the repo"))
    assert isinstance(event, AutoGenMessage)
    assert event.source == "Research_Agent"
    assert event.type == "_FakeMsg"
    assert event.content == "scanned the repo"


def test_message_to_event_drops_internal_stop_signal_and_empty():
    assert mac._message_to_event(_FakeMsg("MagenticOneOrchestrator", mac.TASK_LEDGER_STOP)) is None
    assert mac._message_to_event(_FakeMsg("x", "")) is None


def test_progress_ledger_reference_is_identify_only():
    ref = mac._progress_ledger_reference()
    assert ref.identified is True
    assert ref.started is False
    assert ref.implemented is False
    assert ref.rendered is False
    assert "_orchestrate_step" in ref.methods


def test_context_pack_run_approved_is_structured_flag():
    assert _context_pack(run_approved=False).runApproved is False
    assert _context_pack(run_approved=True).runApproved is True
