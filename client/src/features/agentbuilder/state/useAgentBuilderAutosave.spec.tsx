/**
 * Entity: Agent Builder
 * Relationship: This file verifies Agent Builder deck persistence serializes revisions, retains the latest draft, promotes explicit saves, and freezes uncertain writes until canonical reload.
 * Entity: Saved Cards
 * Relationship: This file verifies the exact Card document and returned revision advance through one writer without rolling back a newer local edit.
 * Entity: Card Topology
 * Relationship: This file verifies Card nodes and edges remain one compare-and-set persistence unit.
 * Entity: Projects
 * Relationship: This file verifies persistence stays bound to the active Project scope and cannot accept a stale workspace completion.
 */

// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DeckDocument } from '../../../types/agentgraph';
import useAgentBuilderAutosave from './useAgentBuilderAutosave';

function deck(title: string, version: number): DeckDocument {
  return {
    id: 'deck_builder',
    name: 'Builder',
    promptTemplates: [],
    nodes: [{
      id: 'card_main',
      templateId: 'template_main',
      title,
      runtime: { kind: 'hermes', mode: 'main', profile: 'main' },
      position: { x: 0, y: 0 },
    }],
    edges: [],
    version,
  };
}

function response(document: DeckDocument, revision: string): Response {
  return new Response(JSON.stringify({
    ok: true,
    projectId: 'project-a',
    deck: document,
    meta: { deckRevision: revision },
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function args(document: DeckDocument) {
  return {
    builderDev: false,
    canvasProjectId: 'project-a',
    projectsApi: '/api/projects',
    builderDeckId: 'deck_builder',
    deck: document,
    deckRevision: 'revision-0',
    deckLoadBusy: false,
    deckLoadError: null,
    stateLoaded: true,
    transientCardIds: new Set<string>(),
    lastPersistedBoardFingerprintRef: {
      current: JSON.stringify({ nodes: deck('Initial', 0).nodes, edges: [] }),
    },
    lastPersistedBoardSnapshotRef: { current: null as unknown },
    lastDeckPersistReasonRef: { current: 'board-change' as string | null },
    evaluateBoardIntegrityForSave: () => ({ ok: true, removedNodeIds: [] }),
    snapshotDeckBoard: (value: DeckDocument) => ({
      nodes: value.nodes,
      edges: value.edges,
    }),
    readDeckDocument: (value: Partial<DeckDocument> | null | undefined) => value as DeckDocument,
    formatBuilderStatusMessage: (value: unknown, fallback: string) => (
      typeof value === 'string' && value ? value : fallback
    ),
    setDeckRevision: vi.fn(),
    setDeck: vi.fn(),
    setDeckSaveBusy: vi.fn(),
    setDeckStatusMessage: vi.fn(),
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Agent Builder deck persistence coordinator', () => {
  it('sends an explicit Card removal, keeps it visible until readback, and retains newer edits without resurrecting it', async () => {
    vi.useFakeTimers();
    const initial = deck('Initial', 0);
    initial.nodes.push({ ...initial.nodes[0], id: 'card_worldsignals_agent', title: 'WorldSignals',
      runtime: { kind: 'hermes', mode: 'delegate', profile: 'worldsignals' } });
    initial.edges.push({ id: 'world-wire', source: 'card_main', target: 'card_worldsignals_agent', edgeType: 'flow' });
    const pending = deferred<Response>();
    const fetchMock = vi.fn().mockImplementationOnce(() => pending.promise)
      .mockImplementation(async (_url, init) => response(JSON.parse(String(init.body)).document, 'revision-2'));
    vi.stubGlobal('fetch', fetchMock);
    const properties = args(initial);
    properties.lastPersistedBoardFingerprintRef.current = JSON.stringify({ nodes: initial.nodes, edges: initial.edges });
    const { result, rerender } = renderHook((input: ReturnType<typeof args>) => useAgentBuilderAutosave(input),
      { initialProps: properties });
    let removal!: Promise<void>;
    act(() => { removal = result.current.handleDeleteCard('card_worldsignals_agent'); });
    const sent = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(sent.removeCardId).toBe('card_worldsignals_agent');
    expect(sent.expectedRevision).toBe('revision-0');
    expect(sent.document.nodes.map((node: { id: string }) => node.id)).toEqual(['card_main']);
    expect(sent.document.edges).toEqual([]);
    expect(properties.setDeck).not.toHaveBeenCalled();

    const newer = structuredClone(initial);
    newer.nodes[0].title = 'Newer local edit';
    rerender({ ...properties, deck: newer });
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    await act(async () => { pending.resolve(response(sent.document, 'revision-1')); });
    await removal;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const updated = properties.setDeck.mock.calls.at(-1)![0](newer) as DeckDocument;
    expect(updated.nodes.map(node => node.id)).toEqual(['card_main']);
    expect(updated.nodes[0].title).toBe('Newer local edit');
    expect(updated.edges).toEqual([]);
    rerender({ ...properties, deck: updated, deckRevision: 'revision-1' });
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    const savedAfterRemoval = JSON.parse(String(fetchMock.mock.calls[1][1].body));
    expect(savedAfterRemoval.document.nodes.map((node: { id: string }) => node.id)).toEqual(['card_main']);
    expect(savedAfterRemoval.expectedRevision).toBe('revision-1');
  });

  it('does not hide a Card when its explicit removal fails', async () => {
    const initial = deck('Initial', 0);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: 'system_card_removal_forbidden' }), { status: 409 },
    )));
    const properties = args(initial);
    const { result } = renderHook(() => useAgentBuilderAutosave(properties));
    await act(async () => {
      await expect(result.current.handleDeleteCard('card_main')).rejects.toThrow('system_card_removal_forbidden');
    });
    expect(properties.setDeck).not.toHaveBeenCalled();
  });

  it('serializes rapid edits and dispatches the latest pending board with the returned revision', async () => {
    vi.useFakeTimers();
    const first = deferred<Response>();
    const second = deferred<Response>();
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    vi.stubGlobal('fetch', fetchMock);
    const firstDeck = deck('First', 1);
    const secondDeck = deck('Second', 2);
    const initialArgs = args(firstDeck);
    const { rerender } = renderHook(
      (properties: ReturnType<typeof args>) => useAgentBuilderAutosave(properties),
      { initialProps: initialArgs },
    );

    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    rerender({ ...initialArgs, deck: secondDeck });
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => { first.resolve(response(firstDeck, 'revision-1')); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondRequest = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(secondRequest.expectedRevision).toBe('revision-1');
    expect(secondRequest.document.nodes[0].title).toBe('Second');
    await act(async () => { second.resolve(response(secondDeck, 'revision-2')); });
    expect(initialArgs.setDeckRevision).toHaveBeenLastCalledWith('revision-2');
  });

  it('promotes an explicit save into the same single writer', async () => {
    vi.useFakeTimers();
    const pending = deferred<Response>();
    const fetchMock = vi.fn(() => pending.promise);
    vi.stubGlobal('fetch', fetchMock);
    const requested = deck('Card edit', 3);
    const hookArgs = args(requested);
    const { result } = renderHook(() => useAgentBuilderAutosave(hookArgs));

    let save!: Promise<void>;
    act(() => { save = result.current.handleSaveDeck(requested); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => { pending.resolve(response(requested, 'revision-1')); });
    await expect(save).resolves.toBeUndefined();
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retains the local board and freezes after an uncertain network result until reload', async () => {
    const fetchMock = vi.fn(() => Promise.reject(new Error('connection_lost')));
    vi.stubGlobal('fetch', fetchMock);
    const requested = deck('Unsaved local draft', 4);
    const hookArgs = args(requested);
    const { result } = renderHook(() => useAgentBuilderAutosave(hookArgs));

    let save!: Promise<void>;
    act(() => { save = result.current.handleSaveDeck(requested); });
    let failure: unknown = null;
    await act(async () => {
      try {
        await save;
      } catch (error) {
        failure = error;
      }
    });
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe('connection_lost');
    expect(result.current.persistenceFrozen).toBe(true);
    expect(hookArgs.setDeckRevision).toHaveBeenCalledWith(null);
    expect(hookArgs.setDeck).not.toHaveBeenCalled();
    const beforeReload = result.current.reloadToken;
    act(() => { result.current.reloadCanonical(); });
    expect(result.current.persistenceFrozen).toBe(false);
    expect(result.current.reloadToken).toBe(beforeReload + 1);
  });
});
