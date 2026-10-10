from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.python_models import (
    saved_card_contract,
    saved_cards,
)
from app.python_models.card_configuration_contracts import CardConfiguration

def _agent(card_id: str, **overrides):
    card = {
        "id": card_id,
        "kind": "agent",
        "templateId": "template_assist",
        "title": card_id,
        "prompt": "common prompt",
        "runtime": {"kind": "hermes", "mode": "delegate", "profile": card_id},
        "runtimeOptions": {
            "provider": "openrouter",
            "modelKey": "deepseek/deepseek-v4-flash-0731",
            "providerModelId": "deepseek/deepseek-v4-flash-0731",
            "accessMode": "openrouter-api",
            "tools": [],
        },
        "position": {"x": 0, "y": 0},
    }
    card.update(overrides)
    return card

def _main_bot(card_id: str, **overrides):
    return _agent(card_id, **overrides)

def _destination_fixture(monkeypatch: pytest.MonkeyPatch) -> dict:
    sender = _main_bot("sender", runtime={"kind": "hermes", "mode": "main", "profile": "sender"})
    hermes = _agent(
        "hermes",
        prompt="Hermes saved prompt",
        runtime={"kind": "hermes", "mode": "delegate", "profile": "research"},
    )
    hermes["runtimeOptions"] = {
        **hermes["runtimeOptions"],
        "tools": ["calculator"],
    }
    for number, card in enumerate((sender, hermes), start=1):
        card["_cardRevisionId"] = f"revision-{number}"
        card["_cardRevision"] = number
        card["_cardRevisionSha256"] = f"sha-{number}"
    loaded = {
        "projectId": "00000000-0000-0000-0000-000000000001",
        "deck": {
            "nodes": [sender, hermes],
            "edges": [
                {"id": "flow-hermes", "source": "sender", "target": "hermes", "edgeType": "flow"},
            ],
        },
    }
    monkeypatch.setattr(saved_cards, "load_deck", lambda _project, _deck: loaded)
    return loaded

def test_saved_profiles_stay_unique_and_stable_grants_are_preserved():
    controller = _agent("main", runtime={"kind": "hermes", "mode": "main", "profile": "main"})
    controller["runtimeOptions"].update({
        "reasoningEffort": "low", "temperature": 0.25,
        "maxTokens": 1200, "maxTurns": 6,
    })
    stable = saved_card_contract.stable_card_record(controller)
    assert stable["grants"]["tools"] == controller["runtimeOptions"]["tools"]
    assert {
        key: stable[key]
        for key in ("reasoningEffort", "temperature", "maxTokens", "maxTurns")
    } == {
        "reasoningEffort": "low", "temperature": 0.25,
        "maxTokens": 1200, "maxTurns": 6,
    }
    assert not {
        "reasoningEffort", "temperature", "maxTokens", "maxTurns"
    } & stable["runtimeExtensions"].keys()
    duplicate = _agent("separate", runtime={"kind": "hermes", "mode": "delegate", "profile": "MAIN"})
    with pytest.raises(saved_card_contract.CardDomainError, match="card_profile_duplicate"):
        saved_cards._validated_deck_collections({
            "id": "d", "nodes": [controller, duplicate], "edges": [], "promptTemplates": [],
        }, "d")

def test_existing_saved_hermes_card_profile_is_immutable() -> None:
    previous = saved_card_contract.stable_card_record(_agent(
        "helper",
        runtime={"kind": "hermes", "mode": "delegate", "profile": "stable-helper"},
    ))
    incoming = saved_card_contract.stable_card_record(_agent(
        "helper",
        runtime={"kind": "hermes", "mode": "delegate", "profile": "renamed-helper"},
    ))

    with pytest.raises(saved_card_contract.CardDomainError, match="card_runtime_profile_immutable"):
        saved_card_contract.validate_immutable_runtime_profile(previous, incoming)

def test_new_card_revision_validates_saved_orchestrator_authority():
    delegate = _agent(
        "delegate",
        runtime={"kind": "hermes", "mode": "delegate", "profile": "delegate"},
    )
    delegate["runtimeOptions"]["orchestrator"] = True
    saved_card_contract.validate_new_card_revision(delegate)

    delegate["runtimeOptions"]["orchestrator"] = "yes"
    with pytest.raises(saved_card_contract.CardDomainError, match="card_orchestrator_invalid"):
        saved_card_contract.validate_new_card_revision(delegate)

    magnetic = _agent(
        "magnetic",
        runtime={"kind": "hermes", "mode": "magentic_one", "profile": "magnetic"},
    )
    magnetic["runtimeOptions"]["orchestrator"] = True
    with pytest.raises(
        saved_card_contract.CardDomainError,
        match="card_orchestrator_requires_non_magnetic_hermes",
    ):
        saved_card_contract.validate_new_card_revision(magnetic)

@pytest.mark.parametrize("field", ["autoTools", "autoModel"])
def test_new_card_revision_validates_auto_flags_without_availability(field):
    delegate = _agent(
        "delegate",
        runtime={"kind": "hermes", "mode": "delegate", "profile": "delegate"},
    )
    delegate["runtimeOptions"][field] = True
    saved_card_contract.validate_new_card_revision(delegate)
    assert saved_card_contract.stable_card_record(delegate)["runtimeExtensions"][field] is True

    delegate["runtimeOptions"][field] = "yes"
    with pytest.raises(
        saved_card_contract.CardDomainError,
        match=f"card_{'auto_tools' if field == 'autoTools' else 'auto_model'}_invalid",
    ):
        saved_card_contract.validate_new_card_revision(delegate)

    magnetic = _agent(
        "magnetic",
        runtime={"kind": "hermes", "mode": "magentic_one", "profile": "magnetic"},
    )
    magnetic["runtimeOptions"][field] = True
    with pytest.raises(
        saved_card_contract.CardDomainError,
        match="requires_non_magnetic_hermes",
    ):
        saved_card_contract.validate_new_card_revision(magnetic)

def test_card_configuration_auto_flags_are_optional_strict_booleans():
    configuration = {
        "runtimeKind": "hermes",
        "runtimeMode": "delegate",
        "accessMode": "chatgpt-account",
    }
    assert CardConfiguration(**configuration).autoTools is None
    assert CardConfiguration(**configuration, autoTools=True).autoTools is True
    with pytest.raises(ValidationError):
        CardConfiguration(**configuration, autoModel=1)

def test_legacy_enabled_byte_remains_readable_but_invalid_source_is_inert(monkeypatch):
    loaded = _destination_fixture(monkeypatch)
    card = loaded["deck"]["nodes"][1]
    card["runtimeOptions"]["script"] = {
        "enabled": False,
        "source": "not executable",
    }

    stable = saved_card_contract.stable_card_record(card)
    saved = stable["runtimeExtensions"]["script"]
    assert "enabled" not in saved
    assert saved["source"] == "not executable"
    assert saved["lastValidation"]["status"] == "invalid"
    assert "hermesSupport" not in saved
    assert stable["grants"]["tools"] == ["calculator"]

def test_saved_card_preserves_legacy_team_data_without_runtime_validation() -> None:
    team = {
        "mode": "auto", "maxWorkers": 3, "retryLimit": 2,
        "workerModel": {
            "provider": "openai", "accessMode": "chatgpt-account",
            "modelKey": "gpt-5.6-luna", "providerModelId": "gpt-5.6-luna",
        },
        "leadModel": {
            "provider": "openai", "accessMode": "chatgpt-account",
            "modelKey": "gpt-5.6-terra", "providerModelId": "gpt-5.6-terra",
        },
    }
    hermes = _agent(
        "hermes-team",
        runtime={"kind": "hermes", "mode": "delegate", "profile": "research"},
        runtimeOptions={**_agent("x")["runtimeOptions"], "team": team},
    )
    assert saved_card_contract.stable_card_record(hermes)["runtimeExtensions"]["team"] == team
    legacy = _agent("old-card", runtimeOptions={**_agent("x")["runtimeOptions"], "team": team})
    assert saved_card_contract.stable_card_record(legacy)["runtimeExtensions"]["team"] == team

def test_retired_kanban_card_mode_is_not_a_runtime_contract() -> None:
    with pytest.raises(
        saved_card_contract.CardDomainError,
        match="hermes_runtime_mode_unsupported:kanban",
    ):
        saved_card_contract.runtime_owner(_agent(
            "retired-kanban",
            runtime={"kind": "hermes", "mode": "kanban", "profile": "retired-kanban"},
        ))

def test_stable_card_has_one_prompt_and_one_explicit_runtime() -> None:
    card = _agent(
        "helper",
        runtime={"kind": "hermes", "mode": "delegate", "profile": "helper"},
    )
    stable = saved_card_contract.stable_card_record(card)
    assert stable["basePrompt"] == "common prompt"
    assert stable["runtime"] == {
        "kind": "hermes", "mode": "delegate", "profile": "helper"
    }

def test_runtime_owner_is_exhaustive_over_the_explicit_runtime_union() -> None:
    for mode in ("main", "delegate"):
        assert saved_card_contract.runtime_owner(_agent(
            mode, runtime={"kind": "hermes", "mode": mode, "profile": mode}
        )) == "hermes"
    assert saved_card_contract.runtime_owner(_agent(
        "mag-one",
        runtime={"kind": "hermes", "mode": "magentic_one", "profile": "mag-one"},
    )) == "mag_one"
    for invalid, error in (
        (None, "runtime_kind_required"),
        ({"kind": "hermes", "mode": "delegate"}, "runtime_profile_required"),
        ({"kind": "hermes", "mode": "unknown", "profile": "invalid"},
         "hermes_runtime_mode_unsupported"),
        ({"kind": "other", "mode": "assistant"}, "runtime_kind_unsupported"),
    ):
        with pytest.raises(saved_card_contract.CardDomainError, match=error):
            saved_card_contract.runtime_owner(_agent("invalid", runtime=invalid))
