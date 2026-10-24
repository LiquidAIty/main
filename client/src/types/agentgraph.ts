/**
 * Entity: Saved Cards
 * Relationship: This file defines the client-side saved deck, immutable Card revision identity, and saved Card configuration types consumed by the Canvas and editor.
 * Entity: Card Topology
 * Relationship: This file defines saved Card placement and the explicit flow, magentic_option, and invalid edge classifications rendered by the Canvas.
 * Entity: Bot Mode Delegation
 * Relationship: This file defines the saved orchestrator setting and directed orange flow edge used for Card-to-Card authority.
 * Entity: Magnetic TaskGraph
 * Relationship: This file defines blue magentic_option worker membership independently from orange delegation authority.
 * Entity: Hermes Profiles
 * Relationship: This file defines the saved Hermes mode, profile, provider, model, subagent, skill, toolset, and MCP selections edited for a Card.
 * Entity: Card Scripts
 * Relationship: This file transports the versioned saved Card Script source and Python-owned execution state while Agent Builder presents only the editable source.
 */

export type PromptTemplate = {
  id: string;
  content: string;
};

export type CardRuntime = {
  kind: 'hermes';
  mode: 'main' | 'delegate' | 'magentic_one';
  profile: string;
};

// flow = ORANGE saved-Card orchestrator authority; magentic_option = BLUE Magnetic
// task-ledger worker availability, independent of endpoint order. Blue
// topology never starts or controls Magnetic.
// Mirrors the backend contract: an unrecognised edge is classified 'invalid' and
// stays inert/visible, never silently promoted to a direct-Agent connection.
export type DeckEdgeType = 'magentic_option' | 'flow' | 'invalid';

export type AgentCardRuntimeOptions = {
  /** Saved outbound orange Card-to-Card delegation authority. Main has this
   * authority by its runtime role; another non-Magnetic Card must opt in. */
  orchestrator?: boolean;
  /** Temporary Hermes children for one Card turn. This is unrelated to
   * orange saved-Card orchestration and Magnetic's blue saved-worker roster. */
  subagentType?: 'none' | 'leaf' | 'recursive';
  /** Product-neutral, Card-owned structured settings consumed by the bound
   * runtime/domain adapter. The receiving Card's IDF carries this exact value. */
  configuration?: Record<string, unknown> | null;
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
  } | null;
  // 'local_openai_compatible' = a local SLM served over an OpenAI-compatible endpoint.
  provider?: 'openai' | 'openrouter' | 'local_openai_compatible' | null;
  accessMode?: 'chatgpt-account' | 'openai-api' | 'openrouter-api' | null;
  modelKey?: string | null;
  providerModelId?: string | null;
  /** Let one Run-scoped Jev Choice select among eligible configured models.
   * The saved model remains the durable default and is never overwritten. */
  autoModel?: boolean;
  /** Let one Run-scoped Jev request narrow this Card's own authorized tools.
   * It never grants tools or changes the saved selection. */
  autoTools?: boolean;
  /** Saved desired model for bounded Hermes delegated children and
   * background skill review. Hermes profile/readback remains effective truth. */
  subagentModel?: {
    provider: string;
    accessMode: 'chatgpt-account' | 'openai-api' | 'openrouter-api';
    modelKey: string;
    providerModelId: string;
  } | null;
  reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra' | null;
  tools?: string[] | null;
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
  tools: string[];
};

export type AgentCardInstance = {
  id: string;
  /** Saved Card availability. */
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
  runtimeOptions?: AgentCardRuntimeOptions | null;
  parentGraphId?: string | null;
  title: string;
  subtitle?: string;
  position: { x: number; y: number };
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
  nodes: AgentCardInstance[];
  edges: DeckEdge[];
  version: number;
};

export type KnowledgeGraphKind = 'thinkgraph' | 'knowgraph';
