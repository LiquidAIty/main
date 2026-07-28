from __future__ import annotations

import asyncio
import hashlib

import numpy as np
import pytest

from app import control_plane
from app.python_models import registered_queries as rq
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
        "database_authority": "postgresql",
        "database_name": "liquidaity",
        "title": "AgentGraph context count",
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


def test_assignment_hydrator_materializes_required_and_keeps_optional_scoped(
    monkeypatch,
) -> None:
    events: list[str] = []
    required = rq.QueryBinding(
        project_id=PROJECT_ID,
        card_id="card_magentic",
        binding_id="operation-ref:1",
        query_id="agentgraph.active_context_identities",
        query_version=2,
        delivery_mode="required",
        parameters={"project_id": PROJECT_ID},
    )
    optional = rq.QueryBinding(
        project_id=PROJECT_ID,
        card_id="card_magentic",
        binding_id="operation-ref:2",
        query_id="agentgraph.active_context_identities",
        query_version=2,
        delivery_mode="optional",
        parameters={"project_id": PROJECT_ID},
    )
    execution = rq.QueryExecution(
        execution_id="queryexec:one",
        binding_id=required.binding_id,
        query_id=required.query_id,
        query_version=required.query_version,
        parameters=required.parameters,
        graph_view_id="graphview:query:one",
        rows=[{"assignment_id": "assignment:one"}],
        truncated=False,
    )
    assignment = {
        "assignmentId": "assignment:one",
        "instructionId": "instruction:one",
        "instruction": "Approved task.",
        "instructionSha256": "sha256:one",
        "correlationId": "run:one",
        "conversationId": "main",
        "deckId": "deck_builder",
        "operationReferences": [
            {
                "referenceId": "operation-ref:1",
                "operationId": required.query_id,
                "version": 2,
                "executionRole": "required_context",
                "parameters": required.parameters,
            },
            {
                "referenceId": "operation-ref:2",
                "operationId": optional.query_id,
                "version": 2,
                "executionRole": "optional_tool",
                "parameters": optional.parameters,
            },
        ],
    }
    monkeypatch.setattr(
        rq,
        "bindings_from_operation_references",
        lambda **_kwargs: [required, optional],
    )
    monkeypatch.setattr(control_plane, "_load_deck", lambda *_args: ({}, None))
    monkeypatch.setattr(
        control_plane,
        "_find_card",
        lambda *_args: {
            "kind": "agent",
            "enabled": True,
            "runtimeOptions": {"tools": ["agentgraph.inspect"]},
        },
    )
    monkeypatch.setattr(
        "app.python_models.agentgraph.read_assignment",
        lambda **_kwargs: assignment,
    )
    monkeypatch.setattr(
        "app.python_models.agentgraph.claim_assignment",
        lambda **_kwargs: {
            "instructionId": "instruction:one",
            "instructionSha256": "sha256:one",
            "correlationId": "run:one",
            "instruction": "Approved task.",
            "claimToken": "claim:one",
        },
    )
    monkeypatch.setattr(
        rq,
        "execute_binding",
        lambda *_args, **_kwargs: (events.append("required") or execution),
    )

    hydrated = rq.hydrate_assignment_context(
        project_id=PROJECT_ID,
        assignment_id="assignment:one",
        receiver_card_id="card_magentic",
    )

    assert events == ["required"]
    assert hydrated.optional_bindings == (optional,)
    assert "graphview:query:one" in hydrated.model_context


def test_required_hydration_failure_finishes_only_the_assignment(
    monkeypatch,
) -> None:
    required = rq.QueryBinding(
        project_id=PROJECT_ID,
        card_id="card_magentic",
        binding_id="operation-ref:1",
        query_id="agentgraph.active_context_identities",
        query_version=2,
        delivery_mode="required",
        parameters={"project_id": PROJECT_ID},
    )
    finished: list[dict] = []
    monkeypatch.setattr(
        "app.python_models.agentgraph.read_assignment",
        lambda **_kwargs: {
            "assignmentId": "assignment:one",
            "instructionId": "instruction:one",
            "instruction": "Approved task.",
            "instructionSha256": "sha256:one",
            "correlationId": "run:one",
            "conversationId": "main",
            "deckId": "deck_builder",
            "operationReferences": [
                {
                    "referenceId": "operation-ref:1",
                    "operationId": required.query_id,
                    "version": required.query_version,
                    "executionRole": "required_context",
                    "parameters": required.parameters,
                }
            ],
        },
    )
    monkeypatch.setattr(control_plane, "_load_deck", lambda *_args: ({}, None))
    monkeypatch.setattr(
        control_plane,
        "_find_card",
        lambda *_args: {
            "kind": "agent",
            "enabled": True,
            "runtimeOptions": {"tools": ["agentgraph.inspect"]},
        },
    )
    monkeypatch.setattr(
        rq,
        "bindings_from_operation_references",
        lambda **_kwargs: [required],
    )
    monkeypatch.setattr(
        "app.python_models.agentgraph.claim_assignment",
        lambda **_kwargs: {
            "instructionId": "instruction:one",
            "instructionSha256": "sha256:one",
            "correlationId": "run:one",
            "instruction": "Approved task.",
            "claimToken": "claim:one",
        },
    )
    monkeypatch.setattr(
        rq,
        "execute_binding",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(RuntimeError("database down")),
    )
    monkeypatch.setattr(
        "app.python_models.agentgraph.finish_assignment",
        lambda **kwargs: finished.append(kwargs),
    )

    with pytest.raises(RuntimeError, match="registered_operation_materialization_failed"):
        rq.hydrate_assignment_context(
            project_id=PROJECT_ID,
            assignment_id="assignment:one",
            receiver_card_id="card_magentic",
        )

    assert finished[0]["assignment_id"] == "assignment:one"
    assert finished[0]["status"] == "failed"
    assert finished[0]["error_code"] == "registered_operation_materialization_failed"


def test_optional_tool_cannot_execute_another_assignments_binding(monkeypatch) -> None:
    binding = rq.QueryBinding(
        project_id=PROJECT_ID,
        card_id="card_magentic",
        binding_id="operation-ref:1",
        query_id="agentgraph.active_context_identities",
        query_version=2,
        delivery_mode="optional",
        parameters={"project_id": PROJECT_ID},
    )
    calls: list[str] = []
    monkeypatch.setattr(
        rq,
        "execute_binding",
        lambda selected, **_kwargs: (
            calls.append(selected.binding_id)
            or rq.QueryExecution(
                execution_id="queryexec:optional",
                binding_id=selected.binding_id,
                query_id=selected.query_id,
                query_version=selected.query_version,
                parameters=selected.parameters,
                graph_view_id="graphview:query:optional",
                rows=[],
                truncated=False,
            )
        ),
    )
    tool = rq.build_bound_query_tool(
        [binding],
        correlation_id="run:one",
        assignment_id="assignment:one",
        conversation_id="main",
    )

    with pytest.raises(ValueError, match="binding_not_assigned"):
        asyncio.run(tool._func("operation-ref:other"))
    result = asyncio.run(tool._func("operation-ref:1"))

    assert calls == ["operation-ref:1"]
    assert result["graphViewId"] == "graphview:query:optional"


def test_optional_tool_failure_does_not_finish_the_assignment(monkeypatch) -> None:
    binding = rq.QueryBinding(
        project_id=PROJECT_ID,
        card_id="card_search",
        binding_id="operation-ref:1",
        query_id="agentgraph.active_context_identities",
        query_version=2,
        delivery_mode="optional",
        parameters={"project_id": PROJECT_ID},
    )
    finished: list[dict] = []
    monkeypatch.setattr(
        rq,
        "execute_binding",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            RuntimeError("optional operation unavailable")
        ),
    )
    monkeypatch.setattr(
        "app.python_models.agentgraph.finish_assignment",
        lambda **kwargs: finished.append(kwargs),
    )
    tool = rq.build_bound_query_tool(
        [binding],
        correlation_id="run:one",
        assignment_id="assignment:one",
        conversation_id="main",
    )

    with pytest.raises(RuntimeError, match="optional operation unavailable"):
        asyncio.run(tool._func("operation-ref:1"))

    assert finished == []


def test_hydration_resolves_selected_graph_view_and_saved_card_reference(
    monkeypatch,
) -> None:
    from app import control_plane
    from app.python_models import agentgraph
    from app.python_models import thinkgraph_engraphis

    assignment = {
        "assignmentId": "assignment:one",
        "instructionId": "instruction:one",
        "instruction": "Use the selected bounded context.",
        "instructionSha256": "sha256:one",
        "correlationId": "correlation:one",
        "deckId": "deck_builder",
        "conversationId": "main",
        "receiverCardId": "card_agent",
        "contextReferences": [],
        "operationReferences": [],
        "parentContinuity": None,
    }
    view = {
        "viewId": "graphview:one",
        "displayLabel": "Selected project context",
        "authority": "mixed",
        "receivingRole": "research",
        "records": [
            {
                "canonicalId": "thinkgraph:decision:one",
                "authority": "thinkgraph",
                "summary": "Use the canonical AgentGraph assignment.",
            }
        ],
        "provenanceRefs": [
            "thinkgraph:decision:one",
            "codegraph:symbol:one",
        ],
    }
    references: list[dict] = []
    monkeypatch.setattr(agentgraph, "read_assignment", lambda **_kwargs: dict(assignment))
    monkeypatch.setattr(
        agentgraph,
        "add_assignment_references",
        lambda **kwargs: references.extend(kwargs["references"]),
    )
    monkeypatch.setattr(
        agentgraph,
        "claim_assignment",
        lambda **_kwargs: {
            "instructionId": "instruction:one",
            "instructionSha256": "sha256:one",
            "correlationId": "correlation:one",
            "instruction": "Use the selected bounded context.",
            "claimToken": "claim:one",
        },
    )
    monkeypatch.setattr(
        control_plane,
        "_load_deck",
        lambda *_args: (
            {
                "nodes": [
                    {
                        "id": "card_agent",
                        "kind": "agent",
                        "runtimeOptions": {"tools": []},
                    }
                ]
            },
            "revision",
        ),
    )
    monkeypatch.setattr(
        control_plane,
        "resolve_saved_card_reference",
        lambda *_args, **_kwargs: {
            "cardId": "card_agent",
            "role": "research",
            "runtimeType": "assistant_agent",
            "runtimeBinding": "research_agent",
            "tools": [],
        },
    )
    monkeypatch.setattr(
        thinkgraph_engraphis,
        "get_thinkgraph",
        lambda: type(
            "ThinkGraph",
            (),
            {
                "graph_views": lambda _self, _project, _conversation: {
                    "views": [view]
                }
            },
        )(),
    )
    monkeypatch.setattr(rq, "bindings_from_operation_references", lambda **_kwargs: [])

    hydrated = rq.hydrate_assignment_context(
        project_id="project-one",
        assignment_id="assignment:one",
        receiver_card_id="card_agent",
        graph_view_ids=["graphview:one"],
    )

    assert "graphview:one" in hydrated.model_context
    assert "Use the canonical AgentGraph assignment." in hydrated.model_context
    assert "[AGENTGRAPH_CONTEXT_REFERENCES]" not in hydrated.model_context
    assert "[PARENT_AGENTGRAPH_CONTINUITY]" not in hydrated.model_context
    assert "REGISTERED DATABASE CONTEXT:" not in hydrated.model_context
    assert "OPTIONAL REGISTERED OPERATIONS" not in hydrated.model_context
    assert references == [
        {
            "referenceId": "graphview:one",
            "referenceType": "graph_view",
            "required": True,
        },
        {
            "referenceId": "thinkgraph:decision:one",
            "referenceType": "thinkgraph",
            "required": False,
        },
        {
            "referenceId": "codegraph:symbol:one",
            "referenceType": "codegraph",
            "required": False,
        },
    ]


def test_empty_agentgraph_context_sections_render_nothing() -> None:
    assert rq.build_query_context([], []) == ""
    assert rq._render_selected_graph_views([]) == ""
