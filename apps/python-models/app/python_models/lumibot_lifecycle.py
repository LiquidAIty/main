"""One bounded, credential-free LumiBot lifecycle for Card adapter proof.

The operation is deliberately a local Pandas replay.  It uses LumiBot's public
``Trader``/``Strategy`` API, cannot select a live broker, and never invokes a
LumiBot model provider.  The caller persists the normalized receipt; this
module only runs the upstream lifecycle and writes its explicit artifacts.
"""

from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
from typing import Any
from uuid import UUID


_REPOSITORY_ROOT = Path(__file__).resolve().parents[4]
_INITIAL_BUDGET_USD = 100_000.0
LUMIBOT_PROOF_SYMBOL = "LUMI-PROOF"


class LumibotLifecycleError(RuntimeError):
    """Fail-closed error from the bounded public LumiBot lifecycle."""


def _iso(value: Any) -> str:
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    return str(value or "")


def _number(value: Any) -> float | None:
    try:
        result = float(value) if value is not None else None
        return result if result is not None and math.isfinite(result) else None
    except (TypeError, ValueError):
        return None


def _enum(value: Any) -> str | None:
    if value is None:
        return None
    text = str(getattr(value, "value", value) or "").strip()
    return text or None


def _json_safe(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, bool)):
        return value
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if isinstance(value, datetime):
        return _iso(value)
    if isinstance(value, dict):
        return {str(key): _json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(item) for item in value]
    converted = _number(value)
    return converted if converted is not None else str(value)


def _artifact_descriptor(path: Path, *, kind: str, created_at: str) -> dict[str, Any]:
    body = path.read_bytes()
    try:
        locator = path.resolve().relative_to(_REPOSITORY_ROOT.resolve()).as_posix()
    except ValueError:
        locator = str(path.resolve())
    return {
        "artifactId": f"{kind}:{hashlib.sha256(body).hexdigest()[:24]}",
        "kind": kind,
        "locator": locator,
        "mediaType": "text/csv" if path.suffix.lower() == ".csv" else "application/json",
        "contentSha256": hashlib.sha256(body).hexdigest(),
        "provenanceRef": "lumibot-public-trader-local-pandas-replay",
        "sizeBytes": len(body),
        "createdAt": created_at,
    }


def run_lumibot_local_backtest(
    *, card_id: str, lifecycle_run_id: str, artifact_root: Path | None = None,
) -> dict[str, Any]:
    """Run one fixed local replay through a real LumiBot Trader and Strategy.

    No caller-controlled broker, code, symbol, or order term crosses this
    boundary.  The fixed one-share round trip is simulation-only and exists to
    prove the adapter, event, state, and artifact contracts before richer form.
    """

    normalized_card_id = str(card_id or "").strip()
    if not normalized_card_id:
        raise LumibotLifecycleError("lumibot_lifecycle_card_id_required")
    try:
        normalized_run_id = str(UUID(str(lifecycle_run_id or "").strip()))
    except (TypeError, ValueError) as error:
        raise LumibotLifecycleError("lumibot_lifecycle_run_id_invalid") from error

    try:
        import pandas as pd  # noqa: PLC0415
        from lumibot.backtesting import BacktestingBroker, PandasDataBacktesting  # noqa: PLC0415
        from lumibot.entities import Asset, Data  # noqa: PLC0415
        from lumibot.strategies import Strategy  # noqa: PLC0415
        from lumibot.traders import Trader  # noqa: PLC0415
    except ImportError as error:
        raise LumibotLifecycleError("lumibot_lifecycle_dependency_unavailable") from error

    started_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    root = (artifact_root or (_REPOSITORY_ROOT / "runtime" / "trading")).resolve()
    card_scope = hashlib.sha256(normalized_card_id.encode("utf-8")).hexdigest()[:20]
    run_directory = root / card_scope / normalized_run_id
    run_directory.mkdir(parents=True, exist_ok=False)
    stats_path = run_directory / "lumibot-stats.csv"
    snapshot_path = run_directory / "normalized-snapshot.json"

    index = pd.date_range(
        "2025-01-02 09:30", periods=12, freq="min", tz="America/New_York",
    )
    frame = pd.DataFrame({
        "open": [100.0, 100.1, 100.4, 100.7, 101.0, 101.2, 101.4, 101.1, 100.9, 101.0, 101.3, 101.5],
        "high": [100.2, 100.5, 100.8, 101.1, 101.3, 101.5, 101.6, 101.3, 101.1, 101.4, 101.6, 101.8],
        "low": [99.8, 100.0, 100.2, 100.5, 100.8, 101.0, 101.0, 100.8, 100.7, 100.8, 101.1, 101.3],
        "close": [100.1, 100.4, 100.7, 101.0, 101.2, 101.4, 101.1, 100.9, 101.0, 101.3, 101.5, 101.7],
        "volume": [1_000] * 12,
    }, index=index)
    asset = Asset(LUMIBOT_PROOF_SYMBOL, Asset.AssetType.STOCK)
    data_source = PandasDataBacktesting(
        pandas_data={asset: Data(asset, frame, timestep="minute")},
        datetime_start=index[0],
        datetime_end=index[-1],
        show_progress_bar=False,
        log_backtest_progress_to_file=False,
    )
    broker = BacktestingBroker(data_source=data_source)

    class CardLifecycleProofStrategy(Strategy):
        def initialize(self):
            self.sleeptime = "1M"
            self.asset = asset
            self.lifecycle_events: list[dict[str, Any]] = []
            self.vars.phase = "enter"
            self._record("initialized", "WAIT", "Local replay strategy initialized.")

        def _record(self, kind: str, action: str, summary: str, **details: Any) -> None:
            self.lifecycle_events.append({
                "eventId": f"{normalized_run_id}:{len(self.lifecycle_events) + 1}",
                "kind": kind,
                "source": "lumibot",
                "action": action,
                "summary": summary,
                "createdAt": _iso(self.get_datetime()),
                "details": _json_safe(details),
            })

        def before_starting_trading(self):
            self._record("lifecycle", "WAIT", "LumiBot called before_starting_trading.")

        def on_trading_iteration(self):
            if self.vars.phase == "enter":
                order = self.create_order(self.asset, 1, "buy")
                self.submit_order(order)
                self.vars.phase = "exit"
                self._record("decision", "ENTER", "Submitted one simulated market buy in the local backtest.")
                return
            if self.vars.phase == "exit" and self.get_position(self.asset) is not None:
                order = self.create_order(self.asset, 1, "sell")
                self.submit_order(order)
                self.vars.phase = "done"
                self._record("decision", "EXIT", "Submitted one simulated market sell in the local backtest.")
                return
            self._record("decision", "HOLD", "No additional simulated action was required.")

        def on_new_order(self, order):
            self._record(
                "order", "WAIT", "LumiBot accepted a simulated backtest order.",
                orderId=getattr(order, "identifier", None), side=_enum(getattr(order, "side", None)),
            )

        def on_filled_order(self, position, order, price, quantity, multiplier):
            self._record(
                "fill", "HOLD", "LumiBot filled a simulated backtest order.",
                orderId=getattr(order, "identifier", None), side=_enum(getattr(order, "side", None)),
                price=_number(price), quantity=_number(quantity), multiplier=_number(multiplier),
            )

        def after_market_closes(self):
            self._record("lifecycle", "HOLD", "LumiBot called after_market_closes.")

    strategy = CardLifecycleProofStrategy(
        broker=broker,
        budget=_INITIAL_BUDGET_USD,
        benchmark_asset=None,
        risk_free_rate=0,
        stats_file=str(stats_path),
        name="CardLifecycleProofStrategy",
        should_backup_variables_to_database=False,
        should_send_summary_to_discord=False,
    )
    trader = Trader(backtest=True, logfile="", quiet_logs=True)
    trader.add_strategy(strategy)
    try:
        analysis = trader.run_all(
            show_plot=False,
            show_tearsheet=False,
            save_tearsheet=False,
            show_indicators=False,
        )
    finally:
        trader.stop_all()

    stats = strategy.stats
    equity_curve: list[dict[str, Any]] = []
    peak: float | None = None
    if stats is not None and hasattr(stats, "iterrows"):
        for timestamp, row in stats.iterrows():
            value = _number(row.get("portfolio_value"))
            if value is None:
                continue
            peak = value if peak is None else max(peak, value)
            drawdown = value - peak
            equity_curve.append({
                "timestamp": _iso(timestamp),
                "valueUsd": value,
                "drawdownUsd": drawdown,
                "drawdownPercent": drawdown / peak * 100 if peak else 0.0,
            })
    portfolio_value = _number(strategy.get_portfolio_value())
    cash = _number(strategy.get_cash())
    positions = [{
        "symbol": str(getattr(getattr(position, "asset", None), "symbol", "") or "").upper(),
        "side": _enum(getattr(position, "side", None)),
        "quantity": _number(getattr(position, "quantity", None)),
        "averageEntryPrice": _number(getattr(position, "avg_fill_price", None)),
        "currentPrice": _number(getattr(position, "current_price", None)),
        "marketValueUsd": _number(getattr(position, "market_value", None)),
        "unrealizedPnlUsd": _number(getattr(position, "pnl", None)),
        "strategy": str(getattr(position, "strategy", "") or "") or None,
    } for position in strategy.get_positions()]
    orders = [{
        "orderId": str(getattr(order, "identifier", "") or ""),
        "symbol": str(getattr(getattr(order, "asset", None), "symbol", "") or "").upper(),
        "side": _enum(getattr(order, "side", None)),
        "quantity": _number(getattr(order, "quantity", None)),
        "filledQuantity": _number(getattr(order, "filled_quantity", None)),
        "type": _enum(getattr(order, "order_type", None)),
        "status": _enum(getattr(order, "status", None)),
    } for order in strategy.get_orders()]
    maximum_drawdown = min((point["drawdownUsd"] for point in equity_curve), default=0.0)
    maximum_drawdown_percent = min(
        (point["drawdownPercent"] for point in equity_curve), default=0.0,
    )
    finished_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    snapshot = {
        "cardId": normalized_card_id,
        "lifecycleRunId": normalized_run_id,
        "mode": "local_backtest",
        "status": "completed",
        "paperOnly": True,
        "liveOrders": False,
        "modelProviderCalls": False,
        "symbol": LUMIBOT_PROOF_SYMBOL,
        "dataProvenance": {
            "kind": "deterministic-local-replay",
            "source": "bounded-adapter-proof-bars-v1",
            "barCount": len(frame),
            "start": _iso(index[0]),
            "end": _iso(index[-1]),
        },
        "bars": [{
            "timestamp": _iso(timestamp),
            "open": float(row["open"]),
            "high": float(row["high"]),
            "low": float(row["low"]),
            "close": float(row["close"]),
            "volume": float(row["volume"]),
        } for timestamp, row in frame.iterrows()],
        "portfolio": {
            "initialValueUsd": _INITIAL_BUDGET_USD,
            "portfolioValueUsd": portfolio_value,
            "cashUsd": cash,
            "profitLossUsd": (
                portfolio_value - _INITIAL_BUDGET_USD
                if portfolio_value is not None else None
            ),
            "maxDrawdownUsd": maximum_drawdown,
            "maxDrawdownPercent": maximum_drawdown_percent,
            "equityCurve": equity_curve,
        },
        "positions": positions,
        "orders": orders,
        "events": strategy.lifecycle_events,
        "analysis": _json_safe(analysis),
        "startedAt": started_at,
        "finishedAt": finished_at,
    }
    snapshot_path.write_text(
        json.dumps(snapshot, ensure_ascii=False, indent=2), encoding="utf-8",
    )
    artifact_paths = [stats_path, snapshot_path]
    artifacts = [
        _artifact_descriptor(
            path,
            kind={
                stats_path: "lumibot-stats",
                snapshot_path: "trading-lifecycle-snapshot",
            }[path],
            created_at=finished_at,
        )
        for path in artifact_paths if path.exists() and path.stat().st_size > 0
    ]
    if not any(item["kind"] == "lumibot-stats" for item in artifacts):
        raise LumibotLifecycleError("lumibot_lifecycle_stats_artifact_missing")
    return {**snapshot, "artifacts": artifacts}
