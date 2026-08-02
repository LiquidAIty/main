export type PromptTemplate = {
  id: string;
  content: string;
};

export type RuntimeBinding =
  | 'assist'
  | 'local_coder'
  | 'openai_coder'
  | 'main_chat'
  | 'research_agent'
  | 'plan_agent'
  | 'worldsignals_agent'
  | 'trading_agent'
  | 'hermes_steward';

export type AgentCardRuntimeType =
  | 'assistant_agent'
  | 'magentic_one'
  | 'local_coder'
  | 'codex_app_server';

// flow = ORANGE direct parent→subagent; magentic_option = BLUE side worker
// slot; magentic_control = BLUE dedicated top control input (submit the
// finalized prompt to Mag One — never worker membership).
// Mirrors the backend contract: an unrecognised edge is classified 'invalid' and
// stays inert/visible, never silently promoted to a directional Call.
export type DeckEdgeType = 'magentic_option' | 'magentic_control' | 'flow' | 'invalid';

export type AgentCardRuntimeOptions = {
  // 'local_openai_compatible' = a local SLM served over an OpenAI-compatible endpoint.
  provider?: 'openai' | 'openrouter' | 'local_openai_compatible' | null;
  modelKey?: string | null;
  temperature?: number | null;
  maxTokens?: number | null;
  maxTurns?: number | null;
  tools?: string[] | null;
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
  // Schema marker for one-time system-card grant migrations. This is separate
  // from `version`, which is the normal deck edit counter.
  systemToolGrantsVersion?: number;
  version: number;
};

export type KnowledgeGraphKind = 'thinkgraph' | 'knowgraph' | 'codegraph';
