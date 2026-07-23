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

export const AUTOGEN_CARD_TOOL_SPECS: ToolSpec[] = [
  {
    name: 'worldsignals.capabilities',
    description: 'Read the live WorldSignals capability and command manifests.',
    enabled: true,
    inputSchema: { type: 'object', properties: {}, required: [] },
    outputSchema: { type: 'object' },
  },
  {
    name: 'worldsignals.command',
    description: 'Run one real command from the live WorldSignals command manifest.',
    enabled: true,
    inputSchema: { type: 'object', properties: { command: { type: 'string' }, arguments: { type: 'object' } }, required: ['command'] },
    outputSchema: { type: 'object' },
  },
  {
    name: 'worldsignals.batch',
    description: 'Run up to twenty real WorldSignals commands through its batch channel.',
    enabled: true,
    inputSchema: { type: 'object', properties: { commands: { type: 'array', items: { type: 'object' }, maxItems: 20 } }, required: ['commands'] },
    outputSchema: { type: 'object' },
  },
  {
    name: 'worldsignals.poll',
    description: 'Poll completed command results and pending WorldSignals tasks.',
    enabled: true,
    inputSchema: { type: 'object', properties: {}, required: [] },
    outputSchema: { type: 'object' },
  },
  {
    name: 'worldsignals.stream_events',
    description: 'Read a bounded set of real-time events from the WorldSignals SSE channel.',
    enabled: true,
    inputSchema: { type: 'object', properties: { max_events: { type: 'integer', default: 1 }, timeout_seconds: { type: 'integer', default: 15 } }, required: [] },
    outputSchema: { type: 'object' },
  },
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
  {
    // Transport-validation mirror only. The real tool lives in the Python Mag One
    // registry (tool_registry.py run_local_coder -> POST /api/coder/localcoder/run).
    // The model supplies ONLY the logical coding task; the backend injects the
    // trusted repo root. This entry lets a card's Tools selection validate and
    // transport the id to Python.
    name: 'run_local_coder',
    description:
      'Run a real coding task through the LocalCoder engine and return its ' +
      'authoritative CoderReport. The coder root is injected server-side (never ' +
      'model-chosen); blocked/failed runs are reported honestly. Does not run ' +
      'automatically — the orchestrator/coder agent decides when to call it.',
    enabled: true,
    inputSchema: {
      type: 'object',
      properties: {
        objective: { type: 'string' },
        plan_excerpt: { type: 'string' },
        context_summary: { type: 'string' },
        guardrails: { type: 'array', items: { type: 'string' } },
        allowed_files: { type: 'array', items: { type: 'string' } },
        forbidden_work: { type: 'array', items: { type: 'string' } },
        proof_required: { type: 'array', items: { type: 'string' } },
        stop_conditions: { type: 'array', items: { type: 'string' } },
        code_anchors: { type: 'array', items: { type: 'string' } },
        cbm_queries: { type: 'array', items: { type: 'string' } },
        report_format: { type: 'string' },
        write_mode: { type: 'string', enum: ['read-only', 'edit'] },
        project_id: { type: 'string' },
      },
      required: ['objective'],
    },
    outputSchema: { type: 'object', description: 'authoritative CoderReport JSON' },
  },
  {
    // Transport-validation mirror only. The real tool lives in the Python Mag One
    // registry (tool_registry.py web_search -> Tavily search API). Read-only real
    // web search; the model selects sources, knowgraph.ingest persists them with
    // provenance. This entry lets a card's Tools selection validate the id.
    name: 'web_search',
    description:
      'Real web search via Tavily. Returns real result pages (url, title, domain, content ' +
      'excerpt, published date) for the agent to read and select. Read-only; never fabricates. ' +
      'Pair with knowgraph.ingest to persist selected real sources with provenance.',
    enabled: true,
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        max_results: { type: 'integer', default: 5 },
      },
      required: ['query'],
    },
    outputSchema: { type: 'string', description: 'JSON { ok, query, result_count, results[] } with source metadata' },
  },
];

// Harness/MCP bridge tools are transport capabilities, not card-local
// reasoning. They still need typed registration so saved-card grants can be
// validated without inventing a second tool registry in TypeScript.
export const HARNESS_MCP_TOOL_SPECS: ToolSpec[] = [];
for (const name of [
  'thinkgraph.get_graph_slice',
  'thinkgraph.submit_update',
  'agentgraph.create_context',
  'agentgraph.read_context',
  'agentgraph.expand_reference',
  'knowgraph.query',
  'knowgraph.ingest',
  'hermes.memory_read',
  'hermes.memory_write',
  'hermes.read_report',
  'hermes.write_report',
  'mag_one.describe_connected_agents',
  'write_mag_one_instructions',
  'read_model_results',
  'run_mag_one',
  'run_coder_subagent',
  'canvas.inspect',
  'card.run_assistant_agent',
  'web_search',
  'worldsignals.capabilities',
  'worldsignals.command',
  'worldsignals.batch',
  'worldsignals.poll',
  'worldsignals.stream_events',
]) {
  HARNESS_MCP_TOOL_SPECS.push({
    name,
    description: `LiquidAIty MCP bridge capability: ${name}.`,
    enabled: true,
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
  });
}

export const RUNTIME_TOOL_SPECS: ToolSpec[] = [
  ...AUTOGEN_CARD_TOOL_SPECS,
  ...HARNESS_MCP_TOOL_SPECS,
];

export type HermesReviewReport = {
  runId: string;
  verdict: string;
  recommendation: string;
  thinkGraphWrite:
    | {
        status: 'applied' | 'duplicate' | 'empty';
        correlationId: string;
        storedResourceIds: string[];
        storedStatementIds: string[];
      }
    | { status: 'blocked'; reason: string };
  activityCount: number;
};

// Job-folder handoff run outputs, threaded verbatim from the Python rails.
// Present only for a handoff run (a jobId was supplied); null otherwise.
export type JobHandoffRunResult = {
  returnsDir: string | null;
  returnedFiles: string[];
  returnStatus: 'return_files_created' | 'no_return_files_created' | null;
};

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
  jobHandoffResult?: JobHandoffRunResult | null;
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
  workspaceContext?: any;
  workspaceObjectContext?: any;
  validationSummary?: any;
};

export type RuntimeScope = {
  projectId: string;
  deckId: string;
  magenticCardId: string;
  visibleNodeIds: string[];
  visibleEdgeIds: string[];
  resolvedMagenticOptionIds: string[];
  pythonWorkerIds: string[];
  calledAgentIds: string[];
  excludedAgentIds: Array<{ id: string; reason: string }>;
};

// Removed: MagOneRoutingAgent / MagOneRoutingDiagnostics / MagOneRoutingManifest /
// MagOneCodingWorkflowPacket. TypeScript does not classify the request, rank
// agents, invent capabilities/gates, or manufacture a coder-dispatch packet.
// Bus connectivity (magentic_option edges) is the only activation signal; the
// Python orchestrator owns all planning.

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
  edgeType: 'flow' | 'magentic_option' | 'magentic_control';
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
  // Coder job-folder handoff: server-forced workspace root + shared job id. When
  // present, the Python run reads handoff/<jobId>/prompt.md as the exact Magnetic
  // One variable context packet and writes deliverables into returns/<jobId>/.
  jobHandoff?: { workspaceRoot: string; jobId: string };
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
