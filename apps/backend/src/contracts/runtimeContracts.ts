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
    name: 'read_thinkgraph_scope',
    description:
      'ThinkGraph card only: read the bounded active-project ThinkGraph scope (record ids, labels, kinds, provenance) so patches avoid duplicates. Read-only; project scope comes from the trusted card-run authority, never from the model.',
    enabled: true,
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'number', description: 'optional bounded record cap' } },
      required: [],
    },
    outputSchema: { type: 'string', description: 'JSON: bounded { nodes, edges } scope with provenance' },
  },
  {
    name: 'apply_thinkgraph_patch',
    description:
      'ThinkGraph card only: apply ONE compact graph patch (resources / relations / statements). Authority (project, card, run, source pair) comes from the trusted run context — model-supplied authority is rejected. One transaction, idempotent per run, complete source-pair provenance required.',
    enabled: true,
    inputSchema: {
      type: 'object',
      properties: {
        resources: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, label: { type: 'string' } }, required: ['id', 'label'] } },
        relations: { type: 'array', items: { type: 'object', properties: { a: { type: 'string' }, b: { type: 'string' } }, required: ['a', 'b'] } },
        statements: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, subject: { type: 'string' }, predicateTerm: { type: 'string' }, object: { type: 'string' }, rationale: { type: 'string' }, review: { type: 'string' } }, required: ['id', 'subject', 'predicateTerm', 'object'] } },
      },
      required: [],
    },
    outputSchema: { type: 'string', description: 'JSON: honest applied/duplicate/empty result with stored record refs' },
  },
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
        coding_run_id: { type: ['string', 'null'] },
        result_status_url: { type: ['string', 'null'] },
        workflow_option: { type: 'string', enum: ['run_read_only_coder_task', 'draft_spec_for_approval', 'plan_only'] },
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
  {
    // Transport-validation mirror only. The real tool (callable + retrieval
    // logic) lives solely in the Python Mag One registry
    // (apps/python-models tool_registry.py -> services/knowgraph hybrid_retrieval);
    // GET /tools/manifest is the source of truth. This entry lets the existing
    // card Tools selection validate and transport the selected ID to Python,
    // where the real AutoGen FunctionTool is resolved and attached.
    name: 'retrieve_knowgraph_context',
    description:
      'Retrieve a compact, project-scoped KnowGraph evidence slice (exact graph + full-text + ' +
      'vector). Read-only; returns source-backed assertions with outcomes, contradictions, and ' +
      'retrieval reasons. Does not run automatically; Mag One decides whether to call it.',
    enabled: true,
    inputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        query: { type: 'string' },
        anchors: { type: 'array', items: { type: 'string' } },
        task_id: { type: ['string', 'null'] },
        max_results: { type: 'integer', default: 12 },
        max_hops: { type: 'integer', default: 1 },
        include_outcomes: { type: 'array', items: { type: 'string' } },
        prior_assertion_ids: { type: 'array', items: { type: 'string' } },
        prior_source_refs: { type: 'array', items: { type: 'string' } },
      },
      required: ['project_id', 'query'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        anchors: { type: 'array' },
        retrieval_modes: { type: 'object' },
        assertions: { type: 'array' },
        evidence: { type: 'array' },
        relations: { type: 'array' },
        contradictions: { type: 'array' },
        uncertainties: { type: 'array' },
        next_anchor_suggestions: { type: 'array' },
        excluded_as_seen: { type: 'array' },
        retrieval_notes: { type: 'array' },
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
  magenticTrace?: Record<string, unknown> | null;
};

// ── AgentRunResult — the ONE normalized card-run report ─────────────────────
// Every card execution surface (direct Task-tab Single Assist run, Harness
// native card doorway via card.run_assistant_agent, Mag One worker delegation)
// reports through this same shape. It is a structural projection of the
// existing ConfiguredCardRunResult (cards/runtime.ts) — never a second
// execution report type and never inferred from model text.
export type AgentRunStatus = 'running' | 'succeeded' | 'partial' | 'failed' | 'cancelled';

export type AgentRunInvocation = 'single_assist' | 'mag_one_orchestrated';

export type AgentRunResult = {
  /** The run's correlationId — one identity across transport, Python, and storage. */
  runId: string;
  cardId: string;
  invocation: AgentRunInvocation;
  status: AgentRunStatus;
  /** The card's real final output text; empty on failure — never fabricated. */
  summary: string;
  error: string | null;
  /** Exact configured tools attached to the run (never inferred). */
  tools: string[];
  /** Mechanical count of authorized tool calls recorded during the run;
   * null when the run has no profile/terminal reporting for this. */
  toolCallCount: number | null;
  startedAt: string;
  endedAt: string;
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

// NOTE: there is intentionally no MagOneWorkflowType / intent / workflowType
// "coding | general" selector here. TypeScript does not classify the user's
// request — the real Python Magentic-One orchestrator owns that. The routing
// diagnostics/manifest below only *describe* which bus-connected agents exist
// and what they can do; they make no planning decision.

export type MagOneRoutingAgent = {
  id: string;
  title: string;
  role: string;
  reason: string;
};

export type MagOneRoutingDiagnostics = {
  projectId: string;
  deckId: string;
  eligibleBusConnectedAgents: MagOneRoutingAgent[];
  selectedExecutionPath: MagOneRoutingAgent[];
  ignoredEligibleAgents: MagOneRoutingAgent[];
  disconnectedAgentsIgnored: MagOneRoutingAgent[];
  missingRequiredAgents: string[];
  blockedReason: string | null;
};

export type MagOneRoutingManifest = {
  agents: Array<{
    cardId: string;
    kind: string;
    runtimeType: string;
    label: string;
    busConnected: boolean;
    role: string;
    capabilities: string[];
    tools: string[];
    requiredGates: string[];
    preferredIntents: string[];
    priority: number;
    blockedReason: string | null;
    defaultEditMode?: 'read_only';
    watchSurface?: 'Code Console';
    async?: boolean;
  }>;
};

export type MagOneCodingWorkflowPacket = {
  projectId: string;
  targetRoot: string;
  userGoal: string;
  intent: 'coding';
  selectedPrimaryAgent: string;
  selectedSupportAgents: string[];
  tool: 'coder_console_task';
  requiredGates: Array<{ name: string; status: 'available' | 'blocked' }>;
  compactSpec: string;
  asyncLifecycle: {
    dispatch: true;
    returnStartedStatus: true;
    provideCodingRunId: true;
    provideResultStatusUrl: true;
  };
  workflowOptions?: string[];
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
  routingManifest?: MagOneRoutingManifest;
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
