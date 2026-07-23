from __future__ import annotations

import asyncio
import json
import os

import pytest

from app.python_models.agentgraph import (
    AgentGraphError,
    create_context,
    read_context,
    record_result,
)
from app.python_models.postgres import connect_postgres


PROJECT_ID = "20ac92da-01fd-4cf6-97cc-0672421e751a"
CONVERSATION_ID = "main"
CODER_VIEW_ID = "thinkgraph:coder:kgseed-01"


def _real_proposal() -> dict:
    return {
        "promptRef": "test:agentgraph-live-roundtrip",
        "items": [
            {"id": "finding", "kind": "finding", "text": "AgentGraph stores compact cross-graph importance."},
            {"id": "decision", "kind": "decision", "text": "Keep source graph records canonical."},
        ],
        "references": [
            {"id": "source", "authority": "thinkgraph", "canonicalId": CODER_VIEW_ID},
        ],
        "relationships": [
            {"source": "finding", "target": "decision", "type": "SUPPORTS"},
            {"source": "decision", "target": "source", "type": "USES"},
        ],
    }


def test_validation_rejects_non_scalar_item_properties_before_database_access() -> None:
    proposal = _real_proposal()
    proposal["items"][0]["properties"] = {"nested": {"not": "scalar"}}
    with pytest.raises(AgentGraphError, match="item_properties_scalar_required"):
        create_context(
            project_id=PROJECT_ID,
            deck_id="deck_builder",
            conversation_id=CONVERSATION_ID,
            receiving_agent_id="card_local_coder",
            proposal=proposal,
            receiver_validator=lambda *_args: None,
            graph_view_reader=lambda *_args: [],
        )


def test_validation_rejects_missing_canonical_graph_view_before_database_access() -> None:
    with pytest.raises(
        AgentGraphError,
        match=r"agentgraph_reference_not_found: authority=thinkgraph canonical_id=thinkgraph:coder:kgseed-01",
    ):
        create_context(
            project_id=PROJECT_ID,
            deck_id="deck_builder",
            conversation_id=CONVERSATION_ID,
            receiving_agent_id="card_local_coder",
            proposal=_real_proposal(),
            receiver_validator=lambda *_args: None,
            graph_view_reader=lambda *_args: [],
        )


def test_run_coder_subagent_transports_existing_context_id_unchanged(monkeypatch) -> None:
    from app import mcp_host

    captured: dict = {}

    async def fake_bridge(path: str, payload: dict):
        captured["bridge"] = {"path": path, "payload": payload}
        return [mcp_host.TextContent(type="text", text=json.dumps({"ok": True}))]

    monkeypatch.setattr(mcp_host, "_bridge", fake_bridge)
    result = asyncio.run(mcp_host.call_tool("run_coder_subagent", {
        "parentRunId": "parent-1",
        "projectId": "project-1",
        "deckId": "deck_builder",
        "conversationId": "main",
        "cardId": "card_local_coder",
        "adapter": "codex",
        "approvedPrompt": "Inspect the referenced code.",
        "agentContextId": "agentctx:test",
    }))
    assert json.loads(result[0].text)["ok"] is True
    assert "agentContext" not in captured["bridge"]["payload"]
    assert captured["bridge"]["payload"]["agentContextId"] == "agentctx:test"


@pytest.mark.skipif(
    os.environ.get("AGENTGRAPH_LIVE_TEST") != "1",
    reason="set AGENTGRAPH_LIVE_TEST=1 for the configured Apache AGE persistence contract",
)
def test_real_age_context_roundtrip_and_result_lineage_rolls_back() -> None:
    connection = connect_postgres(autocommit=False)
    try:
        created = create_context(
            project_id=PROJECT_ID,
            deck_id="deck_builder",
            conversation_id=CONVERSATION_ID,
            receiving_agent_id="card_local_coder",
            proposal=_real_proposal(),
            conn=connection,
        )
        context = read_context(created["contextId"], PROJECT_ID, conn=connection)
        assert context["receivingAgentId"] == "card_local_coder"
        assert "[:SUPPORTS]" in context["literateQueryView"]
        assert "[:USES]" in context["literateQueryView"]
        assert f"canonical view = {CODER_VIEW_ID}" in context["literateQueryView"]
        record_result(
            context_id=created["contextId"],
            project_id=PROJECT_ID,
            result_id="test-agentgraph-result",
            run_id="test-agentgraph-run",
            status="completed",
            conn=connection,
        )
        linked = read_context(created["contextId"], PROJECT_ID, conn=connection)
        assert linked["results"][0]["result_id"] == "test-agentgraph-result"
    finally:
        connection.rollback()
        connection.close()
