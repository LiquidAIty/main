"""Intentional append-only Markdown narratives linked to Trading decisions."""
# Entity: Trading
# Relationship: Preserves Trader's original BEFORE narrative and dated updates, accepts separately attributed Learner reviews, and renders journal Markdown without rewriting accounting or agent history.

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
    if not isinstance(value, dict) or set(value) != required:
        raise TradingBoundaryError("trading_learning_review_fields_invalid")
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
                   markdown, proposal_ids, assessment_ids, evidence, idempotency_key, review=None):
    if phase not in {"BEFORE", "DURING", "AFTER", "CORRECTION", "REVIEW"}:
        raise TradingBoundaryError("trading_journal_phase_invalid")
    if (phase == "REVIEW") != (review is not None):
        raise TradingBoundaryError("trading_journal_review_required")
    body = required_trade_text(markdown, "journal_markdown", 30000)
    key = required_trade_text(idempotency_key, "idempotency_key", 160)
    decision_id = identity(decision_id)
    if (not isinstance(assessment_ids, list) or len(assessment_ids) > 32
            or any(not isinstance(item, str) for item in assessment_ids) or len(set(assessment_ids)) != len(assessment_ids)):
        raise TradingBoundaryError("trading_journal_assessment_references_invalid")
    assessment_ids = [identity(item) for item in assessment_ids]
    if not isinstance(evidence, list) or len(evidence) > 64 or any(not isinstance(item, dict) for item in evidence):
        raise TradingBoundaryError("trading_journal_evidence_invalid")
    if review is not None:
        _review(review)
    try:
        evidence_json, review_json = json.dumps(evidence, allow_nan=False), json.dumps(review, allow_nan=False)
        if len(evidence_json) + len(review_json) > 60000:
            raise ValueError()
    except (TypeError, ValueError):
        raise TradingBoundaryError("trading_journal_evidence_invalid") from None
    operation = "trading.record_review" if phase == "REVIEW" else "trading.append_journal"
    with connect_postgres(autocommit=False) as connection, connection.cursor(row_factory=dict_row) as cursor:
        card = require_evidence_card(cursor, project_id, deck_id, card_id, operation)
        execution = _execution_reference(source_execution, card["runtime_profile"])
        _lock_card(cursor, project_id, deck_id, card_id)
        # All authors serialize against the SAME decision, not their separate profiles.
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
        rows = validate_proposal_ids(cursor, project_id, deck_id, proposal_ids)
        proposal_ids = [str(row["proposal_id"]) for row in rows]
        if existing:
            expected = {"decision_id": decision_id, "phase": phase, "markdown": body,
                        "proposal_ids": proposal_ids, "assessment_ids": assessment_ids, "evidence": evidence, "review": review}
            saved = public_record(existing)
            if any(saved[name] != value for name, value in expected.items()):
                raise TradingBoundaryError("trading_journal_idempotency_conflict")
            return saved
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
            if len(rows) != 2 or rows[0]["original_proposal_id"] or str(rows[1]["original_proposal_id"]) != str(rows[0]["proposal_id"]):
                raise TradingBoundaryError("trading_journal_original_opposing_pair_required")
        elif not before:
            raise TradingBoundaryError("trading_journal_before_required")
        elif proposal_ids != [str(item) for item in before["proposal_ids"]]:
            raise TradingBoundaryError("trading_journal_original_pair_must_remain")
        for reference in assessment_ids:
            cursor.execute("""SELECT candidate_id,proposal_ids FROM ag_catalog.trading_assessments
                WHERE project_id=%s AND deck_id=%s AND assessment_id=%s""", (project_id, deck_id, reference))
            assessment = cursor.fetchone()
            if not assessment or assessment["candidate_id"] != rows[0]["proposal"]["candidate_id"]:
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
