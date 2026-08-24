from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field, StringConstraints, field_validator

from app.python_models.idf import Idf


RequiredRuntimeString = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]


class ToolSpec(BaseModel):
    """Canonical typed description of a tool the runtime may expose (T001).

    Read/write authority is explicit data, never inferred from the name or
    description. Read tools form the IDD read plane; write tools additionally
    require Card selection. Empty names and incomplete schemas are rejected.
    """

    name: RequiredRuntimeString
    description: RequiredRuntimeString
    enabled: bool = True
    access: Literal["read", "write"]
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
    deckId: str
    cardId: str
    conversationId: str | None = None
    turnId: str
    # The backend's run identity when the caller supplies one.
    runId: str | None = None
    parentRunId: str | None = None
    route: str
    orchestrator: Literal[
        "magentic_one",
        "assistant_agent",
    ] = "magentic_one"
    startedAt: str


class AutoGenRuntime(BaseModel):
    kind: Literal["autogen"]
    mode: Literal["assistant", "magentic_one"]


class RuntimeParticipant(BaseModel):
    cardId: str
    title: str
    runtime: AutoGenRuntime


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
    reason: RequiredRuntimeString
    asOf: RequiredRuntimeString
    required: bool = False


class RuntimeInputFile(BaseModel):
    workspace: str
    idfPath: str
    idfSha256: str
    idfBytes: int


class StoredRuntimeRequest(BaseModel):
    """External request that names the already-retained canonical bytes."""

    session: ProjectSession
    inputFile: RuntimeInputFile
    participants: list[RuntimeParticipant] = Field(default_factory=list)


class RuntimeRequest(BaseModel):
    """Internal request loaded and validated from the one retained IDF."""

    session: ProjectSession
    idf: Idf
    inputFile: RuntimeInputFile
    participants: list[RuntimeParticipant] = Field(default_factory=list)


class OrchestratorRunResponse(BaseModel):
    ok: bool
    session: ProjectSession
    runId: str
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
