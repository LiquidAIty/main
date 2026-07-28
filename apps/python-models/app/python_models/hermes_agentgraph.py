"""Exact Hermes report correlation on the canonical AgentGraph assignment.

Hermes/OpenClaude conversational and private key/value memory remain native.
This module owns only the shared durable assignment, stable references, and
terminal report result that other agents may retrieve by exact parent run.
"""

from __future__ import annotations

from typing import Any

from app import control_plane
from app.python_models import agentgraph as ag
from app.python_models.postgres import connect_postgres


def _parent_run(parent_run_id: str) -> dict[str, Any]:
    with connect_postgres() as connection, connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT project_id, deck_id, conversation_id, card_id, session_id,
                   user_message_id
            FROM ag_catalog.card_run_traces
            WHERE correlation_id=%s
            """,
            (parent_run_id,),
        )
        rows = cursor.fetchall()
        if not rows:
            raise LookupError(f"hermes_parent_run_not_found: {parent_run_id}")
        if len(rows) != 1:
            raise RuntimeError(f"hermes_parent_run_ambiguous: {parent_run_id}")
        row = rows[0]
        if not row[5]:
            raise LookupError(
                f"hermes_parent_instruction_message_not_found: {parent_run_id}"
            )
        cursor.execute(
            """
            SELECT content
            FROM ag_catalog.conversation_messages
            WHERE project_id::text=%s AND message_id=%s AND role='user'
            """,
            (str(row[0]), str(row[5])),
        )
        message = cursor.fetchone()
        if message is None:
            raise LookupError(
                f"hermes_parent_instruction_message_not_found: {parent_run_id}"
            )
    return {
        "projectId": str(row[0]),
        "deckId": str(row[1]),
        "conversationId": str(row[2]),
        "senderCardId": str(row[3]),
        "nativeSessionId": str(row[4] or ""),
        "userMessageId": str(row[5]),
        "instruction": str(message[0]),
    }


def _saved_receiver(
    project_id: str,
    deck_id: str,
    receiver_card_id: str,
) -> None:
    deck, _revision = control_plane._load_deck(project_id, deck_id)
    card = control_plane._find_card(deck, receiver_card_id)
    if str(card.get("kind") or "") != "agent" or card.get("enabled") is False:
        raise PermissionError(f"hermes_receiver_card_invalid: {receiver_card_id}")


def _stable_references(
    *,
    parent: dict[str, Any],
    thinkgraph_ids: list[str],
    knowgraph_refs: list[str],
    codegraph_refs: list[str],
) -> list[dict[str, Any]]:
    references: list[dict[str, Any]] = [
        {
            "referenceId": parent["userMessageId"],
            "referenceType": "conversation_message",
            "required": True,
        }
    ]
    if parent["nativeSessionId"]:
        references.append(
            {
                "referenceId": parent["nativeSessionId"],
                "referenceType": "native_session",
                "required": False,
            }
        )
    references.extend(
        {
            "referenceId": value,
            "referenceType": reference_type,
            "required": False,
        }
        for reference_type, values in (
            ("thinkgraph", thinkgraph_ids),
            ("knowgraph", knowgraph_refs),
            ("codegraph", codegraph_refs),
        )
        for value in values
    )
    return references


def write_hermes_report(
    *,
    parent_run_id: str,
    receiver_card_id: str,
    report_markdown: str,
    summary: str,
    thinkgraph_ids: list[str],
    knowgraph_refs: list[str],
    codegraph_refs: list[str],
) -> dict[str, Any]:
    """Persist one terminal Hermes result for one exact native parent run."""
    existing = read_hermes_report(
        parent_run_id=parent_run_id,
        receiver_card_id=receiver_card_id,
    )
    if existing is not None:
        if (
            existing["reportMarkdown"] == report_markdown
            and existing["summary"] == summary
        ):
            return {
                "ok": True,
                "reportId": existing["reportId"],
                "assignmentId": existing["assignmentId"],
                "instructionId": existing["instructionId"],
                "parentRunId": parent_run_id,
                "nativeSessionId": existing["nativeSessionId"],
                "status": "existing",
                "summary": summary,
            }
        raise RuntimeError(f"hermes_report_already_terminal: {parent_run_id}")
    parent = _parent_run(parent_run_id)
    _saved_receiver(parent["projectId"], parent["deckId"], receiver_card_id)
    correlation_id = f"hermes:{parent_run_id}"
    # Instruction, assignment, references, and terminal result are one durable
    # boundary. A transport/process failure cannot leave an orphan instruction
    # that makes the exact parent run impossible to retry.
    with connect_postgres(autocommit=False) as connection:
        instruction = ag.create_instruction(
            project_id=parent["projectId"],
            deck_id=parent["deckId"],
            conversation_id=parent["conversationId"],
            body=parent["instruction"],
            prepared_by_card_id=parent["senderCardId"],
            connection=connection,
        )
        assignment = ag.create_assignment(
            project_id=parent["projectId"],
            deck_id=parent["deckId"],
            conversation_id=parent["conversationId"],
            correlation_id=correlation_id,
            sender_card_id=parent["senderCardId"],
            receiver_card_id=receiver_card_id,
            instruction_id=instruction["instructionId"],
            parent_correlation_id=parent_run_id,
            connection=connection,
        )
        claim = ag.claim_assignment(
            project_id=parent["projectId"],
            assignment_id=assignment["assignmentId"],
            receiver_card_id=receiver_card_id,
            connection=connection,
        )
        ag.add_assignment_references(
            project_id=parent["projectId"],
            assignment_id=assignment["assignmentId"],
            receiver_card_id=receiver_card_id,
            references=_stable_references(
                parent=parent,
                thinkgraph_ids=thinkgraph_ids,
                knowgraph_refs=knowgraph_refs,
                codegraph_refs=codegraph_refs,
            ),
            connection=connection,
        )
        completed = ag.finish_assignment(
            project_id=parent["projectId"],
            assignment_id=assignment["assignmentId"],
            lease_token=claim["leaseToken"],
            status="completed",
            output=report_markdown,
            summary=summary,
            connection=connection,
        )
    return {
        "ok": True,
        "reportId": completed["resultId"],
        "assignmentId": assignment["assignmentId"],
        "instructionId": instruction["instructionId"],
        "parentRunId": parent_run_id,
        "nativeSessionId": parent["nativeSessionId"] or None,
        "status": "created",
        "summary": summary,
    }


def read_hermes_report(
    *,
    parent_run_id: str,
    receiver_card_id: str,
) -> dict[str, Any] | None:
    """Read the one exact linked result; never scan or choose a latest report."""
    with connect_postgres() as connection, connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT project_id, assignment_id
            FROM ag_catalog.agent_assignments
            WHERE parent_run_id=%s AND receiver_card_id=%s
            ORDER BY assignment_id
            """,
            (parent_run_id, receiver_card_id),
        )
        rows = cursor.fetchall()
    if not rows:
        return None
    if len(rows) != 1:
        raise RuntimeError(f"hermes_parent_assignment_ambiguous: {parent_run_id}")
    assignment = ag.read_assignment(
        project_id=str(rows[0][0]),
        assignment_id=str(rows[0][1]),
        receiving_card_id=receiver_card_id,
    )
    result = assignment.get("result")
    if not result:
        return None
    return {
        "reportId": result["resultId"],
        "assignmentId": assignment["assignmentId"],
        "instructionId": assignment["instructionId"],
        "projectId": str(rows[0][0]),
        "conversationId": assignment["conversationId"],
        "parentRunId": parent_run_id,
        "nativeSessionId": assignment["nativeSessionId"],
        "status": result["status"],
        "summary": result["summary"],
        "reportMarkdown": result["output"],
        "contextReferences": assignment["contextReferences"],
    }
