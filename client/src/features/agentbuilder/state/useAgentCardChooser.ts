import { useCallback, useState } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';

import {
  buildQuickAddAssistCard,
  readDeckDocument,
} from '../deck/deckDocument';
import { DEFAULT_PROJECT_DECK_ID } from '../deck/newProjectDeck';
import type { DeckCard, DeckDocument, DeckEdge } from '../../../types/agentgraph';

export type AvailableSavedCard = {
  cardId: string;
  cardRevisionId: string;
  title: string;
  subtitle: string | null;
  runtimeProfile: string;
};

type UseAgentCardChooserArgs = {
  canonicalDeckReady: boolean;
  canvasProjectId: string;
  deckRevision: string | null;
  currentDeckRef: MutableRefObject<DeckDocument>;
  cardDraftFlushRef: MutableRefObject<(() => Promise<boolean>) | null>;
  setTransientCardIds: Dispatch<SetStateAction<Set<string>>>;
  setDeck: Dispatch<SetStateAction<DeckDocument>>;
  setDeckFromPersistence: Dispatch<SetStateAction<DeckDocument>>;
  setDeckRevision: Dispatch<SetStateAction<string | null>>;
  setDeckStatusMessage: Dispatch<SetStateAction<string | null>>;
  setInspectorDrawerOpen: Dispatch<SetStateAction<boolean>>;
  setSelectedCardId: Dispatch<SetStateAction<string | null>>;
  setSelectedEdgeId: Dispatch<SetStateAction<string | null>>;
  recordDeckWriteReason: (reason: string) => void;
  lastPersistedBoardFingerprintRef: MutableRefObject<string | null>;
  lastPersistedBoardSnapshotRef: MutableRefObject<{
    nodes: DeckCard[];
    edges: DeckEdge[];
  } | null>;
  snapshotDeckBoard: (document: DeckDocument) => {
    nodes: DeckCard[];
    edges: DeckEdge[];
  };
};

const PROJECTS_API = '/api/projects';

export default function useAgentCardChooser({
  canonicalDeckReady,
  canvasProjectId,
  deckRevision,
  currentDeckRef,
  cardDraftFlushRef,
  setTransientCardIds,
  setDeck,
  setDeckFromPersistence,
  setDeckRevision,
  setDeckStatusMessage,
  setInspectorDrawerOpen,
  setSelectedCardId,
  setSelectedEdgeId,
  recordDeckWriteReason,
  lastPersistedBoardFingerprintRef,
  lastPersistedBoardSnapshotRef,
  snapshotDeckBoard,
}: UseAgentCardChooserArgs) {
  const [open, setOpen] = useState(false);
  const [choices, setChoices] = useState<AvailableSavedCard[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = useCallback(() => {
    if (!busy) setOpen(false);
  }, [busy]);

  const openChooser = useCallback(async () => {
    if (!canonicalDeckReady) {
      setDeckStatusMessage('Wait for the canvas to load.');
      return;
    }
    if (cardDraftFlushRef.current && !(await cardDraftFlushRef.current())) return;
    setOpen(true);
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        `${PROJECTS_API}/${canvasProjectId}/decks/${DEFAULT_PROJECT_DECK_ID}/saved-cards`,
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.ok !== true || !Array.isArray(payload.cards)) {
        throw new Error(String(payload?.error || 'Saved Cards unavailable.'));
      }
      setChoices(payload.cards as AvailableSavedCard[]);
    } catch (reason) {
      setChoices([]);
      setError(reason instanceof Error ? reason.message : 'Saved Cards unavailable.');
    } finally {
      setBusy(false);
    }
  }, [
    canonicalDeckReady,
    canvasProjectId,
    cardDraftFlushRef,
    setDeckStatusMessage,
  ]);

  const attachSavedCard = useCallback(async (choice: AvailableSavedCard) => {
    if (!canvasProjectId || !deckRevision || busy) return;
    setBusy(true);
    setError(null);
    const rightMostX = currentDeckRef.current.nodes.reduce(
      (maximum, node) => Math.max(maximum, Number(node.position?.x || 0)),
      -220,
    );
    try {
      const response = await fetch(
        `${PROJECTS_API}/${canvasProjectId}/decks/${DEFAULT_PROJECT_DECK_ID}/memberships`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            cardId: choice.cardId,
            cardRevisionId: choice.cardRevisionId,
            expectedDeckRevision: deckRevision,
            position: { x: rightMostX + 320, y: 40 },
          }),
        },
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.ok !== true || !payload.deck) {
        throw new Error(String(payload?.error || 'Card attachment failed.'));
      }
      const loaded = readDeckDocument(payload.deck);
      const nextRevision = typeof payload?.meta?.deckRevision === 'string'
        ? payload.meta.deckRevision
        : null;
      if (!nextRevision) throw new Error('deck_revision_missing');
      recordDeckWriteReason('saved-card-attach');
      lastPersistedBoardFingerprintRef.current = JSON.stringify({
        nodes: loaded.nodes,
        edges: loaded.edges,
      });
      lastPersistedBoardSnapshotRef.current = snapshotDeckBoard(loaded);
      setDeckFromPersistence(loaded);
      setDeckRevision(nextRevision);
      setChoices((current) => current.filter((card) => card.cardId !== choice.cardId));
      setOpen(false);
      setSelectedEdgeId(null);
      setSelectedCardId(choice.cardId);
      setDeckStatusMessage(`Added existing saved Card ${choice.title} to this Project.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Card attachment failed.');
    } finally {
      setBusy(false);
    }
  }, [
    busy,
    canvasProjectId,
    currentDeckRef,
    deckRevision,
    lastPersistedBoardFingerprintRef,
    lastPersistedBoardSnapshotRef,
    recordDeckWriteReason,
    setDeckFromPersistence,
    setDeckRevision,
    setDeckStatusMessage,
    setSelectedCardId,
    setSelectedEdgeId,
    snapshotDeckBoard,
  ]);

  const createNewAgent = useCallback(async () => {
    if (!canonicalDeckReady || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/idd/card-editor');
      const dictionary = await response.json().catch(() => null);
      const binding = dictionary?.templates?.template_assist?.runtime;
      if (
        !response.ok
        || dictionary?.ok !== true
        || binding?.kind !== 'hermes'
        || binding?.mode !== 'delegate'
      ) throw new Error('Template unavailable.');

      const { nextNode } = buildQuickAddAssistCard(currentDeckRef.current, binding);
      recordDeckWriteReason('deck-quick-add');
      setTransientCardIds((current) => new Set(current).add(nextNode.id));
      setDeck((current) => ({
        ...current,
        version: current.version + 1,
        nodes: [...current.nodes, nextNode],
      }));
      setOpen(false);
      setSelectedEdgeId(null);
      setInspectorDrawerOpen(true);
      setSelectedCardId(nextNode.id);
      setDeckStatusMessage(
        `Added ${nextNode.title}. Save the Card to establish its permanent Card/profile authority.`,
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Template unavailable.');
    } finally {
      setBusy(false);
    }
  }, [
    busy,
    canonicalDeckReady,
    currentDeckRef,
    recordDeckWriteReason,
    setDeck,
    setDeckStatusMessage,
    setInspectorDrawerOpen,
    setSelectedCardId,
    setSelectedEdgeId,
    setTransientCardIds,
  ]);

  const markCardPersisted = useCallback((cardId: string) => {
    setTransientCardIds((current) => {
      if (!current.has(cardId)) return current;
      const next = new Set(current);
      next.delete(cardId);
      return next;
    });
  }, [setTransientCardIds]);

  return {
    open,
    choices,
    busy,
    error,
    close,
    openChooser,
    attachSavedCard,
    createNewAgent,
    markCardPersisted,
  };
}
