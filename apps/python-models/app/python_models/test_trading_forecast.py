"""Real calendar/validation contracts; these are not broker or live-Card proofs."""
# Entity: Trading
# Relationship: Exercises forecast cutoff, exchange-calendar, raw-output validity, and timestamp integrity against the production computation owners.
from dataclasses import replace

import pytest
from app.python_models import trading_forecast as forecast
from app.python_models.alpaca_market_data import HistoricalBars, MarketBar


def test_daily_forecast_skips_thanksgiving_and_weekend():
    stamps = forecast._future_timestamps("2026-11-25T05:00:00Z", "1Day", 3)
    assert [stamp.date().isoformat() for stamp in stamps] == ["2026-11-27", "2026-11-30", "2026-12-01"]


def test_hourly_forecast_skips_early_close_and_preserves_provider_hour_labels():
    stamps = forecast._future_timestamps("2026-11-27T17:00:00Z", "1Hour", 2)
    assert [stamp.isoformat() for stamp in stamps] == ["2026-11-30T14:00:00+00:00", "2026-11-30T15:00:00+00:00"]


def test_daily_cutoff_does_not_read_later_extended_hours_prices():
    windows = forecast._bar_windows(forecast._timestamp("2026-10-01T00:00:00Z"), forecast._timestamp("2026-10-23T23:00:00Z"), "1Day")
    rows = [MarketBar(label.isoformat(), 100, 102, 99, 101, 1000) for label, _ in windows]
    bars = HistoricalBars("alpaca", "iex", "SPY", "1Day", "available", "2026-11-09T00:00:00Z", bars=rows)
    history, _ = forecast._prepare_history(bars, forecast._timestamp("2026-10-23T20:00:00Z"), 16)
    assert history[-1]["timestamp"].startswith("2026-10-22")
    with pytest.raises(forecast.TradingForecastError, match="duplicate_observed"):
        forecast._prepare_history(replace(bars, bars=rows + rows[-1:]), forecast._timestamp("2026-10-24T01:00:00Z"), 16)
    with pytest.raises(forecast.TradingForecastError, match="insufficient_history"):
        forecast._prepare_history(replace(bars, bars=rows[:3]), forecast._timestamp("2026-10-24T01:00:00Z"), 16)


def test_invalid_raw_model_candle_is_not_accepted():
    # Values from the actual mini-model diagnostic, not a substitute predictor.
    assert not forecast._valid_bar({"open":190.569, "low":190.589, "high":191.359, "close":191.427, "volume":542833})
    assert not forecast._valid_bar({"open":1, "low":0, "high":2, "close":1, "volume":10})
    assert not forecast._valid_bar({"open":1, "low":1, "high":2, "close":float('nan'), "volume":10})


@pytest.mark.parametrize("arguments", [
    {"horizon": 21}, {"seed": True}, {"sample_count": 0}, {"model_variant": "missing"},
    {"end": "2026-10-23"}, {"end": "2099-01-01T00:00:00Z"},
    {"temperature": 0}, {"temperature": -1}, {"temperature": True}, {"temperature": float('nan')},
    {"temperature": float('inf')}, {"top_p": 0}, {"top_p": 1.01}, {"top_p": True},
    {"top_p": float('nan')}, {"top_k": -1}, {"top_k": 1.5}, {"top_k": True},
    {"sample_count": 65}, {"model_variant": "small", "sample_count": 17},
    {"model_variant": "base", "sample_count": 17},
])
def test_invalid_request_rejected_before_provider_or_model(arguments):
    with pytest.raises(forecast.TradingForecastError):
        forecast._forecast_market_bars("SPY", "1Day", **arguments)


def test_mcp_forecast_reports_future_cutoff_without_fetching_running_or_saving(monkeypatch):
    import asyncio
    from unittest.mock import Mock
    from app import mcp_auth, mcp_request_dispatch
    from app.python_models import trading_forecast_store

    monkeypatch.setattr(trading_forecast_store, "require_forecast_card", lambda *_: {"current_revision_id": "revision"})
    fetch, predict, save = Mock(), Mock(), Mock()
    monkeypatch.setattr(forecast, "get_historical_bars", fetch)
    monkeypatch.setattr(forecast, "_predict_history", predict)
    monkeypatch.setattr(trading_forecast_store, "save_forecast", save)
    monkeypatch.setattr(mcp_auth, "internal_mcp_principal", lambda: None)
    monkeypatch.setattr(mcp_auth, "authenticated_project_context", lambda: {
        "projectId": "project", "deckId": "deck", "callerCardId": "trader",
    })
    monkeypatch.setattr(mcp_request_dispatch, "request_tool_is_allowed", lambda *_: True)
    result = asyncio.run(mcp_request_dispatch.dispatch_tool("forecast_market_bars", {
        "symbol": "RKLB", "timeframe": "1Day", "end": "2099-01-01T23:59:00-05:00",
    })).model_dump(by_alias=True)
    assert result["isError"] is True
    text = str(result)
    assert "trading_forecast_cutoff_in_future" in text and "omit end" in text
    assert "internal_failure" not in text
    fetch.assert_not_called()
    predict.assert_not_called()
    save.assert_not_called()


def test_sample_summary_uses_exact_paths_and_excludes_invalid_whole_paths():
    paths = [{"valid": True, "points": [{"timestamp": "2026-11-10", "close": value}]} for value in (90., 100., 110.)]
    paths.append({"valid": False, "points": [{"timestamp": "2026-11-10", "close": 5000.}]})
    summary = forecast._summarize_paths(paths, 100.)
    assert summary["sampleCount"] == 4
    assert summary["validPathCount"] == 3 and summary["invalidPathCount"] == 1
    assert (summary["terminalAbove"], summary["terminalBelow"], summary["terminalUnchanged"]) == (1, 1, 1)
    assert summary["steps"] == [{"timestamp": "2026-11-10", "min": 90., "max": 110., "p10": 92., "median": 100., "p90": 108.}]
    assert forecast._summarize_paths([paths[-1]], 100.)["steps"] == []
    assert paths[-1]["points"][0]["close"] == 5000.  # Kept, not corrected or discarded.


def test_raw_path_serialization_retains_amount_and_invalidity_without_clamping():
    import json
    import pandas as pd
    raw = pd.DataFrame([dict(open=100., high=99., low=98., close=101., volume=20., amount=2000.),
                        dict(open=100., high=102., low=99., close=float('nan'), volume=20., amount=2000.)])
    stamps = pd.Series(pd.to_datetime(["2026-11-10T14:00:00Z", "2026-11-10T15:00:00Z"]))
    points = forecast._serialize_prediction(raw, stamps)
    assert not points[0]["valid"] and points[0]["high"] == 99. and points[0]["amount"] == 2000.
    assert not points[1]["valid"] and points[1]["close"] is None
    json.dumps(points, allow_nan=False)


def test_predict_boundary_requests_distinct_draws_and_means_the_retained_outputs(monkeypatch):
    # This checks adapter math/arguments, not real model acceptance (exercised in Preview).
    import pandas as pd
    import torch
    from unittest.mock import Mock
    frames = [pd.DataFrame([dict(open=100., high=high, low=low, close=close, volume=20., amount=2000.)])
              for high, low, close in [(102., 99., 101.), (101., 97., 98.)]]
    predictor = Mock()
    predictor.predict_batch.return_value = frames
    # Real Torch RNG: model initialization must not shift the forecast seed.
    with torch.random.fork_rng(devices=[]):
        torch.manual_seed(443)
        expected_rng = torch.random.get_rng_state().clone()
    before_rng = torch.random.get_rng_state().clone()
    def load_predictor(variant):
        torch.rand(100)
        return predictor
    def predict(**kwargs):
        assert torch.equal(torch.random.get_rng_state(), expected_rng)
        return frames
    predictor.predict_batch.side_effect = predict
    monkeypatch.setattr(forecast, "_kronos_predictor", load_predictor)
    history = [dict(timestamp="2026-11-09T14:00:00Z", open=100., high=101., low=99., close=100., volume=20.)]
    future = pd.Series(pd.to_datetime(["2026-11-10T14:00:00Z"]))
    result = forecast._predict_history(history, future, "mini", 2, 443, temperature=.7, top_p=.85, top_k=7)
    arguments = predictor.predict_batch.call_args.kwargs
    assert arguments["sample_count"] == 1 and len(arguments["df_list"]) == 2
    assert (arguments["T"], arguments["top_p"], arguments["top_k"]) == (.7, .85, 7)
    assert arguments["df_list"][0].equals(arguments["df_list"][1])
    assert [path["points"][0]["close"] for path in result["samplePaths"]] == [101., 98.]
    assert result["points"][0]["close"] == 99.5 and result["points"][0]["volume"] == 20.
    assert result["distribution"]["terminalAbove"] == result["distribution"]["terminalBelow"] == 1
    assert torch.equal(torch.random.get_rng_state(), before_rng)


def test_forecast_uses_saved_grant_not_trader_configuration_and_preserves_read_only_history():
    from unittest.mock import Mock
    from app.python_models.trading_forecast_store import _require_forecast_card
    from app.python_models.trading_contract import TradingBoundaryError
    cursor = Mock()
    row = {"current_revision_id": "revision", "runtime_kind": "hermes", "runtime_mode": "delegate",
           "runtime_profile": "quant-analyst", "enabled": True, "can_forecast": True}
    cursor.fetchone.return_value = row
    assert _require_forecast_card(cursor, "project", "deck", "quant") == row
    assert cursor.execute.call_args.args[1] == ("project", "deck", "quant")
    row["can_forecast"] = False
    with pytest.raises(TradingBoundaryError, match="grant_required"):
        _require_forecast_card(cursor, "project", "deck", "quant")
    assert _require_forecast_card(cursor, "project", "deck", "prior-owner", write=False) == row
    cursor.fetchone.return_value = None
    with pytest.raises(TradingBoundaryError, match="not_found"):
        _require_forecast_card(cursor, "wrong-project", "deck", "quant", write=False)
