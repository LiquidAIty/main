import { useEffect } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';

import { guardedRequest, safeJson } from '../../../components/builder/requestGuards';
import type { LatestCardRunRecord } from '../../../components/builder/useBuilderDeckRuntimeActions';
import type { LinkRef } from '../../../components/builder/deckContinuityTypes';
import type {
  DeckDocument,
  DeckRun,
  DeckRuntimeEvent,
} from '../../../types/agentgraph';

type BuilderChatMessage = { role: 'assistant' | 'user'; text: string };

type EmptyProjectState = {
  messages: BuilderChatMessage[];
  links: LinkRef[];
};

type LoadResult = {
  deck: DeckDocument;
  usedFallback: boolean;
};

type UseAgentBuilderDeckLoadArgs = {
  canvasProjectId: string;
  projectsApi: string;
  builderDeckId: string;
  currentDeckRef: MutableRefObject<DeckDocument>;
  emptyProjectState: EmptyProjectState;
  buildProjectlessDeckDocument: () => DeckDocument;
  resolveProjectDeckLoadResult: (
    currentDeck: DeckDocument,
    persistedDeck: DeckDocument | null,
  ) => LoadResult;
  loadProjectState: (projectId: string) => {
    messages: BuilderChatMessage[];
    links: LinkRef[];
  };
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
  setLatestDeckRun: Dispatch<SetStateAction<DeckRun | null>>;
  setLatestCardRun: Dispatch<SetStateAction<LatestCardRunRecord | null>>;
  setLiveDeckEvents: Dispatch<SetStateAction<DeckRuntimeEvent[]>>;
  setMessages: Dispatch<SetStateAction<BuilderChatMessage[]>>;
  setStateLoaded: Dispatch<SetStateAction<boolean>>;
  setDeckStatusMessage: Dispatch<SetStateAction<string | null>>;
};

export default function useAgentBuilderDeckLoad({
  canvasProjectId,
  projectsApi,
  builderDeckId,
  currentDeckRef,
  emptyProjectState,
  buildProjectlessDeckDocument,
  resolveProjectDeckLoadResult,
  loadProjectState,
  formatBuilderStatusMessage,
  recordDeckWriteReason,
  snapshotDeckBoard,
  lastPersistedBoardFingerprintRef,
  lastPersistedBoardSnapshotRef,
  setDeck,
  setDeckRevision,
  setDeckLoadBusy,
  setDeckLoadError,
  setLatestDeckRun,
  setLatestCardRun,
  setLiveDeckEvents,
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
      setLatestDeckRun(null);
      setLatestCardRun(null);
      setLiveDeckEvents([]);
      setMessages([...emptyProjectState.messages]);
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

        const loadResult = resolveProjectDeckLoadResult(
          currentDeckRef.current,
          payload.data?.deck && typeof payload.data.deck === 'object'
            ? { ...(payload.data.deck as DeckDocument), id: builderDeckId }
            : null,
        );

        recordDeckWriteReason(
          loadResult.usedFallback ? 'deck-load-default' : 'deck-load',
        );
        setDeck(loadResult.deck);
        lastPersistedBoardFingerprintRef.current = JSON.stringify({
          nodes: loadResult.deck.nodes,
          edges: loadResult.deck.edges,
        });
        lastPersistedBoardSnapshotRef.current = snapshotDeckBoard(loadResult.deck);
        setDeckRevision(
          typeof payload.data?.meta?.deckRevision === 'string'
            ? payload.data.meta.deckRevision
            : null,
        );
        const persistedLatestRun =
          payload.data?.latestRun && typeof payload.data.latestRun === 'object'
            ? (payload.data.latestRun as DeckRun)
            : null;
        setLatestDeckRun(persistedLatestRun);
        setLatestCardRun(null);
        setLiveDeckEvents([]);
        // The normal chat transcript is the live conversation only — it is NOT
        // re-painted from saved deck runs (that clobbered the live user message
        // and rendered old run text as fake chat bubbles).
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
        const next = loadProjectState(canvasProjectId);
        setLatestDeckRun(null);
        setLatestCardRun(null);
        setLiveDeckEvents([]);
        setDeckRevision(null);
        setMessages([...next.messages]);
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
    emptyProjectState.messages,
    formatBuilderStatusMessage,
    lastPersistedBoardFingerprintRef,
    lastPersistedBoardSnapshotRef,
    loadProjectState,
    projectsApi,
    recordDeckWriteReason,
    resolveProjectDeckLoadResult,
    setDeck,
    setDeckLoadBusy,
    setDeckLoadError,
    setDeckRevision,
    setDeckStatusMessage,
    setLatestCardRun,
    setLatestDeckRun,
    setLiveDeckEvents,
    setMessages,
    setStateLoaded,
    snapshotDeckBoard,
  ]);
}
