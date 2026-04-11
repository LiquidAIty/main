export type PromptTemplate = {
  id: string;
  content: string;
};

export type RuntimeBinding =
  | 'main_chat'
  | 'kg_ingest'
  | 'research_agent'
  | 'knowgraph'
  | 'neo4j';

export type AgentCardRuntimeType =
  | 'assistant_agent'
  | 'magentic_one'
  | 'graph_flow';

export type DeckEdgeType = 'magentic_option' | 'flow';

export type DeckEdgeRole =
  | 'graph_execution'
  | 'callable_route'
  | 'reconcile_input'
  | 'compatibility_legacy';

export type DeckEdgeExecutionMode = 'required' | 'optional' | 'conditional';

export type DeckEdgeMergeIntent =
  | 'all_inputs'
  | 'any_input'
  | 'first_success'
  | 'summarize_all'
  | 'select_best'
  | 'manual_review';

export type DeckEdgeMetadata = {
  role?: DeckEdgeRole | null;
  executionMode?: DeckEdgeExecutionMode | null;
  conditionType?: string | null;
  conditionExpression?: string | null;
  conditionLabel?: string | null;
  priority?: number | null;
  order?: number | null;
  weight?: number | null;
  mergeIntent?: DeckEdgeMergeIntent | null;
  legacyCompatibility?: boolean | null;
};

export type AssistExecutionMode = 'single' | 'swarm';

export type AgentCardRuntimeOptions = {
  provider?: 'openai' | 'openrouter' | null;
  modelKey?: string | null;
  temperature?: number | null;
  maxTokens?: number | null;
  streaming?: boolean | null;
  emitTeamEvents?: boolean | null;
  executionMode?: AssistExecutionMode | null;
  swarmMaxWorkers?: number | null;
  swarmWorkerPromptTemplate?: string | null;
  useSocietyOfMindConsolidation?: boolean | null;
  maxTurns?: number | null;
  maxStalls?: number | null;
  finalAnswerPrompt?: string | null;
  selectorPrompt?: string | null;
  allowRepeatedSpeaker?: boolean | null;
};

export type DeckNodeKind = 'agent';

export type AgentTemplate = {
  id: string;
  name: string;
  promptTemplate?: string | null;
  model?: string | null;
  provider?: string | null;
  temperature?: number | null;
  maxTokens?: number | null;
  tools: string[];
  skills?: string[];
  personas?: string[];
  knowledgeSources?: string[];
  ioSchema?: Record<string, unknown>;
};

export type CloneConfig = {
  enabled: boolean;
  seeds?: string[];
};

export type AgentCardInstance = {
  id: string;
  kind?: DeckNodeKind;
  templateId: string;
  prompt?: string | null;
  runtimeBinding?: RuntimeBinding | null;
  runtimeType?: AgentCardRuntimeType | null;
  runtimeOptions?: AgentCardRuntimeOptions | null;
  parentGraphId?: string | null;
  title: string;
  subtitle?: string;
  position: { x: number; y: number };
  overrides?: Partial<AgentTemplate>;
  status?: 'idle' | 'ready' | 'running' | 'error';
  cloneConfig?: CloneConfig;
};

export type DeckEdge = {
  id: string;
  source: string;
  target: string;
  edgeType?: DeckEdgeType | null;
  metadata?: DeckEdgeMetadata | null;
};

export type DeckDocument = {
  id: string;
  name: string;
  promptTemplates: PromptTemplate[];
  nodes: AgentCardInstance[];
  edges: DeckEdge[];
  version: number;
};

export type DeckRunStatus = 'idle' | 'running' | 'success' | 'error' | 'skipped';

export type TaskContract = {
  id: string;
  task: string;
  purpose: string;
  constraints: string[];
  requiredOutput: {
    format: 'text' | 'json';
    schema?: Record<string, unknown>;
  };
  scoring: {
    passThreshold: number;
    hardChecks: string[];
    rubric: Array<{
      name: string;
      maxScore: number;
    }>;
  };
  context?: {
    userInput?: string;
    priorOutput?: string;
  };
};

export type AgentHandshake = {
  accepted: boolean;
  restatedTask: string;
  confirmedFormat: TaskContract['requiredOutput']['format'];
  notes: string[];
};

export type CardRunScoreDetail = {
  hardChecks: Array<{
    name: string;
    passed: boolean;
  }>;
  rubric: Array<{
    name: string;
    score: number;
    maxScore: number;
  }>;
  total: number;
  maxScore: number;
};

export type CardRunResult = {
  output: string | null;
  status: DeckRunStatus;
  error?: string;
  startedAt: string;
  endedAt: string;
  runtimeBinding?: RuntimeBinding | null;
  runtimeType?: AgentCardRuntimeType | null;
  seed?: string;
  contract?: TaskContract;
  handshake?: AgentHandshake;
  score?: number;
  passed?: boolean;
  scoreDetail?: CardRunScoreDetail;
  improvementPromptBit?: string;
  inputSummary?: string;
  outputSummary?: string;
};

export type DeckRuntimeEventKind =
  | 'run_started'
  | 'step_started'
  | 'step_completed'
  | 'step_skipped'
  | 'magentic_assignment'
  | 'swarm_progress'
  | 'message'
  | 'run_completed';

export type DeckRuntimeMessageRole = 'assistant' | 'tool' | 'user';

export type DeckRuntimeEvent = {
  id: string;
  at: string;
  kind: DeckRuntimeEventKind;
  type?: 'message' | null;
  cardId?: string | null;
  cardTitle?: string | null;
  runtimeType?: AgentCardRuntimeType | null;
  edgeIds?: string[];
  text?: string | null;
  role?: DeckRuntimeMessageRole | null;
  content?: string | null;
  progressText?: string | null;
  notes?: string[];
  status?: DeckRunStatus | null;
  outputSummary?: string | null;
  completedWorkers?: number | null;
  totalWorkers?: number | null;
};

export type DeckRunStep = {
  id: string;
  executionId: string;
  cardId: string;
  templateId: string;
  title: string;
  input: string;
  runtimeBinding?: RuntimeBinding | null;
  runtimeType?: AgentCardRuntimeType | null;
  effectiveAgent: AgentTemplate;
  output: string | null;
  status: DeckRunStatus;
  error?: string;
  startedAt: string;
  endedAt: string;
  seed?: string;
  contract?: TaskContract;
  handshake?: AgentHandshake;
  score?: number;
  passed?: boolean;
  scoreDetail?: CardRunScoreDetail;
  improvementPromptBit?: string;
  inputSummary?: string;
  outputSummary?: string;
  routeInfo?: {
    mergeIntent?: DeckEdgeMergeIntent | 'legacy_default' | null;
    inputMode?: 'legacy_text' | 'single_upstream' | 'structured_merge' | null;
    notes?: string[];
    inputSources?: Array<{
      edgeId: string;
      sourceCardId: string;
      sourceTitle: string;
      executionMode?: DeckEdgeExecutionMode | 'legacy_default' | null;
      output?: string | null;
    }>;
  } | null;
};

export type DeckRun = {
  id: string;
  deckId: string;
  startedAt: string;
  endedAt?: string;
  status: DeckRunStatus;
  input: string;
  error?: string;
  steps: DeckRunStep[];
  validationSummary: {
    ok: boolean;
    errors: string[];
    warnings: string[];
  };
  events?: DeckRuntimeEvent[];
  executionPlanSummary: {
    startCardIds: string[];
    simpleOrderCardIds: string[];
    expandedStepIds: string[];
  };
};

export type V3RevisionMeta = {
  revision: string;
  savedAt: string | null;
};

export type V3ProjectBlobMeta = {
  decks: Record<string, V3RevisionMeta>;
};

export type V3ProjectBlob = {
  decks: Record<string, DeckDocument>;
  deckRuns: Record<string, DeckRun[]>;
  hiddenTelemetry: Record<string, unknown>;
  meta: V3ProjectBlobMeta;
};
