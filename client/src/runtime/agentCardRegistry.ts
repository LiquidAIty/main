/**
 * Agent Card Registry v0 — Phase 1A
 *
 * Static definitions for the current LiquidAIty agent capabilities.
 * This is a UI-only registry. It does NOT modify AgentCardInstance,
 * DeckDocument, DeckEdge, INITIAL_DECK, or any runtime/backend type.
 *
 * Nothing imports this file in production yet.
 */
import { UA_AGENT_DEFINITIONS } from './uaAgentDefinitions';

/**
 * Agent kind in the bus architecture.
 *
 * - bus:       Central orchestrator (Sol / Magentic-One). Not a normal card.
 * - workbench: Owns a specialist canvas/surface. User opts in via Add Agent.
 * - core:      Headless capability. Always or often connected.
 * - signal:    Reads external data, feeds context to the bus.
 */
export type AgentCardKind = 'bus' | 'workbench' | 'core' | 'signal';
export type AgentKind = 'headless' | 'workbench';
export type AgentCapabilityStatus = 'implemented' | 'partial' | 'placeholder';

export type AgentSkill = {
  id: string;
  title: string;
  version: string;
  summary: string;
  role: string;
  instructions: readonly string[];
  inputs?: readonly string[];
  outputs?: readonly string[];
  tools?: readonly string[];
  knowledgeScopes?: readonly string[];
  objectKinds?: readonly string[];
  safetyRules?: readonly string[];
  evaluationHints?: readonly string[];
};

/**
 * Static definition for a known agent capability.
 * Computed at read time, never persisted in DeckDocument.
 */
type AgentCardDefBase = {
  /** Unique registry key. */
  id: string;

  /** Display name (user-facing). */
  name: string;

  /** One-line description for Add Agent palette and tooltips. */
  description: string;

  /** Classification. */
  kind: AgentCardKind;

  /**
   * Workspace surface this card owns, if any.
   * Must match a real workspaceView value or null for headless cards.
   * Cards with a surface can project a rail icon when connected.
   */
  ownedSurface: string | null;

  /** Whether this card can project a rail icon when connected to the bus. */
  railEligible: boolean;

  /** Whether execution requires plan/checkmark approval. */
  requiresPlanApproval: boolean;

  /** Whether this card is connected to the bus by default in a new project. */
  defaultConnected: boolean;

  /** Whether the capability has complete UI/runtime support or is still staged. */
  capabilityStatus: AgentCapabilityStatus;

  /** Whether this capability can safely run through the deck backend runtime. */
  runtimeSafe: boolean;

  /**
   * The runtimeType value this maps to in AgentCardRuntimeType.
   * Used to identify the card kind in existing deck logic.
  */
  runtimeType: string;

  /** Optional runtime binding used by staged deck templates. */
  runtimeBinding?: string | null;

  /** Optional staged deck template id used by Add Agent presets. */
  templateId?: string;

  /** Optional specialist skill identities surfaced in card configuration. */
  skills?: readonly string[];

  /** Canonical display title. Defaults to name during normalization. */
  title?: string;

  /** Canonical headless/workbench classification. */
  agentKind?: AgentKind;

  /** Canonical structured skill reference. */
  skillId?: string;

  /** Canonical structured skill payload. */
  skill?: AgentSkill;

  /** Icon alias for card consumers that do not use cardIcon. */
  icon?: string;

  /** Whether this card can be added from a palette. */
  addable?: boolean;

  /** Whether the card owns a UI panel/surface. */
  hasUi?: boolean;

  /** Whether the card owns a canvas-capable UI. */
  hasCanvas?: boolean;

  /** Shared UI engine for cards with a canvas/panel. */
  uiEngine?: string;

  /** Lens/mode opened inside the shared UI engine. */
  uiLens?: string;

  /** Card icon path for cards with UI. */
  cardIcon?: string;

  /** Rail icon path for cards with UI. */
  railIcon?: string;

  /** Existing rail icon path for cards that own a UI panel. */
  controlRailIcon?: string;

  /** Panel kind opened from the rail for UI-capable cards. */
  panelKind?: string;

  /** Canvas kind opened from the rail for UI-capable cards. */
  canvasKind?: string;

  /** Canonical workspace surface id, if the card owns one. */
  workspaceSurface?: string;

  /** Canonical workbench id, if the card owns one. */
  workbenchId?: string;

  /** Canonical tool ids this card may request. */
  toolIds?: readonly string[];

  /** Canonical knowledge scopes this card may read or contribute to. */
  knowledgeScopes?: readonly string[];

  /** Canonical object kinds this card can use as context. */
  objectKinds?: readonly string[];
};

export type AgentCardDef = AgentCardDefBase & {
  title: string;
  agentKind: AgentKind;
  skillId: string;
  skill: AgentSkill;
  icon?: string;
  addable: boolean;
  hasUi: boolean;
  hasCanvas: boolean;
  workspaceSurface?: string;
  workbenchId?: string;
  toolIds: readonly string[];
  knowledgeScopes: readonly string[];
  objectKinds: readonly string[];
};

const UA_TOOL_IDS: Record<string, readonly string[]> = {
  project_scanner: ['mcp', 'memory'],
  file_analyzer: ['mcp', 'memory'],
  architecture_analyzer: ['mcp', 'memory'],
  domain_analyzer: ['mcp', 'memory'],
  tour_builder: ['mcp', 'memory'],
  graph_reviewer: ['mcp', 'memory'],
  article_analyzer: ['mcp', 'memory'],
  assemble_reviewer: ['mcp', 'memory'],
  knowledge_graph_guide: ['mcp', 'memory'],
};

const UA_KNOWLEDGE_SCOPES: Record<string, readonly string[]> = {
  project_scanner: ['CodeGraph', 'KnowGraph'],
  file_analyzer: ['CodeGraph'],
  architecture_analyzer: ['CodeGraph', 'ThinkGraph'],
  domain_analyzer: ['ThinkGraph', 'KnowGraph'],
  tour_builder: ['CodeGraph', 'KnowGraph', 'Artifacts'],
  graph_reviewer: ['CodeGraph', 'ThinkGraph'],
  article_analyzer: ['KnowGraph', 'Artifacts'],
  assemble_reviewer: ['KnowGraph', 'Artifacts'],
  knowledge_graph_guide: ['KnowGraph'],
};

const UA_OBJECT_KINDS: Record<string, readonly string[]> = {
  project_scanner: ['project', 'directory', 'file'],
  file_analyzer: ['file', 'symbol', 'code_region'],
  architecture_analyzer: ['module', 'service', 'layer', 'dependency'],
  domain_analyzer: ['domain_concept', 'flow', 'step'],
  tour_builder: ['project', 'file', 'tour_step'],
  graph_reviewer: ['graph_node', 'graph_edge', 'validation_issue'],
  article_analyzer: ['article', 'concept', 'claim'],
  assemble_reviewer: ['article', 'summary', 'assembly'],
  knowledge_graph_guide: ['knowledge_graph', 'entity', 'relationship'],
};

function buildFallbackSkill(
  def: AgentCardDefBase,
  skillId: string,
  title: string,
  toolIds: readonly string[],
  knowledgeScopes: readonly string[],
  objectKinds: readonly string[],
): AgentSkill {
  return {
    id: skillId,
    title,
    version: '0.1.0',
    summary: def.description,
    role: `${title} capability for the LiquidAIty Agent Canvas.`,
    instructions: [
      def.description,
      'Use project context, selected object context, approved plans, and available artifacts before proposing work.',
      'Do not change persistent graph, plan, or artifact state unless the owning runtime explicitly approves that action.',
    ],
    tools: toolIds,
    knowledgeScopes,
    objectKinds,
    safetyRules: [
      'Preserve manual connect mode.',
      'Do not assume disconnected cards are active participants.',
    ],
  };
}

function inferAgentKind(def: AgentCardDefBase): AgentKind {
  if (def.agentKind) return def.agentKind;
  return def.kind === 'workbench' || def.kind === 'signal' ? 'workbench' : 'headless';
}

function inferToolIds(def: AgentCardDefBase): readonly string[] {
  if (def.toolIds) return def.toolIds;
  if (UA_TOOL_IDS[def.id]) return UA_TOOL_IDS[def.id];

  switch (def.id) {
    case 'sol':
      return ['openai.agent'];
    case 'assist':
      return ['openai'];
    case 'code':
      return ['mcp', 'python', 'memory'];
    case 'trading':
      return ['openai', 'memory'];
    case 'telescope':
      return ['scraper', 'memory'];
    case 'energy':
      return ['python', 'memory'];
    case 'image':
    case 'video':
      return ['openai'];
    case 'worldsignals':
      return ['scraper', 'memory'];
    case 'knowledge':
      return ['mcp', 'memory'];
    case 'plan':
    case 'validator':
      return ['memory'];
    default:
      return [];
  }
}

function inferKnowledgeScopes(def: AgentCardDefBase): readonly string[] {
  if (def.knowledgeScopes) return def.knowledgeScopes;
  if (UA_KNOWLEDGE_SCOPES[def.id]) return UA_KNOWLEDGE_SCOPES[def.id];

  switch (def.id) {
    case 'sol':
      return ['AgentCanvas', 'ThinkGraph', 'KnowGraph', 'Plan', 'Artifacts'];
    case 'assist':
      return ['ProjectEvents', 'Artifacts', 'SelectedObjectContext'];
    case 'code':
      return ['CodeGraph', 'Artifacts', 'SelectedObjectContext'];
    case 'worldsignals':
      return ['KnowGraph', 'ThinkGraph', 'Plan'];
    case 'knowledge':
      return ['ThinkGraph', 'KnowGraph', 'CodeGraph'];
    case 'plan':
      return ['Plan', 'ThinkGraph'];
    default:
      return ['Artifacts', 'SelectedObjectContext'];
  }
}

function inferObjectKinds(def: AgentCardDefBase): readonly string[] {
  if (def.objectKinds) return def.objectKinds;
  if (UA_OBJECT_KINDS[def.id]) return UA_OBJECT_KINDS[def.id];

  switch (def.id) {
    case 'sol':
      return ['agent_card', 'deck', 'message', 'artifact', 'selected_object'];
    case 'assist':
      return ['message', 'artifact', 'selected_object'];
    case 'code':
      return ['file', 'symbol', 'diagnostic', 'diff'];
    case 'trading':
      return ['market', 'ticker', 'position'];
    case 'telescope':
      return ['sky_region', 'image_tile', 'observation'];
    case 'energy':
      return ['building_model', 'simulation', 'energy_run'];
    case 'image':
      return ['image', 'prompt', 'placement'];
    case 'video':
      return ['storyboard', 'clip', 'timeline'];
    case 'worldsignals':
      return ['signal', 'briefing', 'world_event'];
    case 'knowledge':
      return ['entity', 'relationship', 'claim'];
    case 'plan':
      return ['plan', 'task', 'approval'];
    case 'validator':
      return ['result', 'test', 'diagnostic'];
    default:
      return [];
  }
}

function buildUaSkill(agent: (typeof UA_AGENT_DEFINITIONS)[number]): AgentSkill {
  const toolIds = UA_TOOL_IDS[agent.id] ?? ['mcp', 'memory'];
  const knowledgeScopes = UA_KNOWLEDGE_SCOPES[agent.id] ?? ['CodeGraph', 'KnowGraph'];
  const objectKinds = UA_OBJECT_KINDS[agent.id] ?? ['project', 'file'];

  return {
    id: agent.skillId,
    title: agent.name,
    version: '0.1.0',
    summary: agent.description,
    role: agent.prompt.role,
    instructions: [
      agent.prompt.goal,
      agent.prompt.proposalGuidance,
      `Open the shared Understand-Anything dashboard with the ${agent.uiLens} lens when the card is connected and focused.`,
    ],
    inputs: ['project context', 'selected object context', 'artifact context'],
    outputs: ['structured findings', 'review notes', 'dashboard lens state'],
    tools: toolIds,
    knowledgeScopes,
    objectKinds,
    safetyRules: [
      'Do not write graph persistence directly from this card.',
      'Do not create a separate dashboard for this UA lens.',
      'Do not participate until the card is connected to Magentic-One.',
    ],
    evaluationHints: [
      'Findings should be grounded in source files, artifacts, or graph context.',
      'UI focus should use the shared UA dashboard host and the configured lens.',
    ],
  };
}

function normalizeAgentCardDef(def: AgentCardDefBase): AgentCardDef {
  const title = def.title ?? def.name;
  const agentKind = inferAgentKind(def);
  const toolIds = inferToolIds(def);
  const knowledgeScopes = inferKnowledgeScopes(def);
  const objectKinds = inferObjectKinds(def);
  const skillId = def.skillId ?? def.skills?.[0] ?? `liquidaity.${def.id}`;
  const skill = def.skill ?? buildFallbackSkill(def, skillId, title, toolIds, knowledgeScopes, objectKinds);
  const hasUi = def.hasUi ?? (agentKind === 'workbench' && Boolean(def.ownedSurface));
  const hasCanvas = def.hasCanvas ?? hasUi;
  const workspaceSurface = def.workspaceSurface ?? (agentKind === 'workbench' ? def.ownedSurface ?? undefined : undefined);
  const workbenchId = def.workbenchId ?? (agentKind === 'workbench' ? def.uiEngine ?? def.ownedSurface ?? undefined : undefined);
  const icon = def.icon ?? def.cardIcon;

  return {
    ...def,
    title,
    agentKind,
    skillId,
    skill,
    icon,
    addable: def.addable ?? def.kind !== 'bus',
    hasUi,
    hasCanvas,
    workspaceSurface,
    workbenchId,
    toolIds,
    knowledgeScopes,
    objectKinds,
  };
}

const RAW_AGENT_CARD_REGISTRY: readonly AgentCardDefBase[] = [
  // ── Bus ──────────────────────────────────────────────────────────
  {
    id: 'sol',
    name: 'Sol',
    description: 'Central orchestrator and control spine (Magentic-One).',
    kind: 'bus',
    ownedSurface: null,
    railEligible: false,
    requiresPlanApproval: false,
    defaultConnected: true,
    capabilityStatus: 'implemented',
    runtimeSafe: true,
    runtimeType: 'magentic_one',
  },
  {
    id: 'assist',
    name: 'Assist',
    description: 'General-purpose response drafting and task support agent.',
    kind: 'core',
    ownedSurface: null,
    railEligible: false,
    requiresPlanApproval: false,
    defaultConnected: false,
    capabilityStatus: 'implemented',
    runtimeSafe: true,
    runtimeType: 'assistant_agent',
  },

  // ── Workbench agents (own a canvas) ──────────────────────────────
  {
    id: 'code',
    name: 'Code Agent',
    description: 'Local coder, Claude Code, browser coding workbench.',
    kind: 'workbench',
    ownedSurface: 'code',
    railEligible: true,
    requiresPlanApproval: true,
    defaultConnected: false,
    capabilityStatus: 'partial',
    runtimeSafe: false,
    runtimeType: 'local_coder',
  },
  {
    id: 'trading',
    name: 'Trading Agent',
    description: 'Trading UI and market analysis workbench.',
    kind: 'workbench',
    ownedSurface: 'trading',
    railEligible: true,
    requiresPlanApproval: true,
    defaultConnected: false,
    capabilityStatus: 'partial',
    runtimeSafe: false,
    runtimeType: 'assistant_agent',
  },
  {
    id: 'telescope',
    name: 'Telescope Agent',
    description: 'SkyView data pulling and deep-zoom tiling workbench.',
    kind: 'workbench',
    ownedSurface: 'telescope',
    railEligible: true,
    requiresPlanApproval: true,
    defaultConnected: false,
    capabilityStatus: 'partial',
    runtimeSafe: false,
    runtimeType: 'assistant_agent',
  },
  {
    id: 'energy',
    name: 'Energy Agent',
    description: 'NRGSim, 3D building, Pascal merge, EnergyPlus workbench.',
    kind: 'workbench',
    ownedSurface: 'energy',
    railEligible: true,
    requiresPlanApproval: true,
    defaultConnected: false,
    capabilityStatus: 'partial',
    runtimeSafe: false,
    runtimeType: 'assistant_agent',
  },
  {
    id: 'image',
    name: 'Image Maker Agent',
    description: 'Image generation, variation, and print-placement workbench.',
    kind: 'workbench',
    ownedSurface: 'image',
    railEligible: true,
    requiresPlanApproval: true,
    defaultConnected: false,
    capabilityStatus: 'partial',
    runtimeSafe: false,
    runtimeType: 'assistant_agent',
  },
  {
    id: 'video',
    name: 'Video Agent',
    description: 'Storyboard, clip assembly, and publish workflow workbench.',
    kind: 'workbench',
    ownedSurface: 'video',
    railEligible: true,
    requiresPlanApproval: true,
    defaultConnected: false,
    capabilityStatus: 'placeholder',
    runtimeSafe: false,
    runtimeType: 'assistant_agent',
  },

  // ── Understand-Anything specialist agents ───────────────────────
  ...UA_AGENT_DEFINITIONS.map(
    (agent): AgentCardDefBase => ({
      id: agent.id,
      name: agent.name,
      description: agent.description,
      kind: 'workbench',
      ownedSurface: agent.hasUi ? agent.surfaceId : null,
      railEligible: agent.hasUi,
      requiresPlanApproval: agent.requiresPlanApproval,
      defaultConnected: false,
      capabilityStatus: 'partial',
      runtimeSafe: true,
      runtimeType: 'assistant_agent',
      runtimeBinding: agent.runtimeBinding,
      templateId: agent.templateId,
      skills: agent.skills,
      title: agent.name,
      agentKind: 'workbench',
      skillId: agent.skillId,
      skill: buildUaSkill(agent),
      icon: agent.cardIcon,
      addable: agent.addable,
      hasUi: agent.hasUi,
      hasCanvas: agent.hasCanvas,
      uiEngine: agent.uiEngine,
      uiLens: agent.uiLens,
      cardIcon: agent.cardIcon,
      railIcon: agent.railIcon,
      controlRailIcon: agent.railIcon,
      panelKind: agent.panelKind,
      canvasKind: agent.canvasKind,
    }),
  ),

  // ── Signal agent ─────────────────────────────────────────────────
  {
    id: 'worldsignals',
    name: 'WorldSignals Agent',
    description: 'Signal ingestion and outside-world context behind the orb.',
    kind: 'signal',
    ownedSurface: 'worldsignal',
    railEligible: true,
    requiresPlanApproval: false,
    defaultConnected: false,
    capabilityStatus: 'implemented',
    runtimeSafe: false,
    runtimeType: 'assistant_agent',
  },

  // ── Core / headless agents ───────────────────────────────────────
  {
    id: 'plan',
    name: 'Plan Agent',
    description: 'Creates plan, drives checkmark approval flow.',
    kind: 'core',
    ownedSurface: 'plan',
    railEligible: true,
    requiresPlanApproval: false,
    defaultConnected: false,
    capabilityStatus: 'partial',
    runtimeSafe: true,
    runtimeType: 'assistant_agent',
  },
  {
    id: 'knowledge',
    name: 'Knowledge Agent',
    description: 'ThinkGraph, KnowGraph, and CodeGraph memory updates.',
    kind: 'core',
    ownedSurface: 'knowledge',
    railEligible: true,
    requiresPlanApproval: false,
    defaultConnected: false,
    capabilityStatus: 'implemented',
    runtimeSafe: true,
    runtimeType: 'assistant_agent',
  },
  {
    id: 'validator',
    name: 'Validator Agent',
    description: 'Validates code and agent outputs, scores results.',
    kind: 'core',
    ownedSurface: null,
    railEligible: false,
    requiresPlanApproval: false,
    defaultConnected: false,
    capabilityStatus: 'placeholder',
    runtimeSafe: false,
    runtimeType: 'assistant_agent',
  },
] as const;

export const AGENT_CARD_REGISTRY: readonly AgentCardDef[] = RAW_AGENT_CARD_REGISTRY.map(normalizeAgentCardDef);

/** Look up a card definition by registry id. */
export function getCardDef(id: string): AgentCardDef | undefined {
  return AGENT_CARD_REGISTRY.find((def) => def.id === id);
}

/** Return all card definitions matching a given kind. */
export function getCardDefsByKind(kind: AgentCardKind): AgentCardDef[] {
  return AGENT_CARD_REGISTRY.filter((def) => def.kind === kind);
}

/** Return all card definitions that are default-connected. */
export function getDefaultConnectedDefs(): AgentCardDef[] {
  return AGENT_CARD_REGISTRY.filter((def) => def.defaultConnected);
}

/** Return all card definitions that are rail-eligible. */
export function getRailEligibleDefs(): AgentCardDef[] {
  return AGENT_CARD_REGISTRY.filter((def) => def.railEligible);
}

/** Return all card definitions that require plan approval. */
export function getApprovalRequiredDefs(): AgentCardDef[] {
  return AGENT_CARD_REGISTRY.filter((def) => def.requiresPlanApproval);
}
