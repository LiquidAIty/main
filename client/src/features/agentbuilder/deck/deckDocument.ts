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
