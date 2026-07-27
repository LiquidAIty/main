from __future__ import annotations

import hashlib
from uuid import uuid4

import numpy as np
import pytest

from app.python_models import registered_queries as rq
from app.python_models.postgres import connect_postgres
from app.python_models.thinkgraph_engraphis import ThinkGraphEngraphis


PROJECT_ID = "20ac92da-01fd-4cf6-97cc-0672421e751a"


class _LocalEmbedder:
    dim = 384

    def embed(self, texts, *, kind="text"):
        rows = []
        for text in texts:
            vector = np.resize(
                np.frombuffer(hashlib.sha384(text.encode("utf-8")).digest(), dtype=np.uint8)
                .astype(np.float32),
                self.dim,
            )
            vector /= np.linalg.norm(vector)
            rows.append(vector)
        return np.vstack(rows)


def _query(**overrides) -> rq.RegisteredQueryVersion:
    values = {
        "project_id": PROJECT_ID,
        "query_id": "agentgraph.context_count",
        "version": 1,
        "target_graph": "agentgraph",
        "operation_class": "read",
        "capability_id": None,
        "database_authority": "postgresql",
        "database_name": "liquidaity",
        "owner_id": "card_main_chat",
        "title": "AgentGraph context count",
        "description": "Bounded count by project.",
        "language": "sql",
        "statement": (
            "SELECT count(*)::int AS context_count "
            "FROM ag_catalog.agent_assignments WHERE project_id=%(project_id)s"
        ),
        "parameter_schema": {
            "project_id": {"type": "string", "required": True, "maxLength": 100}
        },
        "row_limit": 10,
        "timeout_ms": 2000,
        "authored_by": "card_main_chat",
        "audit_note": "focused test",
    }
    values.update(overrides)
    return rq.RegisteredQueryVersion(**values)


def test_read_only_validation_rejects_mutation_and_multiple_statements() -> None:
    assert rq.validate_read_only_statement("sql", "SELECT 1") == "SELECT 1"
    with pytest.raises(ValueError, match="sql_write_rejected"):
        rq.validate_read_only_statement("sql", "WITH changed AS (DELETE FROM x RETURNING *) SELECT * FROM changed")
    with pytest.raises(ValueError, match="multiple_or_unsafe"):
        rq.validate_read_only_statement("sql", "SELECT 1; SELECT 2")
    with pytest.raises(ValueError, match="cypher_write_rejected"):
        rq.validate_read_only_statement(
            "cypher",
            "MATCH (n) SET n.changed=true RETURN n AS result",
        )


def test_typed_parameters_are_bounded_and_unknown_values_fail() -> None:
    schema = rq.validate_parameter_schema(
        {
            "symbol": {"type": "string", "required": True, "maxLength": 8},
            "limit": {"type": "integer", "default": 10, "minimum": 1, "maximum": 50},
        }
    )
    assert rq.validate_parameters(schema, {"symbol": "ASTS"}) == {
        "symbol": "ASTS",
        "limit": 10,
    }
    with pytest.raises(ValueError, match="parameters_unknown"):
        rq.validate_parameters(schema, {"symbol": "ASTS", "sql": "SELECT 1"})
    with pytest.raises(ValueError, match="too_long"):
        rq.validate_parameters(schema, {"symbol": "TOO-LONG-1"})


def test_registry_versions_are_immediately_referenceable_and_immutable() -> None:
    query_id = f"test.query.{uuid4().hex}"
    connection = connect_postgres(autocommit=False)
    try:
        rq.create_query(
            project_id=PROJECT_ID,
            query_id=query_id,
            database_authority="postgresql",
            database_name="liquidaity",
            owner_id="card_main_chat",
            title="Transactional registry test",
            connection=connection,
        )
        rq.create_version(
            project_id=PROJECT_ID,
            query_id=query_id,
            version=1,
            language="sql",
            statement="SELECT %(value)s::int AS value",
            parameter_schema={
                "value": {"type": "integer", "required": True, "minimum": 0, "maximum": 10}
            },
            row_limit=1,
            timeout_ms=1000,
            authored_by="card_main_chat",
            audit_note="draft proof",
            connection=connection,
        )
        registered = rq.resolve_registered_version(
            PROJECT_ID,
            query_id,
            1,
            connection=connection,
        )
        assert registered.query_id == query_id

        with connection.cursor() as cursor:
            cursor.execute("SAVEPOINT immutable_check")
            with pytest.raises(Exception, match="registered_query_records_are_immutable"):
                cursor.execute(
                    """
                    UPDATE ag_catalog.registered_query_versions
                    SET statement='SELECT 2'
                    WHERE project_id=%s AND query_id=%s AND version=1
                    """,
                    (PROJECT_ID, query_id),
                )
            cursor.execute("ROLLBACK TO SAVEPOINT immutable_check")
    finally:
        connection.rollback()
        connection.close()


def test_sql_and_age_execution_are_database_read_only_and_bounded() -> None:
    rows, truncated = rq._execute_read_only(
        _query(),
        {"project_id": PROJECT_ID},
    )
    assert rows and isinstance(rows[0]["context_count"], int)
    assert truncated is False

    age_query = _query(
        query_id="agentgraph.context_identities",
        database_authority="agentgraph_age",
        language="cypher",
        statement=(
            "MATCH (context:AgentContext) "
            "RETURN {contextId: context.contextId, projectId: context.projectId} AS result"
        ),
        parameter_schema={},
        row_limit=2,
    )
    age_rows, age_truncated = rq._execute_read_only(age_query, {})
    assert len(age_rows) <= 2
    assert all("result" in row for row in age_rows)
    assert isinstance(age_truncated, bool)


def test_materialized_registered_query_view_uses_canonical_graph_view_store(tmp_path) -> None:
    query = _query()
    binding = rq.QueryBinding(
        project_id=PROJECT_ID,
        deck_id="deck_builder",
        card_id="card_main_chat",
        binding_id="required_context",
        query_id=query.query_id,
        query_version=query.version,
        delivery_mode="required",
        parameters={"project_id": PROJECT_ID},
    )
    view = rq._graph_view(
        execution_id="queryexec:test",
        query=query,
        binding=binding,
        parameters=binding.parameters,
        rows=[{"context_count": 4}],
        truncated=False,
        correlation_id="run:test",
        conversation_id="main",
    )
    graph = ThinkGraphEngraphis(
        tmp_path / "registered-query-view.sqlite",
        embedder=_LocalEmbedder(),
    )
    graph.persist_graph_view(view)
    stored = graph.graph_views(PROJECT_ID, "main")["views"]

    assert stored[0]["viewId"] == view["viewId"]
    assert stored[0]["query"] == "agentgraph.context_count@v1"
    assert stored[0]["records"][0]["properties"] == {"context_count": 4}
    assert stored[0]["runtime"]["queryExecutionId"] == "queryexec:test"
