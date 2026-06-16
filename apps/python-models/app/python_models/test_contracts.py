from app.python_models.orchestration_contracts import (
    AutoGenMessage,
    KnowGraphUpdateReport,
    OrchestratorRunResponse,
    PlanContext,
    ProgressLedgerReference,
    ProjectSession,
    TaskLedgerArtifact,
    ThinkGraphContext,
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


def test_response_carries_real_artifact_and_identify_only_progress_reference():
    artifact = TaskLedgerArtifact(
        factsResponse="GIVEN FACTS\n- repo exists",
        planResponse="- inspect read-only",
        taskLedgerResponse="full ledger text with NONCE_123",
        teamDescription="Research_Agent: research",
    )
    res = OrchestratorRunResponse(
        ok=True,
        session=_session(),
        finalResponseText="full ledger text with NONCE_123",
        autogenMessages=[AutoGenMessage(source="x", type="TextMessage", content="hi")],
        taskLedgerArtifact=artifact,
        progressLedgerReference=ProgressLedgerReference(),
        plan=PlanContext(),
        thinkGraph=ThinkGraphContext(),
        knowGraph=KnowGraphUpdateReport(sourceAgent="t", summary="t"),
    )
    assert res.taskLedgerArtifact is not None
    assert res.taskLedgerArtifact.source == "autogen_0_7_5_magentic_one"
    assert res.taskLedgerArtifact.phase == "task_ledger"
    # Progress Ledger is identify-only: referenced, never started/implemented/rendered.
    assert res.progressLedgerReference.identified is True
    assert res.progressLedgerReference.started is False
    assert res.progressLedgerReference.implemented is False
    assert res.progressLedgerReference.rendered is False
    assert res.progressLedgerReference.promptConstant == "ORCHESTRATOR_PROGRESS_LEDGER_PROMPT"
