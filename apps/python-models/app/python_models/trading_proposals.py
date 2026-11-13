"""Deterministic economics for retained, unexecuted competing trade proposals."""
# Entity: Trading
# Relationship: Validates explicit proposal terms and calculates counterparty and directional alternatives without inventing quotes, borrowing, fills, or model conclusions.

from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator, model_validator

from app.python_models.trading_contract import TradingBoundaryError

Text = Annotated[str, Field(min_length=1, max_length=4000)]
Number = Annotated[float, Field(ge=0, le=1e12, allow_inf_nan=False, strict=True)]
Positive = Annotated[float, Field(gt=0, le=1e9, allow_inf_nan=False, strict=True)]


class Terms(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class Quote(Terms):
    bid: Number
    ask: Number
    observed_at: datetime
    source_reference: Text

    @model_validator(mode="after")
    def valid(self):
        if self.bid > self.ask or self.ask <= 0 or self.observed_at.tzinfo is None:
            raise ValueError("uncrossed positive quote and zoned observation time required")
        return self


class OptionContract(Terms):
    right: Literal["call", "put"]
    strike: Positive
    expiration: datetime
    multiplier: Positive
    settlement: Literal["physical", "cash"]
    style: Literal["american", "european"]
    source_reference: Text

    @field_validator("expiration")
    @classmethod
    def zoned(cls, value):
        if value.tzinfo is None:
            raise ValueError("expiration timezone required")
        return value


class Borrow(Terms):
    status: Literal["available", "unavailable", "unknown"]
    observed_at: datetime
    annual_rate: Number | None = None
    source_reference: Text

    @field_validator("observed_at")
    @classmethod
    def zoned(cls, value):
        if value.tzinfo is None:
            raise ValueError("borrow observation timezone required")
        return value


class TradeProposal(Terms):
    candidate_id: Annotated[str, Field(min_length=1, max_length=160)]
    market: Annotated[str, Field(min_length=1, max_length=80)]
    asset_class: Literal["equity", "option", "future", "forex", "crypto", "prediction_market"]
    instrument_identifier: Annotated[str, Field(min_length=1, max_length=160)]
    underlying: Annotated[str, Field(min_length=1, max_length=80)]
    side: Literal["long", "short"]
    thesis: Text
    entry_conditions: Text
    exit_conditions: Text
    invalidation: Text
    information_cutoff: datetime
    horizon_end: datetime
    quantity: Positive
    quote: Quote | None = None
    round_trip_cost: Number | None = None
    borrow: Borrow | None = None
    option: OptionContract | None = None
    source_references: Annotated[list[Text], Field(min_length=1, max_length=32)]
    allocation_lane: Literal["options", "day_trading", "swing_trading", "microcaps", "core", "defensive", "crypto", "prediction_markets"] | None = Field(
        default=None, exclude_if=lambda value: value is None,
        description="Explicit assigned Investment Category; never inferred from a ticker. Omit if not assigned.")
    strategy_id: Annotated[str, Field(min_length=1, max_length=120)] | None = Field(
        default=None, exclude_if=lambda value: value is None,
        description="Explicit research/strategy identifier for later comparison, not evidence that a bot ran.")
    sector: Annotated[str, Field(min_length=1, max_length=120)] | None = Field(
        default=None, exclude_if=lambda value: value is None,
        description="Declared research sector, with its classification source among source_references; omit if unknown.")

    @model_validator(mode="after")
    def consistent(self):
        if self.information_cutoff.tzinfo is None or self.horizon_end.tzinfo is None:
            raise ValueError("cutoff and horizon timezone required")
        if self.horizon_end <= self.information_cutoff:
            raise ValueError("horizon must follow information cutoff")
        if self.information_cutoff > datetime.now(timezone.utc):
            raise ValueError("information cutoff cannot be in the future")
        for observation in (self.quote, self.borrow):
            if observation and observation.observed_at > self.information_cutoff:
                raise ValueError("observation after information cutoff")
        if self.asset_class != "option" and self.option:
            raise ValueError("option terms require option asset class")
        if self.option and self.option.expiration <= self.information_cutoff:
            raise ValueError("option expired before information cutoff")
        if self.asset_class == "option" and not self.quantity.is_integer():
            raise ValueError("option contract quantity must be integral")
        return self


def parse_proposal(value: dict) -> TradeProposal:
    try:
        return TradeProposal.model_validate(value)
    except ValidationError as error:
        # Field paths, not possibly private source documents or provider responses.
        fields = sorted({".".join(map(str, item["loc"])) or "proposal" for item in error.errors()})
        raise TradingBoundaryError("trading_proposal_invalid:" + ",".join(fields)) from None


def economics(proposal: TradeProposal) -> dict:
    """Expiry payoff, not pre-expiry option pricing or an execution promise."""
    direction = 1 if proposal.side == "long" else -1
    if proposal.option and proposal.option.right == "put":
        direction *= -1
    result = {
        "direction": "bullish" if direction > 0 else "bearish",
        "status": "available_for_analysis", "missing_terms": [],
        "execution_authorized": False, "quote_verification": "caller_supplied_with_reference",
        "maximum_loss": None, "maximum_gain": None, "breakeven": None,
        "entry_price": None, "cost_assumption": proposal.round_trip_cost,
        "limitations": ["No broker support, executable liquidity or fill has been verified.",
                        "Quoted prices are observations; entry conditions may never be met."],
    }
    if proposal.asset_class not in {"equity", "option"}:
        result.update(status="unavailable", direction=None, missing_terms=["supported_payoff_model"])
        return result
    if proposal.asset_class == "option" and not proposal.option:
        result.update(status="unavailable", direction=None, missing_terms=["option_contract_terms"])
        return result
    if proposal.quote is None:
        result["missing_terms"].append("quote")
    if proposal.round_trip_cost is None:
        result["missing_terms"].append("round_trip_cost")
    if proposal.asset_class == "equity" and proposal.side == "short":
        if not proposal.borrow or proposal.borrow.status != "available":
            result["missing_terms"].append("available_borrow")
        if not proposal.borrow or proposal.borrow.annual_rate is None:
            result["missing_terms"].append("borrow_cost")
        result["limitations"].append("Borrow may be recalled; margin, dividends and changing borrow fees are not modeled.")
    if result["missing_terms"]:
        result["status"] = "incomplete"
    if proposal.quote is None:
        return result
    price = proposal.quote.ask if proposal.side == "long" else proposal.quote.bid
    result["entry_price"] = price
    units = proposal.quantity * (proposal.option.multiplier if proposal.option else 1)
    fee = proposal.round_trip_cost
    if proposal.asset_class == "equity" and proposal.side == "short":
        if proposal.borrow and proposal.borrow.annual_rate is not None and fee is not None:
            days = (proposal.horizon_end - proposal.information_cutoff).total_seconds() / 86400
            fee += price * units * proposal.borrow.annual_rate * days / 365
        else:
            fee = None
    result["cost_assumption"] = fee
    # Known gross bounds remain visible even when costs or feasibility are unknown.
    premium = price * units
    if proposal.asset_class == "equity":
        loss = premium if proposal.side == "long" else None
        gain = None if proposal.side == "long" else premium
        break_even = price + (fee / units if proposal.side == "long" else -fee / units) if fee is not None else None
        basis = "nonnegative underlying price; no guaranteed stop execution"
    else:
        contract = proposal.option
        intrinsic_cap = contract.strike * units if contract.right == "put" else None
        long_gain = intrinsic_cap - premium if intrinsic_cap is not None else None
        loss, gain = (premium, long_gain) if proposal.side == "long" else (long_gain, premium)
        signed_fee = fee / units * (1 if proposal.side == "long" else -1) if fee is not None else None
        break_even = (contract.strike + (price + signed_fee) * (1 if contract.right == "call" else -1)
                      if signed_fee is not None else None)
        basis = "expiration payoff only; excludes early assignment, financing and exercise costs beyond supplied costs"
        if contract.expiration != proposal.horizon_end:
            result["limitations"].append("Horizon differs from expiration: intrinsic expiry payoff cannot price the option at that horizon.")
        result["limitations"].append("Opposing purchased options can both lose their premiums.")
    result.update(
        maximum_loss={"bound": "unbounded" if loss is None else "bounded",
                      "gross": max(0, loss) if loss is not None else None,
                      "including_assumed_costs": max(0, loss + fee) if loss is not None and fee is not None else None},
        maximum_gain={"bound": "unbounded" if gain is None else "bounded", "gross": gain},
        breakeven=break_even, payoff_basis=basis,
    )
    if proposal.asset_class == "option" and proposal.side == "short":
        result["limitations"].append("Uncovered short option; collateral and broker approval are not established.")
        result["status"] = "incomplete"
        result["missing_terms"].append("short_option_collateral_and_approval")
    return result


def invert_terms(original: TradeProposal, alternative: TradeProposal | None = None) -> dict:
    exact = original.model_copy(update={"side": "short" if original.side == "long" else "long"})
    exact_economics = economics(exact)
    # Deterministic inversion does not author an independent thesis or reverse prose.
    exact_result = {"proposal": exact.model_dump(mode="json"), "economics": exact_economics,
                    "inversion_type": "exact_counterparty", "independent_thesis": None}
    directional = None
    if alternative:
        if (alternative.candidate_id != original.candidate_id or alternative.underlying != original.underlying
                or alternative.information_cutoff != original.information_cutoff
                or alternative.horizon_end != original.horizon_end):
            raise TradingBoundaryError("trading_opposing_comparison_basis_mismatch")
        assessment = economics(alternative)
        if assessment["direction"] is None or assessment["direction"] == economics(original)["direction"]:
            raise TradingBoundaryError("trading_alternative_not_opposing")
        if not assessment["maximum_loss"] or assessment["maximum_loss"]["bound"] != "bounded":
            raise TradingBoundaryError("trading_alternative_bounded_loss_required")
        directional = {"proposal": alternative.model_dump(mode="json"), "economics": assessment,
                       "inversion_type": "opposing_direction", "independent_thesis": None}
    elif original.asset_class == "equity":
        directional = exact_result
    return {"exact_counterparty": exact_result, "opposing_direction": directional,
            "limitations": ["Mechanical counterparty terms do not establish independent conviction or availability.",
                            "No separately quoted directional alternative was supplied."] if directional is None else
                           ["Compare both positions using their actual costs and capital requirements; they are not guaranteed complements."]}


def payoff(proposal: TradeProposal, underlying_price: float) -> dict:
    """Explicit hypothetical expiry/horizon scenario, never realized portfolio P&L."""
    from math import isfinite
    if isinstance(underlying_price, bool) or not isinstance(underlying_price, (int, float)) or not isfinite(underlying_price) or not 0 <= underlying_price <= 1e12:
        raise TradingBoundaryError("trading_scenario_price_invalid")
    terms = economics(proposal)
    if proposal.option and proposal.option.expiration != proposal.horizon_end:
        return {"kind": "SHADOW", "gross_pnl": None, "net_pnl": None, "status": "unavailable",
                "reason": "Option horizon differs from expiration; an actual horizon quote or supported valuation is required."}
    entry = terms["entry_price"]
    if entry is None or terms["direction"] is None:
        return {"kind": "SHADOW", "gross_pnl": None, "net_pnl": None, "status": "unavailable"}
    units = proposal.quantity * (proposal.option.multiplier if proposal.option else 1)
    exit_price = underlying_price
    if proposal.option:
        exit_price = max(0, (underlying_price - proposal.option.strike) * (1 if proposal.option.right == "call" else -1))
    gross = (exit_price - entry) * units * (1 if proposal.side == "long" else -1)
    fee = terms["cost_assumption"]
    return {"kind": "SHADOW", "basis": "option_expiration" if proposal.option else "underlying_horizon",
            "gross_pnl": gross, "net_pnl": gross - fee if fee is not None else None,
            "feasibility_status": terms["status"], "missing_terms": terms["missing_terms"],
            "status": "hypothetical", "limitations": terms["limitations"]}
