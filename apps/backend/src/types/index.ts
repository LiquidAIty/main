export type PromptTemplate = {
  id: string;
  content: string;
};

export type CardRuntime = {
  kind: 'hermes';
  mode: 'main' | 'delegate' | 'kanban' | 'magentic_one';
  profile: string;
};

// flow = ORANGE Main bot-team authority; magentic_option = BLUE Magnetic
// task-ledger worker availability. Blue never starts or controls Magnetic.
// 'invalid' is a real persisted classification, not an error case: an edge whose
// type we do not recognise must stay visible and inert. Folding it into 'flow'
// (the old default) silently handed invocation authority to malformed data.
export type DeckEdgeType = 'magentic_option' | 'flow' | 'invalid';

export type CardSubsystemCapability =
  | 'state'
  | 'events'
  | 'commands'
  | 'artifacts'
  | 'readiness';

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
  /** Temporary native Hermes children for one Card turn. This is unrelated to
   * orange saved-Card orchestration and Magnetic's blue saved-worker roster. */
  subagentType?: 'none' | 'leaf' | 'recursive';
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
  autoSelect?: boolean;
  autoTools?: boolean;
  openaiRuntime?: 'codex_app_server' | null;
  /** Saved desired model for bounded native Hermes delegated children and
   * background skill review. Native profile/readback remains effective truth. */
  subagentModel?: {
    provider: string;
    accessMode: 'chatgpt-account' | 'openai-api' | 'openrouter-api';
    modelKey: string;
    providerModelId: string;
  } | null;
  reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh' | null;
  temperature?: number | null;
  maxTokens?: number | null;
  maxTurns?: number | null;
  tools?: string[] | null;
  /** Saved skill identities. Runtime homes materialize/cache them separately. */
  skills?: string[] | null;
  /** Named capability bundles; resolution belongs to the owning runtime. */
  toolsets?: string[] | null;
  /** References to globally configured MCP connections; never credentials. */
  mcpConnectionIds?: string[] | null;
  /** Card-assigned NATIVE tool names for this agent's own session (e.g.
   * ['Agent'] for Main's doorway-only surface). Filtered by the engine BEFORE
   * provider schema serialization; null = no native-tool grant. */
  nativeTools?: string[] | null;
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

export type V3RevisionMeta = {
  revision: string;
  savedAt: string | null;
};

export type V3ProjectBlobMeta = {
  decks: Record<string, V3RevisionMeta>;
};

export type V3ProjectBlob = {
  decks: Record<string, DeckDocument>;
  meta: V3ProjectBlobMeta;
};
