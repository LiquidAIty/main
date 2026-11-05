/**
 * Entity: Agent Builder
 * Relationship: This file owns the current Agent Builder deck document, revision, load and save activity, status, and error state.
 * Entity: Saved Cards
 * Relationship: This file holds the exact loaded saved Card deck and its optimistic revision while the workspace is open.
 */

import { useState } from 'react';

import type { DeckDocument } from '../../../types/agentgraph';

type UseAgentBuilderDeckArgs = {
  createInitialDeck: () => DeckDocument;
};

export default function useAgentBuilderDeck({
  createInitialDeck,
}: UseAgentBuilderDeckArgs) {
  const [deck, setDeckState] = useState<DeckDocument>(() => createInitialDeck());
  const [deckRevision, setDeckRevision] = useState<string | null>(null);
  const [deckLoadBusy, setDeckLoadBusy] = useState(false);
  const [deckSaveBusy, setDeckSaveBusy] = useState(false);
  const [deckStatusMessage, setDeckStatusMessage] = useState<string | null>(null);
  const [deckLoadError, setDeckLoadError] = useState<string | null>(null);

  return {
    deck,
    setDeckState,
    deckRevision,
    setDeckRevision,
    deckLoadBusy,
    setDeckLoadBusy,
    deckSaveBusy,
    setDeckSaveBusy,
    deckStatusMessage,
    setDeckStatusMessage,
    deckLoadError,
    setDeckLoadError,
  };
}
