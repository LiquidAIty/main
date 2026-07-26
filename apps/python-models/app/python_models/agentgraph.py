"""Minimal PostgreSQL AGE transport for durable agent-to-agent handoffs.

AgentGraph references saved card identities and owns only bounded handoff
instructions, call lineage, status, and correlated results. Permanent card
prompt/model/tool/permission configuration remains in the relational deck.
"""

from __future__ import annotations

import json
import re
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any, Callable, Iterator
from uuid import uuid4

from app.python_models.postgres import connect_postgres


_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$")
_GRAPH_NAME = "agentgraph"
_HANDOFF_STATUSES = {"pending", "running", "completed", "failed", "cancelled"}
_MAX_HANDOFF_CHARS = 100_000
_MAX_RESULT_CHARS = 100_000
_MAX_ERROR_CHARS = 8_000


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
            })
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
