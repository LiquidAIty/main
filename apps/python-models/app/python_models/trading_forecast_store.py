"""Trading-owned immutable forecasts and explicitly requested outcome comparisons."""
# Entity: Trading
# Relationship: Retains exact Card-scoped model predictions and input snapshots in Trading PostgreSQL, and compares later real bars without overwriting predictions or writing graph knowledge.

from __future__ import annotations

from dataclasses import asdict
import json
from typing import Any
from uuid import UUID

from psycopg.rows import dict_row
from app.python_models.postgres import connect_postgres
from app.python_models.trading_contract import TradingBoundaryError


def _require_forecast_card(cursor: Any, project_id: str, deck_id: str, card_id: str, *, write: bool = True) -> dict[str, Any]:
    cursor.execute(
        """SELECT card.current_revision_id, revision.runtime_kind, revision.runtime_mode,
                  revision.runtime_profile, revision.enabled,
                  EXISTS (SELECT 1 FROM ag_catalog.card_capability_grants grant_row
                          WHERE grant_row.revision_id=card.current_revision_id
                            AND grant_row.grant_kind='tool' AND grant_row.grant_id='forecast_market_bars') AS can_forecast
           FROM ag_catalog.agent_cards card
           JOIN ag_catalog.agent_card_revisions revision ON revision.revision_id=card.current_revision_id
           WHERE card.project_id=%s AND card.deck_id=%s AND card.card_id=%s""",
        (project_id, deck_id, card_id),
    )
    row = cursor.fetchone()
    if not row:
        raise TradingBoundaryError("forecast_card_not_found")
    if write and (row["runtime_kind"] != "hermes" or row["runtime_mode"] != "delegate"
                  or not row["runtime_profile"] or row["enabled"] is False or not row["can_forecast"]):
        raise TradingBoundaryError("forecast_card_grant_required")
    return dict(row)


def require_forecast_card(project_id: str, deck_id: str, card_id: str) -> dict[str, Any]:
    with connect_postgres() as connection, connection.cursor(row_factory=dict_row) as cursor:
        return _require_forecast_card(cursor, project_id, deck_id, card_id)


def save_forecast(project_id: str, deck_id: str, card_id: str, result: dict[str, Any], card_revision_id: str) -> None:
    with connect_postgres() as connection, connection.cursor(row_factory=dict_row) as cursor:
        _require_forecast_card(cursor, project_id, deck_id, card_id)
        cursor.execute(
            """INSERT INTO ag_catalog.trading_forecasts
               (forecast_id, project_id, deck_id, card_id, card_revision_id, payload)
               VALUES (%s,%s,%s,%s,%s,%s::jsonb)""",
            (result["forecastId"], project_id, deck_id, card_id, card_revision_id,
             json.dumps(result, allow_nan=False)),
        )


def read_forecasts(project_id: str, deck_id: str, card_id: str, forecast_id: str | None = None) -> dict[str, Any]:
    if forecast_id:
        try:
            forecast_id = str(UUID(forecast_id))
        except ValueError:
            raise TradingBoundaryError("trading_forecast_id_invalid") from None
    with connect_postgres() as connection, connection.cursor(row_factory=dict_row) as cursor:
        _require_forecast_card(cursor, project_id, deck_id, card_id, write=False)
        cursor.execute(
            """SELECT payload FROM ag_catalog.trading_forecasts
               WHERE project_id=%s AND deck_id=%s AND card_id=%s
                 AND (%s::uuid IS NULL OR forecast_id=%s::uuid)
               ORDER BY created_at DESC LIMIT 20""",
            (project_id, deck_id, card_id, forecast_id, forecast_id),
        )
        payloads = [row["payload"] for row in cursor.fetchall()]
    if forecast_id:
        if not payloads:
            raise TradingBoundaryError("trading_forecast_not_found")
        return payloads[0]
    return {"forecasts": [{key: payload.get(key) for key in
                          ("forecastId", "generatedAt", "marketData", "cutoff", "modelRef", "status")}
                         for payload in payloads]}


def compare_forecast(project_id: str, deck_id: str, card_id: str, forecast_id: str) -> dict[str, Any]:
    from datetime import datetime, timezone
    from app.python_models.alpaca_market_data import AlpacaInstrumentRef, get_historical_bars
    from app.python_models.trading_forecast import _bar_windows, _timestamp, _valid_bar
    import pandas as pd
    forecast = read_forecasts(project_id, deck_id, card_id, forecast_id)
    points = forecast["points"]
    data = forecast["marketData"]
    first, last = _timestamp(points[0]["timestamp"]), _timestamp(points[-1]["timestamp"])
    now = _timestamp(datetime.now(timezone.utc).isoformat())
    if first > now:
        return {"forecastId": forecast_id, "status": "pending", "actual": [], "metrics": None,
                "diagnostics": "Forecast target bars have not occurred yet."}
    bars = get_historical_bars(AlpacaInstrumentRef(symbol=data["symbol"]), data["timeframe"],
                               start=first.isoformat(), end=min(now, last + pd.Timedelta(days=1)).isoformat(),
                               limit=1000, feed=data["feed"])
    if bars.status != "available":
        return {"status": bars.status, "actual": [], "metrics": None, "diagnostics": bars.diagnostics}
    windows = dict(_bar_windows(first, last, data["timeframe"]))
    actual = { _timestamp(bar.timestamp): asdict(bar) for bar in bars.bars
               if _valid_bar(asdict(bar)) and _timestamp(bar.timestamp) in windows
               and windows[_timestamp(bar.timestamp)] <= now }
    matched = [(point, actual[_timestamp(point["timestamp"])]) for point in points
               if point.get("valid") and _timestamp(point["timestamp"]) in actual]
    baseline = forecast["history"][-1]["close"]
    metrics = None
    if matched:
        sign = lambda value: (value > 0) - (value < 0)
        metrics = {
            "matchedBars": len(matched), "horizon": len(points),
            "closeMae": sum(abs(p["close"] - a["close"]) for p, a in matched) / len(matched),
            "lastCloseBaselineMae": sum(abs(baseline - a["close"]) for _, a in matched) / len(matched),
            "closeInsidePredictedRange": sum(p["low"] <= a["close"] <= p["high"] for p, a in matched) / len(matched),
            "highMae": sum(abs(p["high"] - a["high"]) for p, a in matched) / len(matched),
            "lowMae": sum(abs(p["low"] - a["low"]) for p, a in matched) / len(matched),
            "terminalDirectionCorrect": (sign(points[-1]["close"] - baseline) == sign(actual[last]["close"] - baseline))
                if points[-1].get("valid") and last in actual else None,
        }
    return {"forecastId": forecast_id, "status": "complete" if len(matched) == len(points) else "partial",
            "actual": [actual[_timestamp(point["timestamp"])] for point in points if _timestamp(point["timestamp"]) in actual],
            "metrics": metrics, "fetchedAt": bars.fetchedAt,
            "diagnostics": "Retrospective forecast comparison, not a backtest or calibrated interval. Invalid predictions excluded from metrics."}
