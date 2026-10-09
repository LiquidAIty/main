import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { Dispatch, SetStateAction } from 'react';

import { cloneDeckDocument } from '../deck/deckPrimitives';
import type { DeckCard, DeckDocument, DeckEdge } from '../../../types/agentgraph';

type UseAgentBuilderDeckArgs = {
  builderDev: boolean;
  canvasProjectId: string;
  createInitialDeck: () => DeckDocument;
};

export default function useAgentBuilderDeck({
  builderDev,
  canvasProjectId,
  createInitialDeck,
}: UseAgentBuilderDeckArgs) {
  const [deck, setDeckState] = useState<DeckDocument>(() => createInitialDeck());
  const [deckRevision, setDeckRevision] = useState<string | null>(null);
  const [deckLoadBusy, setDeckLoadBusy] = useState(false);
  const [deckSaveBusy, setDeckSaveBusy] = useState(false);
  const [deckStatusMessage, setDeckStatusMessage] = useState<string | null>(null);
  const [deckLoadError, setDeckLoadError] = useState<string | null>(null);
  const [stateLoaded, setStateLoaded] = useState(false);
  const [transientCardIds, setTransientCardIds] = useState<Set<string>>(
    () => new Set(),
  );

  const currentDeckRef = useRef(deck);
  const deckSaveAbortRef = useRef<AbortController | null>(null);
  const lastDeckWriteReasonRef = useRef<string | null>(null);
  const lastUiOnlyActionRef = useRef<string | null>(null);
  const lastDeckFingerprintRef = useRef<string | null>(null);
  const lastPersistedBoardFingerprintRef = useRef<string | null>(null);
  const lastPersistedBoardSnapshotRef = useRef<{
    nodes: DeckCard[];
    edges: DeckEdge[];
  } | null>(null);
  const lastDeckPersistReasonRef = useRef<string | null>(null);

  useEffect(() => {
    currentDeckRef.current = deck;
  }, [deck]);

  const recordDeckWriteReason = useCallback((reason: string) => {
    lastDeckWriteReasonRef.current = reason;
    lastDeckPersistReasonRef.current = reason;
    lastUiOnlyActionRef.current = null;
  }, []);

  const recordUiOnlyAction = useCallback((action: string) => {
    if (!builderDev) return;
    lastUiOnlyActionRef.current = action;
  }, [builderDev]);

  const snapshotDeckBoard = useCallback((document: DeckDocument) => ({
    nodes: cloneDeckDocument(document.nodes),
    edges: cloneDeckDocument(document.edges),
  }), []);

  const evaluateBoardIntegrityForSave = useCallback((
    nextDeck: DeckDocument,
    reason: string,
  ) => {
    const lastPersisted = lastPersistedBoardSnapshotRef.current;
    if (!lastPersisted) {
      return { ok: true, removedNodeIds: [] as string[] };
    }
    const nextNodeIds = new Set(nextDeck.nodes.map((node) => node.id));
    const removedNodeIds = lastPersisted.nodes
      .map((node) => node.id)
      .filter((nodeId) => !nextNodeIds.has(nodeId));
    if (lastPersisted.nodes.length > 0 && nextDeck.nodes.length === 0) {
      return {
        ok: false,
        removedNodeIds,
        message: 'Blocked saving an empty board because the previous saved deck still had nodes.',
      };
    }
    if (removedNodeIds.length > 1) {
      return {
        ok: false,
        removedNodeIds,
        message: `Blocked saving a partial board because ${removedNodeIds.length} nodes disappeared during ${reason}.`,
      };
    }
    return { ok: true, removedNodeIds };
  }, []);

  const setDeck = useCallback<Dispatch<SetStateAction<DeckDocument>>>(
    (update) => {
      setDeckState((previous) => {
        const next = typeof update === 'function'
          ? (update as (value: DeckDocument) => DeckDocument)(previous)
          : update;
        if (builderDev && JSON.stringify(previous) === JSON.stringify(next)) {
          console.warn('[builder] ignored deck write without persisted graph mutation', {
            reason: lastDeckWriteReasonRef.current || 'unknown',
          });
        }
        return next;
      });
    },
    [builderDev],
  );

  const setDeckFromPersistence = useCallback<
    Dispatch<SetStateAction<DeckDocument>>
  >((update) => {
    setDeck((current) => {
      const persisted = typeof update === 'function'
        ? (update as (value: DeckDocument) => DeckDocument)(current)
        : update;
      if (transientCardIds.size === 0) return persisted;
      const persistedNodeIds = new Set(persisted.nodes.map((node) => node.id));
      const transientNodes = current.nodes.filter((node) => (
        transientCardIds.has(node.id) && !persistedNodeIds.has(node.id)
      ));
      const persistedEdgeIds = new Set(persisted.edges.map((edge) => edge.id));
      const transientEdges = current.edges.filter((edge) => (
        (transientCardIds.has(edge.source) || transientCardIds.has(edge.target))
        && !persistedEdgeIds.has(edge.id)
      ));
      return {
        ...persisted,
        version: Math.max(current.version, persisted.version),
        nodes: [...persisted.nodes, ...transientNodes],
        edges: [...persisted.edges, ...transientEdges],
      };
    });
  }, [setDeck, transientCardIds]);

  useEffect(() => {
    setTransientCardIds(new Set());
  }, [canvasProjectId]);

  const deckFingerprint = useMemo(
    () => (builderDev ? JSON.stringify(deck) : ''),
    [builderDev, deck],
  );
  useEffect(() => {
    if (!builderDev) return;
    const previousFingerprint = lastDeckFingerprintRef.current;
    lastDeckFingerprintRef.current = deckFingerprint;
    if (previousFingerprint === null || previousFingerprint === deckFingerprint) return;
    const writeReason = lastDeckWriteReasonRef.current;
    const uiOnlyAction = lastUiOnlyActionRef.current;
    if (!writeReason) {
      console.warn('[builder] deck payload changed without an explicit write reason', {
        action: uiOnlyAction || 'unknown',
      });
    } else if (uiOnlyAction) {
      console.warn('[builder] deck payload changed after a UI-only action', {
        action: uiOnlyAction,
        reason: writeReason,
      });
    }
    lastDeckWriteReasonRef.current = null;
    lastUiOnlyActionRef.current = null;
  }, [builderDev, deckFingerprint]);

  return {
    deck,
    setDeck,
    setDeckFromPersistence,
    deckRevision,
    setDeckRevision,
    deckLoadBusy,
    setDeckLoadBusy,
    deckSaveBusy,
    setDeckSaveBusy,
    deckStatusMessage,
    setDeckStatusMessage,
    deckLoadError,
    setDeckLoadError,
    stateLoaded,
    setStateLoaded,
    transientCardIds,
    setTransientCardIds,
    currentDeckRef,
    deckSaveAbortRef,
    lastPersistedBoardFingerprintRef,
    lastPersistedBoardSnapshotRef,
    lastDeckPersistReasonRef,
    recordDeckWriteReason,
    recordUiOnlyAction,
    snapshotDeckBoard,
    evaluateBoardIntegrityForSave,
  };
}
