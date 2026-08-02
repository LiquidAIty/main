// Deck document logic: structural validation and exact saved-state loading.
import type {
  AgentCardInstance,
  DeckDocument,
} from '../../../types/agentgraph';
import {
  cleanOptionalText,
  cloneDeckDocument,
  normalizeRuntimeOptions,
  safeText,
} from './deckPrimitives';
import {
  INITIAL_DECK,
} from './newProjectDeck';

function isLocalCoderControllerCard(card: AgentCardInstance | null | undefined): boolean {
  if (!card) return false;
  return (
    safeText(card.id).trim().toLowerCase() === 'card_local_coder' ||
    safeText(card.runtimeBinding).trim().toLowerCase() === 'local_coder' ||
    safeText(card.runtimeType).trim().toLowerCase() === 'local_coder' ||
    safeText(card.templateId).trim().toLowerCase() === 'template_local_coder'
  );
}

export function resolveLocalCoderControllerConsoleConfig(
  deck: Pick<DeckDocument, 'nodes'>,
): { provider: string; model: string } {
  const card = deck.nodes.find(isLocalCoderControllerCard) || null;
  const runtimeOptions = normalizeRuntimeOptions(card?.runtimeOptions) ?? {};
  // The saved card is the only runtime authority. Missing values remain empty
  // so the terminal fails honestly instead of selecting an unseen model.
  return {
    provider: cleanOptionalText(runtimeOptions.provider) || '',
    model: cleanOptionalText(runtimeOptions.modelKey) || '',
  };
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
