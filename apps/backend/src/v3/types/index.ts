export type PromptTemplate = {
  id: string;
  content: string;
};

export type RuntimeBinding = 'main_chat';

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

export type DeckEdgeMapping = {
  from: string;
  to: string;
};

export type AgentCardInstance = {
  id: string;
  templateId: string;
  runtimeBinding?: RuntimeBinding | null;
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
  routeType: 'default' | 'success' | 'error' | 'conditional';
  condition?: string;
  mapping?: DeckEdgeMapping[];
  priority?: number;
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

export type DeckRunStep = {
  id: string;
  executionId: string;
  cardId: string;
  templateId: string;
  title: string;
  input: string;
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
  executionPlanSummary: {
    startCardIds: string[];
    simpleOrderCardIds: string[];
    expandedStepIds: string[];
  };
};

export type V3ProjectBlob = {
  decks: Record<string, DeckDocument>;
  deckRuns: Record<string, DeckRun[]>;
  hiddenTelemetry: Record<string, unknown>;
};
