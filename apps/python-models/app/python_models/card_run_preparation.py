"""Accepted Card Run request persistence and fallible preparation."""
# Graph + less = more: less code that does the same work as more code is more useful.
# Entity names the feature; Relationship explains why this file belongs and what it contributes.
# Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
# Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
# Entity: Run Ledger
# Relationship: This file accepts one durable pending Run, preserves idempotent identity, records selection decisions, and settles preparation failures against that same row.
#
# Entity: Card Invocation
# Relationship: This file invokes the saved Card preparation boundary and returns the exact external transport identity for ordinary Card execution.
#
# Entity: IDF
# Relationship: This file retains and reloads the one canonical IDF before exposing any runtime request or Magnetic mission.
#
# Entity: AgentGraph
# Relationship: This file records acceptance, successful preparation, and preparation-failure observations only around corresponding durable Run transitions.
#
# Entity: Magnetic Membership
# Relationship: This file projects the saved Mag One orchestrator and exact blue-connected worker authorities into one bounded root task packet.

from __future__ import annotations

import re
from datetime import datetime
from typing import Any

from psycopg.rows import dict_row

from app.python_models import (
    agentgraph_run_observations,
    card_invocation_preparation,
    card_run_inputs,
    saved_cards,
)
from app.python_models.card_run_auto_model import AutoModelSelectionError
from app.python_models.postgres import connect_postgres
from app.python_models.saved_card_contract import (
    CardDomainError,
    accepted_at,
    canonical_json,
    card_runtime,
    required_content,
    required_text,
    utc_now,
)


def _decision_json(value: Any, field: str) -> str | None:
    if value is None:
        return None
    if not isinstance(value, dict):
        raise CardDomainError(f"{field}_invalid")
    return canonical_json(value)


def _decision_matches(value: Any, expected: Any) -> bool:
    if value is None or expected is None:
        return value is None and expected is None
    return isinstance(value, dict) and isinstance(expected, dict) and value == expected


def accept_run_request(payload: dict[str, Any]) -> dict[str, Any]:
    """Persist one accepted outer Card request before fallible preparation.

    The row is the existing product Run authority in ``pending`` state. It is
    not evidence that an external Run, provider call, or tool call exists.
    """

    project_ref = required_text(payload.get("projectId"), "project_id")
    deck_id = required_text(payload.get("deckId"), "deck_id")
    card_id = required_text(payload.get("cardId"), "card_id")
    run_id = required_text(payload.get("runId"), "run_id")
    correlation_id = required_text(payload.get("correlationId"), "correlation_id")
    accepted_at_value = utc_now()
    preparation_started_at = utc_now()
    loaded = saved_cards.load_deck(project_ref, deck_id)
    card = next(
        (item for item in loaded["deck"]["nodes"] if item.get("id") == card_id),
        None,
    )
    if card is None:
        raise CardDomainError("card_not_found")
    revision_id = required_text(card.get("_cardRevisionId"), "card_revision_id")
    expected_revision = str(payload.get("cardRevisionId") or "").strip()
    if expected_revision and revision_id != expected_revision:
        raise CardDomainError("card_revision_changed")
    runtime = card_runtime(card)
    runtime_kind = "hermes"
    runtime_mode = runtime["mode"]
    project_id = str(loaded["projectId"])

    with connect_postgres() as connection, connection.cursor(row_factory=dict_row) as cursor:
        cursor.execute(
            """
            INSERT INTO ag_catalog.agent_runs (
              run_id, project_id, deck_id, target_card_revision_id,
              runtime_kind, runtime_mode, correlation_id, state, created_at
            ) VALUES (%s,%s,%s,%s,%s,%s,%s,'pending',%s)
            ON CONFLICT DO NOTHING
            """,
            (
                run_id, project_id, deck_id, revision_id,
                runtime_kind, runtime_mode, correlation_id, accepted_at_value,
            ),
        )
        created = cursor.rowcount == 1
        cursor.execute(
            """
            SELECT run_id, project_id, deck_id, target_card_revision_id,
                   correlation_id, state, created_at, provider_turn_ref
            FROM ag_catalog.agent_runs
            WHERE run_id=%s OR correlation_id=%s
            ORDER BY CASE WHEN run_id=%s THEN 0 ELSE 1 END, created_at ASC
            LIMIT 1
            """,
            (run_id, correlation_id, run_id),
        )
        row = cursor.fetchone()
    if row is None:
        raise CardDomainError("run_identity_conflict")
    existing = dict(row)
    if (
        str(existing.get("run_id")) != run_id
        or str(existing.get("correlation_id")) != correlation_id
        or str(existing.get("project_id")) != project_id
        or str(existing.get("deck_id")) != deck_id
        or str(existing.get("target_card_revision_id")) != revision_id
    ):
        raise CardDomainError("run_identity_conflict")
    persisted_created_at = existing.get("created_at")
    if isinstance(persisted_created_at, datetime):
        accepted_at_value = persisted_created_at
    observed = agentgraph_run_observations.observe_run_acceptance(
        project_id=project_id,
        deck_id=deck_id,
        card_id=card_id,
        run_id=run_id,
        correlation_id=correlation_id,
        accepted_at=accepted_at_value,
        preparation_started_at=preparation_started_at,
        conversation_id=str(payload.get("conversationId") or "").strip() or None,
    )
    return {
        "ok": True,
        "runId": run_id,
        "correlationId": correlation_id,
        "projectId": project_id,
        "deckId": deck_id,
        "cardId": card_id,
        "cardRevisionId": revision_id,
        "acceptedAt": accepted_at_value.isoformat(),
        "preparationStartedAt": preparation_started_at.isoformat(),
        "state": str(existing.get("state") or "pending"),
        "created": created,
        "telemetryWritten": observed,
    }


def _fail_accepted_run_preparation(
    accepted: dict[str, Any],
    payload: dict[str, Any],
) -> dict[str, Any]:
    """Settle the exact accepted snapshot without rereading a newer Card revision."""

    error_summary = required_text(payload.get("errorSummary"), "error_summary")
    error_code = str(payload.get("errorCode") or "configured_card_preparation_failed").strip()
    if not error_code:
        error_code = "configured_card_preparation_failed"
    ended_at = utc_now()
    accepted_at_value = accepted_at(accepted["acceptedAt"])
    elapsed_ms = max(0.0, (ended_at - accepted_at_value).total_seconds() * 1000)
    auto_tools_decision = _decision_json(
        payload.get("autoToolsDecision"), "auto_tools_decision",
    )
    auto_model_decision = _decision_json(
        payload.get("autoModelDecision"), "auto_model_decision",
    )
    with connect_postgres() as connection, connection.cursor(row_factory=dict_row) as cursor:
        cursor.execute(
            """
            SELECT run.run_id, run.state, run.error_code,
                   run.provider_thread_ref, run.provider_turn_ref,
                   revision.card_id
            FROM ag_catalog.agent_runs AS run
            JOIN ag_catalog.agent_card_revisions AS revision
              ON revision.revision_id=run.target_card_revision_id
            WHERE run.run_id=%s AND run.project_id=%s AND run.deck_id=%s
              AND revision.card_id=%s
            FOR UPDATE
            """,
            (
                accepted["runId"], accepted["projectId"], accepted["deckId"],
                accepted["cardId"],
            ),
        )
        row = cursor.fetchone()
        if row is None:
            raise CardDomainError("run_preparation_scope_mismatch")
        if row.get("provider_thread_ref") is not None or row.get("provider_turn_ref") is not None:
            raise CardDomainError("run_preparation_hermes_run_already_created")
        preparation_terminal = (
            row.get("state") in {"pending", "running"}
            or (
                row.get("state") == "failed"
                and row.get("error_code") == "input_files_materialization_failed"
            )
        )
        if preparation_terminal:
            cursor.execute(
                """
                UPDATE ag_catalog.agent_runs
                SET state='failed', finished_at=%s,
                    error_code=%s, error_summary=%s,
                    provider=NULL, model_key=NULL, provider_model_id=NULL,
                    access_mode=NULL, saved_openai_runtime=NULL,
                    effective_provider=NULL, provider_api_mode=NULL,
                    provider_input_tokens=NULL, provider_output_tokens=NULL,
                    provider_cached_tokens=NULL, provider_reasoning_tokens=NULL,
                    provider_total_tokens=NULL, cost_status=NULL,
                    tool_call_count=NULL, total_cost_usd=NULL,
                    auto_tools_decision=%s::jsonb,
                    auto_model_decision=%s::jsonb
                WHERE run_id=%s
                  AND (
                    state IN ('pending','running')
                    OR (
                      state='failed'
                      AND error_code='input_files_materialization_failed'
                    )
                  )
                  AND provider_thread_ref IS NULL AND provider_turn_ref IS NULL
                """,
                (
                    ended_at, error_code, error_summary,
                    auto_tools_decision, auto_model_decision,
                    accepted["runId"],
                ),
            )
            updated = cursor.rowcount == 1
        else:
            updated = False
    observed = agentgraph_run_observations.observe_run_preparation_failure(
        project_id=accepted["projectId"],
        deck_id=accepted["deckId"],
        card_id=accepted["cardId"],
        run_id=accepted["runId"],
        ended_at=ended_at,
        elapsed_ms=elapsed_ms,
        error_summary=error_summary,
    )
    return {
        "ok": True,
        "runId": accepted["runId"],
        "correlationId": accepted["correlationId"],
        "projectId": accepted["projectId"],
        "deckId": accepted["deckId"],
        "cardId": accepted["cardId"],
        "cardRevisionId": accepted["cardRevisionId"],
        "acceptedAt": accepted["acceptedAt"],
        "preparationStartedAt": accepted["preparationStartedAt"],
        "preparationEndedAt": ended_at.isoformat(),
        "preparationElapsedMs": elapsed_ms,
        "state": "failed",
        "errorCode": error_code,
        "errorSummary": error_summary,
        "updated": updated,
        "telemetryWritten": observed,
    }


def _insert_run(
    prepared: dict[str, Any],
    *,
    run_id: str,
    correlation_id: str,
) -> tuple[str, str, bool]:
    idf = prepared["idf"]
    runtime = idf["stableSavedCardContext"]["runtime"]
    provider = idf["stableSavedCardContext"]["provider"]
    execution_kind = runtime["kind"]
    auto_tools_decision = prepared.get("autoToolsDecision")
    auto_model_decision = prepared.get("autoModelDecision")
    auto_tools_json = _decision_json(auto_tools_decision, "auto_tools_decision")
    auto_model_json = _decision_json(auto_model_decision, "auto_model_decision")
    with connect_postgres() as connection, connection.cursor(row_factory=dict_row) as cursor:
        cursor.execute(
            """
            INSERT INTO ag_catalog.agent_runs (
              run_id, project_id, deck_id, target_card_revision_id,
              runtime_kind, runtime_mode,
              provider, model_key, provider_model_id, access_mode, correlation_id,
              auto_tools_decision, auto_model_decision,
              state, started_at
            ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s::jsonb,%s::jsonb,'pending',NULL)
            ON CONFLICT DO NOTHING
            """,
            (
                run_id, prepared["projectId"], prepared["deckId"],
                prepared["cardRevisionId"], execution_kind,
                runtime["mode"], provider.get("provider"),
                provider.get("modelKey"), provider.get("providerModelId"),
                provider.get("accessMode"), correlation_id,
                auto_tools_json,
                auto_model_json,
            ),
        )
        if cursor.rowcount == 1:
            return run_id, correlation_id, True
        cursor.execute(
            """
            SELECT run_id, correlation_id, project_id, deck_id,
                   target_card_revision_id, state,
                   provider,
                   auto_tools_decision, auto_model_decision
            FROM ag_catalog.agent_runs
            WHERE run_id=%s OR correlation_id=%s
            ORDER BY created_at ASC
            LIMIT 1
            """,
            (run_id, correlation_id),
        )
        existing = cursor.fetchone()
        if existing is None:
            raise CardDomainError("run_identity_conflict")
        existing = dict(existing)
        if (
            str(existing.get("run_id")) != run_id
            or str(existing.get("correlation_id")) != correlation_id
            or str(existing.get("project_id")) != str(prepared["projectId"])
            or str(existing.get("deck_id")) != str(prepared["deckId"])
            or str(existing.get("target_card_revision_id")) != str(prepared["cardRevisionId"])
        ):
            raise CardDomainError("run_identity_conflict")
        if existing.get("provider") and (
                not _decision_matches(
                    existing.get("auto_tools_decision"), auto_tools_decision,
                )
                or not _decision_matches(
                    existing.get("auto_model_decision"), auto_model_decision,
                )
            ):
            raise CardDomainError("run_selection_decision_conflict")
        if (
            existing.get("state") == "pending"
            and not str(existing.get("provider") or "")
        ):
            cursor.execute(
                """
                UPDATE ag_catalog.agent_runs SET
                  runtime_kind=%s, runtime_mode=%s,
                  provider=%s, model_key=%s, provider_model_id=%s,
                  access_mode=%s,
                  auto_tools_decision=%s::jsonb,
                  auto_model_decision=%s::jsonb,
                  state='pending'
                WHERE run_id=%s AND state='pending'
                  AND provider IS NULL
                  AND provider_thread_ref IS NULL AND provider_turn_ref IS NULL
                """,
                (
                    execution_kind, runtime["mode"], provider.get("provider"),
                    provider.get("modelKey"), provider.get("providerModelId"),
                    provider.get("accessMode"),
                    auto_tools_json, auto_model_json,
                    run_id,
                ),
            )
            if cursor.rowcount == 1:
                return run_id, correlation_id, True
        return str(existing["run_id"]), str(existing["correlation_id"]), False


def begin_run(payload: dict[str, Any]) -> dict[str, Any]:
    """Accept one outer request, then prepare its existing Run identity."""

    accepted = accept_run_request(payload)
    try:
        return _begin_accepted_run(payload, accepted)
    except Exception as error:
        if accepted is not None:
            error_summary = str(error)
            candidate_code = error_summary.split(":", 1)[0].strip()
            error_code = (
                candidate_code
                if re.fullmatch(r"[a-z][a-z0-9_]{2,120}", candidate_code)
                else "configured_card_preparation_failed"
            )
            try:
                selection_decisions = (
                    {
                        "autoToolsDecision": error.auto_tools_decision,
                        "autoModelDecision": error.decision,
                    }
                    if isinstance(error, AutoModelSelectionError)
                    else {}
                )
                _fail_accepted_run_preparation(accepted, {
                    **payload,
                    "errorCode": error_code,
                    "errorSummary": error_summary,
                    **selection_decisions,
                })
            except Exception:
                # Preparation settlement must never replace the exact source
                # failure returned to the accepted caller.
                pass
        raise


def _begin_accepted_run(
    payload: dict[str, Any],
    accepted: dict[str, Any],
) -> dict[str, Any]:
    """Create one Run, retain its one IDF, then expose one external request."""

    current_request = required_content(payload.get("assignment"), "assignment")
    prepared = card_invocation_preparation.prepare_run_invocation(
        payload,
        selection_request=current_request,
    )
    run_id = required_text(payload.get("runId"), "run_id")
    correlation_id = required_text(payload.get("correlationId"), "correlation_id")
    card_identity = prepared["cardIdentity"]
    resolved_run_id, resolved_correlation_id, created = _insert_run(
        prepared,
        run_id=run_id,
        correlation_id=correlation_id,
    )
    public, input_files, runtime_input = card_run_inputs.retain_required_run_idf(
        prepared,
        run_id=resolved_run_id,
        created=created,
    )
    prepared.update(public)
    telemetry_written = False
    if created:
        preparation_ended_at = utc_now()
        telemetry_written = agentgraph_run_observations.observe_run_preparation_complete(
            prepared,
            payload,
            run_id=resolved_run_id,
            correlation_id=resolved_correlation_id,
            preparation_started_at=accepted_at(
                accepted["preparationStartedAt"]
            ),
            ended_at=preparation_ended_at,
        )
    return {
        **prepared,
        "runId": resolved_run_id,
        "correlationId": resolved_correlation_id,
        "conversationId": str(payload.get("conversationId") or "").strip(),
        "cardId": str(card_identity["cardId"]),
        "telemetryWritten": telemetry_written,
        "inputFile": input_files,
        "hermesTransport": {
            "request": runtime_input,
            "inputFile": input_files,
            "cardIdentity": card_identity,
        },
    }
