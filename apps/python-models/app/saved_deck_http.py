"""Loopback transport to the backend's one saved-deck authority."""

from __future__ import annotations

import json
import os
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from app.application_tool_error import ApplicationToolError


_BACKEND = os.environ.get("MAIN_BACKEND_URL", "http://127.0.0.1:4000").rstrip("/")


def request_backend_json(
    method: str, path: str, payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    request = Request(
        f"{_BACKEND}{path}",
        data=json.dumps(payload).encode("utf-8") if payload is not None else None,
        headers={"Content-Type": "application/json"},
        method=method,
    )
    try:
        with urlopen(request, timeout=300) as response:  # noqa: S310 - loopback only
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        try:
            return json.loads(error.read().decode("utf-8"))
        except Exception as decode_error:
            raise ApplicationToolError(
                f"backend_http_{error.code}: {path}"
            ) from decode_error
    except URLError as error:
        raise ApplicationToolError(
            f"backend_unreachable: {error.reason}"
        ) from error


def _require(arguments: dict[str, Any], *keys: str) -> None:
    for key in keys:
        if not str(arguments.get(key) or "").strip():
            raise ApplicationToolError(f"{key}_required")


def load_saved_deck(
    project_id: str, deck_id: str,
) -> tuple[dict[str, Any], str | None]:
    result = request_backend_json(
        "GET", f"/api/projects/{project_id}/decks/{deck_id}"
    )
    deck = result.get("deck")
    if not result.get("ok") or not isinstance(deck, dict):
        raise ApplicationToolError(f"deck_not_found: {project_id}/{deck_id}")
    return deck, (result.get("meta") or {}).get("deckRevision")


def save_saved_deck(
    project_id: str,
    deck_id: str,
    deck: dict[str, Any],
    revision: str | None,
) -> dict[str, Any]:
    result = request_backend_json(
        "PUT",
        f"/api/projects/{project_id}/decks/{deck_id}",
        {"document": deck, "expectedRevision": revision},
    )
    if not result.get("ok"):
        raise ApplicationToolError(
            f"deck_save_failed: {result.get('error') or 'unknown'}"
        )
    return result


def find_saved_card(deck: dict[str, Any], card_id: str) -> dict[str, Any]:
    for node in deck.get("nodes") or []:
        if str(node.get("id") or "") == card_id:
            return node
    raise ApplicationToolError(f"card_not_found: {card_id}")
