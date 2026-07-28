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
from typing import Any, Iterator
from uuid import uuid4

from app.python_models.postgres import connect_postgres


_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$")
_GRAPH_NAME = "agentgraph"
_HANDOFF_STATUSES = {"pending", "running", "completed", "failed", "cancelled"}
_MAX_HANDOFF_CHARS = 100_000
_MAX_RESULT_CHARS = 100_000
_MAX_ERROR_CHARS = 8_000
_MAX_INSTRUCTION_CHARS = 200_000
_MAX_OPERATION_REFERENCES = 16
_MAX_TOOL_EVIDENCE = 64


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


def _tool_evidence(value: Any) -> list[dict[str, Any]]:
    if value is None:
        return []
    if not isinstance(value, list) or len(value) > _MAX_TOOL_EVIDENCE:
        raise AgentGraphError("agentgraph_tool_evidence_invalid")
    allowed = {"callId", "toolName", "event", "status"}
    normalized: list[dict[str, Any]] = []
    for item in value:
        if not isinstance(item, dict) or set(item) - allowed:
            raise AgentGraphError("agentgraph_tool_evidence_invalid")
        record = {
            key: str(item.get(key) or "").strip()[:500]
            for key in allowed
            if str(item.get(key) or "").strip()
        }
        if not record:
            raise AgentGraphError("agentgraph_tool_evidence_invalid")
        normalized.append(record)
    return normalized


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


def _validate_instruction_operation_references(
    *,
    project_id: str,
    references: list[dict[str, Any]] | None,
    connection: Any,
) -> list[dict[str, Any]]:
    """Resolve exact operation versions while the instruction is authored."""
    from app.python_models import registered_queries as rq

    if references is None:
        return []
    if not isinstance(references, list):
        raise AgentGraphError("agentgraph_operation_references_invalid")
    if len(references) > _MAX_OPERATION_REFERENCES:
        raise AgentGraphError("agentgraph_operation_references_too_many")

    approved: list[dict[str, Any]] = []
    seen: set[tuple[str, int]] = set()
    allowed_keys = {
        "operationId",
        "version",
        "executionRole",
        "parameters",
        "explanation",
    }
    for index, raw_reference in enumerate(references):
        if not isinstance(raw_reference, dict):
            raise AgentGraphError("agentgraph_operation_reference_invalid")
        unknown = set(raw_reference) - allowed_keys
        if unknown:
            raise AgentGraphError(
                "agentgraph_operation_reference_keys_unknown: "
                + ",".join(sorted(unknown))
            )
        operation_id = _required_id(
            raw_reference.get("operationId"), "operation_id"
        )
        try:
            version = int(raw_reference.get("version"))
        except (TypeError, ValueError) as error:
            raise AgentGraphError("agentgraph_operation_version_invalid") from error
        if version < 1:
            raise AgentGraphError("agentgraph_operation_version_invalid")
        identity = (operation_id, version)
        if identity in seen:
            raise AgentGraphError(
                f"agentgraph_operation_reference_duplicate: {operation_id}@v{version}"
            )
        seen.add(identity)
        role = str(raw_reference.get("executionRole") or "").strip()
        if role not in {"required_context", "optional_tool"}:
            raise AgentGraphError("agentgraph_operation_execution_role_invalid")
        try:
            operation = rq.resolve_registered_version(
                project_id,
                operation_id,
                version,
                connection=connection,
            )
            parameters = rq.validate_parameters(
                operation.parameter_schema,
                raw_reference.get("parameters") or {},
            )
        except (LookupError, PermissionError, ValueError) as error:
            raise AgentGraphError(str(error)) from error
        expected_authority = {
            "sql": "postgresql",
            "cypher": "agentgraph_age",
        }.get(operation.language)
        if expected_authority is None or operation.database_authority != expected_authority:
            raise AgentGraphError(
                f"agentgraph_operation_engine_incompatible: {operation_id}@v{version}"
            )
        explanation = _optional_text(
            raw_reference.get("explanation"), "operation_explanation"
        )
        if explanation is not None and len(explanation) > 4000:
            raise AgentGraphError("agentgraph_operation_explanation_too_large")
        approved.append(
            {
                "referenceId": f"operation-ref:{index + 1}",
                "operationId": operation_id,
                "version": version,
                "executionRole": role,
                "parameters": parameters,
                "explanation": explanation,
            }
        )
    return approved


def create_instruction(
    *,
    project_id: str,
    deck_id: str,
    conversation_id: str,
    body: str,
    prepared_by_card_id: str | None = None,
    operation_references: list[dict[str, Any]] | None = None,
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
        references = _validate_instruction_operation_references(
            project_id=project_id,
            references=operation_references,
            connection=conn,
        )
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
        for reference in references:
            cursor.execute(
                """
                INSERT INTO ag_catalog.agent_instruction_operation_references
                  (instruction_id, reference_id, project_id, operation_id,
                   operation_version, execution_role, parameters, explanation)
                VALUES (%s,%s,%s,%s,%s,%s,%s::jsonb,%s)
                """,
                (
                    instruction_id,
                    reference["referenceId"],
                    project_id,
                    reference["operationId"],
                    reference["version"],
                    reference["executionRole"],
                    json.dumps(reference["parameters"], ensure_ascii=False),
                    reference["explanation"],
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
        for reference in references:
            _run_cypher(
                cursor,
                """
                MATCH (instruction:Instruction)
                WHERE instruction.instructionId = $instructionId
                  AND instruction.projectId = $projectId
                MERGE (operation:OperationVersion {
                  projectId: $projectId,
                  operationId: $operationId,
                  version: $operationVersion
                })
                MERGE (instruction)-[link:REFERENCES_OPERATION {
                  referenceId: $referenceId
                }]->(operation)
                SET link.executionRole = $executionRole
                RETURN operation.operationId
                """,
                "operation_id agtype",
                {
                    "instructionId": instruction_id,
                    "projectId": project_id,
                    "referenceId": reference["referenceId"],
                    "operationId": reference["operationId"],
                    "operationVersion": reference["version"],
                    "executionRole": reference["executionRole"],
                },
            )
    return {
        "ok": True,
        "instructionId": instruction_id,
        "projectId": project_id,
        "deckId": deck_id,
        "conversationId": conversation_id,
        "bodySha256": digest,
        "operationReferences": references,
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
        cursor.execute(
            """
            INSERT INTO ag_catalog.agent_assignment_operation_references
              (assignment_id, reference_id, project_id, operation_id,
               operation_version, execution_role, parameters, explanation)
            SELECT %s, reference_id, project_id, operation_id,
                   operation_version, execution_role, parameters, explanation
            FROM ag_catalog.agent_instruction_operation_references
            WHERE instruction_id=%s
            ORDER BY reference_id
            """,
            (assignment_id, instruction_id),
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
        cursor.execute(
            """
            SELECT reference_id, operation_id, operation_version, execution_role
            FROM ag_catalog.agent_assignment_operation_references
            WHERE assignment_id=%s
            ORDER BY reference_id
            """,
            (assignment_id,),
        )
        for reference_id, operation_id, operation_version, execution_role in cursor.fetchall():
            _run_cypher(
                cursor,
                """
                MATCH (assignment:Assignment)
                WHERE assignment.assignmentId = $assignmentId
                  AND assignment.projectId = $projectId
                MERGE (operation:OperationVersion {
                  projectId: $projectId,
                  operationId: $operationId,
                  version: $operationVersion
                })
                MERGE (assignment)-[link:USES_OPERATION {
                  referenceId: $referenceId
                }]->(operation)
                SET link.executionRole = $executionRole
                RETURN operation.operationId
                """,
                "operation_id agtype",
                {
                    "assignmentId": assignment_id,
                    "projectId": project_id,
                    "referenceId": str(reference_id),
                    "operationId": str(operation_id),
                    "operationVersion": int(operation_version),
                    "executionRole": str(execution_role),
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
    summary: str | None = None,
    error_code: str | None = None,
    error_detail: str | None = None,
    tool_evidence: list[dict[str, Any]] | None = None,
    connection: Any | None = None,
) -> dict[str, Any]:
    """Attach the exact terminal result to the claimed run."""
    project_id = _required_text(project_id, "project_id")
    assignment_id = _required_id(assignment_id, "assignment_id")
    lease_token = _required_id(lease_token, "lease_token")
    terminal = _status(status)
    if terminal not in {"completed", "failed", "cancelled"}:
        raise AgentGraphError(
            f"agentgraph_assignment_terminal_status_invalid: {terminal}"
        )
    output = _optional_markdown(output)
    summary = _optional_text(summary, "result_summary")
    error_code = _optional_text(error_code, "error_code")
    error_detail = _optional_error(error_detail)
    tool_evidence = _tool_evidence(tool_evidence)
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
                SELECT result_id, status, output, summary, error_code, error_detail,
                       tool_evidence
                FROM ag_catalog.agent_results
                WHERE assignment_id=%s
                """,
                (assignment_id,),
            )
            existing = cursor.fetchone()
            if (
                existing is not None
                and existing[:6]
                == (
                    result_id,
                    terminal,
                    output,
                    summary,
                    error_code,
                    error_detail,
                )
                and list(existing[6] or []) == tool_evidence
            ):
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
               output, summary, error_code, error_detail, tool_evidence)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s::jsonb)
            """,
            (
                result_id,
                assignment_id,
                project_id,
                correlation_id,
                terminal,
                output,
                summary,
                error_code,
                error_detail,
                json.dumps(tool_evidence, ensure_ascii=False),
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
    return {
        "ok": True,
        "created": True,
        "assignmentId": assignment_id,
        "resultId": result_id,
        "status": terminal,
        "toolEvidence": tool_evidence,
    }


def record_assignment_runtime_context(
    *,
    project_id: str,
    assignment_id: str,
    runtime: str,
    provider: str,
    model_key: str,
    provider_model_id: str,
    connection: Any | None = None,
) -> None:
    """Record the exact saved-card runtime/provider/model used by this run."""
    project_id = _required_text(project_id, "project_id")
    assignment_id = _required_id(assignment_id, "assignment_id")
    runtime = _required_text(runtime, "runtime")
    provider = _required_text(provider, "provider")
    model_key = _required_text(model_key, "model_key")
    provider_model_id = _required_text(provider_model_id, "provider_model_id")
    with _connection_scope(connection) as conn, conn.cursor() as cursor:
        cursor.execute(
            """
            UPDATE ag_catalog.card_run_traces trace
            SET runtime=%s, provider=%s, model_key=%s, provider_model_id=%s,
                outcome='running', state='running', updated_at=now()
            FROM ag_catalog.agent_assignments assignment
            WHERE assignment.project_id=%s
              AND assignment.assignment_id=%s
              AND trace.project_id=assignment.project_id
              AND trace.correlation_id=assignment.correlation_id
            """,
            (
                runtime,
                provider,
                model_key,
                provider_model_id,
                project_id,
                assignment_id,
            ),
        )
        if cursor.rowcount != 1:
            raise AgentGraphError(
                f"agentgraph_run_trace_not_found: {assignment_id}"
            )


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


def register_operation_execution_lineage(
    *,
    project_id: str,
    assignment_id: str,
    execution_id: str,
    operation_id: str,
    operation_version: int,
    graph_view_id: str,
    connection: Any | None = None,
) -> None:
    """Attach compact operation execution and Graph View identities in AGE."""
    project_id = _required_text(project_id, "project_id")
    assignment_id = _required_id(assignment_id, "assignment_id")
    execution_id = _required_id(execution_id, "execution_id")
    operation_id = _required_id(operation_id, "operation_id")
    graph_view_id = _required_id(graph_view_id, "graph_view_id")
    if not isinstance(operation_version, int) or operation_version < 1:
        raise AgentGraphError("agentgraph_operation_version_invalid")
    with _connection_scope(connection) as conn, conn.cursor() as cursor:
        _prepare(cursor)
        _run_cypher(
            cursor,
            """
            MATCH (assignment:Assignment)
            WHERE assignment.assignmentId = $assignmentId
              AND assignment.projectId = $projectId
            MERGE (operation:OperationVersion {
              projectId: $projectId,
              operationId: $operationId,
              version: $operationVersion
            })
            MERGE (execution:OperationExecution {
              projectId: $projectId,
              executionId: $executionId
            })
            MERGE (view:GraphView {
              projectId: $projectId,
              viewId: $graphViewId
            })
            MERGE (assignment)-[:EXECUTED_OPERATION]->(execution)
            MERGE (execution)-[:OF_VERSION]->(operation)
            MERGE (execution)-[:MATERIALIZED]->(view)
            RETURN execution.executionId
            """,
            "execution_id agtype",
            {
                "projectId": project_id,
                "assignmentId": assignment_id,
                "executionId": execution_id,
                "operationId": operation_id,
                "operationVersion": operation_version,
                "graphViewId": graph_view_id,
            },
        )


def add_assignment_references(
    *,
    project_id: str,
    assignment_id: str,
    receiver_card_id: str,
    references: list[dict[str, Any]],
    connection: Any | None = None,
) -> dict[str, Any]:
    """Attach bounded stable references; never copy referenced store payloads."""
    project_id = _required_text(project_id, "project_id")
    assignment_id = _required_id(assignment_id, "assignment_id")
    receiver_card_id = _required_id(receiver_card_id, "receiver_card_id")
    allowed_types = {
        "graph_view",
        "registered_query",
        "conversation_message",
        "database",
        "thinkgraph",
        "knowgraph",
        "codegraph",
        "native_session",
        "worldsignals",
    }
    if not isinstance(references, list) or len(references) > 128:
        raise AgentGraphError("agentgraph_context_references_invalid")
    normalized: list[tuple[str, str, bool]] = []
    seen: set[tuple[str, str]] = set()
    for reference in references:
        if not isinstance(reference, dict):
            raise AgentGraphError("agentgraph_context_reference_invalid")
        reference_id = _required_text(reference.get("referenceId"), "reference_id")
        reference_type = _required_text(
            reference.get("referenceType"), "reference_type"
        ).lower()
        if reference_type not in allowed_types:
            raise AgentGraphError(
                f"agentgraph_reference_type_invalid: {reference_type}"
            )
        identity = (reference_type, reference_id)
        if identity in seen:
            continue
        seen.add(identity)
        normalized.append(
            (reference_id, reference_type, bool(reference.get("required", False)))
        )
    with _connection_scope(connection) as conn, conn.cursor() as cursor:
        _prepare(cursor)
        cursor.execute(
            """
            SELECT 1
            FROM ag_catalog.agent_assignments
            WHERE project_id=%s AND assignment_id=%s AND receiver_card_id=%s
            """,
            (project_id, assignment_id, receiver_card_id),
        )
        if cursor.fetchone() is None:
            raise AgentGraphError(
                f"agentgraph_assignment_not_found_or_unauthorized: {assignment_id}"
            )
        for reference_id, reference_type, required in normalized:
            cursor.execute(
                """
                INSERT INTO ag_catalog.agent_context_references
                  (assignment_id, reference_id, reference_type, required)
                VALUES (%s,%s,%s,%s)
                ON CONFLICT DO NOTHING
                """,
                (assignment_id, reference_id, reference_type, required),
            )
    return {
        "ok": True,
        "assignmentId": assignment_id,
        "references": [
            {
                "referenceId": reference_id,
                "referenceType": reference_type,
                "required": required,
            }
            for reference_id, reference_type, required in normalized
        ],
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
                   r.result_id, r.status, r.output, r.summary, r.error_code, r.error_detail,
                   r.tool_evidence,
                   a.parent_run_id, a.claimed_by_card_id, a.lease_expires_at,
                   a.heartbeat_at, parent_run.session_id,
                   run.runtime, run.provider, run.model_key, run.provider_model_id,
                   run.outcome, run.state, run.error_code
            FROM ag_catalog.agent_assignments a
            JOIN ag_catalog.agent_instructions i ON i.instruction_id=a.instruction_id
            LEFT JOIN ag_catalog.agent_results r ON r.assignment_id=a.assignment_id
            LEFT JOIN ag_catalog.card_run_traces parent_run
              ON parent_run.project_id=a.project_id
             AND parent_run.correlation_id=a.parent_run_id
            LEFT JOIN ag_catalog.card_run_traces run
              ON run.project_id=a.project_id
             AND run.correlation_id=a.correlation_id
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
            SELECT reference_id, operation_id, operation_version, parameters,
                   explanation, execution_role
            FROM ag_catalog.agent_assignment_operation_references
            WHERE assignment_id=%s
            ORDER BY reference_id
            """,
            (assignment_id,),
        )
        operations = [
            {
                "referenceId": item[0],
                "operationId": item[1],
                "version": item[2],
                "parameters": (
                    item[3]
                    if isinstance(item[3], dict)
                    else json.loads(str(item[3]))
                ),
                "explanation": item[4],
                "executionRole": item[5],
            }
            for item in cursor.fetchall()
        ]
        cursor.execute(
            """
            SELECT reference_id, reference_type, required
            FROM ag_catalog.agent_context_references
            WHERE assignment_id=%s
            ORDER BY reference_type, reference_id
            """,
            (assignment_id,),
        )
        context_references = [
            {
                "referenceId": item[0],
                "referenceType": item[1],
                "required": item[2],
            }
            for item in cursor.fetchall()
        ]
        cursor.execute(
            """
            SELECT parent.assignment_id, parent.instruction_id, result.result_id,
                   result.status, result.summary
            FROM ag_catalog.agent_assignments current
            JOIN ag_catalog.agent_assignments parent
              ON parent.assignment_id=current.parent_assignment_id
            LEFT JOIN ag_catalog.agent_results result
              ON result.assignment_id=parent.assignment_id
            WHERE current.project_id=%s AND current.assignment_id=%s
            """,
            (project_id, assignment_id),
        )
        parent_row = cursor.fetchone()
    return {
        "ok": True,
        "assignmentId": row[0],
        "correlationId": row[1],
        "deckId": row[2],
        "conversationId": row[3],
        "senderCardId": row[4],
        "receiverCardId": row[5],
        "parentAssignmentId": row[6],
        "parentRunId": row[19],
        "state": row[7],
        "attempt": row[8],
        "claimedByCardId": row[20],
        "leaseExpiresAt": row[21].isoformat() if row[21] else None,
        "heartbeatAt": row[22].isoformat() if row[22] else None,
        "nativeSessionId": row[23],
        "instructionId": row[9],
        "instruction": row[10],
        "instructionSha256": row[11],
        "result": (
            {
                "resultId": row[12],
                "status": row[13],
                "output": row[14],
                "summary": row[15],
                "errorCode": row[16],
                "errorDetail": row[17],
                "toolEvidence": list(row[18] or []),
            }
            if row[12]
            else None
        ),
        "contextReferences": context_references,
        "operationReferences": operations,
        "parentContinuity": (
            {
                "assignmentId": parent_row[0],
                "instructionId": parent_row[1],
                "resultId": parent_row[2],
                "resultStatus": parent_row[3],
                "resultSummary": parent_row[4],
            }
            if parent_row
            else None
        ),
        "runTrace": {
            "runtime": row[24],
            "provider": row[25],
            "modelKey": row[26],
            "providerModelId": row[27],
            "outcome": row[28],
            "state": row[29],
            "errorCode": row[30],
        },
        "ageIdentity": {
            "assignment": json.loads(str(identity_rows[0][0])),
            "instruction": json.loads(str(identity_rows[0][1])),
            "results": json.loads(str(identity_rows[0][2])),
        },
    }


def inspect_assignments(
    *,
    project_id: str,
    deck_id: str,
    conversation_id: str | None,
    project_wide: bool = False,
    assignment_id: str | None = None,
    limit: int = 20,
    connection: Any | None = None,
) -> dict[str, Any]:
    """Read one exact assignment or a bounded assignment summary.

    Normal callers remain conversation-scoped. The authenticated private
    developer/operator entrance may request a project-wide read; it still
    cannot select another project or deck. Exact assignment identity never
    falls back to a latest run.
    """
    project_id = _required_text(project_id, "project_id")
    deck_id = _required_id(deck_id, "deck_id")
    scoped_conversation_id = (
        None
        if project_wide
        else _required_id(conversation_id, "conversation_id")
    )
    exact_id = (
        _required_id(assignment_id, "assignment_id")
        if assignment_id is not None
        else None
    )
    bounded_limit = max(1, min(int(limit), 50))
    with _connection_scope(connection) as conn:
        with conn.cursor() as cursor:
            _prepare(cursor)
            cursor.execute(
                """
                SELECT a.assignment_id, a.correlation_id, a.sender_card_id,
                       a.receiver_card_id, a.parent_assignment_id, a.parent_run_id,
                       a.state, a.attempt, a.instruction_id, a.created_at, a.updated_at,
                       r.result_id, r.status, r.summary, a.conversation_id
                FROM ag_catalog.agent_assignments a
                LEFT JOIN ag_catalog.agent_results r
                  ON r.assignment_id=a.assignment_id
                WHERE a.project_id=%s
                  AND a.deck_id=%s
                  AND (%s::boolean OR a.conversation_id=%s)
                  AND (%s::text IS NULL OR a.assignment_id=%s)
                ORDER BY a.updated_at DESC, a.assignment_id
                LIMIT %s
                """,
                (
                    project_id,
                    deck_id,
                    project_wide,
                    scoped_conversation_id,
                    exact_id,
                    exact_id,
                    bounded_limit,
                ),
            )
            rows = list(cursor.fetchall())
        if exact_id:
            if not rows:
                raise AgentGraphError(
                    f"agentgraph_assignment_not_found_in_runtime_context: {exact_id}"
                )
            return read_assignment(
                project_id=project_id,
                assignment_id=exact_id,
                receiving_card_id=str(rows[0][3]),
                connection=conn,
            )
    return {
        "ok": True,
        "projectId": project_id,
        "deckId": deck_id,
        "conversationId": scoped_conversation_id,
        "readScope": "project" if project_wide else "conversation",
        "assignments": [
            {
                "assignmentId": row[0],
                "correlationId": row[1],
                "senderCardId": row[2],
                "receiverCardId": row[3],
                "parentAssignmentId": row[4],
                "parentRunId": row[5],
                "state": row[6],
                "attempt": row[7],
                "instructionId": row[8],
                "createdAt": row[9].isoformat() if row[9] else None,
                "updatedAt": row[10].isoformat() if row[10] else None,
                "resultId": row[11],
                "resultStatus": row[12],
                "resultSummary": row[13],
                "conversationId": row[14],
            }
            for row in rows
        ],
    }
