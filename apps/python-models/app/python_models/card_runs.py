"""Accepted Run ledger, canonical IDF retention, settlement, and readback."""

from __future__ import annotations

import re
from datetime import datetime
from typing import Any

from psycopg.rows import dict_row

from app.python_models import (
    agentgraph_query,
    agentgraph_run_observations,
    agentgraph_topology,
    card_invocation,
    saved_cards,
)
from app.python_models.card_run_selection import AutoModelSelectionError
from app.python_models.idf import (
    InputMaterializationError,
    idf_public,
    load_idf,
    runtime_projection,
    write_idf,
)
from app.python_models.postgres import connect_postgres
from app.python_models.saved_card_contract import (
    CardDomainError,
    accepted_at,
    canonical_json,
    card_runtime,
    json_object,
    utc_now,
    required_content,
    required_text,
    sha256_text,
)

_HERMES_TASK_STATUSES = {
    "triage", "todo", "scheduled", "ready", "running",
    "blocked", "review", "done", "archived",
}

_COST_STATUSES = {"actual", "estimated", "included", "unknown"}


def _optional_nonnegative_integer(payload: dict[str, Any], name: str) -> int | None:
    value = payload.get(name)
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise CardDomainError("run_provider_total_tokens_invalid")
    return value


def _optional_cost_status(payload: dict[str, Any]) -> str | None:
    value = payload.get("costStatus")
    if value is None:
        return None
    if not isinstance(value, str) or value not in _COST_STATUSES:
        raise CardDomainError("run_cost_status_invalid")
    return value


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

    The row is the existing product Run authority in ``pending`` state.  It is
    not evidence that a Hermes Run, provider call, or tool call exists.
    """

    project_ref = required_text(payload.get("projectId"), "project_id")
    deck_id = required_text(payload.get("deckId"), "deck_id")
    card_id = required_text(payload.get("cardId"), "card_id")
    run_id = required_text(payload.get("runId"), "run_id")
    correlation_id = required_text(payload.get("correlationId"), "correlation_id")
    accepted_at_value = accepted_at(payload.get("acceptedAt"))
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
    observed = agentgraph_run_observations._observe_run_acceptance(
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
        "hermesRunId": str(existing.get("provider_turn_ref") or "") or None,
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
    observed = agentgraph_run_observations._observe_run_preparation_failure(
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
        "hermesRunId": None,
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
    runtime_options = idf["stableSavedCardContext"].get("runtimeOptions") or {}
    execution_kind = "hermes" if prepared.get("runtimeOwner") == "mag_one" else runtime["kind"]
    auto_tools_decision = prepared.get("autoToolsDecision")
    auto_model_decision = prepared.get("autoModelDecision")
    auto_tools_json = _decision_json(auto_tools_decision, "auto_tools_decision")
    auto_model_json = _decision_json(auto_model_decision, "auto_model_decision")
    saved_openai_runtime: str | None = None
    if (
        runtime_options.get("openaiRuntime") == "codex_app_server"
        or (
            prepared.get("runtimeOwner") == "mag_one"
            and provider.get("provider") == "openai"
            and provider.get("accessMode") == "chatgpt-account"
        )
    ):
        saved_openai_runtime = "codex_app_server"
    with connect_postgres() as connection, connection.cursor(row_factory=dict_row) as cursor:
        cursor.execute(
            """
            INSERT INTO ag_catalog.agent_runs (
              run_id, project_id, deck_id, target_card_revision_id,
              runtime_kind, runtime_mode,
              provider, model_key, provider_model_id, access_mode, correlation_id,
              execution_authority_sha256,
              saved_openai_runtime, auto_tools_decision, auto_model_decision,
              state, started_at
            ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s::jsonb,%s::jsonb,'pending',NULL)
            ON CONFLICT DO NOTHING
            """,
            (
                run_id, prepared["projectId"], prepared["deckId"],
                prepared["cardRevisionId"], execution_kind,
                runtime["mode"], provider.get("provider"),
                provider.get("modelKey"), provider.get("providerModelId"),
                provider.get("accessMode"), correlation_id,
                prepared.get("executionAuthorityFingerprint"),
                saved_openai_runtime,
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
                   execution_authority_sha256,
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
        if (
            existing.get("execution_authority_sha256")
            and (
                not _decision_matches(
                    existing.get("auto_tools_decision"), auto_tools_decision,
                )
                or not _decision_matches(
                    existing.get("auto_model_decision"), auto_model_decision,
                )
            )
        ):
            raise CardDomainError("run_selection_decision_conflict")
        if (
            existing.get("state") == "pending"
            and not str(existing.get("execution_authority_sha256") or "")
        ):
            cursor.execute(
                """
                UPDATE ag_catalog.agent_runs SET
                  runtime_kind=%s, runtime_mode=%s,
                  provider=%s, model_key=%s, provider_model_id=%s,
                  access_mode=%s,
                  execution_authority_sha256=%s, saved_openai_runtime=%s,
                  auto_tools_decision=%s::jsonb,
                  auto_model_decision=%s::jsonb,
                  state='pending'
                WHERE run_id=%s AND state='pending'
                  AND execution_authority_sha256 IS NULL
                  AND provider_thread_ref IS NULL AND provider_turn_ref IS NULL
                """,
                (
                    execution_kind, runtime["mode"], provider.get("provider"),
                    provider.get("modelKey"), provider.get("providerModelId"),
                    provider.get("accessMode"),
                    prepared.get("executionAuthorityFingerprint"),
                    saved_openai_runtime, auto_tools_json, auto_model_json,
                    run_id,
                ),
            )
            if cursor.rowcount == 1:
                return run_id, correlation_id, True
        return str(existing["run_id"]), str(existing["correlation_id"]), False

def _record_run_input_artifact(run_id: str, input_file: dict[str, Any]) -> None:
    rows = [(
        f"input:{sha256_text(run_id)[:24]}:idf",
        "input-data-file",
        input_file["idfPath"],
        "application/vnd.liquidaity.idf+json",
        input_file["idfSha256"],
        input_file["idfBytes"],
    )]
    with connect_postgres() as connection, connection.cursor() as cursor:
        for artifact_id, kind, locator, media_type, content_hash, size_bytes in rows:
            cursor.execute(
                """
                INSERT INTO ag_catalog.run_artifacts (
                  artifact_id, producing_run_id, artifact_kind, locator,
                  media_type, content_sha256, provenance_ref, size_bytes
                ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
                """,
                (
                    artifact_id, run_id, kind, locator, media_type,
                    content_hash, "canonical-runtime-input", size_bytes,
                ),
            )
    for artifact_id, kind, locator, *_ in rows:
        agentgraph_run_observations._observe_artifact(
            run_id, artifact_id, kind, locator
        )

def _input_file_descriptor_for_run(run_id: str) -> dict[str, Any] | None:
    with connect_postgres(autocommit=False) as connection:
        with connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute("SET TRANSACTION READ ONLY")
            cursor.execute(
                """
                SELECT artifact_kind, locator, content_sha256, size_bytes
                FROM ag_catalog.run_artifacts
                WHERE producing_run_id=%s
                  AND artifact_kind='input-data-file'
                ORDER BY artifact_kind
                """,
                (run_id,),
            )
            rows = {str(row["artifact_kind"]): dict(row) for row in cursor.fetchall()}
    idf = rows.get("input-data-file")
    if idf is None:
        return None
    return {
        "workspace": str(idf["locator"]).rsplit("\\", 1)[0].rsplit("/", 1)[0],
        "idfPath": str(idf["locator"]),
        "idfSha256": str(idf.get("content_sha256") or ""),
        "idfBytes": int(idf.get("size_bytes") or 0),
    }

def _retain_run_idf(
    prepared: dict[str, Any],
    *,
    run_id: str,
    created: bool,
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    try:
        if created:
            materialized = prepared.pop("_materializedIdf", None)
            if materialized is None:
                raise InputMaterializationError("input_materialization_unavailable")
            input_file = write_idf(
                materialized,
                project_id=prepared["projectId"],
                deck_id=prepared["deckId"],
                run_id=run_id,
            )
            _record_run_input_artifact(run_id, input_file)
        else:
            prepared.pop("_materializedIdf", None)
            input_file = _input_file_descriptor_for_run(run_id)
            if input_file is None:
                raise InputMaterializationError("input_file_unavailable")
        # The model/runtime request is projected only from the retained bytes.
        loaded = load_idf(
            input_file,
            project_id=prepared["projectId"],
            deck_id=prepared["deckId"],
            run_id=run_id,
            card_id=prepared["cardIdentity"]["cardId"],
        )
        public = idf_public(loaded)
        return public, input_file, runtime_projection(loaded)
    except InputMaterializationError as error:
        raise CardDomainError(str(error)) from error

def _retain_required_run_idf(
    prepared: dict[str, Any],
    *,
    run_id: str,
    created: bool,
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    """Fail a newly created Run closed when its canonical inputs cannot persist."""

    try:
        return _retain_run_idf(
            prepared,
            run_id=run_id,
            created=created,
        )
    except Exception as error:
        message = str(error) if isinstance(error, CardDomainError) else "input_files_retention_failed"
        if created:
            try:
                finish_run({
                    "runId": run_id,
                    "state": "failed",
                    "errorCode": "input_files_materialization_failed",
                    "errorSummary": message,
                })
            except Exception:
                pass
        if isinstance(error, CardDomainError):
            raise
        raise CardDomainError(message) from error

def shared_conversation_task(
    message: str,
    value: Any,
    target_label: str,
) -> str:
    """Mechanically include the bounded shared transcript for one selected Card."""

    if value is None:
        return message
    target_label = required_text(
        target_label,
        "shared_conversation_target_label",
    )
    if not isinstance(value, list) or len(value) > 24:
        raise CardDomainError("shared_conversation_context_invalid")
    rendered: list[str] = []
    total_characters = 0
    allowed = {
        "role", "speakerCardId", "speakerLabel", "targetCardId", "targetLabel", "content"
    }
    for raw in value:
        if not isinstance(raw, dict) or set(raw) != allowed:
            raise CardDomainError("shared_conversation_context_invalid")
        if raw.get("role") not in {"user", "assistant"}:
            raise CardDomainError("shared_conversation_context_invalid")
        if any(not isinstance(raw.get(key), str) for key in allowed - {"role"}):
            raise CardDomainError("shared_conversation_context_invalid")
        content = str(raw["content"])
        speaker = str(raw["speakerLabel"]).strip()
        target = str(raw["targetLabel"]).strip()
        if not content or not speaker:
            raise CardDomainError("shared_conversation_context_invalid")
        total_characters += len(content)
        if total_characters > 12_000:
            raise CardDomainError("shared_conversation_context_too_large")
        heading = f"{speaker} -> {target}" if target else speaker
        rendered.append(f"{heading}:\n{content}")
    if not rendered:
        return message
    return "\n\n".join((
        f"## Shared conversation before this {target_label} turn",
        *rendered,
        f"## Current user message to {target_label}",
        message,
    ))

def begin_main_chat_run(payload: dict[str, Any]) -> dict[str, Any]:
    """Resolve Main, then use the one canonical saved-Card Run function."""
    message = required_content(payload.get("message"), "message")
    main = card_invocation.prepare_main_chat({**payload, "message": ""})
    return begin_run({
        **payload,
        "projectId": main["projectId"],
        "deckId": main["deckId"],
        "cardId": main["cardIdentity"]["cardId"],
        "assignment": message,
        "sharedConversationTargetLabel": main["cardIdentity"]["title"],
    })

def begin_run(payload: dict[str, Any]) -> dict[str, Any]:
    """Accept one outer request, then prepare its existing Run identity."""

    accepted: dict[str, Any] | None = None
    if str(payload.get("acceptedAt") or "").strip():
        accepted = accept_run_request(payload)
    try:
        return _begin_accepted_run(payload)
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

def _begin_accepted_run(payload: dict[str, Any]) -> dict[str, Any]:
    """Create one Run, retain its one IDF, then expose one Hermes request."""

    current_request = required_content(payload.get("assignment"), "assignment")
    effective_payload = payload
    shared_target_label: str | None = None
    if "sharedConversation" in payload:
        shared_target_label = required_text(
            payload.get("sharedConversationTargetLabel"),
            "shared_conversation_target_label",
        )
        effective_payload = {
            **payload,
            "assignment": shared_conversation_task(
                current_request,
                payload.get("sharedConversation"),
                shared_target_label,
            ),
        }
    prepared = card_invocation.prepare_run_invocation(
        effective_payload,
        selection_request=current_request,
    )
    if (
        shared_target_label is not None
        and str(prepared["cardIdentity"].get("title") or "") != shared_target_label
    ):
        raise CardDomainError("shared_conversation_target_mismatch")
    run_id = required_text(payload.get("runId"), "run_id")
    correlation_id = required_text(payload.get("correlationId"), "correlation_id")
    card_identity = prepared["cardIdentity"]
    owner = prepared["runtimeOwner"]
    runtime = prepared["idf"]["stableSavedCardContext"]["runtime"]
    magnetic_workers: list[dict[str, Any]] = []
    magnetic_worker_authorities: list[dict[str, str]] = []
    if owner == "mag_one":
        loaded = saved_cards.load_deck(prepared["projectId"], prepared["deckId"])
        cards = {card["id"]: card for card in loaded["deck"]["nodes"]}
        magnetic_workers = agentgraph_topology._connected_hermes_card_targets(
            card_identity["cardId"],
            cards,
            loaded["deck"]["edges"],
            edge_type="magentic_option",
            strict=True,
        )
        if not magnetic_workers:
            raise CardDomainError("magnetic_taskgraph_no_connected_workers")
        magnetic_workers = agentgraph_topology._magnetic_taskgraph_worker_capability_projection(
            prepared["projectId"],
            magnetic_workers,
            cards,
        )
        for worker in magnetic_workers:
            worker_card = cards.get(str(worker.get("cardId") or ""))
            fingerprint = str(
                (worker_card or {}).get("_cardRevisionSha256") or ""
            ).strip()
            if re.fullmatch(r"[a-f0-9]{64}", fingerprint) is None:
                raise CardDomainError(
                    "magnetic_taskgraph_worker_revision_fingerprint_invalid:"
                    f"{worker.get('cardId')}"
                )
            magnetic_worker_authorities.append({
                "cardId": str(worker["cardId"]),
                "cardRevisionId": str(worker["cardRevisionId"]),
                "profile": str(worker["profile"]).lower(),
                "configurationFingerprint": fingerprint,
            })
    resolved_run_id, resolved_correlation_id, created = _insert_run(
        prepared,
        run_id=run_id,
        correlation_id=correlation_id,
    )
    public, input_files, runtime_input = _retain_required_run_idf(
        prepared,
        run_id=resolved_run_id,
        created=created,
    )
    prepared.update(public)
    magnetic_taskgraph = None
    if owner == "mag_one":
        options = json_object(
            prepared["idf"]["stableSavedCardContext"].get("runtimeOptions"),
            "runtime_options",
        )
        provider = json_object(
            prepared["idf"]["stableSavedCardContext"].get("provider"),
            "provider",
        )
        magnetic_taskgraph = {
            "runId": resolved_run_id,
            "correlationId": resolved_correlation_id,
            "projectId": prepared["projectId"],
            "deckId": prepared["deckId"],
            "inputFile": input_files,
            "mission": runtime_input["taskGraphMission"],
            "orchestrator": {
                "cardId": card_identity["cardId"],
                "cardRevisionId": prepared["cardRevisionId"],
                "hermesProfile": runtime["profile"],
                "instructions": prepared["idf"]["stableSavedCardContext"]["instructions"],
                "provider": provider,
                "runtimeOptions": options,
            },
            "workers": magnetic_workers,
            "workerAuthorities": magnetic_worker_authorities,
        }
    telemetry_written = False
    if created:
        telemetry_written = agentgraph_run_observations._observe_run_preparation_complete(
            prepared,
            effective_payload,
            run_id=resolved_run_id,
            correlation_id=resolved_correlation_id,
            input_file=input_files,
        )
    return {
        **prepared,
        "runId": resolved_run_id,
        "correlationId": resolved_correlation_id,
        "rejoined": not created,
        "telemetryWritten": telemetry_written,
        "inputFile": input_files,
        "magneticTaskGraph": magnetic_taskgraph,
        "hermesTransport": {
            "request": runtime_input,
            "inputFile": input_files,
            "cardIdentity": card_identity,
        } if owner == "hermes" else None,
    }

def _run_projection(row: dict[str, Any]) -> dict[str, Any]:
    def timestamp(name: str) -> str | None:
        value = row.get(name)
        return value.isoformat() if isinstance(value, datetime) else None

    cost = row.get("total_cost_usd")
    persisted_hermes_status = str(row.get("hermes_phase") or "").strip().lower()
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
        "openaiRuntime": str(row.get("saved_openai_runtime") or "") or None,
        "effectiveProvider": str(row.get("effective_provider") or "") or None,
        "providerApiMode": str(row.get("provider_api_mode") or "") or None,
        "executionAuthorityFingerprint": str(row.get("execution_authority_sha256") or "") or None,
        "state": str(row.get("state") or ""),
        "hermesStatus": (
            persisted_hermes_status
            if persisted_hermes_status in _HERMES_TASK_STATUSES
            else None
        ),
        "hermesRootId": str(row.get("provider_thread_ref") or "") or None,
        "hermesRunId": str(row.get("provider_turn_ref") or "") or None,
        "hermesSessionId": str(row.get("hermes_session_ref") or "") or None,
        "tasksCompleted": row.get("hermes_task_completed_count"),
        "tasksTotal": row.get("hermes_task_total_count"),
        "activeWorkers": row.get("hermes_active_worker_count"),
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
        "modelFallbackOccurred": row.get("model_fallback_occurred") is True,
        "modelFallbackReason": str(row.get("model_fallback_reason") or "") or None,
        "acceptedAt": timestamp("created_at"),
        "startedAt": timestamp("started_at"),
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
        "runs": [_run_projection(row) for row in rows],
        "limit": raw_limit,
    }

def read_run(payload: dict[str, Any]) -> dict[str, Any]:
    """Read one durable Run by its public rejoin identities."""

    project_ref = required_text(payload.get("projectId"), "project_id")
    deck_id = required_text(payload.get("deckId"), "deck_id")
    conversation_id = (required_text(payload.get("conversationId"), "conversation_id")
                       if "conversationId" in payload else None)
    selectors = {
        "run_id": str(payload.get("runId") or "").strip(),
        "correlation_id": str(payload.get("correlationId") or "").strip(),
        "provider_thread_ref": str(payload.get("hermesRootId") or "").strip(),
        "card_id": str(payload.get("cardId") or "").strip(),
    }
    selected = [(name, value) for name, value in selectors.items() if value]
    if len(selected) != 1:
        raise CardDomainError("run_rejoin_selector_invalid")
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
                    "provider_thread_ref": "run.provider_thread_ref",
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
            if row is not None and conversation_id is not None:
                scope = agentgraph_query.execute_fixed_agentgraph_query(
                    cursor,
                    """
                    MATCH (run:Run {projectId: $projectId, deckId: $deckId,
                                    runId: $runId, conversationId: $conversationId})
                    RETURN run.runId
                    """,
                    {"projectId": project_id, "deckId": deck_id,
                     "runId": str(row["run_id"]), "conversationId": conversation_id},
                    "run_id agtype",
                )
                if len(scope) != 1 or scope[0].get("run_id") != str(row["run_id"]):
                    return {"ok": True, "run": None}
    run = _run_projection(dict(row)) if row is not None else None
    if run is not None and conversation_id is not None:
        run["conversationId"] = conversation_id
    return {"ok": True, "run": run}


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
    telemetry_written = agentgraph_run_observations._observe_run_execution_started(
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
    if hermes_status not in _HERMES_TASK_STATUSES:
        raise CardDomainError("hermes_task_status_invalid")
    provider_total_tokens = _optional_nonnegative_integer(
        payload, "providerTotalTokens",
    )
    cost_status = _optional_cost_status(payload)

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
        agentgraph_run_observations._observe_run_progress(
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

def _validated_run_settlement_request(payload: dict[str, Any]) -> dict[str, Any]:
    run_id = required_text(payload.get("runId"), "run_id")
    state = required_text(payload.get("state"), "state")
    if state not in {"completed", "blocked", "failed", "cancelled"}:
        raise CardDomainError("run_terminal_state_invalid")
    provider_total_tokens = _optional_nonnegative_integer(
        payload, "providerTotalTokens",
    )
    cost_status = _optional_cost_status(payload)
    hermes_status = str(payload.get("hermesStatus") or "").strip().lower() or None
    if hermes_status is not None and hermes_status not in _HERMES_TASK_STATUSES:
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
        agentgraph_run_observations._observe_run_result_ready(run_id)
        if updated and request["reconcilePersistedResult"]
        else agentgraph_run_observations._observe_run_finish(run_id, state, payload)
        if updated
        else False
    )
    return {
        "ok": True,
        "runId": run_id,
        "state": str(run_record["state"]),
        "updated": updated,
        "telemetryWritten": telemetry_written,
        "runRecord": _run_projection(run_record),
    }
