from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


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
    evidenceCount: int = 0
    contradictionCount: int = 0
    existingRelationTypes: list[str] = Field(default_factory=list)
    lastEvidenceAt: str | None = None


class SearchTaskInput(BaseModel):
    query: str
    intent: str = "verify"
    priority: str = "high"
    gap: GapInput | None = None
    triplet: TripletInput | None = None


class BlackboardSnapshot(BaseModel):
    current_goal: str | None = None
    what_matters_now: list[str] = Field(default_factory=list)
    open_questions: list[str] = Field(default_factory=list)
    findings: list[str] = Field(default_factory=list)
    suggestions: list[str] = Field(default_factory=list)
    next_options: list[str] = Field(default_factory=list)
    next_move: str | None = None
    updated_at: str | None = None
    store: dict[str, str] = Field(default_factory=dict)


class BlackboardEntry(BaseModel):
    field: Literal[
        "current_goal",
        "what_matters_now",
        "open_questions",
        "findings",
        "suggestions",
        "next_options",
        "next_move",
    ]
    mode: Literal["set", "append"] = "append"
    valueText: str | None = None
    valueList: list[str] = Field(default_factory=list)
    sourceAgent: str
    summary: str | None = None


class ProjectSession(BaseModel):
    sessionId: str
    projectId: str
    turnId: str
    route: str
    orchestrator: Literal[
        "magentic_one",
        "graph_flow",
        "assistant_agent",
    ] = "magentic_one"
    modelProvider: str
    modelKey: str
    providerModelId: str
    startedAt: str


class CallableHeadRef(BaseModel):
    cardId: str
    title: str
    runtimeType: Literal["assistant_agent", "graph_flow"]


class DeckEdgeRef(BaseModel):
    source: str
    target: str


class GraphFlowSpec(BaseModel):
    graphCardId: str
    stepCardIds: list[str] = Field(default_factory=list)
    edges: list[DeckEdgeRef] = Field(default_factory=list)


class CardRuntimeConfig(BaseModel):
    cardId: str
    title: str
    runtimeType: Literal[
        "magentic_one",
        "graph_flow",
        "assistant_agent",
    ]
    prompt: str = ""
    runtimeOptions: dict = Field(default_factory=dict)
    assistant: dict | None = None
    magentic: dict | None = None
    graphFlow: dict | None = None
    participants: list["CardRuntimeParticipant"] = Field(default_factory=list)


class CardRuntimeParticipant(BaseModel):
    cardId: str
    title: str
    runtimeType: Literal["assistant_agent", "graph_flow"]
    runtimeBinding: str | None = None
    role: str | None = None
    tools: list[str] = Field(default_factory=list)
    skills: list[str] = Field(default_factory=list)
    personas: list[str] = Field(default_factory=list)
    knowledgeSources: list[str] = Field(default_factory=list)
    connectedTo: str | None = None
    prompt: str = ""
    provider: str
    providerModelId: str
    temperature: float | None = None
    maxTokens: int | None = None


class WorkspaceObjectContext(BaseModel):
    activeSurface: str | None = None
    activeWorkbench: str | None = None
    connectedWorkbenchAgent: bool | None = None
    repoPath: str | None = None
    workspaceRoot: str | None = None
    graphSource: str | None = None
    analysisStatus: str | None = None
    workspaceView: str | None = None
    selectedNodeId: str | None = None
    selectedNodeName: str | None = None
    selectedObjectId: str | None = None
    selectedObjectType: str | None = None
    selectedObjectTitle: str | None = None
    selectedText: str | None = None
    openObjectSummary: str | None = None
    activeMagenticParticipants: list[str] = Field(default_factory=list)
    availableCanvasAgents: list[str] = Field(default_factory=list)
    excludedAgents: list[str] = Field(default_factory=list)


class PlanContext(BaseModel):
    anchor: str = ""
    whatChanged: list[str] = Field(default_factory=list)
    openQuestions: list[str] = Field(default_factory=list)
    sources: list[str] = Field(default_factory=list)
    deltaSummary: str = ""
    status: Literal["draft", "grounded", "revised"] = "draft"


class ThinkGraphContext(BaseModel):
    priorityEntities: list[str] = Field(default_factory=list)
    priorityRelationships: list[str] = Field(default_factory=list)
    triplets: list[TripletInput] = Field(default_factory=list)
    openQuestions: list[str] = Field(default_factory=list)


class KnowGraphFactInput(BaseModel):
    entityA: str
    relationshipType: str
    entityB: str
    confidence: float | None = None
    documentId: str | None = None
    sourceName: str | None = None
    fetchedAt: str | None = None


class KnowGraphEvidenceInput(BaseModel):
    title: str
    url: str
    snippet: str
    documentId: str | None = None
    fetchedAt: str | None = None


class KnowGraphContext(BaseModel):
    gaps: list[GapInput] = Field(default_factory=list)
    graphFacts: list[KnowGraphFactInput] = Field(default_factory=list)
    evidence: list[KnowGraphEvidenceInput] = Field(default_factory=list)
    researchDocumentCount: int = 0


class AttachmentInput(BaseModel):
    documentId: str
    fileName: str


class ContextPack(BaseModel):
    session: ProjectSession
    userText: str
    priorAssistantText: str = ""
    systemPrompt: str = ""
    blackboard: BlackboardSnapshot = Field(default_factory=BlackboardSnapshot)
    plan: PlanContext = Field(default_factory=PlanContext)
    thinkGraph: ThinkGraphContext = Field(default_factory=ThinkGraphContext)
    knowGraph: KnowGraphContext = Field(default_factory=KnowGraphContext)
    attachments: list[AttachmentInput] = Field(default_factory=list)
    maxResearchTasks: int = 6
    workspaceObjectContext: WorkspaceObjectContext | None = None
    cardRuntime: CardRuntimeConfig | None = None


class AssistantResponseReport(BaseModel):
    kind: Literal["assistant_response"] = "assistant_response"
    sourceAgent: str
    summary: str
    finalResponseText: str


class PlanUpdateReport(BaseModel):
    kind: Literal["plan_update"] = "plan_update"
    sourceAgent: str
    summary: str
    plan: PlanContext


class BlackboardWriteReport(BaseModel):
    kind: Literal["blackboard_write"] = "blackboard_write"
    sourceAgent: str
    summary: str
    entries: list[BlackboardEntry] = Field(default_factory=list)


class ThinkGraphUpdateReport(BaseModel):
    kind: Literal["thinkgraph_update"] = "thinkgraph_update"
    sourceAgent: str
    summary: str
    priorityEntities: list[str] = Field(default_factory=list)
    triplets: list[TripletInput] = Field(default_factory=list)
    openQuestions: list[str] = Field(default_factory=list)


class KnowGraphUpdateReport(BaseModel):
    kind: Literal["knowgraph_update"] = "knowgraph_update"
    sourceAgent: str
    summary: str
    searchTasks: list[SearchTaskInput] = Field(default_factory=list)
    priorityEntities: list[str] = Field(default_factory=list)
    priorityRelationships: list[str] = Field(default_factory=list)
    triplets: list[TripletInput] = Field(default_factory=list)
    gaps: list[GapInput] = Field(default_factory=list)
    openQuestions: list[str] = Field(default_factory=list)


class OrchestratorMetrics(BaseModel):
    elapsedMs: int = 0
    turnsUsed: int = 0
    reportBackCount: int = 0
    blackboardWriteCount: int = 0
    searchTaskCount: int = 0
    refinementApplied: bool = False


class OrchestratorRunResponse(BaseModel):
    ok: bool
    session: ProjectSession
    stopReason: str | None = None
    finalResponseText: str
    blackboardEntries: list[BlackboardEntry] = Field(default_factory=list)
    plan: PlanContext
    thinkGraph: ThinkGraphContext
    knowGraph: KnowGraphUpdateReport
    reportBacks: list[
        AssistantResponseReport
        | PlanUpdateReport
        | BlackboardWriteReport
        | ThinkGraphUpdateReport
        | KnowGraphUpdateReport
    ] = Field(default_factory=list)
    transcript: list[str] = Field(default_factory=list)
    metrics: OrchestratorMetrics = Field(default_factory=OrchestratorMetrics)
