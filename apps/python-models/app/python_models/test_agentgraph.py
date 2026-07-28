from __future__ import annotations

from uuid import uuid4

import pytest

from app.python_models import agentgraph as ag
from app.python_models.postgres import connect_postgres


PROJECT_ID = "20ac92da-01fd-4cf6-97cc-0672421e751a"
DECK_ID = "deck_builder"


def test_assignment_claim_heartbeat_finish_and_hydration() -> None:
    correlation = f"agentgraph-test-{uuid4().hex}"
    connection = connect_postgres(autocommit=False)
    try:
        instruction = ag.create_instruction(
            project_id=PROJECT_ID,
            deck_id=DECK_ID,
            conversation_id="main",
            body="  Exact instruction bytes.\n",
            prepared_by_card_id="card_main_chat",
            operation_references=[
                {
                    "operationId": "agentgraph.active_context_identities",
                    "version": 2,
                    "parameters": {"project_id": PROJECT_ID},
                    "executionRole": "optional_tool",
                }
            ],
            connection=connection,
        )
        kwargs = dict(
            project_id=PROJECT_ID,
            deck_id=DECK_ID,
            conversation_id="main",
            correlation_id=correlation,
            sender_card_id="card_main_chat",
            receiver_card_id="card_magentic",
            instruction_id=instruction["instructionId"],
            connection=connection,
        )
        assignment = ag.create_assignment(**kwargs)
        assert ag.create_assignment(**kwargs)["state"] == "existing"
        claim = ag.claim_assignment(
            project_id=PROJECT_ID,
            assignment_id=assignment["assignmentId"],
            receiver_card_id="card_magentic",
            lease_seconds=30,
            connection=connection,
        )
        assert claim["instruction"] == "  Exact instruction bytes.\n"
        assert ag.heartbeat_assignment(
            project_id=PROJECT_ID,
            assignment_id=assignment["assignmentId"],
            lease_token=claim["leaseToken"],
            lease_seconds=30,
            connection=connection,
        )["attempt"] == 1
        ag.record_assignment_runtime_context(
            project_id=PROJECT_ID,
            assignment_id=assignment["assignmentId"],
            runtime="assistant_agent",
            provider="openrouter",
            model_key="model-key",
            provider_model_id="provider/model",
            profile_id=None,
            profile_version=None,
            skill_versions=["skill-one@v2"],
            data_binding_refs=[{"bindingType": "database", "bindingRef": "db:one"}],
            connection=connection,
        )
        tool_evidence = [
            {
                "callId": "call-one",
                "toolName": "agentgraph.inspect",
                "event": "ToolCallExecutionEvent",
                "status": "completed",
            }
        ]
        first = ag.finish_assignment(
            project_id=PROJECT_ID,
            assignment_id=assignment["assignmentId"],
            lease_token=claim["leaseToken"],
            status="completed",
            output="Exact result.",
            tool_evidence=tool_evidence,
            connection=connection,
        )
        assert first["created"] is True
        assert ag.finish_assignment(
            project_id=PROJECT_ID,
            assignment_id=assignment["assignmentId"],
            lease_token=claim["leaseToken"],
            status="completed",
            output="Exact result.",
            tool_evidence=tool_evidence,
            connection=connection,
        )["created"] is False
        with pytest.raises(ag.AgentGraphError, match="already_terminal"):
            ag.finish_assignment(
                project_id=PROJECT_ID,
                assignment_id=assignment["assignmentId"],
                lease_token=claim["leaseToken"],
                status="failed",
                error_code="late",
                error_detail="late",
                connection=connection,
            )
        hydrated = ag.read_assignment(
            project_id=PROJECT_ID,
            assignment_id=assignment["assignmentId"],
            receiving_card_id="card_magentic",
            connection=connection,
        )
        assert hydrated["instruction"] == "  Exact instruction bytes.\n"
        assert hydrated["result"]["output"] == "Exact result."
        assert hydrated["result"]["toolEvidence"] == tool_evidence
        assert hydrated["runTrace"]["runtime"] == "assistant_agent"
        assert hydrated["runTrace"]["provider"] == "openrouter"
        assert hydrated["runTrace"]["providerModelId"] == "provider/model"
        assert hydrated["runTrace"]["skillVersions"] == ["skill-one@v2"]
        assert hydrated["runTrace"]["dataBindingRefs"] == [
            {"bindingRef": "db:one", "bindingType": "database"}
        ]
        assert hydrated["operationReferences"][0]["operationId"] == "agentgraph.active_context_identities"
        assert hydrated["operationReferences"][0]["executionRole"] == "optional_tool"
        assert "body" not in hydrated["ageIdentity"]["instruction"]
        scoped = ag.inspect_assignments(
            project_id=PROJECT_ID,
            deck_id=DECK_ID,
            conversation_id="main",
            connection=connection,
        )
        assert any(
            row["assignmentId"] == assignment["assignmentId"]
            for row in scoped["assignments"]
        )
        project_wide = ag.inspect_assignments(
            project_id=PROJECT_ID,
            deck_id=DECK_ID,
            conversation_id=None,
            project_wide=True,
            connection=connection,
        )
        inspected = next(
            row
            for row in project_wide["assignments"]
            if row["assignmentId"] == assignment["assignmentId"]
        )
        assert project_wide["readScope"] == "project"
        assert inspected["conversationId"] == "main"
    finally:
        connection.rollback()
        connection.close()


def test_sender_can_cancel_pending_assignment_idempotently() -> None:
    correlation = f"agentgraph-cancel-{uuid4().hex}"
    connection = connect_postgres(autocommit=False)
    try:
        instruction = ag.create_instruction(
            project_id=PROJECT_ID,
            deck_id=DECK_ID,
            conversation_id="main",
            body="Cancel this pending work.",
            prepared_by_card_id="card_main_chat",
            connection=connection,
        )
        assignment = ag.create_assignment(
            project_id=PROJECT_ID,
            deck_id=DECK_ID,
            conversation_id="main",
            correlation_id=correlation,
            sender_card_id="card_main_chat",
            receiver_card_id="card_magentic",
            instruction_id=instruction["instructionId"],
            connection=connection,
        )
        cancelled = ag.cancel_assignment(
            project_id=PROJECT_ID,
            assignment_id=assignment["assignmentId"],
            requested_by_card_id="card_main_chat",
            reason="User cancelled.",
            connection=connection,
        )
        assert cancelled["created"] is True
        assert ag.cancel_assignment(
            project_id=PROJECT_ID,
            assignment_id=assignment["assignmentId"],
            requested_by_card_id="card_main_chat",
            reason="User cancelled.",
            connection=connection,
        )["created"] is False
    finally:
        connection.rollback()
        connection.close()


def test_instruction_references_reject_raw_query_unknown_and_disabled_versions() -> None:
    connection = connect_postgres(autocommit=False)
    try:
        with pytest.raises(ag.AgentGraphError, match="keys_unknown"):
            ag.create_instruction(
                project_id=PROJECT_ID,
                deck_id=DECK_ID,
                conversation_id="main",
                body="Invalid raw statement.",
                operation_references=[
                    {
                        "operationId": "agentgraph.active_context_identities",
                        "version": 2,
                        "executionRole": "required_context",
                        "parameters": {"project_id": PROJECT_ID},
                        "sql": "SELECT 1",
                    }
                ],
                connection=connection,
            )
        with pytest.raises(ag.AgentGraphError, match="registered_query_not_found"):
            ag.create_instruction(
                project_id=PROJECT_ID,
                deck_id=DECK_ID,
                conversation_id="main",
                body="Unknown operation.",
                operation_references=[
                    {
                        "operationId": "agentgraph.missing",
                        "version": 1,
                        "executionRole": "required_context",
                        "parameters": {},
                    }
                ],
                connection=connection,
            )
        with connection.cursor() as cursor:
            cursor.execute(
                """
                UPDATE ag_catalog.registered_queries
                SET disabled_at=now()
                WHERE project_id=%s
                  AND query_id='agentgraph.active_context_identities'
                """,
                (PROJECT_ID,),
            )
        with pytest.raises(ag.AgentGraphError, match="registered_query_disabled"):
            ag.create_instruction(
                project_id=PROJECT_ID,
                deck_id=DECK_ID,
                conversation_id="main",
                body="Disabled operation.",
                operation_references=[
                    {
                        "operationId": "agentgraph.active_context_identities",
                        "version": 2,
                        "executionRole": "required_context",
                        "parameters": {"project_id": PROJECT_ID},
                    }
                ],
                connection=connection,
            )
    finally:
        connection.rollback()
        connection.close()
