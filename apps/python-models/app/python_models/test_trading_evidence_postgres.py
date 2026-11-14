"""Real isolated PostgreSQL tests, never product data or live model proof."""
# Entity: Trading
# Relationship: Proves optional proposal and assessment storage, scope/grant enforcement and retry stability independently of journals and agent handoffs in isolated PostgreSQL.

from concurrent.futures import ThreadPoolExecutor
import json
from uuid import uuid4

import psycopg
import pytest

from app.python_models import trading_evidence as records
from app.python_models.trading_contract import TradingBoundaryError
from app.python_models.test_trading_postgres import database, scope, execution, decision, pytestmark
from app.python_models.test_trading_proposals import proposal


@pytest.fixture
def company(scope, monkeypatch):
    monkeypatch.setattr(records, "connect_postgres", scope[3])
    with psycopg.connect(**scope[1], autocommit=True) as owner:
        for role, tools in {
            "designer": ["record_proposal", "read_evidence"],
            "contrarian": ["invert_proposal", "record_assessment", "read_evidence"],
            "quant": ["compare_proposals", "record_assessment", "read_evidence", "observe_proposals"],
            "reader": ["read_evidence"],
        }.items():
            revision = str(uuid4())
            owner.execute("INSERT INTO ag_catalog.agent_cards VALUES (%s,'deck',%s,%s)", (scope[0]["project_id"], role, revision))
            owner.execute("INSERT INTO ag_catalog.agent_card_revisions VALUES (%s,'hermes','delegate',%s,'{}',true)", (revision, role))
            for tool in tools:
                owner.execute("INSERT INTO ag_catalog.card_capability_grants VALUES (%s,'tool',%s)", (revision, "trading." + tool))
        for tool in ("read_evidence",):
            owner.execute("INSERT INTO ag_catalog.card_capability_grants VALUES (%s,'tool',%s)", (scope[2], "trading." + tool))
    return scope


def caller(company, role):
    return {**company[0], "card_id": role,
            "source_execution": execution("trading" if role == "trader" else role)}


def reader(company, role="reader"):
    return {key: value for key, value in caller(company, role).items() if key != "source_execution"}


def pair(company):
    original = records.record_proposal(**caller(company, "designer"), proposal=proposal(), idempotency_key="original")
    inverse = records.invert_proposal(**caller(company, "contrarian"), proposal_id=original["proposal_id"])
    return original, inverse["exact_counterparty"]


def test_exact_proposal_retry_and_inversion_keep_actual_separate_authors(company):
    with ThreadPoolExecutor(max_workers=3) as pool:
        values = list(pool.map(lambda _: records.record_proposal(**caller(company, "designer"),
            proposal=proposal(), idempotency_key="original"), range(3)))
    assert len({item["proposal_id"] for item in values}) == 1
    a, b = pair(company)
    again = records.invert_proposal(**caller(company, "contrarian"), proposal_id=a["proposal_id"])
    assert again["exact_counterparty"]["proposal_id"] == b["proposal_id"]
    assert again["opposing_direction"]["proposal_id"] == b["proposal_id"]
    assert records.invert_proposal(**caller(company, "contrarian"), proposal_id=a["proposal_id"].upper())["exact_counterparty"]["proposal_id"] == b["proposal_id"]
    assert a["card_id"] == "designer" and b["card_id"] == "contrarian"
    assert b["source_execution"]["profile"] == "contrarian"
    with pytest.raises(TradingBoundaryError, match="idempotency_conflict"):
        records.record_proposal(**caller(company, "designer"), proposal=proposal(thesis="Different"), idempotency_key="original")


def test_cross_project_and_ungranted_caller_cannot_read_or_change_pair(company):
    a, b = pair(company)
    with pytest.raises(TradingBoundaryError, match="grant_required"):
        records.invert_proposal(**caller(company, "reader"), proposal_id=a["proposal_id"])
    with pytest.raises(TradingBoundaryError, match="not_found"):
        records.read_evidence(**reader(company), proposal_id=str(uuid4()))
    with pytest.raises(TradingBoundaryError, match="grant_required"):
        records.read_evidence(**{**reader(company), "project_id": str(uuid4())}, proposal_id=a["proposal_id"])
    with pytest.raises(TradingBoundaryError, match="execution_reference_invalid"):
        records.record_proposal(**{**caller(company, "designer"), "source_execution": execution("trading")},
                                proposal=proposal(), idempotency_key="borrowed-author")


def test_foreign_proposal_is_rejected_even_for_an_authorized_local_caller(company):
    a, b = pair(company)
    with psycopg.connect(**company[1], autocommit=True) as owner:
        owner.execute("UPDATE ag_catalog.trading_proposals SET project_id=%s WHERE proposal_id=%s", (str(uuid4()), a["proposal_id"]))
    with pytest.raises(TradingBoundaryError, match="not_found"):
        records.invert_proposal(**caller(company, "contrarian"), proposal_id=a["proposal_id"])


def test_independent_quant_comparison_requires_pair_and_accepts_wait(company):
    a, b = pair(company)
    content = dict(summary="Borrow remains unknown; compare scenarios only.", evidence_references=[],
                   uncertainty="Unverified borrow and future catalyst.", recommendation="WAIT")
    assessment = records.record_assessment(**caller(company, "quant"), candidate_id="rdw-investigation",
        kind="quant_comparison", proposal_ids=[a["proposal_id"], b["proposal_id"]], content=content, idempotency_key="comparison")
    assert assessment["content"]["recommendation"] == "WAIT"
    result = records.compare_scenarios(**reader(company, "quant"), original_id=a["proposal_id"], opposing_id=b["proposal_id"], underlying_prices=[8, 12])
    assert result["kind"] == "SHADOW" and result["execution_authorized"] is False
    assert result["scenarios"][1]["original"]["net_pnl"] > 0
    assert result["scenarios"][0]["opposing"]["net_pnl"] is None  # Unknown borrow cost is not zero.
    with pytest.raises(TradingBoundaryError, match="pair_required"):
        records.record_assessment(**caller(company, "quant"), candidate_id="rdw-investigation", kind="quant_comparison",
            proposal_ids=[b["proposal_id"], a["proposal_id"]], content=content, idempotency_key="reversed")


def test_optional_decision_read_needs_no_proposal_or_journal(company):
    chosen = decision(company)["decision"]
    trail = records.read_evidence(**reader(company), decision_id=chosen["decisionId"])
    assert trail["decision"]["card_id"] == "trader"
    assert trail["decision"]["execution_requested"] is False
    assert "journal" not in trail
    with company[3]() as connection:
        assert connection.execute("SELECT COUNT(*) FROM ag_catalog.trading_jobs WHERE project_id=%s", (company[0]["project_id"],)).fetchone() == (0,)
        for table in ("trading_proposals", "trading_assessments"):
            with pytest.raises(psycopg.errors.InsufficientPrivilege):
                connection.execute(f"DELETE FROM ag_catalog.{table}")


def test_exact_forecast_read_preserves_other_producer_without_an_assessment_gate(company, monkeypatch):
    from app.python_models import trading_forecast_store
    monkeypatch.setattr(trading_forecast_store, 'connect_postgres', company[3])
    forecast_id = str(uuid4())
    payload = {'forecastId': forecast_id, 'status': 'invalid_prediction',
               'points': [{'valid': False}], 'volatilityComparison': {'status': 'available'}}
    with psycopg.connect(**company[1], autocommit=True) as owner:
        producer_revision = str(owner.execute("SELECT current_revision_id FROM ag_catalog.agent_cards WHERE project_id=%s AND deck_id='deck' AND card_id='quant'",
            (company[0]['project_id'],)).fetchone()[0])
        owner.execute('''INSERT INTO ag_catalog.trading_forecasts
            (forecast_id,project_id,deck_id,card_id,card_revision_id,payload)
            VALUES (%s,%s,'deck','quant',%s,%s::jsonb)''',
            (forecast_id, company[0]['project_id'], producer_revision, json.dumps(payload)))
    result = records.read_evidence(**reader(company), forecast_id=forecast_id)
    item = result['receipts'][0]
    assert {key: item[key] for key in ('kind', 'producer_card_id', 'card_revision_id', 'receipt')} == {
        'kind': 'FORECAST', 'producer_card_id': 'quant', 'card_revision_id': producer_revision, 'receipt': payload}
    assert item['comparisonHistory']['status'] == 'unavailable'  # Optional table absent in this older fixture.
    with psycopg.connect(**company[1], autocommit=True) as owner:
        assert owner.execute('SELECT count(*) FROM ag_catalog.trading_assessments WHERE project_id=%s',
                             (company[0]['project_id'],)).fetchone()[0] == 0
        foreign, revision = str(uuid4()), str(uuid4())
        owner.execute("INSERT INTO ag_catalog.agent_card_revisions VALUES (%s,'hermes','delegate','other-quant','{}',true)", (revision,))
        owner.execute("INSERT INTO ag_catalog.agent_cards VALUES (%s,'deck','quant',%s)", (foreign, revision))
        owner.execute('UPDATE ag_catalog.trading_forecasts SET project_id=%s WHERE forecast_id=%s', (foreign, forecast_id))
    with pytest.raises(TradingBoundaryError, match='reference_not_found:forecastId'):
        records.read_evidence(**reader(company), forecast_id=forecast_id)


def test_retired_producer_history_remains_readable_but_new_write_stops(company):
    a, b = pair(company)
    with psycopg.connect(**company[1], autocommit=True) as owner:
        owner.execute("UPDATE ag_catalog.agent_card_revisions SET enabled=false WHERE runtime_profile='designer'")
    trail = records.read_evidence(**reader(company), proposal_id=a["proposal_id"])
    assert trail["proposals"][0]["card_id"] == "designer"
    with pytest.raises(TradingBoundaryError, match="grant_required"):
        records.record_proposal(**caller(company, "designer"), proposal=proposal(), idempotency_key="not-active")


def test_invented_receipt_cannot_be_laundered_into_quant_assessment(company):
    a, b = pair(company)
    for field in ("backtestId", "forecastId", "proposalId", "assessmentId"):
        with pytest.raises(TradingBoundaryError, match="reference_not_found"):
            records.record_assessment(**caller(company, "quant"), candidate_id="rdw-investigation", kind="quant_comparison",
                proposal_ids=[a["proposal_id"], b["proposal_id"]], content=dict(summary="Unsupported numerical claim",
                recommendation="WAIT", uncertainty="Unknown", evidence_references=[{field: str(uuid4())}]), idempotency_key=field)


def test_observation_is_retained_as_shadow_not_broker_earnings_and_retry_reuses_it(company, monkeypatch):
    a, b = pair(company)
    calls = []
    def observed(original, opposite):
        calls.append(original)
        return {"kind": "SHADOW", "status": "observed", "bar": {"close": 12},
                "original": {"net_pnl": 188}, "opposing": {"net_pnl": None}, "provider": "fixture"}
    monkeypatch.setattr(records, "_observe_equity_pair", observed)
    args = dict(**caller(company, "quant"), original_id=a["proposal_id"], opposing_id=b["proposal_id"], idempotency_key="observed")
    result = records.observe_proposals(**args)
    assert records.observe_proposals(**args) == result and len(calls) == 1
    assert result["kind"] == "shadow_outcome" and result["content"]["kind"] == "SHADOW"
    trail = records.read_evidence(**reader(company), proposal_id=a["proposal_id"])
    assert trail["assessments"][0]["assessment_id"] == result["assessment_id"]
    with company[3]() as connection:
        assert connection.execute("SELECT count(*) FROM ag_catalog.trading_jobs WHERE project_id=%s", (company[0]["project_id"],)).fetchone() == (0,)


def test_pending_observation_does_not_turn_into_completed_evidence(company, monkeypatch):
    a, b = pair(company)
    monkeypatch.setattr(records, "_observe_equity_pair", lambda *_: {"kind": "SHADOW", "status": "pending"})
    result = records.observe_proposals(**caller(company, "quant"), original_id=a["proposal_id"], opposing_id=b["proposal_id"], idempotency_key="pending")
    assert result["status"] == "pending"
    assert records.read_evidence(**reader(company), proposal_id=a["proposal_id"])["assessments"] == []


def test_same_candidate_different_proposal_pair_keeps_assessments_separate(company):
    original, _ = pair(company)
    other = records.record_proposal(**caller(company, "designer"), proposal=proposal(quantity=50), idempotency_key="other-pair")
    inverse = records.invert_proposal(**caller(company, "contrarian"), proposal_id=other["proposal_id"])["exact_counterparty"]
    assessment = records.record_assessment(**caller(company, "quant"), candidate_id="rdw-investigation", kind="quant_comparison",
        proposal_ids=[other["proposal_id"], inverse["proposal_id"]], content=dict(summary="Separate position size.",
        recommendation="WAIT", uncertainty="Unknown", evidence_references=[]), idempotency_key="other-comparison")
    assert records.read_evidence(**reader(company), proposal_id=original["proposal_id"])["assessments"] == []
    assert records.read_evidence(**reader(company), proposal_id=other["proposal_id"])["assessments"][0]["assessment_id"] == assessment["assessment_id"]
