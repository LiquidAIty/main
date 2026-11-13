"""Trading state and decision Python tool handlers and definitions."""
# Entity: Trading
# Relationship: Publishes separately grantable Trading proposals, comparisons, work products, journal/review reads and writes alongside existing LumiBot and forecast tools without broker order execution.

from __future__ import annotations

import asyncio
from typing import Any

from app.application_tool_error import ApplicationToolError
from app.python_models.operation_definition import OperationDefinition
from app.python_models.trading_contract import TradingBoundaryError
from app.python_models.trading_forecast import forecast_market_bars
from app.python_models.trading_backtest import trading_list_bots, trading_backtest, trading_get_backtest
from app.python_models import trading_evidence, trading_journal
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
                                     journalEntryId=None, outcomeEntryId=None, candidateId=None, underlying=None,
                                     assetClass=None, limit=50, offset=0,
                                     *, projectId, deckId, _callerCardId):
    return await _evidence_call(trading_evidence.read_evidence, dict(project_id=projectId, deck_id=deckId,
        card_id=_callerCardId, proposal_id=proposalId, decision_id=decisionId, assessment_id=assessmentId,
        job_id=jobId, journal_entry_id=journalEntryId, outcome_entry_id=outcomeEntryId, candidate_id=candidateId,
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


async def trading_append_journal_tool(decisionId, phase, markdown, proposalIds, assessmentIds, evidence,
                                      idempotencyKey, *, projectId, deckId, _callerCardId, _sourceExecution):
    return await _evidence_call(trading_journal.append_journal, dict(project_id=projectId, deck_id=deckId,
        card_id=_callerCardId, source_execution=_sourceExecution, decision_id=decisionId, phase=phase,
        markdown=markdown, proposal_ids=proposalIds, assessment_ids=assessmentIds, evidence=evidence,
        idempotency_key=idempotencyKey))


async def trading_record_review_tool(markdown, proposalIds, assessmentIds, evidence,
                                     review, idempotencyKey, decisionId=None, outcomeEntryId=None, jobId=None,
                                     reviewEntryId=None,
                                     *, projectId, deckId, _callerCardId, _sourceExecution):
    return await _evidence_call(trading_journal.append_journal, dict(project_id=projectId, deck_id=deckId,
        card_id=_callerCardId, source_execution=_sourceExecution, decision_id=decisionId, phase="REVIEW",
        markdown=markdown, proposal_ids=proposalIds, assessment_ids=assessmentIds, evidence=evidence,
        review=review, idempotency_key=idempotencyKey, outcome_entry_id=outcomeEntryId, job_id=jobId,
        review_entry_id=reviewEntryId))


async def trading_record_outcome_tool(decisionId, *, projectId, deckId, _callerCardId, _sourceExecution):
    from app.python_models.trading_outcomes import record_outcome
    return await _evidence_call(record_outcome, dict(project_id=projectId, deck_id=deckId,
        card_id=_callerCardId, source_execution=_sourceExecution, decision_id=decisionId))


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
    journal = {"decisionId": uuid, "markdown": {**text, "maxLength": 30000}, "proposalIds": ids,
               "assessmentIds": {**ids, "maxItems": 32}, "evidence": {"type": "array", "maxItems": 64, "items": {"type": "object"}},
               "idempotencyKey": key}
    review = {"type": "object", "additionalProperties": False, "properties": {
        **{field: {"type": "array", "maxItems": 64, "items": {}} for field in (
            "contributing_cards", "observed_outcomes", "supported_findings", "contradictions", "repeated_patterns",
            "proposed_job_specific_lessons", "evidence_references")},
        "decision_quality": text, "uncertainty": text},
        "required": ["contributing_cards", "observed_outcomes", "supported_findings", "contradictions",
                     "decision_quality", "repeated_patterns", "proposed_job_specific_lessons", "evidence_references", "uncertainty"]}
    review["properties"]["contributing_cards"]["items"] = {"type": "string", "minLength": 1, "maxLength": 160}
    review["properties"]["supersedes_review_id"] = {**uuid,
        "description": "Only for an explicit dated correction to this Learner's latest review of the same outcome; the original remains unchanged."}
    review["properties"]["proposed_job_specific_lessons"]["items"] = {
        "type": "object", "properties": {"card_id": key, "lesson": {**text, "maxLength": 4000},
            "evidence_references": {"type": "array", "minItems": 1, "maxItems": 64, "items": {"type": "object"}},
            "confidence": {"type": "number", "minimum": 0, "maximum": 1}},
        "required": ["card_id", "lesson", "evidence_references", "confidence"], "additionalProperties": False}
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
         "Read bounded Project/deck evidence by exactly one proposalId, decisionId, jobId, journalEntryId, outcomeEntryId or assessmentId. Job reads return the accepted plan and decision references; follow those exact trails for team assessments, journals and calculations. Open, rejected, WAIT, historical and SHADOW cases do not require closure. Alternatively search reusable research and attributed prior reviews by candidateId and/or underlying, optionally assetClass=option. Retained sources, quote age and expiry are not refreshed. Use next_offset for more. No private Hermes history or inferred broker outcomes.",
         {"proposalId": uuid, "decisionId": uuid, "assessmentId": uuid, "jobId": uuid,
          "journalEntryId": uuid, "outcomeEntryId": uuid, "candidateId": key,
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
        ("append_journal", trading_append_journal_tool, False,
         "Trader appends intentional BEFORE/DURING/AFTER/CORRECTION Markdown to its exact saved decision. BEFORE records the original/opposing pair once; an unfunded WAIT may record why no proposal was possible without inventing a pair. Later entries cannot rewrite it. No job state, P&L or order changes. Cite an outcomeEntryId for reconciled execution evidence; simulation and shadow results are not earnings.",
         {**journal, "phase": {"type": "string", "enum": ["BEFORE", "DURING", "AFTER", "CORRECTION"]}}, [*journal, "phase"]),
        ("record_outcome", trading_record_outcome_tool, False,
         "On request, reconcile an owned paper Trade Job's exact broker order IDs using its original decisionId with an existing BEFORE journal. Fully matched US-stock entry/exit fills create one immutable closing receipt. Return its decisionId, outcomeEntryId and existing review status; this does not trigger a review. Learner can review other available evidence without this operation. Missing orders, partial exits, derivatives or unresolved identities remain incomplete. Gross P&L is not net profit; unavailable costs are not invented. No orders, job-state change, Bot dispatch or scheduler.",
         {"decisionId": uuid}, ["decisionId"]),
        ("record_review", trading_record_review_tool, False,
         "Learner writes an intentional Markdown REVIEW on demand in the existing Trading journal. Supply decisionId when one exists; otherwise supply existing proposalIds or an exact jobId without inventing a Trader decision. Review retained whole-team evidence for open/completed trades, rejected ideas, WAIT, historical and SHADOW cases; closure and a BEFORE entry are not prerequisites. Preserve an existing BEFORE and its pair. Reuse an existing review or the same idempotencyKey for a repeated request; alreadyReviewed is not another sample. outcomeEntryId is optional broker-reconciled evidence, never inferred from an EXIT recommendation. Use your own enabled Hermes memory/skills for supported reusable lessons citing this saved review; this tool does not write Hermes learning or other Cards' memory.",
         {**journal, "review": review, "reviewEntryId": {**uuid,
             "description": "Existing own REVIEW identity for an exact replay. Read and resend its retained content/references; returns that record, never another copy. Changed content requires a separate dated review, not an overwrite."}, "jobId": {**uuid,
             "description": "Existing Trade Job to review when no decisionId is supplied."}, "outcomeEntryId": {**uuid,
             "description": "Optional verified closing-outcome journal entry, supplied with its decisionId. Repeated delivery returns the existing review."}},
         [field for field in journal if field != "decisionId"] + ["review"]),
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
                "decisions, evidence, execution-block state, and recorded portfolio outcomes."
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
                "Journal one WAIT, ENTER, HOLD, REDUCE, EXIT, PAUSE, or FAIL_SAFE outcome "
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
