"""Typed saved-Card runtime and model configuration contracts."""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StrictBool, StringConstraints


RequiredRuntimeString = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1),
]


class HermesRuntime(BaseModel):
    kind: Literal["hermes"]
    mode: Literal["main", "delegate", "magentic_one"]
    profile: RequiredRuntimeString


class ModelOption(BaseModel):
    """Configured model transport supplied by the model catalog owner."""

    model_config = ConfigDict(extra="forbid", strict=True)
    provider: RequiredRuntimeString
    key: RequiredRuntimeString
    label: RequiredRuntimeString
    providerModelId: RequiredRuntimeString
    default: bool = False


class CardSubagentModel(BaseModel):
    """One saved model selection shared by Card editing and execution."""

    model_config = ConfigDict(
        extra="forbid",
        strict=True,
        str_strip_whitespace=True,
    )
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
    orchestrator: bool = False
    openaiRuntime: Literal["codex_app_server"] | None = None
    tools: list[str] = Field(default_factory=list)
    subagentModel: CardSubagentModel | None = None
    autoTools: StrictBool | None = None
    autoModel: StrictBool | None = None
