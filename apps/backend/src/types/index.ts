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
// 'invalid' is a real persisted classification, not an error case: an edge whose
// type we do not recognise must stay visible and inert. Folding it into 'flow'
// (the old default) silently handed invocation authority to malformed data.
export type DeckEdgeType = 'magentic_option' | 'magentic_control' | 'flow' | 'invalid';

export type AgentCardRuntimeOptions = {
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
      mode?: 'context_preflight' | 'model_callable' | 'handoff';
      inputSchema?: Record<string, unknown>;
      outputSchema?: Record<string, unknown>;
      toolHandles?: string[];
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
  /** How a Hermes Card resolves LiquidAIty tools at Run start. `all_healthy`
   * materializes all current public reads plus explicitly selected writes. */
  toolCatalogPolicy?: 'selected' | 'all_healthy' | null;
  /** Durable user-off exceptions. Catalog entries remain visible in IDD. */
  disabledTools?: string[] | null;
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
