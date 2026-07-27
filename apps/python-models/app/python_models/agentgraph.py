"""Minimal PostgreSQL AGE transport for durable agent-to-agent handoffs.

AgentGraph references saved card identities and owns only bounded handoff
instructions, call lineage, status, and correlated results. Permanent card
prompt/model/tool/permission configuration remains in the relational deck.
"""

from __future__ import annotations

import json
import re
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from hashlib import sha256
from typing import Any, Callable, Iterator
from uuid import uuid4

from app.python_models.postgres import connect_postgres


_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$")
_GRAPH_NAME = "agentgraph"
_HANDOFF_STATUSES = {"pending", "running", "completed", "failed", "cancelled"}
_MAX_HANDOFF_CHARS = 100_000
_MAX_RESULT_CHARS = 100_000
_MAX_ERROR_CHARS = 8_000
_MAX_INSTRUCTION_CHARS = 200_000


class AgentGraphError(ValueError):
    """Typed, user-visible AgentGraph contract failure."""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _required_id(value: Any, field: str) -> str:
    text = str(value or "").strip()
    if not _ID.fullmatch(text):
        raise AgentGraphError(f"agentgraph_{field}_invalid")
    return text


def _required_text(value: Any, field: str) -> str:
    text = str(value or "").strip()
    if not text:
        raise AgentGraphError(f"agentgraph_{field}_invalid")
    return text


def _required_markdown(value: Any, field: str = "markdown") -> str:
    if not isinstance(value, str) or not value.strip():
        raise AgentGraphError(f"agentgraph_{field}_invalid")
    if len(value) > _MAX_HANDOFF_CHARS:
        raise AgentGraphError(f"agentgraph_{field}_too_large")
    return value


def _optional_markdown(value: Any) -> str | None:
    if value is None or value == "":
        return None
    if not isinstance(value, str):
        raise AgentGraphError("agentgraph_result_markdown_invalid")
    if len(value) > _MAX_RESULT_CHARS:
        raise AgentGraphError("agentgraph_result_markdown_too_large")
    return value


def _optional_text(value: Any, field: str) -> str | None:
    if value is None or value == "":
        return None
    if not isinstance(value, str) or not value.strip():
        raise AgentGraphError(f"agentgraph_{field}_invalid")
    return value


def _status(value: Any) -> str:
    status = _required_text(value, "status").lower()
    if status not in _HANDOFF_STATUSES:
        raise AgentGraphError(f"agentgraph_status_invalid: {status}")
    return status


def _optional_error(value: Any) -> str | None:
    if value is None or value == "":
        return None
    if not isinstance(value, str):
        raise AgentGraphError("agentgraph_result_error_invalid")
    if len(value) > _MAX_ERROR_CHARS:
        raise AgentGraphError("agentgraph_result_error_too_large")
    return value


def _default_agent_validator(project_id: str, deck_id: str, agent_id: str) -> None:
    from app import control_plane

    deck, _revision = control_plane._load_deck(project_id, deck_id)
    card = next(
        (node for node in deck.get("nodes") or [] if str(node.get("id") or "") == agent_id),
        None,
    )
    if not isinstance(card, dict):
        raise AgentGraphError(f"agentgraph_agent_not_found: {agent_id}")
    if str(card.get("kind") or "") != "agent" or card.get("enabled") is False:
        raise AgentGraphError(f"agentgraph_agent_invalid: {agent_id}")


@contextmanager
def _connection_scope(connection: Any | None) -> Iterator[Any]:
    if connection is not None:
        yield connection
        return
    with connect_postgres(autocommit=False) as owned:
        yield owned


def _prepare(cursor: Any) -> None:
    cursor.execute("LOAD 'age'")
    cursor.execute('SET search_path = ag_catalog, "$user", public')


def _run_cypher(
    cursor: Any,
    query: str,
    columns: str,
    params: dict[str, Any],
) -> list[tuple[Any, ...]]:
    cursor.execute(
        f"SELECT * FROM cypher('{_GRAPH_NAME}', $$ {query} $$, %s::agtype) AS ({columns})",
        (json.dumps(params, ensure_ascii=False, separators=(",", ":")),),
    )
    return list(cursor.fetchall())


def _read_context_payload(
    cursor: Any,
    project_id: str,
    context_id: str,
) -> dict[str, Any] | None:
    cursor.execute(
        """
        SELECT context_id, project_id, deck_id, conversation_id, sender_agent_id,
               receiving_agent_id, markdown, producing_run_id, parent_context_id,
               status, created_at, updated_at, completed_at
        FROM ag_catalog.agent_context_payloads
        WHERE project_id=%s AND context_id=%s
        """,
        (project_id, context_id),
    )
    row = cursor.fetchone()
    if row is None:
        return None
    keys = (
        "context_id",
        "project_id",
        "deck_id",
        "conversation_id",
        "sender_agent_id",
        "receiving_agent_id",
        "markdown",
        "producing_run_id",
        "parent_context_id",
        "status",
        "created_at",
        "updated_at",
        "completed_at",
    )
    return dict(zip(keys, row))


def create_context(
    *,
    project_id: str,
    deck_id: str,
    conversation_id: str,
    sender_agent_id: str,
    receiving_agent_id: str,
    markdown: str,
    parent_context_id: str | None = None,
    producing_run_id: str | None = None,
    agent_validator: Callable[[str, str, str], None] = _default_agent_validator,
    connection: Any | None = None,
) -> dict[str, Any]:
    project_id = _required_text(project_id, "project_id")
    deck_id = _required_text(deck_id, "deck_id")
    conversation_id = _required_text(conversation_id, "conversation_id")
    sender_agent_id = _required_id(sender_agent_id, "sender_agent_id")
    receiving_agent_id = _required_id(receiving_agent_id, "receiving_agent_id")
    markdown = _required_markdown(markdown)
    parent_context_id = (
        _required_id(parent_context_id, "parent_context_id") if parent_context_id else None
    )
    producing_run_id = _optional_text(producing_run_id, "producing_run_id")

    agent_validator(project_id, deck_id, sender_agent_id)
    agent_validator(project_id, deck_id, receiving_agent_id)

    context_id = f"agentctx:{uuid4().hex[:24]}"
    created_at = _now()
    params: dict[str, Any] = {
        "contextId": context_id,
        "projectId": project_id,
        "deckId": deck_id,
        "conversationId": conversation_id,
        "senderAgentId": sender_agent_id,
        "receivingAgentId": receiving_agent_id,
        "status": "pending",
        "createdAt": created_at,
    }
    producing_property = ""
    if producing_run_id is not None:
        params["producingRunId"] = producing_run_id
        producing_property = ", producingRunId: $producingRunId"

    with _connection_scope(connection) as conn, conn.cursor() as cursor:
        _prepare(cursor)
        if parent_context_id is not None:
            parent = _read_context_payload(cursor, project_id, parent_context_id)
            if parent is None:
                raise AgentGraphError(
                    f"agentgraph_parent_context_not_found: {parent_context_id}"
                )

        cursor.execute(
            """
            INSERT INTO ag_catalog.agent_context_payloads
              (context_id, project_id, deck_id, conversation_id, sender_agent_id,
               receiving_agent_id, markdown, producing_run_id, parent_context_id,
               status, created_at, updated_at)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,'pending',%s,%s)
            """,
            (
                context_id,
                project_id,
                deck_id,
                conversation_id,
                sender_agent_id,
                receiving_agent_id,
                markdown,
                producing_run_id,
                parent_context_id,
                created_at,
                created_at,
            ),
        )
        _run_cypher(
            cursor,
            f"""
            MERGE (sender:Agent {{
              project_id: $projectId,
              deck_id: $deckId,
              agent_id: $senderAgentId
            }})
            MERGE (receiver:Agent {{
              project_id: $projectId,
              deck_id: $deckId,
              agent_id: $receivingAgentId
            }})
            CREATE (context:AgentContext {{
              contextId: $contextId,
              projectId: $projectId,
              deckId: $deckId,
              conversationId: $conversationId,
              senderAgentId: $senderAgentId,
              receivingAgentId: $receivingAgentId,
              status: $status,
              createdAt: $createdAt
              {producing_property}
            }})
            CREATE (context)-[:SENT_BY]->(sender)
            CREATE (context)-[:SENT_TO]->(receiver)
            RETURN context.contextId
            """,
            "context_id agtype",
            params,
        )
        if parent_context_id is not None:
            _run_cypher(
                cursor,
                """
                MATCH (context:AgentContext), (parent:AgentContext)
                WHERE
                  context.contextId = $contextId
                  AND context.projectId = $projectId
                  AND (parent.contextId = $parentContextId OR parent.context_id = $parentContextId)
                  AND (parent.projectId = $projectId OR parent.project_id = $projectId)
                CREATE (context)-[:CHILD_OF]->(parent)
                RETURN context.contextId
                """,
                "context_id agtype",
                {
                    "projectId": project_id,
                    "contextId": context_id,
                    "parentContextId": parent_context_id,
                },
            )

    return {
        "ok": True,
        "contextId": context_id,
        "projectId": project_id,
        "deckId": deck_id,
        "conversationId": conversation_id,
        "senderAgentId": sender_agent_id,
        "receivingAgentId": receiving_agent_id,
        "status": "pending",
        "parentContextId": parent_context_id,
    }


def read_context(
    context_id: str,
    project_id: str,
    *,
    connection: Any | None = None,
) -> dict[str, Any]:
    context_id = _required_id(context_id, "context_id")
    project_id = _required_text(project_id, "project_id")
    with _connection_scope(connection) as conn, conn.cursor() as cursor:
        _prepare(cursor)
        properties = _read_context_payload(cursor, project_id, context_id)
        if properties is None:
            raise AgentGraphError(f"agentgraph_context_not_found: {context_id}")
    return {
        "ok": True,
        "contextId": str(properties["context_id"]),
        "projectId": str(properties["project_id"]),
        "deckId": str(properties["deck_id"]),
        "conversationId": str(properties["conversation_id"]),
        "senderAgentId": str(properties["sender_agent_id"] or ""),
        "receivingAgentId": str(properties["receiving_agent_id"]),
        "markdown": str(properties["markdown"]),
        "producingRunId": properties["producing_run_id"],
        "parentContextId": properties["parent_context_id"],
        "status": str(properties.get("status") or ""),
        "createdAt": str(properties["created_at"]),
    }


def mark_context_status(
    context_id: str,
    project_id: str,
    status: str,
    *,
    connection: Any | None = None,
) -> dict[str, Any]:
    context_id = _required_id(context_id, "context_id")
    project_id = _required_text(project_id, "project_id")
    status = _status(status)
    updated_at = _now()
    with _connection_scope(connection) as conn, conn.cursor() as cursor:
        _prepare(cursor)
        cursor.execute(
            """
            UPDATE ag_catalog.agent_context_payloads
            SET status=%s, updated_at=%s,
                completed_at=CASE WHEN %s IN ('completed','failed','cancelled') THEN %s ELSE completed_at END
            WHERE context_id=%s AND project_id=%s
            """,
            (status, updated_at, status, updated_at, context_id, project_id),
        )
        if cursor.rowcount != 1:
            raise AgentGraphError(f"agentgraph_context_not_found: {context_id}")
        rows = _run_cypher(
            cursor,
            """
            MATCH (context:AgentContext)
            WHERE
              (context.contextId = $contextId OR context.context_id = $contextId)
              AND (context.projectId = $projectId OR context.project_id = $projectId)
            SET context.status = $status, context.updatedAt = $updatedAt
            RETURN context.contextId
            """,
            "context_id agtype",
            {
                "contextId": context_id,
                "projectId": project_id,
                "status": status,
                "updatedAt": updated_at,
            },
        )
        if not rows:
            raise AgentGraphError(f"agentgraph_context_not_found: {context_id}")
    return {
        "ok": True,
        "contextId": context_id,
        "projectId": project_id,
        "status": status,
        "updatedAt": updated_at,
    }


def record_result(
    *,
    context_id: str,
    project_id: str,
    result_id: str,
    run_id: str,
    status: str,
    markdown: str | None = None,
    result_ref: str | None = None,
    error: str | None = None,
    connection: Any | None = None,
) -> dict[str, Any]:
    context_id = _required_id(context_id, "context_id")
    project_id = _required_text(project_id, "project_id")
    result_id = _required_id(result_id, "result_id")
    run_id = _required_id(run_id, "run_id")
    status = _status(status)
    markdown = _optional_markdown(markdown)
    result_ref = _optional_text(result_ref, "result_ref")
    error = _optional_error(error)
    created_at = _now()

    with _connection_scope(connection) as conn, conn.cursor() as cursor:
        _prepare(cursor)
        context = _read_context_payload(cursor, project_id, context_id)
        if context is None:
            raise AgentGraphError(f"agentgraph_context_not_found: {context_id}")

        cursor.execute(
            """
            SELECT result_id
            FROM ag_catalog.agent_result_payloads
            WHERE context_id=%s AND project_id=%s AND result_id=%s
            """,
            (context_id, project_id, result_id),
        )
        if cursor.fetchone() is not None:
            return {
                "ok": True,
                "created": False,
                "contextId": context_id,
                "resultId": result_id,
            }

        params: dict[str, Any] = {
            "projectId": project_id,
            "conversationId": str(context["conversation_id"]),
            "receivingAgentId": str(context["receiving_agent_id"]),
            "contextId": context_id,
            "resultId": result_id,
            "runId": run_id,
            "status": status,
            "createdAt": created_at,
        }
        cursor.execute(
            """
            INSERT INTO ag_catalog.agent_result_payloads
              (result_id, context_id, project_id, conversation_id, receiving_agent_id,
               run_id, status, markdown, result_ref, error, created_at)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            """,
            (
                result_id,
                context_id,
                project_id,
                str(context["conversation_id"]),
                str(context["receiving_agent_id"]),
                run_id,
                status,
                markdown,
                result_ref,
                error,
                created_at,
            ),
        )
        cursor.execute(
            """
            UPDATE ag_catalog.agent_context_payloads
            SET status=%s, completed_at=%s, updated_at=%s
            WHERE context_id=%s AND project_id=%s
            """,
            (status, created_at, created_at, context_id, project_id),
        )

        rows = _run_cypher(
            cursor,
            """
            MATCH (context:AgentContext)
            WHERE
              (context.contextId = $contextId OR context.context_id = $contextId)
              AND (context.projectId = $projectId OR context.project_id = $projectId)
            CREATE (result:Result {
              resultId: $resultId,
              contextId: $contextId,
              projectId: $projectId,
              conversationId: $conversationId,
              receivingAgentId: $receivingAgentId,
              runId: $runId,
              status: $status,
              createdAt: $createdAt
            }
            CREATE (context)-[:PRODUCED]->(result)
            SET context.status = $status,
                context.completedAt = $createdAt
            RETURN properties(result)
            """,
            "properties agtype",
            params,
        )
        if not rows:
            raise AgentGraphError(f"agentgraph_context_not_found: {context_id}")

    return {
        "ok": True,
        "created": True,
        "contextId": context_id,
        "resultId": result_id,
        "runId": run_id,
        "status": status,
        "markdown": markdown,
        "resultRef": result_ref,
        "error": error,
        "createdAt": created_at,
    }


def create_instruction(
    *,
    project_id: str,
    deck_id: str,
    conversation_id: str,
    body: str,
    prepared_by_card_id: str | None = None,
    connection: Any | None = None,
) -> dict[str, Any]:
    """Persist exact reusable instruction bytes; no filesystem queue or scan."""
    project_id = _required_text(project_id, "project_id")
    deck_id = _required_text(deck_id, "deck_id")
    conversation_id = _required_text(conversation_id, "conversation_id")
    if not isinstance(body, str) or not body.strip():
        raise AgentGraphError("agentgraph_instruction_invalid")
    if len(body) > _MAX_INSTRUCTION_CHARS:
        raise AgentGraphError("agentgraph_instruction_too_large")
    prepared_by = (
        _required_id(prepared_by_card_id, "prepared_by_card_id")
        if prepared_by_card_id
        else None
    )
    instruction_id = f"instruction:{uuid4().hex[:24]}"
    digest = sha256(body.encode("utf-8")).hexdigest()
    created_at = _now()
    with _connection_scope(connection) as conn, conn.cursor() as cursor:
        _prepare(cursor)
        cursor.execute(
            """
            INSERT INTO ag_catalog.agent_instructions
              (instruction_id, project_id, deck_id, conversation_id,
               prepared_by_card_id, body, body_sha256, created_at)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
            """,
            (
                instruction_id,
                project_id,
                deck_id,
                conversation_id,
                prepared_by,
                body,
                digest,
                created_at,
            ),
        )
        _run_cypher(
            cursor,
            """
            CREATE (instruction:Instruction {
              instructionId: $instructionId,
              projectId: $projectId,
              deckId: $deckId,
              conversationId: $conversationId,
              bodySha256: $bodySha256,
              createdAt: $createdAt
            })
            RETURN instruction.instructionId
            """,
            "instruction_id agtype",
            {
                "instructionId": instruction_id,
                "projectId": project_id,
                "deckId": deck_id,
                "conversationId": conversation_id,
                "bodySha256": digest,
                "createdAt": created_at,
            },
        )
    return {
        "ok": True,
        "instructionId": instruction_id,
        "projectId": project_id,
        "deckId": deck_id,
        "conversationId": conversation_id,
        "bodySha256": digest,
        "createdAt": created_at,
    }


def create_assignment(
    *,
    project_id: str,
    deck_id: str,
    conversation_id: str,
    correlation_id: str,
    sender_card_id: str,
    receiver_card_id: str,
    instruction_id: str,
    parent_correlation_id: str | None = None,
    operation_references: list[dict[str, Any]] | None = None,
    connection: Any | None = None,
) -> dict[str, Any]:
    """Create one pending AgentGraph assignment on the canonical run identity."""
    project_id = _required_text(project_id, "project_id")
    deck_id = _required_text(deck_id, "deck_id")
    conversation_id = _required_text(conversation_id, "conversation_id")
    correlation_id = _required_id(correlation_id, "correlation_id")
    sender_card_id = _required_id(sender_card_id, "sender_card_id")
    receiver_card_id = _required_id(receiver_card_id, "receiver_card_id")
    instruction_id = _required_id(instruction_id, "instruction_id")
    parent_correlation_id = (
        _required_id(parent_correlation_id, "parent_correlation_id")
        if parent_correlation_id
        else None
    )
    assignment_id = f"assignment:{correlation_id}"
    references = list(operation_references or [])
    created_at = _now()
    with _connection_scope(connection) as conn, conn.cursor() as cursor:
        _prepare(cursor)
        cursor.execute(
            """
            SELECT project_id, deck_id, conversation_id
            FROM ag_catalog.agent_instructions
            WHERE instruction_id=%s
            """,
            (instruction_id,),
        )
        instruction = cursor.fetchone()
        if instruction is None:
            raise AgentGraphError(
                f"agentgraph_instruction_not_found: {instruction_id}"
            )
        if instruction != (project_id, deck_id, conversation_id):
            raise AgentGraphError(
                f"agentgraph_instruction_scope_mismatch: {instruction_id}"
            )
        parent_assignment_id = None
        if parent_correlation_id:
            cursor.execute(
                """
                SELECT assignment_id
                FROM ag_catalog.agent_assignments
                WHERE project_id=%s AND correlation_id=%s
                """,
                (project_id, parent_correlation_id),
            )
            parent = cursor.fetchone()
            parent_assignment_id = str(parent[0]) if parent else None
        cursor.execute(
            """
            INSERT INTO ag_catalog.card_run_traces
              (project_id, correlation_id, deck_id, card_id, outcome,
               conversation_id, runtime, state, updated_at)
            VALUES (%s,%s,%s,%s,'pending',%s,'autogen','pending',now())
            ON CONFLICT (project_id, correlation_id) DO NOTHING
            """,
            (
                project_id,
                correlation_id,
                deck_id,
                receiver_card_id,
                conversation_id,
            ),
        )
        cursor.execute(
            """
            INSERT INTO ag_catalog.agent_assignments
              (assignment_id, project_id, correlation_id, deck_id, conversation_id,
               sender_card_id, receiver_card_id, parent_assignment_id, state,
               instruction_id, parent_run_id, created_at, updated_at)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,'pending',%s,%s,%s,%s)
            ON CONFLICT (project_id, correlation_id) DO NOTHING
            RETURNING assignment_id
            """,
            (
                assignment_id,
                project_id,
                correlation_id,
                deck_id,
                conversation_id,
                sender_card_id,
                receiver_card_id,
                parent_assignment_id,
                instruction_id,
                parent_correlation_id,
                created_at,
                created_at,
            ),
        )
        inserted = cursor.fetchone()
        if inserted is None:
            cursor.execute(
                """
                SELECT assignment_id, deck_id, conversation_id, sender_card_id,
                       receiver_card_id, instruction_id, parent_run_id
                FROM ag_catalog.agent_assignments
                WHERE project_id=%s AND correlation_id=%s
                """,
                (project_id, correlation_id),
            )
            existing = cursor.fetchone()
            expected = (
                assignment_id,
                deck_id,
                conversation_id,
                sender_card_id,
                receiver_card_id,
                instruction_id,
                parent_correlation_id,
            )
            if existing != expected:
                raise AgentGraphError(
                    f"agentgraph_assignment_idempotency_conflict: {correlation_id}"
                )
            return {
                "ok": True,
                "assignmentId": assignment_id,
                "correlationId": correlation_id,
                "instructionId": instruction_id,
                "state": "existing",
                "receiverCardId": receiver_card_id,
            }
        for reference in references:
            operation_id = _required_id(
                reference.get("operationId"), "operation_id"
            )
            try:
                operation_version = int(reference.get("version"))
            except (TypeError, ValueError):
                raise AgentGraphError("agentgraph_operation_version_invalid")
            if operation_version < 1:
                raise AgentGraphError("agentgraph_operation_version_invalid")
            parameters = reference.get("parameters") or {}
            if not isinstance(parameters, dict):
                raise AgentGraphError("agentgraph_operation_parameters_invalid")
            cursor.execute(
                """
                INSERT INTO ag_catalog.agent_assignment_operation_references
                  (assignment_id, project_id, operation_id, operation_version,
                   parameters, explanation, required)
                VALUES (%s,%s,%s,%s,%s::jsonb,%s,%s)
                """,
                (
                    assignment_id,
                    project_id,
                    operation_id,
                    operation_version,
                    json.dumps(parameters, ensure_ascii=False),
                    str(reference.get("explanation") or "").strip() or None,
                    bool(reference.get("required", False)),
                ),
            )
        _run_cypher(
            cursor,
            """
            MATCH (instruction:Instruction)
            WHERE instruction.instructionId = $instructionId
              AND instruction.projectId = $projectId
            MERGE (sender:Agent {
              project_id: $projectId, deck_id: $deckId, agent_id: $senderCardId
            })
            MERGE (receiver:Agent {
              project_id: $projectId, deck_id: $deckId, agent_id: $receiverCardId
            })
            MERGE (assignment:Assignment {
              assignmentId: $assignmentId,
              projectId: $projectId
            })
            SET assignment += {
              correlationId: $correlationId,
              conversationId: $conversationId,
              senderCardId: $senderCardId,
              receiverCardId: $receiverCardId,
              instructionId: $instructionId,
              state: 'pending',
              attempt: 0,
              createdAt: $createdAt
            }
            MERGE (assignment)-[:HAS_INSTRUCTION]->(instruction)
            MERGE (assignment)-[:CREATED_BY]->(sender)
            MERGE (assignment)-[:ASSIGNED_TO]->(receiver)
            RETURN assignment.assignmentId
            """,
            "assignment_id agtype",
            {
                "assignmentId": assignment_id,
                "projectId": project_id,
                "deckId": deck_id,
                "correlationId": correlation_id,
                "conversationId": conversation_id,
                "senderCardId": sender_card_id,
                "receiverCardId": receiver_card_id,
                "instructionId": instruction_id,
                "createdAt": created_at,
            },
        )
        if parent_assignment_id:
            _run_cypher(
                cursor,
                """
                MATCH (child:Assignment), (parent:Assignment)
                WHERE child.assignmentId = $assignmentId
                  AND parent.assignmentId = $parentAssignmentId
                MERGE (child)-[:CHILD_OF]->(parent)
                RETURN child.assignmentId
                """,
                "assignment_id agtype",
                {
                    "assignmentId": assignment_id,
                    "parentAssignmentId": parent_assignment_id,
                },
            )
    return {
        "ok": True,
        "assignmentId": assignment_id,
        "correlationId": correlation_id,
        "instructionId": instruction_id,
        "state": "pending",
        "receiverCardId": receiver_card_id,
    }


def claim_assignment(
    *,
    project_id: str,
    assignment_id: str,
    receiver_card_id: str,
    lease_seconds: int = 120,
    connection: Any | None = None,
) -> dict[str, Any]:
    """Atomically claim one pending or expired assignment lease."""
    project_id = _required_text(project_id, "project_id")
    assignment_id = _required_id(assignment_id, "assignment_id")
    receiver_card_id = _required_id(receiver_card_id, "receiver_card_id")
    if not isinstance(lease_seconds, int) or not 10 <= lease_seconds <= 3600:
        raise AgentGraphError("agentgraph_assignment_lease_invalid")
    lease_token = f"lease:{uuid4().hex}"
    now = datetime.now(timezone.utc)
    expires = now + timedelta(seconds=lease_seconds)
    with _connection_scope(connection) as conn, conn.cursor() as cursor:
        _prepare(cursor)
        cursor.execute(
            """
            UPDATE ag_catalog.agent_assignments
            SET state='running', claimed_by_card_id=%s, lease_token=%s,
                attempt=attempt+1, started_at=COALESCE(started_at,%s),
                heartbeat_at=%s, lease_expires_at=%s, updated_at=%s
            WHERE project_id=%s AND assignment_id=%s AND receiver_card_id=%s
              AND (
                state='pending'
                OR (state='running' AND lease_expires_at < %s)
              )
            RETURNING correlation_id, instruction_id, attempt
            """,
            (
                receiver_card_id,
                lease_token,
                now,
                now,
                expires,
                now,
                project_id,
                assignment_id,
                receiver_card_id,
                now,
            ),
        )
        claimed = cursor.fetchone()
        if claimed is None:
            raise AgentGraphError(
                f"agentgraph_assignment_not_claimable: {assignment_id}"
            )
        correlation_id, instruction_id, attempt = claimed
        cursor.execute(
            """
            UPDATE ag_catalog.card_run_traces
            SET outcome='running', state='running',
                started_at=COALESCE(started_at,%s), updated_at=%s
            WHERE project_id=%s AND correlation_id=%s
            """,
            (now, now, project_id, correlation_id),
        )
        cursor.execute(
            """
            SELECT body, body_sha256
            FROM ag_catalog.agent_instructions
            WHERE instruction_id=%s
            """,
            (instruction_id,),
        )
        instruction = cursor.fetchone()
        if instruction is None:
            raise AgentGraphError(
                f"agentgraph_instruction_not_found: {instruction_id}"
            )
        _run_cypher(
            cursor,
            """
            MATCH (assignment:Assignment)
            WHERE assignment.assignmentId = $assignmentId
              AND assignment.projectId = $projectId
            SET assignment.state='running',
                assignment.claimedByCardId=$receiverCardId,
                assignment.attempt=$attempt,
                assignment.leaseExpiresAt=$leaseExpiresAt
            RETURN assignment.assignmentId
            """,
            "assignment_id agtype",
            {
                "assignmentId": assignment_id,
                "projectId": project_id,
                "receiverCardId": receiver_card_id,
                "attempt": attempt,
                "leaseExpiresAt": expires.isoformat(),
            },
        )
    return {
        "ok": True,
        "assignmentId": assignment_id,
        "correlationId": str(correlation_id),
        "instructionId": str(instruction_id),
        "instruction": str(instruction[0]),
        "instructionSha256": str(instruction[1]),
        "leaseToken": lease_token,
        "leaseExpiresAt": expires.isoformat(),
        "attempt": int(attempt),
        "state": "running",
    }


def heartbeat_assignment(
    *,
    project_id: str,
    assignment_id: str,
    lease_token: str,
    lease_seconds: int = 120,
    connection: Any | None = None,
) -> dict[str, Any]:
    """Atomically extend only the current, unexpired assignment lease."""
    project_id = _required_text(project_id, "project_id")
    assignment_id = _required_id(assignment_id, "assignment_id")
    lease_token = _required_id(lease_token, "lease_token")
    if not isinstance(lease_seconds, int) or not 10 <= lease_seconds <= 3600:
        raise AgentGraphError("agentgraph_assignment_lease_invalid")
    now = datetime.now(timezone.utc)
    expires = now + timedelta(seconds=lease_seconds)
    with _connection_scope(connection) as conn, conn.cursor() as cursor:
        _prepare(cursor)
        cursor.execute(
            """
            UPDATE ag_catalog.agent_assignments
            SET heartbeat_at=%s, lease_expires_at=%s, updated_at=%s
            WHERE project_id=%s AND assignment_id=%s AND lease_token=%s
              AND state='running' AND lease_expires_at > %s
            RETURNING correlation_id, attempt
            """,
            (now, expires, now, project_id, assignment_id, lease_token, now),
        )
        row = cursor.fetchone()
        if row is None:
            raise AgentGraphError(
                f"agentgraph_assignment_lease_mismatch: {assignment_id}"
            )
        _run_cypher(
            cursor,
            """
            MATCH (assignment:Assignment)
            WHERE assignment.assignmentId=$assignmentId
              AND assignment.projectId=$projectId
            SET assignment.leaseExpiresAt=$leaseExpiresAt
            RETURN assignment.assignmentId
            """,
            "assignment_id agtype",
            {
                "assignmentId": assignment_id,
                "projectId": project_id,
                "leaseExpiresAt": expires.isoformat(),
            },
        )
    return {
        "ok": True,
        "assignmentId": assignment_id,
        "leaseExpiresAt": expires.isoformat(),
        "attempt": int(row[1]),
    }


def finish_assignment(
    *,
    project_id: str,
    assignment_id: str,
    lease_token: str,
    status: str,
    output: str | None = None,
    error_code: str | None = None,
    error_detail: str | None = None,
    connection: Any | None = None,
) -> dict[str, Any]:
    """Attach exact terminal result and artifact identities to the claimed run."""
    project_id = _required_text(project_id, "project_id")
    assignment_id = _required_id(assignment_id, "assignment_id")
    lease_token = _required_id(lease_token, "lease_token")
    terminal = _status(status)
    if terminal not in {"completed", "failed", "cancelled"}:
        raise AgentGraphError(
            f"agentgraph_assignment_terminal_status_invalid: {terminal}"
        )
    output = _optional_markdown(output)
    error_code = _optional_text(error_code, "error_code")
    error_detail = _optional_error(error_detail)
    result_id = f"agentresult:{assignment_id.split(':', 1)[-1]}"
    created_at = _now()
    with _connection_scope(connection) as conn, conn.cursor() as cursor:
        _prepare(cursor)
        cursor.execute(
            """
            SELECT correlation_id, receiver_card_id, state, lease_expires_at
            FROM ag_catalog.agent_assignments
            WHERE project_id=%s AND assignment_id=%s AND lease_token=%s
            FOR UPDATE
            """,
            (project_id, assignment_id, lease_token),
        )
        assignment = cursor.fetchone()
        if assignment is None:
            raise AgentGraphError(
                f"agentgraph_assignment_lease_mismatch: {assignment_id}"
            )
        correlation_id, receiver_card_id, prior_state, lease_expires_at = assignment
        if prior_state in {"completed", "failed", "cancelled"}:
            cursor.execute(
                """
                SELECT result_id, status, output, error_code, error_detail
                FROM ag_catalog.agent_results
                WHERE assignment_id=%s
                """,
                (assignment_id,),
            )
            existing = cursor.fetchone()
            if existing == (result_id, terminal, output, error_code, error_detail):
                return {
                    "ok": True,
                    "created": False,
                    "assignmentId": assignment_id,
                    "resultId": result_id,
                    "status": terminal,
                }
            raise AgentGraphError(
                f"agentgraph_assignment_already_terminal: {assignment_id}"
            )
        if lease_expires_at is None or lease_expires_at <= datetime.now(timezone.utc):
            raise AgentGraphError(
                f"agentgraph_assignment_lease_expired: {assignment_id}"
            )
        cursor.execute(
            """
            INSERT INTO ag_catalog.agent_results
              (result_id, assignment_id, project_id, correlation_id, status,
               output, error_code, error_detail)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
            """,
            (
                result_id,
                assignment_id,
                project_id,
                correlation_id,
                terminal,
                output,
                error_code,
                error_detail,
            ),
        )
        timestamp_column = "cancelled_at" if terminal == "cancelled" else "completed_at"
        cursor.execute(
            f"""
            UPDATE ag_catalog.agent_assignments
            SET state=%s, {timestamp_column}=now(), lease_expires_at=NULL,
                heartbeat_at=now(), updated_at=now()
            WHERE assignment_id=%s
            """,
            (terminal, assignment_id),
        )
        cursor.execute(
            f"""
            UPDATE ag_catalog.card_run_traces
            SET outcome=%s, state=%s, detail=%s, error_code=%s,
                {timestamp_column}=now(), updated_at=now()
            WHERE project_id=%s AND correlation_id=%s
            """,
            (
                terminal,
                terminal,
                str(error_detail or "")[:4000],
                error_code,
                project_id,
                correlation_id,
            ),
        )
        cursor.execute(
            """
            UPDATE ag_catalog.agent_artifact_references
            SET result_id=%s
            WHERE assignment_id=%s AND result_id IS NULL
            """,
            (result_id, assignment_id),
        )
        cursor.execute(
            """
            SELECT artifact_id, artifact_type, locator, producer_card_id,
                   sha256, byte_count
            FROM ag_catalog.agent_artifact_references
            WHERE assignment_id=%s
            ORDER BY artifact_id
            """,
            (assignment_id,),
        )
        artifact_rows = [
            {
                "artifactId": row[0],
                "artifactType": row[1],
                "locator": row[2],
                "producerCardId": row[3],
                "sha256": row[4],
                "byteCount": row[5],
            }
            for row in cursor.fetchall()
        ]
        _run_cypher(
            cursor,
            """
            MATCH (assignment:Assignment)
            WHERE assignment.assignmentId = $assignmentId
              AND assignment.projectId = $projectId
            CREATE (result:Result {
              resultId: $resultId,
              assignmentId: $assignmentId,
              projectId: $projectId,
              correlationId: $correlationId,
              receiverCardId: $receiverCardId,
              status: $status,
              createdAt: $createdAt
            })
            CREATE (assignment)-[:PRODUCED]->(result)
            SET assignment.state=$status,
                assignment.completedAt=$createdAt
            RETURN result.resultId
            """,
            "result_id agtype",
            {
                "assignmentId": assignment_id,
                "projectId": project_id,
                "resultId": result_id,
                "correlationId": str(correlation_id),
                "receiverCardId": str(receiver_card_id),
                "status": terminal,
                "createdAt": created_at,
            },
        )
        for artifact in artifact_rows:
            _run_cypher(
                cursor,
                """
                MATCH (assignment:Assignment), (result:Result), (artifact:Artifact)
                WHERE assignment.assignmentId=$assignmentId
                  AND result.resultId=$resultId
                  AND artifact.artifactId=$artifactId
                  AND artifact.assignmentId=$assignmentId
                SET artifact.resultId=$resultId
                CREATE (result)-[:HAS_ARTIFACT]->(artifact)
                RETURN artifact.artifactId
                """,
                "artifact_id agtype",
                {
                    **artifact,
                    "assignmentId": assignment_id,
                    "resultId": result_id,
                    "projectId": project_id,
                },
            )
    return {
        "ok": True,
        "created": True,
        "assignmentId": assignment_id,
        "resultId": result_id,
        "status": terminal,
        "artifacts": artifact_rows,
    }


def cancel_assignment(
    *,
    project_id: str,
    assignment_id: str,
    requested_by_card_id: str,
    reason: str,
    connection: Any | None = None,
) -> dict[str, Any]:
    """Cancel pending work as its sender without manufacturing a worker lease."""
    project_id = _required_text(project_id, "project_id")
    assignment_id = _required_id(assignment_id, "assignment_id")
    requested_by = _required_id(requested_by_card_id, "requested_by_card_id")
    reason = _required_text(reason, "cancellation_reason")[:_MAX_ERROR_CHARS]
    result_id = f"agentresult:{assignment_id.split(':', 1)[-1]}"
    with _connection_scope(connection) as conn, conn.cursor() as cursor:
        _prepare(cursor)
        cursor.execute(
            """
            SELECT correlation_id, sender_card_id, state
            FROM ag_catalog.agent_assignments
            WHERE project_id=%s AND assignment_id=%s
            FOR UPDATE
            """,
            (project_id, assignment_id),
        )
        row = cursor.fetchone()
        if row is None:
            raise AgentGraphError(f"agentgraph_assignment_not_found: {assignment_id}")
        correlation_id, sender_card_id, state = row
        if sender_card_id != requested_by:
            raise AgentGraphError(
                f"agentgraph_assignment_cancel_unauthorized: {assignment_id}"
            )
        if state in {"completed", "failed", "cancelled"}:
            if state == "cancelled":
                return {
                    "ok": True,
                    "created": False,
                    "assignmentId": assignment_id,
                    "resultId": result_id,
                    "status": "cancelled",
                }
            raise AgentGraphError(
                f"agentgraph_assignment_already_terminal: {assignment_id}"
            )
        cursor.execute(
            """
            INSERT INTO ag_catalog.agent_results
              (result_id, assignment_id, project_id, correlation_id, status,
               error_code, error_detail)
            VALUES (%s,%s,%s,%s,'cancelled','cancelled',%s)
            """,
            (result_id, assignment_id, project_id, correlation_id, reason),
        )
        cursor.execute(
            """
            UPDATE ag_catalog.agent_assignments
            SET state='cancelled', cancelled_at=now(), lease_token=NULL,
                lease_expires_at=NULL, updated_at=now()
            WHERE assignment_id=%s
            """,
            (assignment_id,),
        )
        cursor.execute(
            """
            UPDATE ag_catalog.card_run_traces
            SET outcome='cancelled', state='cancelled', detail=%s,
                error_code='cancelled', cancelled_at=now(), updated_at=now()
            WHERE project_id=%s AND correlation_id=%s
            """,
            (reason, project_id, correlation_id),
        )
        _run_cypher(
            cursor,
            """
            MATCH (assignment:Assignment)
            WHERE assignment.assignmentId=$assignmentId
              AND assignment.projectId=$projectId
            CREATE (result:Result {
              resultId:$resultId, assignmentId:$assignmentId,
              projectId:$projectId, correlationId:$correlationId,
              status:'cancelled'
            })
            CREATE (assignment)-[:PRODUCED]->(result)
            SET assignment.state='cancelled'
            RETURN result.resultId
            """,
            "result_id agtype",
            {
                "assignmentId": assignment_id,
                "projectId": project_id,
                "resultId": result_id,
                "correlationId": str(correlation_id),
            },
        )
    return {
        "ok": True,
        "created": True,
        "assignmentId": assignment_id,
        "resultId": result_id,
        "status": "cancelled",
    }


def register_assignment_artifact(
    *,
    project_id: str,
    assignment_id: str,
    lease_token: str,
    artifact: dict[str, Any],
    connection: Any | None = None,
) -> dict[str, Any]:
    """Register one real file immediately against its active assignment lease."""
    project_id = _required_text(project_id, "project_id")
    assignment_id = _required_id(assignment_id, "assignment_id")
    lease_token = _required_id(lease_token, "lease_token")
    artifact_id = _required_id(artifact.get("artifactId"), "artifact_id")
    artifact_type = _required_text(artifact.get("artifactType"), "artifact_type")
    locator = _required_text(artifact.get("locator"), "artifact_locator")
    producer = _required_id(
        artifact.get("producerCardId"), "artifact_producer_card_id"
    )
    digest = _required_text(artifact.get("sha256"), "artifact_sha256")
    byte_count = int(artifact.get("byteCount"))
    if byte_count < 0:
        raise AgentGraphError("agentgraph_artifact_byte_count_invalid")
    with _connection_scope(connection) as conn, conn.cursor() as cursor:
        _prepare(cursor)
        cursor.execute(
            """
            SELECT correlation_id, receiver_card_id
            FROM ag_catalog.agent_assignments
            WHERE project_id=%s AND assignment_id=%s AND lease_token=%s
              AND state='running' AND lease_expires_at > now()
            FOR UPDATE
            """,
            (project_id, assignment_id, lease_token),
        )
        assignment = cursor.fetchone()
        if assignment is None:
            raise AgentGraphError(
                f"agentgraph_assignment_lease_mismatch: {assignment_id}"
            )
        correlation_id, receiver_card_id = assignment
        if producer != receiver_card_id:
            raise AgentGraphError(
                f"agentgraph_artifact_producer_mismatch: {producer}"
            )
        cursor.execute(
            """
            INSERT INTO ag_catalog.agent_artifact_references
              (assignment_id, artifact_id, artifact_type, locator, run_id,
               producer_card_id, sha256, byte_count)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (assignment_id, artifact_id) DO NOTHING
            """,
            (
                assignment_id,
                artifact_id,
                artifact_type,
                locator,
                correlation_id,
                producer,
                digest,
                byte_count,
            ),
        )
        created = cursor.rowcount == 1
        if created:
            _run_cypher(
                cursor,
                """
                MATCH (assignment:Assignment)
                WHERE assignment.assignmentId=$assignmentId
                  AND assignment.projectId=$projectId
                CREATE (artifact:Artifact {
                  artifactId: $artifactId,
                  assignmentId: $assignmentId,
                  projectId: $projectId,
                  producerCardId: $producerCardId,
                  sha256: $sha256,
                  byteCount: $byteCount
                })
                CREATE (assignment)-[:HAS_ARTIFACT]->(artifact)
                RETURN artifact.artifactId
                """,
                "artifact_id agtype",
                {
                    "assignmentId": assignment_id,
                    "projectId": project_id,
                    "artifactId": artifact_id,
                    "producerCardId": producer,
                    "sha256": digest,
                    "byteCount": byte_count,
                },
            )
    return {
        "ok": True,
        "created": created,
        "assignmentId": assignment_id,
        **artifact,
    }


def read_assignment(
    *,
    project_id: str,
    assignment_id: str,
    receiving_card_id: str,
    connection: Any | None = None,
) -> dict[str, Any]:
    """Traverse compact AGE identity, then hydrate exact relational payloads."""
    project_id = _required_text(project_id, "project_id")
    assignment_id = _required_id(assignment_id, "assignment_id")
    receiving_card_id = _required_id(receiving_card_id, "receiving_card_id")
    with _connection_scope(connection) as conn, conn.cursor() as cursor:
        _prepare(cursor)
        identity_rows = _run_cypher(
            cursor,
            """
            MATCH (assignment:Assignment)-[:ASSIGNED_TO]->(receiver:Agent)
            MATCH (assignment)-[:HAS_INSTRUCTION]->(instruction:Instruction)
            WHERE assignment.assignmentId=$assignmentId
              AND assignment.projectId=$projectId
              AND receiver.agent_id=$receivingCardId
            OPTIONAL MATCH (assignment)-[:PRODUCED]->(result:Result)
            RETURN properties(assignment), properties(instruction),
                   collect(properties(result))
            """,
            "assignment agtype, instruction agtype, results agtype",
            {
                "assignmentId": assignment_id,
                "projectId": project_id,
                "receivingCardId": receiving_card_id,
            },
        )
        if not identity_rows:
            raise AgentGraphError(
                f"agentgraph_assignment_not_found_or_unauthorized: {assignment_id}"
            )
        cursor.execute(
            """
            SELECT a.assignment_id, a.correlation_id, a.deck_id, a.conversation_id,
                   a.sender_card_id, a.receiver_card_id, a.parent_assignment_id,
                   a.state, a.attempt, a.instruction_id, i.body, i.body_sha256,
                   r.result_id, r.status, r.output, r.error_code, r.error_detail,
                   a.parent_run_id, a.claimed_by_card_id, a.lease_expires_at,
                   a.heartbeat_at
            FROM ag_catalog.agent_assignments a
            JOIN ag_catalog.agent_instructions i ON i.instruction_id=a.instruction_id
            LEFT JOIN ag_catalog.agent_results r ON r.assignment_id=a.assignment_id
            WHERE a.project_id=%s AND a.assignment_id=%s
              AND a.receiver_card_id=%s
            """,
            (project_id, assignment_id, receiving_card_id),
        )
        row = cursor.fetchone()
        if row is None:
            raise AgentGraphError(
                f"agentgraph_assignment_payload_not_found: {assignment_id}"
            )
        cursor.execute(
            """
            SELECT artifact_id, artifact_type, locator, producer_card_id,
                   sha256, byte_count
            FROM ag_catalog.agent_artifact_references
            WHERE assignment_id=%s
            ORDER BY artifact_id
            """,
            (assignment_id,),
        )
        artifacts = [
            {
                "artifactId": item[0],
                "artifactType": item[1],
                "locator": item[2],
                "producerCardId": item[3],
                "sha256": item[4],
                "byteCount": item[5],
            }
            for item in cursor.fetchall()
        ]
        cursor.execute(
            """
            SELECT operation_id, operation_version, parameters, explanation, required
            FROM ag_catalog.agent_assignment_operation_references
            WHERE assignment_id=%s
            ORDER BY operation_id, operation_version
            """,
            (assignment_id,),
        )
        operations = [
            {
                "operationId": item[0],
                "version": item[1],
                "parameters": (
                    item[2]
                    if isinstance(item[2], dict)
                    else json.loads(str(item[2]))
                ),
                "explanation": item[3],
                "required": item[4],
            }
            for item in cursor.fetchall()
        ]
    return {
        "ok": True,
        "assignmentId": row[0],
        "correlationId": row[1],
        "deckId": row[2],
        "conversationId": row[3],
        "senderCardId": row[4],
        "receiverCardId": row[5],
        "parentAssignmentId": row[6],
        "parentRunId": row[17],
        "state": row[7],
        "attempt": row[8],
        "claimedByCardId": row[18],
        "leaseExpiresAt": row[19].isoformat() if row[19] else None,
        "heartbeatAt": row[20].isoformat() if row[20] else None,
        "instructionId": row[9],
        "instruction": row[10],
        "instructionSha256": row[11],
        "result": (
            {
                "resultId": row[12],
                "status": row[13],
                "output": row[14],
                "errorCode": row[15],
                "errorDetail": row[16],
            }
            if row[12]
            else None
        ),
        "artifacts": artifacts,
        "operationReferences": operations,
        "ageIdentity": {
            "assignment": json.loads(str(identity_rows[0][0])),
            "instruction": json.loads(str(identity_rows[0][1])),
            "results": json.loads(str(identity_rows[0][2])),
        },
    }
