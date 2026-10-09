"""PostgreSQL Trade Job, decision, and readback ownership."""

from __future__ import annotations

import json
from typing import Any
from uuid import UUID, uuid4

from psycopg.rows import dict_row

from app.python_models.card_subsystem import normalize_card_subsystems
from app.python_models.postgres import connect_postgres
from app.python_models.trading_broker_observation import (
    lumibot_readiness,
    market_observations,
    read_lumibot_paper_snapshot,
)
from app.python_models.trading_contract import (
    TRADE_ACTIONS,
    TradingBoundaryError,
    deterministic_client_order_id,
    normalize_trade_plan,
    normalize_trading_configuration,
    optional_iso_text,
    required_trade_text,
    utc_now_text,
    validate_plan_against_configuration,
)


def require_trading_card(
    cursor: Any,
    project_id: str,
    deck_id: str,
    card_id: str,
) -> dict[str, Any]:
    if not str(card_id or "").strip():
        raise TradingBoundaryError("trading_card_identity_required")
    cursor.execute(
        """
        SELECT card.current_revision_id, revision.runtime_kind, revision.runtime_mode,
               revision.runtime_profile, revision.runtime_extension_config
        FROM ag_catalog.agent_cards AS card
        JOIN ag_catalog.agent_card_revisions AS revision
          ON revision.revision_id = card.current_revision_id
        WHERE card.project_id=%s AND card.deck_id=%s AND card.card_id=%s
        """,
        (project_id, deck_id, card_id),
    )
    row = cursor.fetchone()
    if not row:
        raise TradingBoundaryError("trading_card_not_found")
    if (
        row["runtime_kind"] != "hermes"
        or row["runtime_mode"] != "delegate"
        or not str(row["runtime_profile"] or "").strip()
    ):
        raise TradingBoundaryError("trading_card_hermes_runtime_required")
    result = dict(row)
    extensions = result.get("runtime_extension_config")
    if not isinstance(extensions, dict):
        raise TradingBoundaryError("trading_card_extensions_required")
    try:
        subsystems = normalize_card_subsystems(extensions.get("subsystems"))
    except ValueError as error:
        raise TradingBoundaryError(str(error)) from error
    attachment = next((item for item in subsystems if item["id"] == "lumibot"), None)
    if (
        attachment is None
        or attachment.get("configurationSchema") != "trading.card.v1"
        or set(attachment["adapter"]["capabilities"])
        != {"state", "events", "commands", "artifacts", "readiness"}
    ):
        raise TradingBoundaryError("trading_card_lumibot_attachment_required")
    configuration = extensions.get("configuration") if isinstance(extensions, dict) else None
    result["configuration"] = normalize_trading_configuration(configuration)
    result["subsystem"] = attachment
    return result


def accept_trade_assignment(
    *, project_id: str, deck_id: str, card_id: str, source_run_id: str,
    plan: Any, idempotency_key: str,
) -> dict[str, Any]:
    normalized = normalize_trade_plan(plan)
    key = required_trade_text(idempotency_key, "idempotency_key", 160)
    source_run = required_trade_text(source_run_id, "source_run_id", 160)
    job_id = str(uuid4())
    with connect_postgres(autocommit=False) as connection:
        with connection.cursor(row_factory=dict_row) as cursor:
            card = require_trading_card(cursor, project_id, deck_id, card_id)
            cursor.execute(
                """
                SELECT COUNT(*) AS active_job_count
                FROM ag_catalog.trading_jobs
                WHERE project_id=%s AND deck_id=%s AND card_id=%s
                  AND state IN ('monitoring', 'paused')
                """,
                (project_id, deck_id, card_id),
            )
            active_job_count = int(cursor.fetchone()["active_job_count"])
            validate_plan_against_configuration(
                normalized, card["configuration"], active_job_count=active_job_count,
            )
            cursor.execute(
                """
                INSERT INTO ag_catalog.trading_jobs (
                  job_id, project_id, deck_id, card_id, card_revision_id,
                  source_run_id, idempotency_key, symbol, asset_class, plan,
                  state, current_action, execution_state, budget_ceiling_usd, max_loss_usd
                ) VALUES (
                  %s,%s,%s,%s,%s,%s,%s,%s,%s,%s::jsonb,
                  'monitoring','WAIT','blocked_pending_separate_approval',%s,%s
                )
                ON CONFLICT (project_id, deck_id, card_id, idempotency_key)
                DO UPDATE SET updated_at=ag_catalog.trading_jobs.updated_at
                RETURNING *
                """,
                (
                    job_id, project_id, deck_id, card_id, card["current_revision_id"],
                    source_run, key, normalized["instrument"]["symbol"],
                    normalized["assetClass"], json.dumps(normalized),
                    normalized["budgetCeilingUsd"], normalized["maxLossUsd"],
                ),
            )
            row = dict(cursor.fetchone())
        connection.commit()
    return _public_job(row)


def record_trade_decision(
    *, project_id: str, deck_id: str, card_id: str, source_run_id: str,
    job_id: str, action: str, rationale: str, confidence: Any,
    evidence: Any, missing_terms: Any, idempotency_key: str,
) -> dict[str, Any]:
    normalized_action = str(action or "").strip().upper()
    if normalized_action not in TRADE_ACTIONS:
        raise TradingBoundaryError("trading_decision_action_invalid")
    if isinstance(confidence, bool) or not isinstance(confidence, (int, float)) or not 0 <= confidence <= 1:
        raise TradingBoundaryError("trading_decision_confidence_invalid")
    if not isinstance(evidence, list) or len(evidence) > 64 or any(not isinstance(item, dict) for item in evidence):
        raise TradingBoundaryError("trading_decision_evidence_invalid")
    if not isinstance(missing_terms, list) or len(missing_terms) > 32 or any(
        not isinstance(item, str) or not item.strip() for item in missing_terms
    ):
        raise TradingBoundaryError("trading_decision_missing_terms_invalid")
    if normalized_action in {"ENTER", "HOLD", "REDUCE", "EXIT"} and missing_terms:
        raise TradingBoundaryError("trading_decision_missing_terms_fail_closed")
    normalized_job_id = str(UUID(required_trade_text(job_id, "job_id", 64)))
    decision_id = str(uuid4())
    key = required_trade_text(idempotency_key, "idempotency_key", 160)
    state = {
        "PAUSE": "paused", "FAIL_SAFE": "fail_safe", "EXIT": "completed",
    }.get(normalized_action, "monitoring")
    with connect_postgres(autocommit=False) as connection:
        with connection.cursor(row_factory=dict_row) as cursor:
            require_trading_card(cursor, project_id, deck_id, card_id)
            cursor.execute(
                """
                SELECT job_id FROM ag_catalog.trading_jobs
                WHERE job_id=%s AND project_id=%s AND deck_id=%s AND card_id=%s
                FOR UPDATE
                """,
                (normalized_job_id, project_id, deck_id, card_id),
            )
            if cursor.fetchone() is None:
                raise TradingBoundaryError("trading_job_not_found")
            cursor.execute(
                """
                INSERT INTO ag_catalog.trading_decisions (
                  decision_id, job_id, source_run_id, idempotency_key, action,
                  rationale, confidence, evidence, missing_terms, execution_requested
                ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s::jsonb,%s::jsonb,FALSE)
                ON CONFLICT (job_id, idempotency_key)
                DO UPDATE SET idempotency_key=ag_catalog.trading_decisions.idempotency_key
                RETURNING *
                """,
                (
                    decision_id, normalized_job_id,
                    required_trade_text(source_run_id, "source_run_id", 160),
                    key, normalized_action, required_trade_text(rationale, "rationale", 8_000),
                    float(confidence), json.dumps(evidence),
                    json.dumps([item.strip() for item in missing_terms]),
                ),
            )
            decision = dict(cursor.fetchone())
            cursor.execute(
                """
                UPDATE ag_catalog.trading_jobs
                SET state=%s, current_action=%s, updated_at=NOW()
                WHERE job_id=%s
                RETURNING *
                """,
                (state, normalized_action, normalized_job_id),
            )
            job = dict(cursor.fetchone())
        connection.commit()
    return {"job": _public_job(job), "decision": _public_decision(decision)}


def intervene_trade_job(
    *, project_id: str, deck_id: str, card_id: str, job_id: str,
    action: str, reason: str, actor: str,
) -> dict[str, Any]:
    normalized_action = str(action or "").strip().upper()
    if normalized_action not in {"PAUSE", "RESUME"}:
        raise TradingBoundaryError("trading_intervention_action_invalid")
    raise TradingBoundaryError("trading_intervention_lifecycle_unavailable")


def _read_trading_history(
    project_id: str, deck_id: str, card_id: str,
) -> tuple[
    list[dict[str, Any]], dict[str, list[dict[str, Any]]],
    dict[str, list[dict[str, Any]]], dict[str, list[dict[str, Any]]],
    dict[str, dict[str, Any]],
]:
    with connect_postgres() as connection, connection.cursor(row_factory=dict_row) as cursor:
        require_trading_card(cursor, project_id, deck_id, card_id)
        cursor.execute(
            """
            SELECT * FROM ag_catalog.trading_jobs
            WHERE project_id=%s AND deck_id=%s AND card_id=%s
            ORDER BY updated_at DESC, created_at DESC
            LIMIT 100
            """,
            (project_id, deck_id, card_id),
        )
        jobs = [dict(row) for row in cursor.fetchall()]
        decisions: dict[str, list[dict[str, Any]]] = {str(row["job_id"]): [] for row in jobs}
        interventions: dict[str, list[dict[str, Any]]] = {
            str(row["job_id"]): [] for row in jobs
        }
        artifacts: dict[str, list[dict[str, Any]]] = {}
        source_runs: dict[str, dict[str, Any]] = {}
        if jobs:
            job_ids = [str(row["job_id"]) for row in jobs]
            cursor.execute(
                """
                SELECT decision.* FROM ag_catalog.trading_decisions AS decision
                WHERE decision.job_id = ANY(%s::uuid[])
                ORDER BY decision.created_at DESC
                """,
                (job_ids,),
            )
            for row in cursor.fetchall():
                decisions[str(row["job_id"])].append(_public_decision(dict(row)))
            cursor.execute(
                """
                SELECT * FROM ag_catalog.trading_interventions
                WHERE job_id = ANY(%s::uuid[])
                ORDER BY created_at DESC
                """,
                (job_ids,),
            )
            for row in cursor.fetchall():
                interventions[str(row["job_id"])].append(_public_intervention(dict(row)))
            run_ids = list(dict.fromkeys(
                str(row.get("source_run_id") or "") for row in jobs
                if str(row.get("source_run_id") or "")
            ))
            if run_ids:
                cursor.execute(
                    """
                    SELECT artifact_id, producing_run_id, artifact_kind, locator,
                           media_type, content_sha256, provenance_ref, size_bytes, created_at
                    FROM ag_catalog.run_artifacts
                    WHERE producing_run_id = ANY(%s::text[])
                    ORDER BY created_at DESC
                    """,
                    (run_ids,),
                )
                for row in cursor.fetchall():
                    run_id = str(row["producing_run_id"])
                    artifacts.setdefault(run_id, []).append(_public_artifact(dict(row)))
                cursor.execute(
                    """
                    SELECT run_id, state, started_at, finished_at, error_code, error_summary
                    FROM ag_catalog.agent_runs
                    WHERE run_id = ANY(%s::text[])
                    """,
                    (run_ids,),
                )
                source_runs = {str(row["run_id"]): dict(row) for row in cursor.fetchall()}

    return jobs, decisions, interventions, artifacts, source_runs


def _project_public_trading_jobs(
    jobs: list[dict[str, Any]],
    decisions: dict[str, list[dict[str, Any]]],
    interventions: dict[str, list[dict[str, Any]]],
    artifacts: dict[str, list[dict[str, Any]]],
    source_runs: dict[str, dict[str, Any]],
    broker_state: dict[str, Any],
    market_by_symbol: dict[str, dict[str, Any]],
    timeframe: str,
) -> list[dict[str, Any]]:
    account_orders = broker_state["orders"]
    account_positions = broker_state["positions"]
    public_jobs: list[dict[str, Any]] = []
    for row in jobs:
        job_id = str(row["job_id"])
        job_decisions = decisions.get(job_id, [])
        linked_client_order_ids = {
            deterministic_client_order_id(job_id, decision["decisionId"])
            for decision in job_decisions
        }
        linked_orders = [
            order for order in account_orders
            if order.get("clientOrderId") in linked_client_order_ids
        ]
        linked_position = next((
            position for position in account_positions
            if linked_orders and position.get("symbol") == str(row.get("symbol") or "").upper()
        ), None)
        fills = [
            {
                "fillId": f"{order['orderId']}:{order.get('filledAt') or order.get('updatedAt')}",
                "orderId": order["orderId"],
                "side": order.get("side"),
                "quantity": order.get("filledQuantity"),
                "price": order.get("averageFillPrice"),
                "timestamp": order.get("filledAt") or order.get("updatedAt"),
            }
            for order in linked_orders
            if (order.get("filledQuantity") or 0) > 0
            and order.get("averageFillPrice") is not None
        ]
        job_events = [
            {
                "eventId": decision["decisionId"],
                "kind": "decision",
                "source": "hermes",
                "action": decision["action"],
                "summary": decision["rationale"],
                "createdAt": decision["createdAt"],
            }
            for decision in job_decisions
        ] + [
            {
                "eventId": item["interventionId"],
                "kind": "intervention",
                "source": "user",
                "action": item["action"],
                "summary": item["reason"],
                "createdAt": item["createdAt"],
            }
            for item in interventions.get(job_id, [])
        ]
        source_run = source_runs.get(str(row.get("source_run_id") or ""))
        if source_run is not None:
            job_events.append({
                "eventId": f"run:{source_run['run_id']}:{source_run['state']}",
                "kind": "card_run",
                "source": "card",
                "action": source_run["state"],
                "summary": source_run.get("error_summary") or source_run.get("error_code")
                or f"Card Run {source_run['state']}",
                "createdAt": optional_iso_text(
                    source_run.get("finished_at") or source_run.get("started_at")
                ),
            })
        job_events.sort(key=lambda item: str(item.get("createdAt") or ""), reverse=True)
        symbol = str(row.get("symbol") or "").upper()
        market = market_by_symbol.get(symbol, {
            "status": "not_requested",
            "provider": "alpaca",
            "feed": None,
            "timeframe": timeframe,
            "fetchedAt": None,
            "observedAt": None,
            "freshness": None,
            "currentPrice": None,
            "bars": [],
            "diagnostics": "market evidence is loaded for active and selected jobs only",
        })
        public_jobs.append({
            **_public_job(row),
            "decisions": job_decisions,
            "interventions": interventions.get(job_id, []),
            "market": market,
            "position": linked_position,
            "orders": linked_orders,
            "fills": fills,
            "events": job_events,
            "artifacts": artifacts.get(str(row.get("source_run_id") or ""), []),
            "lifecycle": {
                "status": "broker_observed" if linked_orders else "not_attached",
                "diagnostics": None if linked_orders else (
                    "No deterministic broker order identity is linked to this Trade Job."
                ),
            },
        })
    return public_jobs


def read_trading_state(
    *, project_id: str, deck_id: str, card_id: str,
    timeframe: str = "5Min", selected_job_id: str | None = None,
) -> dict[str, Any]:
    jobs, decisions, interventions, artifacts, source_runs = (
        _read_trading_history(project_id, deck_id, card_id)
    )
    broker_state = read_lumibot_paper_snapshot()
    market_by_symbol = market_observations(jobs, timeframe, selected_job_id)
    public_jobs = _project_public_trading_jobs(
        jobs, decisions, interventions, artifacts, source_runs,
        broker_state, market_by_symbol, timeframe,
    )
    realized = [
        float(row["realized_pnl_usd"])
        for row in jobs
        if row.get("realized_pnl_usd") is not None
    ]
    recorded_realized = sum(realized)
    return {
        "cardId": card_id,
        "paperOnly": True,
        "executionApproved": False,
        "timeframe": timeframe,
        "jobs": public_jobs,
        "portfolio": {
            **broker_state["account"],
            "realizedPnlUsd": recorded_realized,
            "recordedRealizedPnlUsd": recorded_realized,
            "wins": len([value for value in realized if value > 0]),
            "losses": len([value for value in realized if value < 0]),
            "flat": len([value for value in realized if value == 0]),
            "closedTrades": len(realized),
            "equityCurve": broker_state["equityCurve"],
        },
        "positions": broker_state["positions"],
        "connection": broker_state["connection"],
        "commands": {
            "pauseResume": {
                "available": False,
                "reason": "No approved LumiBot Trader lifecycle is running for this Card.",
            },
            "exit": {
                "available": False,
                "reason": "Paper order execution is blocked pending separate broker/risk approval.",
            },
            "cancel": {
                "available": False,
                "reason": "No approved broker cancellation command is registered for this Card.",
            },
        },
        "engine": lumibot_readiness(),
        "observedAt": utc_now_text(),
    }


def _public_job(row: dict[str, Any]) -> dict[str, Any]:
    plan = row.get("plan") if isinstance(row.get("plan"), dict) else json.loads(row.get("plan") or "{}")
    return {
        "jobId": str(row.get("job_id") or ""),
        "symbol": str(row.get("symbol") or ""),
        "assetClass": str(row.get("asset_class") or ""),
        "state": str(row.get("state") or ""),
        "action": str(row.get("current_action") or "WAIT"),
        "executionState": str(row.get("execution_state") or ""),
        "budgetCeilingUsd": float(row.get("budget_ceiling_usd") or 0),
        "maxLossUsd": float(row.get("max_loss_usd") or 0),
        "realizedPnlUsd": (
            float(row["realized_pnl_usd"]) if row.get("realized_pnl_usd") is not None else None
        ),
        "plan": plan,
        "sourceRunId": str(row.get("source_run_id") or ""),
        "createdAt": str(row.get("created_at") or ""),
        "updatedAt": str(row.get("updated_at") or ""),
    }


def _public_decision(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "decisionId": str(row.get("decision_id") or ""),
        "action": str(row.get("action") or ""),
        "rationale": str(row.get("rationale") or ""),
        "confidence": float(row.get("confidence") or 0),
        "evidence": row.get("evidence") or [],
        "missingTerms": row.get("missing_terms") or [],
        "executionRequested": row.get("execution_requested") is True,
        "sourceRunId": str(row.get("source_run_id") or ""),
        "createdAt": str(row.get("created_at") or ""),
    }


def _public_intervention(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "interventionId": str(row.get("intervention_id") or ""),
        "action": str(row.get("action") or ""),
        "reason": str(row.get("reason") or ""),
        "actor": str(row.get("actor") or ""),
        "createdAt": str(row.get("created_at") or ""),
    }


def _public_artifact(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "artifactId": str(row.get("artifact_id") or ""),
        "kind": str(row.get("artifact_kind") or ""),
        "locator": str(row.get("locator") or ""),
        "mediaType": row.get("media_type"),
        "contentSha256": row.get("content_sha256"),
        "provenanceRef": row.get("provenance_ref"),
        "sizeBytes": row.get("size_bytes"),
        "createdAt": str(row.get("created_at") or ""),
    }
