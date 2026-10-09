"""Terminal settlement for durable Card Runs."""

from __future__ import annotations

import re
from typing import Any

from psycopg.rows import dict_row

from app.python_models import agentgraph_run_observations
from app.python_models.card_run_execution import (
    HERMES_TASK_STATUSES,
    optional_cost_status,
    optional_nonnegative_integer,
)
from app.python_models.card_run_readback import run_projection
from app.python_models.postgres import connect_postgres
from app.python_models.saved_card_contract import (
    CardDomainError,
    required_text,
    sha256_text,
)


def _validated_run_settlement_request(payload: dict[str, Any]) -> dict[str, Any]:
    run_id = required_text(payload.get("runId"), "run_id")
    state = required_text(payload.get("state"), "state")
    if state not in {"completed", "blocked", "failed", "cancelled"}:
        raise CardDomainError("run_terminal_state_invalid")
    provider_total_tokens = optional_nonnegative_integer(
        payload, "providerTotalTokens",
    )
    cost_status = optional_cost_status(payload)
    hermes_status = str(payload.get("hermesStatus") or "").strip().lower() or None
    if hermes_status is not None and hermes_status not in HERMES_TASK_STATUSES:
        raise CardDomainError("hermes_task_status_invalid")
    reconcile_persisted_result = payload.get("reconcilePersistedResult", False)
    if not isinstance(reconcile_persisted_result, bool):
        raise CardDomainError("run_result_reconciliation_invalid")
    child_provider = str(payload.get("provider") or "").strip()
    child_model = str(payload.get("model") or "").strip()
    if bool(child_provider) != bool(child_model):
        raise CardDomainError("run_child_model_configuration_incomplete")
    fallback_occurred = payload.get("modelFallbackOccurred", False)
    if not isinstance(fallback_occurred, bool):
        raise CardDomainError("run_model_fallback_flag_invalid")
    fallback_reason = str(payload.get("modelFallbackReason") or "").strip()
    if fallback_occurred and not fallback_reason:
        raise CardDomainError("run_model_fallback_reason_required")
    if reconcile_persisted_result:
        final_result = str(payload.get("finalResult") or "")
        expected_sha256 = required_text(
            payload.get("expectedResultSha256"),
            "expected_result_sha256",
        )
        if state != "completed" or not final_result:
            raise CardDomainError("run_result_reconciliation_invalid")
        if not re.fullmatch(r"[a-f0-9]{64}", expected_sha256) or sha256_text(final_result) != expected_sha256:
            raise CardDomainError("run_result_reconciliation_hash_mismatch")
    return {
        "runId": run_id,
        "state": state,
        "providerTotalTokens": provider_total_tokens,
        "costStatus": cost_status,
        "hermesStatus": hermes_status,
        "reconcilePersistedResult": reconcile_persisted_result,
        "childProvider": child_provider,
        "childModel": child_model,
        "fallbackOccurred": fallback_occurred,
        "fallbackReason": fallback_reason,
    }


def _validated_run_settlement_authority(
    authority_row: dict[str, Any],
    payload: dict[str, Any],
    request: dict[str, Any],
) -> None:
    saved_openai_runtime = str(
        authority_row.get("saved_openai_runtime") or ""
    ).strip()
    provider_pair = (
        str(authority_row.get("provider") or "").strip(),
        str(authority_row.get("access_mode") or "").strip(),
    )
    expected_effective_provider = (
        {
            ("openai", "chatgpt-account"): "openai-codex",
            ("openai", "openai-api"): "openai",
            ("openrouter", "openrouter-api"): "openrouter",
            ("local_openai_compatible", "openai-api"): "local_openai_compatible",
        }.get(provider_pair, "")
        if authority_row.get("runtime_kind") == "hermes"
        else ""
    )
    expected_provider_api_mode = (
        "codex_app_server"
        if saved_openai_runtime == "codex_app_server"
        else ""
    )
    supplied_effective_provider = str(
        payload.get("effectiveProvider") or ""
    ).strip()
    supplied_provider_api_mode = str(
        payload.get("providerApiMode") or ""
    ).strip()
    runtime_mode = str(authority_row.get("runtime_mode") or "").strip()
    supplied_session_ref = str(payload.get("hermesSessionRef") or "").strip()
    supplied_thread_ref = str(payload.get("providerThreadRef") or "").strip()
    supplied_turn_ref = str(payload.get("providerTurnRef") or "").strip()
    persisted_session_ref = str(authority_row.get("hermes_session_ref") or "").strip()
    persisted_thread_ref = str(authority_row.get("provider_thread_ref") or "").strip()
    persisted_turn_ref = str(authority_row.get("provider_turn_ref") or "").strip()
    if (
        persisted_session_ref and supplied_session_ref
        and persisted_session_ref != supplied_session_ref
    ):
        raise CardDomainError("run_hermes_session_mismatch")
    if (
        persisted_thread_ref and supplied_thread_ref
        and persisted_thread_ref != supplied_thread_ref
    ):
        raise CardDomainError("run_hermes_root_mismatch")
    if (
        runtime_mode != "magentic_one"
        and persisted_turn_ref and supplied_turn_ref
        and persisted_turn_ref != supplied_turn_ref
    ):
        raise CardDomainError("run_hermes_submission_mismatch")
    hermes_transport_incomplete = (
        not supplied_turn_ref
        or (runtime_mode == "magentic_one" and not supplied_thread_ref)
        or (runtime_mode != "magentic_one" and not supplied_session_ref)
    )
    if (
        supplied_effective_provider
        and expected_effective_provider
        and supplied_effective_provider != expected_effective_provider
    ):
        raise CardDomainError("run_effective_provider_mismatch")
    if (
        request["childProvider"]
        and supplied_effective_provider
        and request["childProvider"] != supplied_effective_provider
    ):
        raise CardDomainError("run_execution_provider_mismatch")
    if (
        supplied_provider_api_mode
        and expected_provider_api_mode
        and supplied_provider_api_mode != expected_provider_api_mode
    ):
        raise CardDomainError("run_provider_api_mode_mismatch")
    if (
        request["state"] == "completed"
        and not request["reconcilePersistedResult"]
        and authority_row.get("runtime_kind") == "hermes"
        and (
            hermes_transport_incomplete
            or (
                runtime_mode != "magentic_one"
                and (
                    not supplied_effective_provider
                    or not request["childProvider"]
                    or not request["childModel"]
                    or (
                        expected_provider_api_mode
                        and not supplied_provider_api_mode
                    )
                )
            )
        )
    ):
        raise CardDomainError("run_provider_transport_evidence_incomplete")


def _apply_terminal_run_settlement(
    cursor: Any,
    authority_row: dict[str, Any],
    payload: dict[str, Any],
    request: dict[str, Any],
) -> tuple[bool, dict[str, Any]]:
    if request["reconcilePersistedResult"]:
        cursor.execute(
            """
            UPDATE ag_catalog.agent_runs SET final_result=%s
            WHERE run_id=%s AND state='completed' AND final_result IS NULL
            """,
            (payload.get("finalResult"), request["runId"]),
        )
    else:
        cursor.execute(
            """
            UPDATE ag_catalog.agent_runs SET state=%s, finished_at=NOW(),
              provider=COALESCE(%s, provider),
              model_key=COALESCE(%s, model_key),
              provider_model_id=COALESCE(%s, provider_model_id),
              model_fallback_occurred=%s,
              model_fallback_reason=%s,
              effective_provider=COALESCE(effective_provider, %s),
              provider_api_mode=COALESCE(provider_api_mode, %s),
              hermes_session_ref=COALESCE(hermes_session_ref, %s),
              provider_thread_ref=COALESCE(%s, provider_thread_ref),
              provider_turn_ref=COALESCE(%s::text, provider_turn_ref),
              error_code=%s, error_summary=%s,
              provider_input_tokens=COALESCE(%s, provider_input_tokens),
              provider_output_tokens=COALESCE(%s, provider_output_tokens),
              provider_cached_tokens=COALESCE(%s, provider_cached_tokens),
              provider_reasoning_tokens=COALESCE(%s, provider_reasoning_tokens),
              provider_total_tokens=COALESCE(%s, provider_total_tokens),
              cost_status=COALESCE(%s, cost_status),
              tool_call_count=COALESCE(%s, tool_call_count),
              total_cost_usd=COALESCE(%s, total_cost_usd),
              hermes_phase=%s,
              hermes_task_completed_count=COALESCE(%s, hermes_task_completed_count),
              hermes_task_total_count=COALESCE(%s, hermes_task_total_count),
              hermes_active_worker_count=COALESCE(%s, hermes_active_worker_count),
              final_result=%s
            WHERE run_id=%s AND state IN ('pending','running')
            """,
            (
                request["state"], request["childProvider"] or None,
                request["childModel"] or None, request["childModel"] or None,
                request["fallbackOccurred"], request["fallbackReason"] or None,
                payload.get("effectiveProvider"), payload.get("providerApiMode"),
                payload.get("hermesSessionRef"),
                payload.get("providerThreadRef"), payload.get("providerTurnRef"),
                payload.get("errorCode"), payload.get("errorSummary"),
                payload.get("providerInputTokens"), payload.get("providerOutputTokens"),
                payload.get("providerCachedTokens"), payload.get("providerReasoningTokens"),
                request["providerTotalTokens"], request["costStatus"],
                payload.get("toolCallCount"), payload.get("totalCostUsd"),
                request["hermesStatus"], payload.get("tasksCompleted"),
                payload.get("tasksTotal"), payload.get("activeWorkers"),
                payload.get("finalResult"),
                request["runId"],
            ),
        )
    updated = cursor.rowcount == 1
    cursor.execute(
        """
        SELECT run_id, project_id, deck_id, target_card_revision_id,
               runtime_kind, runtime_mode, provider, model_key, provider_model_id,
               access_mode, correlation_id, saved_openai_runtime,
               effective_provider, provider_api_mode,
               execution_authority_sha256, hermes_session_ref, provider_thread_ref,
               provider_turn_ref, state, started_at, finished_at,
               error_code, error_summary, provider_input_tokens,
               provider_output_tokens, provider_cached_tokens,
               provider_reasoning_tokens, provider_total_tokens, cost_status,
               tool_call_count, total_cost_usd,
               auto_tools_decision, auto_model_decision,
               hermes_phase, hermes_task_completed_count,
               hermes_task_total_count, hermes_active_worker_count,
               final_result, model_fallback_occurred, model_fallback_reason
        FROM ag_catalog.agent_runs WHERE run_id=%s
        """,
        (request["runId"],),
    )
    existing = cursor.fetchone()
    if existing is None:
        raise CardDomainError("run_not_found")
    run_record = dict(existing)
    if request["reconcilePersistedResult"] and str(run_record.get("final_result") or "") != str(payload.get("finalResult")):
        raise CardDomainError("run_result_conflict")
    return updated, run_record


def finish_run(payload: dict[str, Any]) -> dict[str, Any]:
    request = _validated_run_settlement_request(payload)
    run_id = request["runId"]
    state = request["state"]
    with connect_postgres() as connection, connection.cursor(row_factory=dict_row) as cursor:
        cursor.execute(
            """
            SELECT runtime_kind, runtime_mode, provider, access_mode, saved_openai_runtime,
                   effective_provider, provider_api_mode,
                   hermes_session_ref, provider_thread_ref, provider_turn_ref
            FROM ag_catalog.agent_runs WHERE run_id=%s
            FOR UPDATE
            """,
            (run_id,),
        )
        authority_row = cursor.fetchone()
        if authority_row is None:
            raise CardDomainError("run_not_found")
        authority_row = dict(authority_row)
        _validated_run_settlement_authority(authority_row, payload, request)
        updated, run_record = _apply_terminal_run_settlement(
            cursor, authority_row, payload, request,
        )
    telemetry_written = (
        agentgraph_run_observations.observe_run_result_ready(run_id)
        if updated and request["reconcilePersistedResult"]
        else agentgraph_run_observations.observe_run_finish(run_id, state, payload)
        if updated
        else False
    )
    return {
        "ok": True,
        "runId": run_id,
        "state": str(run_record["state"]),
        "updated": updated,
        "telemetryWritten": telemetry_written,
        "runRecord": run_projection(run_record),
    }
