"""Truthful AGE Run and artifact observations."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from psycopg.rows import dict_row

from app.python_models import agentgraph_query
from app.python_models.postgres import connect_postgres
from app.python_models.saved_card_contract import accepted_at, utc_now


def _observe_run_acceptance(
    *,
    project_id: str,
    deck_id: str,
    card_id: str,
    run_id: str,
    correlation_id: str,
    accepted_at: datetime,
    preparation_started_at: datetime,
    conversation_id: str | None,
) -> bool:
    """Observe one real accepted outer request before Hermes preparation."""

    try:
        with connect_postgres() as connection, connection.cursor(row_factory=dict_row) as cursor:
            observed = agentgraph_query.execute_fixed_agentgraph_query(
                cursor,
                """
                MATCH (card:Card {
                  projectId: $projectId, deckId: $deckId, cardId: $cardId
                })
                MERGE (run:Run {
                  projectId: $projectId, deckId: $deckId, runId: $runId
                })
                SET run.correlationId=$correlationId,
                    run.state=coalesce(run.state, 'pending'),
                    run.acceptedAt=coalesce(run.acceptedAt, $acceptedAt),
                    run.preparationStartedAt=coalesce(
                      run.preparationStartedAt, $preparationStartedAt
                    ),
                    run.preparationState=coalesce(run.preparationState, 'preparing'),
                    run.conversationId=coalesce(run.conversationId, $conversationId),
                    run.rootRunId=coalesce(run.rootRunId, $runId)
                MERGE (run)-[:EXECUTED_BY]->(card)
                RETURN run.runId
                """,
                {
                    "projectId": project_id,
                    "deckId": deck_id,
                    "cardId": card_id,
                    "runId": run_id,
                    "correlationId": correlation_id,
                    "acceptedAt": accepted_at.isoformat(),
                    "preparationStartedAt": preparation_started_at.isoformat(),
                    "conversationId": conversation_id,
                },
                "run_id agtype",
            )
        return len(observed) == 1 and str(observed[0].get("run_id") or "") == run_id
    except Exception:
        return False


def _observe_run_preparation_failure(
    *,
    project_id: str,
    deck_id: str,
    card_id: str,
    run_id: str,
    ended_at: datetime,
    elapsed_ms: float,
    error_summary: str,
) -> bool:
    try:
        with connect_postgres() as connection, connection.cursor(row_factory=dict_row) as cursor:
            observed = agentgraph_query.execute_fixed_agentgraph_query(
                cursor,
                """
                MATCH (run:Run {
                  projectId: $projectId, deckId: $deckId, runId: $runId
                })-[:EXECUTED_BY]->(card:Card {
                  projectId: $projectId, deckId: $deckId, cardId: $cardId
                })
                SET run.state='failed',
                    run.finishedAt=$endedAt,
                    run.preparationState='failed',
                    run.preparationEndedAt=$endedAt,
                    run.preparationElapsedMs=$elapsedMs,
                    run.preparationError=$errorSummary,
                    run.hermesRunId=null,
                    run.hermesRootId=null
                RETURN run.runId
                """,
                {
                    "projectId": project_id,
                    "deckId": deck_id,
                    "cardId": card_id,
                    "runId": run_id,
                    "endedAt": ended_at.isoformat(),
                    "elapsedMs": elapsed_ms,
                    "errorSummary": error_summary,
                },
                "run_id agtype",
            )
        return len(observed) == 1 and str(observed[0].get("run_id") or "") == run_id
    except Exception:
        return False


def _observe_run_execution_started(
    *,
    run_id: str,
    submission_id: str,
    hermes_session_id: str,
    started_at: datetime,
) -> bool:
    """Observe exact Hermes submission-start evidence for one accepted outer Run."""

    try:
        with connect_postgres() as connection, connection.cursor(row_factory=dict_row) as cursor:
            observed = agentgraph_query.execute_fixed_agentgraph_query(
                cursor,
                """
                MATCH (run:Run {runId: $runId})
                SET run.state='running',
                    run.startedAt=coalesce(run.startedAt, $startedAt),
                    run.hermesRunId=$submissionId,
                    run.hermesSessionId=$hermesSessionId
                RETURN run.runId
                """,
                {
                    "runId": run_id,
                    "submissionId": submission_id,
                    "hermesSessionId": hermes_session_id,
                    "startedAt": started_at.isoformat(),
                },
                "run_id agtype",
            )
        return len(observed) == 1 and str(observed[0].get("run_id") or "") == run_id
    except Exception:
        return False


def _observe_run_progress(run_id: str, hermes_status: str, payload: dict[str, Any]) -> bool:
    active_workers = payload.get("activeWorkers")
    execution_active = hermes_status == "running" or (
        isinstance(active_workers, int)
        and not isinstance(active_workers, bool)
        and active_workers > 0
    )
    try:
        with connect_postgres() as connection, connection.cursor(row_factory=dict_row) as cursor:
            agentgraph_query.execute_fixed_agentgraph_query(
                cursor,
                """
                MATCH (run:Run {runId: $runId})
                SET run.state=coalesce($runState, run.state),
                    run.startedAt=coalesce(run.startedAt, $startedAt),
                    run.hermesRootId=$hermesRootId,
                    run.hermesRunId=$hermesRunId,
                    run.hermesStatus=$hermesStatus,
                    run.hermesTaskCompletedCount=$tasksCompleted,
                    run.hermesTaskTotalCount=$tasksTotal,
                    run.hermesActiveWorkerCount=$activeWorkers,
                    run.toolCallCount=$toolCallCount,
                    run.providerCachedTokens=$providerCachedTokens,
                    run.providerReasoningTokens=$providerReasoningTokens
                RETURN properties(run)
                """,
                {
                    "runId": run_id,
                    "runState": "running" if execution_active else None,
                    "startedAt": utc_now().isoformat() if execution_active else None,
                    "hermesRootId": payload.get("hermesRootId"),
                    "hermesRunId": payload.get("hermesRunId"),
                    "hermesStatus": hermes_status,
                    "tasksCompleted": payload.get("tasksCompleted"),
                    "tasksTotal": payload.get("tasksTotal"),
                    "activeWorkers": payload.get("activeWorkers"),
                    "toolCallCount": payload.get("toolCallCount"),
                    "providerCachedTokens": payload.get("providerCachedTokens"),
                    "providerReasoningTokens": payload.get("providerReasoningTokens"),
                },
                "value agtype",
            )
        return True
    except Exception:
        return False


def _observe_run_preparation_complete(
    prepared: dict[str, Any],
    payload: dict[str, Any],
    *,
    run_id: str,
    correlation_id: str,
    input_file: dict[str, Any] | None = None,
) -> bool:
    """Observe completed preparation without claiming that Hermes execution started."""
    try:
        ended_at = utc_now()
        accepted_text = str(payload.get("acceptedAt") or "").strip()
        preparation_elapsed_ms = None
        if accepted_text:
            preparation_elapsed_ms = max(
                0.0,
                (ended_at - accepted_at(accepted_text)).total_seconds() * 1000,
            )
        with connect_postgres() as connection, connection.cursor(row_factory=dict_row) as cursor:
            identity = prepared["cardIdentity"]
            runtime = (
                ((prepared.get("idf") or {}).get("stableSavedCardContext") or {}).get("runtime")
                or {}
            )
            agentgraph_query.execute_fixed_agentgraph_query(
                cursor,
                """
                MERGE (run:Run {
                  projectId: $projectId, deckId: $deckId, runId: $runId
                })
                SET run.correlationId=$correlationId,
                    run.state=coalesce(run.state, 'pending'),
                    run.hermesProfile=$hermesProfile,
                    run.conversationId=$conversationId,
                    run.rootRunId=$rootRunId,
                    run.acceptedAt=coalesce(run.acceptedAt, $acceptedAt),
                    run.preparationState='completed',
                    run.preparationStartedAt=coalesce(
                      run.preparationStartedAt, $acceptedAt
                    ),
                    run.preparationEndedAt=$endedAt,
                    run.preparationElapsedMs=$preparationElapsedMs,
                    run.preparationError=null,
                    run.idfSha256=$idfSha256,
                    run.idfBytes=$idfBytes
                WITH run
                MATCH (card:Card {projectId: $projectId, deckId: $deckId, cardId: $cardId})
                MERGE (run)-[:EXECUTED_BY]->(card)
                RETURN properties(run)
                """,
                {
                    "runId": run_id,
                    "projectId": prepared["projectId"],
                    "deckId": prepared["deckId"],
                    "correlationId": correlation_id,
                    "endedAt": ended_at.isoformat(),
                    "cardId": identity["cardId"],
                    "hermesProfile": (
                        str(runtime.get("profile") or "").strip()
                        or None
                    ),
                    "conversationId": str(payload.get("conversationId") or "").strip() or None,
                    "rootRunId": str(payload.get("rootRunId") or run_id).strip(),
                    "acceptedAt": str(payload.get("acceptedAt") or "").strip() or None,
                    "preparationElapsedMs": preparation_elapsed_ms,
                    "idfSha256": str((input_file or {}).get("idfSha256") or "").strip() or None,
                    "idfBytes": (input_file or {}).get("idfBytes"),
                },
                "value agtype",
            )
            sender_id = str(payload.get("senderCardId") or "").strip()
            if sender_id:
                agentgraph_query.execute_fixed_agentgraph_query(
                    cursor,
                    """
                    MATCH (sender:Card {projectId: $projectId, deckId: $deckId, cardId: $senderId})
                    MATCH (target:Card {projectId: $projectId, deckId: $deckId, cardId: $targetId})
                    MERGE (sender)-[assignment:ASSIGNED_TO {runId: $runId}]->(target)
                    SET assignment.correlationId=$correlationId
                    RETURN properties(assignment)
                    """,
                    {
                        "projectId": prepared["projectId"],
                        "deckId": prepared["deckId"],
                        "senderId": sender_id,
                        "targetId": identity["cardId"],
                        "runId": run_id,
                        "correlationId": correlation_id,
                    },
                    "value agtype",
                )
            parent_run_id = str(payload.get("originatingRunId") or "").strip()
            if parent_run_id:
                agentgraph_query.execute_fixed_agentgraph_query(
                    cursor,
                    """
                    MATCH (parent:Run {runId: $parentRunId})
                    MATCH (child:Run {runId: $runId})
                    MERGE (parent)-[edge:CHILD_RUN]->(child)
                    RETURN properties(edge)
                    """,
                    {"parentRunId": parent_run_id, "runId": run_id},
                    "value agtype",
                )
        return True
    except Exception:
        return False


def _observe_run_result_ready(run_id: str) -> bool:
    try:
        with connect_postgres() as connection, connection.cursor(row_factory=dict_row) as cursor:
            agentgraph_query.execute_fixed_agentgraph_query(
                cursor,
                """
                MATCH (run:Run {runId: $runId})
                SET run.resultReady=true
                RETURN properties(run)
                """,
                {"runId": run_id},
                "value agtype",
            )
        return True
    except Exception:
        return False


def _observe_run_finish(
    run_id: str,
    state: str,
    payload: dict[str, Any] | None = None,
) -> bool:
    try:
        with connect_postgres() as connection, connection.cursor(row_factory=dict_row) as cursor:
            agentgraph_query.execute_fixed_agentgraph_query(
                cursor,
                """
                MATCH (run:Run {runId: $runId})
                SET run.state=$state, run.finishedAt=$finishedAt,
                    run.durationMs=$durationMs,
                    run.providerInputTokens=$providerInputTokens,
                    run.providerOutputTokens=$providerOutputTokens,
                    run.providerCachedTokens=$providerCachedTokens,
                    run.providerReasoningTokens=$providerReasoningTokens,
                    run.toolCallCount=$toolCallCount,
                    run.totalCostUsd=$totalCostUsd,
                    run.provider=$provider,
                    run.model=$model,
                    run.modelFallbackOccurred=$modelFallbackOccurred,
                    run.modelFallbackReason=$modelFallbackReason,
                    run.hermesRootId=$hermesRootId,
                    run.hermesRunId=$hermesRunId,
                    run.hermesSessionId=$hermesSessionId,
                    run.effectiveProvider=$effectiveProvider,
                    run.providerApiMode=$providerApiMode,
                    run.hermesStatus=$hermesStatus,
                    run.hermesTaskCompletedCount=$tasksCompleted,
                    run.hermesTaskTotalCount=$tasksTotal,
                    run.hermesActiveWorkerCount=$activeWorkers,
                    run.resultReady=$resultReady,
                    run.errorCode=$errorCode,
                    run.errorSummary=$errorSummary
                RETURN properties(run)
                """,
                {
                    "runId": run_id,
                    "state": state,
                    "finishedAt": utc_now().isoformat(),
                    "durationMs": (payload or {}).get("durationMs"),
                    "providerInputTokens": (payload or {}).get("providerInputTokens"),
                    "providerOutputTokens": (payload or {}).get("providerOutputTokens"),
                    "providerCachedTokens": (payload or {}).get("providerCachedTokens"),
                    "providerReasoningTokens": (payload or {}).get("providerReasoningTokens"),
                    "toolCallCount": (payload or {}).get("toolCallCount"),
                    "totalCostUsd": (payload or {}).get("totalCostUsd"),
                    "provider": (payload or {}).get("provider"),
                    "model": (payload or {}).get("model"),
                    "modelFallbackOccurred": (payload or {}).get("modelFallbackOccurred", False),
                    "modelFallbackReason": (payload or {}).get("modelFallbackReason"),
                    "hermesRootId": (payload or {}).get("providerThreadRef"),
                    "hermesRunId": (payload or {}).get("providerTurnRef"),
                    "hermesSessionId": (payload or {}).get("hermesSessionRef"),
                    "effectiveProvider": (payload or {}).get("effectiveProvider"),
                    "providerApiMode": (payload or {}).get("providerApiMode"),
                    "hermesStatus": (payload or {}).get("hermesStatus"),
                    "tasksCompleted": (payload or {}).get("tasksCompleted"),
                    "tasksTotal": (payload or {}).get("tasksTotal"),
                    "activeWorkers": (payload or {}).get("activeWorkers"),
                    "resultReady": bool((payload or {}).get("finalResult")),
                    "errorCode": (payload or {}).get("errorCode"),
                    "errorSummary": (payload or {}).get("errorSummary"),
                },
                "value agtype",
            )
        return True
    except Exception:
        return False


def _observe_artifact(
    run_id: str,
    artifact_id: str,
    artifact_kind: str,
    locator: str,
) -> bool:
    try:
        with connect_postgres() as connection, connection.cursor(row_factory=dict_row) as cursor:
            agentgraph_query.execute_fixed_agentgraph_query(
                cursor,
                """
                MATCH (run:Run {runId: $runId})
                MERGE (artifact:Artifact {artifactId: $artifactId})
                SET artifact.artifactKind=$artifactKind, artifact.locator=$locator
                MERGE (run)-[edge:PRODUCED_ARTIFACT]->(artifact)
                RETURN properties(edge)
                """,
                {
                    "runId": run_id,
                    "artifactId": artifact_id,
                    "artifactKind": artifact_kind,
                    "locator": locator,
                },
                "value agtype",
            )
        return True
    except Exception:
        return False
