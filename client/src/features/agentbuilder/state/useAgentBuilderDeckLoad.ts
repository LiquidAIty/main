// Graph + less = more: less code that does the same work as more code is more useful.
// Entity names the feature; Relationship explains why this file belongs and what it contributes.
// Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
// Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
// Entity: Projects
// Relationship: This file requests the canonical deck only for the selected Project and rejects cross-Project, stale, aborted, or incomplete responses.
// Entity: Saved Cards
// Relationship: This file loads the exact saved deck and revision into editor state and initializes autosave fingerprints from the persisted Card and edge document.
import { useEffect } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';

import { guardedRequest, safeJson } from '../../../components/builder/requestGuards';
import type {
  DeckDocument,
} from '../../../types/agentgraph';

type LoadResult = {
  deck: DeckDocument;
};

type UseAgentBuilderDeckLoadArgs = {
  canvasProjectId: string;
  projectsApi: string;
  builderDeckId: string;
  resolveProjectDeckLoadResult: (
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
  setStateLoaded: Dispatch<SetStateAction<boolean>>;
  setDeckStatusMessage: Dispatch<SetStateAction<string | null>>;
  reloadToken?: number;
};

export default function useAgentBuilderDeckLoad({
  canvasProjectId,
  projectsApi,
  builderDeckId,
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
  setStateLoaded,
  setDeckStatusMessage,
  reloadToken = 0,
}: UseAgentBuilderDeckLoadArgs) {
  useEffect(() => {
    if (!canvasProjectId) {
      recordDeckWriteReason('builder-await-project');
      setDeckRevision(null);
      setDeckLoadError(null);
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
          dedupe: false,
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
        if (payload.data?.projectId !== canvasProjectId) {
          throw new Error('deck_project_identity_mismatch');
        }

        const savedDeck =
          payload.data?.deck && typeof payload.data.deck === 'object'
            ? (payload.data.deck as DeckDocument)
            : null;
        const loadResult = resolveProjectDeckLoadResult(savedDeck);
        if (loadResult.deck.id !== builderDeckId) {
          throw new Error('deck_identity_mismatch');
        }
        const loadedRevision =
          typeof payload.data?.meta?.deckRevision === 'string'
            ? payload.data.meta.deckRevision
            : null;
        if (!loadedRevision) {
          throw new Error('deck_revision_missing');
        }

        recordDeckWriteReason('deck-load');
        setDeck(loadResult.deck);
        // Compare autosave against the actual persisted board.
        const persistedDeck = savedDeck || loadResult.deck;
        lastPersistedBoardFingerprintRef.current = JSON.stringify({
          nodes: persistedDeck.nodes,
          edges: persistedDeck.edges,
        });
        lastPersistedBoardSnapshotRef.current = snapshotDeckBoard(persistedDeck);
        setDeckRevision(loadedRevision);
        setStateLoaded(true);
        setDeckLoadError(null);
        setDeckStatusMessage('Canvas loaded.');
        console.info('[builder][deck-load-proof]', {
          projectId: canvasProjectId,
          deckId: builderDeckId,
          reason: 'deck-load',
          source: 'backend_saved_deck',
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
        // A failed or incomplete request never promotes the in-memory bootstrap
        // document (or any unsaved quick-add mutation) to a loaded canvas.
        setStateLoaded(false);
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
    builderDeckId,
    canvasProjectId,
    formatBuilderStatusMessage,
    lastPersistedBoardFingerprintRef,
    lastPersistedBoardSnapshotRef,
    projectsApi,
    recordDeckWriteReason,
    reloadToken,
    resolveProjectDeckLoadResult,
    setDeck,
    setDeckLoadBusy,
    setDeckLoadError,
    setDeckRevision,
    setDeckStatusMessage,
    setStateLoaded,
    snapshotDeckBoard,
  ]);
}
