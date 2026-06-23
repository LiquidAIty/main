"""Coverage for the Alpaca read-only paper/market-data provider boundary.

No live network and no live endpoint: every "available" path runs against an explicitly
labeled PROTOCOL FIXTURE injected as the transport, with injected paper credentials.
No order endpoint is ever constructed. No API secret appears in any result.
"""

import json

import pytest

from app.python_models.alpaca_market_data import (
    AlpacaCredentials,
    AlpacaInstrumentRef,
    INVALID_CONFIG,
    MODE_PAPER,
    READY,
    STATUS_AVAILABLE,
    STATUS_ERROR,
    STATUS_UNCONFIGURED,
    UNCONFIGURED,
    detect_alpaca_readiness,
    get_historical_bars,
    get_market_snapshot,
    get_paper_account_readiness,
    resolve_alpaca_credentials,
)

# PROTOCOL FIXTURES — Alpaca response shapes for mapping tests. NOT live data.
SNAPSHOT_FIXTURE = {
    "feed": "iex",
    "latestTrade": {"p": 12.34, "t": "2024-05-10T16:00:00Z"},
    "latestQuote": {"bp": 12.30, "ap": 12.38, "t": "2024-05-10T16:00:01Z"},
}
BARS_FIXTURE = {
    "symbol": "RDW",
    "bars": [
        {"t": "2024-05-08T00:00:00Z", "o": 11.0, "h": 12.0, "l": 10.5, "c": 11.8, "v": 900},
        {"t": "2024-05-09T00:00:00Z", "o": 11.8, "h": 12.5, "l": 11.5, "c": 12.2, "v": 1200},
        {"t": "2024-05-10T00:00:00Z", "o": 12.2, "h": 13.0, "l": 12.0, "c": 12.5, "v": 1500},
    ],
}
ACCOUNT_FIXTURE = {
    "status": "ACTIVE",
    "account_number": "PA-SECRET-ACCT-001",  # must NOT surface in readiness output
    "cash": "100000",  # must NOT surface
    "equity": "100000",  # must NOT surface
}

PAPER_CREDS = AlpacaCredentials(key_id="KID-TEST", secret_key="SECRET-XYZ-DO-NOT-LEAK", mode="paper")
RDW = AlpacaInstrumentRef(symbol="RDW")


class _RecordingTransport:
    def __init__(self, payload):
        self.payload = payload
        self.urls: list[str] = []

    def __call__(self, url, headers):
        self.urls.append(url)
        return self.payload


# --- Readiness (presence only) ---------------------------------------------------


def test_readiness_unconfigured_when_no_credentials():
    r = detect_alpaca_readiness("market_data", env={})
    assert r.status == UNCONFIGURED and r.mode == "unavailable"
    # Diagnostics may name the accepted variable family, but carry no secret VALUES.
    assert r.diagnostics and "=" not in r.diagnostics


def test_readiness_ready_with_paper_credentials():
    env = {"ALPACA_API_KEY_ID": "kid", "ALPACA_API_SECRET_KEY": "sec"}
    r = detect_alpaca_readiness("market_data", env=env)
    assert r.status == READY
    blob = json.dumps(r.to_dict())
    assert "kid" not in blob and "sec" not in blob  # never exposes values


def test_readiness_rejects_live_base_url():
    env = {
        "ALPACA_API_KEY_ID": "kid",
        "ALPACA_API_SECRET_KEY": "sec",
        "APCA_API_BASE_URL": "https://api.alpaca.markets",
    }
    r = detect_alpaca_readiness("paper_account", env=env)
    assert r.status == INVALID_CONFIG and r.mode == "unavailable"


def test_resolve_credentials_absent_returns_none():
    assert resolve_alpaca_credentials(env={}) is None


# --- Market snapshot -------------------------------------------------------------


def test_snapshot_requires_explicit_instrument():
    with pytest.raises(ValueError):
        get_market_snapshot(AlpacaInstrumentRef(symbol=""), credentials=PAPER_CREDS)


def test_snapshot_unconfigured_without_credentials():
    result = get_market_snapshot(RDW, env={})
    assert result.status == STATUS_UNCONFIGURED
    assert result.latestTradePrice is None


def test_snapshot_maps_fixture_with_feed_and_timestamp():
    transport = _RecordingTransport(SNAPSHOT_FIXTURE)
    result = get_market_snapshot(RDW, transport=transport, credentials=PAPER_CREDS)
    assert result.status == STATUS_AVAILABLE
    assert result.provider == "alpaca"
    assert result.feed == "iex"
    assert result.latestTradePrice == 12.34
    assert result.observedAt == "2024-05-10T16:00:00Z"
    # read-only market-data host only; never a live/order endpoint
    assert "data.alpaca.markets" in transport.urls[0]
    assert "/orders" not in transport.urls[0]
    assert "api.alpaca.markets/v2/orders" not in transport.urls[0]


def test_snapshot_provider_error_on_transport_failure():
    def _boom(_u, _h):
        raise RuntimeError("net down")

    result = get_market_snapshot(RDW, transport=_boom, credentials=PAPER_CREDS)
    assert result.status == STATUS_ERROR
    assert "net down" not in (result.diagnostics or "")


# --- Historical bars -------------------------------------------------------------


def test_bars_require_timeframe_and_bounded_limit():
    with pytest.raises(ValueError):
        get_historical_bars(RDW, "", credentials=PAPER_CREDS)
    with pytest.raises(ValueError):
        get_historical_bars(RDW, "1Day", limit=0, credentials=PAPER_CREDS)
    with pytest.raises(ValueError):
        get_historical_bars(RDW, "1Day", limit=99999, credentials=PAPER_CREDS)


def test_bars_unconfigured_without_credentials():
    result = get_historical_bars(RDW, "1Day", env={})
    assert result.status == STATUS_UNCONFIGURED
    assert result.bars == []


def test_bars_empty_window_is_empty_not_invalid():
    # A valid response with no bars in the window is 'empty', never 'invalid_response'.
    for payload in ({"symbol": "RDW", "bars": []}, {"symbol": "RDW", "bars": None}):
        result = get_historical_bars(RDW, "1Day", transport=_RecordingTransport(payload), credentials=PAPER_CREDS)
        assert result.status == "empty"
        assert result.bars == []


def test_bars_map_fixture_and_honor_limit():
    transport = _RecordingTransport(BARS_FIXTURE)
    result = get_historical_bars(RDW, "1Day", limit=2, transport=transport, credentials=PAPER_CREDS)
    assert result.status == STATUS_AVAILABLE
    assert len(result.bars) == 2  # bounded by limit
    assert result.bars[0].close == 11.8
    assert "data.alpaca.markets" in transport.urls[0]
    assert "/orders" not in transport.urls[0]


# --- Paper account readiness (status only) ---------------------------------------


def test_paper_account_unconfigured_without_credentials():
    result = get_paper_account_readiness(env={})
    assert result.status == STATUS_UNCONFIGURED


def test_paper_account_returns_status_only_no_balances_or_number():
    transport = _RecordingTransport(ACCOUNT_FIXTURE)
    result = get_paper_account_readiness(transport=transport, credentials=PAPER_CREDS)
    assert result.status == STATUS_AVAILABLE
    assert result.mode == MODE_PAPER
    assert result.accountStatus == "ACTIVE"
    blob = json.dumps(result.to_dict())
    # account number, cash, equity must NOT leak into the readiness result
    assert "PA-SECRET-ACCT-001" not in blob
    assert "100000" not in blob
    # paper trading host only, account read endpoint, never orders
    assert "paper-api.alpaca.markets" in transport.urls[0]
    assert "/orders" not in transport.urls[0]


# --- No secret exposure ----------------------------------------------------------


def test_api_secret_never_appears_in_any_result():
    snap = get_market_snapshot(RDW, transport=_RecordingTransport(SNAPSHOT_FIXTURE), credentials=PAPER_CREDS)
    bars = get_historical_bars(RDW, "1Day", transport=_RecordingTransport(BARS_FIXTURE), credentials=PAPER_CREDS)
    acct = get_paper_account_readiness(transport=_RecordingTransport(ACCOUNT_FIXTURE), credentials=PAPER_CREDS)
    for result in (snap, bars, acct):
        assert "SECRET-XYZ-DO-NOT-LEAK" not in json.dumps(result.to_dict())
