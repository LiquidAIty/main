"""Retained proposal and calculation evidence within Trading."""
# Entity: Trading
# Relationship: Retains authored proposals and specialist work products, reads their accepted job and calculation evidence, and compares hypothetical payoffs and portfolio effects without changing capital, jobs or Hermes sessions.

from __future__ import annotations

import hashlib
import json
from dataclasses import asdict
from datetime import datetime, timezone
from typing import Any
from uuid import UUID, uuid4

from psycopg.rows import dict_row

from app.python_models.postgres import connect_postgres
from app.python_models.trading_contract import TradingBoundaryError, required_trade_text
from app.python_models.trading_jobs import _execution_reference, _lock_card, _public_job
from app.python_models.trading_proposals import economics, invert_terms, parse_proposal, payoff


def identity(value: str) -> str:
    try:
        return str(UUID(value))
    except (ValueError, TypeError, AttributeError):
        raise TradingBoundaryError("trading_evidence_id_invalid") from None


def require_evidence_card(cursor, project_id, deck_id, card_id, operation):
    cursor.execute("""SELECT c.current_revision_id,r.runtime_profile
        FROM ag_catalog.agent_cards c JOIN ag_catalog.agent_card_revisions r ON r.revision_id=c.current_revision_id
        WHERE c.project_id=%s AND c.deck_id=%s AND c.card_id=%s AND r.enabled
          AND r.runtime_kind='hermes' AND r.runtime_mode='delegate'
          AND EXISTS (SELECT 1 FROM ag_catalog.card_capability_grants g
                      WHERE g.revision_id=c.current_revision_id AND g.grant_kind='tool' AND g.grant_id=%s)""",
        (project_id, deck_id, card_id, operation))
    card = cursor.fetchone()
    if not card or not card["runtime_profile"]:
        raise TradingBoundaryError("trading_evidence_saved_card_grant_required")
    return card


def proposal_row(cursor, project_id, deck_id, proposal_id):
    cursor.execute("SELECT * FROM ag_catalog.trading_proposals WHERE project_id=%s AND deck_id=%s AND proposal_id=%s",
                   (project_id, deck_id, identity(proposal_id)))
    row = cursor.fetchone()
    if not row:
        raise TradingBoundaryError("trading_proposal_not_found")
    return row


def public_record(row):
    result = dict(row)
    for name in ("proposal_id", "original_proposal_id", "assessment_id", "entry_id", "decision_id",
                 "project_id", "card_revision_id", "created_at", "job_id"):
        if result.get(name) is not None:
            result[name] = str(result[name])
    for name in ("proposal_ids", "assessment_ids"):
        if name in result:
            result[name] = [str(value) for value in result[name]]
    result.pop("idempotency_key", None)
    return result


def _insert_proposal(cursor, *, project_id, deck_id, card_id, card, execution, key,
                     proposal, original_id=None, inversion_type="original"):
    normalized = proposal.model_dump(mode="json")
    cursor.execute("""SELECT * FROM ag_catalog.trading_proposals
        WHERE project_id=%s AND deck_id=%s AND card_id=%s AND idempotency_key=%s""",
        (project_id, deck_id, card_id, key))
    existing = cursor.fetchone()
    if existing:
        if (existing["proposal"] != normalized or existing["inversion_type"] != inversion_type
                or (str(existing["original_proposal_id"]) if existing["original_proposal_id"] else None) != original_id):
            raise TradingBoundaryError("trading_proposal_idempotency_conflict")
        return public_record(existing)
    cursor.execute("""INSERT INTO ag_catalog.trading_proposals
        (proposal_id,project_id,deck_id,card_id,card_revision_id,source_execution,idempotency_key,
         original_proposal_id,inversion_type,proposal,economics)
        VALUES (%s,%s,%s,%s,%s,%s::jsonb,%s,%s,%s,%s::jsonb,%s::jsonb) RETURNING *""",
        (str(uuid4()), project_id, deck_id, card_id, card["current_revision_id"], json.dumps(execution), key,
         original_id, inversion_type, json.dumps(normalized, allow_nan=False), json.dumps(economics(proposal), allow_nan=False)))
    return public_record(cursor.fetchone())


def record_proposal(*, project_id, deck_id, card_id, source_execution, proposal, idempotency_key):
    parsed = parse_proposal(proposal)
    key = required_trade_text(idempotency_key, "idempotency_key", 160)
    with connect_postgres(autocommit=False) as connection, connection.cursor(row_factory=dict_row) as cursor:
        card = require_evidence_card(cursor, project_id, deck_id, card_id, "trading.record_proposal")
        execution = _execution_reference(source_execution, card["runtime_profile"])
        _lock_card(cursor, project_id, deck_id, card_id)
        result = _insert_proposal(cursor, project_id=project_id, deck_id=deck_id, card_id=card_id,
                                  card=card, execution=execution, key=key, proposal=parsed)
        connection.commit()
        return result


def invert_proposal(*, project_id, deck_id, card_id, source_execution, proposal_id, alternative=None):
    with connect_postgres(autocommit=False) as connection, connection.cursor(row_factory=dict_row) as cursor:
        card = require_evidence_card(cursor, project_id, deck_id, card_id, "trading.invert_proposal")
        execution = _execution_reference(source_execution, card["runtime_profile"])
        _lock_card(cursor, project_id, deck_id, card_id)
        original = proposal_row(cursor, project_id, deck_id, proposal_id)
        proposal_id = str(original["proposal_id"])
        if original["original_proposal_id"]:
            raise TradingBoundaryError("trading_inversion_requires_original_proposal")
        terms = invert_terms(parse_proposal(original["proposal"]), parse_proposal(alternative) if alternative is not None else None)
        saved = {}
        for name in ("exact_counterparty", "opposing_direction"):
            item = terms[name]
            if item is None:
                saved[name] = None
                continue
            digest = hashlib.sha256(json.dumps(item["proposal"], sort_keys=True).encode()).hexdigest()
            saved[name] = _insert_proposal(cursor, project_id=project_id, deck_id=deck_id, card_id=card_id,
                card=card, execution=execution, key=f"inverse:{proposal_id}:{item['inversion_type']}:{digest}",
                proposal=parse_proposal(item["proposal"]), original_id=str(original["proposal_id"]),
                inversion_type=item["inversion_type"])
        connection.commit()
        return {"original": public_record(original), **saved, "limitations": terms["limitations"]}


def validate_proposal_ids(cursor, project_id, deck_id, ids, *, candidate_id=None):
    if not isinstance(ids, list) or len(ids) > 8 or any(not isinstance(value, str) for value in ids):
        raise TradingBoundaryError("trading_proposal_references_invalid")
    ids = [identity(value) for value in ids]
    if len(set(ids)) != len(ids):
        raise TradingBoundaryError("trading_proposal_references_invalid")
    rows = [proposal_row(cursor, project_id, deck_id, value) for value in ids]
    candidates = {row["proposal"]["candidate_id"] for row in rows}
    if len(candidates) > 1 or (candidate_id and candidates and candidates != {candidate_id}):
        raise TradingBoundaryError("trading_candidate_reference_mismatch")
    return rows


def validate_receipt_references(cursor, project_id, deck_id, references):
    """Resolve local evidence IDs; external source citations still need semantic verification."""
    if not isinstance(references, list) or len(references) > 64 or any(not isinstance(item, dict) for item in references):
        raise TradingBoundaryError("trading_evidence_references_invalid")
    receipts = []
    for item in references:
        for field, table, column in (
            ("backtestId", "trading_lifecycle_runs", "lifecycle_run_id"),
            ("forecastId", "trading_forecasts", "forecast_id"),
            ("proposalId", "trading_proposals", "proposal_id"),
            ("assessmentId", "trading_assessments", "assessment_id"),
            ("jobId", "trading_jobs", "job_id"),
        ):
            if field not in item:
                continue
            reference = identity(item[field])
            cursor.execute(f"SELECT * FROM ag_catalog.{table} WHERE project_id=%s AND deck_id=%s AND {column}=%s",
                           (project_id, deck_id, reference))
            row = cursor.fetchone()
            if not row or (field == "backtestId" and row["status"] != "completed"):
                raise TradingBoundaryError("trading_evidence_reference_not_found:" + field)
            if field == "backtestId":
                from app.python_models.trading_backtest import _public_backtest
                receipts.append({"kind": "BACKTEST", "receipt": _public_backtest(row)})
            elif field == "forecastId":
                from app.python_models.trading_forecast_store import read_comparisons
                receipts.append({"kind": "FORECAST", "producer_card_id": row["card_id"],
                                 "card_revision_id": str(row["card_revision_id"]), "receipt": row["payload"],
                                 "comparisonHistory": read_comparisons(project_id, deck_id, row["card_id"], reference)})
            elif field == "assessmentId":
                receipts.append({"kind": "ASSESSMENT", "receipt": public_record(row)})
            elif field == "jobId":
                receipts.append({"kind": "TRADE_JOB", "receipt": _public_job(row)})
    return receipts


def record_assessment(*, project_id, deck_id, card_id, source_execution, candidate_id,
                      kind, proposal_ids, content, idempotency_key, _operation="trading.record_assessment"):
    if _operation not in {"trading.record_assessment", "portfolio.optimize"} or (_operation == "portfolio.optimize" and kind != "quant_initial"):
        raise TradingBoundaryError("trading_assessment_operation_invalid")
    if kind not in {"opportunity", "research", "contrarian", "quant_initial", "quant_comparison"}:
        raise TradingBoundaryError("trading_assessment_kind_invalid")
    candidate = required_trade_text(candidate_id, "candidate_id", 160)
    key = required_trade_text(idempotency_key, "idempotency_key", 160)
    # These are explicit submitted work products, not copied chat or hidden reasoning.
    fields = {"summary", "evidence_references", "uncertainty", "recommendation"}
    if (not isinstance(content, dict) or set(content) != fields
            or not isinstance(content["evidence_references"], list) or len(content["evidence_references"]) > 64):
        raise TradingBoundaryError("trading_assessment_content_invalid")
    for field in ("summary", "uncertainty", "recommendation"):
        required_trade_text(content[field], field, 12000)
    try:
        body = json.dumps(content, allow_nan=False)
        if len(body) > 40000:
            raise ValueError()
    except (TypeError, ValueError):
        raise TradingBoundaryError("trading_assessment_content_invalid") from None
    with connect_postgres(autocommit=False) as connection, connection.cursor(row_factory=dict_row) as cursor:
        card = require_evidence_card(cursor, project_id, deck_id, card_id, _operation)
        execution = _execution_reference(source_execution, card["runtime_profile"])
        _lock_card(cursor, project_id, deck_id, card_id)
        rows = validate_proposal_ids(cursor, project_id, deck_id, proposal_ids, candidate_id=candidate)
        validate_receipt_references(cursor, project_id, deck_id, content["evidence_references"])
        if kind in {"contrarian", "quant_comparison"}:
            if len(rows) != 2 or rows[0]["original_proposal_id"] is not None or str(rows[1]["original_proposal_id"]) != str(rows[0]["proposal_id"]):
                raise TradingBoundaryError("trading_assessment_original_opposing_pair_required")
        if kind == "quant_comparison" and content["recommendation"] not in {
            "SUPPORT_ORIGINAL", "SUPPORT_OPPOSING", "REVISE_STRUCTURE", "INSUFFICIENT_EVIDENCE", "WAIT"}:
            raise TradingBoundaryError("trading_quant_recommendation_invalid")
        cursor.execute("""SELECT * FROM ag_catalog.trading_assessments
            WHERE project_id=%s AND deck_id=%s AND card_id=%s AND idempotency_key=%s""",
            (project_id, deck_id, card_id, key))
        existing = cursor.fetchone()
        if existing:
            if (existing["candidate_id"] != candidate or existing["kind"] != kind or existing["content"] != content
                    or [str(value) for value in existing["proposal_ids"]] != [identity(value) for value in proposal_ids]):
                raise TradingBoundaryError("trading_assessment_idempotency_conflict")
            return public_record(existing)
        cursor.execute("""INSERT INTO ag_catalog.trading_assessments
            (assessment_id,project_id,deck_id,card_id,card_revision_id,source_execution,idempotency_key,
             candidate_id,kind,proposal_ids,content) VALUES (%s,%s,%s,%s,%s,%s::jsonb,%s,%s,%s,%s::uuid[],%s::jsonb) RETURNING *""",
            (str(uuid4()), project_id, deck_id, card_id, card["current_revision_id"], json.dumps(execution), key,
             candidate, kind, proposal_ids, body))
        result = public_record(cursor.fetchone())
        connection.commit()
        return result


def read_evidence(*, project_id, deck_id, card_id, proposal_id=None, decision_id=None,
                  assessment_id=None, job_id=None, forecast_id=None, candidate_id=None, underlying=None,
                  asset_class=None, limit=50, offset=0):
    book = bool(candidate_id or underlying)
    if sum(map(bool, (proposal_id, decision_id, assessment_id, job_id, forecast_id, book))) != 1:
        raise TradingBoundaryError("trading_evidence_choose_one_source")
    if asset_class not in {None, "equity", "option", "future", "forex", "crypto", "prediction_market"}:
        raise TradingBoundaryError("trading_evidence_asset_class_invalid")
    if asset_class and not book:
        raise TradingBoundaryError("trading_evidence_asset_filter_requires_candidate_search")
    if type(limit) is not int or not 1 <= limit <= 100 or type(offset) is not int or not 0 <= offset <= 10000:
        raise TradingBoundaryError("trading_evidence_page_invalid")
    with connect_postgres() as connection, connection.cursor(row_factory=dict_row) as cursor:
        require_evidence_card(cursor, project_id, deck_id, card_id, "trading.read_evidence")
        if forecast_id:
            return {"receipts": validate_receipt_references(cursor, project_id, deck_id, [{"forecastId": forecast_id}])}
        if assessment_id:
            cursor.execute("""SELECT * FROM ag_catalog.trading_assessments
                WHERE project_id=%s AND deck_id=%s AND assessment_id=%s""",
                (project_id, deck_id, identity(assessment_id)))
            row = cursor.fetchone()
            if not row:
                raise TradingBoundaryError("trading_assessment_not_found")
            return {"assessment": public_record(row), "receipts": validate_receipt_references(
                cursor, project_id, deck_id, row["content"].get("evidence_references", []))}
        if decision_id:
            cursor.execute("""SELECT * FROM ag_catalog.trading_decisions
                WHERE project_id=%s AND deck_id=%s AND decision_id=%s""",
                (project_id, deck_id, identity(decision_id)))
            row = cursor.fetchone()
            if not row:
                raise TradingBoundaryError("trading_decision_not_found")
            return {"decision": public_record(row),
                    "receipts": validate_receipt_references(cursor, project_id, deck_id, row["evidence"]),
                    "note": "A recorded decision is not a broker execution or a journal."}
        if job_id:
            cursor.execute("SELECT * FROM ag_catalog.trading_jobs WHERE project_id=%s AND deck_id=%s AND job_id=%s",
                           (project_id, deck_id, identity(job_id)))
            row = cursor.fetchone()
            if not row:
                raise TradingBoundaryError("trading_job_not_found")
            cursor.execute("""SELECT * FROM ag_catalog.trading_decisions
                WHERE project_id=%s AND deck_id=%s AND card_id=%s AND job_id=%s
                ORDER BY created_at,decision_id LIMIT %s OFFSET %s""",
                (project_id, deck_id, row["card_id"], row["job_id"], limit + 1, offset))
            decisions = [public_record(item) for item in cursor.fetchall()]
            return {"job": _public_job(row), "related_decisions": decisions[:limit],
                    "next_offset": offset + limit if len(decisions) > limit else None,
                    "exhaustive": len(decisions) <= limit}
        if book:
            candidate = required_trade_text(candidate_id, "candidate_id", 160) if candidate_id else None
            symbol = required_trade_text(underlying, "underlying", 80) if underlying else None
            cursor.execute("""SELECT * FROM ag_catalog.trading_proposals
                WHERE project_id=%s AND deck_id=%s
                  AND (%s::text IS NULL OR proposal->>'candidate_id'=%s)
                  AND (%s::text IS NULL OR UPPER(proposal->>'underlying')=UPPER(%s))
                  AND (%s::text IS NULL OR proposal->>'asset_class'=%s)
                ORDER BY created_at DESC,proposal_id DESC LIMIT %s OFFSET %s""",
                (project_id, deck_id, candidate, candidate, symbol, symbol, asset_class, asset_class, limit + 1, offset))
            rows = cursor.fetchall()
            now = datetime.now(timezone.utc)
            proposals = []
            for row in rows[:limit]:
                record = public_record(row)
                terms = parse_proposal(record["proposal"])
                record["refresh"] = {"checkedAt": now.isoformat(),
                    "quoteAgeSeconds": max(0, (now - terms.quote.observed_at).total_seconds()) if terms.quote else None,
                    "horizonElapsed": terms.horizon_end <= now,
                    "contractExpired": terms.option.expiration <= now if terms.option else None,
                    "requiresCurrentQuoteBeforeDecision": True}
                proposals.append(record)
            return {"proposals": proposals, "next_offset": offset + limit if len(rows) > limit else None,
                    "exhaustive": len(rows) <= limit, "note": "Retained terms and sources, not refreshed market quotes or orders."}
        original = proposal_row(cursor, project_id, deck_id, proposal_id)
        root = str(original["original_proposal_id"] or original["proposal_id"])
        cursor.execute("""SELECT * FROM ag_catalog.trading_proposals WHERE project_id=%s AND deck_id=%s
            AND (proposal_id=%s OR original_proposal_id=%s)
            ORDER BY created_at,proposal_id LIMIT %s OFFSET %s""",
            (project_id, deck_id, root, root, limit + 1, offset))
        proposals = [public_record(row) for row in cursor.fetchall()]
        cursor.execute("""SELECT * FROM ag_catalog.trading_assessments WHERE project_id=%s AND deck_id=%s
            AND candidate_id=%s AND proposal_ids <@ ARRAY(
                SELECT proposal_id FROM ag_catalog.trading_proposals WHERE project_id=%s AND deck_id=%s
                  AND (proposal_id=%s OR original_proposal_id=%s))
            ORDER BY created_at,assessment_id LIMIT %s OFFSET %s""",
            (project_id, deck_id, original["proposal"]["candidate_id"],
             project_id, deck_id, root, root, limit + 1, offset))
        assessments = [public_record(row) for row in cursor.fetchall()]
        references = [item for row in assessments[:limit] for item in row["content"].get("evidence_references", [])]
        references = list({json.dumps(item, sort_keys=True): item for item in references}.values())
        more = len(proposals) > limit or len(assessments) > limit
        return {"proposals": proposals[:limit], "assessments": assessments[:limit],
                "receipts": validate_receipt_references(cursor, project_id, deck_id, references[:64]),
                "receipt_reference_count": len(references), "receipts_complete": len(references) <= 64,
                "next_offset": offset + limit if more else None, "exhaustive": not more,
                "note": "Proposal and calculation evidence, not agent memory, a journal or confirmed broker fills."}


def compare_scenarios(*, project_id, deck_id, card_id, original_id, opposing_id, underlying_prices,
                      portfolio_card_id=None, allocation_lane=None):
    if not isinstance(underlying_prices, list) or not 1 <= len(underlying_prices) <= 20:
        raise TradingBoundaryError("trading_scenario_count_invalid")
    if bool(portfolio_card_id) != bool(allocation_lane):
        raise TradingBoundaryError("trading_comparison_portfolio_and_lane_required_together")
    with connect_postgres() as connection, connection.cursor(row_factory=dict_row) as cursor:
        require_evidence_card(cursor, project_id, deck_id, card_id, "trading.compare_proposals")
        a, b = validate_proposal_ids(cursor, project_id, deck_id, [original_id, opposing_id])
        if a["original_proposal_id"] or str(b["original_proposal_id"]) != str(a["proposal_id"]):
            raise TradingBoundaryError("trading_comparison_pair_required")
        original, opposite = parse_proposal(a["proposal"]), parse_proposal(b["proposal"])
        if original.option and opposite.option and original.option.expiration != opposite.option.expiration:
            raise TradingBoundaryError("trading_expiry_comparison_mismatch")
        result = {"kind": "SHADOW", "original_proposal_id": str(a["proposal_id"]),
                "opposing_proposal_id": str(b["proposal_id"]), "information_cutoff": a["proposal"]["information_cutoff"],
                "horizon_end": a["proposal"]["horizon_end"], "execution_authorized": False,
                "scenarios": [{"underlying_price": price, "original": payoff(original, price),
                               "opposing": payoff(opposite, price)} for price in underlying_prices],
                "limitations": ["Hypothetical prices supplied by the caller, not measured outcomes or a strategy backtest.",
                                "Equal quantities need not imply equal capital at risk. Unbounded risk cannot be normalized to a finite maximum loss."]}
    if portfolio_card_id:
        from app.python_models.trading_jobs import read_portfolio_context
        from app.python_models.portfolio_policy import proposal_portfolio_effect
        portfolio = read_portfolio_context(project_id=project_id, deck_id=deck_id, card_id=portfolio_card_id)
        result["portfolio"] = {"snapshot": portfolio,
            "original": proposal_portfolio_effect(original, economics(original), portfolio, allocation_lane),
            "opposing": proposal_portfolio_effect(opposite, economics(opposite), portfolio, allocation_lane),
            "wait": {"action": "WAIT", "incrementalCapitalUsd": 0, "incrementalTradePnlUsd": 0,
                     "holdingsUnchanged": True, "note": "Existing holdings retain their risks and returns; no cash yield assumed."}}
    else:
        result["portfolio"] = {"status": "not_evaluated", "reason": "Supply the saved portfolio Card and explicit Allocation Lane."}
    return result


def _observe_equity_pair(original, opposite):
    """One later completed daily observation, never a simulated entry/exit fill."""
    from app.python_models.alpaca_market_data import AlpacaInstrumentRef, get_historical_bars
    from app.python_models.trading_forecast import _bar_windows, _timestamp, _valid_bar
    import pandas as pd

    now = _timestamp(datetime.now(timezone.utc).isoformat())
    horizon = _timestamp(original.horizon_end.isoformat())
    if horizon > now:
        return {"kind": "SHADOW", "status": "pending", "reason": "Proposal horizon has not elapsed."}
    if any(item.asset_class != "equity" or item.market != "US" or item.instrument_identifier != item.underlying
           for item in (original, opposite)):
        return {"kind": "SHADOW", "status": "unavailable", "reason": "Observed outcome currently supports US equity proposals only; no option valuation inferred from stock prices."}
    windows = [(start, end) for start, end in _bar_windows(horizon - pd.Timedelta(days=10), horizon, "1Day")
               if end <= horizon and end <= now and end > _timestamp(original.information_cutoff.isoformat())]
    if not windows:
        return {"kind": "SHADOW", "status": "incomplete", "reason": "No subsequent completed daily session fits this horizon."}
    expected, complete_at = windows[-1]
    history = get_historical_bars(AlpacaInstrumentRef(symbol=original.underlying), "1Day",
        start=expected.isoformat(), end=(expected + pd.Timedelta(days=1)).isoformat(), limit=10, feed="iex")
    if history.status != "available" or history.truncated:
        return {"kind": "SHADOW", "status": "incomplete", "provider_status": history.status,
                "fetched_at": history.fetchedAt, "reason": "The required complete observation was unavailable."}
    matches = [asdict(bar) for bar in history.bars if _timestamp(bar.timestamp) == expected and _valid_bar(asdict(bar))]
    if len(matches) != 1:
        return {"kind": "SHADOW", "status": "incomplete", "reason": "Expected daily bar missing or duplicated; no older bar substituted."}
    bar = matches[0]
    return {"kind": "SHADOW", "status": "observed", "provider": history.provider, "feed": history.feed,
            "fetched_at": history.fetchedAt, "bar": bar, "bar_complete_at": complete_at.isoformat(),
            "information_cutoff": original.information_cutoff.isoformat(), "horizon_end": original.horizon_end.isoformat(),
            "original": payoff(original, bar["close"]), "opposing": payoff(opposite, bar["close"]),
            "limitations": ["Later raw IEX daily close, not confirmed fills or portfolio earnings.",
                            "Assumes entry at each supplied quote and holding to the observation; does not test conditional entries, stops or path-dependent exits.",
                            "No corporate-action, dividend, financing or historical-vintage correction; costs remain the supplied assumptions."]}


def observe_proposals(*, project_id, deck_id, card_id, source_execution, original_id, opposing_id, idempotency_key):
    key = required_trade_text(idempotency_key, "idempotency_key", 160)
    ids = [identity(original_id), identity(opposing_id)]
    with connect_postgres(autocommit=False) as connection, connection.cursor(row_factory=dict_row) as cursor:
        card = require_evidence_card(cursor, project_id, deck_id, card_id, "trading.observe_proposals")
        execution = _execution_reference(source_execution, card["runtime_profile"])
        _lock_card(cursor, project_id, deck_id, card_id)
        a, b = validate_proposal_ids(cursor, project_id, deck_id, ids)
        if a["original_proposal_id"] or str(b["original_proposal_id"]) != ids[0]:
            raise TradingBoundaryError("trading_comparison_pair_required")
        cursor.execute("""SELECT * FROM ag_catalog.trading_assessments
            WHERE project_id=%s AND deck_id=%s AND card_id=%s AND idempotency_key=%s""",
            (project_id, deck_id, card_id, key))
        previous = cursor.fetchone()
        if previous:
            if previous["kind"] != "shadow_outcome" or [str(item) for item in previous["proposal_ids"]] != ids:
                raise TradingBoundaryError("trading_observation_idempotency_conflict")
            return public_record(previous)
        result = _observe_equity_pair(parse_proposal(a["proposal"]), parse_proposal(b["proposal"]))
        if result["status"] != "observed":
            return result  # Pending/failed reads do not become completed outcome records.
        cursor.execute("""INSERT INTO ag_catalog.trading_assessments
            (assessment_id,project_id,deck_id,card_id,card_revision_id,source_execution,idempotency_key,
             candidate_id,kind,proposal_ids,content) VALUES (%s,%s,%s,%s,%s,%s::jsonb,%s,%s,'shadow_outcome',%s::uuid[],%s::jsonb) RETURNING *""",
            (str(uuid4()), project_id, deck_id, card_id, card["current_revision_id"], json.dumps(execution), key,
             a["proposal"]["candidate_id"], ids, json.dumps(result, allow_nan=False)))
        saved = public_record(cursor.fetchone())
        connection.commit()
        return saved
