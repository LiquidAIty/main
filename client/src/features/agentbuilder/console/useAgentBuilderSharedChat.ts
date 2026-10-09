import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';

import {
  createCanonicalSubjectMatcher,
  type CanonicalSubjectFocusRequest,
  type CanonicalSubjectFocusTarget,
} from '../../../components/knowledge/canonicalSubjectLinks';
import type { GodsEyeBridge } from '../../../components/worldsignals/GodsEyeSurface';
import type useAgentBuilderKnowledgeGraphs from '../state/useAgentBuilderKnowledgeGraphs';
import type { DeckCard } from '../../../types/agentgraph';
import { DEFAULT_PROJECT_DECK_ID } from '../deck/newProjectDeck';
import type { DirectChatTarget } from './sharedChatClient';
import useSharedCardChat from './useSharedCardChat';
import { showCanvasWorkspaceInUrl } from '../core/agentBuilderWorkspaceUrl';
import type { AgentBuilderWorkspaceView } from '../core/useAgentBuilderWorkspaceNavigation';

type ChatColors = {
  primary: string;
  bg: string;
  panel: string;
  border: string;
  text: string;
  neutral: string;
  warn: string;
};

export default function useAgentBuilderSharedChat({
  activeProject,
  canvasProjectId,
  conversationId,
  workspaceView,
  setWorkspaceView,
  canonicalDeckReady,
  setDeckStatusMessage,
  mainCardId,
  directChatTargets,
  knowledgeGraphs,
  worldSignalsCardId,
  worldViewCard,
  tradingCard,
  worldViewBridge,
  colors,
}: {
  activeProject: string;
  canvasProjectId: string;
  conversationId: string;
  workspaceView: AgentBuilderWorkspaceView;
  setWorkspaceView: Dispatch<SetStateAction<AgentBuilderWorkspaceView>>;
  canonicalDeckReady: boolean;
  setDeckStatusMessage: Dispatch<SetStateAction<string | null>>;
  mainCardId: string | null;
  directChatTargets: DirectChatTarget[];
  knowledgeGraphs: ReturnType<typeof useAgentBuilderKnowledgeGraphs>;
  worldSignalsCardId: string | null;
  worldViewCard: DeckCard | null;
  tradingCard: DeckCard | null;
  worldViewBridge: GodsEyeBridge | null;
  colors: ChatColors;
}) {
  const [transientCardInputs, setTransientCardInputs] = useState<Record<string, string>>({});
  const sharedChatDraftKey = mainCardId
    ? JSON.stringify([canvasProjectId, conversationId, mainCardId])
    : '';
  const canonicalSubjectMatcher = useMemo(
    () => createCanonicalSubjectMatcher({
      thinkgraph: knowledgeGraphs.projections.thinkgraph,
      knowgraph: knowledgeGraphs.projections.knowgraph,
    }),
    [knowledgeGraphs.projections.knowgraph, knowledgeGraphs.projections.thinkgraph],
  );
  const subjectFocusRequestIdentityRef = useRef(0);
  const [subjectFocusRequest, setSubjectFocusRequest] =
    useState<CanonicalSubjectFocusRequest | null>(null);
  useEffect(() => {
    if (workspaceView !== 'knowledge') setSubjectFocusRequest(null);
  }, [activeProject, workspaceView]);
  const handleCanonicalSubjectFocus = useCallback((target: CanonicalSubjectFocusTarget) => {
    if (!activeProject || target.projectId !== activeProject) return;
    subjectFocusRequestIdentityRef.current += 1;
    setWorkspaceView('knowledge');
    setSubjectFocusRequest({
      ...target,
      requestId: subjectFocusRequestIdentityRef.current,
    });
  }, [activeProject, setWorkspaceView]);
  const prepareRunImages = useCallback(async (targetCardId: string | null) => {
    if (!targetCardId || targetCardId !== worldViewCard?.id || workspaceView !== 'worldview') {
      return [];
    }
    if (!worldViewBridge) throw new Error('worldview_turn_context_unavailable');
    return worldViewBridge.prepareRunImages();
  }, [workspaceView, worldViewBridge, worldViewCard?.id]);
  const chat = useSharedCardChat({
    canvasProjectId,
    deckId: DEFAULT_PROJECT_DECK_ID,
    conversationId,
    directChatTargets,
    prepareRunImages,
  });
  useEffect(() => {
    const companion = workspaceView === 'worldsignals'
      ? { cardId: worldSignalsCardId, label: 'WorldSignals' }
      : workspaceView === 'worldview'
        ? { cardId: worldViewCard?.id || null, label: 'WorldView' }
        : workspaceView === 'trading'
          ? { cardId: tradingCard?.id || null, label: 'Trading' }
          : null;
    if (!companion) {
      chat.setCurrentResponderCardId(null);
      return;
    }
    if (!canonicalDeckReady) return;
    if (companion.cardId && chat.setCurrentResponderCardId(companion.cardId)) return;
    setDeckStatusMessage(`${companion.label} saved Card is unavailable for direct chat.`);
    setWorkspaceView(canvasProjectId ? 'canvas' : 'chat');
    showCanvasWorkspaceInUrl();
  }, [
    canonicalDeckReady,
    canvasProjectId,
    chat.setCurrentResponderCardId,
    setDeckStatusMessage,
    setWorkspaceView,
    tradingCard?.id,
    workspaceView,
    worldSignalsCardId,
    worldViewCard?.id,
  ]);

  return {
    setCurrentResponderCardId: chat.setCurrentResponderCardId,
    subjectFocusRequest,
    sharedChatProps: {
      messages: chat.messages,
      mainCardId: mainCardId || undefined,
      directChatTargets,
      onSend: chat.handleSend,
      onKnowledgeUploaded: () => { void knowledgeGraphs.refreshKnowGraph(); },
      draft: sharedChatDraftKey ? transientCardInputs[sharedChatDraftKey] || '' : '',
      onDraftChange: (value: string) => {
        if (!sharedChatDraftKey) return;
        setTransientCardInputs((current) => {
          if (!value) {
            const next = { ...current };
            delete next[sharedChatDraftKey];
            return next;
          }
          return { ...current, [sharedChatDraftKey]: value };
        });
      },
      knowledgeProjectId: activeProject,
      subjectMatcher: canonicalSubjectMatcher,
      onSubjectFocus: handleCanonicalSubjectFocus,
      colors,
      busy: chat.sessionActive,
      connecting: chat.sessionConnecting,
      error: chat.technicalError,
      voiceError: chat.voiceError,
      voicePhase: chat.voicePhase,
      onVoiceStart: chat.startVoiceSession,
      onVoiceStop: () => { void chat.stopVoiceSession(); },
      onStop: () => {
        void chat.stopCurrentCardTurn().catch((error) => {
          setDeckStatusMessage(
            error instanceof Error ? error.message : 'Main run stop failed.',
          );
        });
      },
    },
  };
}
