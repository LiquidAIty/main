"""Bounded statistical comparisons for the existing Trading tools."""
# Entity: Trading
# Relationship: Calculates GARCH conditional variance and constrained classical stock-allocation comparisons from explicit observations, preserving assumptions and unavailable results without orders or another forecasting runtime.

from __future__ import annotations

import math
from time import perf_counter
from typing import Any

import numpy as np


def _fit_garch(returns: np.ndarray) -> dict | None:
    from scipy.optimize import minimize

    variance = float(np.var(returns, ddof=1))
    if not math.isfinite(variance) or variance <= 1e-10:
        return None
    weights = 0.94 ** np.arange(min(75, len(returns)))
    initial = float(np.dot(weights, (returns[:len(weights)] - returns.mean()) ** 2) / weights.sum())
    initial = max(initial, variance * 1e-6, 1e-10)

    def conditional(parameters):
        mean, omega, alpha, beta = parameters
        residuals = returns - mean
        values = np.empty(len(returns))
        values[0] = initial
        for index in range(1, len(values)):
            values[index] = omega + alpha * residuals[index - 1] ** 2 + beta * values[index - 1]
        return residuals, values

    def likelihood(parameters):
        residuals, values = conditional(parameters)
        if not np.all(np.isfinite(values)) or np.any(values <= 0):
            return 1e30
        return float(0.5 * np.sum(np.log(2 * np.pi * values) + residuals ** 2 / values))

    fits = []
    for alpha, beta in ((0.05, 0.9), (0.1, 0.75), (0.01, 0.98)):
        fit = minimize(likelihood, [float(returns.mean()), variance * (1 - alpha - beta), alpha, beta],
            method="SLSQP", bounds=[(None, None), (1e-10, None), (0, 0.999), (0, 0.999)],
            constraints=[{"type": "ineq", "fun": lambda values: 0.999 - values[2] - values[3]}],
            options={"maxiter": 300, "ftol": 1e-8})
        if (fit.success and np.isfinite(fit.fun) and np.all(np.isfinite(fit.x))
                and fit.x[1] > 0 and min(fit.x[2:]) >= 0 and sum(fit.x[2:]) <= 0.99900001):
            fits.append(fit)
    if not fits:
        return None
    fit = min(fits, key=lambda item: item.fun)
    residuals, values = conditional(fit.x)
    mean, omega, alpha, beta = map(float, fit.x)
    return {"mean": mean, "omega": omega, "alpha": alpha, "beta": beta,
            "lastVariance": float(values[-1]), "lastResidual": float(residuals[-1]),
            "negativeLogLikelihood": float(fit.fun), "iterations": int(fit.nit)}


def _variance_forecast(fit: dict, horizon: int) -> list[float]:
    # E[e_(t+h)^2 | F_t] = E[h_(t+h) | F_t] for h >= 1.
    value = fit["omega"] + fit["alpha"] * fit["lastResidual"] ** 2 + fit["beta"] * fit["lastVariance"]
    result = [value]
    for _ in range(1, horizon):
        value = fit["omega"] + (fit["alpha"] + fit["beta"]) * value
        result.append(value)
    return result


def volatility_comparison(history: list[dict], horizon: int, timeframe: str) -> dict:
    """Gaussian GARCH(1,1); held-out comparison fits no observations after its origin."""
    started = perf_counter()
    result: dict[str, Any] = {"model": "GARCH(1,1)", "status": "unavailable",
        "varianceUnits": "squared percent log returns per bar", "timeframe": timeframe,
        "assumptions": ["Constant fitted mean; Gaussian quasi-likelihood; alpha + beta <= 0.999.",
            "Initial variance uses a bounded exponentially weighted backcast.",
            "Forecasts conditional volatility, not price direction or options implied volatility.",
            "Historical corrected/raw prices are not a point-in-time vintage; splits and dividends can distort returns."],
        "executionAuthorized": False}
    closes = np.asarray([bar["close"] for bar in history], dtype=float)
    if len(closes) < 101 or len(closes) > 400 or not np.all(np.isfinite(closes)) or np.any(closes <= 0):
        return {**result, "reason": "Requires 101–400 valid observed closes; no input window was expanded."}
    returns = np.diff(np.log(closes)) * 100
    holdout_count = min(20, len(returns) - 80)
    try:
        training = returns[:-holdout_count]
        evaluation_fit, current_fit = _fit_garch(training), _fit_garch(returns)
    except ImportError:
        return {**result, "reason": "Configured SciPy dependency unavailable."}
    except (ValueError, RuntimeError, FloatingPointError):
        return {**result, "reason": "Variance estimation failed; the separate Kronos result is unchanged."}
    if evaluation_fit is None or current_fit is None:
        return {**result, "reason": "Estimation did not converge to a finite stationary model; no fallback fit reported."}
    predicted = np.asarray(_variance_forecast(evaluation_fit, holdout_count))
    realized = (returns[-holdout_count:] - evaluation_fit["mean"]) ** 2
    benchmark = float(np.var(training, ddof=1))
    future = _variance_forecast(current_fit, horizon)
    result.update(status="available", parameters={key: current_fit[key] for key in ("mean", "omega", "alpha", "beta")},
        observations=len(returns), informationCutoff=history[-1].get("availableAfter"),
        lastObservedAt=history[-1]["timestamp"],
        varianceForecast=future, volatilityPercentPerBar=[math.sqrt(value) for value in future],
        heldOut={"bars": holdout_count, "trainingReturns": len(training),
            "trainingLastObservedAt": history[-holdout_count - 1]["timestamp"],
            "trainingInformationCutoff": history[-holdout_count - 1].get("availableAfter"),
            "comparisonLastObservedAt": history[-1]["timestamp"],
            "comparisonInformationCutoff": history[-1].get("availableAfter"),
            "varianceMae": float(np.mean(np.abs(predicted - realized))),
            "constantVarianceMae": float(np.mean(np.abs(benchmark - realized))),
            "varianceRmse": float(np.sqrt(np.mean((predicted - realized) ** 2))),
            "note": "Multi-step variance forecast versus held-out squared residuals; noisy proxies, not a directional accuracy score."},
        fit={"converged": True, "iterations": current_fit["iterations"],
             "negativeLogLikelihood": current_fit["negativeLogLikelihood"]},
        computeSeconds=round(perf_counter() - started, 3))
    return result


def minimum_variance_comparison(returns: np.ndarray, current: np.ndarray, *, cash_weight: float,
                                maximum_weights: list[float], category_indices: dict[str, list[int]],
                                category_bounds: dict[str, tuple[float, float]],
                                maximum_turnover: float, cost_bps: float, minimum_cash_weight: float) -> dict:
    """Long-only stock weights plus fixed research cash; no option-premium covariance."""
    from scipy.optimize import minimize

    if returns.ndim != 2 or not 60 <= len(returns) <= 260 or not 1 <= returns.shape[1] <= 5:
        raise ValueError("portfolio_comparison_requires_60_to_260_aligned_returns_and_one_to_five_stocks")
    if not np.all(np.isfinite(returns)):
        raise ValueError("portfolio_comparison_nonfinite_returns")
    covariance = np.atleast_2d(np.cov(returns, rowvar=False, ddof=1))
    if not np.all(np.isfinite(covariance)) or np.max(np.diag(covariance)) <= 1e-16:
        return {"status": "unavailable", "reason": "Observed returns contain no usable covariance variation.", "executionAuthorized": False}
    # Explicit modest diagonal shrinkage stabilizes small correlated samples.
    covariance = 0.9 * covariance + 0.1 * np.diag(np.diag(covariance))
    count = returns.shape[1]
    current_cash = 1 - float(current.sum())
    def turnover(weights):
        return 0.5 * (float(np.abs(weights - current).sum()) + abs(cash_weight - current_cash))
    constraints = [
        {"type": "eq", "fun": lambda weights: float(weights.sum()) - (1 - cash_weight)},
        {"type": "ineq", "fun": lambda weights: maximum_turnover - turnover(weights)},
        {"type": "ineq", "fun": lambda weights: cash_weight - minimum_cash_weight
         - float(np.abs(weights - current).sum()) * cost_bps / 10000},
    ]
    for category, (lower, upper) in category_bounds.items():
        indices = category_indices.get(category, [])
        constraints.extend([
            {"type": "ineq", "fun": lambda weights, ids=indices, bound=lower: float(weights[ids].sum()) - bound},
            {"type": "ineq", "fun": lambda weights, ids=indices, bound=upper: bound - float(weights[ids].sum())},
        ])
    initial = np.full(count, (1 - cash_weight) / count)
    fit = minimize(lambda weights: float(weights @ covariance @ weights), initial,
        method="SLSQP", jac=lambda weights: 2 * covariance @ weights,
        bounds=[(0, value) for value in maximum_weights], constraints=constraints,
        options={"maxiter": 500, "ftol": 1e-12})
    feasible = fit.success and np.all(np.isfinite(fit.x)) and all(
        abs(item["fun"](fit.x)) <= 1e-6 if item["type"] == "eq" else item["fun"](fit.x) >= -1e-6
        for item in constraints)
    feasible = feasible and bool(np.all(fit.x >= -1e-8) and np.all(fit.x <= np.asarray(maximum_weights) + 1e-8))
    if not feasible:
        return {"status": "unavailable", "reason": "No converged allocation satisfies the supplied bounds; no replacement allocation was selected."}
    def metrics(weights, cash):
        return {"weights": weights.tolist(), "cashWeight": cash,
            "historicalAnnualizedVolatility": math.sqrt(max(0, float(weights @ covariance @ weights)) * 252),
            "historicalAnnualizedMeanReturn": float(returns.mean(axis=0) @ weights) * 252,
            "oneWayTurnover": 0.5 * (float(np.abs(weights - current).sum()) + abs(cash - current_cash)),
            "assumedTradingCostFraction": float(np.abs(weights - current).sum()) * cost_bps / 10000}
    return {"status": "available", "method": "long_only_minimum_variance_SLSQP",
        "proposal": metrics(fit.x, cash_weight), "wait": metrics(current, current_cash),
        "allCash": metrics(np.zeros(count), 1.0),
        "covariance": covariance.tolist(), "historicalMeanReturnsPerBar": returns.mean(axis=0).tolist(),
        "observations": len(returns), "iterations": int(fit.nit),
        "assumptions": {"annualizationPeriods": 252, "diagonalShrinkage": 0.1,
            "cashYield": 0, "oneWayCostBps": cost_bps, "maximumOneWayTurnover": maximum_turnover},
        "executionAuthorized": False,
        "limitations": ["Historical sample estimates, not expected future returns or a validated trading strategy.",
            "Raw prices and currently retrieved archives can include splits, dividends and later corrections; this is not point-in-time total-return history.",
            "The invested budget is a comparison assumption, not an instruction to deploy capital.",
            "No options, shorts, nonlinear payoffs, market impact, taxes or execution authorization.",
            "All-cash and WAIT are comparators, not necessarily compliant with chosen allocation targets."]}


def optimize_portfolio(*, project_id, deck_id, card_id, source_execution, portfolio_card_id,
                       symbols, allocation_lanes, start, end, maximum_turnover_percent,
                       cost_bps, idempotency_key) -> dict:
    from dataclasses import asdict
    from datetime import date, datetime
    import hashlib
    import json
    from zoneinfo import ZoneInfo
    import pandas as pd
    from psycopg.rows import dict_row
    from app.python_models.alpaca_market_data import AlpacaInstrumentRef, get_historical_bars
    from app.python_models.postgres import connect_postgres
    from app.python_models.trading_contract import TradingBoundaryError, required_trade_text
    from app.python_models.trading_evidence import require_evidence_card, record_assessment
    from app.python_models.trading_forecast import _bar_windows, _timestamp, _valid_bar
    from app.python_models.trading_jobs import read_portfolio_context, _execution_reference

    if (not isinstance(symbols, list) or not 1 <= len(symbols) <= 5
            or any(not isinstance(symbol, str) or not symbol.strip() for symbol in symbols)):
        raise TradingBoundaryError("portfolio_comparison_symbols_invalid")
    names = [name.strip().upper() for name in symbols]
    if len(set(names)) != len(names) or not isinstance(allocation_lanes, dict) or set(allocation_lanes) != set(names):
        raise TradingBoundaryError("portfolio_comparison_explicit_lanes_required")
    if any(lane not in {"day_trading", "swing_trading", "microcaps", "core", "defensive"} for lane in allocation_lanes.values()):
        raise TradingBoundaryError("portfolio_comparison_stock_lanes_required")
    try:
        first, last = date.fromisoformat(start), date.fromisoformat(end)
    except (ValueError, TypeError):
        raise TradingBoundaryError("portfolio_comparison_dates_invalid") from None
    if not 90 <= (last - first).days <= 366 or last > datetime.now(ZoneInfo("America/New_York")).date():
        raise TradingBoundaryError("portfolio_comparison_requires_90_to_366_historical_days_end_exclusive")
    for value, maximum in ((maximum_turnover_percent, 100), (cost_bps, 1000)):
        if type(value) not in (float, int) or not math.isfinite(value) or not 0 <= value <= maximum:
            raise TradingBoundaryError("portfolio_comparison_cost_or_turnover_invalid")
    key = "portfolio:" + required_trade_text(idempotency_key, "idempotency_key", 120)
    request = {"portfolioCardId": portfolio_card_id, "symbols": names, "allocationLanes": allocation_lanes,
        "start": start, "endExclusive": end, "maximumTurnoverPercent": maximum_turnover_percent, "costBps": cost_bps}

    def retained_comparison(cursor):
        cursor.execute("""SELECT * FROM ag_catalog.trading_assessments
            WHERE project_id=%s AND deck_id=%s AND card_id=%s AND idempotency_key=%s""",
            (project_id, deck_id, card_id, key))
        previous = cursor.fetchone()
        if previous:
            references = previous["content"].get("evidence_references", [])
            if not references or references[0].get("request") != request or references[0].get("operation") != "portfolio.optimize":
                raise TradingBoundaryError("portfolio_comparison_idempotency_conflict")
            return {**references[0]["calculation"], "assessmentId": str(previous["assessment_id"])}
        return None

    with connect_postgres() as connection, connection.cursor(row_factory=dict_row) as cursor:
        card = require_evidence_card(cursor, project_id, deck_id, card_id, "portfolio.optimize")
        _execution_reference(source_execution, card["runtime_profile"])
        previous = retained_comparison(cursor)
        if previous:
            return previous
    portfolio = read_portfolio_context(project_id=project_id, deck_id=deck_id, card_id=portfolio_card_id)
    allocation, positions = portfolio["allocation"], portfolio["positions"]
    if not allocation["allocationComplete"] or not allocation["policySaved"]:
        return {"status": "unavailable", "reason": "A saved allocation policy and reconciled observed holdings are required; no default portfolio was substituted.", "executionAuthorized": False}
    policy = allocation["policy"]
    unsupported_loss_limits = (["maximumPositionLossPercent"] if policy["maximumPositionLossPercent"] is not None else [])
    unsupported_loss_limits += [row["id"] + ".maximumRiskPercent" for row in policy["categories"]
                                if row["id"] in allocation_lanes.values() and row["maximumRiskPercent"] is not None]
    if unsupported_loss_limits:
        return {"status": "unavailable", "reason": "Historical minimum variance does not enforce the saved maximum-loss limits: "
                + ", ".join(unsupported_loss_limits), "executionAuthorized": False}
    if "equity" not in policy["permittedInstrumentTypes"]:
        return {"status": "unavailable", "reason": "The saved policy does not permit equities; this data adapter does not verify a separate ETF-only universe.", "executionAuthorized": False}
    if policy["maximumPositionWeightPercent"] is None:
        return {"status": "unavailable", "reason": "The saved maximum position weight is unspecified.", "executionAuthorized": False}
    if any(row.get("assetClass") != "us_equity" or row.get("side") != "long"
           or row["instrumentId"] not in names for row in positions):
        return {"status": "unavailable", "reason": "Every existing noncash holding must be an included long US stock/ETF; derivatives and omitted holdings are not flattened into equity returns.", "executionAuthorized": False}
    if any(policy["positionCategories"].get(row["instrumentId"]) != allocation_lanes[row["instrumentId"]] for row in positions):
        raise TradingBoundaryError("portfolio_comparison_existing_category_mismatch")
    equity = allocation["portfolioValueUsd"]
    cash_row = next(row for row in policy["categories"] if row["id"] == "cash")
    minimum_cash = max(policy["minimumLiquidReservePercent"], cash_row["minimumPercent"]) / 100 + allocation["reservedCapitalUsd"] / equity
    cash_weight = max(cash_row["targetPercent"] / 100, minimum_cash)
    if cash_weight > cash_row["maximumPercent"] / 100 or cash_weight > 1:
        return {"status": "unavailable", "reason": "Cash, reservations and category bounds conflict.", "executionAuthorized": False}
    frames, sources = {}, []
    begin, finish = pd.Timestamp(first, tz="America/New_York"), pd.Timestamp(last, tz="America/New_York")
    expected = {stamp for stamp, complete in _bar_windows(begin, finish, "1Day") if begin <= stamp < finish and complete <= finish}
    for name in names:
        history = get_historical_bars(AlpacaInstrumentRef(symbol=name), "1Day", start=begin.isoformat(), end=finish.isoformat(), limit=1000, feed="iex")
        if history.status != "available" or history.truncated or history.diagnostics:
            return {"status": "unavailable", "reason": "Complete historical data unavailable for " + name, "executionAuthorized": False}
        rows = [asdict(bar) for bar in history.bars if begin <= _timestamp(bar.timestamp) < finish]
        stamps = [_timestamp(row["timestamp"]) for row in rows]
        if len(set(stamps)) != len(stamps) or set(stamps) != expected or any(not _valid_bar(row) for row in rows):
            return {"status": "unavailable", "reason": "Calendar gaps, duplicates or invalid daily observations for " + name, "executionAuthorized": False}
        frames[name] = pd.Series({stamp: row["close"] for stamp, row in zip(stamps, rows)})
        sources.append({"symbol": name, "provider": history.provider, "feed": history.feed,
                        "adjustment": "raw", "fetchedAt": history.fetchedAt})
    prices = pd.DataFrame(frames).sort_index()
    returns = prices.pct_change(fill_method=None).iloc[1:].to_numpy()
    current = np.asarray([sum(row["marketValueUsd"] for row in positions if row["instrumentId"] == name) / equity for name in names])
    indices = {row["id"]: [index for index, name in enumerate(names) if allocation_lanes[name] == row["id"]]
               for row in policy["categories"] if row["id"] != "cash"}
    bounds = {row["id"]: (row["minimumPercent"] / 100, row["maximumPercent"] / 100)
              for row in policy["categories"] if row["id"] != "cash"}
    try:
        result = minimum_variance_comparison(returns, current, cash_weight=cash_weight,
            maximum_weights=[policy["maximumPositionWeightPercent"] / 100] * len(names),
            category_indices=indices, category_bounds=bounds, maximum_turnover=maximum_turnover_percent / 100,
            cost_bps=cost_bps, minimum_cash_weight=minimum_cash)
    except (ImportError, ValueError, RuntimeError, FloatingPointError):
        return {"status": "unavailable", "reason": "The bounded classical comparison could not be estimated; no allocation was substituted.", "executionAuthorized": False}
    if result["status"] != "available":
        return result
    snapshot = {"timestamps": [stamp.isoformat() for stamp in prices.index], "symbols": names, "closes": prices.to_numpy().tolist()}
    portfolio_receipt = {"cardId": portfolio_card_id, "cardRevisionId": portfolio["cardRevisionId"],
        "observedAt": portfolio["observedAt"], "policyHash": allocation["policyHash"],
        "portfolioValueUsd": equity, "reportedCashUsd": allocation["reportedCashUsd"],
        "reservedCapitalUsd": allocation["reservedCapitalUsd"], "minimumCashWeight": minimum_cash,
        "maximumPositionWeightPercent": policy["maximumPositionWeightPercent"],
        "categoryBounds": bounds, "categoryTargets": {row["id"]: row["targetPercent"] for row in policy["categories"]}}
    result.update(symbols=names, allocationLanes=allocation_lanes, sources=sources, portfolio=portfolio_receipt,
        inputSummary={"firstObservation": snapshot["timestamps"][0], "lastObservation": snapshot["timestamps"][-1],
                      "priceObservations": len(prices), "rawBarsRetained": False},
        inputSha256=hashlib.sha256(json.dumps(snapshot, sort_keys=True).encode()).hexdigest(),
        dataCutoffExclusive=finish.isoformat(),
        liquidity="Not evaluated: quotes, spreads and executable size must be checked before a decision.")
    try:
        retained = record_assessment(project_id=project_id, deck_id=deck_id, card_id=card_id,
            source_execution=source_execution, candidate_id="portfolio:" + portfolio_card_id,
            kind="quant_initial", proposal_ids=[], idempotency_key=key, _operation="portfolio.optimize",
            content={"summary": "Constrained historical minimum-variance comparison, not an execution decision.",
                     "recommendation": "RESEARCH_ONLY", "uncertainty": "Sample covariance, assumed transaction costs and a fixed cash budget do not establish future returns, liquidity or whole-portfolio maximum loss.",
                     "evidence_references": [{"operation": "portfolio.optimize", "request": request, "calculation": result}]})
    except TradingBoundaryError as error:
        if str(error) != "trading_assessment_idempotency_conflict":
            raise
        with connect_postgres() as connection, connection.cursor(row_factory=dict_row) as cursor:
            previous = retained_comparison(cursor)
            if not previous:
                raise
            return previous
    return {**result, "assessmentId": retained["assessment_id"]}
