"""Provider-aware numeric validation for OpenRouter Decisions responses.

The Decisions transport rounds probabilities and Scores to two decimal places.
Validation therefore proves that the returned numbers could represent one real
distribution without rewriting the provider's raw values.
"""
from __future__ import annotations

import math
from typing import Any, Iterable, Mapping


DECISIONS_DECIMAL_PLACES = 2
_ROUNDING_HALF_STEP = 0.5 * (10 ** -DECISIONS_DECIMAL_PLACES)
_NUMERIC_EPSILON = 1e-12


def probability_rounding_bounds(value: float) -> tuple[float, float]:
    """Return the possible unrounded interval for one two-decimal probability."""

    return (
        max(0.0, value - _ROUNDING_HALF_STEP),
        min(1.0, value + _ROUNDING_HALF_STEP),
    )


def validate_rounded_probability_distribution(
    raw: Any,
    expected_keys: Iterable[str],
) -> dict[str, float]:
    """Validate one exact-key distribution while preserving its returned values."""

    keys = tuple(expected_keys)
    if not isinstance(raw, Mapping) or set(raw) != set(keys):
        raise ValueError("probability keys")
    probabilities: dict[str, float] = {}
    for key in keys:
        value = raw[key]
        if isinstance(value, bool):
            raise ValueError("probability values")
        try:
            probability = float(value)
        except (TypeError, ValueError, OverflowError) as error:
            raise ValueError("probability values") from error
        if not math.isfinite(probability) or not 0.0 <= probability <= 1.0:
            raise ValueError("probability values")
        probabilities[key] = probability
    if not probabilities or all(value == 0.0 for value in probabilities.values()):
        raise ValueError("probability total")
    bounds = [probability_rounding_bounds(value) for value in probabilities.values()]
    if (
        sum(lower for lower, _upper in bounds) > 1.0 + _NUMERIC_EPSILON
        or sum(upper for _lower, upper in bounds) < 1.0 - _NUMERIC_EPSILON
    ):
        raise ValueError("probability total")
    return probabilities


def validate_rounded_choice_winner(
    winner: str,
    probabilities: Mapping[str, float],
) -> None:
    """Require the returned winner to be a possible maximum, including ties."""

    if winner not in probabilities:
        raise ValueError("winner")
    _winner_lower, winner_upper = probability_rounding_bounds(probabilities[winner])
    if any(
        probability_rounding_bounds(value)[0] > winner_upper + _NUMERIC_EPSILON
        for key, value in probabilities.items()
        if key != winner
    ):
        raise ValueError("winner probability")
