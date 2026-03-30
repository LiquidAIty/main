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

export type DeckNodeKind = 'agent' | 'blackboard';

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

export type V3BlackboardField =
  | 'current_goal'
  | 'what_matters_now'
  | 'open_questions'
  | 'findings'
  | 'suggestions'
  | 'next_options'
  | 'next_move';

export type AgentCardInstance = {
  id: string;
  kind?: DeckNodeKind;
  templateId: string;
  prompt?: string | null;
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
  seed?: string;
  contract?: TaskContract;
  handshake?: AgentHandshake;
  score?: number;
  passed?: boolean;
  scoreDetail?: CardRunScoreDetail;
  improvementPromptBit?: string;
  inputSummary?: string;
  outputSummary?: string;
  blackboardWrite?: V3Blackboard | null;
  blackboard?: V3Blackboard | null;
};

export type DeckRunStep = {
  id: string;
  executionId: string;
  cardId: string;
  templateId: string;
  title: string;
  input: string;
  runtimeBinding?: RuntimeBinding | null;
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
  blackboardWrite?: V3Blackboard | null;
  blackboard?: V3Blackboard | null;
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
  blackboard?: V3Blackboard | null;
  executionPlanSummary: {
    startCardIds: string[];
    simpleOrderCardIds: string[];
    expandedStepIds: string[];
  };
};

export type V3Blackboard = {
  store?: Record<string, string>;
  current_goal: string | null;
  what_matters_now: string[];
  open_questions: string[];
  findings: string[];
  suggestions: string[];
  next_options: string[];
  next_move: string | null;
  updated_at?: string | null;
};

export type V3ProjectBlob = {
  decks: Record<string, DeckDocument>;
  deckRuns: Record<string, DeckRun[]>;
  blackboard: V3Blackboard;
  hiddenTelemetry: Record<string, unknown>;
};
