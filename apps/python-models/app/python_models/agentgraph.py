"""Minimal PostgreSQL AGE handoff storage for agent-to-agent Markdown.

AgentGraph owns only handoff text and its run lineage. ThinkGraph/Engraphis,
KnowGraph, CodeGraph, Graph Views, tools, and model configuration remain
independent authorities.
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
    return value


def _optional_markdown(value: Any) -> str | None:
    if value is None or value == "":
        return None
    if not isinstance(value, str):
        raise AgentGraphError("agentgraph_result_markdown_invalid")
    return value


def _optional_text(value: Any, field: str) -> str | None:
    if value is None or value == "":
        return None
    if not isinstance(value, str) or not value.strip():
        raise AgentGraphError(f"agentgraph_{field}_invalid")
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


def _ag_value(value: Any) -> Any:
    if value is None or isinstance(value, (dict, list, bool, int, float)):
        return value
    try:
        return json.loads(str(value))
    except (TypeError, ValueError):
        return value


def _properties(value: Any) -> dict[str, Any]:
    parsed = _ag_value(value)
    return dict(parsed) if isinstance(parsed, dict) else {}


def _property(properties: dict[str, Any], current: str, historical: str) -> Any:
    return properties[current] if current in properties else properties.get(historical)


def _read_context_properties(
    cursor: Any,
    project_id: str,
    context_id: str,
) -> dict[str, Any] | None:
    rows = _run_cypher(
        cursor,
        """
        MATCH (context:AgentContext)
        WHERE
          (context.contextId = $contextId OR context.context_id = $contextId)
          AND (context.projectId = $projectId OR context.project_id = $projectId)
        RETURN properties(context)
        LIMIT 1
        """,
        "properties agtype",
        {"projectId": project_id, "contextId": context_id},
    )
    return _properties(rows[0][0]) if rows else None


def _read_prior_context_id(cursor: Any, project_id: str, context_id: str) -> str | None:
    rows = _run_cypher(
        cursor,
        """
        MATCH (context:AgentContext)-[:DERIVED_FROM]->(prior:AgentContext)
        WHERE
          (context.contextId = $contextId OR context.context_id = $contextId)
          AND (context.projectId = $projectId OR context.project_id = $projectId)
        RETURN properties(prior)
        LIMIT 1
        """,
        "properties agtype",
        {"projectId": project_id, "contextId": context_id},
    )
    if not rows:
        return None
    properties = _properties(rows[0][0])
    value = _property(properties, "contextId", "context_id")
    return str(value) if value else None


def create_context(
    *,
    project_id: str,
    deck_id: str,
    conversation_id: str,
    sender_agent_id: str,
    receiving_agent_id: str,
    markdown: str,
    prior_context_id: str | None = None,
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
    prior_context_id = (
        _required_id(prior_context_id, "prior_context_id") if prior_context_id else None
    )
    producing_run_id = _optional_text(producing_run_id, "producing_run_id")

    agent_validator(project_id, deck_id, sender_agent_id)
    agent_validator(project_id, deck_id, receiving_agent_id)

    context_id = f"agentctx:{uuid4().hex[:24]}"
    created_at = _now()
    params: dict[str, Any] = {
        "contextId": context_id,
        "projectId": project_id,
        "conversationId": conversation_id,
        "senderAgentId": sender_agent_id,
        "receivingAgentId": receiving_agent_id,
        "markdown": markdown,
        "createdAt": created_at,
    }
    producing_property = ""
    if producing_run_id is not None:
        params["producingRunId"] = producing_run_id
        producing_property = ", producingRunId: $producingRunId"

    with _connection_scope(connection) as conn, conn.cursor() as cursor:
        _prepare(cursor)
        if prior_context_id is not None:
            prior = _read_context_properties(cursor, project_id, prior_context_id)
            if prior is None:
                raise AgentGraphError(
                    f"agentgraph_prior_context_not_found: {prior_context_id}"
                )

        _run_cypher(
            cursor,
            f"""
            MERGE (sender:Agent {{
              project_id: $projectId,
              agent_id: $senderAgentId
            }})
            MERGE (receiver:Agent {{
              project_id: $projectId,
              agent_id: $receivingAgentId
            }})
            CREATE (context:AgentContext {{
              contextId: $contextId,
              projectId: $projectId,
              conversationId: $conversationId,
              senderAgentId: $senderAgentId,
              receivingAgentId: $receivingAgentId,
              markdown: $markdown,
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
        if prior_context_id is not None:
            _run_cypher(
                cursor,
                """
                MATCH (context:AgentContext), (prior:AgentContext)
                WHERE
                  context.contextId = $contextId
                  AND context.projectId = $projectId
                  AND (prior.contextId = $priorContextId OR prior.context_id = $priorContextId)
                  AND (prior.projectId = $projectId OR prior.project_id = $projectId)
                CREATE (context)-[:DERIVED_FROM]->(prior)
                RETURN context.contextId
                """,
                "context_id agtype",
                {
                    "projectId": project_id,
                    "contextId": context_id,
                    "priorContextId": prior_context_id,
                },
            )

    return {
        "ok": True,
        "contextId": context_id,
        "projectId": project_id,
        "conversationId": conversation_id,
        "senderAgentId": sender_agent_id,
        "receivingAgentId": receiving_agent_id,
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
        properties = _read_context_properties(cursor, project_id, context_id)
        if properties is None:
            raise AgentGraphError(f"agentgraph_context_not_found: {context_id}")
        prior_context_id = _read_prior_context_id(cursor, project_id, context_id)

    markdown = (
        properties.get("markdown")
        if "markdown" in properties
        else properties.get("prompt", "")
    )
    return {
        "ok": True,
        "contextId": str(_property(properties, "contextId", "context_id") or context_id),
        "projectId": str(_property(properties, "projectId", "project_id") or ""),
        "conversationId": str(
            _property(properties, "conversationId", "conversation_id") or ""
        ),
        "senderAgentId": str(
            _property(properties, "senderAgentId", "sender_agent_id") or ""
        ),
        "receivingAgentId": str(
            _property(properties, "receivingAgentId", "receiving_agent_id") or ""
        ),
        "markdown": str(markdown) if markdown is not None else "",
        "producingRunId": _property(
            properties,
            "producingRunId",
            "producing_run_id",
        ),
        "priorContextId": prior_context_id,
        "createdAt": _property(properties, "createdAt", "created_at"),
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
    connection: Any | None = None,
) -> dict[str, Any]:
    context_id = _required_id(context_id, "context_id")
    project_id = _required_text(project_id, "project_id")
    result_id = _required_id(result_id, "result_id")
    run_id = _required_id(run_id, "run_id")
    status = _required_text(status, "status")
    markdown = _optional_markdown(markdown)
    result_ref = _optional_text(result_ref, "result_ref")
    created_at = _now()

    with _connection_scope(connection) as conn, conn.cursor() as cursor:
        _prepare(cursor)
        context = _read_context_properties(cursor, project_id, context_id)
        if context is None:
            raise AgentGraphError(f"agentgraph_context_not_found: {context_id}")

        existing = _run_cypher(
            cursor,
            """
            MATCH (context:AgentContext)-[:PRODUCED]->(result:Result)
            WHERE
              (context.contextId = $contextId OR context.context_id = $contextId)
              AND (context.projectId = $projectId OR context.project_id = $projectId)
              AND (result.resultId = $resultId OR result.result_id = $resultId)
            RETURN properties(result)
            LIMIT 1
            """,
            "properties agtype",
            {
                "projectId": project_id,
                "contextId": context_id,
                "resultId": result_id,
            },
        )
        if existing:
            return {
                "ok": True,
                "created": False,
                "contextId": context_id,
                "resultId": result_id,
            }

        params: dict[str, Any] = {
            "projectId": project_id,
            "contextId": context_id,
            "resultId": result_id,
            "runId": run_id,
            "status": status,
            "createdAt": created_at,
        }
        optional_properties = ""
        if markdown is not None:
            params["markdown"] = markdown
            optional_properties += ", markdown: $markdown"
        if result_ref is not None:
            params["resultRef"] = result_ref
            optional_properties += ", resultRef: $resultRef"

        rows = _run_cypher(
            cursor,
            f"""
            MATCH (context:AgentContext)
            WHERE
              (context.contextId = $contextId OR context.context_id = $contextId)
              AND (context.projectId = $projectId OR context.project_id = $projectId)
            CREATE (result:Result {{
              resultId: $resultId,
              contextId: $contextId,
              runId: $runId,
              status: $status,
              createdAt: $createdAt
              {optional_properties}
            }})
            CREATE (context)-[:PRODUCED]->(result)
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
        "createdAt": created_at,
    }
