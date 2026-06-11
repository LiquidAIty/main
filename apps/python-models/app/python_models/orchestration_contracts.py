from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, Field, StringConstraints, field_validator


RequiredRuntimeString = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]


def _reject_default_model_value(value: str | None) -> str | None:
    if value is not None and str(value).strip().lower() == "default":
        raise ValueError("provider_model_default_forbidden")
    return value


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
    modelProvider: RequiredRuntimeString
    modelKey: RequiredRuntimeString
    providerModelId: RequiredRuntimeString
    startedAt: str

    _no_default_models = field_validator("modelProvider", "modelKey", "providerModelId")(
        _reject_default_model_value
    )


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


class CardFanOutConfig(BaseModel):
    """Card-level Swarm fan-out setting. Swarm never replaces the Mag One bus."""

    enabled: bool = False
    count: int = Field(default=2, ge=1, le=8)
    items: list[str] = Field(default_factory=list)


class GraphEdgeLoopRule(BaseModel):
    """Explicit exit rule for a ReactFlow loop edge. Loops without one are rejected."""

    maxIterations: int = Field(ge=1, le=10)
    exitOnText: str | None = None


class GraphEdgeInput(BaseModel):
    id: str = ""
    source: RequiredRuntimeString
    target: RequiredRuntimeString
    edgeType: Literal["flow", "magentic_option"] = "flow"
    loop: GraphEdgeLoopRule | None = None
    data: dict = Field(default_factory=dict)


class GraphNodeInput(BaseModel):
    cardId: RequiredRuntimeString
    title: str = ""
    kind: str = "agent"
    runtimeType: str = "assistant_agent"
    parentGraphId: str | None = None
    prompt: str = ""
    role: str | None = None
    tools: list[str] = Field(default_factory=list)
    fanOut: CardFanOutConfig | None = None
    isSocietyOfMind: bool = False
    provider: str | None = None
    providerModelId: str | None = None
    temperature: float | None = None
    maxTokens: int | None = None

    _no_default_models = field_validator("provider", "providerModelId")(
        _reject_default_model_value
    )


class CardRuntimeGraph(BaseModel):
    """The strict ReactFlow graph payload: nodes/cards and edges are the source of truth."""

    nodes: list[GraphNodeInput] = Field(default_factory=list)
    edges: list[GraphEdgeInput] = Field(default_factory=list)


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
    runtimeScope: dict | None = None
    graph: CardRuntimeGraph | None = None
    participants: list["CardRuntimeParticipant"] = Field(default_factory=list)
    privateParticipants: list["CardRuntimePrivateParticipant"] = Field(default_factory=list)

class CardRuntimePrivateParticipant(BaseModel):
    cardId: str
    runtimeType: Literal["assistant_agent", "graph_flow", "research_agent", "planner_agent"]
    runtimeBinding: str | None = None
    prompt: str = ""
    provider: RequiredRuntimeString
    providerModelId: RequiredRuntimeString
    temperature: float | None = None
    maxTokens: int | None = None

    _no_default_models = field_validator("provider", "providerModelId")(
        _reject_default_model_value
    )


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
    fanOut: CardFanOutConfig | None = None
    isSocietyOfMind: bool = False
    provider: RequiredRuntimeString
    providerModelId: RequiredRuntimeString
    temperature: float | None = None
    maxTokens: int | None = None

    _no_default_models = field_validator("provider", "providerModelId")(
        _reject_default_model_value
    )


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


class SearchWorkerPlan(BaseModel):
    id: str
    label: str
    angle: str = ""
    search_query: str = ""
    source_targets: list[str] = Field(default_factory=list)
    expected_evidence: str = ""
    disconfirming_focus: str = ""
    priority: Literal["low", "medium", "high"] = "medium"
    status: Literal["draft", "approved", "running", "complete", "failed"] = "draft"


class SearchSwarmPlan(BaseModel):
    status: Literal["draft", "ready_for_approval", "approved", "running", "complete"] = "draft"
    research_question: str = ""
    depth_label: Literal["quick_scan", "standard", "deep_dive", "custom"] = "standard"
    swarm_count: int = 0
    estimated_cost_level: Literal["low", "medium", "high", "custom"] = "low"
    search_workers: list[SearchWorkerPlan] = Field(default_factory=list)
    coverage: dict[str, bool] = Field(default_factory=dict)
    missing_coverage: list[str] = Field(default_factory=list)
    approval_required: bool = True
    approved: bool = False


class PlanContext(BaseModel):
    anchor: str = ""
    whatChanged: list[str] = Field(default_factory=list)
    openQuestions: list[str] = Field(default_factory=list)
    sources: list[str] = Field(default_factory=list)
    deltaSummary: str = ""
    status: Literal["draft", "grounded", "revised"] = "draft"
    searchSwarmPlan: SearchSwarmPlan | None = None


class ResearchPack(BaseModel):
    status: Literal["shaping", "research_pack_ready"] = "shaping"
    research_question: str = ""
    entities: list[str] = Field(default_factory=list)
    relationships: list[str] = Field(default_factory=list)
    claims: list[str] = Field(default_factory=list)
    assumptions: list[str] = Field(default_factory=list)
    risks: list[str] = Field(default_factory=list)
    counterarguments: list[str] = Field(default_factory=list)
    evidence_needed: list[str] = Field(default_factory=list)
    disconfirming_questions: list[str] = Field(default_factory=list)
    search_terms: list[str] = Field(default_factory=list)
    source_targets: list[str] = Field(default_factory=list)
    missing: list[str] = Field(default_factory=list)
    why_ready_or_not: str = ""


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
