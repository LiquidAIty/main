import pytest
from pydantic import ValidationError

from app.python_models.orchestration_contracts import (
    CardRuntimeParticipant,
    CardRuntimePrivateParticipant,
    ContextPack,
)


SELECTED_PROVIDER = "openai"
SELECTED_PROVIDER_MODEL_ID = "gpt-5.1-chat-latest"


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


def test_context_pack_with_explicit_participant_models_validates():
    pack = ContextPack.model_validate(_complete_payload())

    assert pack.cardRuntime is not None
    assert pack.cardRuntime.participants[0].provider == SELECTED_PROVIDER
    assert pack.cardRuntime.participants[0].providerModelId == SELECTED_PROVIDER_MODEL_ID
    assert pack.cardRuntime.privateParticipants[0].provider == SELECTED_PROVIDER
    assert pack.cardRuntime.privateParticipants[0].providerModelId == SELECTED_PROVIDER_MODEL_ID


def test_context_pack_accepts_compact_magone_routing_metadata():
    payload = _complete_payload()
    payload["routingManifest"] = {
        "intent": "coding",
        "agents": [{"cardId": "coder", "capabilities": ["coding.execute"]}],
    }
    payload["codingWorkflowPacket"] = {
        "intent": "coding",
        "projectId": "p1",
        "targetRoot": "C:\\Projects\\main",
        "selectedPrimaryAgent": "coder",
        "tool": "coder_console_task",
        "compactSpec": "compact",
    }
    pack = ContextPack.model_validate(payload)
    assert pack.routingManifest["intent"] == "coding"
    assert pack.codingWorkflowPacket["tool"] == "coder_console_task"


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


@pytest.mark.parametrize("field", ["provider", "providerModelId"])
@pytest.mark.parametrize("value", ["", "   "])
def test_private_participant_rejects_empty_model_config(field, value):
    payload = {
        "cardId": "agentA",
        "runtimeType": "assistant_agent",
        "provider": SELECTED_PROVIDER,
        "providerModelId": SELECTED_PROVIDER_MODEL_ID,
    }
    payload[field] = value

    with pytest.raises(ValidationError):
        CardRuntimePrivateParticipant(**payload)


@pytest.mark.parametrize("participant_type", [CardRuntimeParticipant, CardRuntimePrivateParticipant])
@pytest.mark.parametrize("field", ["provider", "providerModelId"])
@pytest.mark.parametrize("value", ["default", " DEFAULT "])
def test_participant_contracts_reject_default_model_config(participant_type, field, value):
    payload = {
        "cardId": "agentA",
        "runtimeType": "assistant_agent",
        "provider": SELECTED_PROVIDER,
        "providerModelId": SELECTED_PROVIDER_MODEL_ID,
    }
    if participant_type is CardRuntimeParticipant:
        payload["title"] = "Agent A"
    payload[field] = value

    with pytest.raises(ValidationError, match="provider_model_default_forbidden"):
        participant_type(**payload)
