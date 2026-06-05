import { useEffect } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';

import { safeJson } from '../../../components/builder/requestGuards';
import type { DeckDocument } from '../../../types/agentgraph';

type IntegrityResult = {
  ok: boolean;
  removedNodeIds: string[];
  message?: string;
};

type UseAgentBuilderAutosaveArgs = {
  builderDev: boolean;
  canvasProjectId: string;
  projectsApi: string;
  builderDeckId: string;
  deck: DeckDocument;
  deckRevision: string | null;
  deckLoadBusy: boolean;
  deckLoadError: string | null;
  stateLoaded: boolean;
  layoutAutosaveAbortRef: MutableRefObject<AbortController | null>;
  lastPersistedBoardFingerprintRef: MutableRefObject<string | null>;
  lastPersistedBoardSnapshotRef: MutableRefObject<unknown>;
  lastDeckPersistReasonRef: MutableRefObject<string | null>;
  evaluateBoardIntegrityForSave: (
    nextDeck: DeckDocument,
    reason: string,
  ) => IntegrityResult;
  snapshotDeckBoard: (document: DeckDocument) => unknown;
  formatBuilderStatusMessage: (
    errorMessage: unknown,
    fallbackMessage: string,
  ) => string;
  isAbortLikeError: (error: unknown) => boolean;
  setDeckRevision: Dispatch<SetStateAction<string | null>>;
  setDeckStatusMessage: Dispatch<SetStateAction<string | null>>;
};

export default function useAgentBuilderAutosave({
  builderDev,
  canvasProjectId,
  projectsApi,
  builderDeckId,
  deck,
  deckRevision,
  deckLoadBusy,
  deckLoadError,
  stateLoaded,
  layoutAutosaveAbortRef,
  lastPersistedBoardFingerprintRef,
  lastPersistedBoardSnapshotRef,
  lastDeckPersistReasonRef,
  evaluateBoardIntegrityForSave,
  snapshotDeckBoard,
  formatBuilderStatusMessage,
  isAbortLikeError,
  setDeckRevision,
  setDeckStatusMessage,
}: UseAgentBuilderAutosaveArgs) {
  useEffect(() => {
    if (!canvasProjectId || !stateLoaded || deckLoadBusy || deckLoadError) return;
    const boardFingerprint = JSON.stringify({
      nodes: deck.nodes,
      edges: deck.edges,
    });
    if (lastPersistedBoardFingerprintRef.current === boardFingerprint) return;

    const timer = window.setTimeout(() => {
      const reason = lastDeckPersistReasonRef.current || 'board-autosave';
      const integrity = evaluateBoardIntegrityForSave(deck, reason);
      if (!integrity.ok) {
        setDeckStatusMessage(integrity.message ?? null);
        console.warn('[builder][deck-save-proof]', {
          projectId: canvasProjectId,
          deckId: builderDeckId,
          reason,
          nodeCount: deck.nodes.length,
          edgeCount: deck.edges.length,
          revisionBefore: deckRevision,
          revisionAfter: null,
          ok: false,
          error: 'deck_integrity_blocked',
          removedNodeIds: integrity.removedNodeIds,
        });
        return;
      }
      const revisionBefore = deckRevision;
      const controller = new AbortController();
      layoutAutosaveAbortRef.current?.abort();
      layoutAutosaveAbortRef.current = controller;
      void (async () => {
        try {
          const response = await fetch(
            `${projectsApi}/${canvasProjectId}/decks/${builderDeckId}`,
            {
              method: 'PUT',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                document: {
                  ...deck,
                  id: builderDeckId,
                },
                expectedRevision: deckRevision,
                integrity: {
                  reason,
                  removedNodeIds: integrity.removedNodeIds,
                },
              }),
              signal: controller.signal,
            },
          );
          const data = await safeJson(response);
          if (!response.ok) {
            const errorMessage = String(data?.error || 'deck_save_failed').trim();
            if (errorMessage === 'deck_conflict') {
              setDeckRevision(null);
            }
            setDeckStatusMessage(
              formatBuilderStatusMessage(
                errorMessage,
                'Could not save the current board.',
              ),
            );
            console.warn('[builder][deck-save-proof]', {
              projectId: canvasProjectId,
              deckId: builderDeckId,
              reason,
              nodeCount: deck.nodes.length,
              edgeCount: deck.edges.length,
              revisionBefore,
              revisionAfter: null,
              ok: false,
              error: errorMessage,
            });
            if (builderDev) {
              console.warn('[builder] layout autosave failed', {
                error: errorMessage,
              });
            }
            return;
          }
          const revisionAfter =
            typeof data?.meta?.deckRevision === 'string'
              ? data.meta.deckRevision
              : deckRevision;
          if (typeof data?.meta?.deckRevision === 'string') {
            setDeckRevision(data.meta.deckRevision);
          }
          lastPersistedBoardFingerprintRef.current = boardFingerprint;
          lastPersistedBoardSnapshotRef.current = snapshotDeckBoard(deck);
          console.info('[builder][deck-save-proof]', {
            projectId: canvasProjectId,
            deckId: builderDeckId,
            reason,
            nodeCount: deck.nodes.length,
            edgeCount: deck.edges.length,
            revisionBefore,
            revisionAfter,
            ok: true,
          });
        } catch (error) {
          if (isAbortLikeError(error)) return;
          const errorMessage =
            typeof error === 'object' && error !== null && 'message' in error
              ? (error as { message?: unknown }).message
              : undefined;
          setDeckStatusMessage(
            formatBuilderStatusMessage(
              errorMessage,
              'Could not save the current board.',
            ),
          );
          console.warn('[builder][deck-save-proof]', {
            projectId: canvasProjectId,
            deckId: builderDeckId,
            reason,
            nodeCount: deck.nodes.length,
            edgeCount: deck.edges.length,
            revisionBefore,
            revisionAfter: null,
            ok: false,
            error: String(errorMessage || 'deck_save_exception'),
          });
          if (builderDev) {
            console.warn('[builder] layout autosave exception', error);
          }
        }
      })();
    }, 500);
    return () => {
      window.clearTimeout(timer);
    };
  }, [
    builderDeckId,
    builderDev,
    canvasProjectId,
    deck,
    deckLoadError,
    deckLoadBusy,
    deckRevision,
    evaluateBoardIntegrityForSave,
    formatBuilderStatusMessage,
    isAbortLikeError,
    lastDeckPersistReasonRef,
    lastPersistedBoardFingerprintRef,
    lastPersistedBoardSnapshotRef,
    layoutAutosaveAbortRef,
    projectsApi,
    setDeckRevision,
    setDeckStatusMessage,
    snapshotDeckBoard,
    stateLoaded,
  ]);
}
