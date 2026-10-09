"""Execution start and aggregate progress for accepted Card Runs."""

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


HERMES_TASK_STATUSES = {
    "triage", "todo", "scheduled", "ready", "running",
    "blocked", "review", "done", "archived",
}

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
    """Mark one exact accepted Run running from Hermes submission-start evidence."""

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


def update_run_progress(payload: dict[str, Any]) -> dict[str, Any]:
    """Update the existing Run with Hermes aggregate progress only."""

    run_id = required_text(payload.get("runId"), "run_id")
    hermes_root_id = required_text(payload.get("hermesRootId"), "hermes_root_id")
    hermes_status = required_text(payload.get("hermesStatus"), "hermes_status").lower()
    if hermes_status not in HERMES_TASK_STATUSES:
        raise CardDomainError("hermes_task_status_invalid")
    provider_total_tokens = optional_nonnegative_integer(
        payload, "providerTotalTokens",
    )
    cost_status = optional_cost_status(payload)

    def count(name: str) -> int | None:
        value = payload.get(name)
        if value is None:
            return None
        if isinstance(value, bool) or not isinstance(value, int) or value < 0:
            raise CardDomainError(f"{name}_invalid")
        return value

    counts = {
        name: count(name)
        for name in (
            "tasksCompleted", "tasksTotal", "activeWorkers", "toolCallCount",
            "providerInputTokens", "providerOutputTokens", "providerCachedTokens",
            "providerReasoningTokens",
        )
    }
    execution_active = hermes_status == "running" or bool(
        counts["activeWorkers"] is not None and counts["activeWorkers"] > 0
    )
    with connect_postgres() as connection, connection.cursor() as cursor:
        cursor.execute(
            """
            UPDATE ag_catalog.agent_runs AS run SET
              state=CASE
                WHEN %s AND run.state='pending' THEN 'running'
                ELSE run.state
              END,
              started_at=CASE
                WHEN %s THEN COALESCE(run.started_at, NOW())
                ELSE run.started_at
              END,
              provider_thread_ref=CASE
                WHEN run.runtime_mode='magentic_one'
                  THEN COALESCE(run.provider_thread_ref, %s)
                ELSE COALESCE(%s, run.provider_thread_ref)
              END,
              provider_turn_ref=COALESCE(%s::text, provider_turn_ref),
              hermes_phase=%s,
              hermes_task_completed_count=COALESCE(%s, hermes_task_completed_count),
              hermes_task_total_count=COALESCE(%s, hermes_task_total_count),
              hermes_active_worker_count=COALESCE(%s, hermes_active_worker_count),
              tool_call_count=COALESCE(%s, tool_call_count),
              provider_input_tokens=COALESCE(%s, provider_input_tokens),
              provider_output_tokens=COALESCE(%s, provider_output_tokens),
              provider_cached_tokens=COALESCE(%s, provider_cached_tokens),
              provider_reasoning_tokens=COALESCE(%s, provider_reasoning_tokens),
              provider_total_tokens=COALESCE(%s, provider_total_tokens),
              cost_status=COALESCE(%s, cost_status),
              total_cost_usd=COALESCE(%s, total_cost_usd)
            FROM ag_catalog.agent_card_revisions AS revision
            WHERE run.run_id=%s
              AND revision.revision_id=run.target_card_revision_id
              AND run.state IN ('pending','running')
              AND (
                run.runtime_mode!='magentic_one'
                OR (
                  run.runtime_kind='hermes'
                  AND revision.card_id='card_magentic'
                  AND revision.runtime_profile='card_magentic'
                  AND (run.provider_thread_ref IS NULL OR run.provider_thread_ref=%s)
                )
              )
            RETURNING run.provider_thread_ref
            """,
            (
                execution_active, execution_active,
                hermes_root_id, hermes_root_id,
                payload.get("hermesRunId"), hermes_status,
                counts["tasksCompleted"], counts["tasksTotal"],
                counts["activeWorkers"], counts["toolCallCount"],
                counts["providerInputTokens"], counts["providerOutputTokens"],
                counts["providerCachedTokens"], counts["providerReasoningTokens"],
                provider_total_tokens, cost_status,
                payload.get("totalCostUsd"), run_id, hermes_root_id,
            ),
        )
        row = cursor.fetchone()
        effective_hermes_root_id = row[0] if row is not None else None
        updated = cursor.rowcount == 1 and effective_hermes_root_id == hermes_root_id
    telemetry_written = (
        agentgraph_run_observations.observe_run_progress(
            run_id, hermes_status, payload
        )
        if updated
        else False
    )
    return {
        "ok": True,
        "runId": run_id,
        "hermesRootId": effective_hermes_root_id,
        "updated": updated,
        "telemetryWritten": telemetry_written,
    }
