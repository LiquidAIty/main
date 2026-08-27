"""Explicit provider-free AGE integration proof; not a default unit-test suite.

Run this file explicitly against the configured application database. EXPLAIN
plans the exact SQL produced by _age_rows, never ANALYZE or execute its writes.
No fixture Run, Card, reference, or event is inserted into the product database.
"""

from contextlib import contextmanager

import psycopg
import pytest
from psycopg.rows import dict_row

from app.python_models import card_domain


@pytest.fixture
def planned_attention(monkeypatch):
    real_rows = card_domain._age_rows
    planned = []
    with card_domain.connect_postgres(autocommit=False) as connection:
        with connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute("SET TRANSACTION READ ONLY")
            cursor.execute("SET LOCAL statement_timeout = '10s'")
            cursor.execute("SELECT extversion FROM pg_extension WHERE extname='age'")
            assert cursor.fetchone()["extversion"] == "1.6.0"

            class PlanCursor:
                def execute(self, statement, params):
                    assert statement.startswith("SELECT * FROM ag_catalog.cypher(")
                    cursor.execute("EXPLAIN " + statement, params)

                def fetchall(self):
                    return cursor.fetchall()

            @contextmanager
            def connect(**_kwargs):
                # The production owner still constructs every query and uses
                # its real _age_rows SQL literal/parameter encoding below.
                yield connection

            def plan(_cursor, query, params, columns):
                try:
                    result = real_rows(PlanCursor(), query, params, columns)
                except Exception as error:
                    pytest.fail(f"AGE query planning failed: {type(error).__name__}: {error}")
                assert result and any("QUERY PLAN" in row for row in result)
                planned.append((query, params, columns))
                # Planning has no returned Run. Continue through every query
                # without claiming that these adapter rows are persisted data.
                return [{"run_id": params.get("runId"), "observed": 1}]

            monkeypatch.setattr(card_domain, "connect_postgres", connect)
            monkeypatch.setattr(card_domain, "_age_rows", plan)
            yield planned, real_rows, PlanCursor, connection


def test_external_attention_generated_queries_plan_and_old_clause_is_rejected(planned_attention):
    planned, real_rows, plan_cursor, connection = planned_attention
    context = {"projectId": "query-plan-only", "deckId": "query-plan-only",
               "mainCardId": "query-plan-only", "parentRunId": "external-main:query-plan-only",
               "conversationId": "external-mcp:query-plan-only"}
    event = {"projectId": context["projectId"], "deckId": context["deckId"],
             "cardId": context["mainCardId"], "runId": context["parentRunId"],
             "conversationId": context["conversationId"], "eventId": "query-plan-only",
             "toolName": "cbm.search_graph", "authority": "codegraph", "operation": "read",
             "timestamp": "2026-08-27T00:00:00Z", "nativeNodeIds": ["query-plan-only"],
             "nativeEdgeIds": [], "resultHash": "0" * 64}
    assert card_domain.observe_native_attention(event, external_context=context)
    assert len(planned) == 3
    query, params, columns = planned[0]
    assert "ON CREATE" not in query
    assert "run.state=coalesce(run.state, 'observing')" in query
    incompatible = query.replace("WITH run, card", "ON CREATE SET run.state='observing'\nWITH run, card", 1)
    assert incompatible != query
    with pytest.raises(psycopg.errors.SyntaxError, match='near "ON"'):
        with connection.transaction():
            real_rows(plan_cursor(), incompatible, params, columns)


def test_materialized_read_generated_query_plans_under_application_role(planned_attention):
    planned, _real_rows, _plan_cursor, _connection = planned_attention
    assert card_domain.observe_materialized_anchor_reads({
        "projectId": "query-plan-only", "deckId": "query-plan-only",
        "cardIdentity": {"cardId": "query-plan-only"},
        "resolvedNativeReads": [{"authority": "CodeGraph", "nativeId": "query-plan-only",
                                 "reason": "plan only", "asOf": "2026-08-27T00:00:00Z",
                                 "readOperation": "cbm.get_code_snippet", "required": True}],
    }, run_id="query-plan-only")
    assert len(planned) == 1
    assert "[read:READ" in planned[0][0]
