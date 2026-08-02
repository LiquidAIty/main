import { useEffect } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';

import { waitForBackendReady } from '../../../components/builder/backendReadiness';
import { guardedRequest, safeJson } from '../../../components/builder/requestGuards';
import type { AgentBuilderChatMessage } from '../console/useAgentBuilderMainChat';
import type {
  DeckDocument,
} from '../../../types/agentgraph';

type LoadResult = {
  deck: DeckDocument;
  usedFallback: boolean;
};

type UseAgentBuilderDeckLoadArgs = {
  canvasProjectId: string;
  projectsApi: string;
  builderDeckId: string;
  currentDeckRef: MutableRefObject<DeckDocument>;
  emptyMessages: AgentBuilderChatMessage[];
  buildProjectlessDeckDocument: () => DeckDocument;
  resolveProjectDeckLoadResult: (
    currentDeck: DeckDocument,
    persistedDeck: DeckDocument | null,
  ) => LoadResult;
  formatBuilderStatusMessage: (
    errorMessage: unknown,
    fallbackMessage: string,
  ) => string;
  recordDeckWriteReason: (reason: string) => void;
  snapshotDeckBoard: (deck: DeckDocument) => unknown;
  lastPersistedBoardFingerprintRef: MutableRefObject<string | null>;
  lastPersistedBoardSnapshotRef: MutableRefObject<unknown>;
  setDeck: Dispatch<SetStateAction<DeckDocument>>;
  setDeckRevision: Dispatch<SetStateAction<string | null>>;
  setDeckLoadBusy: Dispatch<SetStateAction<boolean>>;
  setDeckLoadError: Dispatch<SetStateAction<string | null>>;
  setMessages: Dispatch<SetStateAction<AgentBuilderChatMessage[]>>;
  setStateLoaded: Dispatch<SetStateAction<boolean>>;
  setDeckStatusMessage: Dispatch<SetStateAction<string | null>>;
};

export default function useAgentBuilderDeckLoad({
  canvasProjectId,
  projectsApi,
  builderDeckId,
  currentDeckRef,
  emptyMessages,
  buildProjectlessDeckDocument,
  resolveProjectDeckLoadResult,
  formatBuilderStatusMessage,
  recordDeckWriteReason,
  snapshotDeckBoard,
  lastPersistedBoardFingerprintRef,
  lastPersistedBoardSnapshotRef,
  setDeck,
  setDeckRevision,
  setDeckLoadBusy,
  setDeckLoadError,
  setMessages,
  setStateLoaded,
  setDeckStatusMessage,
}: UseAgentBuilderDeckLoadArgs) {
  useEffect(() => {
    if (!canvasProjectId) {
      recordDeckWriteReason('builder-await-project');
      setDeck(buildProjectlessDeckDocument());
      setDeckRevision(null);
      setDeckLoadError(null);
      setMessages([...emptyMessages]);
      setStateLoaded(false);
      setDeckStatusMessage(null);
      return;
    }

    const controller = new AbortController();
    setDeckLoadBusy(true);
    setDeckLoadError(null);
    setStateLoaded(false);
    setDeckRevision(null);
    setDeckStatusMessage('Loading canvas...');

    void (async () => {
      try {
        // Backend readiness gate: during dev startup the backend compiles for
        // ~60s after Vite is ready. Wait for /api/health/ before firing the
        // real deck-load fetch so we don't spam ECONNREFUSED. If the wait
        // times out, fall through and let the real fetch surface the error.
        await waitForBackendReady({ signal: controller.signal });
        const endpoint = `${projectsApi}/${canvasProjectId}/decks/${builderDeckId}`;
        const payload = await guardedRequest({
          key: `v3-deck:${canvasProjectId}:${builderDeckId}`,
          method: 'GET',
          ttlMs: 1_000,
          signal: controller.signal,
          fetcher: async (signal) => {
            const response = await fetch(endpoint, { signal });
            const data = await safeJson(response);
            return { response, data };
          },
        });

        if (controller.signal.aborted) return;
        if (!payload.response.ok) {
          throw new Error(String(payload.data?.error || 'deck_load_failed'));
        }

        const savedDeck =
          payload.data?.deck && typeof payload.data.deck === 'object'
            ? { ...(payload.data.deck as DeckDocument), id: builderDeckId }
            : null;
        const loadResult = resolveProjectDeckLoadResult(
          currentDeckRef.current,
          savedDeck,
        );

        recordDeckWriteReason(
          loadResult.usedFallback ? 'deck-load-default' : 'deck-load',
        );
        setDeck(loadResult.deck);
        // Compare autosave against the actual persisted board.
        const persistedDeck =
          !loadResult.usedFallback && savedDeck ? savedDeck : loadResult.deck;
        lastPersistedBoardFingerprintRef.current = JSON.stringify({
          nodes: persistedDeck.nodes,
          edges: persistedDeck.edges,
        });
        lastPersistedBoardSnapshotRef.current = snapshotDeckBoard(persistedDeck);
        setDeckRevision(
          typeof payload.data?.meta?.deckRevision === 'string'
            ? payload.data.meta.deckRevision
            : null,
        );
        setStateLoaded(true);
        setDeckLoadError(null);
        setDeckStatusMessage(
          loadResult.usedFallback ? 'Using default canvas.' : 'Canvas loaded.',
        );
        console.info('[builder][deck-load-proof]', {
          projectId: canvasProjectId,
          deckId: builderDeckId,
          reason: 'deck-load',
          source: loadResult.usedFallback ? 'fallback' : 'backend_saved_deck',
          nodeCount: loadResult.deck.nodes.length,
          edgeCount: loadResult.deck.edges.length,
          revision:
            typeof payload.data?.meta?.deckRevision === 'string'
              ? payload.data.meta.deckRevision
              : null,
        });
      } catch (err: unknown) {
        if (controller.signal.aborted) return;
        recordDeckWriteReason('deck-load-error');
        setDeckRevision(null);
        setMessages([...emptyMessages]);
        setStateLoaded(true);
        const errorMessage =
          typeof err === 'object' && err !== null && 'message' in err
            ? (err as { message?: unknown }).message
            : undefined;
        const loadErrorMessage = formatBuilderStatusMessage(
          errorMessage,
          'Canvas data could not be loaded.',
        );
        setDeckLoadError(loadErrorMessage);
        setDeckStatusMessage(loadErrorMessage);
      } finally {
        if (!controller.signal.aborted) {
          setDeckLoadBusy(false);
        }
      }
    })();

    return () => {
      controller.abort();
    };
  }, [
    buildProjectlessDeckDocument,
    builderDeckId,
    canvasProjectId,
    currentDeckRef,
    emptyMessages,
    formatBuilderStatusMessage,
    lastPersistedBoardFingerprintRef,
    lastPersistedBoardSnapshotRef,
    projectsApi,
    recordDeckWriteReason,
    resolveProjectDeckLoadResult,
    setDeck,
    setDeckLoadBusy,
    setDeckLoadError,
    setDeckRevision,
    setDeckStatusMessage,
    setMessages,
    setStateLoaded,
    snapshotDeckBoard,
  ]);
}
