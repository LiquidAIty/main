"""Bounded Jev transport and exact Choice response validation."""
from __future__ import annotations

import hashlib
import json
import math
import os
from typing import Any

import httpx

from app.python_models.jev_validation import (
    validate_rounded_choice_winner, validate_rounded_probability_distribution,
)


JEV_MODEL = "typesafe/jev-1.13"
JEV_ENDPOINT = "https://openrouter.ai/api/alpha/decisions"
JEV_TIMEOUT_SECONDS = 45.0
MAX_DECISION_BYTES = 240_000


class _JevSelectionError(RuntimeError):
    def __init__(self, status: str, error_code: str) -> None:
        self.status = status
        self.error_code = error_code
        super().__init__(error_code)


def _question_id(prefix: str, identity: str) -> str:
    digest = hashlib.sha256(identity.encode("utf-8")).hexdigest()[:24]
    return f"{prefix}_{digest}"


def _bounded_body(body: dict[str, Any], error_code: str) -> dict[str, Any]:
    encoded = json.dumps(body, ensure_ascii=False, separators=(",", ":"), default=str)
    if len(encoded.encode("utf-8")) > MAX_DECISION_BYTES:
        raise _JevSelectionError("invalid", error_code)
    return body


def _post_jev(body: dict[str, Any], *, prefix: str) -> dict[str, Any]:
    api_key = os.environ.get("OPENROUTER_API_KEY", "").strip()
    if not api_key:
        raise _JevSelectionError("unavailable", f"{prefix}_openrouter_key_unavailable")
    try:
        with httpx.Client(timeout=JEV_TIMEOUT_SECONDS, follow_redirects=False) as client:
            response = client.post(
                JEV_ENDPOINT,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json=body,
            )
            response.raise_for_status()
            value = response.json()
    except httpx.TimeoutException as error:
        raise _JevSelectionError("unavailable", f"{prefix}_timeout") from error
    except httpx.HTTPError as error:
        raise _JevSelectionError("unavailable", f"{prefix}_unavailable") from error
    except (json.JSONDecodeError, ValueError) as error:
        raise _JevSelectionError("invalid", f"{prefix}_response_invalid") from error
    except Exception as error:
        raise _JevSelectionError("unavailable", f"{prefix}_request_error") from error
    if not isinstance(value, dict):
        raise _JevSelectionError("invalid", f"{prefix}_response_invalid")
    return value


def _decision_id(response: dict[str, Any]) -> str:
    value = response.get("id")
    if not isinstance(value, str) or not value.strip() or len(value) > 256:
        raise ValueError("decision id")
    return value.strip()


def _choice_answer(
    response: dict[str, Any],
    question_id: str,
    choice_ids: tuple[str, ...],
) -> tuple[str, float]:
    answer = response["answers"][question_id]
    if not isinstance(answer, dict) or answer.get("type") != "choice":
        raise ValueError("answer")
    winner = str(answer["choice"])
    probabilities = validate_rounded_probability_distribution(
        answer["probabilities"], choice_ids,
    )
    validate_rounded_choice_winner(winner, probabilities)
    confidence = answer["confidence"]
    if isinstance(confidence, bool):
        raise ValueError("confidence")
    confidence = float(confidence)
    if not math.isfinite(confidence) or not 0.0 <= confidence <= 1.0:
        raise ValueError("confidence")
    return winner, round(confidence * 100.0, 2)
