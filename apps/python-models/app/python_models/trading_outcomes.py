"""Broker-reconciled closing evidence in the existing intentional Trading journal."""
# Entity: Trading
# Relationship: Reconciles exact paper-job order identities on request into immutable journal evidence without submitting orders, inferring fees, triggering reviews, or dispatching agents.

from __future__ import annotations

from datetime import datetime
from decimal import Decimal, InvalidOperation
import json

from psycopg.rows import dict_row

from app.python_models.postgres import connect_postgres
from app.python_models.trading_broker_observation import read_exact_paper_orders
from app.python_models.trading_contract import TradingBoundaryError, deterministic_client_order_id
from app.python_models.trading_evidence import identity, public_record, require_evidence_card
from app.python_models.trading_jobs import _execution_reference
from app.python_models.trading_journal import append_journal


def _positive(value):
    try:
        parsed = Decimal(str(value))
        if not parsed.is_finite() or not 0 < parsed <= Decimal("1e12"):
            raise InvalidOperation()
        return parsed
    except (InvalidOperation, ValueError, TypeError):
        raise TradingBoundaryError("trading_outcome_exact_fill_invalid") from None


def _time(value):
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            raise ValueError()
        return parsed
    except (TypeError, ValueError):
        raise TradingBoundaryError("trading_outcome_fill_time_invalid") from None


def reconcile_orders(snapshot: dict, job: dict, decisions: list[dict], before: dict) -> dict:
    if snapshot.get("status") != "available":
        return {"status": snapshot.get("status", "unavailable"), "reason": snapshot.get("reason")}
    if job["asset_class"] not in {"equity", "stock", "etf"}:
        return {"status": "unavailable", "reason": "Confirmed closure currently requires US-stock order evidence; derivative multipliers/exercise are not inferred."}
    symbol = job["symbol"].upper()
    if any(row.get("instrumentId") == symbol for row in snapshot["positions"]):
        return {"status": "partial_or_open", "reason": "The broker still reports this instrument; no complete closure asserted."}
    expected = {deterministic_client_order_id(str(job["job_id"]), str(row["decision_id"])): row for row in decisions}
    orders = snapshot["orders"]
    if len(orders) != len(expected) or {row["clientOrderId"] for row in orders} != set(expected):
        return {"status": "incomplete", "reason": "Exact job-order identity coverage is incomplete."}
    if len({row["orderId"] for row in orders}) != len(orders):
        raise TradingBoundaryError("trading_outcome_duplicate_broker_order")
    fills = []
    for order in orders:
        decision = expected[order["clientOrderId"]]
        if (order["symbol"] != symbol or order["assetClass"] != "us_equity" or order["hasLegs"]
                or order["status"] != "filled"):
            return {"status": "incomplete", "reason": "Every linked order must be a fully filled single US-stock order; partial, replaced or multi-leg orders need separate reconciliation."}
        quantity, requested, price = (_positive(order[key]) for key in
                                     ("filledQuantityExact", "quantityExact", "averageFillPriceExact"))
        if quantity != requested or order["side"] not in {"buy", "sell"}:
            return {"status": "incomplete", "reason": "Filled quantities or directions do not reconcile."}
        timestamp = _time(order["filledAt"])
        if timestamp < max(_time(decision["created_at"]), _time(before["created_at"])):
            return {"status": "incomplete", "reason": "The required BEFORE reasoning and decision must precede the observed execution."}
        fills.append({"orderId": order["orderId"], "clientOrderId": order["clientOrderId"],
            "decisionId": str(decision["decision_id"]), "action": decision["action"],
            "side": order["side"], "quantity": str(quantity), "averagePrice": str(price),
            "filledAt": timestamp.isoformat()})
    fills.sort(key=lambda row: (_time(row["filledAt"]), row["orderId"]))
    if not fills or fills[0]["action"] != "ENTER" or fills[-1]["action"] != "EXIT":
        return {"status": "incomplete", "reason": "A matched entry and final exit are required."}
    balance, cash_flow = Decimal(0), Decimal(0)
    direction = 1 if fills[0]["side"] == "buy" else -1
    for index, fill in enumerate(fills):
        signed = Decimal(fill["quantity"]) * (1 if fill["side"] == "buy" else -1)
        balance += signed
        cash_flow -= signed * Decimal(fill["averagePrice"])
        if balance * direction < 0 or (balance == 0 and index != len(fills) - 1):
            return {"status": "incomplete", "reason": "Multiple round trips or a direction reversal cannot be treated as one closure."}
    if balance != 0:
        return {"status": "partial_or_open", "reason": "Executed entry and exit quantities do not net to zero."}
    return {"authority": "alpaca-paper-order-reconciliation", "kind": "PAPER", "status": "closed",
        "jobId": str(job["job_id"]), "symbol": symbol, "assetClass": job["asset_class"],
        "accountId": snapshot["accountId"], "closedAt": fills[-1]["filledAt"], "fills": fills,
        "grossPnlUsd": float(cash_flow), "netPnlUsd": None, "feesStatus": "unavailable",
        "limitations": ["Broker cumulative order fills reconciled for these exact job identities, not a separate transaction-lot ledger.",
            "Fees, financing, taxes and cash adjustments were not supplied; gross P&L is not net profit.",
            "No order was submitted and no execution permission was changed."]}


def _review_handoff(cursor, project_id, deck_id, entry):
    if not any(isinstance(item.get("brokerOutcome"), dict)
               and item["brokerOutcome"].get("authority") == "alpaca-paper-order-reconciliation"
               and item["brokerOutcome"].get("status") == "closed" for item in entry["evidence"]):
        raise TradingBoundaryError("trading_confirmed_outcome_not_found")
    decision_id = entry["decision_id"]
    cursor.execute("""SELECT entry_id FROM ag_catalog.trading_journal_entries
        WHERE project_id=%s AND deck_id=%s AND decision_id=%s AND phase='REVIEW'
          AND evidence @> %s::jsonb ORDER BY created_at DESC,entry_id DESC LIMIT 1""",
        (project_id, deck_id, decision_id, json.dumps([{"outcomeEntryId": entry["entry_id"]}])))
    reviewed = cursor.fetchone()
    return {"status": "closed", "outcomeEntryId": entry["entry_id"], "journal": entry,
        "review": {"status": "completed" if reviewed else "pending", "decisionId": decision_id,
                   "outcomeEntryId": entry["entry_id"], "reviewEntryId": str(reviewed["entry_id"]) if reviewed else None},
        "executionAuthorized": False,
        "delivery": ("Trader returns the exact decisionId, outcomeEntryId and review status to Main. "
                     "Main may request an on-demand review through the connected Learner using message_agent. "
                     "This receipt does not trigger a review, and other review cases do not require a closure. "
                     "A repeated receipt is not another trade or learning sample. Hermes Bot Mode owns delivery."),
        "receiptPolicy": "One retained closure per Trade Job; retries read that receipt, not a new broker snapshot. Later corrections must remain explicitly linked to it, never become another trade."}


def record_outcome(*, project_id, deck_id, card_id, source_execution, decision_id):
    decision_id = identity(decision_id)
    with connect_postgres() as connection, connection.cursor(row_factory=dict_row) as cursor:
        card = require_evidence_card(cursor, project_id, deck_id, card_id, "trading.record_outcome")
        _execution_reference(source_execution, card["runtime_profile"])
        cursor.execute("""SELECT * FROM ag_catalog.trading_decisions
            WHERE project_id=%s AND deck_id=%s AND card_id=%s AND decision_id=%s""",
            (project_id, deck_id, card_id, decision_id))
        decision = cursor.fetchone()
        if not decision or not decision["job_id"]:
            raise TradingBoundaryError("trading_outcome_owned_trade_job_required")
        cursor.execute("""SELECT * FROM ag_catalog.trading_jobs
            WHERE project_id=%s AND deck_id=%s AND card_id=%s AND job_id=%s""",
            (project_id, deck_id, card_id, decision["job_id"]))
        job = cursor.fetchone()
        if not job:
            raise TradingBoundaryError("trading_job_not_found")
        closure_key = "closure:" + str(job["job_id"])
        cursor.execute("""SELECT * FROM ag_catalog.trading_journal_entries
            WHERE project_id=%s AND deck_id=%s AND card_id=%s AND idempotency_key=%s AND phase='AFTER'""",
            (project_id, deck_id, card_id, closure_key))
        retained = cursor.fetchone()
        if retained:
            return _review_handoff(cursor, project_id, deck_id, public_record(retained))
        cursor.execute("""SELECT * FROM ag_catalog.trading_journal_entries
            WHERE project_id=%s AND deck_id=%s AND decision_id=%s AND phase='BEFORE'""",
            (project_id, deck_id, decision_id))
        before = cursor.fetchone()
        if not before:
            raise TradingBoundaryError("trading_journal_before_required")
        if not before["proposal_ids"]:
            raise TradingBoundaryError("trading_outcome_original_proposal_required")
        cursor.execute("""SELECT proposal,card_id FROM ag_catalog.trading_proposals
            WHERE project_id=%s AND deck_id=%s AND proposal_id=%s""",
            (project_id, deck_id, before["proposal_ids"][0]))
        original = cursor.fetchone()
        if not original or original["proposal"]["instrument_identifier"].upper() != job["symbol"].upper():
            raise TradingBoundaryError("trading_outcome_journal_instrument_mismatch")
        cursor.execute("""SELECT DISTINCT card_id FROM ag_catalog.trading_assessments
            WHERE project_id=%s AND deck_id=%s AND assessment_id=ANY(%s::uuid[])""",
            (project_id, deck_id, before["assessment_ids"]))
        contributors = sorted({row["card_id"] for row in cursor.fetchall()} | {card_id, original["card_id"]})
        cursor.execute("""SELECT * FROM ag_catalog.trading_decisions
            WHERE project_id=%s AND deck_id=%s AND card_id=%s AND job_id=%s
              AND action IN ('ENTER','REDUCE','EXIT') ORDER BY created_at,decision_id LIMIT 65""",
            (project_id, deck_id, card_id, decision["job_id"]))
        decisions = cursor.fetchall()
    if not decisions or len(decisions) > 64 or not any(row["action"] == "EXIT" for row in decisions):
        return {"status": "pending", "reason": "No bounded entry/exit sequence is available for broker reconciliation."}
    snapshot = read_exact_paper_orders([deterministic_client_order_id(str(job["job_id"]), str(row["decision_id"])) for row in decisions])
    outcome = reconcile_orders(snapshot, job, decisions, before)
    if outcome["status"] != "closed":
        return {**outcome, "executionAuthorized": False, "reviewRequested": False}
    proposal = original["proposal"]
    outcome["classification"] = {"allocationLane": proposal.get("allocation_lane"),
        "strategy": proposal.get("strategy_id"), "market": proposal["market"], "sector": proposal.get("sector"),
        "contributingCards": contributors,
        "note": "Declared pre-trade labels and recorded participation, not causal attribution of profit."}
    try:
        entry = append_journal(project_id=project_id, deck_id=deck_id, card_id=card_id,
            source_execution=source_execution, decision_id=decision_id, phase="AFTER",
            markdown=(f"### Broker-reconciled paper closure: {outcome['symbol']}\n\n"
                      f"Closed: {outcome['closedAt']}\n\nGross P&L: ${outcome['grossPnlUsd']:.2f}. "
                      "Fees and financing are unavailable; net P&L is not established.\n\n"
                      "This is execution evidence, not Trader's retrospective reasoning. Retain the original BEFORE and append interpretation separately."),
            proposal_ids=[str(value) for value in before["proposal_ids"]],
            assessment_ids=[], evidence=[], idempotency_key=closure_key, _broker_outcome=outcome)
    except TradingBoundaryError as error:
        if str(error) != "trading_journal_idempotency_conflict":
            raise
        # A concurrent call may have retained this job's closure after our first read.
        # Do not promote a changed snapshot or a second decision into another outcome.
        with connect_postgres() as connection, connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute("""SELECT * FROM ag_catalog.trading_journal_entries
                WHERE project_id=%s AND deck_id=%s AND card_id=%s AND idempotency_key=%s AND phase='AFTER'""",
                (project_id, deck_id, card_id, closure_key))
            retained = cursor.fetchone()
            if not retained:
                raise
            entry = public_record(retained)
    with connect_postgres() as connection, connection.cursor(row_factory=dict_row) as cursor:
        return _review_handoff(cursor, project_id, deck_id, entry)
