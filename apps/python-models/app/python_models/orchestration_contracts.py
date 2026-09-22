from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator

RequiredRuntimeString = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]


class ToolSpec(BaseModel):
    """Canonical typed description of a tool the runtime may expose (T001).

    Read/write authority is explicit data, never inferred from the name or
    description. Reads and writes both require explicit Card/Run selection.
    Empty names and incomplete schemas are rejected.
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


class HermesRuntime(BaseModel):
    kind: Literal["hermes"]
    mode: Literal["main", "delegate", "kanban", "magentic_one"]
    profile: RequiredRuntimeString


class ModelOption(BaseModel):
    """Configured model transport, supplied by its native/configuration owner."""
    model_config = ConfigDict(extra="forbid", strict=True)
    provider: RequiredRuntimeString
    key: RequiredRuntimeString
    label: RequiredRuntimeString
    providerModelId: RequiredRuntimeString
    default: bool = False


class CardSubagentModel(BaseModel):
    """One saved model selection shared by Card editing and execution."""
    model_config = ConfigDict(extra="forbid", strict=True, str_strip_whitespace=True)
    provider: str = Field(min_length=1, max_length=256)
    accessMode: Literal["chatgpt-account", "openai-api", "openrouter-api"]
    modelKey: str = Field(min_length=1, max_length=256)
    providerModelId: str = Field(min_length=1, max_length=256)


CardSubagentType = Literal["none", "leaf", "recursive"]


class CardConfiguration(BaseModel):
    """Executable field shapes referenced by the Card dictionary."""
    runtimeKind: str
    runtimeMode: str
    runtimeProfile: str = ""
    subagentType: CardSubagentType = "none"
    provider: str = ""
    accessMode: Literal["chatgpt-account", "openai-api", "openrouter-api"]
    modelKey: str = ""
    openaiRuntime: Literal["codex_app_server"] | None = None
    reasoningEffort: Literal["low", "medium", "high", "xhigh"] | None = None
    temperature: float | None = Field(default=None, ge=0)
    maxTokens: int | None = Field(default=None, ge=1)
    maxTurns: int | None = Field(default=None, ge=1)
    tools: list[str] = Field(default_factory=list)
    subagentModel: CardSubagentModel | None = None


class DataAnchorReference(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    authority: Literal["ThinkGraph", "KnowGraph", "CodeGraph"]
    nativeId: str
    reason: str
    priority: int
    boundedExpansion: int
    resultLimit: int = 24
    required: bool


class GraphHook(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    authority: Literal["ThinkGraph", "KnowGraph", "CodeGraph"]
    nativeId: str | None = None
    reason: str
    order: int
    boundedExpansion: int
    resultLimit: int = 24
    required: bool
    searchDynamicInput: bool = False
    entityTypes: list[str] = Field(default_factory=list)
    edgeTypes: list[str] = Field(default_factory=list)
    validAtAfter: str | None = None
    validAtBefore: str | None = None
    invalidAtAfter: str | None = None
    invalidAtBefore: str | None = None
    maxNodes: int = 8
    maxFacts: int = 8


class NativeReference(BaseModel):
    authority: RequiredRuntimeString
    nativeId: RequiredRuntimeString
    reason: RequiredRuntimeString
    asOf: RequiredRuntimeString
    required: bool = False
