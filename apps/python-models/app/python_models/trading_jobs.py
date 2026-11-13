"""PostgreSQL Trade Job, decision, and readback ownership."""

# Entity: Trading
# Relationship: Owns Project-scoped paper Trade Jobs and research decisions with actual Hermes provenance, joins retained simulation evidence and broker observations, and keeps unapproved execution unavailable.

from __future__ import annotations

import json
from typing import Any
from uuid import UUID, uuid4

from psycopg.rows import dict_row

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
    configuration = extensions.get("configuration") if isinstance(extensions, dict) else None
    result["configuration"] = normalize_trading_configuration(configuration)
    return result


def accept_trade_assignment(
    *, project_id: str, deck_id: str, card_id: str, source_execution: dict[str, Any],
    plan: Any, idempotency_key: str,
) -> dict[str, Any]:
    normalized = normalize_trade_plan(plan)
    key = required_trade_text(idempotency_key, "idempotency_key", 160)
    job_id = str(uuid4())
    with connect_postgres(autocommit=False) as connection:
        with connection.cursor(row_factory=dict_row) as cursor:
            card = require_trading_card(cursor, project_id, deck_id, card_id)
            execution = _execution_reference(source_execution, card["runtime_profile"])
            _lock_card(cursor, project_id, deck_id, card_id)
            cursor.execute(
                "SELECT * FROM ag_catalog.trading_jobs WHERE project_id=%s AND deck_id=%s AND card_id=%s AND idempotency_key=%s",
                (project_id, deck_id, card_id, key),
            )
            existing = cursor.fetchone()
            if existing:
                if existing["plan"] != normalized:
                    raise TradingBoundaryError("trading_assignment_idempotency_conflict")
                return _public_job(dict(existing))
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
                  source_execution, idempotency_key, symbol, asset_class, plan,
                  state, current_action, execution_state, budget_ceiling_usd, max_loss_usd
                ) VALUES (
                  %s,%s,%s,%s,%s,%s::jsonb,%s,%s,%s,%s::jsonb,
                  'monitoring','WAIT','blocked_pending_separate_approval',%s,%s
                )
                RETURNING *
                """,
                (
                    job_id, project_id, deck_id, card_id, card["current_revision_id"],
                    json.dumps(execution), key, normalized["instrument"]["symbol"],
                    normalized["assetClass"], json.dumps(normalized),
                    normalized["budgetCeilingUsd"], normalized["maxLossUsd"],
                ),
            )
            row = dict(cursor.fetchone())
        connection.commit()
    return _public_job(row)


def record_trade_decision(
    *, project_id: str, deck_id: str, card_id: str, source_execution: dict[str, Any],
    action: str, rationale: str, confidence: Any,
    evidence: Any, missing_terms: Any, idempotency_key: str,
    job_id: str | None = None, subject: str | None = None,
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
    if job_id is not None and subject is not None:
        raise TradingBoundaryError("trading_decision_choose_job_or_research_subject")
    try:
        normalized_job_id = str(UUID(required_trade_text(job_id, "job_id", 64))) if job_id is not None else None
    except ValueError:
        raise TradingBoundaryError("trading_job_id_invalid") from None
    normalized_subject = required_trade_text(subject, "research_subject", 500) if not normalized_job_id else None
    normalized_rationale = required_trade_text(rationale, "rationale", 8_000)
    normalized_missing = [item.strip() for item in missing_terms]
    try:
        evidence_json = json.dumps(evidence, allow_nan=False)
    except (TypeError, ValueError):
        raise TradingBoundaryError("trading_decision_evidence_invalid") from None
    decision_id = str(uuid4())
    key = required_trade_text(idempotency_key, "idempotency_key", 160)
    state = {
        "PAUSE": "paused", "FAIL_SAFE": "fail_safe", "EXIT": "completed",
    }.get(normalized_action, "monitoring")
    with connect_postgres(autocommit=False) as connection:
        with connection.cursor(row_factory=dict_row) as cursor:
            card = require_trading_card(cursor, project_id, deck_id, card_id)
            execution = _execution_reference(source_execution, card["runtime_profile"])
            _lock_card(cursor, project_id, deck_id, card_id)
            job = None
            if normalized_job_id:
                cursor.execute(
                    """SELECT * FROM ag_catalog.trading_jobs
                       WHERE job_id=%s AND project_id=%s AND deck_id=%s AND card_id=%s FOR UPDATE""",
                    (normalized_job_id, project_id, deck_id, card_id),
                )
                job = cursor.fetchone()
                if job is None:
                    raise TradingBoundaryError("trading_job_not_found")
                normalized_subject = job["symbol"]
            cursor.execute(
                """SELECT * FROM ag_catalog.trading_decisions
                   WHERE project_id=%s AND deck_id=%s AND card_id=%s
                     AND job_id IS NOT DISTINCT FROM %s::uuid AND idempotency_key=%s""",
                (project_id, deck_id, card_id, normalized_job_id, key),
            )
            existing = cursor.fetchone()
            if existing:
                expected = {"action": normalized_action, "rationale": normalized_rationale,
                            "confidence": float(confidence), "evidence": evidence,
                            "missing_terms": normalized_missing, "subject": normalized_subject}
                if any(existing[field] != value for field, value in expected.items()):
                    raise TradingBoundaryError("trading_decision_idempotency_conflict")
                return {"job": _public_job(dict(job)) if job else None,
                        "decision": _public_decision(dict(existing))}
            for item in evidence:
                if item.get("backtestId"):
                    try:
                        backtest_id = str(UUID(str(item["backtestId"])))
                    except ValueError:
                        raise TradingBoundaryError("trading_backtest_reference_invalid") from None
                    cursor.execute(
                        """SELECT lifecycle_run_id FROM ag_catalog.trading_lifecycle_runs
                           WHERE lifecycle_run_id=%s AND project_id=%s AND deck_id=%s AND status='completed'""",
                        (backtest_id, project_id, deck_id),
                    )
                    if cursor.fetchone() is None:
                        raise TradingBoundaryError("trading_backtest_reference_not_found")
            from app.python_models.trading_evidence import validate_receipt_references
            validate_receipt_references(cursor, project_id, deck_id,
                [item for item in evidence if any(field in item for field in
                 ("forecastId", "proposalId", "assessmentId", "journalEntryId", "outcomeEntryId"))])
            cursor.execute(
                """
                INSERT INTO ag_catalog.trading_decisions (
                  decision_id, job_id, project_id, deck_id, card_id, card_revision_id,
                  source_execution, idempotency_key, action, subject,
                  rationale, confidence, evidence, missing_terms, execution_requested
                ) VALUES (%s,%s,%s,%s,%s,%s,%s::jsonb,%s,%s,%s,%s,%s,%s::jsonb,%s::jsonb,FALSE)
                RETURNING *
                """,
                (
                    decision_id, normalized_job_id, project_id, deck_id, card_id, card["current_revision_id"],
                    json.dumps(execution), key, normalized_action, normalized_subject,
                    normalized_rationale, float(confidence), evidence_json, json.dumps(normalized_missing),
                ),
            )
            decision = dict(cursor.fetchone())
            if job is not None:
                cursor.execute(
                    """UPDATE ag_catalog.trading_jobs SET state=%s, current_action=%s, updated_at=NOW()
                       WHERE job_id=%s RETURNING *""",
                    (state, normalized_action, normalized_job_id),
                )
                job = dict(cursor.fetchone())
        connection.commit()
    return {"job": _public_job(job) if job else None, "decision": _public_decision(decision)}


def _lock_card(cursor: Any, project_id: str, deck_id: str, card_id: str) -> None:
    # Serialize admissions and retries for this Card before checking its remaining capacity.
    cursor.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))",
                   (json.dumps([project_id, deck_id, card_id]),))


def _execution_reference(value: Any, profile: str) -> dict[str, str]:
    fields = {"runtime", "profile", "sessionId", "turnId", "toolCallId"}
    if (not isinstance(value, dict) or set(value) != fields or value.get("runtime") != "hermes"
            or value.get("profile") != profile or any(not isinstance(value.get(key), str)
                or not value[key].strip() or value[key] != value[key].strip()
                or len(value[key]) > 256 or any(ord(char) < 32 for char in value[key]) for key in fields)):
        raise TradingBoundaryError("trading_hermes_execution_reference_invalid")
    return dict(value)


def intervene_trade_job(
    *, project_id: str, deck_id: str, card_id: str, job_id: str,
    action: str, reason: str, actor: str,
) -> dict[str, Any]:
    normalized_action = str(action or "").strip().upper()
    if normalized_action not in {"PAUSE", "RESUME"}:
        raise TradingBoundaryError("trading_intervention_action_invalid")
    raise TradingBoundaryError("trading_intervention_lifecycle_unavailable")


def _allocation_context(cursor, project_id: str, deck_id: str, card_id: str) -> dict:
    card = require_trading_card(cursor, project_id, deck_id, card_id)
    cursor.execute(
        """SELECT COALESCE(SUM(budget_ceiling_usd),0) AS reserved
           FROM ag_catalog.trading_jobs WHERE project_id=%s AND deck_id=%s AND card_id=%s
           AND state IN ('monitoring','paused')""", (project_id, deck_id, card_id),
    )
    return {"configuration": card["configuration"],
            "cardRevisionId": str(card["current_revision_id"]),
            "reservedCapitalUsd": float(cursor.fetchone()["reserved"])}


def read_portfolio_context(*, project_id: str, deck_id: str, card_id: str) -> dict:
    """The same saved allocation policy and broker reader, without fetching job charts."""
    from app.python_models.portfolio_policy import allocation_view

    with connect_postgres() as connection, connection.cursor(row_factory=dict_row) as cursor:
        context = _allocation_context(cursor, project_id, deck_id, card_id)
        cursor.execute("""SELECT r.enabled FROM ag_catalog.agent_cards c
            JOIN ag_catalog.agent_card_revisions r ON r.revision_id=c.current_revision_id
            WHERE c.project_id=%s AND c.deck_id=%s AND c.card_id=%s AND r.revision_id=%s
              AND EXISTS (SELECT 1 FROM ag_catalog.card_capability_grants g
                WHERE g.revision_id=r.revision_id AND g.grant_kind='tool' AND g.grant_id='trading.get_state')""",
            (project_id, deck_id, card_id, context["cardRevisionId"]))
        enabled_card = cursor.fetchone()
        if not enabled_card or enabled_card["enabled"] is not True:
            raise TradingBoundaryError("portfolio_current_enabled_owner_required")
    broker = read_lumibot_paper_snapshot()
    policy = context["configuration"]["trading"].get("allocationPolicy")
    allocation = allocation_view(policy, broker, reserved_capital=context["reservedCapitalUsd"])
    allocation["policySaved"] = policy is not None
    return {"cardId": card_id, "cardRevisionId": context["cardRevisionId"],
            "allocation": allocation, "positions": broker["positions"],
            "connection": broker["connection"], "observedAt": utc_now_text(),
            "executionAuthorized": False}


def _read_trading_history(
    project_id: str, deck_id: str, card_id: str,
) -> tuple[
    list[dict[str, Any]], dict[str, list[dict[str, Any]]],
    dict[str, list[dict[str, Any]]], list[dict[str, Any]], list[dict[str, Any]], dict[str, Any],
]:
    from app.python_models.trading_backtest import _public_backtest

    with connect_postgres() as connection, connection.cursor(row_factory=dict_row) as cursor:
        allocation_context = _allocation_context(cursor, project_id, deck_id, card_id)
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
        cursor.execute(
            """SELECT * FROM ag_catalog.trading_decisions
               WHERE project_id=%s AND deck_id=%s AND card_id=%s AND job_id IS NULL
               ORDER BY created_at DESC LIMIT 100""",
            (project_id, deck_id, card_id),
        )
        research = [_public_decision(dict(row)) for row in cursor.fetchall()]
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
        # Resolve only evidence actually cited by this Card's journal; keep the
        # original producing Card and execution reference on each receipt.
        cited = {str(item['backtestId']) for decision in
                 research + [entry for entries in decisions.values() for entry in entries]
                 for item in decision['evidence'] if item.get('backtestId')}
        backtests = []
        if cited:
            cursor.execute(
                """SELECT * FROM ag_catalog.trading_lifecycle_runs
                   WHERE project_id=%s AND deck_id=%s AND status='completed'
                     AND lifecycle_run_id=ANY(%s::uuid[]) ORDER BY created_at DESC""",
                (project_id, deck_id, list(cited)),
            )
            backtests = [_public_backtest(row) for row in cursor.fetchall()]
        from app.python_models.trading_journal import read_journal_entries, outcome_performance
        allocation_context["outcomePerformance"] = outcome_performance(cursor, project_id, deck_id, card_id)
        visible_decisions = research + [entry for entries in decisions.values() for entry in entries]
        journal = read_journal_entries(cursor, project_id, deck_id,
                                       [entry["decisionId"] for entry in visible_decisions])
        for entry in visible_decisions:
            attached = [item for item in journal if item["decision_id"] == entry["decisionId"]]
            if attached:
                entry["journalEntries"] = sorted(attached, key=lambda item: (item["created_at"], item["entry_id"]))
                entry["journalWindowComplete"] = len(journal) < 200
    return jobs, decisions, interventions, research, backtests, allocation_context


def _project_public_trading_jobs(
    jobs: list[dict[str, Any]],
    decisions: dict[str, list[dict[str, Any]]],
    interventions: dict[str, list[dict[str, Any]]],
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
    jobs, decisions, interventions, research, backtests, allocation_context = (
        _read_trading_history(project_id, deck_id, card_id)
    )
    broker_state = read_lumibot_paper_snapshot()
    market_by_symbol = market_observations(jobs, timeframe, selected_job_id)
    public_jobs = _project_public_trading_jobs(
        jobs, decisions, interventions,
        broker_state, market_by_symbol, timeframe,
    )
    realized = [
        float(row["realized_pnl_usd"])
        for row in jobs
        if row.get("realized_pnl_usd") is not None
    ]
    recorded_realized = sum(realized)
    from app.python_models.portfolio_policy import allocation_view
    policy = allocation_context["configuration"]["trading"].get("allocationPolicy")
    allocation = allocation_view(policy, broker_state, reserved_capital=allocation_context["reservedCapitalUsd"])
    allocation["policySaved"] = policy is not None
    return {
        "cardId": card_id,
        "paperOnly": True,
        "executionApproved": False,
        "timeframe": timeframe,
        "jobs": public_jobs,
        "researchDecisions": research,
        "backtests": backtests,
        "allocation": allocation,
        "outcomePerformance": allocation_context["outcomePerformance"],
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
        "sourceExecution": row["source_execution"],
        "createdAt": str(row.get("created_at") or ""),
        "updatedAt": str(row.get("updated_at") or ""),
    }


def _public_decision(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "decisionId": str(row.get("decision_id") or ""),
        "jobId": str(row["job_id"]) if row.get("job_id") else None,
        "kind": "trade_job" if row.get("job_id") else "research",
        "subject": str(row.get("subject") or ""),
        "producerCardId": str(row.get("card_id") or ""),
        "cardRevisionId": str(row.get("card_revision_id") or ""),
        "action": str(row.get("action") or ""),
        "rationale": str(row.get("rationale") or ""),
        "confidence": float(row.get("confidence") or 0),
        "evidence": row.get("evidence") or [],
        "missingTerms": row.get("missing_terms") or [],
        "executionRequested": row.get("execution_requested") is True,
        "sourceExecution": row["source_execution"],
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
