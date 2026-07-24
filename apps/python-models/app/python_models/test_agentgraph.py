from __future__ import annotations

import asyncio
import json
from uuid import uuid4

import pytest

from app.python_models.agentgraph import (
    AgentGraphError,
    create_context,
    read_context,
    record_result,
)
from app.python_models.postgres import connect_postgres


def _prepare(cursor) -> None:
    cursor.execute("LOAD 'age'")
    cursor.execute('SET search_path = ag_catalog, "$user", public')


def test_age_roundtrip_preserves_exact_markdown_and_minimal_lineage() -> None:
    project_id = f"agentgraph-test-{uuid4().hex}"
    conversation_id = f"conversation-{uuid4().hex}"
    input_markdown = "  # Exact handoff\n\nKeep **all** spacing.\n\n"
    result_markdown = "# Exact result\n\nReturned unchanged.\n"
    conn = connect_postgres(autocommit=False)
    try:
        first = create_context(
            project_id=project_id,
            deck_id="deck_builder",
            conversation_id=conversation_id,
            sender_agent_id="card_main_chat",
            receiving_agent_id="card_local_coder",
            markdown=input_markdown,
            producing_run_id="parent-run-1",
            agent_validator=lambda *_args: None,
            connection=conn,
        )
        first_read = read_context(first["contextId"], project_id, connection=conn)
        assert first_read["markdown"] == input_markdown
        assert first_read["senderAgentId"] == "card_main_chat"
        assert first_read["receivingAgentId"] == "card_local_coder"
        assert first_read["producingRunId"] == "parent-run-1"
        assert first_read["priorContextId"] is None

        second = create_context(
            project_id=project_id,
            deck_id="deck_builder",
            conversation_id=conversation_id,
            sender_agent_id="card_main_chat",
            receiving_agent_id="card_local_coder",
            markdown="# Follow-up",
            prior_context_id=first["contextId"],
            agent_validator=lambda *_args: None,
            connection=conn,
        )
        second_read = read_context(second["contextId"], project_id, connection=conn)
        assert second_read["priorContextId"] == first["contextId"]

        stored = record_result(
            context_id=second["contextId"],
            project_id=project_id,
            result_id="result-1",
            run_id="run-1",
            status="completed",
            markdown=result_markdown,
            result_ref="coder-workspace/runs/result-1/transcript.txt",
            connection=conn,
        )
        assert stored["created"] is True
        assert stored["markdown"] == result_markdown

        duplicate = record_result(
            context_id=second["contextId"],
            project_id=project_id,
            result_id="result-1",
            run_id="run-1",
            status="completed",
            markdown=result_markdown,
            result_ref="coder-workspace/runs/result-1/transcript.txt",
            connection=conn,
        )
        assert duplicate["created"] is False

        with conn.cursor() as cursor:
            _prepare(cursor)
            cursor.execute(
                """
                SELECT *
                FROM cypher(
                  'agentgraph',
                  $$
                  MATCH (context:AgentContext)-[produced:PRODUCED]->(result:Result)
                  WHERE context.contextId = $contextId
                  RETURN properties(result), count(produced)
                  $$,
                  %s::agtype
                ) AS (result_properties agtype, produced_count agtype)
                """,
                (
                    json.dumps(
                        {"contextId": second["contextId"]},
                        separators=(",", ":"),
                    ),
                ),
            )
            rows = cursor.fetchall()
        assert len(rows) == 1
        properties = json.loads(str(rows[0][0]))
        assert properties["markdown"] == result_markdown
        assert properties["contextId"] == second["contextId"]
        assert json.loads(str(rows[0][1])) == 1
    finally:
        conn.rollback()
        conn.close()


def test_validation_rejects_invalid_identity_before_age_access() -> None:
    with pytest.raises(AgentGraphError, match="agentgraph_sender_agent_id_invalid"):
        create_context(
            project_id="project-1",
            deck_id="deck_builder",
            conversation_id="main",
            sender_agent_id="not an id",
            receiving_agent_id="card_local_coder",
            markdown="# Handoff",
            agent_validator=lambda *_args: None,
        )


def test_mcp_surface_accepts_markdown_and_has_no_reference_expander() -> None:
    from app import mcp_host

    tools = {tool.name: tool for tool in asyncio.run(mcp_host.list_tools())}
    assert "agentgraph.expand_reference" not in tools
    create_schema = tools["agentgraph.create_context"].inputSchema
    assert set(create_schema["required"]) == {
        "projectId",
        "deckId",
        "conversationId",
        "senderAgentId",
        "receivingAgentId",
        "markdown",
    }
    assert "context" not in create_schema["properties"]
    assert "references" not in create_schema["properties"]


def test_run_coder_subagent_transports_existing_context_id_unchanged(monkeypatch) -> None:
    from app import mcp_host

    captured: dict = {}

    async def fake_bridge(path: str, payload: dict):
        captured["bridge"] = {"path": path, "payload": payload}
        return [mcp_host.TextContent(type="text", text=json.dumps({"ok": True}))]

    monkeypatch.setattr(mcp_host, "_bridge", fake_bridge)
    result = asyncio.run(
        mcp_host.call_tool(
            "run_coder_subagent",
            {
                "parentRunId": "parent-1",
                "projectId": "project-1",
                "deckId": "deck_builder",
                "conversationId": "main",
                "cardId": "card_local_coder",
                "adapter": "codex",
                "approvedPrompt": "Inspect the referenced code.",
                "agentContextId": "agentctx:test",
            },
        )
    )
    assert json.loads(result[0].text)["ok"] is True
    assert "agentContext" not in captured["bridge"]["payload"]
    assert captured["bridge"]["payload"]["agentContextId"] == "agentctx:test"
