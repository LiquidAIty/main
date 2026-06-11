"""Spec 007 T005 contract tests: the ReactFlow graph payload compiles into the
v0.4.4 Magentic-One execution structure with sequence, branch, join, loop, and
parallel semantics preserved, and every invalid configuration fails loudly."""

import ast
import importlib.util
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.python_models.graph_compiler import GraphCompileError, compile_card_graph
from app.python_models.magentic_runtime import GraphScheduler, SubgraphNodeRuntime, SubgraphRunner
from app.python_models.orchestration_contracts import CardRuntimeConfig, ContextPack

PROVIDER = "openai"
MODEL_ID = "gpt-5.1-chat-latest"


@pytest.fixture
def anyio_backend():
    return "asyncio"


def _node(card_id: str, **overrides) -> dict:
    node = {
        "cardId": card_id,
        "title": card_id.title(),
        "runtimeType": "assistant_agent",
        "prompt": f"You are {card_id}.",
        "provider": PROVIDER,
        "providerModelId": MODEL_ID,
    }
    node.update(overrides)
    return node


def _participant(card_id: str, **overrides) -> dict:
    participant = {
        "cardId": card_id,
        "title": card_id.title(),
        "runtimeType": "assistant_agent",
        "provider": PROVIDER,
        "providerModelId": MODEL_ID,
    }
    participant.update(overrides)
    return participant


def _magentic_edge(card_id: str) -> dict:
    return {"id": f"mo-{card_id}", "source": "mag1", "target": card_id, "edgeType": "magentic_option"}


def _card(participant_ids: list[str], nodes: list[dict], edges: list[dict], participants: list[dict] | None = None) -> CardRuntimeConfig:
    return CardRuntimeConfig.model_validate(
        {
            "cardId": "mag1",
            "title": "Orchestrator",
            "runtimeType": "magentic_one",
            "graph": {
                "nodes": [_node("mag1", runtimeType="magentic_one")] + nodes,
                "edges": [_magentic_edge(card_id) for card_id in participant_ids] + edges,
            },
            "participants": participants or [_participant(card_id) for card_id in participant_ids],
        }
    )


def test_sequence_branch_join_parallel_preserved():
    card = _card(
        ["a", "b", "c", "d"],
        [_node("a"), _node("b"), _node("c"), _node("d")],
        [
            {"id": "e1", "source": "a", "target": "b", "edgeType": "flow"},
            {"id": "e2", "source": "a", "target": "c", "edgeType": "flow"},
            {"id": "e3", "source": "b", "target": "d", "edgeType": "flow"},
            {"id": "e4", "source": "c", "target": "d", "edgeType": "flow"},
        ],
    )
    compiled = compile_card_graph(card)
    structure = compiled.classify_edges()
    assert structure["branch"] == {"a": ["b", "c"]}
    assert structure["join"] == {"d": ["b", "c"]}
    assert ["b", "c"] in structure["parallel_groups"]
    assert compiled.top_level.entry_node_ids == ["a"]
    assert compiled.top_level.terminal_node_ids == ["d"]
    assert compiled.top_level.levels == [["a"], ["b", "c"], ["d"]]


def test_loop_with_explicit_exit_rule_compiles():
    card = _card(
        ["a", "b"],
        [_node("a"), _node("b")],
        [
            {"id": "e1", "source": "a", "target": "b", "edgeType": "flow"},
            {
                "id": "e2",
                "source": "b",
                "target": "a",
                "edgeType": "flow",
                "loop": {"maxIterations": 3, "exitOnText": "DONE"},
            },
        ],
    )
    compiled = compile_card_graph(card)
    loops = compiled.top_level.loops
    assert len(loops) == 1
    assert loops[0].max_iterations == 3
    assert loops[0].exit_on_text == "DONE"
    assert loops[0].cycle_node_ids == ["a", "b"]


def test_scheduler_holds_downstream_until_loop_exit():
    card = _card(
        ["a", "b", "c"],
        [_node("a"), _node("b"), _node("c")],
        [
            {"id": "e1", "source": "a", "target": "b", "edgeType": "flow"},
            {"id": "e2", "source": "b", "target": "c", "edgeType": "flow"},
            {
                "id": "e3",
                "source": "b",
                "target": "a",
                "edgeType": "flow",
                "loop": {"maxIterations": 3, "exitOnText": "DONE"},
            },
        ],
    )
    scheduler = GraphScheduler(compile_card_graph(card).top_level)

    assert scheduler.next_obligations() == ["a"]
    scheduler.on_agent_spoken("a", "first a")
    assert scheduler.next_obligations() == ["b"]
    scheduler.on_agent_spoken("b", "continue")
    assert scheduler.next_obligations() == ["a"]
    scheduler.on_agent_spoken("a", "second a")
    assert scheduler.next_obligations() == ["b"]
    scheduler.on_agent_spoken("b", "DONE")
    assert scheduler.next_obligations() == ["c"]


@pytest.mark.anyio
async def test_subgraph_runner_recomputes_downstream_after_loop(monkeypatch):
    card = _card(
        ["parent"],
        [
            _node("parent"),
            _node("a", parentGraphId="parent"),
            _node("b", parentGraphId="parent"),
            _node("c", parentGraphId="parent"),
        ],
        [
            {"id": "e1", "source": "a", "target": "b", "edgeType": "flow"},
            {"id": "e2", "source": "b", "target": "c", "edgeType": "flow"},
            {
                "id": "e3",
                "source": "b",
                "target": "a",
                "edgeType": "flow",
                "loop": {"maxIterations": 2, "exitOnText": "DONE"},
            },
        ],
    )
    compiled = compile_card_graph(card)
    calls: list[str] = []

    async def fake_execute_llm_step(*, label, **kwargs):
        calls.append(label)
        if label == "b" and calls.count("b") == 2:
            return "DONE"
        return f"{label}-{calls.count(label)}"

    monkeypatch.setattr(
        "app.python_models.magentic_runtime.execute_llm_step",
        fake_execute_llm_step,
    )
    runtimes = {
        node_id: SubgraphNodeRuntime(
            node=compiled.nodes[node_id],
            model_client=object(),
            tools=[],
            system_prompt=node_id,
        )
        for node_id in ["a", "b", "c"]
    }

    result = await SubgraphRunner(compiled.som_subgraphs["parent"], runtimes).run("task", None)

    assert calls == ["a", "b", "a", "b", "c"]
    assert result == "c-1"


def test_loop_without_exit_rule_is_rejected():
    card = _card(
        ["a", "b"],
        [_node("a"), _node("b")],
        [
            {"id": "e1", "source": "a", "target": "b", "edgeType": "flow"},
            {"id": "e2", "source": "b", "target": "a", "edgeType": "flow"},
        ],
    )
    with pytest.raises(GraphCompileError, match="graph_loop_missing_exit_rule"):
        compile_card_graph(card)


def test_som_parent_derived_from_child_subgraph():
    card = _card(
        ["parent"],
        [
            _node("parent"),
            _node("child1", parentGraphId="parent"),
            _node("child2", parentGraphId="parent"),
        ],
        [{"id": "ce1", "source": "child1", "target": "child2", "edgeType": "flow"}],
    )
    compiled = compile_card_graph(card)
    assert "parent" in compiled.som_subgraphs
    subgraph = compiled.som_subgraphs["parent"]
    assert subgraph.levels == [["child1"], ["child2"]]


def test_som_flag_without_children_is_rejected():
    card = _card(
        ["parent"],
        [_node("parent", isSocietyOfMind=True)],
        [],
    )
    with pytest.raises(GraphCompileError, match="graph_som_child_subgraph_missing"):
        compile_card_graph(card)


def test_fan_out_only_when_card_setting_enabled():
    enabled = _card(
        ["fan"],
        [_node("fan", fanOut={"enabled": True, "count": 2, "items": ["x", "y"]})],
        [],
    )
    assert compile_card_graph(enabled).fan_out_ids == ["fan"]

    disabled = _card(
        ["fan"],
        [_node("fan", fanOut={"enabled": False, "count": 2})],
        [],
    )
    assert compile_card_graph(disabled).fan_out_ids == []


def test_participant_missing_model_config_is_rejected():
    card = _card(
        ["a"],
        [_node("a", provider=None, providerModelId=None)],
        [],
    )
    with pytest.raises(GraphCompileError, match="card_model_config_missing"):
        compile_card_graph(card)


def test_child_node_missing_model_config_is_rejected():
    card = _card(
        ["parent"],
        [
            _node("parent"),
            _node("child1", parentGraphId="parent", provider=None, providerModelId=None),
        ],
        [],
    )
    with pytest.raises(GraphCompileError, match="card_model_config_missing"):
        compile_card_graph(card)


@pytest.mark.parametrize("field", ["provider", "providerModelId"])
@pytest.mark.parametrize("value", ["default", " DEFAULT "])
def test_graph_node_default_model_values_are_rejected_at_contract_layer(field, value):
    with pytest.raises(ValidationError, match="provider_model_default_forbidden"):
        _card(
            ["a"],
            [_node("a", **{field: value})],
            [],
        )


def test_participant_without_magentic_option_edge_is_rejected():
    card = CardRuntimeConfig.model_validate(
        {
            "cardId": "mag1",
            "title": "Orchestrator",
            "runtimeType": "magentic_one",
            "graph": {
                "nodes": [_node("mag1", runtimeType="magentic_one"), _node("a")],
                "edges": [],
            },
            "participants": [_participant("a")],
        }
    )
    with pytest.raises(GraphCompileError, match="graph_participant_missing_magentic_option_edge"):
        compile_card_graph(card)


def test_graph_edge_to_unknown_node_is_rejected():
    card = _card(
        ["a"],
        [_node("a")],
        [{"id": "e1", "source": "a", "target": "ghost", "edgeType": "flow"}],
    )
    with pytest.raises(GraphCompileError, match="graph_edge_unknown_node"):
        compile_card_graph(card)


def test_missing_graph_payload_is_rejected():
    card = CardRuntimeConfig.model_validate(
        {
            "cardId": "mag1",
            "title": "Orchestrator",
            "runtimeType": "magentic_one",
            "participants": [_participant("a")],
        }
    )
    with pytest.raises(GraphCompileError, match="graph_payload_missing"):
        compile_card_graph(card)


def test_runtime_modules_do_not_import_agentchat():
    runtime_dir = Path(__file__).parent
    offenders: list[str] = []
    references: list[str] = []
    for path in runtime_dir.glob("*.py"):
        if path.name == "test_graph_compiler.py":
            continue
        source = path.read_text(encoding="utf-8")
        if "autogen_agentchat" in source:
            references.append(path.name)
        tree = ast.parse(source, filename=str(path))
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                modules = [alias.name for alias in node.names]
            elif isinstance(node, ast.ImportFrom):
                modules = [node.module or ""]
            else:
                continue
            if any(module == "autogen_agentchat" or module.startswith("autogen_agentchat.") for module in modules):
                offenders.append(path.name)
    assert offenders == []
    assert references == []
    assert importlib.util.find_spec("autogen_agentchat") is None


def test_runtime_uses_real_v044_magentic_one_source():
    from app.python_models import magentic_runtime

    from autogen_magentic_one.agents.base_worker import BaseWorker
    from autogen_magentic_one.agents.orchestrator import LedgerOrchestrator

    assert issubclass(magentic_runtime.CardWorkerAgent, BaseWorker)
    assert issubclass(magentic_runtime.SocietyOfMindWorkerAgent, BaseWorker)
    assert issubclass(magentic_runtime.FanOutWorkerAgent, BaseWorker)
    assert issubclass(magentic_runtime.LiquidAItyGraphOrchestrator, LedgerOrchestrator)


def test_unknown_card_tool_fails_loudly():
    from app.python_models.magentic_runtime import build_card_tools

    with pytest.raises(RuntimeError, match="card_tool_unknown"):
        build_card_tools(["nonexistent_tool"])


@pytest.mark.parametrize(
    ("provider", "model"),
    [("default", MODEL_ID), (PROVIDER, "default"), (" DEFAULT ", MODEL_ID), (PROVIDER, " DEFAULT ")],
)
def test_model_client_rejects_default_model_config(provider, model):
    from app.python_models.autogen_provider_env import AutoGenAgentConfig, _build_model_client

    with pytest.raises(RuntimeError, match="card_model_config_default_forbidden"):
        _build_model_client(
            AutoGenAgentConfig(provider=provider, provider_model_id=model)
        )


@pytest.mark.parametrize("field", ["modelProvider", "modelKey", "providerModelId"])
@pytest.mark.parametrize("value", ["default", " DEFAULT "])
def test_session_default_model_values_rejected(field, value):
    session = {
        "sessionId": "s1",
        "projectId": "p1",
        "turnId": "t1",
        "route": "deck_runtime",
        "orchestrator": "magentic_one",
        "modelProvider": PROVIDER,
        "modelKey": MODEL_ID,
        "providerModelId": MODEL_ID,
        "startedAt": "2026-01-01T00:00:00Z",
    }
    session[field] = value
    with pytest.raises(ValidationError, match="provider_model_default_forbidden"):
        ContextPack.model_validate(
            {
                "session": session,
                "userText": "hello",
            }
        )
