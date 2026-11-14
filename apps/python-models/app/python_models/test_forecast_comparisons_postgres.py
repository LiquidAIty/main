"""Real append-only comparison storage in the existing isolated PostgreSQL fixture."""
# Entity: Trading
# Relationship: Proves comparison append/readback, original forecast preservation and cross-Project refusal without touching demo history.

import json
from uuid import uuid4
import psycopg
from psycopg import sql
import pytest
from app.python_models import trading_forecast_store as store
from app.python_models.test_trading_postgres import database, scope, MIGRATIONS, pytestmark


def test_comparison_is_separate_append_only_and_project_scoped(scope, monkeypatch):
    forecast_id = str(uuid4())
    original = {'forecastId': forecast_id, 'generatedAt': '2026-11-13T01:00:00Z',
        'cutoff': '2026-11-13T01:00:00Z', 'points': [{'timestamp': '2099-01-01T05:00:00Z'}],
        'marketData': {'symbol': 'RDW', 'timeframe': '1Day', 'feed': 'iex'}}
    with psycopg.connect(**scope[1], autocommit=True) as owner:
        owner.execute((MIGRATIONS / '066_optional_forecast_comparisons.sql').read_text(encoding='utf-8'))
        role = owner.execute('SELECT rolname FROM pg_roles WHERE rolname=%s', (scope[1]['dbname'] + '_writer',)).fetchone()[0]
        owner.execute(sql.SQL('GRANT SELECT,INSERT ON ag_catalog.trading_forecast_comparisons TO {}').format(sql.Identifier(role)))
        owner.execute('''INSERT INTO ag_catalog.trading_forecasts
            (forecast_id,project_id,deck_id,card_id,card_revision_id,payload)
            VALUES (%s,%s,'deck','trader',%s,%s::jsonb)''',
            (forecast_id, scope[0]['project_id'], scope[2], json.dumps(original)))
    monkeypatch.setattr(store, 'connect_postgres', scope[3])
    args = (scope[0]['project_id'], 'deck', 'trader', forecast_id)
    first = store.retain_comparison(*args)
    second = store.retain_comparison(*args)
    assert first['persistence']['status'] == 'saved' and first['status'] == 'pending'
    assert first['comparisonId'] != second['comparisonId']
    loaded = store.read_forecasts(*args)
    assert {k:loaded[k] for k in original} == original
    assert len(loaded['comparisonHistory']['comparisons']) == 2
    assert store.read_comparisons(str(uuid4()), 'deck', 'trader', forecast_id)['comparisons'] == []
    assert store.read_comparisons(args[0], 'foreign-deck', 'trader', forecast_id)['comparisons'] == []
    from app.python_models import trading_evidence
    monkeypatch.setattr(trading_evidence, 'connect_postgres', scope[3])
    with psycopg.connect(**scope[1], autocommit=True) as owner:
        owner.execute("INSERT INTO ag_catalog.card_capability_grants VALUES (%s,'tool','trading.read_evidence')", (scope[2],))
    evidence = trading_evidence.read_evidence(**scope[0], forecast_id=forecast_id)['receipts'][0]
    assert evidence['receipt'] == original
    assert len(evidence['comparisonHistory']['comparisons']) == 2
    with scope[3]() as connection:
        assert connection.execute('SELECT payload FROM ag_catalog.trading_forecasts WHERE forecast_id=%s', (forecast_id,)).fetchone()[0] == original
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            connection.execute('UPDATE ag_catalog.trading_forecast_comparisons SET payload=%s::jsonb', ('{}',))
