import json

import pytest
from pydantic import ValidationError

from app.python_models.autogen_orchestrator import _extract_ledger_block
from app.python_models.orchestration_contracts import (
    CardRuntimeParticipant,
    CardRuntimePrivateParticipant,
    ContextPack,
    TaskLedger,
    TaskLedgerTrace,
)


def test_extract_ledger_block_captures_fenced_nested_json():
    text = (
        "Here is the plan.\n\n```json\n"
        '{"task_ledger": {"user_goal": "audit", "plan": "1. read\\n2. report", "facts": ["a", "b"]}}\n'
        "```\n"
    )
    block = _extract_ledger_block(text)
    assert block is not None
    data = json.loads(block)
    ledger = TaskLedger(**data["task_ledger"])
    assert ledger.user_goal == "audit"
    assert "1. read" in ledger.plan
    assert ledger.facts == ["a", "b"]


def test_extract_ledger_block_returns_none_for_prose_only():
    # Prose with no JSON object must NOT be coerced into a fake TaskLedger.
    assert _extract_ledger_block("I cannot do that, here is a conversational answer.") is None
    assert _extract_ledger_block("") is None


def test_extract_ledger_block_bare_object_fallback():
    block = _extract_ledger_block('prefix {"task_ledger": {"user_goal": "g"}} suffix')
    assert block is not None
    assert json.loads(block)["task_ledger"]["user_goal"] == "g"


def test_task_ledger_trace_defaults_are_honest_missing():
    trace = TaskLedgerTrace()
    assert trace.source == "python_magone"
    assert trace.pythonSidecarCalled is False
    assert trace.taskLedgerFound is False
    assert trace.taskLedgerParseStatus == "missing"
    assert trace.backendPreserved is False


def test_task_ledger_trace_parsed_shape():
    trace = TaskLedgerTrace(
        pythonSidecarCalled=True,
        modelReturnedText=True,
        jsonBlockFound=True,
        taskLedgerFound=True,
        taskLedgerParseStatus="parsed",
        backendPreserved=True,
    )
    assert trace.taskLedgerParseStatus == "parsed"
    assert trace.backendPreserved is True
    assert trace.blocker is None


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
