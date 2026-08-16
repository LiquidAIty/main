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
    parentRunId: str | None = None
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
    runtimeBinding: str | None = None
    executionMode: Literal["single", "auto-kanban"] | None = None
    prompt: str = ""
    provider: str | None = None
    accessMode: Literal["chatgpt-account", "openai-api", "openrouter-api"]
    modelKey: str | None = None
    providerModelId: str | None = None
    runtimeOptions: dict = Field(default_factory=dict)
    assistant: dict | None = None
    magentic: dict | None = None
    participants: list["CardRuntimeParticipant"] = Field(default_factory=list)


class CardRuntimeParticipant(BaseModel):
    cardId: str
    title: str
    runtimeType: Literal["assistant_agent"]
    runtimeBinding: str | None = None
    executionMode: Literal["single", "auto-kanban"] = "single"
    tools: list[str] = Field(default_factory=list)
    prompt: str = ""
    provider: RequiredRuntimeString
    accessMode: Literal["chatgpt-account", "openai-api", "openrouter-api"]
    providerModelId: RequiredRuntimeString
    reasoningEffort: Literal["low", "medium", "high", "xhigh"] | None = None
    # Local Coder only: exact MCP capabilities selected on the saved card.
    # ``tools`` remains the outer AutoGen controller grant.
    innerMcpTools: list[str] = Field(default_factory=list)
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


class NativeReference(BaseModel):
    authority: RequiredRuntimeString
    nativeId: RequiredRuntimeString
    required: bool = False


class InputDataFile(BaseModel):
    """Transport representation of one assembled model-input document."""

    idfId: RequiredRuntimeString
    projectId: RequiredRuntimeString
    deckId: RequiredRuntimeString
    conversationId: RequiredRuntimeString
    runId: RequiredRuntimeString
    originatingCardId: RequiredRuntimeString
    version: int = Field(ge=1)
    systemText: str = ""
    userText: RequiredRuntimeString
    cardContext: dict[str, Any] | None = None
    dynamicContextMarkdown: str = ""
    nativeReferences: list[NativeReference] = Field(default_factory=list)
    modelInputMarkdown: RequiredRuntimeString
    contentMarkdown: RequiredRuntimeString
    contentSha256: RequiredRuntimeString
    createdAt: RequiredRuntimeString


class RuntimeRequest(BaseModel):
    session: ProjectSession
    idf: InputDataFile
    cardRuntime: CardRuntimeConfig | None = None


def require_idf_card_runtime(context: RuntimeRequest) -> CardRuntimeConfig:
    """Return the runtime config only when it is the exact IDF card snapshot."""
    if context.cardRuntime is None:
        raise RuntimeError("card_runtime_missing")
    if context.idf.cardContext != context.cardRuntime.model_dump(exclude_none=True):
        raise RuntimeError("runtime_idf_card_context_mismatch")
    return context.cardRuntime


class OrchestratorRunResponse(BaseModel):
    ok: bool
    session: ProjectSession
    runId: str
    idfId: str
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
