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

from __future__ import annotations

import json
import urllib.error
import urllib.request
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable, Mapping, Optional

# Credential/env resolution and readiness constants live in the shared typed config
# boundary; this provider module consumes them and never reads os.getenv directly.
from app.python_models.provider_config import (  # noqa: F401 (re-exported for callers/tests)
    DEFAULT_DATA_URL,
    DEFAULT_PAPER_TRADING_URL,
    DEFAULT_STREAM_URL,
    INVALID_CONFIG,
    LIVE_TRADING_HOST,
    MODE_PAPER,
    MODE_READ_ONLY,
    MODE_UNAVAILABLE,
    READY,
    UNCONFIGURED,
    AlpacaCredentials,
    detect_alpaca_readiness,
    ensure_env_loaded,
    resolve_alpaca_credentials,
)

PROVIDER = "alpaca"

STATUS_AVAILABLE = "available"
STATUS_EMPTY = "empty"  # valid response, no bars in the requested window
STATUS_UNCONFIGURED = "provider_unconfigured"
STATUS_ERROR = "provider_error"
STATUS_INVALID = "invalid_response"

MAX_BARS_LIMIT = 1000

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


# ---------------------------------------------------------------------------
# Provider readiness (presence only — never exposes secret values).
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ProviderReadiness:
    provider: str
    capability: str
    status: str  # ready | unconfigured | invalid_configuration
    mode: str  # paper | read_only | unavailable
    diagnostics: str  # non-secret structured reason only

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


# `ProviderReadiness` is the value-free readiness object; `AlpacaCredentials`,
# `resolve_alpaca_credentials`, and `detect_alpaca_readiness` are owned by the shared
# `provider_config` boundary (imported above) so all env reads go through one place.


def _auth_headers(creds: AlpacaCredentials) -> dict[str, str]:
    return {
        "APCA-API-KEY-ID": creds.key_id,
        "APCA-API-SECRET-KEY": creds.secret_key,
        "Accept": "application/json",
    }


def _default_get(url: str, headers: dict[str, str]) -> dict[str, Any]:
    request = urllib.request.Request(url, headers=headers, method="GET")
    with urllib.request.urlopen(request, timeout=20) as response:  # noqa: S310
        return json.loads(response.read().decode("utf-8"))


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
    if creds.mode == "live":
        return None, STATUS_UNCONFIGURED  # live rejected; treated as not-configured for paper
    return creds, None


def _as_float(value: Any) -> Optional[float]:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def get_market_snapshot(
    instrument: AlpacaInstrumentRef,
    *,
    feed: str = "iex",
    transport: Optional[Transport] = None,
    credentials: Optional[AlpacaCredentials] = None,
    env: Mapping[str, str] | None = None,
) -> MarketSnapshot:
    """Latest market snapshot for an EXPLICIT instrument (read-only)."""
    if not isinstance(instrument, AlpacaInstrumentRef) or not instrument.is_explicit():
        raise ValueError("alpaca_explicit_instrument_required")
    fetched = _now_iso()
    symbol = instrument.symbol.strip().upper()
    creds, blocking = _resolve_paper_creds(credentials, env)
    if blocking is not None:
        return MarketSnapshot(
            provider=PROVIDER, feed=None, symbol=symbol, status=blocking,
            fetchedAt=fetched, diagnostics="alpaca paper credentials not configured",
        )
    url = f"{creds.data_url}/v2/stocks/{symbol}/snapshot?feed={feed}"
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
    observed = str(trade.get("t") or quote.get("t") or "").strip() or None
    return MarketSnapshot(
        provider=PROVIDER,
        feed=str(payload.get("feed") or feed) or None,
        symbol=symbol,
        status=STATUS_AVAILABLE,
        fetchedAt=fetched,
        observedAt=observed,
        latestTradePrice=_as_float(trade.get("p")),
        latestQuoteBid=_as_float(quote.get("bp")),
        latestQuoteAsk=_as_float(quote.get("ap")),
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
    if not isinstance(instrument, AlpacaInstrumentRef) or not instrument.is_explicit():
        raise ValueError("alpaca_explicit_instrument_required")
    if not str(timeframe or "").strip():
        raise ValueError("alpaca_explicit_timeframe_required")
    if not isinstance(limit, int) or limit < 1 or limit > MAX_BARS_LIMIT:
        raise ValueError(f"alpaca_bars_limit_out_of_range_1_{MAX_BARS_LIMIT}")
    fetched = _now_iso()
    symbol = instrument.symbol.strip().upper()
    creds, blocking = _resolve_paper_creds(credentials, env)
    if blocking is not None:
        return HistoricalBars(provider=PROVIDER, feed=None, symbol=symbol, timeframe=timeframe,
                              status=blocking, fetchedAt=fetched, start=start, end=end,
                              diagnostics="alpaca paper credentials not configured")
    params = [f"timeframe={timeframe}", f"limit={limit}", f"feed={feed}"]
    if start:
        params.append(f"start={start}")
    if end:
        params.append(f"end={end}")
    url = f"{creds.data_url}/v2/stocks/{symbol}/bars?{'&'.join(params)}"
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
    for raw in raw_bars[:limit]:
        if not isinstance(raw, dict):
            continue
        ts = str(raw.get("t") or "").strip()
        o, h, l, c = (_as_float(raw.get(k)) for k in ("o", "h", "l", "c"))
        v = _as_float(raw.get("v"))
        if not ts or None in (o, h, l, c, v):
            continue  # incomplete bar skipped, never fabricated
        bars.append(MarketBar(timestamp=ts, open=o, high=h, low=l, close=c, volume=v))
    return HistoricalBars(provider=PROVIDER, feed=str(payload.get("feed") or feed) or None,
                          symbol=symbol, timeframe=timeframe,
                          status=STATUS_AVAILABLE if bars else STATUS_EMPTY,
                          fetchedAt=fetched, start=start, end=end, bars=bars)


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
                                     fetchedAt=fetched, diagnostics="alpaca paper credentials not configured")
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
    if not isinstance(payload, dict) or not str(payload.get("status") or "").strip():
        return PaperAccountReadiness(provider=PROVIDER, status=STATUS_INVALID, mode=MODE_PAPER,
                                     fetchedAt=fetched, diagnostics="alpaca_invalid_account_shape")
    # Status ONLY — deliberately ignore cash/equity/positions/account_number.
    return PaperAccountReadiness(provider=PROVIDER, status=STATUS_AVAILABLE, mode=MODE_PAPER,
                                 fetchedAt=fetched, accountStatus=str(payload.get("status")).strip())
