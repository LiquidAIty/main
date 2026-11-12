"""Real upstream tool bindings, with deterministic market fixtures and no agent runtime."""
# Entity: Trading
# Relationship: Verifies the existing LumiBot functions execute under the read-only adapter and rejects unexposed broker operations, unsafe arguments and concurrent observer use.
import asyncio
from datetime import datetime, timezone
import inspect
import json
from types import SimpleNamespace

import pytest

from app.application_tool_error import ApplicationToolError
from app.python_models import trading_lumibot_tools as tools


class MarketFixture:
    def get_datetime(self):
        return datetime(2026, 11, 11, tzinfo=timezone.utc)

    def get_chains(self, asset):
        assert asset.symbol == 'RDW'
        return {'Chains': {'CALL': {'2027-01-15': [10, 15]}, 'PUT': {'2027-01-15': [10, 15]}}}

    def get_greeks(self, asset, **arguments):
        assert asset.symbol == 'RDW' and asset.strike == 15 and asset.right == 'CALL'
        assert asset.expiration.isoformat() == '2027-01-15'
        assert arguments == {'asset_price': 1.5, 'underlying_price': 14, 'risk_free_rate': .04, 'query_greeks': False}
        return {'delta': .4, 'fixture': True}


def test_public_lumibot_chain_strike_and_greek_tools_are_bound_without_an_agent_manager():
    observer = MarketFixture()
    chain = tools.run_research_tool('options_get_chain', {'symbol': 'RDW'}, observer=observer)
    assert chain['tool'] == 'options_get_chain' and chain['engine'] == 'LumiBot'
    assert chain['result']['call_expirations'] == ['2027-01-15']
    assert chain['result']['calls']['2027-01-15']['strike_count'] == 2
    assert 'strikes' not in chain['result']['calls']['2027-01-15']
    strikes = tools.run_research_tool('options_get_strikes', {'symbol': 'RDW', 'expiration': '2027-01-15', 'right': 'call'}, observer=observer)
    assert strikes['result']['strikes'] == [10, 15]
    result = tools.run_research_tool('options_get_greeks', {'symbol': 'RDW', 'expiration': '2027-01-15',
        'strike': 15, 'right': 'call', 'underlying_price': 14, 'option_price': 1.5, 'risk_free_rate': .04}, observer=observer)
    assert result['result']['greeks'] == {'delta': .4, 'fixture': True}
    assert result['execution_authorized'] is False


def test_pinned_upstream_function_signatures_accept_every_published_argument():
    from lumibot.components.agents import BuiltinTools
    for name, (group, factory, properties, _, _) in tools.RESEARCH_TOOLS.items():
        bound = getattr(getattr(BuiltinTools, group), factory)().binder(MarketFixture(), None)
        assert bound.name == name
        assert set(properties) <= set(inspect.signature(bound.function).parameters)
        assert not bound.metadata.get('mutates_trading')
    assert all(definition.access == 'read' and definition.annotations['readOnlyHint'] for definition in tools.research_definitions())


@pytest.mark.parametrize('name,args', [
    ('orders_submit', {'symbol': 'RDW'}),
    ('market_quote', {'symbol': 'RDW', 'asset_type': 'invented-market'}),
    ('market_quote', {'symbol': 'RDW', 'asset_type': 'option'}),
    ('market_quote', {'symbol': 'CL', 'asset_type': 'future'}),
    ('market_quote', {'symbol': 'BTC', 'asset_type': 'crypto'}),
    ('market_last_price', {'symbol': 'EUR', 'asset_type': 'forex'}),
    ('market_historical_prices', {'symbols': ['RDW'], 'length': 20, 'timestep': '5minute'}),
    ('options_get_chain', {'symbol': 'RDW', 'submit_order': True}),
    ('options_get_chain', {'symbol': 'RDW', 'max_expiration': '2027-02-31'}),
    ('options_get_greeks', {'symbol': 'RDW', 'expiration': '2027-01-15', 'strike': float('nan'), 'right': 'call'}),
    ('options_calculate_multileg_price', {'legs_json': json.dumps([{}] * 9)}),
])
def test_unsafe_or_unexposed_calls_never_resolve_a_broker(monkeypatch, name, args):
    monkeypatch.setattr(tools, '_resolve_paper_observer', lambda: pytest.fail('must validate before broker access'))
    with pytest.raises(ApplicationToolError):
        tools.run_research_tool(name, args)


def test_shared_observer_contention_is_reported_without_queuing():
    assert tools._broker_read_lock.acquire(blocking=False)
    try:
        with pytest.raises(ApplicationToolError, match='busy_no_request_queued'):
            tools.run_research_tool('options_get_chain', {'symbol': 'RDW'}, observer=MarketFixture())
    finally:
        tools._broker_read_lock.release()


@pytest.mark.parametrize('after_hours', [None, False, True])
def test_history_passes_actual_default_and_keeps_provider_work_serial(after_hours):
    class Observer(MarketFixture):
        def get_historical_prices_for_assets(self, symbols, length, **arguments):
            assert symbols == ['RDW'] and length == 20
            assert arguments['include_after_hours'] is (False if after_hours is None else after_hours)
            assert arguments['max_workers'] == 1 and arguments['chunk_size'] == 5
            return {}
    arguments = {'symbols': ['RDW'], 'length': 20}
    if after_hours is not None:
        arguments['include_after_hours'] = after_hours
    result = tools.run_research_tool('market_historical_prices', arguments, observer=Observer())
    assert result['result']['symbols_missing'] == ['RDW']


def test_crypto_quote_preserves_base_and_quote_without_order_authority():
    class Observer(MarketFixture):
        def get_quote(self, asset, *, quote, exchange):
            assert asset.symbol == 'BTC' and asset.asset_type == 'crypto'
            assert quote.symbol == 'USD' and exchange is None
            return SimpleNamespace(asset=asset, price=100, bid=99, ask=101)
        def submit_order(self, *args, **kwargs):
            pytest.fail('research must never submit')
    result = tools.run_research_tool('market_quote', {'symbol': 'BTC', 'asset_type': 'crypto', 'quote_symbol': 'USD'}, observer=Observer())
    assert result['result']['quote']['symbol'] == 'USD'
    assert result['result']['bid'] == 99 and result['execution_authorized'] is False


@pytest.mark.parametrize('quantity', [2, 0, -1, .5, True])
def test_multileg_price_never_prices_an_unsupported_ratio(monkeypatch, quantity):
    monkeypatch.setattr(tools, '_resolve_paper_observer', lambda: pytest.fail('reject before provider access'))
    leg = {'symbol': 'RDW', 'expiration': '2027-01-15', 'strike': 10, 'right': 'call', 'quantity': 1, 'side': 'buy_to_open'}
    with pytest.raises(ApplicationToolError, match='arguments_invalid'):
        tools.run_research_tool('options_calculate_multileg_price', {'legs_json': json.dumps([leg, {**leg, 'quantity': quantity}])})


def test_equal_unit_spread_uses_real_upstream_pricing_without_submission():
    from lumibot.entities import Order
    class Observer(MarketFixture):
        def create_order(self, asset, quantity, side, **kwargs):
            return Order('ResearchFixture', asset, quantity, side, **kwargs)
        def get_quote(self, asset):
            bid, ask = (1.9, 2.1) if asset.strike == 10 else (1.4, 1.6)
            return SimpleNamespace(asset=asset, bid=bid, ask=ask)
        def log_message(self, *args, **kwargs):
            pass
        def submit_order(self, *args, **kwargs):
            pytest.fail('price preview must never submit')
    leg = {'symbol': 'RDW', 'expiration': '2027-01-15', 'strike': 10, 'right': 'call', 'quantity': 1, 'side': 'buy_to_open'}
    result = tools.run_research_tool('options_calculate_multileg_price', {'legs_json': json.dumps([
        leg, {**leg, 'strike': 15, 'side': 'sell_to_open'}])}, observer=Observer())['result']
    assert result['preview_only'] is True and result['available'] is True
    assert result['net_limit_price'] == .5 and result['order_type'] == 'debit'
    assert sum(row['pricing']['signed_price'] for row in result['legs']) == result['net_limit_price']


@pytest.mark.parametrize('asset_type,symbol', [('future', 'CL'), ('forex', 'EUR'), ('index', 'SPX'), ('cont_future', 'ES')])
def test_alpaca_does_not_mislabel_an_equity_quote_as_another_market(asset_type, symbol):
    observer = SimpleNamespace(broker=SimpleNamespace(name='alpaca'))
    for name in ('market_quote', 'market_last_price'):
        arguments = {'symbol': symbol, 'asset_type': asset_type}
        if asset_type == 'future':
            arguments['expiration'] = '2027-01-20'
        if asset_type == 'forex':
            arguments['quote_symbol'] = 'USD'
        result = tools.run_research_tool(name, arguments, observer=observer)
        assert result['status'] == 'provider_unavailable_for_asset_type'
        assert result['requested_asset_type'] == asset_type
        assert result['execution_authorized'] is False


def test_canonical_handler_calls_upstream_tool_and_rejects_missing_grants(monkeypatch):
    from app import mcp_auth, mcp_catalog_runtime, mcp_host
    from mcp.types import CallToolRequestParams
    monkeypatch.setattr(tools, '_resolve_paper_observer', lambda: (MarketFixture(), None))
    context = {'projectId': 'p', 'deckId': 'd', 'callerCardId': 'designer', 'conversationId': 'c',
               'grantedTools': ['trading.options_get_chain']}
    monkeypatch.setattr(mcp_auth, 'authenticated_project_context', lambda: context)
    monkeypatch.setattr(mcp_auth, 'internal_mcp_principal', lambda: {'kind': 'card-runtime', 'profile': 'designer'})
    monkeypatch.setattr(mcp_catalog_runtime, 'published_mcp_tool_names', lambda: frozenset({'trading.options_get_chain'}))
    def call():
        return asyncio.run(mcp_host._server_call_tool(None, CallToolRequestParams(
            name='trading.options_get_chain', arguments={'symbol': 'RDW'})))
    result = call()
    assert result.is_error is not True
    assert json.loads(result.content[0].text)['result']['call_expirations'] == ['2027-01-15']
    context['grantedTools'] = []
    assert call().is_error is True
