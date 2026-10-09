export type PromptTemplate = {
  id: string;
  content: string;
};

export type CardRuntime = {
  kind: 'hermes';
  mode: 'main' | 'delegate' | 'magentic_one';
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

export type SavedCardConfiguration = {
  autoTools?: boolean;
  autoModel?: boolean;
  /** Legacy-compatible Card availability persisted inside runtime options. */
  enabled?: boolean;
  /** Saved outbound orange Card-to-Card delegation authority. Main has this
   * authority by its runtime role; another non-Magnetic Card must opt in. */
  orchestrator?: boolean;
  /** Temporary Hermes children for one Card turn. This is unrelated to
   * orange saved-Card orchestration and Magnetic's blue saved-worker roster. */
  subagentType?: 'none' | 'leaf' | 'recursive';
  /** Product-neutral, Card-owned structured settings consumed by the bound
   * Python/Hermes capability. The receiving Card's IDF carries this exact value. */
  configuration?: Record<string, unknown> | null;
  subsystems?: CardSubsystemAttachment[] | null;
  script?: {
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
  } | null;
  // 'local_openai_compatible' = a local SLM served over an OpenAI-compatible endpoint.
  provider?: 'openai' | 'openrouter' | 'local_openai_compatible' | null;
  accessMode?: 'chatgpt-account' | 'openai-api' | 'openrouter-api' | null;
  modelKey?: string | null;
  providerModelId?: string | null;
  openaiRuntime?: 'codex_app_server' | null;
  /** Saved desired model for bounded Hermes delegated children and
   * background skill review. Hermes profile/readback remains effective truth. */
  subagentModel?: {
    provider: string;
    accessMode: 'chatgpt-account' | 'openai-api' | 'openrouter-api';
    modelKey: string;
    providerModelId: string;
  } | null;
  tools?: string[] | null;
  /** Saved skill identities. Runtime homes materialize/cache them separately. */
  skills?: string[] | null;
  /** Named capability bundles; resolution belongs to the owning runtime. */
  toolsets?: string[] | null;
  /** References to globally configured MCP connections; never credentials. */
  mcpConnectionIds?: string[] | null;
};

export type DeckNodeKind = 'agent';

export type CardTemplate = {
  id: string;
  name: string;
  promptTemplate?: string | null;
  model?: string | null;
  provider?: string | null;
  tools: string[];
};

export type DeckCard = {
  id: string;
  /** Current top-level saved Card availability. */
  enabled?: boolean;
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
  runtimeOptions?: SavedCardConfiguration | null;
  parentGraphId?: string | null;
  tools?: string[];
  title: string;
  subtitle?: string;
  position: { x: number; y: number };
  overrides?: Partial<CardTemplate>;
  /** Legacy persisted display value. Run state comes from the Run ledger; new Cards omit this field. */
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
  projectCodeFolder?: string | null;
  promptTemplates: PromptTemplate[];
  nodes: DeckCard[];
  edges: DeckEdge[];
  version: number;
};
