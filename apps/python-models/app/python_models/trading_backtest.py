"""Bounded use of installed LumiBot strategies, with historical simulation only."""
# Entity: Trading
# Relationship: Runs bounded upstream LumiBot simulations under saved Card authority and reports optional retention separately without broker execution or a scheduler.
from __future__ import annotations

import asyncio
from datetime import date, datetime, timedelta, timezone
from importlib.metadata import version
import json
import hashlib
import math
import os
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Lock
from time import perf_counter
from zoneinfo import ZoneInfo
from uuid import UUID, uuid4

import psycopg
from psycopg.rows import dict_row

from app.application_tool_error import ApplicationToolError
from app.python_models.alpaca_market_data import AlpacaInstrumentRef, get_historical_bars
from app.python_models.postgres import connect_postgres
from app.python_models.trading_jobs import _execution_reference
from app.python_models.trading_contract import TradingBoundaryError

_RUN_LOCK = Lock()
_BOTS = {
    'buy_and_hold': {
        'name': 'Buy and hold', 'implementation': 'lumibot.example_strategies.stock_buy_and_hold.BuyAndHold',
        'rules': 'Buy one chosen stock/ETF and retain the position. Baseline, not an alpha claim.',
        'symbols': 'Exactly one US stock/ETF.',
    },
    'momentum_rotation': {
        'name': 'Momentum rotation', 'implementation': 'lumibot.example_strategies.stock_momentum.Momentum',
        'rules': 'Upstream example compares two-day price momentum, holding the stronger asset and reevaluating every two trading days.',
        'symbols': 'Two to five US stocks/ETFs; all require complete daily history.',
    },
}


async def trading_list_bots() -> dict:
    return {'engine': 'LumiBot', 'version': version('lumibot'), 'mode': 'historical_simulation_only',
            'bots': [{'id': key, **value} for key, value in _BOTS.items()],
            'orderSubmission': 'disabled', 'timeframes': ['1Day'],
            'parameters': ['symbols', 'start', 'end', 'capital', 'fee_bps', 'slippage_per_share'],
            'limitations': ['These are installed upstream examples, not endorsed profitable strategies.',
                            'No arbitrary Python, live broker run, options, or futures in this bounded tool.']}


def _inputs(bot, symbols, start, end, capital, fee_bps, slippage_per_share):
    if bot not in _BOTS or not isinstance(symbols, list) or any(not isinstance(value, str) for value in symbols):
        raise ApplicationToolError('backtest_bot_or_symbols_invalid')
    names = [value.strip().upper() for value in symbols]
    if len(set(names)) != len(names) or not all(names) or not (1 <= len(names) <= 5):
        raise ApplicationToolError('backtest_requires_one_to_five_distinct_symbols')
    if (bot == 'buy_and_hold' and len(names) != 1) or (bot == 'momentum_rotation' and len(names) < 2):
        raise ApplicationToolError('backtest_symbol_count_does_not_match_bot')
    try:
        first, last = date.fromisoformat(start), date.fromisoformat(end)
    except (TypeError, ValueError):
        raise ApplicationToolError('backtest_dates_require_YYYY_MM_DD') from None
    if not 7 <= (last - first).days <= 366 or last > datetime.now(ZoneInfo('America/New_York')).date():
        raise ApplicationToolError('backtest_requires_7_to_366_historical_days_end_exclusive')
    for value, maximum in [(capital, 1000000), (fee_bps, 1000), (slippage_per_share, 100)]:
        if type(value) not in (int, float) or not math.isfinite(value) or not 0 <= value <= maximum:
            raise ApplicationToolError('backtest_cost_or_capital_invalid')
    if capital <= 0:
        raise ApplicationToolError('backtest_capital_must_be_positive')
    if os.getenv('BACKTESTING_DATA_SOURCE', '').strip().lower() not in ('', 'none'):
        raise ApplicationToolError('backtest_external_data_override_not_allowed')
    return names, first, last


def _run(bot, symbols, start, end, capital, fee_bps, slippage_per_share) -> dict:
    names, first, last = _inputs(bot, symbols, start, end, capital, fee_bps, slippage_per_share)
    if not _RUN_LOCK.acquire(blocking=False):
        raise ApplicationToolError('backtest_busy_no_request_queued')
    try:
        import pandas as pd
        import pandas_market_calendars as calendars
        from lumibot.backtesting import PandasDataBacktesting
        from lumibot.entities import Asset, Data, TradingFee, TradingSlippage
        from lumibot.example_strategies.stock_buy_and_hold import BuyAndHold
        from lumibot.example_strategies.stock_momentum import Momentum

        class PandasMomentum(Momentum):
            # The installed example's Bars.get_last_price uses Series[-1], which
            # pandas 3 treats as a label. Preserve its rules; read the final row positionally.
            def get_assets_momentums(self):
                return [{'symbol': asset.symbol,
                         'return': bars.get_momentum(num_periods=self.period),
                         'price': float(bars.df['close'].iloc[-1])}
                        for asset, bars in self.get_bars(self.symbols, self.period + 2, timestep='day').items()]

        started = perf_counter()
        started_at = datetime.now(timezone.utc).isoformat()
        zone = 'America/New_York'
        data_start = first - timedelta(days=14)
        begin = pd.Timestamp(first, tz=zone).to_pydatetime()
        finish = pd.Timestamp(last, tz=zone).to_pydatetime()
        expected = set(calendars.get_calendar('NYSE').valid_days(start_date=data_start,
                       end_date=last - timedelta(days=1)).date)
        pandas_data, sources, input_snapshot = {}, [], []
        for symbol in names:
            history = get_historical_bars(AlpacaInstrumentRef(symbol=symbol), timeframe='1Day',
                start=pd.Timestamp(data_start, tz=zone).isoformat(), end=finish.isoformat(), limit=1000)
            if history.status != 'available' or history.truncated:
                raise ApplicationToolError(f'backtest_history_unavailable:{symbol}:{history.status}')
            frame = pd.DataFrame([{'datetime': row.timestamp, 'open': row.open, 'high': row.high,
                'low': row.low, 'close': row.close, 'volume': row.volume} for row in history.bars])
            if frame.empty:
                raise ApplicationToolError(f'backtest_empty_history:{symbol}')
            frame.index = pd.to_datetime(frame.pop('datetime'), utc=True).dt.tz_convert(zone)
            frame = frame.sort_index()
            # Alpaca's end bound is inclusive; this operation's simulation end is exclusive.
            frame = frame[(frame.index.date >= data_start) & (frame.index.date < last)]
            if frame.index.has_duplicates or set(frame.index.date) != expected:
                raise ApplicationToolError(f'backtest_daily_calendar_gap_or_duplicate:{symbol}')
            values = frame[['open', 'high', 'low', 'close', 'volume']]
            if not all(math.isfinite(float(value)) for value in values.to_numpy().ravel()) \
                    or (frame[['open', 'high', 'low', 'close']] <= 0).any().any() \
                    or (frame.volume < 0).any() or (frame.high < frame[['open', 'close', 'low']].max(axis=1)).any() \
                    or (frame.low > frame[['open', 'close']].min(axis=1)).any():
                raise ApplicationToolError(f'backtest_invalid_bars:{symbol}')
            asset = Asset(symbol=symbol, asset_type='stock')
            pandas_data[asset] = Data(asset, frame, timestep='day')
            sources.append({'symbol': symbol, 'barCount': len(frame), 'provider': history.provider,
                            'feed': history.feed, 'fetchedAt': history.fetchedAt, 'timeframe': '1Day',
                            'start': frame.index[0].isoformat(), 'end': frame.index[-1].isoformat()})
            input_snapshot.append({'symbol': symbol, 'bars': json.loads(
                frame.reset_index(names='timestamp').to_json(orient='records', date_format='iso'))})
        strategy_class = BuyAndHold if bot == 'buy_and_hold' else PandasMomentum
        parameters = {'buy_symbol': names[0]} if bot == 'buy_and_hold' else {'symbols': names}
        with TemporaryDirectory(prefix='trading-backtest-') as scratch:
            root = Path(scratch)
            fees = [TradingFee(percent_fee=fee_bps / 10000)]
            slips = [TradingSlippage(amount=slippage_per_share)]
            metrics, strategy = strategy_class.run_backtest(
                PandasDataBacktesting, begin, finish, pandas_data=pandas_data, parameters=parameters,
                budget=capital, benchmark_asset=None, risk_free_rate=0, auto_adjust=False,
                buy_trading_fees=fees, sell_trading_fees=fees,
                buy_trading_slippages=slips, sell_trading_slippages=slips,
                show_plot=False, show_tearsheet=False, save_tearsheet=False, show_indicators=False,
                show_progress_bar=False, quiet_logs=True, save_logfile=False, save_stats_file=True,
                stats_file=str(root / 'stats.csv'), logfile='',
                trades_file=str(root / 'trades.csv'), settings_file=str(root / 'settings.json'),
                plot_file_html=str(root / 'plot.html'), indicators_file=str(root / 'indicators.html'),
            )
            stats = pd.read_csv(root / 'stats.csv') if (root / 'stats.csv').exists() else pd.DataFrame()
            if not isinstance(metrics, dict) or stats.empty:
                raise ApplicationToolError('lumibot_backtest_did_not_produce_results')
            equity = [] if stats.empty else json.loads(stats[[key for key in
                ['datetime', 'portfolio_value', 'cash', 'return'] if key in stats]].to_json(orient='records'))
            return {'engine': 'LumiBot', 'version': version('lumibot'), 'bot': bot, 'mode': 'historical_simulation_only',
                'symbols': names, 'start': start, 'endExclusive': end, 'initialCapital': capital,
                'parameters': parameters, 'startedAt': started_at,
                'completedAt': datetime.now(timezone.utc).isoformat(),
                'dataCutoffExclusive': finish.isoformat(),
                'inputSnapshotSha256': hashlib.sha256(json.dumps(input_snapshot, sort_keys=True,
                    separators=(',', ':'), allow_nan=False).encode()).hexdigest(),
                '_inputSnapshot': input_snapshot,
                'endingPortfolioValue': float(strategy.get_portfolio_value()), 'sources': sources,
                'costs': {'feeBpsPerSide': fee_bps, 'slippagePerSharePerSide': slippage_per_share},
                'metrics': json.loads(json.dumps(metrics, default=str), parse_constant=lambda _: None), 'equity': equity,
                'computeSeconds': round(perf_counter() - started, 3), 'brokerOrdersSubmitted': False,
                'limitations': ['Historical simulation, not a live or paper broker fill.',
                    'Raw Alpaca IEX bars; corporate actions/dividends are not modeled here.',
                    'Upstream daily-bar fill assumptions and two-day momentum example are retained.',
                    'Historical reads are retrieved now, not a point-in-time archived data vintage.',
                    'No independent predictive-accuracy or profitability claim follows from this run.']}
    except ApplicationToolError:
        raise
    except Exception as error:
        raise ApplicationToolError(f'lumibot_backtest_failed:{type(error).__name__}') from error
    finally:
        _RUN_LOCK.release()


def _public_backtest(row) -> dict:
    return {**row['snapshot']['result'], 'backtestId': str(row['lifecycle_run_id']),
            'producerCardId': row['card_id'], 'cardRevisionId': str(row['card_revision_id']),
            'sourceExecution': row['source_execution'], 'savedAt': row['created_at'].isoformat()}


def _run_and_retain(project_id, deck_id, card_id, execution, bot, symbols, start, end,
                    capital, fee_bps, slippage_per_share) -> dict:
    names, first, last = _inputs(bot, symbols, start, end, capital, fee_bps, slippage_per_share)
    request = dict(bot=bot, symbols=names, start=first.isoformat(), end=last.isoformat(),
                   capital=capital, fee_bps=fee_bps, slippage_per_share=slippage_per_share)
    with connect_postgres() as connection, connection.cursor(row_factory=dict_row) as cursor:
        cursor.execute(
            """SELECT card.current_revision_id, revision.runtime_profile FROM ag_catalog.agent_cards card
               JOIN ag_catalog.agent_card_revisions revision ON revision.revision_id=card.current_revision_id
               WHERE card.project_id=%s AND card.deck_id=%s AND card.card_id=%s
                 AND revision.runtime_kind='hermes' AND revision.runtime_mode='delegate' AND revision.enabled
                 AND EXISTS (SELECT 1 FROM ag_catalog.card_capability_grants g
                             WHERE g.revision_id=card.current_revision_id AND g.grant_kind='tool'
                               AND g.grant_id='trading.backtest')""",
            (project_id, deck_id, card_id),
        )
        card = cursor.fetchone()
        if not card:
            raise ApplicationToolError('backtest_card_grant_required')
        execution = _execution_reference(execution, card['runtime_profile'])
        key = hashlib.sha256(json.dumps(execution, sort_keys=True).encode()).hexdigest()
        try:
            cursor.execute(
                """SELECT * FROM ag_catalog.trading_lifecycle_runs
                   WHERE project_id=%s AND deck_id=%s AND card_id=%s AND idempotency_key=%s""",
                (project_id, deck_id, card_id, key),
            )
            existing = cursor.fetchone()
        except psycopg.Error:
            existing = None
        if existing:
            if existing['snapshot']['request'] != request:
                raise ApplicationToolError('backtest_execution_reference_conflict')
            return _public_backtest(existing)
    result = _run(**request)
    inputs = result.pop('_inputSnapshot')
    snapshot = {'request': request, 'result': result, 'inputSnapshot': inputs}
    provenance = {'sources': result['sources'], 'inputSnapshotSha256': result['inputSnapshotSha256'],
                  'dataCutoffExclusive': result['dataCutoffExclusive']}
    record_id = str(uuid4())
    try:
        return _retain_backtest(project_id, deck_id, card_id, card, execution, key, names,
                                request, result, snapshot, provenance, record_id)
    except psycopg.Error:
        return {**result, 'producerCardId': card_id, 'cardRevisionId': str(card['current_revision_id']),
                'sourceExecution': execution, 'persistence': {'status': 'unconfirmed', 'reference': record_id,
                    'reason': 'Simulation completed; PostgreSQL retention was not confirmed. No broker execution is implied.'}}


def _retain_backtest(project_id, deck_id, card_id, card, execution, key, names,
                     request, result, snapshot, provenance, record_id):
    with connect_postgres() as connection, connection.cursor(row_factory=dict_row) as cursor:
        cursor.execute(
            """INSERT INTO ag_catalog.trading_lifecycle_runs
               (lifecycle_run_id, project_id, deck_id, card_id, card_revision_id, idempotency_key,
                mode, status, symbols, source_execution, data_provenance, snapshot, started_at, finished_at)
               VALUES (%s,%s,%s,%s,%s,%s,'local_backtest','completed',%s::jsonb,%s::jsonb,%s::jsonb,%s::jsonb,%s,%s)
               ON CONFLICT (project_id, deck_id, card_id, idempotency_key) DO NOTHING RETURNING *""",
            (record_id, project_id, deck_id, card_id, card['current_revision_id'], key,
             json.dumps(names), json.dumps(execution), json.dumps(provenance, allow_nan=False),
             json.dumps(snapshot, allow_nan=False), result['startedAt'], result['completedAt']),
        )
        saved = cursor.fetchone()
        if saved is None:
            cursor.execute(
                """SELECT * FROM ag_catalog.trading_lifecycle_runs
                   WHERE project_id=%s AND deck_id=%s AND card_id=%s AND idempotency_key=%s""",
                (project_id, deck_id, card_id, key),
            )
            saved = cursor.fetchone()
            if saved['snapshot']['request'] != request:
                raise ApplicationToolError('backtest_execution_reference_conflict')
    return _public_backtest(saved)


def read_backtest(project_id: str, deck_id: str, backtest_id: str) -> dict:
    try:
        identity = str(UUID(backtest_id))
    except (TypeError, ValueError):
        raise ApplicationToolError('backtest_id_invalid') from None
    with connect_postgres() as connection, connection.cursor(row_factory=dict_row) as cursor:
        cursor.execute(
            """SELECT * FROM ag_catalog.trading_lifecycle_runs
               WHERE lifecycle_run_id=%s AND project_id=%s AND deck_id=%s AND status='completed'""",
            (identity, project_id, deck_id),
        )
        row = cursor.fetchone()
    if row is None:
        raise ApplicationToolError('backtest_not_found')
    return _public_backtest(row)


async def trading_get_backtest(*, backtestId: str, projectId: str, deckId: str) -> dict:
    return await asyncio.to_thread(read_backtest, projectId, deckId, backtestId)


async def trading_backtest(*, bot: str, symbols: list[str], start: str, end: str,
                           capital: float, projectId: str, deckId: str, _callerCardId: str,
                           _sourceExecution: dict, fee_bps: float = 0, slippage_per_share: float = 0) -> dict:
    try:
        return await asyncio.to_thread(_run_and_retain, projectId, deckId, _callerCardId,
            _sourceExecution, bot, symbols, start, end, capital, fee_bps, slippage_per_share)
    except TradingBoundaryError as error:
        raise ApplicationToolError(str(error)) from None
