"""Numerical and optional-retention contracts; synthetic arrays are not market evidence."""
# Entity: Trading
# Relationship: Verifies conditional-variance math, held-out boundaries and calculation survival when optional retention fails, without models, orders or paid data calls.

from contextlib import nullcontext
from types import SimpleNamespace
from unittest.mock import Mock

import numpy as np
import pandas as pd
import psycopg
import pytest

from app.python_models import trading_statistics as stats


def test_variance_recursion_uses_squared_residual_and_then_expected_variance():
    fit = {'omega': 1., 'alpha': .1, 'beta': .8, 'lastVariance': 4., 'lastResidual': 2.}
    assert stats._variance_forecast(fit, 3) == pytest.approx([4.6, 5.14, 5.626])


def test_garch_held_out_fit_does_not_receive_future_observations(monkeypatch):
    seen = []
    def fit(values):
        seen.append(values.copy())
        return {'mean': 0., 'omega': .1, 'alpha': .1, 'beta': .8,
                'lastVariance': 1., 'lastResidual': 1., 'iterations': 3, 'negativeLogLikelihood': 2.}
    monkeypatch.setattr(stats, '_fit_garch', fit)
    history = [{'timestamp': str(i), 'availableAfter': str(i + 1), 'close': 100. + i + (i % 3)} for i in range(128)]
    result = stats.volatility_comparison(history, 5, '1Day')
    assert result['status'] == 'available'
    assert len(seen[0]) == 107 and len(seen[1]) == 127
    assert np.array_equal(seen[0], seen[1][:-20])
    assert result['heldOut']['trainingLastObservedAt'] == '107'
    assert len(result['volatilityPercentPerBar']) == 5
    assert result['executionAuthorized'] is False


def test_garch_has_no_fabricated_result_for_short_or_constant_history():
    assert stats.volatility_comparison([{'close': 100.}] * 100, 5, '1Day')['status'] == 'unavailable'
    assert stats.volatility_comparison([{'close': 100.}] * 128, 5, '1Day')['status'] == 'unavailable'


def test_portfolio_calculation_survives_failed_optional_assessment_store(monkeypatch):
    from app.python_models import alpaca_market_data as market, trading_evidence as evidence
    from app.python_models import postgres, trading_jobs, trading_forecast
    cursor = Mock()
    cursor.fetchone.return_value = None
    connection = SimpleNamespace(cursor=lambda **kwargs: nullcontext(cursor))
    monkeypatch.setattr(postgres, 'connect_postgres', lambda **kwargs: nullcontext(connection))
    monkeypatch.setattr(evidence, 'require_evidence_card', lambda *args: {'runtime_profile': 'quant'})
    save = Mock(side_effect=psycopg.OperationalError('isolated unavailable retention'))
    monkeypatch.setattr(evidence, 'record_assessment', save)
    policy = {'maximumPositionLossPercent': None, 'maximumPositionWeightPercent': 100,
        'permittedInstrumentTypes': ['equity'], 'positionCategories': {}, 'minimumLiquidReservePercent': 0,
        'categories': [{'id': 'core', 'minimumPercent': 0, 'maximumPercent': 100, 'targetPercent': 80, 'maximumRiskPercent': None},
                       {'id': 'cash', 'minimumPercent': 0, 'maximumPercent': 100, 'targetPercent': 20, 'maximumRiskPercent': None}]}
    monkeypatch.setattr(trading_jobs, 'read_portfolio_context', lambda **kwargs: {
        'cardRevisionId': 'fixture-revision', 'observedAt': '2026-10-30T20:00:00Z', 'positions': [],
        'allocation': {'allocationComplete': True, 'policySaved': True, 'policy': policy, 'policyHash': 'fixture',
                      'portfolioValueUsd': 10000., 'reportedCashUsd': 10000., 'reservedCapitalUsd': 0.}})
    begin, end = pd.Timestamp('2026-07-01', tz='America/New_York'), pd.Timestamp('2026-10-30', tz='America/New_York')
    times = [stamp for stamp, complete in trading_forecast._bar_windows(begin, end, '1Day') if begin <= stamp < end and complete <= end]
    bars = [market.MarketBar(timestamp=stamp.isoformat(), open=100 + i, high=103 + i,
        low=99 + i, close=101 + i + (i % 2), volume=100) for i, stamp in enumerate(times)]
    monkeypatch.setattr(market, 'get_historical_bars', lambda *args, **kwargs: SimpleNamespace(
        status='available', truncated=False, diagnostics=None, bars=bars, provider='synthetic-test-fixture',
        feed='fixture', fetchedAt='2026-10-30T20:00:00Z'))
    result = stats.optimize_portfolio(project_id='project', deck_id='deck', card_id='quant',
        source_execution={'runtime': 'hermes', 'profile': 'quant', 'sessionId': 's', 'turnId': 't', 'toolCallId': 'c'},
        portfolio_card_id='trader', symbols=['FIXTURE'], allocation_lanes={'FIXTURE': 'core'},
        start='2026-07-01', end='2026-10-30', maximum_turnover_percent=100, cost_bps=0, idempotency_key='test')
    assert result['status'] == 'available'
    assert result['executionAuthorized'] is False
    assert result['persistence']['status'] == 'unconfirmed'
    assert 'assessmentId' not in result
    save.assert_called_once()
