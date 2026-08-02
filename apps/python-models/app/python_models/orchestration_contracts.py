from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field, StringConstraints, field_validator


RequiredRuntimeString = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]


def _reject_default_model_value(value: str | None) -> str | None:
    if value is not None and str(value).strip().lower() == "default":
        raise ValueError("provider_model_default_forbidden")
    return value


class ToolSpec(BaseModel):
    """Canonical typed description of a tool the runtime may expose (T001).

    The agent card Tools tab is the only source of selected tool access; the
    ToolRegistry resolves only enabled, schema-complete specs. Empty names and
    missing or incomplete schemas are rejected here so invalid specs can never
    be registered.
    """

    name: RequiredRuntimeString
    description: RequiredRuntimeString
    enabled: bool = True
    inputSchema: dict[str, Any]
    outputSchema: dict[str, Any]

    @field_validator("inputSchema", "outputSchema")
    @classmethod
    def _require_complete_schema(cls, value: dict[str, Any]) -> dict[str, Any]:
        if not value:
            raise ValueError("tool_schema_missing")
        if not str(value.get("type") or "").strip():
            raise ValueError("tool_schema_incomplete: missing type")
        return value


class ProjectSession(BaseModel):
    sessionId: str
    projectId: str
    turnId: str
    # The backend's run identity when the caller supplies one.
    runId: str | None = None
    route: str
    orchestrator: Literal[
        "magentic_one",
        "assistant_agent",
    ] = "magentic_one"
    modelProvider: RequiredRuntimeString
    modelKey: RequiredRuntimeString
    providerModelId: RequiredRuntimeString
    startedAt: str

    _no_default_models = field_validator("modelProvider", "modelKey", "providerModelId")(
        _reject_default_model_value
    )


class CardRuntimeConfig(BaseModel):
    cardId: str
    title: str
    runtimeType: Literal[
        "magentic_one",
        "assistant_agent",
    ]
    prompt: str = ""
    runtimeOptions: dict = Field(default_factory=dict)
    assistant: dict | None = None
    magentic: dict | None = None
    participants: list["CardRuntimeParticipant"] = Field(default_factory=list)


class CardRuntimeParticipant(BaseModel):
    cardId: str
    title: str
    runtimeType: Literal["assistant_agent", "codex_app_server"]
    runtimeBinding: str | None = None
    tools: list[str] = Field(default_factory=list)
    prompt: str = ""
    provider: RequiredRuntimeString
    providerModelId: RequiredRuntimeString
    temperature: float | None = None
    maxTokens: int | None = None

    _no_default_models = field_validator("provider", "providerModelId")(
        _reject_default_model_value
    )


class AutoGenMessage(BaseModel):
    """A real AutoGen message/event captured verbatim from ``run_stream``.

    ``source`` and ``type`` are the message's own fields (the agent/orchestrator
    name and the message class name); ``content`` is the message's own text. The
    app never invents, classifies, or reshapes this — it is what AutoGen emitted.
    """

    source: str
    type: str
    content: str


class AgentAssignmentRequest(BaseModel):
    """Stable identities needed for Python to create and claim one assignment."""

    instructionId: RequiredRuntimeString
    senderCardId: RequiredRuntimeString
    receiverCardId: RequiredRuntimeString


class ContextPack(BaseModel):
    session: ProjectSession
    userText: str
    conversationId: str = ""
    agentAssignment: AgentAssignmentRequest | None = None
    cardRuntime: CardRuntimeConfig | None = None


class OrchestratorRunResponse(BaseModel):
    ok: bool
    session: ProjectSession
    assignmentId: str | None = None
    instructionId: str | None = None
    resultId: str | None = None
    stopReason: str | None = None
    # finalResponseText is the real last AutoGen message text (never an app-authored
    # summary). It is data only; the conversation panel does not auto-render it.
    finalResponseText: str
    # The real AutoGen run output: every message/event captured verbatim from
    # run_stream.
    autogenMessages: list[AutoGenMessage] = Field(default_factory=list)
    autogenEvents: list[AutoGenMessage] = Field(default_factory=list)
    error: str | None = None
