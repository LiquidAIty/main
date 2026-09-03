"""Deterministic, paper-only Trade Job state beneath the saved Trading Card.

Hermes owns reasoning, memory, skills, sessions, and optional Team use.  This
module owns only typed plan validation and durable state transitions.  It has no
live-broker client and deliberately exposes no order-submission function.
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from importlib import metadata
from typing import Any
from uuid import UUID, uuid4

from psycopg.rows import dict_row

from app.python_models.postgres import connect_postgres


TRADING_CARD_ID = "card_trading_workbench"
TRADE_ACTIONS = ("WAIT", "ENTER", "HOLD", "REDUCE", "EXIT", "PAUSE", "FAIL_SAFE")
JOB_STATES = ("monitoring", "paused", "completed", "fail_safe")
_DIRECTIONS = frozenset({"long", "short"})
_ORDER_TYPES = frozenset({"market", "limit", "stop", "stop_limit"})
_REQUIRED_PLAN_FIELDS = frozenset({
    "instrument", "assetClass", "allowedDirections", "budgetCeilingUsd",
    "maxLossUsd", "expectedRiskReward", "entryConditions", "exitConditions", "stopConditions",
    "invalidationConditions", "horizon", "expiresAt", "allowedOrderTypes",
    "dataRequirements", "executionPolicy", "origin",
})


class TradingRuntimeError(ValueError):
    """Typed fail-closed error from the deterministic trading boundary."""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _text(value: Any, field: str, limit: int = 2_000) -> str:
    if not isinstance(value, str) or not value.strip():
        raise TradingRuntimeError(f"trade_plan_{field}_required")
    result = value.strip()
    if len(result) > limit:
        raise TradingRuntimeError(f"trade_plan_{field}_too_long")
    return result


def _positive_number(value: Any, field: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or value <= 0:
        raise TradingRuntimeError(f"trade_plan_{field}_positive_number_required")
    return float(value)


def _text_list(value: Any, field: str, *, allowed: frozenset[str] | None = None) -> list[str]:
    if not isinstance(value, list) or not value or len(value) > 32:
        raise TradingRuntimeError(f"trade_plan_{field}_nonempty_list_required")
    result = list(dict.fromkeys(_text(item, field, 500).lower() for item in value))
    if allowed is not None and any(item not in allowed for item in result):
        raise TradingRuntimeError(f"trade_plan_{field}_unsupported")
    return result


def normalize_trade_plan(value: Any) -> dict[str, Any]:
    """Validate every execution term; missing or extra terms never get invented."""

    if not isinstance(value, dict):
        raise TradingRuntimeError("trade_plan_object_required")
    missing = sorted(_REQUIRED_PLAN_FIELDS - set(value))
    extra = sorted(set(value) - _REQUIRED_PLAN_FIELDS)
    if missing:
        raise TradingRuntimeError(f"trade_plan_missing_terms:{','.join(missing)}")
    if extra:
        raise TradingRuntimeError(f"trade_plan_unknown_terms:{','.join(extra)}")
    instrument = value["instrument"]
    if not isinstance(instrument, dict) or set(instrument) != {"symbol", "venue"}:
        raise TradingRuntimeError("trade_plan_instrument_invalid")
    origin = value["origin"]
    if not isinstance(origin, dict) or set(origin) != {"kind", "id"}:
        raise TradingRuntimeError("trade_plan_origin_invalid")
    expires_at = _text(value["expiresAt"], "expires_at", 80)
    try:
        parsed_expiry = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
    except ValueError as error:
        raise TradingRuntimeError("trade_plan_expires_at_invalid") from error
    if parsed_expiry.tzinfo is None:
        raise TradingRuntimeError("trade_plan_expires_at_timezone_required")
    budget = _positive_number(value["budgetCeilingUsd"], "budget_ceiling_usd")
    max_loss = _positive_number(value["maxLossUsd"], "max_loss_usd")
    if max_loss > budget:
        raise TradingRuntimeError("trade_plan_max_loss_exceeds_budget")
    return {
        "instrument": {
            "symbol": _text(instrument["symbol"], "instrument_symbol", 32).upper(),
            "venue": _text(instrument["venue"], "instrument_venue", 40).upper(),
        },
        "assetClass": _text(value["assetClass"], "asset_class", 40).lower(),
        "allowedDirections": _text_list(
            value["allowedDirections"], "allowed_directions", allowed=_DIRECTIONS,
        ),
        "budgetCeilingUsd": budget,
        "maxLossUsd": max_loss,
        "expectedRiskReward": _positive_number(
            value["expectedRiskReward"], "expected_risk_reward",
        ),
        "entryConditions": _text_list(value["entryConditions"], "entry_conditions"),
        "exitConditions": _text_list(value["exitConditions"], "exit_conditions"),
        "stopConditions": _text_list(value["stopConditions"], "stop_conditions"),
        "invalidationConditions": _text_list(
            value["invalidationConditions"], "invalidation_conditions",
        ),
        "horizon": _text(value["horizon"], "horizon", 160),
        "expiresAt": parsed_expiry.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
        "allowedOrderTypes": _text_list(
            value["allowedOrderTypes"], "allowed_order_types", allowed=_ORDER_TYPES,
        ),
        "dataRequirements": _text_list(value["dataRequirements"], "data_requirements"),
        "executionPolicy": _text(value["executionPolicy"], "execution_policy", 4_000),
        "origin": {
            "kind": _text(origin["kind"], "origin_kind", 80),
            "id": _text(origin["id"], "origin_id", 160),
        },
    }


def normalize_trading_configuration(value: Any) -> dict[str, Any]:
    """Validate the card-owned slider/select configuration without filling omissions."""

    if not isinstance(value, dict) or set(value) != {"schemaVersion", "trading"}:
        raise TradingRuntimeError("trading_configuration_invalid")
    if value.get("schemaVersion") != "trading.card.v1" or not isinstance(value.get("trading"), dict):
        raise TradingRuntimeError("trading_configuration_schema_invalid")
    settings = value["trading"]
    expected = {
        "paperOnly", "executionApproved", "paperBudgetUsd", "allocationPerJobPercent",
        "maxConcurrentJobs", "maxOpenPositions", "maxPlanLossPercent",
        "maxDailyLossPercent", "minimumConfidencePercent", "minimumRiskReward",
        "evaluationCadenceSeconds", "staleDataSeconds",
    }
    if set(settings) != expected:
        raise TradingRuntimeError("trading_configuration_fields_invalid")
    if settings["paperOnly"] is not True or settings["executionApproved"] is not False:
        raise TradingRuntimeError("trading_execution_must_remain_unapproved_paper_only")
    numeric_ranges = {
        "paperBudgetUsd": (0, 100_000_000),
        "allocationPerJobPercent": (0, 100),
        "maxConcurrentJobs": (1, 50),
        "maxOpenPositions": (0, 50),
        "maxPlanLossPercent": (0, 100),
        "maxDailyLossPercent": (0, 100),
        "minimumConfidencePercent": (0, 100),
        "minimumRiskReward": (0, 20),
        "evaluationCadenceSeconds": (15, 86_400),
        "staleDataSeconds": (15, 86_400),
    }
    normalized: dict[str, Any] = {"paperOnly": True, "executionApproved": False}
    for field, (minimum, maximum) in numeric_ranges.items():
        raw = settings[field]
        if isinstance(raw, bool) or not isinstance(raw, (int, float)) or not minimum <= raw <= maximum:
            raise TradingRuntimeError(f"trading_configuration_{field}_invalid")
        normalized[field] = int(raw) if field in {
            "maxConcurrentJobs", "maxOpenPositions", "evaluationCadenceSeconds", "staleDataSeconds",
        } else float(raw)
    return {"schemaVersion": "trading.card.v1", "trading": normalized}


def validate_plan_against_configuration(
    plan: dict[str, Any], configuration: dict[str, Any], *, active_job_count: int,
) -> None:
    """Apply deterministic portfolio gates before accepting a Trade Job."""

    settings = normalize_trading_configuration(configuration)["trading"]
    if any(settings[field] <= 0 for field in (
        "paperBudgetUsd", "allocationPerJobPercent", "maxOpenPositions",
        "maxPlanLossPercent", "maxDailyLossPercent",
    )):
        raise TradingRuntimeError("trading_risk_configuration_incomplete")
    if active_job_count >= settings["maxConcurrentJobs"]:
        raise TradingRuntimeError("trading_max_concurrent_jobs_reached")
    per_job_budget = settings["paperBudgetUsd"] * settings["allocationPerJobPercent"] / 100
    if plan["budgetCeilingUsd"] > per_job_budget:
        raise TradingRuntimeError("trade_plan_budget_exceeds_card_allocation")
    per_plan_loss = plan["budgetCeilingUsd"] * settings["maxPlanLossPercent"] / 100
    if plan["maxLossUsd"] > per_plan_loss:
        raise TradingRuntimeError("trade_plan_loss_exceeds_card_risk")
    if plan["expectedRiskReward"] < settings["minimumRiskReward"]:
        raise TradingRuntimeError("trade_plan_risk_reward_below_card_minimum")
    expiry = datetime.fromisoformat(str(plan["expiresAt"]).replace("Z", "+00:00"))
    if expiry <= datetime.now(timezone.utc):
        raise TradingRuntimeError("trade_plan_expired")


def deterministic_client_order_id(job_id: str, decision_id: str) -> str:
    """Create a stable future paper-order id without submitting an order."""

    try:
        UUID(job_id)
        UUID(decision_id)
    except (TypeError, ValueError) as error:
        raise TradingRuntimeError("trading_order_identity_invalid") from error
    digest = hashlib.sha256(f"{job_id}:{decision_id}".encode("utf-8")).hexdigest()[:24]
    return f"paper-{digest}"


def lumibot_readiness() -> dict[str, Any]:
    """Read installed Lumibot identity without instantiating a broker or strategy."""

    try:
        version = metadata.version("lumibot")
        from lumibot.strategies.strategy import Strategy  # noqa: PLC0415
        from lumibot.traders.trader import Trader  # noqa: PLC0415
    except (ImportError, metadata.PackageNotFoundError) as error:
        return {
            "status": "dependency_unavailable",
            "version": None,
            "strategyClassAvailable": False,
            "traderClassAvailable": False,
            "paperOnly": True,
            "orderSubmission": "blocked_pending_separate_approval",
            "diagnostics": type(error).__name__,
        }
    return {
        "status": "available",
        "version": version,
        "strategyClassAvailable": isinstance(Strategy, type),
        "traderClassAvailable": isinstance(Trader, type),
        "paperOnly": True,
        "orderSubmission": "blocked_pending_separate_approval",
        "diagnostics": None,
    }


def _current_trading_card(cursor: Any, project_id: str, deck_id: str, card_id: str) -> dict[str, Any]:
    if card_id != TRADING_CARD_ID:
        raise TradingRuntimeError("trading_card_identity_required")
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
        raise TradingRuntimeError("trading_card_not_found")
    if (
        row["runtime_kind"] != "hermes"
        or row["runtime_mode"] != "delegate"
        or not str(row["runtime_profile"] or "").strip()
    ):
        raise TradingRuntimeError("trading_card_hermes_runtime_required")
    result = dict(row)
    extensions = result.get("runtime_extension_config")
    configuration = extensions.get("configuration") if isinstance(extensions, dict) else None
    result["configuration"] = normalize_trading_configuration(configuration)
    return result


def accept_trade_assignment(
    *, project_id: str, deck_id: str, card_id: str, source_run_id: str,
    plan: Any, idempotency_key: str,
) -> dict[str, Any]:
    normalized = normalize_trade_plan(plan)
    key = _text(idempotency_key, "idempotency_key", 160)
    source_run = _text(source_run_id, "source_run_id", 160)
    job_id = str(uuid4())
    with connect_postgres(autocommit=False) as connection:
        with connection.cursor(row_factory=dict_row) as cursor:
            card = _current_trading_card(cursor, project_id, deck_id, card_id)
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
        raise TradingRuntimeError("trading_decision_action_invalid")
    if isinstance(confidence, bool) or not isinstance(confidence, (int, float)) or not 0 <= confidence <= 1:
        raise TradingRuntimeError("trading_decision_confidence_invalid")
    if not isinstance(evidence, list) or len(evidence) > 64 or any(not isinstance(item, dict) for item in evidence):
        raise TradingRuntimeError("trading_decision_evidence_invalid")
    if not isinstance(missing_terms, list) or len(missing_terms) > 32 or any(
        not isinstance(item, str) or not item.strip() for item in missing_terms
    ):
        raise TradingRuntimeError("trading_decision_missing_terms_invalid")
    if normalized_action in {"ENTER", "HOLD", "REDUCE", "EXIT"} and missing_terms:
        raise TradingRuntimeError("trading_decision_missing_terms_fail_closed")
    normalized_job_id = str(UUID(_text(job_id, "job_id", 64)))
    decision_id = str(uuid4())
    key = _text(idempotency_key, "idempotency_key", 160)
    state = {
        "PAUSE": "paused", "FAIL_SAFE": "fail_safe", "EXIT": "completed",
    }.get(normalized_action, "monitoring")
    with connect_postgres(autocommit=False) as connection:
        with connection.cursor(row_factory=dict_row) as cursor:
            _current_trading_card(cursor, project_id, deck_id, card_id)
            cursor.execute(
                """
                SELECT job_id FROM ag_catalog.trading_jobs
                WHERE job_id=%s AND project_id=%s AND deck_id=%s AND card_id=%s
                FOR UPDATE
                """,
                (normalized_job_id, project_id, deck_id, card_id),
            )
            if cursor.fetchone() is None:
                raise TradingRuntimeError("trading_job_not_found")
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
                    decision_id, normalized_job_id, _text(source_run_id, "source_run_id", 160),
                    key, normalized_action, _text(rationale, "rationale", 8_000),
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
    if normalized_action not in {"PAUSE", "EXIT", "FAIL_SAFE"}:
        raise TradingRuntimeError("trading_intervention_action_invalid")
    normalized_job_id = str(UUID(_text(job_id, "job_id", 64)))
    state = {"PAUSE": "paused", "EXIT": "completed", "FAIL_SAFE": "fail_safe"}[normalized_action]
    with connect_postgres(autocommit=False) as connection:
        with connection.cursor(row_factory=dict_row) as cursor:
            _current_trading_card(cursor, project_id, deck_id, card_id)
            cursor.execute(
                """
                UPDATE ag_catalog.trading_jobs
                SET state=%s, current_action=%s, updated_at=NOW()
                WHERE job_id=%s AND project_id=%s AND deck_id=%s AND card_id=%s
                RETURNING *
                """,
                (state, normalized_action, normalized_job_id, project_id, deck_id, card_id),
            )
            row = cursor.fetchone()
            if row is None:
                raise TradingRuntimeError("trading_job_not_found")
            cursor.execute(
                """
                INSERT INTO ag_catalog.trading_interventions
                  (intervention_id, job_id, action, reason, actor)
                VALUES (%s,%s,%s,%s,%s)
                """,
                (
                    str(uuid4()), normalized_job_id, normalized_action,
                    _text(reason, "intervention_reason", 2_000),
                    _text(actor, "intervention_actor", 160),
                ),
            )
        connection.commit()
    return _public_job(dict(row))


def read_trading_state(*, project_id: str, deck_id: str, card_id: str) -> dict[str, Any]:
    with connect_postgres() as connection, connection.cursor(row_factory=dict_row) as cursor:
        _current_trading_card(cursor, project_id, deck_id, card_id)
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
        if jobs:
            cursor.execute(
                """
                SELECT decision.* FROM ag_catalog.trading_decisions AS decision
                WHERE decision.job_id = ANY(%s::uuid[])
                ORDER BY decision.created_at DESC
                """,
                ([str(row["job_id"]) for row in jobs],),
            )
            for row in cursor.fetchall():
                decisions[str(row["job_id"])].append(_public_decision(dict(row)))
    public_jobs = [
        {**_public_job(row), "decisions": decisions.get(str(row["job_id"]), [])}
        for row in jobs
    ]
    realized = [float(row["realized_pnl_usd"]) for row in jobs if row.get("realized_pnl_usd") is not None]
    return {
        "cardId": card_id,
        "paperOnly": True,
        "executionApproved": False,
        "jobs": public_jobs,
        "portfolio": {
            "realizedPnlUsd": sum(realized),
            "wins": len([value for value in realized if value > 0]),
            "losses": len([value for value in realized if value < 0]),
            "flat": len([value for value in realized if value == 0]),
            "closedTrades": len(realized),
        },
        "engine": lumibot_readiness(),
        "observedAt": _now(),
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
