"""Read-only saved-deck and AGE AgentGraph inspection."""

from __future__ import annotations

from typing import Any

from psycopg.rows import dict_row

from app.python_models import agentgraph_query, saved_cards
from app.python_models.postgres import connect_postgres
from app.python_models.saved_card_contract import (
    CardDomainError,
    card_runtime,
    required_text,
)

def _validated_inspection_scope(payload: dict[str, Any]) -> dict[str, Any]:
    project_ref = required_text(payload.get("projectId"), "project_id")
    deck_id = required_text(payload.get("deckId"), "deck_id")
    run_id = str(payload.get("runId") or "").strip()
    card_id = str(payload.get("cardId") or "").strip()
    conversation_id = str(payload.get("conversationId") or "").strip()
    project_wide = payload.get("projectWide") is True
    raw_limit = payload.get("limit", 20)
    if isinstance(raw_limit, bool) or not isinstance(raw_limit, int) or not 1 <= raw_limit <= 50:
        raise CardDomainError("agentgraph_limit_invalid")
    return {"projectRef": project_ref, "deckId": deck_id, "runId": run_id,
            "cardId": card_id, "conversationId": conversation_id,
            "projectWide": project_wide, "limit": raw_limit,
            "edgeLimit": min(1000, raw_limit * 20)}


def _base_age_run_projection(
    cursor: Any, *, project_id: str, deck_id: str, owner_scope: str,
    run_id: str, card_id: str, conversation_id: str, limit: int,
) -> dict[str, dict[str, Any]]:
    run_filter = " ".join(
        clause for enabled, clause in (
            (bool(run_id), "AND run.runId = $runId"),
            (bool(card_id), "AND card.cardId = $cardId"),
            (bool(conversation_id), "AND run.conversationId = $conversationId"),
        ) if enabled
    )
    run_rows = agentgraph_query.execute_fixed_agentgraph_query(
        cursor,
        f"""
        MATCH (run:Run {{{owner_scope}}})
              -[:EXECUTED_BY]->
              (card:Card {{{owner_scope}}})
        WHERE true {run_filter}
        RETURN properties(run), card.cardId
        ORDER BY coalesce(run.acceptedAt, run.startedAt) DESC, run.runId DESC
        LIMIT {limit}
        """,
        {"projectId": project_id, "deckId": deck_id, "runId": run_id,
         "cardId": card_id, "conversationId": conversation_id},
        "run agtype, card_id agtype",
    )
    runs: dict[str, dict[str, Any]] = {}
    for row in run_rows:
        properties = row.get("run") if isinstance(row.get("run"), dict) else {}
        current_run_id = str(properties.get("runId") or "")
        if not current_run_id:
            continue
        runs[current_run_id] = {
            "runId": current_run_id,
            "correlationId": str(properties.get("correlationId") or ""),
            "state": str(properties.get("state") or "unknown"),
            "projectId": project_id,
            "deckId": str(properties.get("deckId") or deck_id),
            "conversationId": str(properties.get("conversationId") or ""),
            "rootRunId": str(properties.get("rootRunId") or current_run_id),
            "startedAt": str(properties.get("startedAt") or "") or None,
            "acceptedAt": str(properties.get("acceptedAt") or "") or None,
            "finishedAt": str(properties.get("finishedAt") or "") or None,
            "preparationStartedAt": (
                str(properties.get("preparationStartedAt") or "") or None
            ),
            "preparationEndedAt": (
                str(properties.get("preparationEndedAt") or "") or None
            ),
            "preparationElapsedMs": properties.get("preparationElapsedMs"),
            "preparationState": (
                str(properties.get("preparationState") or "") or None
            ),
            "preparationError": (
                str(properties.get("preparationError") or "") or None
            ),
            "hermesRootId": str(properties.get("hermesRootId") or "") or None,
            "hermesRunId": str(properties.get("hermesRunId") or "") or None,
            "cardId": str(row.get("card_id") or ""),
            "assignedFromCardIds": [],
            "parentRunIds": [],
            "childRunIds": [],
            "usedTools": [],
            "graphReads": 0,
            "graphWrites": 0,
            "artifacts": [],
            "idf": {
                "sha256": str(properties.get("idfSha256") or "") or None,
                "bytes": properties.get("idfBytes"),
            },
        }

    return runs


def _apply_age_run_telemetry(
    cursor: Any, runs: dict[str, dict[str, Any]], *, project_id: str,
    deck_id: str, owner_scope: str, edge_limit: int,
) -> None:
    run_ids = list(runs)
    if run_ids:
        telemetry_queries = {
            "assignments": (
                """
                MATCH (sender:Card {projectId: $projectId, deckId: $deckId})
                      -[edge:ASSIGNED_TO]->
                      (target:Card {projectId: $projectId, deckId: $deckId})
                WHERE edge.runId IN $runIds
                RETURN edge.runId, sender.cardId, target.cardId
                """,
                "run_id agtype, sender_card_id agtype, target_card_id agtype",
            ),
            "lineage": (
                """
                MATCH (parent:Run {projectId: $projectId, deckId: $deckId})
                      -[:CHILD_RUN]->
                      (child:Run {projectId: $projectId, deckId: $deckId})
                WHERE parent.runId IN $runIds OR child.runId IN $runIds
                RETURN parent.runId, child.runId
                """,
                "parent_run_id agtype, child_run_id agtype",
            ),
            "tools": (
                """
                MATCH (run:Run {projectId: $projectId, deckId: $deckId})
                      -[edge:USED_TOOL]->(tool:Tool)
                WHERE run.runId IN $runIds
                  AND edge.eventId IS NOT NULL AND edge.eventId <> ''
                RETURN run.runId, tool.toolId, properties(edge)
                ORDER BY edge.timestamp DESC
                """,
                "run_id agtype, tool_id agtype, event agtype",
            ),
            "tool_totals": (
                """
                MATCH (run:Run {projectId: $projectId, deckId: $deckId})
                      -[edge:USED_TOOL]->(:Tool)
                WHERE run.runId IN $runIds
                  AND edge.eventId IS NOT NULL AND edge.eventId <> ''
                  AND (edge.phase IS NULL OR edge.phase = 'completed')
                RETURN run.runId, edge.operation, count(edge)
                """,
                "run_id agtype, operation agtype, event_count agtype",
            ),
            "artifacts": (
                """
                MATCH (run:Run {projectId: $projectId, deckId: $deckId})
                      -[:PRODUCED_ARTIFACT]->(artifact:Artifact)
                WHERE run.runId IN $runIds
                RETURN run.runId, properties(artifact)
                """,
                "run_id agtype, artifact agtype",
            ),
        }
        telemetry = {
            name: agentgraph_query.execute_fixed_agentgraph_query(
                cursor,
                query.replace("projectId: $projectId, deckId: $deckId", owner_scope)
                + f"\nLIMIT {edge_limit}",
                {
                    "projectId": project_id,
                    "deckId": deck_id,
                    "runIds": run_ids,
                },
                columns,
            )
            for name, (query, columns) in telemetry_queries.items()
        }
        for row in telemetry["assignments"]:
            item = runs.get(str(row.get("run_id") or ""))
            if item is not None:
                item["assignedFromCardIds"].append(
                    str(row.get("sender_card_id") or "")
                )
        for row in telemetry["lineage"]:
            parent_id = str(row.get("parent_run_id") or "")
            child_id = str(row.get("child_run_id") or "")
            if child_id in runs and parent_id:
                runs[child_id]["parentRunIds"].append(parent_id)
            if parent_id in runs and child_id:
                runs[parent_id]["childRunIds"].append(child_id)
        for row in telemetry["tools"]:
            item = runs.get(str(row.get("run_id") or ""))
            if item is not None:
                tool_id = str(row.get("tool_id") or "")
                if tool_id and tool_id not in item["usedTools"]:
                    item["usedTools"].append(tool_id)
        for row in telemetry["tool_totals"]:
            item = runs.get(str(row.get("run_id") or ""))
            operation = str(row.get("operation") or "")
            if item is not None and operation in {"read", "write"}:
                item["graphReads" if operation == "read" else "graphWrites"] = int(
                    row.get("event_count") or 0
                )
        for row in telemetry["artifacts"]:
            item = runs.get(str(row.get("run_id") or ""))
            artifact = row.get("artifact")
            if item is not None and isinstance(artifact, dict):
                item["artifacts"].append({
                    "artifactId": str(artifact.get("artifactId") or ""),
                    "artifactKind": str(artifact.get("artifactKind") or ""),
                    "locator": str(artifact.get("locator") or "")[:2048],
                })



def _saved_deck_inspection_projection(
    *, loaded: dict[str, Any], project_id: str, deck_id: str,
    project_wide: bool, conversation_id: str, card_id: str, run_id: str,
    runs: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    deck = loaded["deck"]
    cards = [
        {
            "cardId": str(card.get("id") or ""),
            "title": str(card.get("title") or ""),
            "runtime": card_runtime(card),
            "enabled": card.get("enabled") is not False
            and (card.get("runtimeOptions") or {}).get("enabled") is not False,
        }
        for card in deck["nodes"]
    ]
    relationships = [
        {
            "id": str(edge.get("id") or ""),
            "source": str(edge.get("source") or ""),
            "target": str(edge.get("target") or ""),
            "edgeType": str(edge.get("edgeType") or ""),
            "enabled": edge.get("enabled") is not False,
        }
        for edge in deck["edges"]
    ]
    return {
        "ok": True,
        "authority": "postgresql-age-agentgraph",
        "projectId": project_id,
        "deckId": deck_id,
        "scope": {
            "readScope": "project" if project_wide else "project-deck",
            "projectWideRequested": project_wide,
            "conversationId": conversation_id,
            "cardId": card_id or None,
            "runId": run_id or None,
            "conversationFilterAvailable": True,
        },
        "cards": cards,
        "relationships": relationships,
        "runs": list(runs.values()),
        "telemetry": {
            "runIdentity": True,
            "artifacts": True,
            "rawIdfStored": False,
        },
    }



def inspect_agentgraph(payload: dict[str, Any]) -> dict[str, Any]:
    """Read bounded current Card authority and identity-only AGE telemetry."""
    scope = _validated_inspection_scope(payload)
    deck_id = scope["deckId"]
    with connect_postgres(autocommit=False) as connection:
        with connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute("SET TRANSACTION READ ONLY")
            loaded = saved_cards.load_saved_deck_with_cursor(cursor, scope["projectRef"], deck_id)
            project_id = loaded["projectId"]
            owner_scope = "projectId: $projectId" + ("" if scope["projectWide"] else ", deckId: $deckId")
            runs = _base_age_run_projection(
                cursor, project_id=project_id, deck_id=deck_id, owner_scope=owner_scope,
                run_id=scope["runId"], card_id=scope["cardId"],
                conversation_id=scope["conversationId"], limit=scope["limit"],
            )
            _apply_age_run_telemetry(
                cursor, runs, project_id=project_id, deck_id=deck_id,
                owner_scope=owner_scope, edge_limit=scope["edgeLimit"],
            )
    return _saved_deck_inspection_projection(
        loaded=loaded, project_id=project_id, deck_id=deck_id,
        project_wide=scope["projectWide"], conversation_id=scope["conversationId"],
        card_id=scope["cardId"], run_id=scope["runId"], runs=runs,
    )
