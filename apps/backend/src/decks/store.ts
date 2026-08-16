// Thin HTTP transport to the Python-owned stable Card/deck domain.
// TypeScript deliberately owns no SQL, JSONB deck aggregate, Card revision,
// relationship authority, or topology mutation in this module.
import { requestPythonRailsJson } from '../services/autogen/autogenOrchestratorClient';
import type { DeckDocument, V3ProjectBlob } from '../types';

/** The deck currently opened by the Agent Builder view. Projects may own more. */
export const BUILDER_DECK_ID = 'deck_builder';

type DeckResponse = {
  ok?: boolean;
  deck?: unknown;
  meta?: {
    deckRevision?: unknown;
    deckSavedAt?: unknown;
  };
};

type DeckListResponse = {
  ok?: boolean;
  decks?: Array<{
    id?: unknown;
    name?: unknown;
    meta?: {
      deckRevision?: unknown;
      deckSavedAt?: unknown;
    } | null;
  }>;
};

function parseDeckResponse(value: unknown): {
  deck: DeckDocument;
  meta: { deckRevision: string | null; deckSavedAt: string | null };
} {
  const response = value && typeof value === 'object' ? value as DeckResponse : {};
  const deck = response.deck && typeof response.deck === 'object'
    ? response.deck as Record<string, unknown>
    : null;
  if (
    response.ok !== true
    || !deck
    || typeof deck.id !== 'string'
    || typeof deck.name !== 'string'
    || !Array.isArray(deck.nodes)
    || !Array.isArray(deck.edges)
    || !Array.isArray(deck.promptTemplates)
  ) {
    throw new Error('python_deck_response_invalid');
  }
  return {
    deck: deck as unknown as DeckDocument,
    meta: {
      deckRevision:
        typeof response.meta?.deckRevision === 'string' ? response.meta.deckRevision : null,
      deckSavedAt:
        typeof response.meta?.deckSavedAt === 'string' ? response.meta.deckSavedAt : null,
    },
  };
}

export async function getV3ProjectBlob(projectId: string): Promise<V3ProjectBlob> {
  const listValue = await requestPythonRailsJson(
    `/domain/decks/${encodeURIComponent(projectId)}`,
    { method: 'GET' },
  );
  const list = listValue && typeof listValue === 'object'
    ? listValue as DeckListResponse
    : {};
  if (list.ok !== true || !Array.isArray(list.decks)) {
    throw new Error('python_deck_list_response_invalid');
  }
  const entries = await Promise.all(list.decks.map(async (item) => {
    const deckId = typeof item.id === 'string' ? item.id.trim() : '';
    if (!deckId) throw new Error('python_deck_list_response_invalid');
    const result = await getDeckDocument(projectId, deckId);
    const deck = result.deck;
    if (!deck) throw new Error('python_deck_list_integrity_error');
    return [deckId, { deck, meta: result.meta }] as const;
  }));
  return {
    decks: Object.fromEntries(entries.map(([deckId, result]) => [deckId, result.deck])),
    meta: {
      decks: Object.fromEntries(entries.flatMap(([deckId, result]) =>
        result.meta.deckRevision
          ? [[deckId, {
              revision: result.meta.deckRevision,
              savedAt: result.meta.deckSavedAt,
            }]]
          : [],
      )),
    },
  };
}

export async function getDeckDocument(
  projectId: string,
  deckId: string,
): Promise<{
  deck: DeckDocument | null;
  meta: { deckRevision: string | null; deckSavedAt: string | null };
}> {
  try {
    const response = await requestPythonRailsJson(
      `/domain/decks/${encodeURIComponent(projectId)}/${encodeURIComponent(deckId)}`,
      { method: 'GET' },
    );
    return parseDeckResponse(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('deck_not_found')) {
      return { deck: null, meta: { deckRevision: null, deckSavedAt: null } };
    }
    throw error;
  }
}

export async function saveDeckDocument(
  projectId: string,
  deckId: string,
  document: DeckDocument,
  options?: { expectedRevision?: string | null },
): Promise<{
  deck: DeckDocument;
  meta: { deckRevision: string | null; deckSavedAt: string | null };
}> {
  const response = await requestPythonRailsJson(
    `/domain/decks/${encodeURIComponent(projectId)}/${encodeURIComponent(deckId)}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        document,
        expectedRevision: options?.expectedRevision || null,
      }),
    },
  );
  return parseDeckResponse(response);
}

export async function deleteDeckDocument(
  _projectId: string,
  _deckId: string,
): Promise<{ deleted: boolean }> {
  // A stable Project Deck is not deleted through a generic transport
  // endpoint. A future explicit domain operation must define preservation and
  // AGE topology cleanup before this can be enabled.
  throw new Error('canonical_deck_deletion_not_supported');
}
