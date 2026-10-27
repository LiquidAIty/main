"""Trading boundary routes."""

# Graph + less = more: less code that does the same work as more code is more useful.
# Entity names the feature; Relationship explains why this file belongs and what it contributes.
# Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
# Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
# Entity: Trading
# Relationship: Trading exposes Python readiness, Project-scoped state reads, and operator interventions while translating domain failures into stable HTTP conflicts.

from fastapi import APIRouter, HTTPException
from typing import Any
from app.python_models.trading_broker_observation import lumibot_readiness
from app.python_models.trading_contract import TradingBoundaryError
from app.python_models.trading_jobs import intervene_trade_job, read_trading_state

router = APIRouter()

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
