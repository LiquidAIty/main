"""Trading state and decision Python tool handlers and definitions."""
# Entity: Trading
# Relationship: Publishes separately grantable Trading proposals, comparisons and work products alongside existing LumiBot and forecast tools without broker order execution.

from __future__ import annotations

import asyncio
from typing import Any

from app.application_tool_error import ApplicationToolError
from app.python_models.operation_definition import OperationDefinition
from app.python_models.trading_contract import TradingBoundaryError
from app.python_models.trading_forecast import forecast_market_bars
from app.python_models.trading_backtest import trading_list_bots, trading_backtest, trading_get_backtest
from app.python_models import trading_evidence
from app.python_models.trading_proposals import TradeProposal
from app.python_models.trading_lumibot_tools import research_definitions


async def _evidence_call(function, arguments):
    try:
        return await asyncio.to_thread(function, **arguments)
    except TradingBoundaryError as error:
        raise ApplicationToolError(str(error)) from None


async def trading_record_proposal_tool(proposal, idempotencyKey, *, projectId, deckId, _callerCardId, _sourceExecution):
    return await _evidence_call(trading_evidence.record_proposal, dict(project_id=projectId, deck_id=deckId,
        card_id=_callerCardId, source_execution=_sourceExecution, proposal=proposal, idempotency_key=idempotencyKey))


async def trading_invert_proposal_tool(proposalId, alternative=None, *, projectId, deckId, _callerCardId, _sourceExecution):
    return await _evidence_call(trading_evidence.invert_proposal, dict(project_id=projectId, deck_id=deckId,
        card_id=_callerCardId, source_execution=_sourceExecution, proposal_id=proposalId, alternative=alternative))


async def trading_record_assessment_tool(candidateId, kind, proposalIds, content, idempotencyKey,
                                         *, projectId, deckId, _callerCardId, _sourceExecution):
    return await _evidence_call(trading_evidence.record_assessment, dict(project_id=projectId, deck_id=deckId,
        card_id=_callerCardId, source_execution=_sourceExecution, candidate_id=candidateId, kind=kind,
        proposal_ids=proposalIds, content=content, idempotency_key=idempotencyKey))


async def trading_read_evidence_tool(proposalId=None, decisionId=None, assessmentId=None, jobId=None,
                                     candidateId=None, underlying=None,
                                     assetClass=None, limit=50, offset=0,
                                     *, projectId, deckId, _callerCardId):
    return await _evidence_call(trading_evidence.read_evidence, dict(project_id=projectId, deck_id=deckId,
        card_id=_callerCardId, proposal_id=proposalId, decision_id=decisionId, assessment_id=assessmentId,
        job_id=jobId, candidate_id=candidateId,
        underlying=underlying, asset_class=assetClass, limit=limit, offset=offset))


async def trading_compare_proposals_tool(originalId, opposingId, underlyingPrices, portfolioCardId=None,
                                         allocationLane=None, *, projectId, deckId, _callerCardId):
    return await _evidence_call(trading_evidence.compare_scenarios, dict(project_id=projectId, deck_id=deckId,
        card_id=_callerCardId, original_id=originalId, opposing_id=opposingId, underlying_prices=underlyingPrices,
        portfolio_card_id=portfolioCardId, allocation_lane=allocationLane))


async def trading_observe_proposals_tool(originalId, opposingId, idempotencyKey, *, projectId, deckId, _callerCardId, _sourceExecution):
    return await _evidence_call(trading_evidence.observe_proposals, dict(project_id=projectId, deck_id=deckId,
        card_id=_callerCardId, source_execution=_sourceExecution, original_id=originalId,
        opposing_id=opposingId, idempotency_key=idempotencyKey))


async def portfolio_optimize_tool(portfolioCardId, symbols, allocationLanes, start, end,
                                  maximumTurnoverPercent, costBps, idempotencyKey,
                                  *, projectId, deckId, _callerCardId, _sourceExecution):
    from app.python_models.trading_statistics import optimize_portfolio
    return await _evidence_call(optimize_portfolio, dict(project_id=projectId, deck_id=deckId,
        card_id=_callerCardId, source_execution=_sourceExecution, portfolio_card_id=portfolioCardId,
        symbols=symbols, allocation_lanes=allocationLanes, start=start, end=end,
        maximum_turnover_percent=maximumTurnoverPercent, cost_bps=costBps, idempotency_key=idempotencyKey))


def _evidence_definitions():
    proposal = TradeProposal.model_json_schema()
    nested = proposal.pop("$defs", {})
    uuid = {"type": "string", "format": "uuid"}
    ids = {"type": "array", "items": uuid, "maxItems": 8, "uniqueItems": True}
    key = {"type": "string", "minLength": 1, "maxLength": 160}
    text = {"type": "string", "minLength": 1, "maxLength": 12000}
    definitions = [
        ("record_proposal", trading_record_proposal_tool, False,
         "Persist one Designer proposal with actual saved Card/Hermes authorship. Supplied quotes retain their sources but are not independently verified by this calculator. Equities and fully specified single options have payoff math; other markets return unavailable economics. Never allocates capital or submits orders.",
         {"proposal": proposal, "idempotencyKey": key}, ["proposal", "idempotencyKey"]),
        ("invert_proposal", trading_invert_proposal_tool, False,
         "Read an exact saved original and persist its mechanical counterparty, separately from an optional supplied defined-risk opposing strategy. Reuses exact terms/cutoff; never invents quotes or borrow. Missing/unsafe terms remain visible. The Contrarian must independently assess this result, not claim the copied original thesis as its own.",
         {"proposalId": uuid, "alternative": proposal}, ["proposalId"]),
        ("record_assessment", trading_record_assessment_tool, False,
         "Retain one explicit specialist work product, not hidden reasoning or a transcript. Contrarian and Quant comparison require original then opposing proposal IDs. Quant recommendations: SUPPORT_ORIGINAL, SUPPORT_OPPOSING, REVISE_STRUCTURE, INSUFFICIENT_EVIDENCE or WAIT. Keep calculations tied to actual tool receipts.",
         {"candidateId": key, "kind": {"type": "string", "enum": ["opportunity", "research", "contrarian", "quant_initial", "quant_comparison"]},
          "proposalIds": ids, "content": {"type": "object", "properties": {"summary": text, "uncertainty": text,
              "recommendation": text, "evidence_references": {"type": "array", "maxItems": 64, "items": {"type": "object"}}},
              "required": ["summary", "uncertainty", "recommendation", "evidence_references"], "additionalProperties": False},
          "idempotencyKey": key}, ["candidateId", "kind", "proposalIds", "content", "idempotencyKey"]),
        ("read_evidence", trading_read_evidence_tool, True,
         "Read existing Project/deck calculation and proposal evidence by one proposalId, decisionId, jobId or assessmentId, or search retained candidates by candidateId/underlying. No journal, agent memory, private chat or broker execution is created. Use next_offset for bounded results.",
         {"proposalId": uuid, "decisionId": uuid, "assessmentId": uuid, "jobId": uuid,
          "candidateId": key,
          "underlying": {"type": "string", "minLength": 1, "maxLength": 80},
          "assetClass": {"type": "string", "enum": ["equity", "option", "future", "forex", "crypto", "prediction_market"]},
          "limit": {"type": "integer", "minimum": 1, "maximum": 100, "default": 50},
          "offset": {"type": "integer", "minimum": 0, "maximum": 10000, "default": 0}}, []),
        ("compare_proposals", trading_compare_proposals_tool, True,
         "Calculate independent SHADOW payoff scenarios for a retained original/opposing pair. Supply portfolioCardId and allocationLane together to compare against the actual same-Project portfolio, saved allocation policy, cash/reservations and WAIT. Unknown collateral, whole-book risk and costs remain unknown. No capital changes or order permission. Not a forecast, backtest, current option valuation or actual profit. Options are evaluated at expiration only.",
         {"originalId": uuid, "opposingId": uuid, "underlyingPrices": {"type": "array", "minItems": 1, "maxItems": 20,
             "items": {"type": "number", "minimum": 0, "maximum": 1e12}},
          "portfolioCardId": key, "allocationLane": {"type": "string", "enum": [
              "options", "day_trading", "swing_trading", "microcaps", "core", "defensive", "crypto", "prediction_markets"]}},
         ["originalId", "opposingId", "underlyingPrices"]),
        ("observe_proposals", trading_observe_proposals_tool, False,
         "After a retained pair's horizon, fetch the exact subsequent completed US-equity daily IEX bar and retain a SHADOW comparison with actual provider data and execution provenance. Not actual/paper fills, portfolio earnings or a strategy backtest. Missing observations remain incomplete; options return unavailable rather than inferred profit. Reuse the key for exact retry.",
         {"originalId": uuid, "opposingId": uuid, "idempotencyKey": key}, ["originalId", "opposingId", "idempotencyKey"]),
    ]
    return [OperationDefinition(canonical_id=f"trading.{name}", title=name.replace("_", " ").capitalize(),
        description=description, parameters_schema={"type": "object", "properties": properties,
        "required": required, "additionalProperties": False, **({"$defs": nested} if name in {"record_proposal", "invert_proposal"} else {})},
        output_schema={"type": "object"}, handler=handler, available=True, publishers=frozenset({"internal-plugin"}),
        access="read" if read else "write", namespace="trading", grant_eligible=True, external_source_id="python_runtime",
        dispatcher_context_arguments=frozenset({"projectId", "deckId", "_callerCardId"} | (set() if read else {"_sourceExecution"})),
        annotations=_annotations(read_only=read, destructive=False, idempotent=True, open_world=False))
        for name, handler, read, description, properties, required in definitions]

async def trading_get_state_tool(
    *, projectId: str, deckId: str, _callerCardId: str,
) -> dict[str, Any]:
    from app.python_models.trading_jobs import read_trading_state

    return await asyncio.to_thread(
        read_trading_state,
        project_id=projectId,
        deck_id=deckId,
        card_id=_callerCardId,
    )


async def trading_accept_assignment_tool(
    plan: dict[str, Any],
    idempotencyKey: str,
    *,
    projectId: str,
    deckId: str,
    _callerCardId: str,
    _sourceExecution: dict[str, Any],
) -> dict[str, Any]:
    from app.python_models.trading_jobs import accept_trade_assignment

    try:
        return await asyncio.to_thread(
            accept_trade_assignment, project_id=projectId, deck_id=deckId,
            card_id=_callerCardId, source_execution=_sourceExecution,
            plan=plan, idempotency_key=idempotencyKey,
        )
    except TradingBoundaryError as error:
        raise ApplicationToolError(str(error)) from None


async def trading_record_decision_tool(
    action: str,
    rationale: str,
    confidence: float,
    evidence: list[dict[str, Any]],
    missingTerms: list[str],
    idempotencyKey: str,
    jobId: str | None = None,
    subject: str | None = None,
    *,
    projectId: str,
    deckId: str,
    _callerCardId: str,
    _sourceExecution: dict[str, Any],
) -> dict[str, Any]:
    from app.python_models.trading_jobs import record_trade_decision

    try:
        return await asyncio.to_thread(
            record_trade_decision, project_id=projectId, deck_id=deckId,
            card_id=_callerCardId, source_execution=_sourceExecution,
            job_id=jobId, subject=subject, action=action, rationale=rationale,
            confidence=confidence, evidence=evidence, missing_terms=missingTerms,
            idempotency_key=idempotencyKey,
        )
    except TradingBoundaryError as error:
        raise ApplicationToolError(str(error)) from None
def _annotations(
    *, read_only: bool, destructive: bool, idempotent: bool, open_world: bool,
) -> dict[str, bool]:
    return {
        "readOnlyHint": read_only,
        "destructiveHint": destructive,
        "idempotentHint": idempotent,
        "openWorldHint": open_world,
    }
def trading_tool_operation_definitions() -> list[OperationDefinition]:
    internal = frozenset({"internal-plugin"})
    read_closed = _annotations(
        read_only=True, destructive=False, idempotent=True, open_world=False,
    )
    write_closed = _annotations(
        read_only=False, destructive=False, idempotent=True, open_world=False,
    )
    return [
        *_evidence_definitions(),
        *research_definitions(),
        OperationDefinition(
            canonical_id="portfolio.optimize", title="Compare classical portfolio allocation",
            description="Retain a bounded long-only minimum-variance comparison against actual same-Project holdings, WAIT and cash. Uses 1–5 US stocks/ETFs and 90–366 historical days (end exclusive), exact calendar-aligned raw IEX bars, saved category/position limits and explicit assumed costs/turnover. Requires the complete stock portfolio and saved allocation policy; never substitutes option premiums for stock returns or drops unsupported holdings. Produces an attributed assessment receipt, not allocation changes or orders.",
            parameters_schema={"type": "object", "properties": {
                "portfolioCardId": {"type": "string", "minLength": 1},
                "symbols": {"type": "array", "minItems": 1, "maxItems": 5, "uniqueItems": True, "items": {"type": "string", "minLength": 1}},
                "allocationLanes": {"type": "object", "minProperties": 1, "maxProperties": 5, "additionalProperties": {
                    "type": "string", "enum": ["day_trading", "swing_trading", "microcaps", "core", "defensive"]}},
                "start": {"type": "string", "format": "date"}, "end": {"type": "string", "format": "date"},
                "maximumTurnoverPercent": {"type": "number", "minimum": 0, "maximum": 100},
                "costBps": {"type": "number", "minimum": 0, "maximum": 1000},
                "idempotencyKey": {"type": "string", "minLength": 1, "maxLength": 120},
            }, "required": ["portfolioCardId", "symbols", "allocationLanes", "start", "end", "maximumTurnoverPercent", "costBps", "idempotencyKey"], "additionalProperties": False},
            output_schema={"type": "object"}, handler=portfolio_optimize_tool, available=True,
            publishers=internal, access="write", namespace="trading", grant_eligible=True,
            external_source_id="python_runtime", dispatcher_context_arguments=frozenset({"projectId", "deckId", "_callerCardId", "_sourceExecution"}),
            annotations=_annotations(read_only=False, destructive=False, idempotent=True, open_world=True),
        ),
        OperationDefinition(
            canonical_id="trading.list_bots", title="Read available LumiBot strategies",
            description="Inspect the installed, supported LumiBot strategy examples and their exact rules and limits. Does not run a bot or submit orders.",
            parameters_schema={"type": "object", "properties": {}, "additionalProperties": False},
            output_schema={"type": "object"}, handler=trading_list_bots, available=True, publishers=internal,
            access="read", namespace="trading", grant_eligible=True, external_source_id="python_runtime", annotations=read_closed,
        ),
        OperationDefinition(
            canonical_id="trading.backtest", title="Backtest a LumiBot strategy",
            description="Run one installed LumiBot example on validated historical US stock/ETF daily Alpaca IEX bars. "
                        "Historical simulation only: no broker connection or orders. Explicit 7-366 day dates, end exclusive. "
                        "Persists the completed result and input snapshot in Trading with actual producing Card/Hermes references. "
                        "Returns a backtestId, native metrics, equity and actual data/cost assumptions; not proof of profitable execution. "
                        "Inspect trading.list_bots before choosing a bot. No background queue or arbitrary code.",
            parameters_schema={"type": "object", "properties": {
                "bot": {"type": "string", "enum": ["buy_and_hold", "momentum_rotation"]},
                "symbols": {"type": "array", "minItems": 1, "maxItems": 5, "uniqueItems": True,
                            "items": {"type": "string", "minLength": 1}},
                "start": {"type": "string", "format": "date"}, "end": {"type": "string", "format": "date"},
                "capital": {"type": "number", "exclusiveMinimum": 0, "maximum": 1000000},
                "fee_bps": {"type": "number", "minimum": 0, "maximum": 1000, "default": 0},
                "slippage_per_share": {"type": "number", "minimum": 0, "maximum": 100, "default": 0},
            }, "required": ["bot", "symbols", "start", "end", "capital"], "additionalProperties": False},
            output_schema={"type": "object"}, handler=trading_backtest, available=True, publishers=internal,
            access="write", namespace="trading", grant_eligible=True, external_source_id="python_runtime",
            dispatcher_context_arguments=frozenset({"projectId", "deckId", "_callerCardId", "_sourceExecution"}),
            annotations=_annotations(read_only=False, destructive=False, idempotent=False, open_world=True),
        ),
        OperationDefinition(
            canonical_id="trading.get_backtest", title="Read a saved backtest",
            description="Read one exact completed Trading backtest in this Project/deck, preserving its producing Card, native execution references, data cutoff, costs, assumptions and actual results. This does not rerun a strategy or submit an order.",
            parameters_schema={"type": "object", "properties": {
                "backtestId": {"type": "string", "format": "uuid"},
            }, "required": ["backtestId"], "additionalProperties": False},
            output_schema={"type": "object"}, handler=trading_get_backtest,
            available=True, publishers=internal, access="read", namespace="trading", grant_eligible=True,
            external_source_id="python_runtime", annotations=read_closed,
            dispatcher_context_arguments=frozenset({"projectId", "deckId"}),
        ),
        OperationDefinition(
            canonical_id="trading.get_state",
            title="Read paper trading state",
            description=(
                "Read this authenticated Trading Card's durable paper Trade Jobs, typed "
                "decisions, cited backtests, allocation policy and current broker/account observations. "
                "The optional stored decisions are not the Trader's Markdown journal."
            ),
            parameters_schema={"type": "object", "properties": {}, "required": []},
            output_schema={"type": "object"},
            handler=trading_get_state_tool,
            available=True,
            publishers=internal,
            access="read",
            namespace="python",
            grant_eligible=True,
            external_source_id="python_runtime",
            annotations=read_closed,
            dispatcher_context_arguments=frozenset({
                "projectId", "deckId", "_callerCardId",
            }),
        ),
        OperationDefinition(
            canonical_id="trading.accept_assignment",
            title="Accept a paper trade assignment",
            description=(
                "Validate and persist one complete structured paper trade assignment as a "
                "Trade Job. Missing execution terms fail closed. This never submits an order."
            ),
            parameters_schema={
                "type": "object",
                "properties": {
                    "plan": {"type": "object"},
                    "idempotencyKey": {"type": "string", "minLength": 1, "maxLength": 160},
                },
                "required": ["plan", "idempotencyKey"],
                "additionalProperties": False,
            },
            output_schema={"type": "object"},
            handler=trading_accept_assignment_tool,
            available=True,
            publishers=internal,
            access="write",
            namespace="python",
            grant_eligible=True,
            external_source_id="python_runtime",
            annotations=write_closed,
            dispatcher_context_arguments=frozenset({
                "projectId", "deckId", "_callerCardId", "_sourceExecution",
            }),
        ),
        OperationDefinition(
            canonical_id="trading.record_decision",
            title="Record a paper trading decision",
            description=(
                "Optionally record one WAIT, ENTER, HOLD, REDUCE, EXIT, PAUSE, or FAIL_SAFE decision "
                "with evidence. Specify an owned jobId OR a research subject without inventing a funded job. "
                "Use evidence entries with backtestId for exact saved simulation references. "
                "Reuse an idempotencyKey only for the exact same decision. A decision is not an order; executionRequested is always false."
            ),
            parameters_schema={
                "type": "object",
                "properties": {
                    "jobId": {"type": "string", "format": "uuid"},
                    "subject": {"type": "string", "minLength": 1, "maxLength": 500,
                                "description": "Research idea or instrument being assessed; use instead of jobId for an unfunded decision."},
                    "action": {"type": "string", "enum": ["WAIT", "ENTER", "HOLD", "REDUCE", "EXIT", "PAUSE", "FAIL_SAFE"]},
                    "rationale": {"type": "string", "minLength": 1, "maxLength": 8000},
                    "confidence": {"type": "number", "minimum": 0, "maximum": 1},
                    "evidence": {"type": "array", "maxItems": 64, "items": {"type": "object"}},
                    "missingTerms": {"type": "array", "maxItems": 32, "items": {"type": "string", "minLength": 1}},
                    "idempotencyKey": {"type": "string", "minLength": 1, "maxLength": 160},
                },
                "required": ["action", "rationale", "confidence", "evidence", "missingTerms", "idempotencyKey"],
                "additionalProperties": False,
            },
            output_schema={"type": "object"},
            handler=trading_record_decision_tool,
            available=True,
            publishers=internal,
            access="write",
            namespace="python",
            grant_eligible=True,
            external_source_id="python_runtime",
            annotations=write_closed,
            dispatcher_context_arguments=frozenset({
                "projectId", "deckId", "_callerCardId", "_sourceExecution",
            }),
        ),
        OperationDefinition(
            canonical_id="forecast_market_bars",
            title="Forecast market bars",
            description=(
                "Fetch one bounded real Alpaca paper-data history window and use Kronos "
                "to forecast and retain the next OHLCV bars without creating a trade or order. "
                "Omit end for a current forecast: the server uses invocation time. An explicit end "
                "is a historical information cutoff (timezone required) and must not be in the future. "
                "Daily bars are accepted only "
                "after 20:00 New York time. Invalid model candles remain flagged, not repaired."
            ),
            parameters_schema={
                "type": "object",
                "properties": {
                    "symbol": {"type": "string", "minLength": 1},
                    "timeframe": {"type": "string", "enum": ["1Min", "5Min", "15Min", "1Hour", "1Day"]},
                    "start": {"type": ["string", "null"]},
                    "end": {"type": ["string", "null"]},
                    "history_limit": {"type": "integer", "minimum": 16, "maximum": 400, "default": 128},
                    "horizon": {"type": "integer", "minimum": 1, "maximum": 20, "default": 5},
                    "model_variant": {"type": "string", "enum": ["mini", "small", "base"], "default": "mini"},
                    "sample_count": {"type": "integer", "minimum": 1, "maximum": 64, "default": 4,
                                     "description": "CPU capacity: up to 64 paths for mini, 16 for small or base."},
                    "seed": {"type": "integer", "minimum": 0, "maximum": 2147483647, "default": 443},
                    "temperature": {"type": "number", "exclusiveMinimum": 0, "default": 1.0},
                    "top_p": {"type": "number", "exclusiveMinimum": 0, "maximum": 1, "default": 0.9},
                    "top_k": {"type": "integer", "minimum": 0, "default": 0,
                              "description": "0 uses top-p; positive top-k replaces top-p. 1 is greedy and collapses repeated paths."},
                    "include_volatility": {"type": "boolean", "default": False,
                        "description": "Also fit bounded GARCH(1,1) and a held-out variance comparison on the same retained observations (101+ closes). Volatility only, not direction or implied volatility."},
                },
                "required": ["symbol", "timeframe"],
                "additionalProperties": False,
            },
            output_schema={"type": "object"},
            handler=forecast_market_bars,
            available=True,
            publishers=internal,
            access="write",
            namespace="trading",
            grant_eligible=True,
            external_source_id="python_runtime",
            dispatcher_context_arguments=frozenset({"projectId", "deckId", "_callerCardId"}),
            annotations={
                "readOnlyHint": False,
                "destructiveHint": False,
                "idempotentHint": False,
                "openWorldHint": True,
            },
        ),
    ]
