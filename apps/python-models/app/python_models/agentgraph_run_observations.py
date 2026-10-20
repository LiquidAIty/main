"""Truthful AGE Run and artifact observations."""

# Entity: AgentGraph
# Relationship: This file records exact accepted Run, preparation, Hermes identity, assignment, lineage, terminal-state, and artifact observations in AGE without controlling execution.
# Entity: Run Ledger
# Relationship: This file mirrors confirmed outer Run lifecycle and artifact evidence from the canonical PostgreSQL Run authority into AgentGraph observations.
# Entity: Card Invocation
# Relationship: This file observes invocation acceptance, preparation completion or failure, and real Hermes submission start without creating or authorizing a Card Run.

from __future__ import annotations

from datetime import datetime
from typing import Any

from psycopg.rows import dict_row

from app.python_models import agentgraph_query
from app.python_models.postgres import connect_postgres


def observe_run_acceptance(
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


def observe_run_preparation_failure(
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


def observe_run_execution_started(
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


def observe_run_progress(run_id: str, hermes_status: str, payload: dict[str, Any]) -> bool:
    try:
        with connect_postgres() as connection, connection.cursor(row_factory=dict_row) as cursor:
            observed = agentgraph_query.execute_fixed_agentgraph_query(
                cursor,
                """
                MATCH (run:Run {runId: $runId})
                SET run.hermesRootId=$hermesRootId,
                    run.hermesRunId=$hermesRunId,
                    run.hermesStatus=$hermesStatus
                RETURN run.runId
                """,
                {
                    "runId": run_id,
                    "hermesRootId": payload.get("hermesRootId"),
                    "hermesRunId": payload.get("hermesRunId"),
                    "hermesStatus": hermes_status,
                },
                "run_id agtype",
            )
        return len(observed) == 1 and str(observed[0].get("run_id") or "") == run_id
    except Exception:
        return False


def observe_run_preparation_complete(
    prepared: dict[str, Any],
    payload: dict[str, Any],
    *,
    run_id: str,
    correlation_id: str,
    preparation_started_at: datetime,
    ended_at: datetime,
) -> bool:
    """Observe exact preparation completion and optional assignment or lineage."""

    try:
        elapsed_ms = max(
            0.0,
            (ended_at - preparation_started_at).total_seconds() * 1000,
        )
        with connect_postgres() as connection, connection.cursor(row_factory=dict_row) as cursor:
            identity = prepared["cardIdentity"]
            run_rows = agentgraph_query.execute_fixed_agentgraph_query(
                cursor,
                """
                MATCH (run:Run {
                  projectId: $projectId, deckId: $deckId, runId: $runId
                })
                SET run.correlationId=$correlationId,
                    run.preparationState='completed',
                    run.preparationStartedAt=coalesce(
                      run.preparationStartedAt, $preparationStartedAt
                    ),
                    run.preparationEndedAt=$endedAt,
                    run.preparationElapsedMs=$preparationElapsedMs,
                    run.preparationError=null
                WITH run
                MATCH (card:Card {
                  projectId: $projectId, deckId: $deckId, cardId: $cardId
                })
                MERGE (run)-[:EXECUTED_BY]->(card)
                RETURN run.runId
                """,
                {
                    "runId": run_id,
                    "projectId": prepared["projectId"],
                    "deckId": prepared["deckId"],
                    "correlationId": correlation_id,
                    "endedAt": ended_at.isoformat(),
                    "preparationStartedAt": preparation_started_at.isoformat(),
                    "preparationElapsedMs": elapsed_ms,
                    "cardId": identity["cardId"],
                },
                "run_id agtype",
            )
            if (
                len(run_rows) != 1
                or str(run_rows[0].get("run_id") or "") != run_id
            ):
                return False

            sender_id = str(payload.get("senderCardId") or "").strip()
            if sender_id:
                assignment_rows = agentgraph_query.execute_fixed_agentgraph_query(
                    cursor,
                    """
                    MATCH (sender:Card {
                      projectId: $projectId, deckId: $deckId, cardId: $senderId
                    })
                    MATCH (target:Card {
                      projectId: $projectId, deckId: $deckId, cardId: $targetId
                    })
                    MERGE (sender)-[assignment:ASSIGNED_TO {runId: $runId}]->(target)
                    SET assignment.correlationId=$correlationId
                    RETURN sender.cardId, target.cardId, assignment.runId
                    """,
                    {
                        "projectId": prepared["projectId"],
                        "deckId": prepared["deckId"],
                        "senderId": sender_id,
                        "targetId": identity["cardId"],
                        "runId": run_id,
                        "correlationId": correlation_id,
                    },
                    "sender_id agtype, target_id agtype, run_id agtype",
                )
                if (
                    len(assignment_rows) != 1
                    or str(assignment_rows[0].get("sender_id") or "") != sender_id
                    or str(assignment_rows[0].get("target_id") or "")
                    != str(identity["cardId"])
                    or str(assignment_rows[0].get("run_id") or "") != run_id
                ):
                    return False

            parent_run_id = str(payload.get("originatingRunId") or "").strip()
            if parent_run_id:
                lineage_rows = agentgraph_query.execute_fixed_agentgraph_query(
                    cursor,
                    """
                    MATCH (parent:Run {runId: $parentRunId})
                    MATCH (child:Run {runId: $runId})
                    MERGE (parent)-[:CHILD_RUN]->(child)
                    RETURN parent.runId, child.runId
                    """,
                    {"parentRunId": parent_run_id, "runId": run_id},
                    "parent_run_id agtype, child_run_id agtype",
                )
                if (
                    len(lineage_rows) != 1
                    or str(lineage_rows[0].get("parent_run_id") or "")
                    != parent_run_id
                    or str(lineage_rows[0].get("child_run_id") or "") != run_id
                ):
                    return False
        return True
    except Exception:
        return False

def observe_run_finish(
    run_record: dict[str, Any],
    *,
    input_message_ids: list[str] | None = None,
) -> bool:
    """Observe exact terminal state read back from PostgreSQL Run authority."""

    run_id = str(run_record.get("run_id") or "").strip()
    state = str(run_record.get("state") or "").strip()
    finished_at = run_record.get("finished_at")
    if not run_id or not state or not isinstance(finished_at, datetime):
        return False
    try:
        with connect_postgres() as connection, connection.cursor(row_factory=dict_row) as cursor:
            observed = agentgraph_query.execute_fixed_agentgraph_query(
                cursor,
                """
                MATCH (run:Run {runId: $runId})
                SET run.state=$state,
                    run.finishedAt=$finishedAt,
                    run.hermesRootId=$hermesRootId,
                    run.hermesRunId=$hermesRunId,
                    run.errorCode=$errorCode,
                    run.errorSummary=$errorSummary,
                    run.inputMessageIds=coalesce($inputMessageIds, run.inputMessageIds)
                RETURN run.runId
                """,
                {
                    "runId": run_id,
                    "state": state,
                    "finishedAt": finished_at.isoformat(),
                    "hermesRootId": run_record.get("provider_thread_ref"),
                    "hermesRunId": run_record.get("provider_turn_ref"),
                    "errorCode": run_record.get("error_code"),
                    "errorSummary": run_record.get("error_summary"),
                    "inputMessageIds": input_message_ids,
                },
                "run_id agtype",
            )
        return len(observed) == 1 and str(observed[0].get("run_id") or "") == run_id
    except Exception:
        return False

def observe_artifact(
    run_id: str,
    artifact_id: str,
    artifact_kind: str,
    locator: str,
    content_sha256: str,
    size_bytes: int,
) -> bool:
    try:
        with connect_postgres() as connection, connection.cursor(row_factory=dict_row) as cursor:
            observed = agentgraph_query.execute_fixed_agentgraph_query(
                cursor,
                """
                MATCH (run:Run {runId: $runId})
                MERGE (artifact:Artifact {artifactId: $artifactId})
                SET artifact.artifactKind=$artifactKind,
                    artifact.locator=$locator,
                    artifact.contentSha256=$contentSha256,
                    artifact.sizeBytes=$sizeBytes
                MERGE (run)-[edge:PRODUCED_ARTIFACT]->(artifact)
                RETURN run.runId, artifact.artifactId
                """,
                {
                    "runId": run_id,
                    "artifactId": artifact_id,
                    "artifactKind": artifact_kind,
                    "locator": locator,
                    "contentSha256": content_sha256,
                    "sizeBytes": size_bytes,
                },
                "run_id agtype, artifact_id agtype",
            )
        return (
            len(observed) == 1
            and str(observed[0].get("run_id") or "") == run_id
            and str(observed[0].get("artifact_id") or "") == artifact_id
        )
    except Exception:
        return False
