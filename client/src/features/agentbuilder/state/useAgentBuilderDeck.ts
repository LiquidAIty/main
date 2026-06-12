import { useState } from 'react';

import type {
  LatestCardRunRecord,
} from '../../../components/builder/useBuilderDeckRuntimeActions';
import type {
  DeckDocument,
  DeckRun,
  DeckRuntimeEvent,
  MissionRun,
  OpenMissionMessage,
} from '../../../types/agentgraph';

type ActivationProposalState = {
  capability:
    | 'plan'
    | 'knowledge'
    | 'energy'
    | 'worldsignal'
    | 'image'
    | 'code'
    | 'video'
    | 'trading';
  title: string;
  sourceText: string;
  status: 'pending' | 'approved';
};

type UseAgentBuilderDeckArgs = {
  createInitialDeck: () => DeckDocument;
};

export default function useAgentBuilderDeck({
  createInitialDeck,
}: UseAgentBuilderDeckArgs) {
  const [deck, setDeckState] = useState<DeckDocument>(() => createInitialDeck());
  const [pendingActivationProposal, setPendingActivationProposal] =
    useState<ActivationProposalState | null>(null);
  const [latestMissionRun, setLatestMissionRun] = useState<MissionRun | null>(
    null,
  );
  const [openMissionMessage, setOpenMissionMessage] =
    useState<OpenMissionMessage | null>(null);
  const [deckRevision, setDeckRevision] = useState<string | null>(null);
  const [latestDeckRun, setLatestDeckRun] = useState<DeckRun | null>(null);
  const [latestCardRun, setLatestCardRun] = useState<LatestCardRunRecord | null>(null);
  const [liveDeckEvents, setLiveDeckEvents] = useState<DeckRuntimeEvent[]>([]);
  const [deckRunBusy, setDeckRunBusy] = useState(false);
  const [cardRunBusy, setCardRunBusy] = useState(false);
  const [deckLoadBusy, setDeckLoadBusy] = useState(false);
  const [deckSaveBusy, setDeckSaveBusy] = useState(false);
  const [deckStatusMessage, setDeckStatusMessage] = useState<string | null>(null);
  const [deckLoadError, setDeckLoadError] = useState<string | null>(null);

  return {
    deck,
    setDeckState,
    pendingActivationProposal,
    setPendingActivationProposal,
    latestMissionRun,
    setLatestMissionRun,
    openMissionMessage,
    setOpenMissionMessage,
    deckRevision,
    setDeckRevision,
    latestDeckRun,
    setLatestDeckRun,
    latestCardRun,
    setLatestCardRun,
    liveDeckEvents,
    setLiveDeckEvents,
    deckRunBusy,
    setDeckRunBusy,
    cardRunBusy,
    setCardRunBusy,
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
