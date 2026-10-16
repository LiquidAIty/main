from __future__ import annotations

import asyncio
from copy import deepcopy

import pytest

from app import (
    saved_card_create,
    saved_card_operation_schema,
    saved_card_update,
)
from app.application_tool_error import ApplicationToolError


def _card() -> dict:
    return {
        "id": "card-helper",
        "kind": "agent",
        "templateId": "template_assist",
        "title": "Helper",
        "role": "Assistant",
        "prompt": "Help with the task.",
        "runtime": {"kind": "hermes", "mode": "delegate", "profile": "helper"},
        "runtimeOptions": {
            "provider": "openai",
            "modelKey": "gpt-6.1-sol",
            "providerModelId": "gpt-6.1-sol",
            "accessMode": "chatgpt-account",
            "tools": [],
        },
        "position": {"x": 0, "y": 0},
        "_cardRevisionId": "card-revision-one",
    }


def test_saved_card_operation_schemas_publish_the_exact_reasoning_enum() -> None:
    expected = ["high", "low", "max", "medium", "ultra", "xhigh"]
    create = saved_card_operation_schema.saved_card_operation_schema("card.create")
    update = saved_card_operation_schema.saved_card_operation_schema(
        "card.update_configuration"
    )

    assert create["properties"]["reasoningEffort"]["enum"] == expected
    assert update["properties"]["updates"]["properties"]["reasoningEffort"][
        "enum"
    ] == expected


def test_card_create_persists_reasoning_effort_in_the_saved_runtime_options(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict = {}
    monkeypatch.setattr(
        saved_card_create,
        "_load_saved_deck",
        lambda _project, _deck: ({"nodes": [], "edges": [], "promptTemplates": []}, "deck-one"),
    )

    def save(_project: str, _deck: str, document: dict, _revision: str) -> dict:
        captured.update(deepcopy(document))
        saved = deepcopy(document)
        saved["nodes"][0]["_cardRevisionId"] = "card-revision-new"
        return {"deck": saved, "meta": {"deckRevision": "deck-two"}}

    monkeypatch.setattr(saved_card_create, "_save_saved_deck", save)

    result = asyncio.run(saved_card_create.card_create({
        "projectId": "project-one",
        "deckId": "deck-one",
        "expectedRevision": "deck-one",
        "templateId": "template_assist",
        "title": "NewHelper",
        "role": "Assistant",
        "prompt": "Help with the task.",
        "runtime": {"kind": "hermes", "mode": "delegate", "profile": "new-helper"},
        "model": {
            "provider": "openai",
            "modelKey": "gpt-6.1-sol",
            "providerModelId": "gpt-6.1-sol",
            "accessMode": "chatgpt-account",
        },
        "reasoningEffort": "ultra",
    }))

    assert result["ok"] is True
    assert captured["nodes"][0]["runtimeOptions"]["reasoningEffort"] == "ultra"


def test_card_update_persists_reasoning_effort_and_rejects_unknown_levels(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    card = _card()
    deck = {"nodes": [card], "edges": [], "promptTemplates": []}
    captured: dict = {}
    monkeypatch.setattr(
        saved_card_update,
        "_load_saved_deck",
        lambda _project, _deck: (deepcopy(deck), "deck-one"),
    )

    def save(_project: str, _deck: str, document: dict, _revision: str) -> dict:
        captured.update(deepcopy(document))
        saved = deepcopy(document)
        saved["nodes"][0]["_cardRevisionId"] = "card-revision-two"
        return {"deck": saved, "meta": {"deckRevision": "deck-two"}}

    monkeypatch.setattr(saved_card_update, "_save_saved_deck", save)
    base = {
        "projectId": "project-one",
        "deckId": "deck-one",
        "cardId": "card-helper",
        "expectedRevision": "deck-one",
        "expectedCardRevisionId": "card-revision-one",
    }

    result = asyncio.run(saved_card_update.card_update_configuration({
        **base,
        "updates": {"reasoningEffort": "max"},
    }))
    assert result["appliedFields"] == ["reasoningEffort"]
    assert captured["nodes"][0]["runtimeOptions"]["reasoningEffort"] == "max"

    with pytest.raises(ApplicationToolError, match="card_update_reasoning_effort_invalid"):
        asyncio.run(saved_card_update.card_update_configuration({
            **base,
            "updates": {"reasoningEffort": "extreme"},
        }))
