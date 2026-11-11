"""Coverage for the Alpaca read-only paper/market-data provider boundary.

No live network and no live endpoint: every "available" path runs against an explicitly
labeled PROTOCOL FIXTURE injected as the transport, with injected paper credentials.
No order endpoint is ever constructed. No API secret appears in any result.
"""

# Entity: WorldSignals
# Relationship: Uses explicitly labeled protocol fixtures to verify read-only Alpaca request mapping, paper-account status projection, bounds, encoding, and secret-free results without claiming live-provider acceptance.

import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
import urllib.error

import pytest

from app.python_models import alpaca_market_data
from app.python_models.alpaca_market_data import (
    AlpacaInstrumentRef,
    STATUS_AVAILABLE,
    STATUS_ERROR,
    STATUS_INVALID,
    STATUS_INVALID_CONFIG,
    STATUS_UNCONFIGURED,
    get_historical_bars,
    get_market_snapshot,
    get_paper_account_readiness,
)
from app.python_models.provider_config import (
    MODE_PAPER,
    AlpacaCredentials,
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


def test_resolve_credentials_absent_returns_none():
    assert resolve_alpaca_credentials(env={}) is None


def test_historical_pages_keep_cutoff_feed_order_and_bound_the_result():
    urls = []
    def transport(url, headers):
        urls.append(url)
        return {"bars": BARS_FIXTURE["bars"][:1], "next_page_token": "second"} if len(urls) == 1 else {"bars": BARS_FIXTURE["bars"][1:]}
    result = get_historical_bars(RDW, "1Day", start="2024-05-01T00:00:00Z", end="2024-05-11T00:00:00Z",
                                 limit=3, sort="desc", transport=transport, credentials=PAPER_CREDS)
    assert len(result.bars) == 3
    assert len(urls) == 2
    assert all("sort=desc" in url and "adjustment=raw" in url and "feed=iex" in url for url in urls)
    assert "page_token=second" in urls[1]


def test_repeating_provider_page_token_fails_instead_of_looping():
    result = get_historical_bars(RDW, "1Day", limit=20, credentials=PAPER_CREDS,
                                 transport=lambda *_: {"bars": BARS_FIXTURE["bars"][:1], "next_page_token": "same"})
    assert result.status == STATUS_ERROR


@pytest.mark.parametrize("descending", [False, True])
def test_history_summary_uses_running_peak_and_preserves_raw_order(descending):
    rows = [{"t": f"2024-05-{day:02d}T00:00:00Z", "o": price, "h": price + 1,
             "l": price - 1, "c": price, "v": 10}
            for day, price in zip(range(6, 10), (100, 120, 90, 108))]
    if descending:
        rows.reverse()
    result = get_historical_bars(RDW, "1Day", credentials=PAPER_CREDS,
                                 transport=_RecordingTransport({"bars": rows})).to_dict()
    assert result["barCount"] == 4 and result["adjustment"] == "raw"
    assert [row["close"] for row in result["bars"]] == [row["c"] for row in rows]
    summary = result["summary"]
    assert summary["priceReturnPercent"] == pytest.approx(8)
    assert summary["maxDrawdownPercent"] == pytest.approx(-25)
    assert summary["drawdownPeakAt"] == "2024-05-07T00:00:00Z"
    assert summary["drawdownTroughAt"] == "2024-05-08T00:00:00Z"
    assert summary["calendarCompletenessVerified"] is False


def test_rising_history_has_no_drawdown_from_a_low_before_a_later_peak():
    result = get_historical_bars(RDW, "1Day", transport=_RecordingTransport(BARS_FIXTURE),
                                 credentials=PAPER_CREDS).to_dict()
    assert result["summary"]["maxDrawdownPercent"] == 0
    assert result["summary"]["drawdownTroughAt"] is None


def test_summary_and_pagination_report_only_the_returned_window():
    result = get_historical_bars(RDW, "1Day", limit=2, credentials=PAPER_CREDS,
        transport=_RecordingTransport({**BARS_FIXTURE, "next_page_token": "more"})).to_dict()
    assert result["truncated"] is True
    assert result["barCount"] == 2
    assert result["summary"]["lastBarAt"] == BARS_FIXTURE["bars"][1]["t"]
    assert result["summary"]["calendarCompletenessVerified"] is False


@pytest.mark.parametrize("problem", ["duplicate", "nonpositive", "malformed", "empty"])
def test_history_summary_does_not_invent_metrics_from_bad_or_missing_bars(problem):
    rows = [dict(row) for row in BARS_FIXTURE["bars"]]
    if problem == "duplicate": rows.append(dict(rows[0]))
    elif problem == "nonpositive": rows[0]["c"] = 0
    elif problem == "malformed": rows.append({"t": "bad"})
    else: rows = []
    result = get_historical_bars(RDW, "1Day", credentials=PAPER_CREDS,
                                 transport=_RecordingTransport({"bars": rows})).to_dict()
    assert result["summary"]["status"] == "unavailable"
    assert "priceReturnPercent" not in result["summary"]


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

    encoded = _RecordingTransport(SNAPSHOT_FIXTURE)
    get_market_snapshot(
        AlpacaInstrumentRef(symbol="BRK/B"),
        feed="sip",
        transport=encoded,
        credentials=PAPER_CREDS,
    )
    assert "/v2/stocks/BRK%2FB/snapshot?feed=sip" in encoded.urls[0]


def test_snapshot_rejects_invalid_instrument_feed_and_nonfinite_numbers():
    with pytest.raises(ValueError, match="alpaca_instrument_invalid"):
        get_market_snapshot(AlpacaInstrumentRef(symbol="../orders"), credentials=PAPER_CREDS)
    with pytest.raises(ValueError, match="alpaca_feed_invalid"):
        get_market_snapshot(RDW, feed="sip & test", credentials=PAPER_CREDS)

    result = get_market_snapshot(
        RDW,
        transport=_RecordingTransport({
            "latestTrade": {"p": "NaN", "t": "2024-05-10T16:00:00Z"},
            "latestQuote": {},
        }),
        credentials=PAPER_CREDS,
    )
    assert result.status == STATUS_INVALID
    assert result.latestTradePrice is None


def test_snapshot_requires_an_observation_time_and_at_least_one_market_value():
    missing_time = get_market_snapshot(
        RDW,
        transport=_RecordingTransport({
            "latestTrade": {"p": 12.34},
            "latestQuote": {"bp": 12.30, "ap": 12.38},
        }),
        credentials=PAPER_CREDS,
    )
    assert missing_time.status == STATUS_INVALID
    assert missing_time.diagnostics == "alpaca_snapshot_timestamp_missing"

    missing_values = get_market_snapshot(
        RDW,
        transport=_RecordingTransport({
            "latestTrade": {"t": "2024-05-10T16:00:00Z"},
            "latestQuote": {},
        }),
        credentials=PAPER_CREDS,
    )
    assert missing_values.status == STATUS_INVALID
    assert missing_values.diagnostics == "alpaca_snapshot_value_missing"


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

    encoded = _RecordingTransport(BARS_FIXTURE)
    get_historical_bars(
        AlpacaInstrumentRef(symbol="BRK/B"),
        "1Hour",
        start="2024-05-08T00:00:00Z",
        end="2024-05-10T00:00:00Z",
        feed="sip",
        transport=encoded,
        credentials=PAPER_CREDS,
    )
    assert "/v2/stocks/BRK%2FB/bars?" in encoded.urls[0]
    assert "timeframe=1Hour" in encoded.urls[0]
    assert "feed=sip" in encoded.urls[0]
    assert "start=2024-05-08T00%3A00%3A00Z" in encoded.urls[0]
    assert "end=2024-05-10T00%3A00%3A00Z" in encoded.urls[0]


def test_bars_validate_inputs_and_report_malformed_records():
    with pytest.raises(ValueError, match="alpaca_timeframe_invalid"):
        get_historical_bars(RDW, "1Hour/adjusted", credentials=PAPER_CREDS)
    with pytest.raises(ValueError, match="alpaca_start_invalid"):
        get_historical_bars(RDW, "1Day", start="yesterday", credentials=PAPER_CREDS)
    with pytest.raises(ValueError, match="alpaca_time_range_invalid"):
        get_historical_bars(
            RDW,
            "1Day",
            start="2024-05-11T00:00:00Z",
            end="2024-05-10T00:00:00Z",
            credentials=PAPER_CREDS,
        )

    result = get_historical_bars(
        RDW,
        "1Day",
        transport=_RecordingTransport({
            "bars": [
                BARS_FIXTURE["bars"][0],
                {"t": "2024-05-09T00:00:00Z", "o": "Infinity", "h": 2, "l": 1, "c": 1.5, "v": 10},
                {"t": "bad-time", "o": 1, "h": 2, "l": 1, "c": 1.5, "v": 10},
            ],
        }),
        credentials=PAPER_CREDS,
    )
    assert result.status == STATUS_AVAILABLE
    assert len(result.bars) == 1
    assert result.diagnostics == "alpaca_malformed_bars_omitted:2"


def test_live_or_noncanonical_credentials_are_invalid_not_unconfigured():
    live = AlpacaCredentials(
        key_id="key",
        secret_key="secret",
        mode="live",
    )
    foreign = AlpacaCredentials(
        key_id="key",
        secret_key="secret",
        data_url="https://attacker.example",
        mode="paper",
    )

    assert get_market_snapshot(RDW, credentials=live).status == STATUS_INVALID_CONFIG
    assert get_market_snapshot(RDW, credentials=foreign).status == STATUS_INVALID_CONFIG


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


def test_default_transport_refuses_redirect_before_forwarding_credentials():
    received_keys: list[str] = []

    class TargetHandler(BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802 - stdlib handler contract
            received_keys.append(self.headers.get("APCA-API-KEY-ID", ""))
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b"{}")

        def log_message(self, *_args):
            return None

    target = ThreadingHTTPServer(("127.0.0.1", 0), TargetHandler)
    target_thread = Thread(target=target.serve_forever, daemon=True)
    target_thread.start()

    class RedirectHandler(BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802 - stdlib handler contract
            self.send_response(307)
            self.send_header(
                "Location",
                f"http://127.0.0.1:{target.server_port}/capture",
            )
            self.end_headers()

        def log_message(self, *_args):
            return None

    redirect = ThreadingHTTPServer(("127.0.0.1", 0), RedirectHandler)
    redirect_thread = Thread(target=redirect.serve_forever, daemon=True)
    redirect_thread.start()
    try:
        headers = {"APCA-API-KEY-ID": "secret-key"}
        with pytest.raises(urllib.error.HTTPError) as error:
            alpaca_market_data._default_get(
                f"http://127.0.0.1:{redirect.server_port}/snapshot",
                headers,
            )
        assert headers["APCA-API-KEY-ID"] == "secret-key"
        assert error.value.code == 307
        assert received_keys == []
    finally:
        redirect.shutdown()
        target.shutdown()
        redirect.server_close()
        target.server_close()
        redirect_thread.join(timeout=2)
        target_thread.join(timeout=2)


def test_default_transport_rejects_an_oversized_body_before_json_parsing():
    class OversizedHandler(BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802 - stdlib handler contract
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b"{" + (b"x" * alpaca_market_data.MAX_RESPONSE_BYTES) + b"}")

        def log_message(self, *_args):
            return None

    server = ThreadingHTTPServer(("127.0.0.1", 0), OversizedHandler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        with pytest.raises(ValueError, match="alpaca_response_too_large"):
            alpaca_market_data._default_get(
                f"http://127.0.0.1:{server.server_port}/snapshot",
                {},
            )
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)
