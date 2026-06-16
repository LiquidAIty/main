"""Focused coverage for graph_compiler: the real ReactFlow card payload
(cardRuntime.graph + participants) compiles into participant metadata."""
import pytest

from app.python_models.graph_compiler import GraphCompileError, compile_card_graph
from app.python_models.orchestration_contracts import (
    CardRuntimeConfig,
    CardRuntimeGraph,
    CardRuntimeParticipant,
    GraphEdgeInput,
    GraphNodeInput,
)

MODEL = "openai/gpt-5.1-chat"


def _valid_card() -> CardRuntimeConfig:
    return CardRuntimeConfig(
        cardId="orch",
        title="Mag One",
        runtimeType="magentic_one",
        graph=CardRuntimeGraph(
            nodes=[
                GraphNodeInput(cardId="orch", title="Orchestrator", runtimeType="magentic_one",
                               provider="openrouter", providerModelId=MODEL),
                GraphNodeInput(cardId="a1", title="Agent One", runtimeType="assistant_agent",
                               provider="openrouter", providerModelId=MODEL),
            ],
            edges=[GraphEdgeInput(id="e1", source="orch", target="a1", edgeType="magentic_option")],
        ),
        participants=[
            CardRuntimeParticipant(cardId="a1", title="Agent One", runtimeType="assistant_agent",
                                   provider="openrouter", providerModelId=MODEL),
        ],
    )


def test_compile_valid_card_yields_participants():
    compiled = compile_card_graph(_valid_card())
    assert compiled.orchestrator_id == "orch"
    assert compiled.participant_ids == ["a1"]
    assert "a1" in compiled.nodes


def test_compile_requires_magentic_orchestrator_card():
    card = _valid_card()
    card.runtimeType = "assistant_agent"
    with pytest.raises(GraphCompileError):
        compile_card_graph(card)


def test_compile_requires_participant_bus_edge():
    card = _valid_card()
    card.graph.edges = []  # remove the magentic_option edge
    with pytest.raises(GraphCompileError):
        compile_card_graph(card)


def test_compile_requires_participant_model_config():
    card = _valid_card()
    card.graph.nodes[1].provider = None
    card.graph.nodes[1].providerModelId = None
    with pytest.raises(GraphCompileError):
        compile_card_graph(card)
