"""Execution start and aggregate progress for accepted Card Runs."""
# Graph + less = more: less code that does the same work as more code is more useful.
# Entity names the feature; Relationship explains why this file belongs and what it contributes.
# Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
# Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
# Entity: Run Ledger
# Relationship: This file starts one accepted Run from exact submission/session evidence and persists bounded execution state, usage, cost, and progress fields.
#
# Entity: AgentGraph
# Relationship: This file emits execution-start and progress observations only after the matching durable Run transition succeeds.

from __future__ import annotations

from datetime import datetime
from typing import Any

from psycopg.rows import dict_row

from app.python_models import agentgraph_run_observations
from app.python_models.postgres import connect_postgres
from app.python_models.saved_card_contract import (
    CardDomainError,
    required_text,
    utc_now,
)


_COST_STATUSES = {"actual", "estimated", "included", "unknown"}


def optional_nonnegative_integer(payload: dict[str, Any], name: str) -> int | None:
    value = payload.get(name)
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise CardDomainError("run_provider_total_tokens_invalid")
    return value


def optional_cost_status(payload: dict[str, Any]) -> str | None:
    value = payload.get("costStatus")
    if value is None:
        return None
    if not isinstance(value, str) or value not in _COST_STATUSES:
        raise CardDomainError("run_cost_status_invalid")
    return value


def start_run(payload: dict[str, Any]) -> dict[str, Any]:
    """Mark one exact accepted Run running from external submission-start evidence."""

    run_id = required_text(payload.get("runId"), "run_id")
    correlation_id = required_text(payload.get("correlationId"), "correlation_id")
    submission_id = required_text(payload.get("submissionId"), "submission_id")
    hermes_session_ref = required_text(
        payload.get("hermesSessionRef"), "hermes_session_ref"
    )
    if submission_id != run_id:
        raise CardDomainError("run_submission_identity_mismatch")
    with connect_postgres() as connection, connection.cursor(row_factory=dict_row) as cursor:
        cursor.execute(
            """
            UPDATE ag_catalog.agent_runs SET
              state='running', started_at=COALESCE(started_at, NOW()),
              hermes_session_ref=COALESCE(hermes_session_ref, %s),
              provider_turn_ref=COALESCE(provider_turn_ref, %s)
            WHERE run_id=%s AND correlation_id=%s AND state='pending'
              AND (hermes_session_ref IS NULL OR hermes_session_ref=%s)
              AND (provider_turn_ref IS NULL OR provider_turn_ref=%s)
            RETURNING run_id, correlation_id, state, started_at,
                      hermes_session_ref, provider_turn_ref
            """,
            (
                hermes_session_ref, submission_id, run_id, correlation_id,
                hermes_session_ref, submission_id,
            ),
        )
        row = cursor.fetchone()
        updated = row is not None
        if row is None:
            cursor.execute(
                """
                SELECT run_id, correlation_id, state, started_at,
                       hermes_session_ref, provider_turn_ref
                FROM ag_catalog.agent_runs
                WHERE run_id=%s AND correlation_id=%s
                """,
                (run_id, correlation_id),
            )
            row = cursor.fetchone()
    if row is None:
        raise CardDomainError("run_not_found")
    existing = dict(row)
    if (
        str(existing.get("run_id") or "") != run_id
        or str(existing.get("correlation_id") or "") != correlation_id
        or str(existing.get("hermes_session_ref") or "") != hermes_session_ref
        or str(existing.get("provider_turn_ref") or "") != submission_id
        or str(existing.get("state") or "") != "running"
    ):
        raise CardDomainError("run_submission_start_conflict")
    started_at = existing.get("started_at")
    telemetry_written = agentgraph_run_observations.observe_run_execution_started(
        run_id=run_id,
        submission_id=submission_id,
        hermes_session_id=hermes_session_ref,
        started_at=started_at if isinstance(started_at, datetime) else utc_now(),
    ) if updated else False
    return {
        "ok": True,
        "runId": run_id,
        "correlationId": correlation_id,
        "submissionId": submission_id,
        "state": "running",
        "startedAt": started_at.isoformat() if isinstance(started_at, datetime) else None,
        "updated": updated,
        "telemetryWritten": telemetry_written,
    }
