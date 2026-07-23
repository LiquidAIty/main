from __future__ import annotations

import asyncio
import hashlib
import json

import numpy as np
import pytest
from engraphis.core.interfaces import SearchFilter

from app.python_models.agentgraph import (
    AgentGraphError,
    create_context,
    expand_reference,
    read_context,
    record_result,
)
from app.python_models.thinkgraph_engraphis import ThinkGraphEngraphis


PROJECT_ID = "20ac92da-01fd-4cf6-97cc-0672421e751a"
CONVERSATION_ID = "main"
CODER_VIEW_ID = "thinkgraph:coder:kgseed-01"


class LocalTestEmbedder:
    dim = 384

    def embed(self, texts, *, kind="text"):
        rows = []
        for text in texts:
            raw = hashlib.sha384(text.encode("utf-8")).digest()
            vector = np.frombuffer(raw, dtype=np.uint8).astype(np.float32)
            vector = np.resize(vector, self.dim)
            vector /= np.linalg.norm(vector)
            rows.append(vector)
        return np.vstack(rows)


def graph(tmp_path) -> ThinkGraphEngraphis:
    return ThinkGraphEngraphis(
        tmp_path / "agentgraph-engraphis.sqlite",
        embedder=LocalTestEmbedder(),
    )


def graph_views(*_args) -> list[dict]:
    return [
        {
            "viewId": CODER_VIEW_ID,
            "authority": "thinkgraph",
            "query": "AgentGraph context",
            "rootCanonicalNodeIds": ["decision:agentgraph"],
        }
    ]


def _real_proposal() -> dict:
    return {
        "promptRef": "test:agentgraph-live-roundtrip",
        "items": [
            {
                "id": "finding",
                "kind": "finding",
                "text": "AgentGraph stores compact cross-graph importance.",
            },
            {
                "id": "decision",
                "kind": "decision",
                "text": "Keep source graph records canonical.",
            },
        ],
        "references": [
            {"id": "source", "authority": "thinkgraph", "canonicalId": CODER_VIEW_ID},
        ],
        "relationships": [
            {"source": "finding", "target": "decision", "type": "SUPPORTS"},
            {"source": "decision", "target": "source", "type": "USES"},
        ],
    }


def test_validation_rejects_non_scalar_item_properties_before_engraphis_access() -> None:
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


def test_validation_rejects_missing_canonical_graph_view_before_engraphis_access() -> None:
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


def test_engraphis_context_roundtrip_reference_expansion_and_result_lineage(tmp_path) -> None:
    adapter = graph(tmp_path)
    created = create_context(
        project_id=PROJECT_ID,
        deck_id="deck_builder",
        conversation_id=CONVERSATION_ID,
        receiving_agent_id="card_local_coder",
        proposal=_real_proposal(),
        graph=adapter,
        receiver_validator=lambda *_args: None,
        graph_view_reader=graph_views,
    )
    context = read_context(
        created["contextId"],
        PROJECT_ID,
        graph=adapter,
        graph_view_reader=graph_views,
    )
    assert context["receivingAgentId"] == "card_local_coder"
    assert "[:SUPPORTS]" in context["literateQueryView"]
    assert "[:USES]" in context["literateQueryView"]
    assert f"canonical view = {CODER_VIEW_ID}" in context["literateQueryView"]
    assert "engraphis_recall" in context["literateQueryView"]

    expanded = asyncio.run(
        expand_reference(
            created["referenceIds"][0],
            PROJECT_ID,
            graph=adapter,
            graph_view_reader=graph_views,
        )
    )
    assert expanded["delegatedTool"] == "engraphis_recall"
    assert expanded["result"]["engine"] == "engraphis-v2"
    assert expanded["result"]["projectId"] == PROJECT_ID
    assert expanded["result"]["query"] == "AgentGraph context"
    assert expanded["result"]["count"] > 0

    record_result(
        context_id=created["contextId"],
        project_id=PROJECT_ID,
        result_id="test-agentgraph-result",
        run_id="test-agentgraph-run",
        status="completed",
        graph=adapter,
    )
    linked = read_context(
        created["contextId"],
        PROJECT_ID,
        graph=adapter,
        graph_view_reader=graph_views,
    )
    assert linked["results"][0]["result_id"] == "test-agentgraph-result"

    workspace_id = adapter.store.get_or_create_workspace(PROJECT_ID)
    repo_id = adapter.store.get_or_create_repo(workspace_id, "thinkgraph")
    records = adapter.store.list_memories(
        SearchFilter(workspace_id=workspace_id, repo_id=repo_id)
    )
    relations = {
        str(link["relation"])
        for record in records
        for link in adapter.store.get_links(record.id)
    }
    assert {"HAS_ITEM", "HAS_REFERENCE", "SUPPORTS", "USES", "PRODUCED"} <= relations
