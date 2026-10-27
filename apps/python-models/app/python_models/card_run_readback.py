"""Durable Card Run projection and bounded readback."""

# Graph + less = more: less code that does the same work as more code is more useful.
# Entity names the feature; Relationship explains why this file belongs and what it contributes.
# Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
# Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
# Entity: Run Ledger
# Relationship: This file projects durable Run state and performs bounded newest-first Project, deck, Card, correlation, and exact-Run readback without controlling execution.
#
# Entity: AgentGraph
# Relationship: This file verifies an optional conversation-scoped Run read through the exact AgentGraph observation before returning it.

from __future__ import annotations

from datetime import datetime
from typing import Any

from psycopg.rows import dict_row

from app.python_models import agentgraph_query, saved_cards
from app.python_models.card_run_graph_references import graph_references_for_run
from app.python_models.postgres import connect_postgres
from app.python_models.saved_card_contract import CardDomainError, required_text


def run_projection(row: dict[str, Any]) -> dict[str, Any]:
    def timestamp(name: str) -> str | None:
        value = row.get(name)
        return value.isoformat() if isinstance(value, datetime) else None

    cost = row.get("total_cost_usd")
    return {
        "runId": str(row.get("run_id") or ""),
        "correlationId": str(row.get("correlation_id") or ""),
        "projectId": str(row.get("project_id") or ""),
        "deckId": str(row.get("deck_id") or ""),
        "cardId": str(row.get("card_id") or ""),
        "cardRevisionId": str(row.get("target_card_revision_id") or ""),
        "runtimeKind": str(row.get("runtime_kind") or ""),
        "runtimeMode": str(row.get("runtime_mode") or ""),
        "runtimeProfile": str(row.get("runtime_profile") or ""),
        "provider": str(row.get("effective_provider") or "") or None,
        "model": (
            str(row.get("provider_model_id") or "") or None
            if str(row.get("effective_provider") or "").strip()
            else None
        ),
        "accessMode": str(row.get("access_mode") or "") or None,
        "effectiveProvider": str(row.get("effective_provider") or "") or None,
        "state": str(row.get("state") or ""),
        "providerThreadRef": str(row.get("provider_thread_ref") or "") or None,
        "providerTurnRef": str(row.get("provider_turn_ref") or "") or None,
        "runtimeSessionRef": str(row.get("hermes_session_ref") or "") or None,
        "toolCallCount": row.get("tool_call_count"),
        "inputTokens": row.get("provider_input_tokens"),
        "outputTokens": row.get("provider_output_tokens"),
        "cachedTokens": row.get("provider_cached_tokens"),
        "reasoningTokens": row.get("provider_reasoning_tokens"),
        "providerTotalTokens": row.get("provider_total_tokens"),
        "costUsd": float(cost) if cost is not None else None,
        "costStatus": str(row.get("cost_status") or "") or None,
        "autoToolsDecision": row.get("auto_tools_decision"),
        "autoModelDecision": row.get("auto_model_decision"),
        "finishedAt": timestamp("finished_at"),
        "createdAt": timestamp("created_at"),
        "result": str(row.get("final_result") or "") or None,
        "errorCode": str(row.get("error_code") or "") or None,
        "errorSummary": str(row.get("error_summary") or "") or None,
    }


def read_run_history(payload: dict[str, Any]) -> dict[str, Any]:
    """Read bounded newest-first root Run history for one saved Card."""

    project_ref = required_text(payload.get("projectId"), "project_id")
    deck_id = required_text(payload.get("deckId"), "deck_id")
    card_id = required_text(payload.get("cardId"), "card_id")
    raw_limit = payload.get("limit", 8)
    if isinstance(raw_limit, bool) or not isinstance(raw_limit, int) or not 1 <= raw_limit <= 20:
        raise CardDomainError("run_history_limit_invalid")

    with connect_postgres(autocommit=False) as connection:
        with connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute("SET TRANSACTION READ ONLY")
            project = saved_cards.resolve_project_record(cursor, project_ref)
            project_id = str(project["id"])
            cursor.execute(
                """
                SELECT run.*, revision.card_id, revision.runtime_profile, revision.title,
                       revision.runtime_extension_config
                FROM ag_catalog.agent_runs AS run
                JOIN ag_catalog.agent_card_revisions AS revision
                  ON revision.revision_id=run.target_card_revision_id
                WHERE run.project_id=%s AND run.deck_id=%s AND revision.card_id=%s
                ORDER BY run.created_at DESC, run.run_id DESC
                LIMIT %s
                """,
                (project_id, deck_id, card_id, raw_limit),
            )
            rows = [dict(row) for row in cursor.fetchall()]
    return {
        "ok": True,
        "projectId": project_id,
        "deckId": deck_id,
        "cardId": card_id,
        "runs": [run_projection(row) for row in rows],
        "limit": raw_limit,
    }


def read_latest_runs(payload: dict[str, Any]) -> dict[str, Any]:
    """Read the newest root Run for each requested saved Card in one transaction."""

    project_ref = required_text(payload.get("projectId"), "project_id")
    deck_id = required_text(payload.get("deckId"), "deck_id")
    raw_card_ids = payload.get("cardIds")
    if not isinstance(raw_card_ids, list) or not 1 <= len(raw_card_ids) <= 128:
        raise CardDomainError("run_card_ids_invalid")
    card_ids: list[str] = []
    seen: set[str] = set()
    for value in raw_card_ids:
        card_id = str(value).strip() if isinstance(value, str) else ""
        if not card_id or card_id in seen:
            raise CardDomainError("run_card_ids_invalid")
        seen.add(card_id)
        card_ids.append(card_id)

    with connect_postgres(autocommit=False) as connection:
        with connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute("SET TRANSACTION READ ONLY")
            project = saved_cards.resolve_project_record(cursor, project_ref)
            project_id = str(project["id"])
            cursor.execute(
                """
                SELECT DISTINCT ON (revision.card_id)
                       run.*, revision.card_id, revision.runtime_profile, revision.title,
                       revision.runtime_extension_config
                FROM ag_catalog.agent_runs AS run
                JOIN ag_catalog.agent_card_revisions AS revision
                  ON revision.revision_id=run.target_card_revision_id
                WHERE run.project_id=%s AND run.deck_id=%s
                  AND revision.card_id=ANY(%s)
                ORDER BY revision.card_id, run.created_at DESC, run.run_id DESC
                """,
                (project_id, deck_id, card_ids),
            )
            rows = [dict(row) for row in cursor.fetchall()]
    return {
        "ok": True,
        "projectId": project_id,
        "deckId": deck_id,
        "runs": [run_projection(row) for row in rows],
    }


def read_run(payload: dict[str, Any]) -> dict[str, Any]:
    """Read one durable Run by its public selectors."""

    project_ref = required_text(payload.get("projectId"), "project_id")
    deck_id = required_text(payload.get("deckId"), "deck_id")
    conversation_id = (required_text(payload.get("conversationId"), "conversation_id")
                       if "conversationId" in payload else None)
    selectors = {
        "run_id": str(payload.get("runId") or "").strip(),
        "correlation_id": str(payload.get("correlationId") or "").strip(),
        "card_id": str(payload.get("cardId") or "").strip(),
    }
    selected = [(name, value) for name, value in selectors.items() if value]
    if len(selected) != 1:
        raise CardDomainError("run_selector_invalid")
    selector, value = selected[0]
    with connect_postgres(autocommit=False) as connection:
        with connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute("SET TRANSACTION READ ONLY")
            project = saved_cards.resolve_project_record(cursor, project_ref)
            project_id = str(project["id"])
            if selector == "card_id":
                cursor.execute(
                    """
                    SELECT run.*, revision.card_id, revision.runtime_profile, revision.title,
                           revision.runtime_extension_config
                    FROM ag_catalog.agent_runs AS run
                    JOIN ag_catalog.agent_card_revisions AS revision
                      ON revision.revision_id=run.target_card_revision_id
                    WHERE run.project_id=%s AND run.deck_id=%s AND revision.card_id=%s
                    ORDER BY run.created_at DESC LIMIT 1
                    """,
                    (project_id, deck_id, value),
                )
            else:
                column = {
                    "run_id": "run.run_id",
                    "correlation_id": "run.correlation_id",
                }[selector]
                cursor.execute(
                    f"""
                    SELECT run.*, revision.card_id, revision.runtime_profile, revision.title,
                           revision.runtime_extension_config
                    FROM ag_catalog.agent_runs AS run
                    JOIN ag_catalog.agent_card_revisions AS revision
                      ON revision.revision_id=run.target_card_revision_id
                    WHERE run.project_id=%s AND run.deck_id=%s AND {column}=%s
                    ORDER BY run.created_at ASC LIMIT 1
                    """,
                    (project_id, deck_id, value),
                )
            row = cursor.fetchone()
            graph_references = (
                graph_references_for_run(cursor, str(row["run_id"]))
                if row is not None else []
            )
            if row is not None and conversation_id is not None:
                scope = agentgraph_query.execute_fixed_agentgraph_query(
                    cursor,
                    """
                    MATCH (run:Run {projectId: $projectId, deckId: $deckId,
                                    runId: $runId, conversationId: $conversationId})
                    RETURN run.runId, run.inputMessageIds
                    """,
                    {"projectId": project_id, "deckId": deck_id,
                     "runId": str(row["run_id"]), "conversationId": conversation_id},
                    "run_id agtype, input_message_ids agtype",
                )
                if len(scope) != 1 or scope[0].get("run_id") != str(row["run_id"]):
                    return {"ok": True, "run": None}
    run = run_projection(dict(row)) if row is not None else None
    if run is not None:
        run["graphReferences"] = graph_references
    if run is not None and conversation_id is not None:
        run["conversationId"] = conversation_id
        raw_input_ids = scope[0].get("input_message_ids")
        run["inputMessageIds"] = (
            [str(value) for value in raw_input_ids]
            if isinstance(raw_input_ids, list)
            else []
        )
    return {"ok": True, "run": run}
