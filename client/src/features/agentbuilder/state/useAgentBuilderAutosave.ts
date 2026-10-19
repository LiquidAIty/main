/**
 * Entity: Agent Builder
 * Relationship: This file serializes every Agent Builder deck write through one compare-and-swap coordinator and preserves newer local edits.
 * Entity: Saved Cards
 * Relationship: This file persists the exact current Card document and optimistic revision, promotes explicit saves, and freezes on an uncertain commit until canonical reload.
 * Entity: Card Topology
 * Relationship: This file persists Card placement and edges through the same single writer while excluding unsaved transient Cards and their incident edges.
 * Entity: Projects
 * Relationship: This file fences queued and in-flight saves to the exact active Project and rejects completions from a superseded workspace scope.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';

import { safeJson } from '../../../components/builder/requestGuards';
import type { DeckDocument } from '../../../types/agentgraph';

type IntegrityResult = {
  ok: boolean;
  removedNodeIds: string[];
  message?: string;
};

type PersistWaiter = {
  resolve: () => void;
  reject: (error: Error) => void;
};

type PersistRequest = {
  document: DeckDocument;
  fingerprint: string;
  reason: string;
  scopeGeneration: number;
  scopeKey: string;
  waiters: PersistWaiter[];
};

type PersistenceScope = {
  generation: number;
  key: string;
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
  lastPersistedBoardFingerprintRef: MutableRefObject<string | null>;
  lastPersistedBoardSnapshotRef: MutableRefObject<unknown>;
  lastDeckPersistReasonRef: MutableRefObject<string | null>;
  evaluateBoardIntegrityForSave: (
    nextDeck: DeckDocument,
    reason: string,
  ) => IntegrityResult;
  snapshotDeckBoard: (document: DeckDocument) => unknown;
  readDeckDocument: (value: Partial<DeckDocument> | null | undefined) => DeckDocument;
  formatBuilderStatusMessage: (
    errorMessage: unknown,
    fallbackMessage: string,
  ) => string;
  setDeckRevision: Dispatch<SetStateAction<string | null>>;
  setDeck: Dispatch<SetStateAction<DeckDocument>>;
  setDeckSaveBusy: Dispatch<SetStateAction<boolean>>;
  setDeckStatusMessage: Dispatch<SetStateAction<string | null>>;
};

type PersistenceConfig = UseAgentBuilderAutosaveArgs & {
  transientCardIds: ReadonlySet<string>;
};

function boardFingerprint(deck: DeckDocument): string {
  return JSON.stringify({ nodes: deck.nodes, edges: deck.edges });
}

function errorText(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (typeof error === 'string' && error.trim()) return error.trim();
  return fallback;
}

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

export default function useAgentBuilderAutosave(args: UseAgentBuilderAutosaveArgs) {
  const configRef = useRef<PersistenceConfig>({
    ...args,
    transientCardIds: args.transientCardIds ?? EMPTY_TRANSIENT_CARD_IDS,
  });
  configRef.current = {
    ...args,
    transientCardIds: args.transientCardIds ?? EMPTY_TRANSIENT_CARD_IDS,
  };

  const revisionRef = useRef<string | null>(args.deckRevision);
  revisionRef.current = args.deckRevision;
  const currentDeckRef = useRef(args.deck);
  currentDeckRef.current = args.deck;

  const initialScopeKey = `${args.canvasProjectId}:${args.builderDeckId}`;
  const scopeRef = useRef<PersistenceScope>({ generation: 0, key: initialScopeKey });
  const inFlightRef = useRef(false);
  const inFlightRequestRef = useRef<PersistRequest | null>(null);
  const manualQueueRef = useRef<PersistRequest[]>([]);
  const pendingAutosaveRef = useRef<PersistRequest | null>(null);
  const frozenRef = useRef(false);
  const mountedRef = useRef(true);
  const [persistenceFrozen, setPersistenceFrozen] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  const rejectRequest = useCallback((request: PersistRequest, error: Error) => {
    for (const waiter of request.waiters) waiter.reject(error);
  }, []);

  const rejectPending = useCallback((error: Error) => {
    const pendingAutosave = pendingAutosaveRef.current;
    pendingAutosaveRef.current = null;
    if (pendingAutosave) rejectRequest(pendingAutosave, error);
    const pendingManual = manualQueueRef.current.splice(0);
    for (const request of pendingManual) rejectRequest(request, error);
  }, [rejectRequest]);

  const freezePersistence = useCallback((message: string) => {
    if (!mountedRef.current) return;
    const config = configRef.current;
    frozenRef.current = true;
    revisionRef.current = null;
    setPersistenceFrozen(true);
    config.setDeckRevision(null);
    config.setDeckStatusMessage(message);
    rejectPending(new Error('deck_reload_required'));
  }, [rejectPending]);

  const drainRef = useRef<() => void>(() => undefined);

  const executeRequest = useCallback(async (request: PersistRequest) => {
    const config = configRef.current;
    const revisionBefore = revisionRef.current;
    if (!revisionBefore) {
      rejectRequest(request, new Error('deck_reload_required'));
      return;
    }

    inFlightRef.current = true;
    inFlightRequestRef.current = request;
    if (mountedRef.current) config.setDeckSaveBusy(true);

    try {
      const response = await fetch(
        `${config.projectsApi}/${config.canvasProjectId}/decks/${config.builderDeckId}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            document: {
              ...request.document,
              id: config.builderDeckId,
            },
            expectedRevision: revisionBefore,
          }),
        },
      );
      const data = await safeJson(response);
      const activeScope = scopeRef.current;
      if (
        activeScope.generation !== request.scopeGeneration
        || activeScope.key !== request.scopeKey
      ) {
        rejectRequest(request, new Error('deck_workspace_changed'));
        return;
      }

      if (!response.ok) {
        const message = String(data?.error || 'deck_save_failed').trim();
        if (message === 'deck_conflict') {
          freezePersistence(
            'A newer saved canvas exists. Reload the canonical canvas before editing or saving again.',
          );
        } else if (mountedRef.current) {
          config.setDeckStatusMessage(
            config.formatBuilderStatusMessage(message, 'Could not save the current board.'),
          );
        }
        rejectRequest(request, new Error(message));
        console.warn('[builder][deck-save-proof]', {
          projectId: config.canvasProjectId,
          deckId: config.builderDeckId,
          reason: request.reason,
          nodeCount: request.document.nodes.length,
          edgeCount: request.document.edges.length,
          revisionBefore,
          revisionAfter: null,
          ok: false,
          error: message,
        });
        return;
      }

      if (
        data?.projectId !== config.canvasProjectId
        || !data?.deck
        || typeof data.deck !== 'object'
        || data.deck.id !== config.builderDeckId
        || typeof data?.meta?.deckRevision !== 'string'
        || !data.meta.deckRevision
        || data.meta.deckRevision === revisionBefore
      ) {
        throw new Error('deck_save_readback_invalid');
      }

      const canonicalDeck = config.readDeckDocument(data.deck as DeckDocument);
      const canonicalFingerprint = boardFingerprint(canonicalDeck);
      const revisionAfter = data.meta.deckRevision;
      revisionRef.current = revisionAfter;
      config.setDeckRevision(revisionAfter);
      config.lastPersistedBoardFingerprintRef.current = canonicalFingerprint;
      config.lastPersistedBoardSnapshotRef.current = config.snapshotDeckBoard(canonicalDeck);
      config.setDeck((currentDeck) => (
        boardFingerprint(currentDeck) === request.fingerprint
          ? canonicalDeck
          : currentDeck
      ));
      if (request.reason === 'manual-save') {
        config.setDeckStatusMessage('Board saved.');
      }
      console.info('[builder][deck-save-proof]', {
        projectId: config.canvasProjectId,
        deckId: config.builderDeckId,
        reason: request.reason,
        nodeCount: canonicalDeck.nodes.length,
        edgeCount: canonicalDeck.edges.length,
        revisionBefore,
        revisionAfter,
        ok: true,
      });
      for (const waiter of request.waiters) waiter.resolve();
    } catch (error) {
      const activeScope = scopeRef.current;
      if (
        activeScope.generation !== request.scopeGeneration
        || activeScope.key !== request.scopeKey
      ) {
        rejectRequest(request, new Error('deck_workspace_changed'));
        return;
      }
      const message = errorText(error, 'deck_save_exception');
      console.warn('[builder][deck-save-proof]', {
        projectId: config.canvasProjectId,
        deckId: config.builderDeckId,
        reason: request.reason,
        nodeCount: request.document.nodes.length,
        edgeCount: request.document.edges.length,
        revisionBefore,
        revisionAfter: null,
        ok: false,
        error: message,
      });
      if (config.builderDev) console.warn('[builder] deck persistence exception', error);
      rejectRequest(request, error instanceof Error ? error : new Error(message));
      freezePersistence(
        'The save result is uncertain. Your local canvas is retained; reload the canonical canvas before editing or saving again.',
      );
    } finally {
      if (inFlightRequestRef.current === request) inFlightRequestRef.current = null;
      inFlightRef.current = false;
      if (mountedRef.current) configRef.current.setDeckSaveBusy(false);
      drainRef.current();
    }
  }, [freezePersistence, rejectRequest]);

  const drain = useCallback(() => {
    if (inFlightRef.current || frozenRef.current) return;
    const request = manualQueueRef.current.shift() ?? pendingAutosaveRef.current;
    if (!request) return;
    if (request === pendingAutosaveRef.current) pendingAutosaveRef.current = null;
    void executeRequest(request);
  }, [executeRequest]);
  drainRef.current = drain;

  const buildRequest = useCallback((
    document: DeckDocument,
    reason: string,
    waiter?: PersistWaiter,
  ): PersistRequest | null => {
    const config = configRef.current;
    const scope = scopeRef.current;
    const integrity = config.evaluateBoardIntegrityForSave(document, reason);
    if (!integrity.ok) {
      const message = integrity.message || 'deck_integrity_blocked';
      config.setDeckStatusMessage(message);
      console.warn('[builder][deck-save-proof]', {
        projectId: config.canvasProjectId,
        deckId: config.builderDeckId,
        reason,
        nodeCount: document.nodes.length,
        edgeCount: document.edges.length,
        revisionBefore: revisionRef.current,
        revisionAfter: null,
        ok: false,
        error: 'deck_integrity_blocked',
        removedNodeIds: integrity.removedNodeIds,
      });
      waiter?.reject(new Error(message));
      return null;
    }
    return {
      document,
      fingerprint: boardFingerprint(document),
      reason,
      scopeGeneration: scope.generation,
      scopeKey: scope.key,
      waiters: waiter ? [waiter] : [],
    };
  }, []);

  const enqueueAutosave = useCallback((document: DeckDocument, reason: string) => {
    if (frozenRef.current || !revisionRef.current) return;
    const request = buildRequest(document, reason);
    if (!request) return;

    if (inFlightRequestRef.current?.fingerprint === request.fingerprint) return;
    if (manualQueueRef.current.some((entry) => entry.fingerprint === request.fingerprint)) return;
    pendingAutosaveRef.current = request;
    drain();
  }, [buildRequest, drain]);

  const handleSaveDeck = useCallback((document?: DeckDocument): Promise<void> => (
    new Promise<void>((resolve, reject) => {
      const config = configRef.current;
      if (!config.canvasProjectId) {
        const error = new Error('Open a canvas before saving.');
        config.setDeckStatusMessage(error.message);
        reject(error);
        return;
      }
      if (frozenRef.current || !revisionRef.current) {
        const error = new Error('Reload the canonical canvas before saving.');
        config.setDeckStatusMessage(error.message);
        reject(error);
        return;
      }
      const requestedDeck = document ?? projectDeckForPersistence(
        currentDeckRef.current,
        config.transientCardIds,
      );
      const waiter = { resolve, reject };
      const request = buildRequest(requestedDeck, 'manual-save', waiter);
      if (!request) return;

      const inFlight = inFlightRequestRef.current;
      if (inFlight?.fingerprint === request.fingerprint) {
        inFlight.waiters.push(waiter);
        return;
      }
      const queued = manualQueueRef.current.find(
        (entry) => entry.fingerprint === request.fingerprint,
      );
      if (queued) {
        queued.waiters.push(waiter);
        return;
      }
      if (pendingAutosaveRef.current?.fingerprint === request.fingerprint) {
        pendingAutosaveRef.current = null;
      }
      // The explicit save was built from the newest caller-owned snapshot.
      // Any older pending autosave must not run after it and roll the board back.
      pendingAutosaveRef.current = null;
      config.setDeckStatusMessage('Saving deck...');
      manualQueueRef.current.push(request);
      drain();
    })
  ), [buildRequest, drain]);

  const reloadCanonical = useCallback(() => {
    rejectPending(new Error('deck_reload_requested'));
    frozenRef.current = false;
    revisionRef.current = null;
    setPersistenceFrozen(false);
    configRef.current.setDeckRevision(null);
    configRef.current.setDeckStatusMessage('Reloading canonical canvas...');
    setReloadToken((current) => current + 1);
  }, [rejectPending]);

  useEffect(() => {
    const nextScopeKey = `${args.canvasProjectId}:${args.builderDeckId}`;
    if (scopeRef.current.key === nextScopeKey) return;
    scopeRef.current = {
      generation: scopeRef.current.generation + 1,
      key: nextScopeKey,
    };
    rejectPending(new Error('deck_workspace_changed'));
    frozenRef.current = false;
    revisionRef.current = args.deckRevision;
    setPersistenceFrozen(false);
  }, [args.builderDeckId, args.canvasProjectId, args.deckRevision, rejectPending]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      scopeRef.current = {
        ...scopeRef.current,
        generation: scopeRef.current.generation + 1,
      };
      rejectPending(new Error('deck_workspace_unmounted'));
    };
  }, [rejectPending]);

  useEffect(() => {
    const config = configRef.current;
    if (
      !config.canvasProjectId
      || !config.stateLoaded
      || !config.deckRevision
      || config.deckLoadBusy
      || config.deckLoadError
      || persistenceFrozen
    ) return;
    const persistableDeck = projectDeckForPersistence(
      config.deck,
      config.transientCardIds,
    );
    const fingerprint = boardFingerprint(persistableDeck);
    if (config.lastPersistedBoardFingerprintRef.current === fingerprint) return;

    const timer = window.setTimeout(() => {
      const latest = configRef.current;
      const latestDocument = projectDeckForPersistence(
        latest.deck,
        latest.transientCardIds,
      );
      if (
        latest.canvasProjectId !== config.canvasProjectId
        || latest.builderDeckId !== config.builderDeckId
        || latest.lastPersistedBoardFingerprintRef.current === boardFingerprint(latestDocument)
      ) return;
      enqueueAutosave(
        latestDocument,
        latest.lastDeckPersistReasonRef.current || 'board-autosave',
      );
    }, 500);
    return () => window.clearTimeout(timer);
  }, [
    args.builderDeckId,
    args.canvasProjectId,
    args.deck,
    args.deckLoadBusy,
    args.deckLoadError,
    args.deckRevision,
    args.stateLoaded,
    args.transientCardIds,
    enqueueAutosave,
    persistenceFrozen,
  ]);

  return {
    handleSaveDeck,
    persistenceFrozen,
    reloadCanonical,
    reloadToken,
  };
}
