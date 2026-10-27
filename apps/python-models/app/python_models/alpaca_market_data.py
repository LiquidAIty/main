"""Alpaca read-only paper/market-data provider boundary — WorldSignals rail.

Read-only only. This module NEVER places an order, mutates a position/account/watchlist,
streams, polls, or touches a live trading endpoint. It exposes three bounded reads:

  * ``get_market_snapshot``         — latest snapshot for an explicit instrument
  * ``get_historical_bars``         — bounded historical bars for an explicit instrument
  * ``get_paper_account_readiness`` — paper account availability/status ONLY

Credentials come from the environment only (paper family), are never returned, logged,
or placed in any result. Live-mode credentials are rejected for this lane. When
credentials are absent the providers return the honest ``provider_unconfigured`` status;
provider/HTTP failures return ``provider_error``. Nothing is ever fabricated.
"""
# Graph + less = more: less code that does the same work as more code is more useful.
# Entity names the feature; Relationship explains why this file belongs and what it contributes.
# Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
# Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
# Entity: Market Data
# Relationship: This file performs bounded read-only Alpaca snapshot, historical-bar, and paper-account readiness requests and returns typed availability without order authority.
# Entity: Credentials
# Relationship: This file consumes validated paper-provider credentials without returning, logging, or forwarding their secret values.

from __future__ import annotations

import json
import math
import re
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Mapping, Optional

# Credential resolution lives in the shared typed config boundary; this
# provider module consumes it and never reads os.getenv directly.
from app.python_models.provider_config import (
    AlpacaCredentials,
    DEFAULT_DATA_URL,
    DEFAULT_PAPER_TRADING_URL,
    DEFAULT_STREAM_URL,
    INVALID_CONFIG,
    MODE_PAPER,
    MODE_UNAVAILABLE,
    resolve_alpaca_credentials,
)

PROVIDER = "alpaca"

STATUS_AVAILABLE = "available"
STATUS_EMPTY = "empty"  # valid response, no bars in the requested window
STATUS_UNCONFIGURED = "provider_unconfigured"
STATUS_ERROR = "provider_error"
STATUS_INVALID = "invalid_response"
STATUS_INVALID_CONFIG = INVALID_CONFIG

MAX_BARS_LIMIT = 1000
MAX_RESPONSE_BYTES = 2 * 1024 * 1024
ALLOWED_FEEDS = frozenset({"iex", "sip", "otc"})
_SYMBOL = re.compile(r"^[A-Z0-9][A-Z0-9._/-]{0,31}$")
_TIMEFRAME = re.compile(r"^[1-9][0-9]{0,3}(?:Min|Hour|Day|Week|Month)$")

# A transport is callable(url, headers) -> parsed JSON dict. Injected in tests so
# mapping/validation run deterministically against labeled protocol fixtures with no
# network and no live endpoint.
Transport = Callable[[str, dict[str, str]], dict[str, Any]]


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _freshness(observed_at: Optional[str], fetched_at: str) -> Optional[str]:
    if not observed_at:
        return None
    try:
        observed = datetime.fromisoformat(observed_at.replace("Z", "+00:00"))
        fetched = datetime.fromisoformat(fetched_at.replace("Z", "+00:00"))
        return f"age_seconds={max(int((fetched - observed).total_seconds()), 0)}"
    except (ValueError, AttributeError):
        return None


def _auth_headers(creds: AlpacaCredentials) -> dict[str, str]:
    return {
        "APCA-API-KEY-ID": creds.key_id,
        "APCA-API-SECRET-KEY": creds.secret_key,
        "Accept": "application/json",
    }


class _RejectRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_args: Any, **_kwargs: Any) -> None:
        return None


_ALPACA_OPENER = urllib.request.build_opener(_RejectRedirects())


def _default_get(url: str, headers: dict[str, str]) -> dict[str, Any]:
    request = urllib.request.Request(url, headers=headers, method="GET")
    with _ALPACA_OPENER.open(request, timeout=20) as response:
        raw = response.read(MAX_RESPONSE_BYTES + 1)
        if len(raw) > MAX_RESPONSE_BYTES:
            raise ValueError("alpaca_response_too_large")
        return json.loads(raw.decode("utf-8"))


# ---------------------------------------------------------------------------
# Market data: snapshot + historical bars.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class AlpacaInstrumentRef:
    symbol: str
    assetClass: str = "us_equity"

    def is_explicit(self) -> bool:
        return bool((self.symbol or "").strip())


@dataclass(frozen=True)
class MarketSnapshot:
    provider: str
    feed: Optional[str]
    symbol: str
    status: str
    fetchedAt: str
    observedAt: Optional[str] = None
    latestTradePrice: Optional[float] = None
    latestQuoteBid: Optional[float] = None
    latestQuoteAsk: Optional[float] = None
    freshness: Optional[str] = None
    diagnostics: Optional[str] = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class MarketBar:
    timestamp: str
    open: float
    high: float
    low: float
    close: float
    volume: float


@dataclass(frozen=True)
class HistoricalBars:
    provider: str
    feed: Optional[str]
    symbol: str
    timeframe: str
    status: str
    fetchedAt: str
    start: Optional[str] = None
    end: Optional[str] = None
    bars: list[MarketBar] = field(default_factory=list)
    diagnostics: Optional[str] = None

    def to_dict(self) -> dict[str, Any]:
        return {**asdict(self), "bars": [asdict(b) for b in self.bars]}


@dataclass(frozen=True)
class PaperAccountReadiness:
    provider: str
    status: str  # available | provider_unconfigured | provider_error | invalid_response
    mode: str
    fetchedAt: str
    accountStatus: Optional[str] = None  # e.g. "ACTIVE" — status only, no balances
    diagnostics: Optional[str] = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _resolve_paper_creds(
    credentials: Optional[AlpacaCredentials],
    env: Mapping[str, str] | None,
) -> tuple[Optional[AlpacaCredentials], Optional[str]]:
    """Return (paper_credentials, blocking_status). blocking_status is a STATUS_* when
    the lane must not proceed (unconfigured / live rejected)."""
    creds = credentials if credentials is not None else resolve_alpaca_credentials(env)
    if creds is None:
        return None, STATUS_UNCONFIGURED
    if (
        creds.mode != MODE_PAPER
        or creds.data_url != DEFAULT_DATA_URL
        or creds.paper_trading_url != DEFAULT_PAPER_TRADING_URL
        or creds.stream_url != DEFAULT_STREAM_URL
    ):
        return None, STATUS_INVALID_CONFIG
    return creds, None


def _as_float(value: Any) -> Optional[float]:
    if isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _validated_symbol(instrument: AlpacaInstrumentRef) -> str:
    if not isinstance(instrument, AlpacaInstrumentRef):
        raise ValueError("alpaca_explicit_instrument_required")
    symbol = str(instrument.symbol or "").strip().upper()
    if instrument.assetClass != "us_equity" or _SYMBOL.fullmatch(symbol) is None:
        raise ValueError("alpaca_instrument_invalid")
    return symbol


def _validated_feed(value: str) -> str:
    feed = str(value or "").strip().lower()
    if feed not in ALLOWED_FEEDS:
        raise ValueError("alpaca_feed_invalid")
    return feed


def _validated_timestamp(value: Optional[str], field: str) -> Optional[str]:
    if value is None:
        return None
    text = str(value).strip()
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError as error:
        raise ValueError(f"alpaca_{field}_invalid") from error
    if parsed.tzinfo is None:
        raise ValueError(f"alpaca_{field}_invalid")
    return text


def get_market_snapshot(
    instrument: AlpacaInstrumentRef,
    *,
    feed: str = "iex",
    transport: Optional[Transport] = None,
    credentials: Optional[AlpacaCredentials] = None,
    env: Mapping[str, str] | None = None,
) -> MarketSnapshot:
    """Latest market snapshot for an EXPLICIT instrument (read-only)."""
    symbol = _validated_symbol(instrument)
    feed = _validated_feed(feed)
    fetched = _now_iso()
    creds, blocking = _resolve_paper_creds(credentials, env)
    if blocking is not None:
        return MarketSnapshot(
            provider=PROVIDER, feed=None, symbol=symbol, status=blocking,
            fetchedAt=fetched,
            diagnostics=(
                "alpaca paper credentials not configured"
                if blocking == STATUS_UNCONFIGURED
                else "alpaca paper configuration invalid"
            ),
        )
    encoded_symbol = urllib.parse.quote(symbol, safe="")
    query = urllib.parse.urlencode({"feed": feed})
    url = f"{creds.data_url}/v2/stocks/{encoded_symbol}/snapshot?{query}"
    send = transport or _default_get
    try:
        payload = send(url, _auth_headers(creds))
    except (urllib.error.HTTPError, urllib.error.URLError) as exc:
        return MarketSnapshot(provider=PROVIDER, feed=feed, symbol=symbol, status=STATUS_ERROR,
                              fetchedAt=fetched, diagnostics=f"alpaca_request_failed: {type(exc).__name__}")
    except Exception as exc:  # noqa: BLE001
        return MarketSnapshot(provider=PROVIDER, feed=feed, symbol=symbol, status=STATUS_ERROR,
                              fetchedAt=fetched, diagnostics=f"alpaca_transport_error: {type(exc).__name__}")
    if not isinstance(payload, dict):
        return MarketSnapshot(provider=PROVIDER, feed=feed, symbol=symbol, status=STATUS_INVALID,
                              fetchedAt=fetched, diagnostics="alpaca_invalid_snapshot_shape")
    trade = payload.get("latestTrade") or {}
    quote = payload.get("latestQuote") or {}
    if not isinstance(trade, dict) or not isinstance(quote, dict):
        return MarketSnapshot(provider=PROVIDER, feed=feed, symbol=symbol, status=STATUS_INVALID,
                              fetchedAt=fetched, diagnostics="alpaca_invalid_snapshot_shape")
    observed = str(trade.get("t") or quote.get("t") or "").strip() or None
    try:
        observed = _validated_timestamp(observed, "snapshot_timestamp")
    except ValueError:
        return MarketSnapshot(provider=PROVIDER, feed=feed, symbol=symbol, status=STATUS_INVALID,
                              fetchedAt=fetched, diagnostics="alpaca_invalid_snapshot_timestamp")
    if observed is None:
        return MarketSnapshot(provider=PROVIDER, feed=feed, symbol=symbol, status=STATUS_INVALID,
                              fetchedAt=fetched, diagnostics="alpaca_snapshot_timestamp_missing")
    price = _as_float(trade.get("p"))
    bid = _as_float(quote.get("bp"))
    ask = _as_float(quote.get("ap"))
    if any(
        raw is not None and parsed is None
        for raw, parsed in (
            (trade.get("p"), price),
            (quote.get("bp"), bid),
            (quote.get("ap"), ask),
        )
    ):
        return MarketSnapshot(provider=PROVIDER, feed=feed, symbol=symbol, status=STATUS_INVALID,
                              fetchedAt=fetched, diagnostics="alpaca_invalid_snapshot_number")
    if price is None and bid is None and ask is None:
        return MarketSnapshot(provider=PROVIDER, feed=feed, symbol=symbol, status=STATUS_INVALID,
                              fetchedAt=fetched, diagnostics="alpaca_snapshot_value_missing")
    return MarketSnapshot(
        provider=PROVIDER,
        feed=feed,
        symbol=symbol,
        status=STATUS_AVAILABLE,
        fetchedAt=fetched,
        observedAt=observed,
        latestTradePrice=price,
        latestQuoteBid=bid,
        latestQuoteAsk=ask,
        freshness=_freshness(observed, fetched),
    )


def get_historical_bars(
    instrument: AlpacaInstrumentRef,
    timeframe: str,
    *,
    start: Optional[str] = None,
    end: Optional[str] = None,
    limit: int = 100,
    feed: str = "iex",
    transport: Optional[Transport] = None,
    credentials: Optional[AlpacaCredentials] = None,
    env: Mapping[str, str] | None = None,
) -> HistoricalBars:
    """Bounded historical bars for an EXPLICIT instrument + timeframe (read-only)."""
    symbol = _validated_symbol(instrument)
    timeframe = str(timeframe or "").strip()
    if not timeframe:
        raise ValueError("alpaca_explicit_timeframe_required")
    if _TIMEFRAME.fullmatch(timeframe) is None:
        raise ValueError("alpaca_timeframe_invalid")
    if isinstance(limit, bool) or not isinstance(limit, int) or limit < 1 or limit > MAX_BARS_LIMIT:
        raise ValueError(f"alpaca_bars_limit_out_of_range_1_{MAX_BARS_LIMIT}")
    feed = _validated_feed(feed)
    start = _validated_timestamp(start, "start")
    end = _validated_timestamp(end, "end")
    if start and end:
        start_time = datetime.fromisoformat(start.replace("Z", "+00:00"))
        end_time = datetime.fromisoformat(end.replace("Z", "+00:00"))
        if start_time > end_time:
            raise ValueError("alpaca_time_range_invalid")
    fetched = _now_iso()
    creds, blocking = _resolve_paper_creds(credentials, env)
    if blocking is not None:
        return HistoricalBars(provider=PROVIDER, feed=None, symbol=symbol, timeframe=timeframe,
                              status=blocking, fetchedAt=fetched, start=start, end=end,
                              diagnostics=(
                                  "alpaca paper credentials not configured"
                                  if blocking == STATUS_UNCONFIGURED
                                  else "alpaca paper configuration invalid"
                              ))
    params: list[tuple[str, str]] = [
        ("timeframe", timeframe),
        ("limit", str(limit)),
        ("feed", feed),
    ]
    if start:
        params.append(("start", start))
    if end:
        params.append(("end", end))
    encoded_symbol = urllib.parse.quote(symbol, safe="")
    url = (
        f"{creds.data_url}/v2/stocks/{encoded_symbol}/bars?"
        f"{urllib.parse.urlencode(params)}"
    )
    send = transport or _default_get
    try:
        payload = send(url, _auth_headers(creds))
    except (urllib.error.HTTPError, urllib.error.URLError) as exc:
        return HistoricalBars(provider=PROVIDER, feed=feed, symbol=symbol, timeframe=timeframe,
                              status=STATUS_ERROR, fetchedAt=fetched, start=start, end=end,
                              diagnostics=f"alpaca_request_failed: {type(exc).__name__}")
    except Exception as exc:  # noqa: BLE001
        return HistoricalBars(provider=PROVIDER, feed=feed, symbol=symbol, timeframe=timeframe,
                              status=STATUS_ERROR, fetchedAt=fetched, start=start, end=end,
                              diagnostics=f"alpaca_transport_error: {type(exc).__name__}")
    if not isinstance(payload, dict) or "bars" not in payload:
        return HistoricalBars(provider=PROVIDER, feed=feed, symbol=symbol, timeframe=timeframe,
                              status=STATUS_INVALID, fetchedAt=fetched, start=start, end=end,
                              diagnostics="alpaca_invalid_bars_shape")
    raw_bars = payload.get("bars")
    if raw_bars is None:
        raw_bars = []  # valid response, empty window (e.g. no date range) — honest, not invented
    if not isinstance(raw_bars, list):
        return HistoricalBars(provider=PROVIDER, feed=feed, symbol=symbol, timeframe=timeframe,
                              status=STATUS_INVALID, fetchedAt=fetched, start=start, end=end,
                              diagnostics="alpaca_invalid_bars_shape")
    bars: list[MarketBar] = []
    malformed_count = 0
    for raw in raw_bars[:limit]:
        if not isinstance(raw, dict):
            malformed_count += 1
            continue
        ts = str(raw.get("t") or "").strip()
        o, h, l, c = (_as_float(raw.get(k)) for k in ("o", "h", "l", "c"))
        v = _as_float(raw.get("v"))
        try:
            _validated_timestamp(ts or None, "bar_timestamp")
        except ValueError:
            ts = ""
        if not ts or None in (o, h, l, c, v) or v < 0:
            malformed_count += 1
            continue
        bars.append(MarketBar(timestamp=ts, open=o, high=h, low=l, close=c, volume=v))
    return HistoricalBars(provider=PROVIDER, feed=feed,
                          symbol=symbol, timeframe=timeframe,
                          status=(
                              STATUS_AVAILABLE if bars
                              else STATUS_INVALID if malformed_count
                              else STATUS_EMPTY
                          ),
                          fetchedAt=fetched, start=start, end=end, bars=bars,
                          diagnostics=(
                              f"alpaca_malformed_bars_omitted:{malformed_count}"
                              if malformed_count else None
                          ))


def get_paper_account_readiness(
    *,
    transport: Optional[Transport] = None,
    credentials: Optional[AlpacaCredentials] = None,
    env: Mapping[str, str] | None = None,
) -> PaperAccountReadiness:
    """Confirm paper account availability/status ONLY. No positions, orders, balances."""
    fetched = _now_iso()
    creds, blocking = _resolve_paper_creds(credentials, env)
    if blocking is not None:
        return PaperAccountReadiness(provider=PROVIDER, status=blocking, mode=MODE_UNAVAILABLE,
                                     fetchedAt=fetched, diagnostics=(
                                         "alpaca paper credentials not configured"
                                         if blocking == STATUS_UNCONFIGURED
                                         else "alpaca paper configuration invalid"
                                     ))
    url = f"{creds.paper_trading_url}/v2/account"
    send = transport or _default_get
    try:
        payload = send(url, _auth_headers(creds))
    except (urllib.error.HTTPError, urllib.error.URLError) as exc:
        return PaperAccountReadiness(provider=PROVIDER, status=STATUS_ERROR, mode=MODE_PAPER,
                                     fetchedAt=fetched, diagnostics=f"alpaca_request_failed: {type(exc).__name__}")
    except Exception as exc:  # noqa: BLE001
        return PaperAccountReadiness(provider=PROVIDER, status=STATUS_ERROR, mode=MODE_PAPER,
                                     fetchedAt=fetched, diagnostics=f"alpaca_transport_error: {type(exc).__name__}")
    account_status = str(payload.get("status") or "").strip() if isinstance(payload, dict) else ""
    if (
        not account_status
        or len(account_status) > 32
        or re.fullmatch(r"[A-Z][A-Z0-9_-]*", account_status) is None
    ):
        return PaperAccountReadiness(provider=PROVIDER, status=STATUS_INVALID, mode=MODE_PAPER,
                                     fetchedAt=fetched, diagnostics="alpaca_invalid_account_shape")
    # Status ONLY — deliberately ignore cash/equity/positions/account_number.
    return PaperAccountReadiness(provider=PROVIDER, status=STATUS_AVAILABLE, mode=MODE_PAPER,
                                 fetchedAt=fetched, accountStatus=account_status)
