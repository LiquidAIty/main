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
