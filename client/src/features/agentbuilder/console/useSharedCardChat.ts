import type { DirectChatTarget } from './sharedChatClient';
import { useSharedCardChatHistory } from './useSharedCardChatHistory';
import {
  useSharedCardChatSubmission,
  type DataAnchorSelection,
} from './useSharedCardChatSubmission';

type UseSharedCardChatArgs = {
  canvasProjectId: string;
  deckId: string;
  conversationId: string;
  directChatTargets?: DirectChatTarget[];
  dataAnchors?: DataAnchorSelection[];
  prepareRunImages?: (targetCardId: string | null) => Promise<Array<Record<string, unknown>>>;
};

const NO_DIRECT_CHAT_TARGETS: DirectChatTarget[] = [];
const NO_DATA_ANCHORS: DataAnchorSelection[] = [];

export default function useSharedCardChat({
  canvasProjectId,
  deckId,
  conversationId,
  directChatTargets = NO_DIRECT_CHAT_TARGETS,
  dataAnchors = NO_DATA_ANCHORS,
  prepareRunImages,
}: UseSharedCardChatArgs) {
  const conversationKey = `${canvasProjectId}\u0000${conversationId}`;
  const history = useSharedCardChatHistory({
    canvasProjectId,
    deckId,
    conversationId,
    conversationKey,
  });
  const submission = useSharedCardChatSubmission({
    canvasProjectId,
    deckId,
    conversationId,
    conversationKey,
    directChatTargets,
    dataAnchors,
    prepareRunImages,
    mainCardId: history.mainCardId,
    sessionHistoryLoading: history.sessionHistoryLoading,
    setTechnical: history.setTechnical,
    setTranscript: history.setTranscript,
    subscribeToHermesSession: history.subscribeToHermesSession,
  });

  return {
    technicalError: history.technicalError,
    messages: history.messages,
    ...submission,
  };
}
