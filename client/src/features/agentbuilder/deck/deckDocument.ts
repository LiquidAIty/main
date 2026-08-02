// Deck document logic: structural normalization, hydration, and load handling.
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
  normalizeRuntimeOptions,
  safeText,
} from './deckPrimitives';
import {
  INITIAL_DECK,
} from './deckSeed';

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


function normalizeDeckNodes(value: unknown): AgentCardInstance[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (node): node is AgentCardInstance =>
        Boolean(
          node &&
            typeof node === 'object' &&
            typeof (node as AgentCardInstance).id === 'string' &&
            typeof (node as AgentCardInstance).templateId === 'string',
        ),
    )
    .map((node) => cloneDeckDocument(node));
}

function normalizeDeckPromptTemplates(value: unknown): PromptTemplate[] {
  if (!Array.isArray(value)) return [];
  const nextPromptTemplates = value.filter(
    (template): template is PromptTemplate =>
      Boolean(
        template &&
        typeof template === 'object' &&
        typeof (template as PromptTemplate).id === 'string' &&
        typeof (template as PromptTemplate).content === 'string',
      ),
  );
  return cloneDeckDocument(nextPromptTemplates);
}

function normalizeDeckEdges(value: unknown): DeckEdge[] {
  return Array.isArray(value)
    ? cloneDeckDocument(sanitizeDeckEdges(value))
    : [];
}

export function formatBuilderStatusMessage(
  message: unknown,
  fallback: string,
): string {
  const text = String(message || '').trim();
  return text || fallback;
}

export function hydrateDeckDocument(
  value: Partial<DeckDocument> | null | undefined,
): DeckDocument {
  if (!value || typeof value !== 'object') {
    return cloneDeckDocument(INITIAL_DECK);
  }
  return {
    ...cloneDeckDocument(value),
    id: String(value.id || INITIAL_DECK.id).trim() || INITIAL_DECK.id,
    name: String(value.name || INITIAL_DECK.name).trim() || INITIAL_DECK.name,
    version: Number.isFinite(Number(value.version))
      ? Number(value.version)
      : INITIAL_DECK.version,
    nodes: normalizeDeckNodes(value.nodes),
    edges: normalizeDeckEdges(value.edges),
    promptTemplates: normalizeDeckPromptTemplates(value.promptTemplates),
  };
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
