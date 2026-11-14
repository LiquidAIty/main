"""Exact comparison semantics; no model run or broker orders."""
# Entity: Trading
# Relationship: Checks pending forecast outcomes and optional comparison persistence failure without altering original predictions or hiding unavailable observations.

from copy import deepcopy
import psycopg
from app.python_models import trading_forecast_store as store


def test_pending_target_needs_no_market_request_or_fabricated_accuracy(monkeypatch):
    forecast = {'forecastId': 'forecast', 'generatedAt': '2026-11-13T01:00:00Z',
        'cutoff': '2026-11-13T01:00:00Z', 'points': [{'timestamp': '2099-01-01T05:00:00Z'}],
        'marketData': {'symbol': 'RDW', 'timeframe': '1Day', 'feed': 'iex'}}
    original = deepcopy(forecast)
    monkeypatch.setattr(store, 'read_forecasts', lambda *_: forecast)
    from app.python_models import alpaca_market_data
    monkeypatch.setattr(alpaca_market_data, 'get_historical_bars', lambda *_a, **_k: (_ for _ in ()).throw(AssertionError('must not fetch future outcomes')))
    result = store.compare_forecast('project', 'deck', 'card', 'forecast')
    assert result['status'] == 'pending' and result['metrics'] is None and result['actual'] == []
    assert result['producer'] == 'application_forecast_comparison'
    assert forecast == original


def test_optional_comparison_retention_failure_preserves_completed_result(monkeypatch):
    calculated = {'forecastId': 'forecast', 'status': 'partial', 'metrics': {'matchedBars': 1},
                  'actual': [{'close': 12}], 'evaluatedAt': '2026-11-13T01:00:00Z'}
    monkeypatch.setattr(store, 'compare_forecast', lambda *_: deepcopy(calculated))
    monkeypatch.setattr(store, 'connect_postgres', lambda **_: (_ for _ in ()).throw(psycopg.OperationalError('offline')))
    result = store.retain_comparison('project', 'deck', 'card', 'forecast')
    assert {key: result[key] for key in calculated} == calculated
    assert result['persistence']['status'] == 'unconfirmed' and 'comparisonId' not in result
    assert store.read_comparisons('project', 'deck', 'card', 'forecast')['status'] == 'unavailable'
