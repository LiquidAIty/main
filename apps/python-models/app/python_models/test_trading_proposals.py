"""Payoff tests are scenarios, not market performance or live agent proof."""
# Entity: Trading
# Relationship: Tests both directions, spread costs, missing evidence, unsafe counterparties, look-ahead rejection and both-losing options for deterministic proposal arithmetic.

from copy import deepcopy

import pytest

from app.python_models.trading_contract import TradingBoundaryError
from app.python_models.trading_proposals import economics, invert_terms, parse_proposal, payoff


def proposal(**changes):
    value = dict(candidate_id="rdw-investigation", market="US", asset_class="equity",
        instrument_identifier="RDW", underlying="RDW", side="long", thesis="A test hypothesis, not a finding.",
        entry_conditions="If the catalyst is verified.", exit_conditions="At horizon or invalidation.",
        invalidation="Funding assumption fails.", information_cutoff="2026-10-01T20:00:00Z",
        horizon_end="2026-11-01T20:00:00Z", quantity=100,
        quote=dict(bid=9.9, ask=10.1, observed_at="2026-10-01T19:59:00Z", source_reference="fixture quote"),
        round_trip_cost=2, source_references=["fixture source"])
    value.update(changes)
    return value


def option(right="call", side="long", premium=1):
    return proposal(asset_class="option", side=side, quantity=1, instrument_identifier="explicit-fixture-contract",
        quote=dict(bid=premium, ask=premium, observed_at="2026-10-01T19:59:00Z", source_reference="fixture quote"),
        option=dict(right=right, strike=10, expiration="2026-11-01T20:00:00Z", multiplier=100,
                    settlement="physical", style="american", source_reference="fixture contract"))


def test_equity_counterparty_keeps_basis_and_surfaces_unknown_borrow():
    original = parse_proposal(proposal())
    inverse = invert_terms(original)
    exact = inverse["exact_counterparty"]
    assert exact["proposal"]["side"] == "short" and original.side == "long"
    assert exact["proposal"]["information_cutoff"] == original.model_dump(mode="json")["information_cutoff"]
    assert exact["economics"]["status"] == "incomplete"
    assert "available_borrow" in exact["economics"]["missing_terms"]
    assert exact["economics"]["maximum_loss"]["bound"] == "unbounded"
    assert exact["economics"]["entry_price"] == 9.9
    assert economics(original)["maximum_loss"]["including_assumed_costs"] == 1012
    assert exact["independent_thesis"] is None and not exact["economics"]["execution_authorized"]


def test_bearish_original_inverts_to_bullish_and_borrow_cost_is_explicit():
    original = parse_proposal(proposal(side="short", borrow=dict(status="available", annual_rate=.1,
        observed_at="2026-10-01T19:59:00Z", source_reference="fixture availability, not live borrow")))
    terms = economics(original)
    assert terms["status"] == "available_for_analysis"
    assert terms["cost_assumption"] == pytest.approx(2 + 990 * .1 * 31 / 365)
    inverse = invert_terms(original)["opposing_direction"]
    assert inverse["economics"]["direction"] == "bullish"
    assert inverse["economics"]["maximum_loss"]["bound"] == "bounded"


@pytest.mark.parametrize("price", [8, 12])
def test_both_sides_are_calculated_independently_with_spread_and_costs(price):
    original = parse_proposal(proposal(borrow=dict(status="available", annual_rate=0,
        observed_at="2026-10-01T19:59:00Z", source_reference="fixture")))
    opposite = parse_proposal(invert_terms(original)["exact_counterparty"]["proposal"])
    a, b = payoff(original, price), payoff(opposite, price)
    assert (a["net_pnl"] > 0) == (price > 10)
    assert (b["net_pnl"] > 0) == (price < 10)
    assert a["net_pnl"] + b["net_pnl"] == pytest.approx(-24)


def test_long_call_exact_counterparty_is_not_a_purchased_put():
    original, alternative = parse_proposal(option()), parse_proposal(option(right="put"))
    inverse = invert_terms(original, alternative)
    assert inverse["exact_counterparty"]["proposal"]["side"] == "short"
    assert inverse["exact_counterparty"]["economics"]["maximum_loss"]["bound"] == "unbounded"
    assert inverse["opposing_direction"]["proposal"]["side"] == "long"
    assert inverse["opposing_direction"]["inversion_type"] == "opposing_direction"
    assert payoff(original, 10)["net_pnl"] == -102
    assert payoff(alternative, 10)["net_pnl"] == -102
    assert economics(original)["breakeven"] == pytest.approx(11.02)
    assert economics(alternative)["breakeven"] == pytest.approx(8.98)


def test_no_quotes_or_costs_are_invented():
    value = parse_proposal(proposal(quote=None, round_trip_cost=None))
    terms = economics(value)
    assert terms["status"] == "incomplete" and terms["maximum_loss"] is None
    assert terms["missing_terms"] == ["quote", "round_trip_cost"]
    assert payoff(value, 12)["net_pnl"] is None
    assert invert_terms(parse_proposal(option()))["opposing_direction"] is None


@pytest.mark.parametrize("asset", ["future", "forex", "crypto", "prediction_market"])
def test_unsupported_market_does_not_announce_usable_inverse(asset):
    value = parse_proposal(proposal(asset_class=asset))
    assert invert_terms(value)["exact_counterparty"]["economics"]["status"] == "unavailable"
    assert payoff(value, 20)["status"] == "unavailable"


@pytest.mark.parametrize("changes", [
    {"quantity": True}, {"quantity": float("nan")}, {"round_trip_cost": float("inf")},
    {"information_cutoff": "2026-10-01"}, {"horizon_end": "2026-09-01T00:00:00Z"},
    {"unapproved_field": "ignored?"},
])
def test_bad_terms_fail_instead_of_becoming_plausible_prices(changes):
    with pytest.raises(TradingBoundaryError, match="proposal_invalid"):
        parse_proposal(proposal(**changes))


def test_later_quote_and_wrong_alternative_cannot_leak_into_comparison():
    value = proposal()
    value["quote"]["observed_at"] = "2026-10-02T00:00:00Z"
    with pytest.raises(TradingBoundaryError):
        parse_proposal(value)
    original = parse_proposal(option())
    for changes in ({"underlying": "OTHER"}, {"horizon_end": "2026-12-01T20:00:00Z"}):
        value = option(right="put") | changes
        with pytest.raises(TradingBoundaryError, match="basis_mismatch"):
            invert_terms(original, parse_proposal(value))
    with pytest.raises(TradingBoundaryError, match="not_opposing"):
        invert_terms(original, original)


def test_missing_contract_and_preexpiry_are_not_stock_profit_claims():
    assert economics(parse_proposal(proposal(asset_class="option")))["status"] == "unavailable"
    value = option()
    value["horizon_end"] = "2026-10-20T20:00:00Z"
    assert any("Horizon differs" in item for item in economics(parse_proposal(value))["limitations"])
    result = payoff(parse_proposal(value), 12)
    assert result["status"] == "unavailable" and result["net_pnl"] is None
    with pytest.raises(TradingBoundaryError, match="scenario_price_invalid"):
        payoff(parse_proposal(proposal()), 1e308)
