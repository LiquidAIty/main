"""Research-plan contracts for the Assist loop.

The previous implementation of ``plan_research_with_autogen`` was built on
the banned AgentChat package line. The v0.4.4 Magentic-One runtime lives in
``magentic_runtime.py`` / ``autogen_orchestrator.py``; this research-plan
path has not been ported and fails loudly instead of importing the banned
package.
"""

from __future__ import annotations

from pydantic import BaseModel, Field

from app.python_models.autogen_provider_env import AutoGenAgentConfig


class TripletInput(BaseModel):
    entityA: str
    relationshipType: str
    entityB: str
    confidence: float | None = None
    source: str | None = None


class GapInput(BaseModel):
    entityA: str
    relationshipType: str
    entityB: str
    gapType: str
    priority: str = "high"
    reason: str = ""


class SearchTaskInput(BaseModel):
    query: str
    intent: str = "verify"
    priority: str = "high"
    triplet: TripletInput | None = None
    gap: GapInput | None = None


class ResearchPlanRequest(BaseModel):
    project_id: str
    turn_id: str
    query: str
    priority_entities: list[str] = Field(default_factory=list)
    priority_relationships: list[str] = Field(default_factory=list)
    triplets: list[TripletInput] = Field(default_factory=list)
    gaps: list[GapInput] = Field(default_factory=list)
    open_questions: list[str] = Field(default_factory=list)
    draft_tasks: list[SearchTaskInput] = Field(default_factory=list)
    max_tasks: int = 6
    agent: AutoGenAgentConfig


class SearchTaskOutput(BaseModel):
    query: str
    intent: str = "verify"
    priority: str = "high"
    triplet: TripletInput | None = None


class ResearchPlanResponse(BaseModel):
    ok: bool
    planner: str
    project_id: str
    turn_id: str
    query: str
    planned_task_count: int
    search_tasks: list[SearchTaskOutput] = Field(default_factory=list)
    stop_reason: str | None = None
    transcript: list[str] = Field(default_factory=list)


async def plan_research_with_autogen(request: ResearchPlanRequest) -> ResearchPlanResponse:
    raise RuntimeError("autogen_research_plan_not_ported_to_v044_runtime")
