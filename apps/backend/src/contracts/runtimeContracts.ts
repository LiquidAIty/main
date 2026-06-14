export type DeckRunStatus = 'idle' | 'running' | 'success' | 'error' | 'skipped';
export type CoderTaskStatus = 'started' | 'queued' | 'running' | 'completed' | 'failed' | 'blocked';
export type CoderTaskDeliveryStatus = 'accepted' | 'queued' | 'blocked';

// T001: canonical typed description of a tool the runtime may expose. The
// agent card Tools tab is the only source of selected tool access; unknown,
// disabled, unselected, empty, or schema-missing tools fail loudly.
export type ToolSpec = {
  name: string;
  description: string;
  enabled: boolean;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
};

export const RUNTIME_TOOL_SPECS: ToolSpec[] = [
  {
    name: 'current_datetime',
    description: 'Return the current UTC date and time in ISO-8601 format.',
    enabled: true,
    inputSchema: { type: 'object', properties: {}, required: [] },
    outputSchema: { type: 'string', description: 'ISO-8601 UTC datetime' },
  },
  {
    name: 'calculator',
    description: 'Evaluate a basic arithmetic expression and return the numeric result.',
    enabled: true,
    inputSchema: {
      type: 'object',
      properties: { expression: { type: 'string' } },
      required: ['expression'],
    },
    outputSchema: { type: 'string', description: 'numeric result as a string' },
  },
  {
    name: 'coder_console_task',
    description: 'Send one bounded coding task to the owned Code Console backend.',
    enabled: true,
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        target_root: { type: 'string' },
        goal: { type: 'string' },
        prompt: { type: 'string' },
        edit_mode: { type: 'string', default: 'read_only' },
        session_id: { type: ['string', 'null'] },
      },
      required: ['project_id', 'target_root', 'goal'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['started', 'queued', 'running', 'completed', 'failed', 'blocked'],
        },
        session_id: { type: ['string', 'null'] },
        target_root: { type: 'string' },
        provider: { type: ['string', 'null'] },
        model: { type: ['string', 'null'] },
        transport: { type: ['string', 'null'] },
        watch_surface: { type: 'string' },
        message: { type: 'string' },
        delivery_status: { type: 'string', enum: ['accepted', 'queued', 'blocked'] },
        blocker: { type: ['string', 'null'] },
      },
    },
  },
];

export type CardRunResult = {
  output: string | null;
  status: DeckRunStatus;
  error?: string;
  startedAt: string;
  endedAt: string;
  runtimeBinding?: string | null;
  runtimeType?: string | null;
  seed?: string;
  inputSummary?: string;
  outputSummary?: string;
  structuredPlan?: Record<string, unknown> | null;
  magenticTrace?: Record<string, unknown> | null;
  graphViewContract?: Record<string, unknown> | null;
};

export type DeckExecutionInput = {
  deckId: string;
  deckName?: string;
  projectId?: string;
  userInput: string;
  cards: any[];
  edges: any[];
  templates: any[];
  onRuntimeEvent?: (event: any) => void;
};

export type DeckExecutionOutput = {
  id: string;
  deckId: string;
  input: string;
  status: 'running' | 'success' | 'error' | 'skipped';
  startedAt: string;
  endedAt: string;
  cardResults: Record<string, CardRunResult>;
  finalOutput?: string;
  error?: string;
  steps?: any[];
  events?: any[];
  mission?: any;
  workspaceContext?: any;
  workspaceObjectContext?: any;
  validationSummary?: any;
  executionPlanSummary?: any;
  graphViewContract?: any;
  codegraphViewContract?: any;
};

export type RuntimeScope = {
  projectId: string;
  deckId: string;
  magenticCardId: string;
  visibleNodeIds: string[];
  visibleEdgeIds: string[];
  resolvedMagenticOptionIds: string[];
  selectedWorkflowNodeIds: string[];
  pythonWorkerIds: string[];
  calledAgentIds: string[];
  excludedAgentIds: Array<{ id: string; reason: string }>;
  routingDiagnostics?: MagOneRoutingDiagnostics;
};

export type MagOneWorkflowType = 'coding' | 'general';

export type MagOneRoutingAgent = {
  id: string;
  title: string;
  role: string;
  reason: string;
};

export type MagOneRoutingDiagnostics = {
  projectId: string;
  deckId: string;
  workflowType: MagOneWorkflowType;
  eligibleBusConnectedAgents: MagOneRoutingAgent[];
  selectedExecutionPath: MagOneRoutingAgent[];
  ignoredEligibleAgents: MagOneRoutingAgent[];
  disconnectedAgentsIgnored: MagOneRoutingAgent[];
  missingRequiredAgents: string[];
  blockedReason: string | null;
};

export type RuntimeGraphNode = {
  cardId: string;
  title: string;
  kind: string;
  runtimeType: string;
  parentGraphId: string | null;
  prompt: string;
  role: string | null;
  tools: string[];
  fanOut: Record<string, any> | null;
  isSocietyOfMind: boolean;
  provider: string | null;
  providerModelId: string | null;
  temperature: number | null;
  maxTokens: number | null;
};

export type RuntimeGraphEdge = {
  id: string;
  source: string;
  target: string;
  edgeType: 'flow' | 'magentic_option';
  loop: Record<string, any> | null;
  data: Record<string, any>;
};

export type RuntimeGraph = {
  nodes: RuntimeGraphNode[];
  edges: RuntimeGraphEdge[];
};

export type PythonAutoGenPayloadShape = {
  session: Record<string, any>;
  userText: string;
  priorAssistantText: string;
  systemPrompt: string;
  plan?: Record<string, any>;
  thinkGraph?: Record<string, any>;
  knowGraph?: Record<string, any>;
  blackboard?: Record<string, any>;
  workspaceObjectContext?: Record<string, any>;
  cardRuntime: {
    cardId: string;
    title: string;
    runtimeType: string;
    prompt: string;
    runtimeOptions: Record<string, any>;
    graph: RuntimeGraph;
    participants: any[];
    privateParticipants?: any[];
    runtimeScope?: RuntimeScope;
  };
};

export type ResearchPackStatus = 'shaping' | 'ready_to_plan_research' | 'exhausted';

export type ResearchPack = {
  status: ResearchPackStatus;
  domainFocus: string;
  sourcesFound: string[];
  suggestedDeliverables: string[];
  suggestedEvidenceCuration: string;
};

export type SearchSwarmPlanStatus = 'drafting' | 'ready_for_approval' | 'approved' | 'running' | 'done';

export type SearchSwarmPlan = {
  status: SearchSwarmPlanStatus;
  approved: boolean;
  swarmWorkers: Array<{
    id: string;
    goal: string;
    expectedDeliverables: string[];
    sources: string[];
  }>;
};

export type ResearchEvidenceObject = {
  id: string;
  source: string;
  content: string;
  confidence: number;
};
