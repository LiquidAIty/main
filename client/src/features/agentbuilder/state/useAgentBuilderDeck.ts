import { useEffect, useRef, useState } from 'react';

import type { PlanDraft } from '../plan/planDraftTypes';
import type {
  LatestCardRunRecord,
} from '../../../components/builder/useBuilderDeckRuntimeActions';
import type {
  ChatPlanDraftResult,
  DeckDocument,
  DeckRun,
  DeckRuntimeEvent,
  MissionRun,
  MissionSpec,
  OpenMissionMessage,
  PlanDraftStatus,
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
  const [draftMissionSpec, setDraftMissionSpec] = useState<MissionSpec | null>(null);
  const [currentPlanDraft, setCurrentPlanDraft] = useState<PlanDraft | null>(null);
  const [planDraftStatus, setPlanDraftStatus] = useState<PlanDraftStatus>('idle');
  const [latestPlanDraftResult, setLatestPlanDraftResult] =
    useState<ChatPlanDraftResult | null>(null);
  const draftMissionSpecRef = useRef<MissionSpec | null>(null);
  const currentPlanDraftRef = useRef<PlanDraft | null>(null);
  const planDraftRequestSeqRef = useRef(0);
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

  useEffect(() => {
    draftMissionSpecRef.current = draftMissionSpec;
  }, [draftMissionSpec]);

  useEffect(() => {
    currentPlanDraftRef.current = currentPlanDraft;
  }, [currentPlanDraft]);

  return {
    deck,
    setDeckState,
    pendingActivationProposal,
    setPendingActivationProposal,
    latestMissionRun,
    setLatestMissionRun,
    openMissionMessage,
    setOpenMissionMessage,
    draftMissionSpec,
    setDraftMissionSpec,
    currentPlanDraft,
    setCurrentPlanDraft,
    planDraftStatus,
    setPlanDraftStatus,
    latestPlanDraftResult,
    setLatestPlanDraftResult,
    draftMissionSpecRef,
    currentPlanDraftRef,
    planDraftRequestSeqRef,
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
