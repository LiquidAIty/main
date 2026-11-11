"""Opt-in real PostgreSQL proof. Creates and removes only its own empty test database.

Run with TRADING_POSTGRES_TESTS=1 and the normal development DATABASE_URL.
No product data is copied; model and broker execution are outside this suite.
"""
# Entity: Trading
# Relationship: Exercises journal migrations, least-privilege writes, concurrent retries, scope isolation, and retained backtest references in an isolated real PostgreSQL database.

from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
from uuid import uuid4

import psycopg
from psycopg import sql
import pytest

from app.application_tool_error import ApplicationToolError
from app.python_models import trading_backtest as backtest, trading_jobs as jobs
from app.python_models.postgres import connect_postgres
from app.python_models.test_trading import _configuration, _plan
from app.python_models.trading_contract import TradingBoundaryError

pytestmark = pytest.mark.skipif(os.getenv('TRADING_POSTGRES_TESTS') != '1',
                                reason='explicit isolated PostgreSQL test opt-in required')
MIGRATIONS = Path(__file__).resolve().parents[3] / 'backend' / 'migrations'


@pytest.fixture(scope='module')
def database():
    name = 'test_trading_' + uuid4().hex
    role = name + '_writer'
    with connect_postgres() as admin:
        # libpq's public connection description intentionally omits its password.
        params = psycopg.conninfo.conninfo_to_dict(os.environ['DATABASE_URL'])
        admin.execute(sql.SQL('CREATE ROLE {} NOLOGIN NOSUPERUSER').format(sql.Identifier(role)))
        admin.execute(sql.SQL('CREATE DATABASE {} TEMPLATE template0').format(sql.Identifier(name)))
    params['dbname'] = name
    try:
        with psycopg.connect(**params, autocommit=True) as owner:
            owner.execute('CREATE EXTENSION age')
            # Only saved-Card columns consumed by these owners; no product rows or graphs.
            owner.execute('''CREATE TABLE ag_catalog.agent_cards (
                project_id uuid, deck_id text, card_id text, current_revision_id uuid,
                PRIMARY KEY(project_id,deck_id,card_id))''')
            owner.execute('''CREATE TABLE ag_catalog.agent_card_revisions (
                revision_id uuid PRIMARY KEY, runtime_kind text, runtime_mode text,
                runtime_profile text, runtime_extension_config jsonb, enabled boolean)''')
            owner.execute('''CREATE TABLE ag_catalog.card_capability_grants (
                revision_id uuid, grant_kind text, grant_id text)''')
            for filename in ['032_paper_trade_jobs.sql', '033_trading_lifecycle_runs.sql',
                             '063_trading_hermes_evidence.sql']:
                owner.execute((MIGRATIONS / filename).read_text(encoding='utf-8'))
            owner.execute(sql.SQL('GRANT USAGE ON SCHEMA ag_catalog TO {}').format(sql.Identifier(role)))
            owner.execute(sql.SQL('GRANT SELECT ON ALL TABLES IN SCHEMA ag_catalog TO {}').format(sql.Identifier(role)))
            for table in ['trading_jobs', 'trading_lifecycle_runs']:
                owner.execute(sql.SQL('GRANT INSERT, UPDATE ON ag_catalog.{} TO {}').format(
                    sql.Identifier(table), sql.Identifier(role)))
            owner.execute(sql.SQL('GRANT INSERT ON ag_catalog.trading_decisions TO {}').format(sql.Identifier(role)))
        yield params, role
    finally:
        # Exact generated targets only. Never reset, truncate or drop the product database.
        assert name.startswith('test_trading_') and params['dbname'] == name
        with connect_postgres() as admin:
            admin.execute(sql.SQL('DROP DATABASE {}').format(sql.Identifier(name)))
            admin.execute(sql.SQL('DROP ROLE {}').format(sql.Identifier(role)))


@pytest.fixture
def scope(database, monkeypatch):
    params, role = database
    project, revision = str(uuid4()), str(uuid4())
    config = _configuration()
    with psycopg.connect(**params, autocommit=True) as owner:
        owner.execute('INSERT INTO ag_catalog.agent_cards VALUES (%s,%s,%s,%s)',
                      (project, 'deck', 'trader', revision))
        owner.execute('INSERT INTO ag_catalog.agent_card_revisions VALUES (%s,%s,%s,%s,%s::jsonb,true)',
                      (revision, 'hermes', 'delegate', 'trading', json.dumps({'configuration': config})))

    def connect(*, autocommit=True):
        connection = psycopg.connect(**params, autocommit=autocommit)
        connection.execute(sql.SQL('SET ROLE {}').format(sql.Identifier(role)))
        return connection

    monkeypatch.setattr(jobs, 'connect_postgres', connect)
    monkeypatch.setattr(backtest, 'connect_postgres', connect)
    return dict(project_id=project, deck_id='deck', card_id='trader'), params, revision, connect


def execution(profile='trading', call='test-call'):
    return dict(runtime='hermes', profile=profile, sessionId='isolated-test-session',
                turnId='isolated-test-turn', toolCallId=call)


def decision(scope, **changes):
    values = dict(**scope[0], source_execution=execution(), subject='RDW evidence review',
                  action='WAIT', rationale='Await current filing evidence.', confidence=.5,
                  evidence=[], missing_terms=['Current filing'], idempotency_key='review-one')
    values.update(changes)
    return jobs.record_trade_decision(**values)


def fund(scope, concurrency=3):
    config = _configuration()
    config['trading'].update(paperBudgetUsd=100000, allocationPerJobPercent=10,
        maxOpenPositions=4, maxPlanLossPercent=5, maxDailyLossPercent=4,
        maxPortfolioDrawdownPercent=10, defaultStopLossPercent=2, maxConcurrentJobs=concurrency)
    with psycopg.connect(**scope[1], autocommit=True) as owner:
        owner.execute('UPDATE ag_catalog.agent_card_revisions SET runtime_extension_config=%s::jsonb WHERE revision_id=%s',
                      (json.dumps({'configuration': config}), scope[2]))


def test_research_wait_needs_no_funding_and_is_inspectable(scope):
    saved = decision(scope)
    assert saved['job'] is None
    assert saved['decision']['executionRequested'] is False
    assert saved['decision']['sourceExecution'] == execution()
    rows, _, _, research, receipts = jobs._read_trading_history(**scope[0])
    assert rows == [] and receipts == []
    assert research == [saved['decision']]
    assert 'sourceRunId' not in research[0]
    with scope[3]() as connection:
        assert connection.execute('SELECT rolsuper FROM pg_roles WHERE rolname=current_user').fetchone() == (False,)
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            connection.execute('UPDATE ag_catalog.trading_decisions SET confidence=0')
    with pytest.raises(TradingBoundaryError, match='risk_configuration_incomplete'):
        jobs.accept_trade_assignment(**scope[0], source_execution=execution(), plan=_plan(), idempotency_key='job')


def test_retry_is_exact_and_concurrent_retries_write_one_decision(scope):
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(lambda _: decision(scope), range(4)))
    assert len({result['decision']['decisionId'] for result in results}) == 1
    with pytest.raises(TradingBoundaryError, match='idempotency_conflict'):
        decision(scope, rationale='Changed conclusion cannot overwrite immutable history.')
    assert len(jobs._read_trading_history(**scope[0])[3]) == 1


def test_replaying_an_old_decision_does_not_rewind_completed_job(scope):
    fund(scope)
    plan = _plan()
    created = jobs.accept_trade_assignment(**scope[0], source_execution=execution(), plan=plan, idempotency_key='job')
    again = jobs.accept_trade_assignment(**scope[0], source_execution=execution(call='retry'), plan=plan, idempotency_key='job')
    assert again['jobId'] == created['jobId']
    values = dict(job_id=created['jobId'], subject=None, missing_terms=[])
    first = decision(scope, **values)
    decision(scope, **values, action='EXIT', idempotency_key='exit')
    replay = decision(scope, **values)
    assert replay['decision']['decisionId'] == first['decision']['decisionId']
    assert replay['job']['state'] == 'completed' and replay['job']['action'] == 'EXIT'


def test_concurrent_admissions_respect_card_capacity(scope):
    fund(scope, concurrency=1)
    plan = _plan()
    def admit(key):
        try:
            return jobs.accept_trade_assignment(**scope[0], source_execution=execution(), plan=plan, idempotency_key=key)
        except TradingBoundaryError as error:
            return str(error)
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(admit, ['one', 'two']))
    assert sum(isinstance(result, dict) for result in results) == 1
    assert 'trading_max_concurrent_jobs_reached' in results


@pytest.mark.parametrize('field,value', [('project_id', str(uuid4())), ('deck_id', 'elsewhere'), ('card_id', 'other')])
def test_foreign_scope_cannot_read_or_write_card(scope, field, value):
    with pytest.raises(TradingBoundaryError, match='trading_card_not_found'):
        decision(scope, **{field: value})
    with pytest.raises(TradingBoundaryError, match='trading_card_not_found'):
        jobs._read_trading_history(**{**scope[0], field: value})


def test_invalid_provenance_and_invented_evidence_fail(scope):
    with pytest.raises(TradingBoundaryError, match='execution_reference_invalid'):
        decision(scope, source_execution=execution(profile='quant'))
    with pytest.raises(TradingBoundaryError, match='reference_not_found'):
        decision(scope, evidence=[{'backtestId': str(uuid4())}])
    with pytest.raises(TradingBoundaryError, match='evidence_invalid'):
        decision(scope, evidence=[{'value': float('nan')}])
    assert jobs._read_trading_history(**scope[0])[3] == []


def test_retained_result_keeps_quant_authorship_and_exact_journal_reference(scope, monkeypatch):
    quant_revision = str(uuid4())
    with psycopg.connect(**scope[1], autocommit=True) as owner:
        owner.execute('INSERT INTO ag_catalog.agent_cards VALUES (%s,%s,%s,%s)',
                      (scope[0]['project_id'], 'deck', 'quant', quant_revision))
        owner.execute("INSERT INTO ag_catalog.agent_card_revisions VALUES (%s,'hermes','delegate','quant','{}',true)", (quant_revision,))
        owner.execute("INSERT INTO ag_catalog.card_capability_grants VALUES (%s,'tool','trading.backtest')", (quant_revision,))
    # Real SQL and persistence; compute is a fixture here, not a claimed LumiBot/model run.
    inputs = [{'symbol': 'RDW', 'bars': [{'timestamp': '2026-10-01', 'close': 10}]}]
    result = dict(engine='LumiBot', bot='buy_and_hold', symbols=['RDW'], sources=[],
                  inputSnapshotSha256=hashlib.sha256(json.dumps(inputs).encode()).hexdigest(),
                  dataCutoffExclusive='2026-10-14T00:00:00-04:00',
                  startedAt=datetime.now(timezone.utc).isoformat(),
                  completedAt=datetime.now(timezone.utc).isoformat(), _inputSnapshot=inputs)
    calls = []
    def compute(**request):
        calls.append(request)
        return deepcopy(result)
    monkeypatch.setattr(backtest, '_run', compute)
    args = [scope[0]['project_id'], 'deck', 'quant', execution('quant'),
            'buy_and_hold', ['RDW'], '2026-10-01', '2026-10-14', 10000, 1, .01]
    saved = backtest._run_and_retain(*args)
    assert backtest._run_and_retain(*args) == saved and len(calls) == 1
    assert saved['producerCardId'] == 'quant' and saved['sourceExecution']['profile'] == 'quant'
    changed = args.copy()
    changed[-1] = .02
    with pytest.raises(ApplicationToolError, match='reference_conflict'):
        backtest._run_and_retain(*changed)
    decision(scope, evidence=[{'backtestId': saved['backtestId']}])
    assert jobs._read_trading_history(**scope[0])[4] == [saved]
    assert backtest.read_backtest(scope[0]['project_id'], 'deck', saved['backtestId']) == saved
    with pytest.raises(ApplicationToolError, match='backtest_not_found'):
        backtest.read_backtest(str(uuid4()), 'deck', saved['backtestId'])
    with scope[3]() as connection:
        with pytest.raises(psycopg.errors.CheckViolation):
            connection.execute('UPDATE ag_catalog.trading_lifecycle_runs SET live_orders=true')
        with pytest.raises(psycopg.errors.CheckViolation):
            connection.execute('UPDATE ag_catalog.trading_lifecycle_runs SET source_execution=%s::jsonb', ('{}',))


def test_schema_has_no_obsolete_trading_run_ids(database):
    with psycopg.connect(**database[0]) as connection:
        columns = connection.execute("SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='ag_catalog'").fetchall()
    assert ('trading_jobs', 'source_run_id') not in columns
    assert ('trading_decisions', 'source_run_id') not in columns
    assert ('trading_lifecycle_runs', 'symbol') not in columns
