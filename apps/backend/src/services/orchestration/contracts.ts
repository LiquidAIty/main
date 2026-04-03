import type {
  AgentCardRuntimeOptions,
  V3Blackboard,
  V3BlackboardField,
} from '../../v3/types';
import type { KnowGraphGap, ResearchSearchTask, ThinkGraphTriplet } from '../research/types';

export type SidecarOrchestrator =
  | 'magentic_one'
  | 'graph_flow'
  | 'assistant_agent';

export type ProjectSession = {
  sessionId: string;
  projectId: string;
  turnId: string;
  route: string;
  orchestrator: SidecarOrchestrator;
  modelProvider: string;
  modelKey: string;
  providerModelId: string;
  startedAt: string;
};

export type CallableHeadRef = {
  cardId: string;
  title: string;
  runtimeType: 'assistant_agent' | 'graph_flow';
};

export type DeckEdgeRef = {
  source: string;
  target: string;
};

export type GraphFlowSpec = {
  graphCardId: string;
  stepCardIds: string[];
  edges: DeckEdgeRef[];
};

export type CardRuntimeConfig = {
  cardId: string;
  title: string;
  runtimeType: SidecarOrchestrator;
  prompt: string;
  runtimeOptions: AgentCardRuntimeOptions;
  assistant?: {
    executionMode: 'single' | 'swarm';
    swarmMaxWorkers?: number | null;
    swarmWorkerPromptTemplate?: string | null;
    useSocietyOfMindConsolidation?: boolean | null;
    tools: string[];
  } | null;
  magentic?: {
    callableHeads: CallableHeadRef[];
    maxTurns?: number | null;
    maxStalls?: number | null;
    finalAnswerPrompt?: string | null;
  } | null;
  graphFlow?: {
    graph: GraphFlowSpec;
    useSocietyOfMindConsolidation?: boolean | null;
  } | null;
};

export type BlackboardEntry = {
  field: V3BlackboardField;
  mode: 'set' | 'append';
  valueText?: string | null;
  valueList?: string[];
  sourceAgent: string;
  summary?: string | null;
};

export type ContextPack = {
  session: ProjectSession;
  userText: string;
  priorAssistantText: string;
  systemPrompt: string;
  blackboard: V3Blackboard;
  plan: {
    anchor: string;
    whatChanged: string[];
    openQuestions: string[];
    sources: string[];
    deltaSummary: string;
    status: 'draft' | 'grounded' | 'revised';
  };
  thinkGraph: {
    priorityEntities: string[];
    priorityRelationships: string[];
    triplets: ThinkGraphTriplet[];
    openQuestions: string[];
  };
  knowGraph: {
    gaps: KnowGraphGap[];
    graphFacts: Array<{
      entityA: string;
      relationshipType: string;
      entityB: string;
      confidence?: number | null;
      documentId?: string | null;
      sourceName?: string | null;
      fetchedAt?: string | null;
    }>;
    evidence: Array<{
      title: string;
      url: string;
      snippet: string;
      documentId?: string | null;
      fetchedAt?: string | null;
    }>;
    researchDocumentCount: number;
  };
  attachments: Array<{
    documentId: string;
    fileName: string;
  }>;
  maxResearchTasks: number;
  cardRuntime?: CardRuntimeConfig | null;
};

export type AgentReportBack =
  | {
      kind: 'assistant_response';
      sourceAgent: string;
      summary: string;
      finalResponseText: string;
    }
  | {
      kind: 'plan_update';
      sourceAgent: string;
      summary: string;
      plan: ContextPack['plan'];
    }
  | {
      kind: 'blackboard_write';
      sourceAgent: string;
      summary: string;
      entries: BlackboardEntry[];
    }
  | {
      kind: 'thinkgraph_update';
      sourceAgent: string;
      summary: string;
      priorityEntities: string[];
      triplets: ThinkGraphTriplet[];
      openQuestions: string[];
    }
  | {
      kind: 'knowgraph_update';
      sourceAgent: string;
      summary: string;
      searchTasks: ResearchSearchTask[];
      priorityEntities: string[];
      priorityRelationships: string[];
      triplets: ThinkGraphTriplet[];
      gaps: KnowGraphGap[];
      openQuestions: string[];
    };

export type OrchestratorMetrics = {
  elapsedMs: number;
  turnsUsed: number;
  reportBackCount: number;
  blackboardWriteCount: number;
  searchTaskCount: number;
  refinementApplied: boolean;
};

export type OrchestratorRunResponse = {
  ok: boolean;
  session: ProjectSession;
  stopReason?: string | null;
  finalResponseText: string;
  blackboardEntries: BlackboardEntry[];
  plan: ContextPack['plan'];
  thinkGraph: ContextPack['thinkGraph'];
  knowGraph: {
    searchTasks: ResearchSearchTask[];
    priorityEntities: string[];
    priorityRelationships: string[];
    triplets: ThinkGraphTriplet[];
    gaps: KnowGraphGap[];
    openQuestions: string[];
  };
  reportBacks: AgentReportBack[];
  transcript: string[];
  metrics: OrchestratorMetrics;
};
