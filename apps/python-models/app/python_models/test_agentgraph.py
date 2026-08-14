from __future__ import annotations

from uuid import uuid4

import pytest

from app.python_models import agentgraph as ag
from app.python_models.postgres import connect_postgres


PROJECT_ID = "20ac92da-01fd-4cf6-97cc-0672421e751a"
DECK_ID = "deck_builder"


def test_postgres_connection_names_missing_injected_password(monkeypatch) -> None:
    monkeypatch.delenv("POSTGRES_PASSWORD", raising=False)

    with pytest.raises(RuntimeError, match="missing_required_config: POSTGRES_PASSWORD"):
        connect_postgres()


def test_assignment_claim_finish_and_hydration() -> None:
    correlation = f"agentgraph-test-{uuid4().hex}"
    connection = connect_postgres(autocommit=False)
    try:
        instruction = ag.create_instruction(
            project_id=PROJECT_ID,
            deck_id=DECK_ID,
            conversation_id="main",
            body="  Exact instruction bytes.\n",
            prepared_by_card_id="card_main_chat",
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
            connection=connection,
        )
        assert claim["instruction"] == "  Exact instruction bytes.\n"
        ag.record_assignment_runtime_context(
            project_id=PROJECT_ID,
            assignment_id=assignment["assignmentId"],
            runtime="assistant_agent",
            provider="openrouter",
            model_key="model-key",
            provider_model_id="provider/model",
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
            claim_token=claim["claimToken"],
            status="completed",
            output="Exact result.",
            tool_evidence=tool_evidence,
            connection=connection,
        )
        assert first["created"] is True
        assert ag.finish_assignment(
            project_id=PROJECT_ID,
            assignment_id=assignment["assignmentId"],
            claim_token=claim["claimToken"],
            status="completed",
            output="Exact result.",
            tool_evidence=tool_evidence,
            connection=connection,
        )["created"] is False
        with pytest.raises(ag.AgentGraphError, match="already_terminal"):
            ag.finish_assignment(
                project_id=PROJECT_ID,
                assignment_id=assignment["assignmentId"],
                claim_token=claim["claimToken"],
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
        assert "operationReferences" not in hydrated
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


def test_worldsignals_reference_is_relational_and_linked_to_assignment_in_age() -> None:
    correlation = f"agentgraph-worldsignals-{uuid4().hex}"
    reference_id = f"worldsignals:command:{uuid4().hex}"
    connection = connect_postgres(autocommit=False)
    try:
        instruction = ag.create_instruction(
            project_id=PROJECT_ID,
            deck_id=DECK_ID,
            conversation_id="main",
            body="Use one current WorldSignals result.",
            prepared_by_card_id="card_main_chat",
            connection=connection,
        )
        assignment = ag.create_assignment(
            project_id=PROJECT_ID,
            deck_id=DECK_ID,
            conversation_id="main",
            correlation_id=correlation,
            sender_card_id="card_main_chat",
            receiver_card_id="card_worldsignals_agent",
            instruction_id=instruction["instructionId"],
            connection=connection,
        )
        ag.add_assignment_references(
            project_id=PROJECT_ID,
            assignment_id=assignment["assignmentId"],
            receiver_card_id="card_worldsignals_agent",
            references=[
                {
                    "referenceId": reference_id,
                    "referenceType": "worldsignals",
                    "required": False,
                }
            ],
            connection=connection,
        )
        hydrated = ag.read_assignment(
            project_id=PROJECT_ID,
            assignment_id=assignment["assignmentId"],
            receiving_card_id="card_worldsignals_agent",
            connection=connection,
        )
        assert hydrated["contextReferences"] == [
            {
                "referenceId": reference_id,
                "referenceType": "worldsignals",
                "required": False,
            }
        ]
        with connection.cursor() as cursor:
            rows = ag._run_cypher(
                cursor,
                """
                MATCH (assignment:Assignment)-[:REFERENCES]->
                      (reference:WorldSignalsReference)
                WHERE assignment.assignmentId=$assignmentId
                  AND assignment.projectId=$projectId
                  AND reference.referenceId=$referenceId
                RETURN reference.referenceId
                """,
                "reference_id agtype",
                {
                    "assignmentId": assignment["assignmentId"],
                    "projectId": PROJECT_ID,
                    "referenceId": reference_id,
                },
            )
        assert rows
    finally:
        connection.rollback()
        connection.close()
