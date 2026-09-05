export type PromptTemplate = {
  id: string;
  content: string;
};

export type CardRuntime =
  | {
      kind: 'hermes';
      mode: 'main' | 'delegate' | 'kanban';
      profile: string;
    }
  | {
      kind: 'autogen';
      mode: 'assistant' | 'magentic_one';
    };

// flow = ORANGE explicit saved Card→Card authority; magentic_option = BLUE side worker
// slot; magentic_control = BLUE dedicated top control input (submit the
// finalized prompt to Mag One — never worker membership).
// Mirrors the backend contract: an unrecognised edge is classified 'invalid' and
// stays inert/visible, never silently promoted to a directional Call.
export type DeckEdgeType = 'magentic_option' | 'magentic_control' | 'flow' | 'invalid';

export type CardSubsystemCapability =
  | 'state'
  | 'events'
  | 'commands'
  | 'artifacts'
  | 'readiness';

/** A saved, product-neutral attachment from one Card to a Python-managed
 * subsystem. The subsystem keeps its native lifecycle; this declaration only
 * exposes the bounded adapter contract and its named Card tab. */
export type CardSubsystemAttachment = {
  id: string;
  label: string;
  adapter: {
    kind: 'python';
    contractVersion: 'card-subsystem.v1';
    capabilities: CardSubsystemCapability[];
  };
  cardTab: { enabled: boolean };
  configurationSchema?: string | null;
};

export type AgentCardRuntimeOptions = {
  /** Saved authority to invoke connected Hermes delegate Cards. */
  profileDelegationEnabled?: boolean;
  /** Product-neutral, Card-owned structured settings consumed by the bound
   * runtime/domain adapter. The receiving Card's IDF carries this exact value. */
  configuration?: Record<string, unknown> | null;
  subsystems?: CardSubsystemAttachment[] | null;
  script?: {
    enabled: boolean;
    source: string;
    version: number;
    author?: Record<string, string>;
    sourceHash?: string;
    compiledHash?: string;
    paletteFingerprint?: string;
    compiled?: {
      schemaVersion?: string;
      mode?: 'tool_recipe';
      inputSchema?: Record<string, unknown>;
      outputSchema?: Record<string, unknown>;
      toolHandles?: string[];
      toolStates?: Record<string, number>;
      offToolIds?: string[];
      scriptToolIds?: string[];
      agentToolIds?: string[];
      timeoutSeconds?: number;
      maxToolCalls?: number;
      maxOutputBytes?: number;
      outputEmitCalls?: number;
      compiledHash?: string;
    };
    lastValidation?: Record<string, unknown>;
    nativeSupport?: Record<string, unknown>;
    rollback?: Record<string, unknown>;
  } | null;
  // 'local_openai_compatible' = a local SLM served over an OpenAI-compatible endpoint.
  provider?: 'openai' | 'openrouter' | 'local_openai_compatible' | null;
  accessMode?: 'chatgpt-account' | 'openai-api' | 'openrouter-api' | null;
  modelKey?: string | null;
  providerModelId?: string | null;
  /** Saved desired model for bounded native Hermes delegated children and
   * background skill review. Native profile/readback remains effective truth. */
  subagentModel?: {
    provider: string;
    accessMode: 'chatgpt-account' | 'openai-api' | 'openrouter-api';
    modelKey: string;
    providerModelId: string;
  } | null;
  /** Saved Card-owned defaults and ceilings for native Hermes Team. Hermes
   * chooses whether and when to invoke Team; Python Script cannot invoke it. */
  team?: {
    mode: 'off' | 'auto';
    maxWorkers: 2 | 3 | 4;
    retryLimit: number;
    workerModel: {
      provider: string;
      accessMode: 'chatgpt-account' | 'openai-api' | 'openrouter-api';
      modelKey: string;
      providerModelId: string;
    };
    leadModel: {
      provider: string;
      accessMode: 'chatgpt-account' | 'openai-api' | 'openrouter-api';
      modelKey: string;
      providerModelId: string;
    };
  } | null;
  reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh' | null;
  temperature?: number | null;
  maxTokens?: number | null;
  maxTurns?: number | null;
  tools?: string[] | null;
  /** `all_healthy` resolves all public reads plus explicitly selected writes. */
  toolCatalogPolicy?: 'selected' | 'all_healthy' | null;
  /** Durable off switches; disabled tools stay visible in the catalog. */
  disabledTools?: string[] | null;
  /** Runtime-specific native grants remain distinct from ordinary tool grants. */
  nativeTools?: string[] | null;
  /** Saved skill identities. Runtime homes materialize/cache them separately. */
  skills?: string[] | null;
  /** Named capability bundles; resolution belongs to the owning runtime. */
  toolsets?: string[] | null;
  /** References to globally configured MCP connections; never credentials. */
  mcpConnectionIds?: string[] | null;
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
};

export type AgentCardInstance = {
  id: string;
  /** Current server-owned immutable revision identity returned with a loaded deck. */
  _cardRevisionId?: string;
  _cardRevision?: number;
  _cardRevisionSha256?: string;
  kind?: DeckNodeKind;
  templateId: string;
  /** Stable LiquidAIty Card-to-Card capability description. */
  role?: string | null;
  prompt?: string | null;
  /** LiquidAIty-owned result validation/presentation contract. */
  outputContract?: unknown;
  runtime: CardRuntime;
  runtimeOptions?: AgentCardRuntimeOptions | null;
  parentGraphId?: string | null;
  tools?: string[];
  title: string;
  subtitle?: string;
  position: { x: number; y: number };
  overrides?: Partial<AgentTemplate>;
  status?: 'idle' | 'ready' | 'running' | 'error';
};

export type DeckEdge = {
  id: string;
  source: string;
  sourceHandle?: string | null;
  target: string;
  targetHandle?: string | null;
  edgeType?: DeckEdgeType | null;
  enabled?: boolean;
};

export type DeckDocument = {
  id: string;
  name: string;
  workspaceRoot?: string | null;
  promptTemplates: PromptTemplate[];
  nodes: AgentCardInstance[];
  edges: DeckEdge[];
  version: number;
};

export type KnowledgeGraphKind = 'thinkgraph' | 'knowgraph' | 'codegraph';
