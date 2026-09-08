"""ThinkGraph's product metadata; semantics are authored by its saved worker.

The active backend remains Constellation. These fields live on its native node,
never in a second question store. Structural validation does not interpret prose.
"""
from __future__ import annotations

from typing import Any, Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator


class GraphReference(BaseModel):
    model_config = ConfigDict(extra="forbid")
    authority: Literal["thinkgraph", "knowgraph", "codegraph"]
    nativeId: str = Field(min_length=1, max_length=300)
    projectId: str = Field(min_length=1, max_length=180)


class ResearchPolicy(BaseModel):
    model_config = ConfigDict(extra="forbid")
    depth: Literal["quick", "standard", "deep"] = "quick"
    automaticAllowed: bool = False
    maxSources: int = Field(default=3, ge=1, le=20)
    # Automatic paid research is intentionally disabled until its saved Run
    # budget is wired. Declaring a preference is not execution authorization.


class CognitionRecord(BaseModel):
    model_config = ConfigDict(extra="forbid")
    nodeType: str = Field(min_length=1, max_length=100)
    memoryCategory: Literal["episodic", "prospective", "preference", "working", "decision", "question", "hypothesis", "strategy", "attention"]
    projectScope: str = Field(min_length=1, max_length=180)
    userScope: str | None = Field(default=None, max_length=180)
    authoredBy: Literal["user", "assistant", "researcher"]
    decisionState: Literal["proposed", "accepted", "rejected", "superseded", "uncertain"] | None = None
    questionStatus: Literal["open", "researching", "answered", "partially_answered", "contested", "deferred", "superseded"] | None = None
    normalizedText: str | None = Field(default=None, max_length=8000)
    whyItMatters: str | None = Field(default=None, max_length=8000)
    currentInterest: float | None = Field(default=None, ge=0, le=1)
    originRefs: list[GraphReference] = Field(default_factory=list, max_length=64)
    relatedRefs: list[GraphReference] = Field(default_factory=list, max_length=64)
    answerRefs: list[GraphReference] = Field(default_factory=list, max_length=64)
    provenance: list[str] = Field(default_factory=list, max_length=64)
    researchPolicy: ResearchPolicy = Field(default_factory=ResearchPolicy)

    @model_validator(mode="after")
    def question_fields(self):
        if self.memoryCategory == "question" and not self.questionStatus:
            raise ValueError("question_status_required")
        if self.questionStatus in {"answered", "partially_answered", "contested"} and not self.answerRefs:
            raise ValueError("question_evidence_required")
        if any(ref.authority != "knowgraph" for ref in self.answerRefs):
            raise ValueError("question_answer_must_reference_knowgraph")
        if any(ref.projectId != self.projectScope for ref in self.originRefs + self.relatedRefs + self.answerRefs):
            raise ValueError("cross_project_reference_not_authorized")
        return self


def validate_cognition(value: Any, project_id: str) -> dict[str, Any]:
    if isinstance(value, dict):
        value = {"projectScope": project_id, **value}
        for field in ("originRefs", "relatedRefs", "answerRefs"):
            if isinstance(value.get(field), list):
                value[field] = [{"projectId": project_id, **ref} if isinstance(ref, dict) else ref for ref in value[field]]
    record = CognitionRecord.model_validate(value)
    if record.projectScope != project_id:
        raise ValueError("thinkgraph_project_scope_mismatch")
    if record.userScope:
        # The existing adapter has project authorization, not cross-project
        # user-memory authorization. Keep the semantic field without granting it.
        raise ValueError("thinkgraph_user_scope_authorization_required")
    return record.model_dump(exclude_none=True)


def research_seed(native_id: str, text: str, record: dict[str, Any]) -> dict[str, Any] | None:
    if record.get("memoryCategory") != "question":
        return None
    return {
        "questionRef": {"authority": "thinkgraph", "nativeId": native_id, "projectId": record["projectScope"]},
        "question": record.get("normalizedText") or text,
        "whyItMatters": record.get("whyItMatters"),
        "originRefs": record.get("originRefs", []),
        "knownContextRefs": record.get("relatedRefs", []),
        "researchPolicy": record.get("researchPolicy", {}),
        "status": record.get("questionStatus"),
    }
