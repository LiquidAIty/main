export type PromptTemplate = {
  id: string;
  content: string;
};

export type RuntimeBinding =
  | 'assist'
  | 'local_coder'
  | 'main_chat'
  | 'research_agent'
  | 'plan_agent'
  | 'worldsignals_agent'
  | 'trading_agent'
  | 'hermes_steward';

export type AgentCardRuntimeType =
  | 'assistant_agent'
  | 'magentic_one'
  | 'local_coder';

// flow = ORANGE direct parent→subagent; magentic_option = BLUE side worker
// slot; magentic_control = BLUE dedicated top control input (submit the
// finalized prompt to Mag One — never worker membership).
// 'invalid' is a real persisted classification, not an error case: an edge whose
// type we do not recognise must stay visible and inert. Folding it into 'flow'
// (the old default) silently handed invocation authority to malformed data.
export type DeckEdgeType = 'magentic_option' | 'magentic_control' | 'flow' | 'hermes_observe' | 'invalid';

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
  loopMaxIterations?: number | null;
  loopExitText?: string | null;
};

export type AssistExecutionMode = 'single' | 'swarm';

export type AgentCardRuntimeOptions = {
  // 'local_openai_compatible' = a local SLM served over an OpenAI-compatible endpoint.
  provider?: 'openai' | 'openrouter' | 'local_openai_compatible' | null;
  executionBackend?: 'python_autogen' | null;
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
  localCoderMode?: 'headless' | 'terminal' | null;
  localCoderAccess?: 'read' | 'patch' | 'test' | null;
  role?: string | null;
  tools?: string[] | null;
  /** Card-assigned NATIVE tool names for this agent's own session (e.g.
   * ['Agent'] for Main's doorway-only surface). Filtered by the engine BEFORE
   * provider schema serialization; null = no declaration (legacy full pool). */
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
  tools?: string[];
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
  sourceHandle?: string | null;
  target: string;
  targetHandle?: string | null;
  edgeType?: DeckEdgeType | null;
  metadata?: DeckEdgeMetadata | null;
};

export type DeckViewport = {
  x: number;
  y: number;
  zoom: number;
};

export type DeckDocument = {
  id: string;
  name: string;
  workspaceRoot?: string | null;
  promptTemplates: PromptTemplate[];
  nodes: AgentCardInstance[];
  edges: DeckEdge[];
  // Deprecated: Agent Canvas intentionally ignores persisted viewport.
  viewport?: DeckViewport | null;
  systemToolGrantsVersion?: number;
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
  /** Opaque historical data retained during normal saves. No active route
   * creates or interprets these retired deck-run records. */
  deckRuns: Record<string, unknown[]>;
  hiddenTelemetry: Record<string, unknown>;
  meta: V3ProjectBlobMeta;
};
