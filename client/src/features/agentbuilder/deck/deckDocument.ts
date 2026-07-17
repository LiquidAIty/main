// Deck document logic: normalization, hydration, legacy upgrade,
// single-card-run scoping, and the Coder controller card normalization.
import type {
  AgentCardInstance,
  DeckDocument,
  DeckEdge,
  PromptTemplate,
} from '../../../types/agentgraph';
import { sanitizeDeckEdges } from '../../../components/builder/deckValidation';
import {
  cleanOptionalText,
  cloneDeckDocument,
  isLegacyUaCard,
  LOCAL_CODER_CONTROLLER_MODEL_KEY,
  LOCAL_CODER_CONTROLLER_PROVIDER,
  LOCAL_CODER_CONTROLLER_TOOLS,
  MAGENTIC_ONE_DEFAULT_MODEL_KEY,
  MAGENTIC_ONE_DEFAULT_PROVIDER,
  normalizeRuntimeBinding,
  normalizeRuntimeOptions,
  normalizeRuntimeType,
  safeText,
} from './deckPrimitives';
import {
  BASELINE_OPTIONAL_CARD_IDS,
  INITIAL_AGENT_TEMPLATES,
  INITIAL_DECK,
  INITIAL_PROMPT_TEMPLATES,
  LEGACY_SYSTEM_CARD_IDS,
  REMOVED_DEFAULT_CARD_IDS,
  REMOVED_DEFAULT_EDGE_IDS,
  SYSTEM_CARD_RUNTIME_BINDINGS,
} from './deckSeed';

export function isLocalCoderControllerCard(card: AgentCardInstance | null | undefined): boolean {
  if (!card) return false;
  return (
    safeText(card.id).trim().toLowerCase() === 'card_local_coder' ||
    safeText(card.runtimeBinding).trim().toLowerCase() === 'local_coder' ||
    safeText(card.runtimeType).trim().toLowerCase() === 'local_coder' ||
    safeText(card.templateId).trim().toLowerCase() === 'template_local_coder'
  );
}

export function normalizeLocalCoderControllerCard(card: AgentCardInstance): AgentCardInstance {
  if (!isLocalCoderControllerCard(card)) return card;
  const runtimeOptions = normalizeRuntimeOptions(card.runtimeOptions) ?? {};
  // Provider/model are the saved card's authority — no hardcoded default and no
  // model blacklist. Only identity (binding/type) and the run_local_coder tool
  // are normalized here; the card selects its own engine and model.
  return {
    ...card,
    runtimeBinding: 'local_coder',
    runtimeType: 'local_coder',
    runtimeOptions: {
      ...runtimeOptions,
      tools: Array.from(new Set([
        ...LOCAL_CODER_CONTROLLER_TOOLS,
        ...(Array.isArray(runtimeOptions.tools)
          ? runtimeOptions.tools.map((tool) => safeText(tool).trim()).filter(Boolean)
          : []),
      ])),
    },
  };
}

/**
 * Upgrade only the exact retired Magentic-One seed configuration. A user who
 * deliberately chose GLM keeps it; the uncustomized old default moves to the
 * Mag One's current card default on hydration.
 */
function normalizeRetiredMagenticOneDefault(card: AgentCardInstance): AgentCardInstance {
  if (card.id !== 'card_magentic' || card.templateId !== 'template_magentic') return card;
  const runtimeOptions = normalizeRuntimeOptions(card.runtimeOptions) ?? {};
  if (
    runtimeOptions.executionBackend !== 'python_autogen' ||
    runtimeOptions.provider !== 'openrouter' ||
    runtimeOptions.modelKey !== 'z-ai/glm-5.2' ||
    runtimeOptions.maxTurns !== 2 ||
    runtimeOptions.maxStalls !== 1
  ) {
    return card;
  }
  return {
    ...card,
    runtimeOptions: {
      ...runtimeOptions,
      provider: MAGENTIC_ONE_DEFAULT_PROVIDER,
      modelKey: MAGENTIC_ONE_DEFAULT_MODEL_KEY,
    },
  };
}

export function resolveLocalCoderControllerConsoleConfig(
  deck: Pick<DeckDocument, 'nodes'>,
): { provider: string; model: string } {
  const card = deck.nodes.find(isLocalCoderControllerCard) || null;
  const runtimeOptions = normalizeRuntimeOptions(card?.runtimeOptions) ?? {};
  const template =
    INITIAL_AGENT_TEMPLATES.find((candidate) => candidate.id === card?.templateId) ||
    INITIAL_AGENT_TEMPLATES.find((candidate) => candidate.id === 'template_local_coder') ||
    null;
  // Resolve from the saved card, then the template, then the seed default — no
  // blacklist, no forced override.
  return {
    provider:
      cleanOptionalText(runtimeOptions.provider) ||
      cleanOptionalText(template?.provider) ||
      LOCAL_CODER_CONTROLLER_PROVIDER,
    model:
      cleanOptionalText(runtimeOptions.modelKey) ||
      cleanOptionalText(template?.model) ||
      LOCAL_CODER_CONTROLLER_MODEL_KEY,
  };
}


/** Scope a deck document down to the ONE selected card for a Single Assist
 * run. The backend (`isSingleAssistRunDocument`) accepts exactly one top-level
 * node — the old flow-traversal scope produced multi-node documents the route
 * refused. Card identity/prompt/model/tools resolve server-side from the
 * SAVED deck; this document only names the card. */
export function buildSingleCardRunDocument(
  document: DeckDocument,
  cardId: string,
): DeckDocument | null {
  const selectedNode = document.nodes.find((node) => node.id === cardId);
  if (!selectedNode) return null;

  return {
    ...document,
    nodes: [selectedNode],
    edges: [],
  };
}

export function normalizeDeckNodes(value: unknown): AgentCardInstance[] {
  if (!Array.isArray(value)) {
    return cloneDeckDocument(INITIAL_DECK.nodes);
  }
  if (value.length === 0) {
    return [];
  }
  const nextNodes = value.filter((node): node is AgentCardInstance =>
    Boolean(
      node &&
      typeof node === 'object' &&
      !REMOVED_DEFAULT_CARD_IDS.has(
        safeText((node as Partial<AgentCardInstance>).id).trim(),
      ) &&
      safeText((node as Partial<AgentCardInstance>).kind)
        .trim()
        .toLowerCase() !== 'blackboard' &&
      typeof (node as AgentCardInstance).id === 'string' &&
      typeof (node as AgentCardInstance).templateId === 'string',
    ),
  );
  const normalizedNodes =
    nextNodes.length > 0
      ? nextNodes.map((node) => ({
        id: safeText(node.id).trim(),
        kind: 'agent' as const,
        templateId: safeText(node.templateId).trim(),
        prompt: typeof node.prompt === 'string' ? node.prompt : '',
        runtimeBinding: normalizeRuntimeBinding(
          node.runtimeBinding ??
            SYSTEM_CARD_RUNTIME_BINDINGS[safeText(node.id).trim()] ??
            null,
        ),
        runtimeType:
          normalizeRuntimeType(node.runtimeType) ?? 'assistant_agent',
        runtimeOptions: normalizeRuntimeOptions(node.runtimeOptions),
        parentGraphId: cleanOptionalText(node.parentGraphId),
        title:
          safeText(node.title || node.id).trim() || safeText(node.id).trim(),
        subtitle: typeof node.subtitle === 'string' ? node.subtitle : undefined,
        position:
          node.position && typeof node.position === 'object'
            ? {
                x: Number((node.position as { x?: unknown }).x) || 0,
                y: Number((node.position as { y?: unknown }).y) || 0,
              }
            : { x: 0, y: 0 },
        overrides: node.overrides,
        status:
          node.status === 'idle' ||
          node.status === 'ready' ||
          node.status === 'running' ||
          node.status === 'error'
            ? node.status
            : undefined,
        cloneConfig:
          node.cloneConfig && typeof node.cloneConfig === 'object'
            ? node.cloneConfig
            : undefined,
      }))
      : [];
  return normalizedNodes.filter((node) => !isLegacyUaCard(node));
}

export function normalizeDeckPromptTemplates(value: unknown): PromptTemplate[] {
  if (!Array.isArray(value)) {
    return cloneDeckDocument(INITIAL_PROMPT_TEMPLATES);
  }
  if (value.length === 0) {
    return [];
  }
  const nextPromptTemplates = value.filter(
    (template): template is PromptTemplate =>
      Boolean(
        template &&
        typeof template === 'object' &&
        typeof (template as PromptTemplate).id === 'string' &&
        typeof (template as PromptTemplate).content === 'string',
      ),
  );
  return nextPromptTemplates.length > 0
    ? cloneDeckDocument(nextPromptTemplates)
    : cloneDeckDocument(INITIAL_PROMPT_TEMPLATES);
}

export function normalizeDeckEdges(value: unknown): DeckEdge[] {
  if (!Array.isArray(value)) {
    return cloneDeckDocument(INITIAL_DECK.edges);
  }
  return cloneDeckDocument(
    sanitizeDeckEdges(value).filter(
      (edge) =>
        safeText(edge.id).trim() !== 'edge_magentic_thinkgraph' &&
        !REMOVED_DEFAULT_EDGE_IDS.has(safeText(edge.id).trim()),
    ),
  );
}

export function formatBuilderStatusMessage(
  message: unknown,
  fallback: string,
): string {
  const text = String(message || '').trim();
  const lower = text.toLowerCase();
  if (!text) return fallback;
  if (text === 'project_not_found')
    return 'Canvas data is unavailable for this selection.';
  if (text === 'deck_load_failed') return 'Canvas data could not be loaded.';
  if (text === 'deck_save_failed') return 'Could not save the current board.';
  if (text === 'card_run_failed') return 'Card run failed.';
  if (text === 'deck_run_failed') return 'Board run failed.';
  if (text === 'template_not_found')
    return 'The selected card template could not be resolved.';
  if (text === 'templates_required')
    return 'The selected card could not be run because its template set was missing.';
  if (text === 'card_required')
    return 'No card was provided to the backend run path.';
  if (
    lower.includes('insufficient_quota') ||
    lower.includes('quota exceeded') ||
    (lower.includes('quota') && lower.includes('billing'))
  ) {
    return 'The configured model could not run because provider quota or billing is unavailable right now.';
  }
  if (lower.includes('rate limit') || lower.includes('too many requests')) {
    return 'The configured model is rate-limited right now. Try this card again shortly.';
  }
  if (
    lower.includes('unauthorized') ||
    lower.includes('authentication') ||
    lower.includes('invalid api key') ||
    lower.includes('incorrect api key')
  ) {
    return 'The configured model request was rejected by the provider. Check the backend credentials for this card.';
  }
  if (
    lower.includes('failed to fetch') ||
    lower.includes('networkerror') ||
    lower.includes('econnrefused') ||
    lower.includes('load failed')
  ) {
    return 'The Builder backend is unavailable right now.';
  }
  if (lower.includes('timed out') || lower.includes('timeout')) {
    return 'The configured model timed out before the card completed.';
  }
  return text;
}

export function seedCurrentSystemCardsIntoLegacyDeck(
  deck: DeckDocument,
): DeckDocument {
  const legacyCompatibleNodeIds = new Set([
    ...Array.from(LEGACY_SYSTEM_CARD_IDS),
    ...Array.from(BASELINE_OPTIONAL_CARD_IDS),
  ]);
  const hasOnlyLegacySystemNodes =
    deck.nodes.length > 0 &&
    deck.nodes.some((node) => LEGACY_SYSTEM_CARD_IDS.has(node.id)) &&
    deck.nodes.every((node) => legacyCompatibleNodeIds.has(node.id));
  void hasOnlyLegacySystemNodes;
  if (!hasOnlyLegacySystemNodes) {
    return deck;
  }

  const existingNodesById = new Map(
    deck.nodes.map((node) => [node.id, node] as const),
  );
  const existingPromptTemplatesById = new Map(
    deck.promptTemplates.map((template) => [template.id, template] as const),
  );
  const initialPromptTemplateIds = new Set(
    INITIAL_PROMPT_TEMPLATES.map((template) => template.id),
  );
  const upgradedNodes: AgentCardInstance[] = INITIAL_DECK.nodes.map(
    (seedNode): AgentCardInstance => {
      const existingNode = existingNodesById.get(seedNode.id);
      if (!existingNode) {
        return cloneDeckDocument(seedNode);
      }

      const nextTitle =
        seedNode.id === 'card_research' &&
        String(existingNode.title || '').trim() === 'Research'
          ? seedNode.title
          : existingNode.title || seedNode.title;
      const nextSubtitle =
        seedNode.id === 'card_research' &&
        String(existingNode.subtitle || '').trim() === 'Gather upstream inputs'
          ? seedNode.subtitle
          : existingNode.subtitle || seedNode.subtitle;
      return {
        ...cloneDeckDocument(seedNode),
        ...cloneDeckDocument(existingNode),
        kind: 'agent',
        prompt:
          typeof (existingNode as any).prompt === 'string'
            ? (existingNode as any).prompt
            : seedNode.prompt || '',
        title: nextTitle,
        subtitle: nextSubtitle,
        runtimeBinding: normalizeRuntimeBinding(
          existingNode.runtimeBinding ?? seedNode.runtimeBinding ?? null,
        ),
        runtimeType: normalizeRuntimeType(
          existingNode.runtimeType ?? seedNode.runtimeType ?? 'assistant_agent',
        ),
        runtimeOptions: normalizeRuntimeOptions(
          existingNode.runtimeOptions ?? seedNode.runtimeOptions ?? null,
        ),
        parentGraphId: cleanOptionalText(
          existingNode.parentGraphId ?? seedNode.parentGraphId ?? null,
        ),
        position: existingNode.position || seedNode.position,
        overrides: existingNode.overrides,
        status: existingNode.status ?? seedNode.status,
        cloneConfig: existingNode.cloneConfig ?? seedNode.cloneConfig,
      };
    },
  );

  const upgradedPromptTemplates = [
    ...INITIAL_PROMPT_TEMPLATES.map((seedTemplate) =>
      cloneDeckDocument(
        existingPromptTemplatesById.get(seedTemplate.id) || seedTemplate,
      ),
    ),
    ...deck.promptTemplates
      .filter((template) => !initialPromptTemplateIds.has(template.id))
      .map((template) => cloneDeckDocument(template)),
  ];

  // Preserve persisted edge state; never infer/merge seed edges during hydration.
  // The retired authoring-compatibility filter also dropped edges that simply
  // didn't fit the graph_flow/parentGraphId model — that deleted real user
  // intent. The ONLY edges dropped here are ones this upgrade itself orphaned by
  // retiring their endpoint card; an edge to a node that no longer exists is a
  // dangling reference, not a decision. Edge TYPE is never judged: an
  // unrecognised type is classified 'invalid' (visible, authorises nothing).
  const upgradedNodeIds = new Set(upgradedNodes.map((node) => node.id));
  const nextEdges = deck.edges
    .filter((edge) => upgradedNodeIds.has(edge.source) && upgradedNodeIds.has(edge.target))
    .map((edge) => cloneDeckDocument(edge));

  return {
    ...deck,
    version: Math.max(deck.version, INITIAL_DECK.version),
    promptTemplates: upgradedPromptTemplates,
    nodes: upgradedNodes,
    edges: nextEdges,
  };
}

export function hydrateDeckDocument(
  value: Partial<DeckDocument> | null | undefined,
): DeckDocument {
  if (!value || typeof value !== 'object') {
    return cloneDeckDocument(INITIAL_DECK);
  }
  const hasExplicitNodes = Array.isArray(value.nodes);
  const nextEdges = Array.isArray(value.edges)
    ? normalizeDeckEdges(value.edges)
    : hasExplicitNodes
      ? []
      : normalizeDeckEdges(value.edges);
  const hydratedDeck = seedCurrentSystemCardsIntoLegacyDeck({
    ...cloneDeckDocument(INITIAL_DECK),
    ...value,
    id: String(value.id || INITIAL_DECK.id).trim() || INITIAL_DECK.id,
    name: String(value.name || INITIAL_DECK.name).trim() || INITIAL_DECK.name,
    version: Number.isFinite(Number(value.version))
      ? Number(value.version)
      : INITIAL_DECK.version,
    nodes: normalizeDeckNodes(value.nodes),
    edges: nextEdges,
    promptTemplates: normalizeDeckPromptTemplates(value.promptTemplates),
  });
  const bannedNodeIds = new Set(['card_synthesis', 'card_review']);
  const bannedPromptTemplateIds = new Set([
    'prompt_synthesis',
    'prompt_review',
    'prompt_code_workbench',
  ]);
  const baseDeck = {
    ...hydratedDeck,
    nodes: hydratedDeck.nodes
      .filter((node) => !bannedNodeIds.has(node.id))
      .map(normalizeLocalCoderControllerCard)
      .map(normalizeRetiredMagenticOneDefault),
    edges: hydratedDeck.edges.filter(
      (edge) =>
        !bannedNodeIds.has(edge.source) && !bannedNodeIds.has(edge.target),
    ),
    promptTemplates: hydratedDeck.promptTemplates.filter(
      (template) => !bannedPromptTemplateIds.has(template.id),
    ),
  };
  return baseDeck;
}

export function resolveProjectDeckPayload(
  deckPayload: Partial<DeckDocument> | null | undefined,
): { deck: DeckDocument; usedFallback: boolean } {
  if (!deckPayload || typeof deckPayload !== 'object') {
    return {
      deck: hydrateDeckDocument(INITIAL_DECK),
      usedFallback: true,
    };
  }

  return {
    deck: hydrateDeckDocument(deckPayload),
    usedFallback: false,
  };
}

export function resolveProjectDeckLoadResult(
  currentDeck: DeckDocument,
  deckPayload: Partial<DeckDocument> | null | undefined,
  preserveCurrentOnFailure = false,
): {
  deck: DeckDocument;
  usedFallback: boolean;
  preservedCurrent: boolean;
} {
  if (preserveCurrentOnFailure) {
    return {
      deck: cloneDeckDocument(currentDeck),
      usedFallback: false,
      preservedCurrent: true,
    };
  }

  const resolved = resolveProjectDeckPayload(deckPayload);
  return {
    ...resolved,
    preservedCurrent: false,
  };
}

export function buildProjectlessDeckDocument(): DeckDocument {
  return hydrateDeckDocument({
    id: INITIAL_DECK.id,
    name: INITIAL_DECK.name,
    version: INITIAL_DECK.version,
    promptTemplates: INITIAL_DECK.promptTemplates,
    nodes: [],
    edges: [],
  });
}
