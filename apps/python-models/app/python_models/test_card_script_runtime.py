"""Saved-deck to Hermes-plugin projection for the proven Card Python runtime."""

# Entity: Card Scripts
# Relationship: Proves one persisted compiled recipe projects to the existing card_python contract without another runtime-input authority.

from __future__ import annotations

from app import card_domain_routes
from app.python_models.card_script import saved_script


SOURCE = '''CARD_SCRIPT = {
    "mode": "tool_recipe",
    "input": {"type": "object", "properties": {"mission": {"type": "string"}}, "required": ["mission"]},
    "output": {"type": "object", "properties": {"state": {"type": "object"}}, "required": ["state"]},
    "max_tool_calls": 1,
}
from hermes_tools import SCRIPT, input, output, tools
tools.trading.get_state = SCRIPT
state = tools.call("trading.get_state")
output.emit({"state": state})
'''


def _deck(*, enabled: bool = True) -> dict:
    script = saved_script(
        {"enabled": True, "source": SOURCE, "version": 3},
        selected_tools=["trading.get_state"],
    )
    return {
        "projectId": "trading",
        "deck": {
            "nodes": [{
                "id": "card_trader",
                "enabled": enabled,
                "runtime": {"kind": "hermes", "mode": "delegate", "profile": "trader"},
                "runtimeOptions": {
                    "tools": ["trading.get_state"],
                    "script": script,
                },
            }],
        },
    }


def test_persisted_card_script_projects_to_plugin_runtime_without_idf(monkeypatch) -> None:
    monkeypatch.setattr(card_domain_routes, "load_deck", lambda *_args: _deck())

    result = card_domain_routes.card_script_runtime({
        "projectId": "trading",
        "deckId": "deck_builder",
        "cardId": "card_trader",
    })

    runtime = result["script"]
    assert result["ok"] is True
    assert runtime["version"] == 3
    assert runtime["mode"] == "tool_recipe"
    assert runtime["tool_names"] == {"trading.get_state": "trading.get_state"}
    assert runtime["input_schema"]["required"] == ["mission"]


def test_disabled_card_keeps_script_inert(monkeypatch) -> None:
    monkeypatch.setattr(
        card_domain_routes,
        "load_deck",
        lambda *_args: _deck(enabled=False),
    )
    result = card_domain_routes.card_script_runtime({
        "projectId": "trading",
        "deckId": "deck_builder",
        "cardId": "card_trader",
    })
    assert result == {"ok": True, "script": None}


def test_invalid_script_falls_back_to_the_cards_ordinary_tools(monkeypatch) -> None:
    deck = _deck()
    deck["deck"]["nodes"][0]["runtimeOptions"]["script"] = saved_script(
        {"enabled": True, "source": "not valid Python is inert", "version": 4},
        selected_tools=["trading.get_state"],
    )
    monkeypatch.setattr(card_domain_routes, "load_deck", lambda *_args: deck)
    result = card_domain_routes.card_script_runtime({
        "projectId": "trading",
        "deckId": "deck_builder",
        "cardId": "card_trader",
    })
    assert result == {"ok": True, "script": None}


def test_nonblank_but_disabled_script_has_no_runtime_cost(monkeypatch) -> None:
    deck = _deck()
    deck["deck"]["nodes"][0]["runtimeOptions"]["script"]["enabled"] = False
    monkeypatch.setattr(card_domain_routes, "load_deck", lambda *_args: deck)
    result = card_domain_routes.card_script_runtime({
        "projectId": "trading",
        "deckId": "deck_builder",
        "cardId": "card_trader",
    })
    assert result == {"ok": True, "script": None}
