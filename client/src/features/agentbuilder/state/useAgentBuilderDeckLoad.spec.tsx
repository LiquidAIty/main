// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  guardedRequest: vi.fn(),
  waitForBackendReady: vi.fn(),
}));

vi.mock('../../../components/builder/backendReadiness', () => ({
  waitForBackendReady: mocks.waitForBackendReady,
}));

vi.mock('../../../components/builder/requestGuards', async () => {
  const actual = await vi.importActual<
    typeof import('../../../components/builder/requestGuards')
  >('../../../components/builder/requestGuards');
  return {
    ...actual,
    guardedRequest: mocks.guardedRequest,
  };
});

import { INITIAL_DECK } from '../deck/newProjectDeck';
import {
  readDeckDocument,
  resolveProjectDeckLoadResult,
} from '../deck/deckDocument';
import useAgentBuilderAutosave from './useAgentBuilderAutosave';
import useAgentBuilderDeckLoad from './useAgentBuilderDeckLoad';
import { useBuilderDeckPersistenceActions } from '../../../components/builder/useBuilderDeckPersistenceActions';
import type { DeckDocument } from '../../../types/agentgraph';

function canonicalDeck(): DeckDocument {
  return readDeckDocument(JSON.parse(JSON.stringify(INITIAL_DECK)) as DeckDocument);
}

function loadArgs(overrides: Record<string, unknown> = {}) {
  return {
    canvasProjectId: 'project-canonical',
    projectsApi: '/api/projects',
    builderDeckId: 'deck_builder',
    resolveProjectDeckLoadResult,
    formatBuilderStatusMessage: (value: unknown, fallback: string) =>
      typeof value === 'string' && value ? value : fallback,
    recordDeckWriteReason: vi.fn(),
    snapshotDeckBoard: vi.fn((deck: DeckDocument) => ({
      nodes: deck.nodes,
      edges: deck.edges,
    })),
    lastPersistedBoardFingerprintRef: { current: null },
    lastPersistedBoardSnapshotRef: { current: null },
    setDeck: vi.fn(),
    setDeckRevision: vi.fn(),
    setDeckLoadBusy: vi.fn(),
    setDeckLoadError: vi.fn(),
    setStateLoaded: vi.fn(),
    setDeckStatusMessage: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  mocks.guardedRequest.mockReset();
  mocks.waitForBackendReady.mockReset().mockResolvedValue(true);
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('canonical Agent Builder deck hydration', () => {
  it('promotes only the persisted canonical deck with a server revision', async () => {
    const deck = canonicalDeck();
    mocks.guardedRequest.mockResolvedValue({
      response: { ok: true },
      data: {
        deck,
        meta: { deckRevision: 'revision-canonical' },
      },
    });
    const args = loadArgs();

    renderHook(() => useAgentBuilderDeckLoad(args));

    await waitFor(() => expect(args.setDeck).toHaveBeenCalledWith(deck));
    expect(args.setDeckRevision).toHaveBeenLastCalledWith('revision-canonical');
    expect(args.setStateLoaded).toHaveBeenLastCalledWith(true);
    expect(deck.nodes).toHaveLength(6);
    expect(args.setDeck).toHaveBeenCalledWith(deck);
  });

  it('never promotes or replaces in-memory state when canonical hydration fails', async () => {
    mocks.guardedRequest.mockResolvedValue({
      response: { ok: false },
      data: { error: 'backend_temporarily_unavailable' },
    });
    const args = loadArgs({ canvasProjectId: 'project-temporary-failure' });

    renderHook(() => useAgentBuilderDeckLoad(args));

    await waitFor(() =>
      expect(args.setDeckLoadError).toHaveBeenLastCalledWith(
        'backend_temporarily_unavailable',
      ),
    );
    expect(args.setDeck).not.toHaveBeenCalled();
    expect(args.setStateLoaded).not.toHaveBeenCalledWith(true);
    expect(args.setStateLoaded).toHaveBeenLastCalledWith(false);
    expect(args.setDeckRevision).toHaveBeenLastCalledWith(null);
  });

  it('does not manufacture an empty replacement deck while no project is selected', () => {
    const args = loadArgs({ canvasProjectId: '' });

    renderHook(() => useAgentBuilderDeckLoad(args));

    expect(args.setDeck).not.toHaveBeenCalled();
    expect(args.setStateLoaded).toHaveBeenLastCalledWith(false);
    expect(mocks.guardedRequest).not.toHaveBeenCalled();
  });

  it('fails closed when the server omits canonical revision identity', async () => {
    mocks.guardedRequest.mockResolvedValue({
      response: { ok: true },
      data: { deck: canonicalDeck(), meta: {} },
    });
    const args = loadArgs({ canvasProjectId: 'project-missing-revision' });

    renderHook(() => useAgentBuilderDeckLoad(args));

    await waitFor(() =>
      expect(args.setDeckLoadError).toHaveBeenLastCalledWith(
        'deck_revision_missing',
      ),
    );
    expect(args.setDeck).not.toHaveBeenCalled();
    expect(args.setStateLoaded).not.toHaveBeenCalledWith(true);
  });
});

describe('canonical deck write guards', () => {
  it('does not autosave any deck without a loaded canonical revision', () => {
    vi.useFakeTimers();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const evaluateBoardIntegrityForSave = vi.fn(() => ({
      ok: true,
      removedNodeIds: [],
    }));

    renderHook(() => useAgentBuilderAutosave({
      builderDev: false,
      canvasProjectId: 'project-canonical',
      projectsApi: '/api/projects',
      builderDeckId: 'deck_builder',
      deck: canonicalDeck(),
      deckRevision: null,
      deckLoadBusy: false,
      deckLoadError: null,
      stateLoaded: true,
      layoutAutosaveAbortRef: { current: null },
      lastPersistedBoardFingerprintRef: { current: null },
      lastPersistedBoardSnapshotRef: { current: null },
      lastDeckPersistReasonRef: { current: 'node-position' },
      evaluateBoardIntegrityForSave,
      snapshotDeckBoard: vi.fn(),
      formatBuilderStatusMessage: (_value, fallback) => fallback,
      isAbortLikeError: () => false,
      setDeckRevision: vi.fn(),
      setDeckStatusMessage: vi.fn(),
    }));

    act(() => vi.advanceTimersByTime(1_000));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(evaluateBoardIntegrityForSave).not.toHaveBeenCalled();
  });

  it('serializes rapid position saves and advances the latest board from the committed revision', async () => {
    vi.useFakeTimers();
    const firstDeck = canonicalDeck();
    firstDeck.nodes[0] = {
      ...firstDeck.nodes[0],
      position: { x: 101, y: 203 },
    };
    const latestDeck = canonicalDeck();
    latestDeck.nodes[0] = {
      ...latestDeck.nodes[0],
      position: { x: 137, y: 211 },
    };
    let resolveFirst: ((value: Response) => void) | null = null;
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockImplementationOnce(() => new Promise<Response>((resolve) => {
        resolveFirst = resolve;
      }))
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ meta: { deckRevision: 'revision-3' } }),
      } as Response);
    const layoutAutosaveAbortRef = { current: null as AbortController | null };
    const lastPersistedBoardFingerprintRef = { current: JSON.stringify({ nodes: [], edges: [] }) };
    const lastPersistedBoardSnapshotRef = { current: null as unknown };
    const setDeckRevision = vi.fn();
    const shared = {
      builderDev: false,
      canvasProjectId: 'project-canonical',
      projectsApi: '/api/projects',
      builderDeckId: 'deck_builder',
      deckLoadBusy: false,
      deckLoadError: null,
      stateLoaded: true,
      layoutAutosaveAbortRef,
      lastPersistedBoardFingerprintRef,
      lastPersistedBoardSnapshotRef,
      lastDeckPersistReasonRef: { current: 'node-position' },
      evaluateBoardIntegrityForSave: vi.fn(() => ({ ok: true, removedNodeIds: [] })),
      snapshotDeckBoard: vi.fn((deck: DeckDocument) => ({ nodes: deck.nodes, edges: deck.edges })),
      formatBuilderStatusMessage: (_value: unknown, fallback: string) => fallback,
      isAbortLikeError: () => false,
      setDeckRevision,
      setDeckStatusMessage: vi.fn(),
    };
    const { rerender } = renderHook(
      ({ deck, deckRevision }) => useAgentBuilderAutosave({ ...shared, deck, deckRevision }),
      { initialProps: { deck: firstDeck, deckRevision: 'revision-1' as string | null } },
    );

    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
    });
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(JSON.parse(String(fetchSpy.mock.calls[0][1]?.body)).expectedRevision).toBe('revision-1');

    rerender({ deck: latestDeck, deckRevision: 'revision-1' });
    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
    });
    expect(fetchSpy).toHaveBeenCalledOnce();

    await act(async () => {
      resolveFirst?.({
        ok: true,
        text: async () => JSON.stringify({ meta: { deckRevision: 'revision-2' } }),
      } as Response);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(setDeckRevision).toHaveBeenCalledWith('revision-2');

    rerender({ deck: latestDeck, deckRevision: 'revision-2' });
    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const latestBody = JSON.parse(String(fetchSpy.mock.calls[1][1]?.body));
    expect(latestBody.expectedRevision).toBe('revision-2');
    expect(latestBody.document.nodes[0].position).toEqual({ x: 137, y: 211 });
    expect(fetchSpy.mock.calls[0][1]?.signal).not.toBe(fetchSpy.mock.calls[1][1]?.signal);
  });

  it('does not manually save any deck without a loaded canonical revision', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const setDeckStatusMessage = vi.fn();
    const deck = canonicalDeck();
    const { result } = renderHook(() => useBuilderDeckPersistenceActions({
      builderDev: false,
      canvasProjectId: 'project-canonical',
      deck,
      deckId: 'deck_builder',
      deckRevision: null,
      deckSaveAbortRef: { current: null },
      formatBuilderStatusMessage: (_value, fallback) => fallback,
      readDeckDocument,
      setDeck: vi.fn(),
      setDeckRevision: vi.fn(),
      setDeckSaveBusy: vi.fn(),
      setDeckStatusMessage,
      projectsApi: '/api/projects',
      activeProjectLatestRef: { current: 'project-canonical' },
      recordDeckWriteReason: vi.fn(),
    }));

    await act(async () => {
      await result.current.handleSaveDeck();
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(setDeckStatusMessage).toHaveBeenCalledWith(
      'Reload the canonical canvas before saving.',
    );
  });
});
