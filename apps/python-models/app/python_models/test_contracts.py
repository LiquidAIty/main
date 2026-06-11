import importlib
import sys
import types
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from app.python_models.orchestration_contracts import (
    CardRuntimeConfig,
    CardRuntimeParticipant,
    CardRuntimePrivateParticipant,
    ContextPack,
)


SELECTED_PROVIDER = "openai"
SELECTED_PROVIDER_MODEL_ID = "gpt-5.1-chat-latest"
ORCHESTRATOR_PROVIDER = "orchestrator-provider"
ORCHESTRATOR_PROVIDER_MODEL_ID = "orchestrator-model"


def _complete_payload() -> dict:
    return {
        "session": {
            "sessionId": "s1",
            "projectId": "p1",
            "turnId": "t1",
            "route": "deck_runtime",
            "orchestrator": "magentic_one",
            "modelProvider": SELECTED_PROVIDER,
            "modelKey": SELECTED_PROVIDER_MODEL_ID,
            "providerModelId": SELECTED_PROVIDER_MODEL_ID,
            "startedAt": "2026-01-01T00:00:00Z",
        },
        "userText": "hello",
        "cardRuntime": {
            "cardId": "mag1",
            "title": "Orchestrator",
            "runtimeType": "magentic_one",
            "participants": [
                {
                    "cardId": "agentA",
                    "title": "Agent A",
                    "runtimeType": "assistant_agent",
                    "provider": SELECTED_PROVIDER,
                    "providerModelId": SELECTED_PROVIDER_MODEL_ID,
                }
            ],
            "privateParticipants": [
                {
                    "cardId": "agentA",
                    "runtimeType": "assistant_agent",
                    "prompt": "Be helpful.",
                    "provider": SELECTED_PROVIDER,
                    "providerModelId": SELECTED_PROVIDER_MODEL_ID,
                }
            ],
        },
    }


@pytest.fixture
def orchestrator_module(monkeypatch):
    class StubAssistantAgent:
        def __init__(self, **kwargs):
            self.__dict__.update(kwargs)

    class StubTeam:
        def __init__(self, *args, **kwargs):
            self.args = args
            self.kwargs = kwargs

    autogen_agentchat = types.ModuleType("autogen_agentchat")
    autogen_agents = types.ModuleType("autogen_agentchat.agents")
    autogen_teams = types.ModuleType("autogen_agentchat.teams")
    autogen_agents.AssistantAgent = StubAssistantAgent
    autogen_teams.MagenticOneGroupChat = StubTeam
    autogen_teams.RoundRobinGroupChat = StubTeam
    autogen_teams.SelectorGroupChat = StubTeam
    autogen_agentchat.agents = autogen_agents
    autogen_agentchat.teams = autogen_teams

    autogen_core = types.ModuleType("autogen_core")
    autogen_core_models = types.ModuleType("autogen_core.models")
    autogen_core_models.ModelFamily = type("ModelFamily", (), {})
    autogen_core.models = autogen_core_models

    autogen_ext = types.ModuleType("autogen_ext")
    autogen_ext_models = types.ModuleType("autogen_ext.models")
    autogen_ext_openai = types.ModuleType("autogen_ext.models.openai")
    autogen_ext_openai.OpenAIChatCompletionClient = type(
        "OpenAIChatCompletionClient",
        (),
        {},
    )
    autogen_ext_models.openai = autogen_ext_openai
    autogen_ext.models = autogen_ext_models

    dotenv = types.ModuleType("dotenv")
    dotenv.load_dotenv = lambda *args, **kwargs: None

    stub_modules = {
        "autogen_agentchat": autogen_agentchat,
        "autogen_agentchat.agents": autogen_agents,
        "autogen_agentchat.teams": autogen_teams,
        "autogen_core": autogen_core,
        "autogen_core.models": autogen_core_models,
        "autogen_ext": autogen_ext,
        "autogen_ext.models": autogen_ext_models,
        "autogen_ext.models.openai": autogen_ext_openai,
        "dotenv": dotenv,
    }
    for name, module in stub_modules.items():
        monkeypatch.setitem(sys.modules, name, module)

    sys.modules.pop("app.python_models.autogen_orchestrator", None)
    sys.modules.pop("app.python_models.autogen_provider_env", None)
    sys.modules.pop("app.python_models.autogen_research", None)
    return importlib.import_module("app.python_models.autogen_orchestrator")


def test_context_pack_with_card_selected_model_validates():
    pack = ContextPack.model_validate(_complete_payload())

    assert pack.cardRuntime is not None
    assert pack.cardRuntime.participants[0].provider == SELECTED_PROVIDER
    assert (
        pack.cardRuntime.participants[0].providerModelId
        == SELECTED_PROVIDER_MODEL_ID
    )
    assert pack.cardRuntime.privateParticipants[0].provider == SELECTED_PROVIDER
    assert (
        pack.cardRuntime.privateParticipants[0].providerModelId
        == SELECTED_PROVIDER_MODEL_ID
    )


@pytest.mark.parametrize(
    ("participant_type", "values", "missing_field"),
    [
        (
            CardRuntimeParticipant,
            {
                "cardId": "agentA",
                "title": "Agent A",
                "runtimeType": "assistant_agent",
                "provider": SELECTED_PROVIDER,
                "providerModelId": SELECTED_PROVIDER_MODEL_ID,
            },
            "provider",
        ),
        (
            CardRuntimeParticipant,
            {
                "cardId": "agentA",
                "title": "Agent A",
                "runtimeType": "assistant_agent",
                "provider": SELECTED_PROVIDER,
                "providerModelId": SELECTED_PROVIDER_MODEL_ID,
            },
            "providerModelId",
        ),
        (
            CardRuntimePrivateParticipant,
            {
                "cardId": "agentA",
                "runtimeType": "assistant_agent",
                "provider": SELECTED_PROVIDER,
                "providerModelId": SELECTED_PROVIDER_MODEL_ID,
            },
            "provider",
        ),
        (
            CardRuntimePrivateParticipant,
            {
                "cardId": "agentA",
                "runtimeType": "assistant_agent",
                "provider": SELECTED_PROVIDER,
                "providerModelId": SELECTED_PROVIDER_MODEL_ID,
            },
            "providerModelId",
        ),
    ],
)
def test_participant_contracts_reject_missing_model_config(
    participant_type,
    values,
    missing_field,
):
    invalid_values = {key: value for key, value in values.items() if key != missing_field}

    with pytest.raises(ValidationError):
        participant_type(**invalid_values)


@pytest.mark.parametrize(
    ("provider", "provider_model_id"),
    [
        ("", SELECTED_PROVIDER_MODEL_ID),
        (" ", SELECTED_PROVIDER_MODEL_ID),
        (None, SELECTED_PROVIDER_MODEL_ID),
        (SELECTED_PROVIDER, ""),
        (SELECTED_PROVIDER, " "),
        (SELECTED_PROVIDER, None),
    ],
)
def test_build_card_team_participants_rejects_empty_or_falsy_model_config(
    orchestrator_module,
    provider,
    provider_model_id,
):
    private_participant = CardRuntimePrivateParticipant.model_construct(
        cardId="agentA",
        runtimeType="assistant_agent",
        prompt="Be helpful.",
        provider=provider,
        providerModelId=provider_model_id,
    )
    runtime = CardRuntimeConfig.model_construct(
        cardId="mag1",
        title="Orchestrator",
        runtimeType="magentic_one",
        participants=[],
        privateParticipants=[private_participant],
    )
    context = ContextPack.model_construct(cardRuntime=runtime)
    orchestrator_config = orchestrator_module.AutoGenAgentConfig(
        provider=ORCHESTRATOR_PROVIDER,
        provider_model_id=ORCHESTRATOR_PROVIDER_MODEL_ID,
    )

    with pytest.raises(
        RuntimeError,
        match="participant_model_config_missing: cardId=agentA",
    ):
        orchestrator_module._build_card_team_participants(
            context,
            orchestrator_config,
            {},
        )


def test_build_card_team_participants_uses_participant_model_config(
    orchestrator_module,
    monkeypatch,
):
    captured_configs = []
    model_client = object()

    def capture_model_config(cache, config):
        captured_configs.append(config)
        return model_client

    monkeypatch.setattr(
        orchestrator_module,
        "_get_cached_model_client",
        capture_model_config,
    )

    private_participant = CardRuntimePrivateParticipant(
        cardId="agentA",
        runtimeType="assistant_agent",
        prompt="Be helpful.",
        provider=SELECTED_PROVIDER,
        providerModelId=SELECTED_PROVIDER_MODEL_ID,
    )
    public_participant = SimpleNamespace(
        cardId="agentA",
        summary="Agent A",
        role=None,
        tools=[],
        connectedTo=None,
    )
    runtime = CardRuntimeConfig.model_construct(
        cardId="mag1",
        title="Orchestrator",
        runtimeType="magentic_one",
        participants=[public_participant],
        privateParticipants=[private_participant],
    )
    context = ContextPack.model_construct(cardRuntime=runtime)
    orchestrator_config = orchestrator_module.AutoGenAgentConfig(
        provider=ORCHESTRATOR_PROVIDER,
        provider_model_id=ORCHESTRATOR_PROVIDER_MODEL_ID,
    )

    participants = orchestrator_module._build_card_team_participants(
        context,
        orchestrator_config,
        {},
    )

    assert len(participants) == 1
    assert participants[0].model_client is model_client
    assert len(captured_configs) == 1
    assert captured_configs[0].provider == SELECTED_PROVIDER
    assert captured_configs[0].provider_model_id == SELECTED_PROVIDER_MODEL_ID
    assert captured_configs[0].provider != ORCHESTRATOR_PROVIDER
    assert (
        captured_configs[0].provider_model_id
        != ORCHESTRATOR_PROVIDER_MODEL_ID
    )
