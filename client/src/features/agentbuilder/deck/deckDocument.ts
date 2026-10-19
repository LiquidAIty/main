/**
 * Entity: Agent Builder
 * Relationship: This file validates canonical deck responses, constructs projectless canvas state, and performs the client-only quick-add authoring mutation.
 * Entity: Saved Cards
 * Relationship: This file creates one editable Assist Card with a unique saved identity and preserves an exact loaded deck without merging browser defaults.
 * Entity: Card Topology
 * Relationship: This file validates saved edge endpoints and places a quick-added Card without creating or changing any orange or blue wire.
 * Entity: Hermes Profiles
 * Relationship: This file gives a quick-added Assist Card one unique delegate profile and carries the template's saved provider and model choices.
 */

import type {
  AgentCardInstance,
  DeckDocument,
} from '../../../types/agentgraph';
import {
  cloneDeckDocument,
  normalizeRuntimeOptions,
  uid,
} from './deckPrimitives';
import {
  ASSIST_AGENT_TEMPLATE,
  ASSIST_PROMPT_TEMPLATE,
  PROJECTLESS_DECK,
} from './newProjectDeck';

/**
 * The canonical hex-plus "Add New Agent" mutation: creates exactly one new
 * editable Card using the current deck schema and template binding,
 * places it in the next valid open canvas position, and returns the updated
 * deck plus the created card (which the caller selects/opens).
 *
 * Restores the historical quick-add path (previously driven by
 * DeckNodePreset/buildQuickAddDeckMutation which were removed) against the
 * current canonical schema. No edge is created (the historical top-level
 * hex-plus added an unattached card); no process is launched.
 */
export function buildQuickAddAssistCard(
  deck: DeckDocument,
  runtime: { kind: 'hermes'; mode: 'delegate' },
): { nextDeck: DeckDocument; nextNode: AgentCardInstance } {
  const template = ASSIST_AGENT_TEMPLATE;
  const promptContent = ASSIST_PROMPT_TEMPLATE.content;
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
      node.templateId === 'template_assist'
      && !String(node.parentGraphId || '').trim(),
  ).length;

  const identity = uid();
  const nextNode: AgentCardInstance = {
    id: `card_assist_${identity}`,
    kind: 'agent',
    templateId: template?.id || 'template_assist',
    prompt: promptContent,
    runtime: { ...runtime, profile: `agent-${identity}` },
    runtimeOptions: normalizeRuntimeOptions({
      subagentType: 'none',
      provider: template?.provider || undefined,
      modelKey: template?.model || undefined,
      tools: template?.tools ?? [],
      skills: [],
      toolsets: [],
      mcpConnectionIds: [],
    }),
    parentGraphId: null,
    title: `Assist ${assistCount + 1}`,
    subtitle: 'New Agent',
    position,
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
  deckPayload: Partial<DeckDocument> | null | undefined,
): {
  deck: DeckDocument;
} {
  return resolveProjectDeckPayload(deckPayload);
}

export function buildProjectlessDeckDocument(): DeckDocument {
  return readDeckDocument(PROJECTLESS_DECK);
}
