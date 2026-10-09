// Thin HTTP transport to the Python-owned stable Card/deck domain.
// TypeScript deliberately owns no SQL, JSONB deck aggregate, Card revision,
// relationship authority, or topology mutation in this module.
import { requestPythonRailsJson } from '../services/pythonRailsClient';
import type { DeckDocument } from '../types';

/** The deck currently opened by the Agent Builder view. Projects may own more. */
/** Stable saved identity of the surviving Builder Card. */
export const BUILDER_CARD_ID = 'builder';

type DeckResponse = {
  ok?: boolean;
  deck?: unknown;
  meta?: {
    deckRevision?: unknown;
    deckSavedAt?: unknown;
  };
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
