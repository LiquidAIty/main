import asyncio
from pathlib import Path

from app.python_models.constellation import ConstellationProcess
from app.python_models.graph_domain import (
    execute_code_context,
    execute_cross_graph_context,
    execute_know_context,
    execute_think_context,
    graph_recipe_manifest,
)


def test_think_context_uses_real_constellation_owner_and_exact_inspection(
    tmp_path: Path,
) -> None:
    database = tmp_path / "think-recipe.sqlite"
    owner = ConstellationProcess("project-one", database_path=database)
    try:
        owner.request("remember", {
            "id": "goal-launch",
            "l0": "Launch LiquidAIty",
            "l1": "Ship a reversible graph-context MVP.",
            "l2": "Prefer compact recipes and exact native references.",
            "nodeType": "goal",
            "tags": ["goal"],
            "source": "liquidaity-test",
            "projectTag": "liquidaity-project:project-one",
        })
        owner.request("remember", {
            "id": "question-evidence",
            "l0": "Which evidence is missing?",
            "l1": "The current launch question.",
            "l2": "Retrieve sourced KnowGraph facts before changing the decision.",
            "nodeType": "question",
            "tags": ["question"],
            "source": "liquidaity-test",
            "projectTag": "liquidaity-project:project-one",
            "edges": [{"target": "goal-launch", "type": "builds_on", "strength": 0.9}],
        })

        result = execute_think_context(
            "project-one",
            {"focus": "goal-launch", "inspectTop": 6},
            native_call=lambda name, args: owner.request(name.removeprefix("constellation."), args),
        )
    finally:
        owner.close()

    assert result["authority"] == "ThinkGraph"
    assert result["nativeOwner"] == "constellation-engine"
    assert result["state"] == "ready"
    assert result["semanticAvailability"]["used"] is False
    assert {node["nativeId"] for node in result["nodes"]} == {
        "goal-launch", "question-evidence",
    }
    assert [node["nativeId"] for node in result["goals"]] == ["goal-launch"]
    assert [node["nativeId"] for node in result["unresolvedQuestions"]] == [
        "question-evidence",
    ]
    assert any(
        edge["sourceNativeId"] == "question-evidence"
        and edge["targetNativeId"] == "goal-launch"
        for edge in result["relationships"]
    )
    assert result["receipt"]["underlyingCallCount"] == 3
    assert result["recipe"] == graph_recipe_manifest("think.context.v1")
    assert database.is_file()


def test_know_context_searches_entities_facts_and_stored_episode_provenance() -> None:
    calls: list[tuple[str, dict]] = []

    async def native_call(name: str, arguments: dict):
        calls.append((name, arguments))
        if name == "graphiti.search_nodes":
            return {"nodes": [{
                "uuid": "entity-one", "name": "LiquidAIty", "labels": ["Project"],
                "summary": "An agent composition system.", "group_id": "liquidaity-project-one",
            }]}
        if name == "graphiti.search_memory_facts":
            return {"facts": [{
                "uuid": "fact-one", "name": "USES", "fact": "LiquidAIty uses native graph owners.",
                "source_node_uuid": "entity-one", "target_node_uuid": "entity-two",
                "episodes": ["episode-one"], "valid_at": "2026-08-30T00:00:00Z",
            }]}
        if name == "graphiti.get_episodes":
            return {"episodes": [{
                "uuid": "episode-one", "name": "Architecture source", "source": "text",
                "source_description": "https://example.test/architecture",
                "created_at": "2026-08-30T00:00:00Z",
            }]}
        raise AssertionError(name)

    result = asyncio.run(
        execute_know_context(
            "project-one",
            {"query": "native graph owners", "maxEntities": 4, "maxFacts": 4},
            native_call=native_call,
        )
    )
    assert [call[0] for call in calls] == [
        "graphiti.search_nodes", "graphiti.search_memory_facts", "graphiti.get_episodes",
    ]
    assert result["authority"] == "KnowGraph"
    assert result["missingCitation"] is False
    assert result["citations"][0]["episodeUuid"] == "episode-one"
    assert {reference["nativeId"] for reference in result["nativeReferences"]} == {
        "entity-one", "fact-one", "episode-one",
    }
    assert result["receipt"]["underlyingCallCount"] == 3


def test_code_context_runs_native_cbm_recipe_in_order() -> None:
    calls: list[tuple[str, dict]] = []

    async def native_call(name: str, arguments: dict):
        calls.append((name, arguments))
        if name == "cbm.search_graph" and arguments.get("query"):
            return {"results": [{
                "qualified_name": "pkg.module.Symbol", "label": "Function", "file": "pkg/module.py",
            }], "has_more": False}
        if name == "cbm.search_code":
            return {"results": [{"file_path": "pkg/module.py", "line": 10}]}
        if name == "cbm.trace_path":
            return {"function": "pkg.module.Symbol", "callers": [], "callees": []}
        if name == "cbm.get_code_snippet":
            return {"qualified_name": "pkg.module.Symbol", "source": "def Symbol(): pass"}
        if name == "cbm.query_graph":
            assert "pkg.module.Symbol" in arguments["query"]
            return {"rows": [{"source": "pkg.module.Symbol", "relationship": None, "target": None}]}
        raise AssertionError((name, arguments))

    result = asyncio.run(
        execute_code_context(
            {"query": "symbol", "maxSymbols": 2, "traceDepth": 1},
            native_call=native_call,
        )
    )
    assert [call[0] for call in calls] == [
        "cbm.search_graph", "cbm.search_code", "cbm.trace_path",
        "cbm.get_code_snippet", "cbm.query_graph",
    ]
    assert result["authority"] == "CodeGraph"
    assert result["nativeReferences"] == [{
        "authority": "CodeGraph", "nativeKind": "node", "nativeId": "pkg.module.Symbol",
    }]
    assert result["receipt"]["underlyingCallCount"] == 5


def test_cross_graph_context_preserves_typed_sections_and_performs_no_write() -> None:
    async def think_call(_arguments: dict):
        return {
            "nodes": [{"nativeId": "thought-one", "summary": "Need evidence"}],
            "nativeReferences": [{"authority": "ThinkGraph", "nativeId": "thought-one"}],
            "receipt": {"recipeId": "think.context.v1"},
        }

    async def know_call(arguments: dict):
        assert "Need evidence" in arguments["query"]
        return {
            "nativeReferences": [{"authority": "KnowGraph", "nativeId": "fact-one"}],
            "receipt": {"recipeId": "know.context.v1"},
        }

    async def code_call(_arguments: dict):
        return {
            "nativeReferences": [{"authority": "CodeGraph", "nativeId": "symbol-one"}],
            "receipt": {"recipeId": "code.context.v1"},
        }

    result = asyncio.run(
        execute_cross_graph_context(
            "project-one",
            {"mission": "Review the graph context", "includeCode": True},
            think_call=think_call,
            know_call=know_call,
            code_call=code_call,
        )
    )
    assert set(result["sections"]) == {"think", "know", "code"}
    assert result["copiedGraphRecords"] is False
    assert result["writesPerformed"] is False
    assert [row["authority"] for row in result["consumedNativeReferences"]] == [
        "ThinkGraph", "KnowGraph", "CodeGraph",
    ]
