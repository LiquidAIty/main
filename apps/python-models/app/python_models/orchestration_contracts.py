from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    field_validator,
    model_validator,
)

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
    mode: Literal["main", "delegate", "magentic_one"]
    profile: RequiredRuntimeString


class ModelRoutingProfile(BaseModel):
    """Routing facts supplied by the configured model catalog."""

    model_config = ConfigDict(extra="forbid", strict=True)
    taskFit: RequiredRuntimeString
    supportsTools: bool
    inputModalities: list[RequiredRuntimeString]
    reasoningEfforts: list[RequiredRuntimeString]


class ModelOption(BaseModel):
    """Configured model transport supplied by the model catalog owner."""
    model_config = ConfigDict(extra="forbid", strict=True)
    provider: RequiredRuntimeString
    key: RequiredRuntimeString
    label: RequiredRuntimeString
    providerModelId: RequiredRuntimeString
    default: bool = False
    contextWindow: int | None = Field(default=None, gt=0)
    routingProfile: ModelRoutingProfile | None = None


class CardSubagentModel(BaseModel):
    """One saved model selection shared by Card editing and execution."""
    model_config = ConfigDict(extra="forbid", strict=True, str_strip_whitespace=True)
    provider: str = Field(min_length=1, max_length=256)
    accessMode: Literal["chatgpt-account", "openai-api", "openrouter-api"]
    modelKey: str = Field(min_length=1, max_length=256)
    providerModelId: str = Field(min_length=1, max_length=256)


CardSubagentType = Literal["none", "leaf", "recursive"]
CardJevContextMode = Literal[
    "inherited", "request_card", "conversation_window", "selected_graph_context",
]


class CardConfiguration(BaseModel):
    """Executable field shapes referenced by the Card dictionary."""
    runtimeKind: str
    runtimeMode: str
    runtimeProfile: str = ""
    subagentType: CardSubagentType = "none"
    provider: str = ""
    accessMode: Literal["chatgpt-account", "openai-api", "openrouter-api"]
    modelKey: str = ""
    orchestrator: bool = False
    autoSelect: bool = False
    openaiRuntime: Literal["codex_app_server"] | None = None
    reasoningEffort: Literal["low", "medium", "high", "xhigh"] | None = None
    temperature: float | None = Field(default=None, ge=0)
    maxTokens: int | None = Field(default=None, ge=1)
    maxTurns: int | None = Field(default=None, ge=1)
    tools: list[str] = Field(default_factory=list)
    autoTools: bool = False
    jevAutoToolsContext: CardJevContextMode = "inherited"
    jevModelChoiceContext: CardJevContextMode = "inherited"
    subagentModel: CardSubagentModel | None = None


GraphRecordIdField = Literal[
    "engraphisMemoryId",
    "engraphisEntityId",
    "engraphisRelationshipId",
    "graphitiEpisodeId",
    "graphitiEntityId",
    "graphitiRelationshipId",
    "cbmQualifiedName",
]
GRAPH_RECORD_ID_FIELDS: tuple[str, ...] = (
    "engraphisMemoryId",
    "engraphisEntityId",
    "engraphisRelationshipId",
    "graphitiEpisodeId",
    "graphitiEntityId",
    "graphitiRelationshipId",
    "cbmQualifiedName",
)


def graph_record_identity(value: dict[str, Any]) -> tuple[str, str]:
    populated = [
        field for field in GRAPH_RECORD_ID_FIELDS
        if str(value.get(field) or "").strip()
    ]
    if len(populated) != 1:
        raise ValueError("graph_record_identity_invalid")
    field = populated[0]
    return field, str(value[field]).strip()


def graph_record_fields(field: GraphRecordIdField, identifier: str) -> dict[str, str]:
    value = str(identifier or "").strip()
    if field not in GRAPH_RECORD_ID_FIELDS or not value:
        raise ValueError("graph_record_identity_invalid")
    return {field: value}


def _validate_graph_record(model: BaseModel, *, allow_missing: bool) -> BaseModel:
    populated = [
        field for field in GRAPH_RECORD_ID_FIELDS
        if str(getattr(model, field, None) or "").strip()
    ]
    if allow_missing and not populated:
        return model
    if len(populated) != 1:
        raise ValueError("graph_record_identity_invalid")
    return model


class GraphRecordReference(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    engraphisMemoryId: RequiredRuntimeString | None = None
    engraphisEntityId: RequiredRuntimeString | None = None
    engraphisRelationshipId: RequiredRuntimeString | None = None
    graphitiEpisodeId: RequiredRuntimeString | None = None
    graphitiEntityId: RequiredRuntimeString | None = None
    graphitiRelationshipId: RequiredRuntimeString | None = None
    cbmQualifiedName: RequiredRuntimeString | None = None

    @model_validator(mode="after")
    def require_exact_provider_identity(self):
        return _validate_graph_record(self, allow_missing=False)


class DataAnchorReference(GraphRecordReference):
    model_config = ConfigDict(extra="forbid", strict=True)
    reason: str
    priority: int
    boundedExpansion: int
    resultLimit: int = 24
    required: bool


class GraphAnchor(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    engraphisMemoryId: RequiredRuntimeString | None = None
    engraphisEntityId: RequiredRuntimeString | None = None
    engraphisRelationshipId: RequiredRuntimeString | None = None
    graphitiEpisodeId: RequiredRuntimeString | None = None
    graphitiEntityId: RequiredRuntimeString | None = None
    graphitiRelationshipId: RequiredRuntimeString | None = None
    cbmQualifiedName: RequiredRuntimeString | None = None
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

    @model_validator(mode="after")
    def require_exact_record_or_search(self):
        _validate_graph_record(self, allow_missing=True)
        has_record = any(
            str(getattr(self, field, None) or "").strip()
            for field in GRAPH_RECORD_ID_FIELDS
        )
        if not has_record and not self.searchDynamicInput:
            raise ValueError("graph_anchor_record_or_search_required")
        return self


class GraphReference(GraphRecordReference):
    reason: RequiredRuntimeString
    asOf: RequiredRuntimeString
    required: bool = False
