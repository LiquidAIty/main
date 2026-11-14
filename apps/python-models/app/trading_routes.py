"""Trading boundary routes."""

# Entity: Trading
# Relationship: Exposes Trading readiness, Project-scoped forecasts and comparisons, state reads, and bounded interventions through the existing Python owners.

from fastapi import APIRouter, HTTPException
from typing import Any
from app.python_models.trading_broker_observation import lumibot_readiness
from app.python_models.trading_contract import TradingBoundaryError
from app.python_models.trading_jobs import intervene_trade_job, read_trading_state
from app.python_models.trading_forecast import TradingForecastError, forecast_market_bars, read_forecast_history
from app.python_models.trading_forecast_store import read_forecasts, compare_forecast, retain_comparison
from pydantic import BaseModel, ConfigDict

router = APIRouter()


class ForecastRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    projectId: str
    deckId: str
    cardId: str
    symbol: str
    timeframe: str = "1Day"
    start: str | None = None
    end: str | None = None
    history_limit: int = 128
    horizon: int = 5
    model_variant: str = "mini"
    sample_count: int = 4
    seed: int = 443
    temperature: float = 1.0
    top_p: float = 0.9
    top_k: int = 0
    include_volatility: bool = False


@router.post("/trading/forecast")
async def trading_forecast(payload: ForecastRequest):
    args = payload.model_dump()
    args["_callerCardId"] = args.pop("cardId")
    try:
        return await forecast_market_bars(**args)
    except (TradingBoundaryError, TradingForecastError) as err:
        raise HTTPException(status_code=400, detail=str(err)) from err


@router.get("/trading/forecasts")
def trading_forecasts(projectId: str, deckId: str, cardId: str, forecastId: str | None = None, compare: bool = False):
    try:
        if compare:
            if not forecastId:
                raise TradingBoundaryError("trading_forecast_id_required")
            return compare_forecast(projectId, deckId, cardId, forecastId)
        return read_forecasts(projectId, deckId, cardId, forecastId)
    except (TradingBoundaryError, TradingForecastError) as err:
        raise HTTPException(status_code=400, detail=str(err)) from err


class ForecastComparisonRequest(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)
    projectId: str
    deckId: str
    cardId: str
    forecastId: str


@router.post('/trading/forecasts/compare')
def trading_compare_forecast(payload: ForecastComparisonRequest):
    try:
        return retain_comparison(payload.projectId, payload.deckId, payload.cardId, payload.forecastId)
    except (TradingBoundaryError, TradingForecastError) as err:
        raise HTTPException(status_code=400, detail=str(err)) from err


@router.get("/trading/forecast/history")
def trading_forecast_history(projectId: str, deckId: str, cardId: str, symbol: str, timeframe: str):
    try:
        return read_forecast_history(projectId, deckId, cardId, symbol, timeframe)
    except (TradingBoundaryError, TradingForecastError) as err:
        raise HTTPException(status_code=400, detail=str(err)) from err

@router.get("/trading/readiness")
def trading_readiness():
    return lumibot_readiness()


@router.get("/trading/state")
def trading_state(
    projectId: str,
    deckId: str,
    cardId: str,
    timeframe: str = "5Min",
    selectedJobId: str | None = None,
):
    try:
        return read_trading_state(
            project_id=str(projectId or "").strip(),
            deck_id=str(deckId or "").strip(),
            card_id=str(cardId or "").strip(),
            timeframe=str(timeframe or "").strip(),
            selected_job_id=str(selectedJobId or "").strip() or None,
        )
    except TradingBoundaryError as err:
        raise HTTPException(status_code=409, detail=str(err)) from err


@router.post("/trading/intervene")
def trading_intervene(payload: dict[str, Any]):
    try:
        return intervene_trade_job(
            project_id=str(payload.get("projectId") or "").strip(),
            deck_id=str(payload.get("deckId") or "").strip(),
            card_id=str(payload.get("cardId") or "").strip(),
            job_id=str(payload.get("jobId") or "").strip(),
            action=str(payload.get("action") or "").strip(),
            reason=str(payload.get("reason") or "").strip(),
            actor=str(payload.get("actor") or "").strip(),
        )
    except TradingBoundaryError as err:
        raise HTTPException(status_code=409, detail=str(err)) from err
