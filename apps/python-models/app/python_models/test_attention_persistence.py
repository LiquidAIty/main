"""Provider-free proofs at the existing AGE writer/reader boundary."""

from contextlib import contextmanager

import pytest

from app.python_models import card_domain


@pytest.fixture
def age_boundary(monkeypatch):
    statements = []
    runs = {}
    events = {}

    class Cursor:
        def execute(self, query, *_args):
            assert query == "SET TRANSACTION READ ONLY"

    class Connection:
        @contextmanager
        def cursor(self, **_kwargs):
            yield Cursor()

    @contextmanager
    def connect(**_kwargs):
        yield Connection()

    def rows(_cursor, query, params, _columns):
        statements.append((query, params))
        if "MERGE (run:Run {runId: $runId})" in query:
            # Apache AGE 1.6 rejects Neo4j's ON CREATE SET syntax. Retain
            # existing identity/state with the supported SET/coalesce form.
            assert "ON CREATE" not in query
            assert "run.state=coalesce(run.state, 'observing')" in query
            existing = runs.get(params["runId"])
            if existing and any(existing[key] != params[key] for key in (
                "projectId", "deckId", "conversationId",
            )):
                return []
            runs.setdefault(params["runId"], {
                "runId": params["runId"], "projectId": params["projectId"],
                "deckId": params["deckId"], "conversationId": params["conversationId"],
                "cardId": params["cardId"], "state": "observing",
            })
            return [{"run_id": params["runId"]}]
        if "MERGE (run)-[used:USED_TOOL" in query:
            owner = runs.get(params["runId"])
            if not owner or owner["cardId"] != params["cardId"]:
                return []
            events[params["eventId"]] = dict(params)
            return [{"run_id": params["runId"]}]
        if "RETURN properties(run), card.cardId" in query:
            for key, expression in (("conversationId", "run.conversationId"),
                                    ("runId", "run.runId"), ("cardId", "card.cardId")):
                if params[key]:
                    assert f"{expression} = ${key}" in query.split("LIMIT")[0]
            selected = [run for run in reversed(list(runs.values()))
                        if run["projectId"] == params["projectId"]
                        and ("deckId: $deckId" not in query or run["deckId"] == params["deckId"])
                        and all(not params[key] or run[key] == params[key]
                                for key in ("conversationId", "runId", "cardId"))]
            bound = int(query.rsplit("LIMIT ", 1)[1].strip())
            return [{"run": run, "card_id": run["cardId"]} for run in selected[:bound]]
        if "USED_TOOL" in query:
            assert "edge.eventId IS NOT NULL AND edge.eventId <> ''" in query
            selected = [event for event in events.values() if event["runId"] in params["runIds"]]
            if "count(edge)" in query:
                return [{"run_id": run_id, "operation": operation,
                         "event_count": sum(event["operation"] == operation and event["runId"] == run_id
                                            for event in selected)}
                        for run_id in params["runIds"] for operation in ("read", "write")]
            # Include a legacy row at the boundary too: response normalization
            # must never mistake configured/available tools for actual calls.
            return [*({"run_id": event["runId"], "tool_id": event["toolName"], "event": event}
                      for event in selected),
                    {"run_id": params["runIds"][0], "tool_id": "legacy.available", "event": {}}]
        return []

    monkeypatch.setattr(card_domain, "connect_postgres", connect)
    monkeypatch.setattr(card_domain, "_age_rows", rows)
    monkeypatch.setattr(card_domain, "_load_deck_with_cursor", lambda *_args, **_kwargs: {
        "projectId": "project-one", "deck": {"nodes": [], "edges": []},
    })
    return runs, events, statements


def test_external_attention_establishes_once_and_survives_scoped_readback(age_boundary):
    runs, events, statements = age_boundary
    context = {"projectId": "project-one", "deckId": "deck-one", "mainCardId": "card-main",
               "parentRunId": "external-main:grant-one", "conversationId": "external-mcp:grant-one"}
    event = {"projectId": context["projectId"], "deckId": context["deckId"],
             "cardId": context["mainCardId"], "runId": context["parentRunId"],
             "conversationId": context["conversationId"], "eventId": "native-attention:one",
             "toolName": "cbm.search_graph", "authority": "codegraph", "operation": "read",
             "timestamp": "2026-08-27T12:00:00Z", "nativeNodeIds": ["pkg.actual"],
             "nativeEdgeIds": [], "resultHash": "a" * 64}
    assert card_domain.observe_native_attention(event) is False
    assert card_domain.observe_native_attention(event, external_context=context) is True
    assert card_domain.observe_native_attention(event, external_context=context) is True
    assert len(runs) == len(events) == 1
    result = card_domain.inspect_agentgraph({"projectId": "project-one", "deckId": "deck-one",
                                           "conversationId": context["conversationId"], "limit": 1})
    run = result["runs"][0]
    assert run["cardId"] == "card-main"
    assert run["conversationId"] == context["conversationId"]
    assert run["usedTools"] == ["cbm.search_graph"]
    assert run["graphReads"] == 1 and run["graphWrites"] == 0
    assert [value["eventId"] for value in run["attentionEvents"]] == [event["eventId"]]
    assert run["attentionEvents"][0]["nativeNodeIds"] == ["pkg.actual"]
    assert result["telemetry"]["materializedNativeReferencesAvailable"] is True
    assert any("-[:READ]->" in query for query, _params in statements)
    before = len(statements)
    assert card_domain.observe_native_attention(event, external_context={**context, "mainCardId": "other"}) is False
    assert len(statements) == before
    runs[event["runId"]]["state"] = "completed"
    assert card_domain.observe_native_attention(event, external_context=context) is True
    assert runs[event["runId"]]["state"] == "completed"
    assert len(runs) == len(events) == 1
    runs[event["runId"]]["conversationId"] = "conflicting-conversation"
    assert card_domain.observe_native_attention(event, external_context=context) is False


def test_scope_precedes_limit_with_more_than_fifty_newer_unrelated_runs(age_boundary):
    runs, _events, statements = age_boundary
    runs["old-run"] = {"runId": "old-run", "projectId": "project-one", "deckId": "deck-one",
                       "cardId": "card-selected", "conversationId": "old-conversation"}
    for index in range(120):
        runs[f"new-{index}"] = {"runId": f"new-{index}", "projectId": "project-one",
                              "deckId": "other-deck" if index % 2 else "deck-one",
                              "cardId": "other-card", "conversationId": "new"}
    scope = {"projectId": "project-one", "deckId": "deck-one", "limit": 1}
    for selector in ({"conversationId": "old-conversation"}, {"runId": "old-run"},
                     {"cardId": "card-selected"}):
        result = card_domain.inspect_agentgraph({**scope, **selector})
        assert [run["runId"] for run in result["runs"]] == ["old-run"]
    project = card_domain.inspect_agentgraph({**scope, "projectWide": True, "limit": 50})
    assert len(project["runs"]) == 50
    assert project["runs"][0]["deckId"] == "other-deck"
    assert project["scope"]["readScope"] == "project"
    assert all("LIMIT " in query for query, _params in statements)
    with pytest.raises(card_domain.CardDomainError, match="agentgraph_limit_invalid"):
        card_domain.inspect_agentgraph({**scope, "limit": 51})


def test_authenticated_external_mcp_read_uses_the_real_writer_once_and_reports_failure(monkeypatch, age_boundary):
    import asyncio
    from app import mcp_host
    from mcp.types import CallToolResult

    context = {"projectId": "project-one", "deckId": "deck-one", "mainCardId": "card-main",
               "parentRunId": "external-main:grant-one", "conversationId": "external-mcp:grant-one"}

    async def dispatch(_name, _args):
        return CallToolResult(content=[], structuredContent={"results": [{"qualified_name": "pkg.actual"}]})

    monkeypatch.setattr(mcp_host, "_dispatch_tool", dispatch)
    monkeypatch.setattr(mcp_host, "_authenticated_main_context", lambda: dict(context))
    monkeypatch.setattr(mcp_host, "_request_execution_context", lambda: None)
    monkeypatch.setattr(mcp_host, "_internal_mcp_principal", lambda: None)
    result = asyncio.run(mcp_host.call_tool("cbm.search_graph", {}))
    assert result.isError is not True
    assert len(age_boundary[1]) == 1
    assert result.meta["nativeAttention"]["cardId"] == "card-main"
    readback = card_domain.inspect_agentgraph({"projectId": "project-one", "deckId": "deck-one",
                                              "runId": context["parentRunId"], "limit": 1})
    assert [event["eventId"] for event in readback["runs"][0]["attentionEvents"]] == [result.meta["nativeAttention"]["eventId"]]
    monkeypatch.setattr(card_domain, "observe_native_attention", lambda *_args, **_kwargs: False)
    failed_observation = asyncio.run(mcp_host.call_tool("cbm.search_graph", {}))
    assert failed_observation.isError is not True  # the native read succeeded
    assert failed_observation.meta["nativeAttention"]["persisted"] is False
    import json
    assert json.loads(failed_observation.content[-1].text)["executionReceipt"]["attentionFailureCode"] == "native_attention_persistence_failed"
    def broken_observer(*_args, **_kwargs):
        raise RuntimeError("AGE observation unavailable")
    monkeypatch.setattr(card_domain, "observe_native_attention", broken_observer)
    exception_observation = asyncio.run(mcp_host.call_tool("cbm.search_graph", {}))
    assert exception_observation.isError is not True
    assert exception_observation.meta["nativeAttention"]["persisted"] is False


def test_missing_materialized_read_schema_is_visible_even_without_runs(monkeypatch, age_boundary):
    rows = card_domain._age_rows

    def missing_read(cursor, query, params, columns):
        if "-[:READ]->" in query:
            raise PermissionError("READ label unavailable")
        return rows(cursor, query, params, columns)

    monkeypatch.setattr(card_domain, "_age_rows", missing_read)
    with pytest.raises(card_domain.CardDomainError, match="agentgraph_materialized_read_unavailable:PermissionError"):
        card_domain.inspect_agentgraph({"projectId": "project-one", "deckId": "deck-one"})
