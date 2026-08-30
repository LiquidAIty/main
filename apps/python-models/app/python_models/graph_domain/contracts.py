"""Typed request contracts for LiquidAIty graph recipes.

These contracts select bounded operations in native owners. They are not a
graph schema, storage authority, workflow database, or semantic router.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class _StrictRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class ThinkContextRequest(_StrictRequest):
    focus: str | list[str]
    budget: int = Field(default=2_000, ge=100, le=12_000)
    maxDepth: int = Field(default=2, ge=0, le=5)
    maxL2: int = Field(default=12, ge=0, le=128)
    inspectTop: int = Field(default=3, ge=0, le=6)

    @model_validator(mode="after")
    def require_focus(self) -> "ThinkContextRequest":
        values = [self.focus] if isinstance(self.focus, str) else self.focus
        if not 1 <= len(values) <= 16:
            raise ValueError("think_focus_count_invalid")
        if any(not value.strip() or len(value) > 500 for value in values):
            raise ValueError("think_focus_invalid")
        return self


class KnowContextRequest(_StrictRequest):
    query: str = Field(min_length=1, max_length=2_000)
    maxEntities: int = Field(default=8, ge=1, le=20)
    maxFacts: int = Field(default=8, ge=1, le=20)
    expandAroundTopEntity: bool = False
    maxEpisodes: int = Field(default=50, ge=1, le=50)
    entityTypes: list[str] = Field(default_factory=list, max_length=16)
    edgeTypes: list[str] = Field(default_factory=list, max_length=16)
    validAtAfter: str | None = Field(default=None, max_length=100)
    validAtBefore: str | None = Field(default=None, max_length=100)


class CodeContextRequest(_StrictRequest):
    query: str = Field(min_length=1, max_length=2_000)
    project: str = Field(default="C-Projects-LiquidAIty-main", min_length=1, max_length=300)
    maxSymbols: int = Field(default=4, ge=1, le=8)
    traceDepth: int = Field(default=2, ge=0, le=5)
    includeTests: bool = False


class NativeAnchor(_StrictRequest):
    authority: Literal["ThinkGraph", "KnowGraph", "CodeGraph"]
    nativeId: str = Field(min_length=1, max_length=500)


class CrossGraphContextRequest(_StrictRequest):
    mission: str = Field(min_length=1, max_length=4_000)
    includeCode: bool = False
    codeProject: str = Field(default="C-Projects-LiquidAIty-main", min_length=1, max_length=300)
    anchors: list[NativeAnchor] = Field(default_factory=list, max_length=16)
    thinkBudget: int = Field(default=2_000, ge=100, le=12_000)
    evidenceLimit: int = Field(default=8, ge=1, le=20)
    codeSymbolLimit: int = Field(default=4, ge=1, le=8)
