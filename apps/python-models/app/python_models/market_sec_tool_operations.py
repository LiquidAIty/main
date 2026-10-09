"""Market-data and SEC-read Python tool handlers and definitions."""

from __future__ import annotations

import asyncio
from typing import Any

from app.python_models.alpaca_market_data import (
    AlpacaInstrumentRef,
    get_historical_bars,
    get_market_snapshot,
    get_paper_account_readiness,
)
from app.python_models.operation_definition import OperationDefinition
from app.python_models.sec_filing_signals import (
    IssuerRef,
    SecFilingQuery,
    find_recent_sec_filing_signals,
)

async def find_recent_sec_filing_signals_tool(
    form_types: list[str],
    from_date: str,
    to_date: str,
    issuer_ticker: str | None = None,
    issuer_cik: str | None = None,
    issuer_company_name: str | None = None,
    limit: int = 10,
) -> dict[str, Any]:
    query = SecFilingQuery(
        issuer=IssuerRef(
            ticker=(str(issuer_ticker).strip() or None) if issuer_ticker else None,
            cik=(str(issuer_cik).strip() or None) if issuer_cik else None,
            companyName=(
                (str(issuer_company_name).strip() or None)
                if issuer_company_name else None
            ),
        ),
        formTypes=[str(value).strip() for value in form_types or [] if str(value).strip()],
        fromDate=str(from_date or "").strip(),
        toDate=str(to_date or "").strip(),
        limit=limit if isinstance(limit, int) else 10,
    )
    return (await asyncio.to_thread(find_recent_sec_filing_signals, query)).to_dict()


async def get_market_snapshot_tool(
    symbol: str, feed: str = "iex",
) -> dict[str, Any]:
    instrument = AlpacaInstrumentRef(symbol=str(symbol or "").strip())
    return (await asyncio.to_thread(
        lambda: get_market_snapshot(instrument, feed=feed)
    )).to_dict()


async def get_historical_bars_tool(
    symbol: str,
    timeframe: str,
    start: str | None = None,
    end: str | None = None,
    limit: int = 100,
    feed: str = "iex",
) -> dict[str, Any]:
    instrument = AlpacaInstrumentRef(symbol=str(symbol or "").strip())
    return (await asyncio.to_thread(
        lambda: get_historical_bars(
            instrument,
            str(timeframe or "").strip(),
            start=start,
            end=end,
            limit=limit if isinstance(limit, int) else 100,
            feed=feed,
        )
    )).to_dict()


async def get_paper_account_readiness_tool() -> dict[str, Any]:
    return (await asyncio.to_thread(get_paper_account_readiness)).to_dict()
def _annotations(
    *, read_only: bool, destructive: bool, idempotent: bool, open_world: bool,
) -> dict[str, bool]:
    return {
        "readOnlyHint": read_only,
        "destructiveHint": destructive,
        "idempotentHint": idempotent,
        "openWorldHint": open_world,
    }
def market_sec_tool_operation_definitions() -> list[OperationDefinition]:
    internal = frozenset({"internal-plugin"})
    read_open = _annotations(
        read_only=True, destructive=False, idempotent=True, open_world=True,
    )
    return [
        OperationDefinition(
            canonical_id="find_recent_sec_filing_signals",
            title="Find recent SEC filing signals",
            description=(
                "Find recent SEC filings for an EXPLICITLY supplied issuer, form types, and "
                "bounded time window via the SEC filing provider. Read-only WorldSignals lane: "
                "returns typed filing-signal envelopes with provider status, issuer identity, "
                "form type, filing timestamp, the canonical SEC.gov filing URL, and a replay "
                "identity. Use it only when the selected task explicitly asks for an issuer's "
                "recent filings. Do not call it merely because a ticker is mentioned. It performs "
                "no graph write, no research execution, and no trade. Returns provider_unconfigured "
                "when the SEC provider is not configured; never fabricates filings."
            ),
            parameters_schema={
                "type": "object",
                "properties": {
                    "form_types": {"type": "array", "items": {"type": "string"}},
                    "from_date": {"type": "string"},
                    "to_date": {"type": "string"},
                    "issuer_ticker": {"type": ["string", "null"]},
                    "issuer_cik": {"type": ["string", "null"]},
                    "issuer_company_name": {"type": ["string", "null"]},
                    "limit": {"type": "integer", "default": 10},
                },
                "required": ["form_types", "from_date", "to_date"],
            },
            output_schema={
                "type": "object",
                "properties": {
                    "status": {"type": "string", "enum": [
                        "available", "provider_unconfigured", "provider_error",
                        "invalid_response",
                    ]},
                    "provider": {"type": "string"},
                    "fetchedAt": {"type": "string"},
                    "replay": {"type": "object"},
                    "envelopes": {"type": "array"},
                    "error": {"type": ["string", "null"]},
                },
            },
            handler=find_recent_sec_filing_signals_tool,
            available=True,
            publishers=internal,
            access="read",
            namespace="python",
            external_source_id="python_runtime",
            annotations=read_open,
        ),
        OperationDefinition(
            canonical_id="get_market_snapshot",
            title="Get a market snapshot",
            description=(
                "Read-only Alpaca latest market snapshot for an EXPLICITLY supplied symbol "
                "(paper data feed). Returns provider/feed identity, latest trade/quote, observed "
                "timestamp, freshness, and status. Use only when the selected task explicitly "
                "needs a symbol's latest market data. It places no order, mutates no position or "
                "account, and never calls a live trading endpoint. Returns provider_unconfigured "
                "when paper credentials are not configured; never fabricates a snapshot."
            ),
            parameters_schema={
                "type": "object",
                "properties": {
                    "symbol": {"type": "string"},
                    "feed": {"type": "string", "default": "iex"},
                },
                "required": ["symbol"],
            },
            output_schema={
                "type": "object",
                "properties": {
                    "provider": {"type": "string"},
                    "feed": {"type": ["string", "null"]},
                    "symbol": {"type": "string"},
                    "status": {"type": "string"},
                    "observedAt": {"type": ["string", "null"]},
                    "latestTradePrice": {"type": ["number", "null"]},
                    "freshness": {"type": ["string", "null"]},
                },
            },
            handler=get_market_snapshot_tool,
            available=True,
            publishers=internal,
            access="read",
            namespace="python",
            external_source_id="python_runtime",
            annotations=read_open,
        ),
        OperationDefinition(
            canonical_id="get_historical_bars",
            title="Get historical market bars",
            description=(
                "Read-only Alpaca bounded historical bars for an EXPLICITLY supplied symbol and "
                "timeframe (paper data feed). Returns provider/feed identity, the bars, and "
                "status. Use only when the selected task explicitly needs historical bars. It "
                "places no order, mutates nothing, does no streaming, and never calls a live "
                "endpoint. Returns provider_unconfigured when paper credentials are not configured."
            ),
            parameters_schema={
                "type": "object",
                "properties": {
                    "symbol": {"type": "string"},
                    "timeframe": {"type": "string"},
                    "start": {"type": ["string", "null"]},
                    "end": {"type": ["string", "null"]},
                    "limit": {"type": "integer", "default": 100},
                    "feed": {"type": "string", "default": "iex"},
                },
                "required": ["symbol", "timeframe"],
            },
            output_schema={
                "type": "object",
                "properties": {
                    "provider": {"type": "string"},
                    "feed": {"type": ["string", "null"]},
                    "symbol": {"type": "string"},
                    "timeframe": {"type": "string"},
                    "status": {"type": "string"},
                    "bars": {"type": "array"},
                },
            },
            handler=get_historical_bars_tool,
            available=True,
            publishers=internal,
            access="read",
            namespace="python",
            external_source_id="python_runtime",
            annotations=read_open,
        ),
        OperationDefinition(
            canonical_id="get_paper_account_readiness",
            title="Check paper account readiness",
            description=(
                "Confirm Alpaca PAPER account availability and status only. Read-only: it returns "
                "no positions, no orders, no balances, and mutates nothing. Use only to verify the "
                "paper account is reachable. Returns provider_unconfigured when paper credentials "
                "are not configured; never fabricates account state."
            ),
            parameters_schema={
                "type": "object", "properties": {}, "required": [],
            },
            output_schema={
                "type": "object",
                "properties": {
                    "provider": {"type": "string"},
                    "status": {"type": "string"},
                    "mode": {"type": "string"},
                    "accountStatus": {"type": ["string", "null"]},
                },
            },
            handler=get_paper_account_readiness_tool,
            available=True,
            publishers=internal,
            access="read",
            namespace="python",
            external_source_id="python_runtime",
            annotations=read_open,
        ),
    ]

