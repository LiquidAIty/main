from __future__ import annotations

import ast
from copy import deepcopy
from pathlib import Path
from typing import Any

import pytest

from app.python_models import card_domain


class _EndpointHttpError(Exception):
    def __init__(self, *, status_code: int, detail: str):
        self.status_code = status_code
        self.detail = detail


def _agent(
    card_id: str,
    *,
    profile: str,
    mode: str,
    revision_id: str,
    delegation_role: str | None = None,
) -> dict[str, Any]:
    options: dict[str, Any] = {}
    if delegation_role is not None:
        options["delegationRole"] = delegation_role
    return {
        "id": card_id,
        "kind": "agent",
        "title": card_id.title(),
        "subtitle": f"{card_id} description",
        "runtime": {"kind": "hermes", "mode": mode, "profile": profile},
        "runtimeOptions": options,
        "_cardRevisionId": revision_id,
    }


def _loaded_deck() -> dict[str, Any]:
    return {
        "projectId": "project-canonical",
        "deck": {
            "id": "deck-one",
            "nodes": [
                _agent(
                    "main",
                    profile="main",
                    mode="main",
                    revision_id="revision-main",
                    delegation_role="profile",
                ),
                _agent(
                    "builder",
                    profile="Builder",
                    mode="delegate",
                    revision_id="revision-builder",
                ),
                _agent(
                    "disconnected",
                    profile="research",
                    mode="delegate",
                    revision_id="revision-research",
                ),
            ],
            "edges": [
                {
                    "id": "main-builder",
                    "source": "main",
                    "target": "builder",
                    "edgeType": "flow",
                },
            ],
        },
        "meta": {"deckRevision": "deck-revision"},
    }


def test_bot_dm_authorization_resolves_normalized_profile_to_saved_card(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    loaded = _loaded_deck()
    before = deepcopy(loaded)
    calls: list[tuple[str, str]] = []

    def load(project_id: str, deck_id: str) -> dict[str, Any]:
        calls.append((project_id, deck_id))
        return loaded

    monkeypatch.setattr(card_domain, "load_deck", load)

    assert card_domain.authorize_hermes_bot_dm_card(
        "project-server-derived", "deck-one", "main", "@bUiLdEr"
    ) == {
        "projectId": "project-canonical",
        "deckId": "deck-one",
        "sourceCardId": "main",
        "card": {
            "cardId": "builder",
            "title": "Builder",
            "profile": "Builder",
            "description": "builder description",
            "cardRevisionId": "revision-builder",
        },
    }
    assert calls == [("project-server-derived", "deck-one")]
    assert loaded == before


def test_bot_dm_authorization_does_not_consult_delegation_projection(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    loaded = _loaded_deck()
    loaded["deck"]["edges"] = []
    loaded["deck"]["nodes"][0]["runtimeOptions"] = {}
    monkeypatch.setattr(card_domain, "load_deck", lambda *_args: loaded)
    monkeypatch.setattr(
        card_domain,
        "_direct_card_targets",
        lambda *_args: (_ for _ in ()).throw(AssertionError("delegation path consulted")),
    )

    resolved = card_domain.authorize_hermes_bot_dm_card(
        "project-one", "deck-one", "builder", "research"
    )

    assert resolved["sourceCardId"] == "builder"
    assert resolved["card"] == {
        "cardId": "disconnected",
        "title": "Disconnected",
        "profile": "research",
        "description": "disconnected description",
        "cardRevisionId": "revision-research",
    }


@pytest.mark.parametrize(
    ("source_card_id", "target_profile", "mutate"),
    [
        ("main", "unknown", lambda deck: None),
        ("main", "@@Builder", lambda deck: None),
        ("missing", "Builder", lambda deck: None),
        (
            "main",
            "Builder",
            lambda deck: deck["deck"]["nodes"].append(
                _agent(
                    "duplicate-builder",
                    profile="builder",
                    mode="delegate",
                    revision_id="revision-duplicate",
                )
            ),
        ),
    ],
)
def test_bot_dm_authorization_fails_closed_without_one_saved_card(
    monkeypatch: pytest.MonkeyPatch,
    source_card_id: str,
    target_profile: str,
    mutate,
) -> None:
    loaded = _loaded_deck()
    mutate(loaded)
    monkeypatch.setattr(card_domain, "load_deck", lambda *_args: loaded)

    with pytest.raises(
        card_domain.CardDomainError,
        match="^hermes_bot_dm_card_not_authorized$",
    ):
        card_domain.authorize_hermes_bot_dm_card(
            "project-one", "deck-one", source_card_id, target_profile
        )


def test_bot_dm_authorization_requires_saved_card_revision(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    loaded = _loaded_deck()
    loaded["deck"]["nodes"][1]["_cardRevisionId"] = ""
    monkeypatch.setattr(card_domain, "load_deck", lambda *_args: loaded)

    with pytest.raises(
        card_domain.CardDomainError,
        match="^hermes_bot_dm_card_revision_missing$",
    ):
        card_domain.authorize_hermes_bot_dm_card(
            "project-one", "deck-one", "main", "Builder"
        )


def _isolated_endpoint() -> tuple[Any, list[str]]:
    source_path = Path(__file__).parents[1] / "main.py"
    module = ast.parse(source_path.read_text(encoding="utf-8"))
    endpoint = next(
        node
        for node in module.body
        if isinstance(node, ast.FunctionDef)
        and node.name == "domain_hermes_bot_dm_authorize_card"
    )
    registered_paths: list[str] = []

    class App:
        def post(self, path: str):
            registered_paths.append(path)
            return lambda function: function

    namespace: dict[str, Any] = {
        "Any": Any,
        "CardDomainError": card_domain.CardDomainError,
        "HTTPException": _EndpointHttpError,
        "app": App(),
        "authorize_hermes_bot_dm_card": lambda *args: {
            "projectId": args[0],
            "deckId": args[1],
            "sourceCardId": args[2],
            "card": {
                "cardId": "builder",
                "title": "Builder",
                "profile": "builder",
                "description": "Builds",
                "cardRevisionId": "revision-builder",
            },
        },
    }
    ast.fix_missing_locations(endpoint)
    exec(compile(ast.Module(body=[endpoint], type_ignores=[]), str(source_path), "exec"), namespace)
    return namespace["domain_hermes_bot_dm_authorize_card"], registered_paths


def test_private_bot_dm_endpoint_has_exact_request_and_response_contract() -> None:
    endpoint, registered_paths = _isolated_endpoint()
    payload = {
        "projectId": "project-one",
        "deckId": "deck-one",
        "sourceCardId": "main",
        "targetProfile": "@builder",
    }

    assert registered_paths == ["/domain/hermes-bot-dm/authorize"]
    assert endpoint(payload) == {
        "ok": True,
        "projectId": "project-one",
        "deckId": "deck-one",
        "sourceCardId": "main",
        "card": {
            "cardId": "builder",
            "title": "Builder",
            "profile": "builder",
            "description": "Builds",
            "cardRevisionId": "revision-builder",
        },
    }


@pytest.mark.parametrize("forbidden_field", ["targetCardId", "ownerUserId", "ownerId"])
def test_private_bot_dm_endpoint_rejects_caller_authority_fields(
    forbidden_field: str,
) -> None:
    endpoint, _registered_paths = _isolated_endpoint()
    payload = {
        "projectId": "project-one",
        "deckId": "deck-one",
        "sourceCardId": "main",
        "targetProfile": "builder",
        forbidden_field: "caller-supplied-authority",
    }

    with pytest.raises(_EndpointHttpError) as raised:
        endpoint(payload)
    assert raised.value.status_code == 400
    assert raised.value.detail == "hermes_bot_dm_authorization_payload_invalid"
