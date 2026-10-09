from __future__ import annotations

import pytest

from app.python_models import (
    agentgraph_query,
    agentgraph_inspection,
    saved_cards,
)

def test_agentgraph_inspection_is_bounded_read_only_and_project_scoped(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sql: list[str] = []
    age_calls: list[tuple[str, dict]] = []

    class Cursor:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def execute(self, statement, *_args):
            sql.append(statement)

        def fetchone(self):
            return {"available": True}

    class Connection:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def cursor(self, **_kwargs):
            return Cursor()

    deck = {
        "projectId": "project-one",
        "deck": {
            "nodes": [{
                "id": "card-one",
                "title": "Main",
                "runtime": {"kind": "hermes", "mode": "main", "profile": "main"},
                "runtimeOptions": {"enabled": True},
            }],
            "edges": [{
                "id": "flow-one",
                "source": "card-one",
                "target": "card-two",
                "edgeType": "flow",
            }],
        },
    }

    def age_rows(_cursor, query, params, _columns):
        age_calls.append((query, params))
        if "EXECUTED_BY" in query:
            return [{
                "run": {
                    "runId": "run-one",
                    "correlationId": "correlation-one",
                    "state": "completed",
                },
                "card_id": "card-one",
            }]
        if "ASSIGNED_TO" in query:
            return [{
                "run_id": "run-one",
                "sender_card_id": "card-main",
                "target_card_id": "card-one",
            }]
        if "count(edge)" in query:
            return [{
                "run_id": "run-one",
                "operation": "read",
                "event_count": 1,
            }]
        if "USED_TOOL" in query:
            return [{
                "run_id": "run-one",
                "tool_id": "cbm.search_graph",
                "event": {
                    "eventId": "tool:event-one",
                    "timestamp": "2026-08-18T12:00:00Z",
                    "projectId": "project-one",
                    "deckId": "deck-one",
                    "conversationId": "conversation-one",
                    "cardId": "card-one",
                    "authority": "codegraph",
                    "operation": "read",
                    "toolName": "cbm.search_graph",
                    "entityIds": ["pkg._runtime_owner"],
                    "relationshipIds": [],
                    "resultHash": "a" * 64,
                    "truncated": False,
                },
            }]
        if "-[:USED]->" in query:
            return [{
                "run_id": "run-one",
                "authority": "KnowGraph",
                "provider_id": "episode:one",
            }]
        if "-[:VIEWED]->" in query:
            return []
        if "-[:READ]->" in query:
            return [{"run_id": "run-one", "authority": "CodeGraph", "provider_id": "pkg.materialized"}]
        if "PRODUCED_ARTIFACT" in query:
            return [{
                "run_id": "run-one",
                "artifact": {
                    "artifactId": "artifact-one",
                    "artifactKind": "report",
                    "locator": "artifact://one",
                },
            }]
        return []

    monkeypatch.setattr(agentgraph_inspection, "connect_postgres", lambda **_kwargs: Connection())
    monkeypatch.setattr(saved_cards, "load_saved_deck_with_cursor", lambda *_args, **_kwargs: deck)
    monkeypatch.setattr(agentgraph_query, "execute_fixed_agentgraph_query", age_rows)

    result = agentgraph_inspection.inspect_agentgraph({
        "projectId": "project-one",
        "deckId": "deck-one",
        "conversationId": "conversation-one",
        "limit": 5,
    })

    assert sql[0] == "SET TRANSACTION READ ONLY"
    assert sql == ["SET TRANSACTION READ ONLY"]
    assert result["telemetry"] == {
        "runIdentity": True,
        "artifacts": True,
        "rawIdfStored": False,
    }
    assert result["authority"] == "postgresql-age-agentgraph"
    assert result["projectId"] == "project-one"
    assert result["scope"] == {
        "readScope": "project-deck",
        "projectWideRequested": False,
        "conversationId": "conversation-one",
        "cardId": None,
        "runId": None,
        "conversationFilterAvailable": True,
    }
    assert result["cards"][0]["cardId"] == "card-one"
    assert result["relationships"][0]["edgeType"] == "flow"
    assert result["runs"] == [{
        "runId": "run-one",
        "correlationId": "correlation-one",
        "state": "completed",
        "projectId": "project-one",
        "deckId": "deck-one",
        "conversationId": "",
        "rootRunId": "run-one",
        "startedAt": None,
        "acceptedAt": None,
        "finishedAt": None,
        "preparationStartedAt": None,
        "preparationEndedAt": None,
        "preparationElapsedMs": None,
        "preparationState": None,
        "preparationError": None,
        "hermesRootId": None,
        "hermesRunId": None,
        "cardId": "card-one",
        "assignedFromCardIds": ["card-main"],
        "parentRunIds": [],
            "childRunIds": [],
            "usedTools": ["cbm.search_graph"],
            "graphReads": 1,
            "graphWrites": 0,
        "artifacts": [{
            "artifactId": "artifact-one",
            "artifactKind": "report",
            "locator": "artifact://one",
        }],
        "idf": {"sha256": None, "bytes": None},
    }]
    assert all(params["projectId"] == "project-one" for _query, params in age_calls)
    assert all(params["deckId"] == "deck-one" for _query, params in age_calls)
    assert all(
        keyword not in query.upper()
        for query, _params in age_calls
        for keyword in ("MERGE ", "CREATE ", "DELETE ", " SET ")
    )
    assert any(
        "ORDER BY coalesce(" in query and "run.acceptedAt" in query
        for query, _params in age_calls
    )
