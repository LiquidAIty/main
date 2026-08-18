// Deck document logic: structural validation and exact saved-state loading.
import type {
  AgentCardInstance,
  DeckDocument,
} from '../../../types/agentgraph';
import {
  cloneDeckDocument,
  normalizeCardRuntime,
  normalizeRuntimeOptions,
  uid,
} from './deckPrimitives';
import {
  INITIAL_AGENT_TEMPLATES,
  INITIAL_DECK,
  INITIAL_PROMPT_TEMPLATES,
} from './newProjectDeck';

/**
 * The canonical hex-plus "Add New Agent" mutation: creates exactly one new
 * editable Assistant Agent card using the current deck schema and templates,
 * places it in the next valid open canvas position, and returns the updated
 * deck plus the created card (which the caller selects/opens).
 *
 * Restores the historical quick-add path (previously driven by
 * DeckNodePreset/buildQuickAddDeckMutation which were removed) against the
 * current canonical schema. No edge is created (the historical top-level
 * hex-plus added an unattached card); no runtime assignment, no process.
 */
export function buildQuickAddAssistCard(
  deck: DeckDocument,
): { nextDeck: DeckDocument; nextNode: AgentCardInstance } {
  const template =
    INITIAL_AGENT_TEMPLATES.find((entry) => entry.id === 'template_assist') || null;
  const promptContent =
    (INITIAL_PROMPT_TEMPLATES.find((entry) => entry.id === 'prompt_assist')?.content) || '';
  const rightMostX = deck.nodes.reduce(
    (max, node) => Math.max(max, node.position.x || 0),
    -220,
  );
  const nextColumnX = rightMostX + 320;
  const wrappedColumnX =
    nextColumnX > 1040
      ? 40
      : nextColumnX;
  const occupiedInNextColumn = deck.nodes.filter(
    (node) => Math.abs(node.position.x - wrappedColumnX) < 72,
  ).length;
  const position = {
    x: wrappedColumnX,
    y: 40 + occupiedInNextColumn * 180,
  };
  const assistCount = deck.nodes.filter(
    (node) =>
      normalizeCardRuntime(node.runtime)?.kind === 'autogen'
      && normalizeCardRuntime(node.runtime)?.mode === 'assistant'
      && !String(node.parentGraphId || '').trim(),
  ).length;

  const nextNode: AgentCardInstance = {
    id: `card_assist_${uid()}`,
    kind: 'agent',
    templateId: template?.id || 'template_assist',
    prompt: promptContent,
    runtime: { kind: 'autogen', mode: 'assistant' },
    runtimeOptions: normalizeRuntimeOptions({
      provider: template?.provider || undefined,
      modelKey: template?.model || undefined,
      temperature: template?.temperature ?? undefined,
      maxTokens: template?.maxTokens ?? undefined,
      tools: template?.tools ?? [],
      skills: [],
      toolsets: [],
      mcpConnectionIds: [],
    }),
    parentGraphId: null,
    title: `Assist ${assistCount + 1}`,
    subtitle: 'New Agent',
    position,
    status: 'ready',
  };

  const nextDeck: DeckDocument = {
    ...deck,
    version: deck.version + 1,
    nodes: [...deck.nodes, nextNode],
  };
  return { nextDeck, nextNode };
}


export function formatBuilderStatusMessage(
  message: unknown,
  fallback: string,
): string {
  const text = String(message || '').trim();
  return text || fallback;
}

export function readDeckDocument(
  value: Partial<DeckDocument> | null | undefined,
): DeckDocument {
  if (!value || typeof value !== 'object') {
    throw new Error('deck_document_required');
  }
  if (typeof value.id !== 'string' || !value.id) throw new Error('deck_id_invalid');
  if (typeof value.name !== 'string' || !value.name) throw new Error('deck_name_invalid');
  if (!Number.isFinite(value.version)) throw new Error('deck_version_invalid');
  if (!Array.isArray(value.nodes)) throw new Error('deck_nodes_invalid');
  if (!Array.isArray(value.edges)) throw new Error('deck_edges_invalid');
  if (!Array.isArray(value.promptTemplates)) throw new Error('deck_prompt_templates_invalid');
  for (const node of value.nodes) {
    if (!node || typeof node !== 'object' || typeof node.id !== 'string' || !node.id) {
      throw new Error('deck_card_id_invalid');
    }
  }
  for (const edge of value.edges) {
    if (!edge || typeof edge !== 'object' || typeof edge.id !== 'string' || !edge.id) {
      throw new Error('deck_edge_id_invalid');
    }
    if (typeof edge.source !== 'string' || !edge.source) throw new Error('deck_edge_source_invalid');
    if (typeof edge.target !== 'string' || !edge.target) throw new Error('deck_edge_target_invalid');
  }
  return cloneDeckDocument(value) as DeckDocument;
}

export function resolveProjectDeckPayload(
  deckPayload: Partial<DeckDocument> | null | undefined,
): { deck: DeckDocument } {
  if (!deckPayload || typeof deckPayload !== 'object') {
    throw new Error('deck_not_found');
  }

  return {
    deck: readDeckDocument(deckPayload),
  };
}

export function resolveProjectDeckLoadResult(
  _currentDeck: DeckDocument,
  deckPayload: Partial<DeckDocument> | null | undefined,
): {
  deck: DeckDocument;
} {
  return resolveProjectDeckPayload(deckPayload);
}

export function buildProjectlessDeckDocument(): DeckDocument {
  return readDeckDocument({
    id: INITIAL_DECK.id,
    name: INITIAL_DECK.name,
    version: INITIAL_DECK.version,
    promptTemplates: INITIAL_DECK.promptTemplates,
    nodes: [],
    edges: [],
  });
}
