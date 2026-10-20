import hashlib
import json
from types import SimpleNamespace

from agent.card_turn_tools import (
    clear_turn_card_script,
    clear_turn_mcp_tool_selection,
    inline_card_script_executor,
    install_turn_card_script,
    install_turn_mcp_tool_selection,
)
from tools import mcp_tool
from tools.mcp_tool_schema import mcp_prefixed_tool_name
from tui_gateway.saved_card_turn import (
    bind_card_turn,
    current_card_turn_authorization,
    current_card_turn_headers,
    reset_card_turn,
    saved_card_turn_environment,
)


def _definition(name: str) -> dict:
    return {
        "type": "function",
        "function": {
            "name": name,
            "description": name,
            "parameters": {"type": "object", "properties": {}},
        },
    }


def _script() -> dict:
    source = "source"
    return {
        "version": 1,
        "source": source,
        "source_hash": hashlib.sha256(source.encode("utf-8")).hexdigest(),
        "compiled_hash": "a" * 64,
        "mode": "tool_recipe",
        "input_schema": {
            "type": "object",
            "properties": {"query": {"type": "string"}},
            "required": ["query"],
        },
        "output_schema": {"type": "object", "properties": {"result": {}}},
        "tool_names": {"cbm.search_graph": "cbm.search_graph"},
        "tool_states": {"cbm.search_graph": 1, "graphiti.get_status": 2},
        "timeout_seconds": 15,
        "max_tool_calls": 2,
        "max_output_bytes": 20_000,
    }


def _agent(monkeypatch):
    script_name = mcp_prefixed_tool_name("liquidaity", "cbm.search_graph")
    agent_name = mcp_prefixed_tool_name("liquidaity", "graphiti.get_status")
    monkeypatch.setitem(mcp_tool._mcp_tool_server_names, script_name, "liquidaity")
    monkeypatch.setitem(mcp_tool._mcp_tool_server_names, agent_name, "liquidaity")
    return SimpleNamespace(
        session_id="session-one",
        tools=[_definition("terminal"), _definition(script_name), _definition(agent_name)],
        valid_tool_names={"terminal", script_name, agent_name},
    ), script_name, agent_name


def test_script_compacts_only_wrapped_profile_tools_for_one_turn(monkeypatch):
    agent, script_name, agent_name = _agent(monkeypatch)
    script_scope = install_turn_card_script(agent, _script())
    mcp_scope = install_turn_mcp_tool_selection(
        agent,
        {"liquidaity": ["graphiti.get_status"]},
    )

    assert agent.valid_tool_names == {"terminal", agent_name, "card_python"}
    assert script_name not in agent.valid_tool_names
    assert inline_card_script_executor(agent, "card_python") is not None

    clear_turn_mcp_tool_selection(agent, mcp_scope)
    clear_turn_card_script(agent, script_scope)
    assert agent.valid_tool_names == {"terminal", script_name, agent_name}


def test_script_runtime_failure_restores_only_its_wrapped_profile_tools(monkeypatch):
    from tools import code_execution_tool

    agent, script_name, agent_name = _agent(monkeypatch)
    install_turn_card_script(agent, _script())
    install_turn_mcp_tool_selection(agent, {"liquidaity": ["graphiti.get_status"]})
    monkeypatch.setattr(
        code_execution_tool,
        "execute_code",
        lambda *_args, **_kwargs: json.dumps({"status": "error", "error": "bad code"}),
    )

    executor = inline_card_script_executor(agent, "card_python")
    assert executor is not None
    result = json.loads(executor(
        agent,
        {"query": "project"},
        SimpleNamespace(tool_call_id="call-one"),
    ))

    assert result == {"error": "card_script_execution_failed"}
    assert agent.valid_tool_names == {"terminal", script_name, agent_name}
    assert "card_python" not in agent.valid_tool_names


def test_saved_card_turn_signs_catalog_and_runtime_requests_without_oauth(monkeypatch):
    import jwt

    secret = "s" * 32
    monkeypatch.setenv("LIQUIDAITY_INTERNAL_MCP_SECRET", secret)
    catalog = current_card_turn_authorization().removeprefix("Bearer ")
    assert jwt.decode(
        catalog,
        secret,
        algorithms=["HS256"],
        audience="liquidaity-internal-mcp",
        issuer="liquidaity-runtime",
    )["principal"] == {"kind": "catalog-reader"}

    token = bind_card_turn({
        "endpoint": "http://127.0.0.1:4000/api/card-turn",
        "project_id": "project-one",
        "deck_id": "deck_builder",
        "conversation_id": "project-one",
        "card_id": "trading",
        "profile": "trading",
    }, "run-one")
    try:
        assert current_card_turn_headers() == {
            "X-LiquidAIty-Project-Id": "project-one",
            "X-LiquidAIty-Deck-Id": "deck_builder",
            "X-LiquidAIty-Conversation-Id": "project-one",
            "X-LiquidAIty-Hermes-Profile": "trading",
            "X-LiquidAIty-Run-Id": "run-one",
        }
        runtime = current_card_turn_authorization().removeprefix("Bearer ")
        assert jwt.decode(
            runtime,
            secret,
            algorithms=["HS256"],
            audience="liquidaity-internal-mcp",
            issuer="liquidaity-runtime",
        )["principal"] == {"kind": "card-runtime"}
    finally:
        reset_card_turn(token)


def test_saved_card_team_root_reads_the_same_process_scoped_runtime_identity(monkeypatch):
    context = {
        "endpoint": "http://127.0.0.1:4000/api/card-turn",
        "project_id": "project-one",
        "deck_id": "deck_builder",
        "conversation_id": "project-one",
        "card_id": "card_knowgraph",
        "profile": "knowgraph",
    }
    environment = saved_card_turn_environment(context, "req_team_run")
    monkeypatch.setenv("LIQUIDAITY_INTERNAL_MCP_SECRET", "s" * 32)
    monkeypatch.setenv("HERMES_SAVED_CARD_TURN", environment["HERMES_SAVED_CARD_TURN"])

    assert current_card_turn_headers() == {
        "X-LiquidAIty-Project-Id": "project-one",
        "X-LiquidAIty-Deck-Id": "deck_builder",
        "X-LiquidAIty-Conversation-Id": "project-one",
        "X-LiquidAIty-Hermes-Profile": "knowgraph",
        "X-LiquidAIty-Run-Id": "req_team_run",
    }
    import jwt

    claims = jwt.decode(
        current_card_turn_authorization().removeprefix("Bearer "),
        "s" * 32,
        algorithms=["HS256"],
        audience="liquidaity-internal-mcp",
        issuer="liquidaity-runtime",
    )
    assert claims["principal"] == {"kind": "card-runtime"}
