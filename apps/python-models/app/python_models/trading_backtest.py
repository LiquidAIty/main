"""Bounded use of installed LumiBot strategies, with historical simulation only."""
# Entity: Trading
# Relationship: Lets saved Cards inspect and backtest selected upstream LumiBot bots against validated historical bars without a broker connection, scheduler, or alternate result store.
from __future__ import annotations

import asyncio
from datetime import date, datetime, timedelta
from importlib.metadata import version
import json
import math
import os
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Lock
from time import perf_counter
from zoneinfo import ZoneInfo

from app.application_tool_error import ApplicationToolError
from app.python_models.alpaca_market_data import AlpacaInstrumentRef, get_historical_bars

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
        zone = 'America/New_York'
        data_start = first - timedelta(days=14)
        begin = pd.Timestamp(first, tz=zone).to_pydatetime()
        finish = pd.Timestamp(last, tz=zone).to_pydatetime()
        expected = set(calendars.get_calendar('NYSE').valid_days(start_date=data_start,
                       end_date=last - timedelta(days=1)).date)
        pandas_data, sources = {}, []
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
            sources.append({'symbol': symbol, 'barCount': len(frame), 'feed': history.feed,
                            'start': frame.index[0].isoformat(), 'end': frame.index[-1].isoformat()})
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
                'endingPortfolioValue': float(strategy.get_portfolio_value()), 'sources': sources,
                'costs': {'feeBpsPerSide': fee_bps, 'slippagePerSharePerSide': slippage_per_share},
                'metrics': json.loads(json.dumps(metrics, default=str)), 'equity': equity,
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


async def trading_backtest(*, bot: str, symbols: list[str], start: str, end: str,
                           capital: float, fee_bps: float = 0, slippage_per_share: float = 0) -> dict:
    return await asyncio.to_thread(_run, bot, symbols, start, end, capital, fee_bps, slippage_per_share)
