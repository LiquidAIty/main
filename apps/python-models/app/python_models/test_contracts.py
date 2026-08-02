from app.python_models.orchestration_contracts import (
    AutoGenMessage,
    OrchestratorRunResponse,
    ProjectSession,
)


def _session() -> ProjectSession:
    return ProjectSession(
        sessionId="s", projectId="p", turnId="t", route="r",
        modelProvider="openrouter", modelKey="gpt-5.1-chat",
        providerModelId="openai/gpt-5.1-chat", startedAt="now",
    )


def test_autogen_message_is_verbatim_shape():
    msg = AutoGenMessage(source="MagenticOneOrchestrator", type="TextMessage", content="ledger text")
    assert msg.source == "MagenticOneOrchestrator"
    assert msg.type == "TextMessage"
    assert msg.content == "ledger text"


def test_response_carries_native_run_messages_without_ledger_interception():
    res = OrchestratorRunResponse(
        ok=True,
        session=_session(),
        finalResponseText="full ledger text with NONCE_123",
        autogenMessages=[AutoGenMessage(source="x", type="TextMessage", content="hi")],
    )
    assert res.autogenMessages[0].content == "hi"
    assert "taskLedgerArtifact" not in res.model_dump()
