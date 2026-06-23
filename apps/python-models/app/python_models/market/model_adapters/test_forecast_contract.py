"""Contract + adapter-degradation coverage.

Runs in the rails venv (no torch) — so the adapters prove their HONEST degradation
(`model_unavailable`) and the contract/normalization prove their shape. Actual
forecasting is proven separately in the dedicated forecast venv.
"""

from app.python_models.market.model_adapters.forecast import run_forecast, KNOWN_MODELS
from app.python_models.market.model_adapters.forecast_contract import (
    MODEL_CHRONOS,
    MODEL_KRONOS,
    MODEL_UNAVAILABLE,
    STATUS_ERROR,
    BarWindow,
    OhlcvBar,
    bar_window_from_alpaca,
)


def _window(n=20):
    bars = [
        OhlcvBar(timestamp=f"2026-01-{(i % 27) + 1:02d}T00:00:00Z",
                 open=10 + i * 0.1, high=10 + i * 0.1 + 0.5, low=10 + i * 0.1 - 0.5,
                 close=10 + i * 0.1 + 0.2, volume=1000 + i)
        for i in range(n)
    ]
    return BarWindow(symbol="RDW", timeframe="1Day", source="alpaca_paper:iex", bars=bars)


def test_bar_window_normalizes_from_alpaca_dict():
    payload = {"symbol": "RDW", "timeframe": "1Day", "feed": "iex",
               "bars": [{"timestamp": "2026-01-01T00:00:00Z", "open": 1, "high": 2, "low": 0.5, "close": 1.5, "volume": 100}]}
    w = bar_window_from_alpaca(payload, source="alpaca_paper")
    assert w.symbol == "RDW" and w.source == "alpaca_paper:iex"
    assert w.bars[0].close == 1.5 and w.closes() == [1.5]


def test_known_models_are_the_two_adapters():
    assert set(KNOWN_MODELS) == {MODEL_CHRONOS, MODEL_KRONOS}


def test_unknown_model_is_a_typed_error():
    r = run_forecast("totally-unknown", _window(), horizon=3)
    assert r.status == STATUS_ERROR and "unknown_model" in (r.diagnostics or "")


def test_insufficient_history_is_a_typed_error():
    r = run_forecast(MODEL_CHRONOS, _window(n=4), horizon=3)
    assert r.status == STATUS_ERROR and "insufficient_history" in (r.diagnostics or "")


def test_chronos_degrades_honestly_without_torch():
    # In the rails venv torch is absent → honest model_unavailable, not a crash.
    r = run_forecast(MODEL_CHRONOS, _window(), horizon=3)
    assert r.status == MODEL_UNAVAILABLE
    assert r.model == MODEL_CHRONOS and r.symbol == "RDW" and r.points == []


def test_kronos_degrades_honestly_without_runtime():
    r = run_forecast(MODEL_KRONOS, _window(), horizon=3)
    assert r.status == MODEL_UNAVAILABLE
    assert r.model == MODEL_KRONOS and r.points == []


def test_result_to_dict_is_serializable():
    r = run_forecast(MODEL_CHRONOS, _window(), horizon=3)
    d = r.to_dict()
    import json
    assert json.dumps(d)  # serializable, no secrets/objects
    assert d["status"] == MODEL_UNAVAILABLE and d["modelRef"]
