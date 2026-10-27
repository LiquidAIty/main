/**
 * Graph + less = more: less code that does the same work as more code is more useful.
 * Entity names the feature; Relationship explains why this file belongs and what it contributes.
 * Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
 * Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
 * Entity: Saved Cards
 * Relationship: This file defines the backend's canonical saved deck, immutable Card revision identity, and saved Card configuration transport types.
 * Entity: Card Topology
 * Relationship: This file defines saved Card placement and the explicit flow, magentic_option, and invalid edge classifications.
 * Entity: Agent Messaging
 * Relationship: This file defines the saved orchestrator setting and wire classifications used for Card-hosted agent reachability.
 * Entity: Magnetic Membership
 * Relationship: This file defines blue magentic_option membership as an additional deferred meaning on an otherwise messageable wire.
 * Entity: Card Profiles
 * Relationship: This file defines each saved Card's single runtime mode, profile, provider, model, subagent, skill, toolset, and MCP selections.
 * Entity: Card Scripts
 * Relationship: This file transports the versioned saved Card Script source and Python-owned execution state without making backend transport fields an editor surface.
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

// Every recognised enabled wire grants agent messaging reachability.
// magentic_option additionally records BLUE Magnetic membership; it starts no work.
// 'invalid' is a real persisted classification, not an error case: an edge whose
// type we do not recognise must stay visible and inert. Folding it into 'flow'
// (the old default) silently gave malformed data a valid relationship type.
export type DeckEdgeType = 'magentic_option' | 'flow' | 'invalid';

export type SavedCardConfiguration = {
  autoTools?: boolean;
  autoModel?: boolean;
  /** Saved outbound Card-to-Card authority for an ordinary agent Card. */
  orchestrator?: boolean;
  /** Temporary delegated children for one Card turn. */
  subagentType?: 'none' | 'leaf' | 'recursive';
  /** Product-neutral, Card-owned structured settings consumed by the bound
   * runtime capability. The receiving Card's IDF carries this exact value. */
  configuration?: Record<string, unknown> | null;
  script?: {
    enabled?: boolean;
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
  reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra' | null;
  /** Saved desired model for bounded delegated children and
   * background skill review. Profile readback remains effective truth. */
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
  /** Stable saved Card capability description. */
  role?: string | null;
  prompt?: string | null;
  /** LiquidAIty-owned result validation/presentation contract. */
  outputContract?: unknown;
  runtime: CardRuntime;
  runtimeOptions?: SavedCardConfiguration | null;
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
  nodes: DeckCard[];
  edges: DeckEdge[];
  version: number;
};
