import { beforeEach, describe, expect, it, vi } from 'vitest';

const requestPythonRailsJson = vi.hoisted(() => vi.fn());

vi.mock('../services/pythonRailsClient', () => ({ requestPythonRailsJson }));

import { DEFAULT_PROJECT_DECK_ID } from './defaultProjectDeck';
import { getDeckDocument, saveDeckDocument } from './deckDomainClient';

const deck = {
  id: DEFAULT_PROJECT_DECK_ID,
  name: 'Agent Builder',
  nodes: [],
  edges: [],
  promptTemplates: [],
  version: 1,
};

describe('thin Deck transport boundary', () => {
  beforeEach(() => {
    requestPythonRailsJson.mockReset();
  });

  it('keeps the existing Agent Builder Deck identity', () => {
    expect(DEFAULT_PROJECT_DECK_ID).toBe('deck_builder');
  });

  it('reads the exact encoded Deck from Python rails', async () => {
    requestPythonRailsJson.mockResolvedValue({
      ok: true,
      deck,
      meta: { deckRevision: 'revision-one', deckSavedAt: '2026-10-09T00:00:00Z' },
    });

    await expect(getDeckDocument('project / one', 'deck builder')).resolves.toEqual({
      deck,
      meta: { deckRevision: 'revision-one', deckSavedAt: '2026-10-09T00:00:00Z' },
    });
    expect(requestPythonRailsJson).toHaveBeenCalledWith(
      '/domain/decks/project%20%2F%20one/deck%20builder',
      { method: 'GET' },
    );
  });

  it('returns an absent Deck only for the exact Python not-found result', async () => {
    requestPythonRailsJson.mockRejectedValue(new Error('deck_not_found'));

    await expect(getDeckDocument('project-one', DEFAULT_PROJECT_DECK_ID)).resolves.toEqual({
      deck: null,
      meta: { deckRevision: null, deckSavedAt: null },
    });
  });

  it('writes one exact Deck document and expected revision to Python rails', async () => {
    requestPythonRailsJson.mockResolvedValue({
      ok: true,
      deck,
      meta: { deckRevision: 'revision-two', deckSavedAt: '2026-10-09T00:01:00Z' },
    });

    await expect(saveDeckDocument(
      'project-one',
      DEFAULT_PROJECT_DECK_ID,
      deck,
      { expectedRevision: 'revision-one' },
    )).resolves.toEqual({
      deck,
      meta: { deckRevision: 'revision-two', deckSavedAt: '2026-10-09T00:01:00Z' },
    });
    expect(requestPythonRailsJson).toHaveBeenCalledWith(
      `/domain/decks/project-one/${DEFAULT_PROJECT_DECK_ID}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ document: deck, expectedRevision: 'revision-one' }),
      },
    );
  });
});
