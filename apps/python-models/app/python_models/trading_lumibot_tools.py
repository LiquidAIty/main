"""Selected upstream LumiBot research functions beneath saved Hermes Cards."""
# Entity: Trading
# Relationship: Publishes selected read-only LumiBot built-in tools through the existing MCP catalog and paper observer, without constructing a LumiBot agent runtime or exposing broker mutations.

from __future__ import annotations

import asyncio
from importlib.metadata import version
import json

from app.application_tool_error import ApplicationToolError
from app.python_models.operation_definition import OperationDefinition
from app.python_models.trading_broker_observation import _broker_read_lock, _resolve_paper_observer

_TEXT = {"type": "string", "minLength": 1, "maxLength": 80}
_DATE = {"type": "string", "format": "date", "minLength": 10, "maxLength": 10}
_PRICE = {"type": "number", "exclusiveMinimum": 0, "maximum": 1000000000}
_ASSET_TYPE = {"type": "string", "enum": ["stock", "option", "future", "cont_future", "forex", "crypto", "index"], "default": "stock"}
_ASSET = {"symbol": _TEXT, "asset_type": _ASSET_TYPE,
          "expiration": _DATE, "strike": _PRICE,
          "right": {"type": "string", "enum": ["call", "put"]}, "quote_symbol": _TEXT, "exchange": _TEXT}
_CONTRACT = {"symbol": _TEXT, "expiration": _DATE,
             "strike": _PRICE, "right": {"type": "string", "enum": ["call", "put"]}}
# Exact upstream public factories/signatures in the single pinned LumiBot build.
# The catalog does not instantiate a broker, AgentManager, ADK or another runtime.
RESEARCH_TOOLS = {
    "market_quote": ("market", "quote", _ASSET, ["symbol"],
        "Read an exact equity/ETF, option, commodity/futures, forex, crypto or index quote through LumiBot. Provider coverage must support the requested asset type; unsupported markets return unavailable, never an equity substitution."),
    "market_last_price": ("market", "last_price", _ASSET, ["symbol"],
        "Read an exact instrument's provider price through LumiBot across supported asset classes. Alpaca may return a quote midpoint or one-sided quote, not the last trade. This is not an executable offer. Provider coverage remains explicit."),
    "market_historical_prices": ("market", "historical_prices", {
        "symbols": {"type": "array", "items": _TEXT, "minItems": 1, "maxItems": 5, "uniqueItems": True},
        "length": {"type": "integer", "minimum": 1, "maximum": 500},
        "timestep": {"type": "string", "enum": ["minute", "day"], "default": "day"},
        "asset_type": _ASSET_TYPE, "quote_symbol": _TEXT, "exchange": _TEXT,
        "include_after_hours": {"type": "boolean", "default": False},
    }, ["symbols", "length"], "Read bounded minute/daily historical bars for up to five instruments through LumiBot. Returns actual coverage and missing symbols; exact option or dated-future history is unavailable through this upstream signature. Longer intraday intervals use the separately granted historical-bar tool. This is a data read, not a strategy backtest."),
    "options_get_chain": ("options", "get_chain", {"symbol": _TEXT,
        "include_strikes": {"type": "boolean", "default": False},
        "max_expiration": _DATE}, ["symbol"],
        "Read LumiBot's listed expirations and strike ranges for a stock/ETF. Start compact; get exact strikes separately. max_expiration widens supported backtest windows, not a guarantee of complete live coverage."),
    "options_get_strikes": ("options", "get_strikes", {key: value for key, value in _CONTRACT.items() if key != "strike"},
        ["symbol", "expiration", "right"], "Read listed strikes for one exact expiry and right using LumiBot. Do not invent contracts absent from the result."),
    "options_get_greeks": ("options", "get_greeks", {**_CONTRACT,
        "underlying_price": _PRICE, "option_price": _PRICE,
        "risk_free_rate": {"type": "number", "minimum": -1, "maximum": 1},
        "query_greeks": {"type": "boolean", "default": False}}, list(_CONTRACT),
        "Use LumiBot's exact-contract Greeks calculation/provider query. Explicit prices/rates are caller assumptions, not verified observations; missing results remain unavailable."),
    "options_evaluate_market": ("options", "evaluate_market", {**_CONTRACT,
        "max_spread_pct": {"type": "number", "minimum": 0, "maximum": 10}}, list(_CONTRACT),
        "Use LumiBot's exact-contract bid/ask, spread and quote-quality evaluation. Pass a spread limit only from the user's policy. This does not verify a fill or approve an order."),
    "options_calculate_multileg_price": ("options", "calculate_multileg_price", {
        "legs_json": {"type": "string", "minLength": 2, "maxLength": 12000},
        "price_style": {"type": "string", "enum": ["best", "mid", "fastest"], "default": "mid"},
    }, ["legs_json"], "Use LumiBot to price one equal-unit research spread of 2–8 exact option legs without submitting it. legs_json requires symbol, expiration, strike, right, quantity=1 and side (buy_to_open/sell_to_open). Unequal ratios are not supported by this upstream price preview. The result is per spread unit, not total capital or maximum loss. Inspect each final leg's Greeks and quote quality first."),
}


def _parameters(name, properties, required):
    schema = {"type": "object", "properties": properties, "required": required, "additionalProperties": False}
    if "asset_type" in properties:
        schema["allOf"] = [{"if": {"properties": {"asset_type": {"enum": ["crypto", "forex"]}}, "required": ["asset_type"]},
                            "then": {"required": ["quote_symbol"]}}]
    if name in {"market_quote", "market_last_price"}:
        schema["allOf"] += [
            {"if": {"properties": {"asset_type": {"const": "option"}}, "required": ["asset_type"]},
             "then": {"required": ["expiration", "strike", "right"]}},
            {"if": {"properties": {"asset_type": {"const": "future"}}, "required": ["asset_type"]},
             "then": {"required": ["expiration"]}},
        ]
    return schema


def run_research_tool(name, arguments, *, observer=None):
    if name not in RESEARCH_TOOLS:
        raise ApplicationToolError("lumibot_research_tool_not_exposed")
    group, factory, properties, required, _ = RESEARCH_TOOLS[name]
    from jsonschema import validate, ValidationError, FormatChecker
    try:
        validate(arguments, _parameters(name, properties, required), format_checker=FormatChecker())
        json.dumps(arguments, allow_nan=False)
        if name == "options_calculate_multileg_price":
            legs = json.loads(arguments["legs_json"])
            validate(legs, {"type": "array", "minItems": 2, "maxItems": 8,
                "items": {"type": "object", "additionalProperties": False,
                    "properties": {**_CONTRACT, "quantity": {"type": "integer", "const": 1},
                        "side": {"enum": ["buy_to_open", "sell_to_open"]}},
                    "required": [*_CONTRACT, "quantity", "side"]}}, format_checker=FormatChecker())
            json.dumps(legs, allow_nan=False)
    except (ValidationError, TypeError, ValueError):
        raise ApplicationToolError("lumibot_research_arguments_invalid") from None
    if observer is None:
        observer, failure = _resolve_paper_observer()
        if observer is None:
            return {"status": "unavailable", "connection": failure["connection"], "execution_authorized": False}
    asset_type = arguments.get("asset_type", "stock")
    # The pinned AlpacaData.get_quote's final branch treats every other type as
    # stock. Never let a commodity future such as CL become a Colgate equity quote.
    provider = str(getattr(getattr(observer, "broker", None), "name", "")).lower()
    if provider == "alpaca" and asset_type not in {"stock", "option", "crypto"}:
        return {"status": "provider_unavailable_for_asset_type", "provider": provider,
                "requested_asset_type": asset_type, "requested": arguments, "execution_authorized": False,
                "reason": "The connected Alpaca data source supports equities/ETFs, options and crypto. Connect an appropriate provider for this market; no stock-price substitution was made."}
    if name == "market_historical_prices" and asset_type in {"option", "future"}:
        return {"status": "exact_contract_required", "execution_authorized": False,
                "reason": "This upstream history signature cannot express a dated contract. Do not substitute underlying or another contract's history."}
    if not _broker_read_lock.acquire(blocking=False):
        raise ApplicationToolError("lumibot_observer_busy_no_request_queued")
    try:
        from lumibot.components.agents import BuiltinTools
        bound = getattr(getattr(BuiltinTools, group), factory)().binder(observer, None)
        if bound.name != name or bound.metadata.get("mutates_trading"):
            raise ApplicationToolError("lumibot_research_contract_changed")
        call_arguments = {"include_after_hours": False, **arguments, "max_workers": 1, "chunk_size": 5} if name == "market_historical_prices" else arguments
        result = bound.function(**call_arguments)
        if len(json.dumps(result, allow_nan=False)) > 200000:
            raise ApplicationToolError("lumibot_research_result_too_large_use_compact_request")
        return {"engine": "LumiBot", "version": version("lumibot"), "tool": name,
                "result": result, "execution_authorized": False,
                "limitations": ["Hermes owns the agent; this is a LumiBot research function, not a separate agent run.",
                    "Provider feed/entitlement and observation freshness are not inferred from credentials or the strategy clock. Indicative option quotes may be modified and are not executable prices.",
                    "Alpaca's last-price function can return quote midpoint, bid or ask rather than the last trade. Spread previews are per equal unit, not quantity-weighted capital or maximum loss.",
                    "LumiBot may calculate Greeks or price assumptions. Preserve unavailable values and distinguish calculations from sourced observations.",
                    "Adjusted deliverables, settlement, short collateral and cross-currency capital equivalence require separate verification."]}
    except ApplicationToolError:
        raise
    except Exception as error:
        raise ApplicationToolError(f"lumibot_research_failed:{type(error).__name__}") from None
    finally:
        _broker_read_lock.release()


def research_definitions():
    def handler_for(name):
        async def handler(**arguments):
            return await asyncio.to_thread(run_research_tool, name, arguments)
        return handler
    return [OperationDefinition(canonical_id=f"trading.{name}", title=f"LumiBot {name.replace('_', ' ')}",
        description=description + " Use the underlying/base symbol, not a combined pair or OCC option code; pair requests require quote_symbol. Research only; no order submission, portfolio mutation or new agent runtime.",
        parameters_schema=_parameters(name, properties, required),
        output_schema={"type": "object"}, handler=handler_for(name), available=True,
        publishers=frozenset({"internal-plugin"}), access="read", namespace="trading", grant_eligible=True,
        external_source_id="python_runtime", annotations={"readOnlyHint": True, "destructiveHint": False,
            "idempotentHint": True, "openWorldHint": True})
        for name, (_, _, properties, required, description) in RESEARCH_TOOLS.items()]
