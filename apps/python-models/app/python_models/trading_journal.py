"""Intentional append-only Markdown narratives linked to Trading decisions."""
# Entity: Trading
# Relationship: Preserves Trader's original narratives and broker evidence, stores on-demand Learner reviews linked to existing proposals, jobs or decisions, and renders Markdown without rewriting accounting or agent history.

from __future__ import annotations

import json
from uuid import uuid4

from psycopg.rows import dict_row

from app.python_models.postgres import connect_postgres
from app.python_models.trading_contract import TradingBoundaryError, required_trade_text
from app.python_models.trading_evidence import (
    identity, public_record, require_evidence_card, validate_proposal_ids, validate_receipt_references,
)
from app.python_models.trading_jobs import _execution_reference, _lock_card


def _review(value):
    required = {"contributing_cards", "observed_outcomes", "supported_findings", "contradictions",
                "decision_quality", "repeated_patterns", "proposed_job_specific_lessons",
                "evidence_references", "uncertainty"}
    if not isinstance(value, dict) or not required.issubset(value) or set(value) - required - {"supersedes_review_id"}:
        raise TradingBoundaryError("trading_learning_review_fields_invalid")
    if value.get("supersedes_review_id") is not None:
        identity(value["supersedes_review_id"])
    for field in required - {"decision_quality", "uncertainty"}:
        if not isinstance(value[field], list) or len(value[field]) > 64:
            raise TradingBoundaryError("trading_learning_review_list_invalid")
    required_trade_text(value["decision_quality"], "decision_quality", 8000)
    required_trade_text(value["uncertainty"], "uncertainty", 8000)
    if any(not isinstance(item, str) or not item.strip() or len(item) > 160 for item in value["contributing_cards"]):
        raise TradingBoundaryError("trading_learning_contributing_card_invalid")
    # Evidence-backed proposals for each job, never a write into another agent's memory.
    for item in value["proposed_job_specific_lessons"]:
        if not isinstance(item, dict) or set(item) != {"card_id", "lesson", "evidence_references", "confidence"}:
            raise TradingBoundaryError("trading_learning_lesson_invalid")
        required_trade_text(item["card_id"], "card_id", 160)
        if item["card_id"] not in value["contributing_cards"]:
            raise TradingBoundaryError("trading_learning_lesson_contributor_required")
        required_trade_text(item["lesson"], "lesson", 4000)
        if (not isinstance(item["evidence_references"], list) or not item["evidence_references"]
                or isinstance(item["confidence"], bool) or not isinstance(item["confidence"], (float, int))
                or not 0 <= item["confidence"] <= 1):
            raise TradingBoundaryError("trading_learning_lesson_evidence_required")
    return value


def append_journal(*, project_id, deck_id, card_id, source_execution, decision_id, phase,
                   markdown, proposal_ids, assessment_ids, evidence, idempotency_key, review=None,
                   outcome_entry_id=None, job_id=None, review_entry_id=None, _broker_outcome=None):
    if phase not in {"BEFORE", "DURING", "AFTER", "CORRECTION", "REVIEW"}:
        raise TradingBoundaryError("trading_journal_phase_invalid")
    if (phase == "REVIEW") != (review is not None):
        raise TradingBoundaryError("trading_journal_review_required")
    body = required_trade_text(markdown, "journal_markdown", 30000)
    key = required_trade_text(idempotency_key, "idempotency_key", 160)
    decision_id = identity(decision_id) if decision_id is not None else None
    job_id = identity(job_id) if job_id is not None else None
    review_entry_id = identity(review_entry_id) if review_entry_id is not None else None
    if review_entry_id is not None and phase != "REVIEW":
        raise TradingBoundaryError("trading_review_identity_requires_review_phase")
    if decision_id is None and phase != "REVIEW":
        raise TradingBoundaryError("trading_journal_decision_required")
    if job_id is not None and (phase != "REVIEW" or decision_id is not None):
        raise TradingBoundaryError("trading_review_choose_job_or_decision")
    if (not isinstance(assessment_ids, list) or len(assessment_ids) > 32
            or any(not isinstance(item, str) for item in assessment_ids) or len(set(assessment_ids)) != len(assessment_ids)):
        raise TradingBoundaryError("trading_journal_assessment_references_invalid")
    assessment_ids = [identity(item) for item in assessment_ids]
    if not isinstance(evidence, list) or len(evidence) > 64 or any(not isinstance(item, dict) for item in evidence):
        raise TradingBoundaryError("trading_journal_evidence_invalid")
    if any("brokerOutcome" in item for item in evidence):
        raise TradingBoundaryError("trading_broker_outcome_requires_reconciliation")
    if job_id is not None:
        evidence = [item for item in evidence if item != {"jobId": job_id}] + [{"jobId": job_id}]
    if phase == "REVIEW":
        references = {identity(item["outcomeEntryId"]) for item in evidence if "outcomeEntryId" in item}
        if outcome_entry_id is not None:
            references.add(identity(outcome_entry_id))
        if len(references) > 1:
            raise TradingBoundaryError("trading_review_one_outcome_required")
        outcome_entry_id = next(iter(references), None)
    if _broker_outcome is not None:
        if (phase != "AFTER" or review is not None or not isinstance(_broker_outcome, dict)
                or _broker_outcome.get("authority") != "alpaca-paper-order-reconciliation"
                or _broker_outcome.get("status") != "closed"):
            raise TradingBoundaryError("trading_outcome_after_phase_required")
        evidence = [*evidence, {"brokerOutcome": _broker_outcome}]
    if outcome_entry_id is not None:
        if phase != "REVIEW" or decision_id is None:
            raise TradingBoundaryError("trading_outcome_review_phase_required")
        outcome_entry_id = identity(outcome_entry_id)
        evidence = [item for item in evidence if "outcomeEntryId" not in item] + [{"outcomeEntryId": outcome_entry_id}]
    if len(evidence) > 64:
        raise TradingBoundaryError("trading_journal_evidence_invalid")
    if review is not None:
        _review(review)
    try:
        evidence_json, review_json = json.dumps(evidence, allow_nan=False), json.dumps(review, allow_nan=False)
        if len(evidence_json) + len(review_json) > 60000:
            raise ValueError()
    except (TypeError, ValueError):
        raise TradingBoundaryError("trading_journal_evidence_invalid") from None
    operation = ("trading.record_outcome" if _broker_outcome is not None else
                 "trading.record_review" if phase == "REVIEW" else "trading.append_journal")
    with connect_postgres(autocommit=False) as connection, connection.cursor(row_factory=dict_row) as cursor:
        card = require_evidence_card(cursor, project_id, deck_id, card_id, operation)
        execution = _execution_reference(source_execution, card["runtime_profile"])
        _lock_card(cursor, project_id, deck_id, card_id)
        # All authors serialize against the SAME decision, not their separate profiles.
        decision = None
        if decision_id is not None:
            cursor.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s,0))", ("journal:" + decision_id,))
            cursor.execute("SELECT * FROM ag_catalog.trading_decisions WHERE project_id=%s AND deck_id=%s AND decision_id=%s",
                           (project_id, deck_id, decision_id))
            decision = cursor.fetchone()
            if not decision:
                raise TradingBoundaryError("trading_journal_decision_not_found")
        if phase != "REVIEW" and decision["card_id"] != card_id:
            raise TradingBoundaryError("trading_journal_decision_owner_required")
        cursor.execute("""SELECT * FROM ag_catalog.trading_journal_entries
            WHERE project_id=%s AND deck_id=%s AND card_id=%s AND idempotency_key=%s""",
            (project_id, deck_id, card_id, key))
        existing = cursor.fetchone()
        if review_entry_id is not None:
            cursor.execute("""SELECT * FROM ag_catalog.trading_journal_entries
                WHERE project_id=%s AND deck_id=%s AND card_id=%s AND entry_id=%s AND phase='REVIEW'""",
                (project_id, deck_id, card_id, review_entry_id))
            identified_review = cursor.fetchone()
            if not identified_review:
                raise TradingBoundaryError("trading_owned_review_not_found")
            if existing and str(existing["entry_id"]) != review_entry_id:
                raise TradingBoundaryError("trading_journal_idempotency_conflict")
            existing = identified_review
        rows = validate_proposal_ids(cursor, project_id, deck_id, proposal_ids)
        proposal_ids = [str(row["proposal_id"]) for row in rows]
        if decision is None and not rows and job_id is None:
            raise TradingBoundaryError("trading_review_existing_subject_required")
        if existing:
            expected = {"decision_id": decision_id, "phase": phase, "markdown": body,
                        "proposal_ids": proposal_ids, "assessment_ids": assessment_ids, "evidence": evidence, "review": review}
            saved = public_record(existing)
            if any(saved[name] != value for name, value in expected.items()):
                raise TradingBoundaryError("trading_journal_idempotency_conflict")
            return {**saved, **({"alreadyReviewed": True} if phase == "REVIEW" else {})}
        if _broker_outcome is not None:
            if not decision["job_id"] or str(decision["job_id"]) != _broker_outcome.get("jobId"):
                raise TradingBoundaryError("trading_outcome_job_mismatch")
            cursor.execute("""SELECT decision_id FROM ag_catalog.trading_decisions
                WHERE project_id=%s AND deck_id=%s AND card_id=%s AND job_id=%s
                  AND action IN ('ENTER','REDUCE','EXIT') ORDER BY created_at,decision_id LIMIT 65""",
                (project_id, deck_id, card_id, decision["job_id"]))
            current_decisions = {str(row["decision_id"]) for row in cursor.fetchall()}
            reconciled_decisions = {item["decisionId"] for item in _broker_outcome["fills"]}
            if current_decisions != reconciled_decisions:
                raise TradingBoundaryError("trading_outcome_decisions_changed_during_reconciliation")
        if outcome_entry_id:
            cursor.execute("""SELECT * FROM ag_catalog.trading_journal_entries
                WHERE project_id=%s AND deck_id=%s AND decision_id=%s AND entry_id=%s AND phase='AFTER'""",
                (project_id, deck_id, decision_id, outcome_entry_id))
            outcome = cursor.fetchone()
            if not outcome or not any(item.get("brokerOutcome", {}).get("status") == "closed"
                                      for item in outcome["evidence"]):
                raise TradingBoundaryError("trading_confirmed_outcome_not_found")
            cursor.execute("""SELECT * FROM ag_catalog.trading_journal_entries
                WHERE project_id=%s AND deck_id=%s AND decision_id=%s AND phase='REVIEW'
                  AND evidence @> %s::jsonb ORDER BY created_at DESC,entry_id DESC LIMIT 1""",
                (project_id, deck_id, decision_id, json.dumps([{"outcomeEntryId": outcome_entry_id}])))
            previous_review = cursor.fetchone()
            supersedes = (review or {}).get("supersedes_review_id")
            if previous_review and not supersedes:
                return {**public_record(previous_review), "alreadyReviewed": True}
            if supersedes and (not previous_review or str(previous_review["entry_id"]) != identity(supersedes)
                               or previous_review["card_id"] != card_id):
                raise TradingBoundaryError("trading_review_correction_must_reference_own_latest_review")
        elif (review or {}).get("supersedes_review_id"):
            raise TradingBoundaryError("trading_review_correction_outcome_required")
        validate_receipt_references(cursor, project_id, deck_id, evidence)
        if review is not None:
            for contributor in review["contributing_cards"]:
                cursor.execute("SELECT 1 FROM ag_catalog.agent_cards WHERE project_id=%s AND deck_id=%s AND card_id=%s",
                               (project_id, deck_id, contributor))
                if cursor.fetchone() is None:
                    raise TradingBoundaryError("trading_learning_contributor_not_in_project")
            validate_receipt_references(cursor, project_id, deck_id, review["evidence_references"])
            for lesson in review["proposed_job_specific_lessons"]:
                validate_receipt_references(cursor, project_id, deck_id, lesson["evidence_references"])
        cursor.execute("""SELECT * FROM ag_catalog.trading_journal_entries
            WHERE decision_id=%s AND phase='BEFORE'""", (decision_id,))
        before = cursor.fetchone()
        if phase == "BEFORE":
            if before:
                raise TradingBoundaryError("trading_journal_before_already_exists_append_correction")
            research_wait = not rows and decision["job_id"] is None and decision["action"] in {"WAIT", "PAUSE", "FAIL_SAFE"}
            if not research_wait and (len(rows) != 2 or rows[0]["original_proposal_id"] or str(rows[1]["original_proposal_id"]) != str(rows[0]["proposal_id"])):
                raise TradingBoundaryError("trading_journal_original_opposing_pair_required")
        elif not before and phase != "REVIEW":
            raise TradingBoundaryError("trading_journal_before_required")
        elif before and proposal_ids != [str(item) for item in before["proposal_ids"]]:
            raise TradingBoundaryError("trading_journal_original_pair_must_remain")
        for reference in assessment_ids:
            cursor.execute("""SELECT candidate_id,proposal_ids FROM ag_catalog.trading_assessments
                WHERE project_id=%s AND deck_id=%s AND assessment_id=%s""", (project_id, deck_id, reference))
            assessment = cursor.fetchone()
            cited_assessments = {item.get("assessmentId") for item in decision["evidence"]} if decision else set()
            if not assessment or (rows and assessment["candidate_id"] != rows[0]["proposal"]["candidate_id"]) or (decision and not rows and reference not in cited_assessments):
                raise TradingBoundaryError("trading_journal_assessment_not_found")
            if not {str(item) for item in assessment["proposal_ids"]}.issubset(proposal_ids):
                raise TradingBoundaryError("trading_journal_assessment_pair_mismatch")
        cursor.execute("""INSERT INTO ag_catalog.trading_journal_entries
            (entry_id,project_id,deck_id,card_id,card_revision_id,source_execution,idempotency_key,
             decision_id,phase,markdown,proposal_ids,assessment_ids,evidence,review)
            VALUES (%s,%s,%s,%s,%s,%s::jsonb,%s,%s,%s,%s,%s::uuid[],%s::uuid[],%s::jsonb,%s::jsonb) RETURNING *""",
            (str(uuid4()), project_id, deck_id, card_id, card["current_revision_id"], json.dumps(execution), key,
             decision_id, phase, body, proposal_ids, assessment_ids, evidence_json, review_json if review is not None else None))
        result = public_record(cursor.fetchone())
        connection.commit()
        return result


def read_journal_entries(cursor, project_id, deck_id, decision_ids):
    """Existing Journal surface: bounded dated narrative, no broker or model call."""
    if not decision_ids:
        return []
    cursor.execute("""SELECT * FROM ag_catalog.trading_journal_entries
        WHERE project_id=%s AND deck_id=%s AND decision_id=ANY(%s::uuid[])
        ORDER BY (phase='BEFORE') DESC,created_at DESC,entry_id DESC LIMIT 200""", (project_id, deck_id, decision_ids))
    return [public_record(row) for row in cursor.fetchall()]


def journal_markdown(entries):
    return "\n\n".join(
        f"## {entry['phase']} — {entry['created_at']}\n\n"
        f"Author: {entry['card_id']} · Entry: {entry['entry_id']}\n\n{entry['markdown']}"
        for entry in entries)


def outcome_performance(cursor, project_id, deck_id, card_id):
    """Separate reconciled paper closures from simulations and account equity changes."""
    cursor.execute("""SELECT j.entry_id,j.created_at,e.value->'brokerOutcome' AS outcome
        FROM ag_catalog.trading_journal_entries j
        JOIN ag_catalog.trading_decisions d ON d.decision_id=j.decision_id
        CROSS JOIN LATERAL jsonb_array_elements(j.evidence) e(value)
        WHERE j.project_id=%s AND j.deck_id=%s AND d.project_id=j.project_id AND d.deck_id=j.deck_id
          AND d.card_id=%s AND j.phase='AFTER'
          AND e.value->'brokerOutcome'->>'authority'='alpaca-paper-order-reconciliation'
          AND e.value->'brokerOutcome'->>'status'='closed'
        ORDER BY j.created_at DESC,j.entry_id DESC LIMIT 501""", (project_id, deck_id, card_id))
    records = cursor.fetchall()
    outcomes = {}
    for row in records[:500]:
        value = row["outcome"]
        outcomes.setdefault(value["jobId"], {**value, "outcomeEntryId": str(row["entry_id"])})
    rows = sorted(outcomes.values(), key=lambda row: (row["closedAt"], row["jobId"]))

    def summary(items):
        gross = [float(item["grossPnlUsd"]) for item in items]
        net = [float(item["netPnlUsd"]) for item in items if item.get("netPnlUsd") is not None]
        cumulative = peak = drawdown = 0.0
        for value in gross:
            cumulative += value
            peak = max(peak, cumulative)
            drawdown = max(drawdown, peak - cumulative)
        return {"closures": len(items), "grossPnlUsd": sum(gross) if gross else None,
            "grossPositive": sum(value > 0 for value in gross), "grossNegative": sum(value < 0 for value in gross),
            "grossFlat": sum(value == 0 for value in gross), "netKnown": len(net),
            "netPnlUsd": sum(net) if len(net) == len(items) and net else None,
            "netWins": sum(value > 0 for value in net), "netLosses": sum(value < 0 for value in net),
            "closedOutcomeGrossDrawdownUsd": drawdown if gross else None}

    groups = {}
    for key in ("allocationLane", "strategy", "market", "sector"):
        buckets = {}
        for row in rows:
            label = (row.get("classification") or {}).get(key) or "Unclassified"
            buckets.setdefault(label, []).append(row)
        groups[key] = [{"label": label, **summary(items)} for label, items in sorted(buckets.items())]
    participation = {}
    for row in rows:
        for contributor in set((row.get("classification") or {}).get("contributingCards", [])):
            participation[contributor] = participation.get(contributor, 0) + 1
    titles = {}
    if participation:
        cursor.execute("""SELECT c.card_id,r.title FROM ag_catalog.agent_cards c
            JOIN ag_catalog.agent_card_revisions r ON r.revision_id=c.current_revision_id
            WHERE c.project_id=%s AND c.deck_id=%s AND c.card_id=ANY(%s::text[])""",
            (project_id, deck_id, list(participation)))
        titles = {row["card_id"]: row["title"] for row in cursor.fetchall()}
    return {"kind": "PAPER", "summary": summary(rows), "groups": groups,
        "participation": [{"cardId": key, "title": titles.get(key, "Retired contributor"), "reviewedTrailCount": value}
                          for key, value in sorted(participation.items())],
        "outcomeEntryIds": [row["outcomeEntryId"] for row in rows], "windowComplete": len(records) <= 500,
        "limitations": ["Gross results exclude unavailable fees/financing; missing net results do not count as net wins or losses.",
            "Closed-outcome gross drawdown is not mark-to-market portfolio drawdown.",
            "Labels are the retained pre-trade classifications; participation is not causal profit attribution.",
            "Backtests, SHADOW observations and account cash-flow changes are excluded."]}
