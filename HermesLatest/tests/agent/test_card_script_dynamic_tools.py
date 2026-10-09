from types import SimpleNamespace

from agent.dynamic_tools import (
    clear_turn_dynamic_tools,
    dynamic_tools_configuration,
    inline_dynamic_tool_executor,
    install_turn_dynamic_tools,
)


def _script():
    return {
        "version": 1,
        "source": "source",
        "source_hash": "41cf6794ba4200b839c53531555f0f3998df4cbb01a4d5cb0b94e3ca5e23947d",
        "compiled_hash": "a" * 64,
        "mode": "tool_recipe",
        "input_schema": {"type": "object", "properties": {"query": {"type": "string"}}},
        "output_schema": {"type": "object", "properties": {"result": {}}},
        "tool_aliases": {"cbm.search_graph": "card__cbm_search_graph__8f2ac70b72"},
        "tool_states": {"cbm.search_graph": 1, "graphiti.get_status": 2},
        "timeout_seconds": 15,
        "max_tool_calls": 2,
        "max_output_bytes": 20_000,
    }


def test_one_turn_projects_the_same_compact_recipe_to_standard_and_codex_transports():
    agent = SimpleNamespace(
        tools=[{"type": "function", "function": {
            "name": "terminal", "description": "", "parameters": {"type": "object"},
        }}],
        valid_tool_names={"terminal"},
    )
    prior = install_turn_dynamic_tools(
        agent,
        [{
            "type": "function",
            "name": "card__graphiti_get_status__4c1147443c",
            "canonical_name": "graphiti.get_status",
            "description": "Read Graphiti status.",
            "input_schema": {"type": "object", "properties": {}},
        }],
        endpoint="http://127.0.0.1:9000/mcp",
        authorization="Bearer signed-turn",
        card_script=_script(),
    )
    standard = {
        item["function"]["name"]: item["function"]["parameters"]
        for item in agent.tools
    }
    codex, canonical = dynamic_tools_configuration(agent)

    assert standard["card_python"] == _script()["input_schema"]
    assert next(item for item in codex if item["name"] == "card_python")["inputSchema"] == (
        _script()["input_schema"]
    )
    assert canonical["card_python"] == "hermes.card_python"
    assert inline_dynamic_tool_executor(agent, "card_python") is not None

    clear_turn_dynamic_tools(agent, prior)
    assert [item["function"]["name"] for item in agent.tools] == ["terminal"]
    assert agent.valid_tool_names == {"terminal"}
