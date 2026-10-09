import { useEffect } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';

import { safeJson } from '../api/requestGuards';
import type { DeckDocument } from '../../../types/agentgraph';

type IntegrityResult = {
  ok: boolean;
  removedNodeIds: string[];
  message?: string;
};

const EMPTY_TRANSIENT_CARD_IDS: ReadonlySet<string> = new Set();

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
  transientCardIds?: ReadonlySet<string>;
  deckSaveAbortRef: MutableRefObject<AbortController | null>;
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

export function projectDeckForPersistence(
  deck: DeckDocument,
  transientCardIds: ReadonlySet<string>,
  includedTransientCardIds: ReadonlySet<string> = new Set(),
): DeckDocument {
  const excludedCardIds = new Set(
    [...transientCardIds].filter((cardId) => !includedTransientCardIds.has(cardId)),
  );
  if (excludedCardIds.size === 0) return deck;
  return {
    ...deck,
    nodes: deck.nodes.filter((node) => !excludedCardIds.has(node.id)),
    edges: deck.edges.filter((edge) => (
      !excludedCardIds.has(edge.source) && !excludedCardIds.has(edge.target)
    )),
  };
}

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
  transientCardIds = EMPTY_TRANSIENT_CARD_IDS,
  deckSaveAbortRef,
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
    if (
      !canvasProjectId
      || !stateLoaded
      || !deckRevision
      || deckLoadBusy
      || deckLoadError
    ) return;
    const persistableDeck = projectDeckForPersistence(deck, transientCardIds);
    const boardFingerprint = JSON.stringify({
      nodes: persistableDeck.nodes,
      edges: persistableDeck.edges,
    });
    if (lastPersistedBoardFingerprintRef.current === boardFingerprint) return;

    const timer = window.setTimeout(() => {
      // Deck writes use compare-and-swap revisions, so overlapping requests
      // cannot be made safe by aborting the older browser request: the server
      // may already have committed it. Keep one write in flight. Its returned
      // revision rerenders this hook and schedules the latest unsaved board.
      if (deckSaveAbortRef.current) return;
      const reason = lastDeckPersistReasonRef.current || 'board-autosave';
      const integrity = evaluateBoardIntegrityForSave(persistableDeck, reason);
      if (!integrity.ok) {
        setDeckStatusMessage(integrity.message ?? null);
        console.warn('[builder][deck-save]', {
          projectId: canvasProjectId,
          deckId: builderDeckId,
          reason,
          nodeCount: persistableDeck.nodes.length,
          edgeCount: persistableDeck.edges.length,
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
      deckSaveAbortRef.current = controller;
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
                  ...persistableDeck,
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
            console.warn('[builder][deck-save]', {
              projectId: canvasProjectId,
              deckId: builderDeckId,
              reason,
              nodeCount: persistableDeck.nodes.length,
              edgeCount: persistableDeck.edges.length,
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
          lastPersistedBoardSnapshotRef.current = snapshotDeckBoard(persistableDeck);
          console.info('[builder][deck-save]', {
            projectId: canvasProjectId,
            deckId: builderDeckId,
            reason,
            nodeCount: persistableDeck.nodes.length,
            edgeCount: persistableDeck.edges.length,
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
          console.warn('[builder][deck-save]', {
            projectId: canvasProjectId,
            deckId: builderDeckId,
            reason,
            nodeCount: persistableDeck.nodes.length,
            edgeCount: persistableDeck.edges.length,
            revisionBefore,
            revisionAfter: null,
            ok: false,
            error: String(errorMessage || 'deck_save_exception'),
          });
          if (builderDev) {
            console.warn('[builder] layout autosave exception', error);
          }
        } finally {
          if (deckSaveAbortRef.current === controller) {
            deckSaveAbortRef.current = null;
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
    deckSaveAbortRef,
    projectsApi,
    setDeckRevision,
    setDeckStatusMessage,
    snapshotDeckBoard,
    stateLoaded,
    transientCardIds,
  ]);
}
