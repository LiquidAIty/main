// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadSessionHistory: vi.fn(),
  streamSession: vi.fn(),
  waitForBackendReady: vi.fn(),
}));

vi.mock('../../../components/builder/backendReadiness', () => ({
  waitForBackendReady: mocks.waitForBackendReady,
}));

vi.mock('./mainSessionClient', async () => {
  const actual = await vi.importActual<typeof import('./mainSessionClient')>('./mainSessionClient');
  return {
    ...actual,
    loadSessionHistory: mocks.loadSessionHistory,
    streamSession: mocks.streamSession,
  };
});

import useAgentBuilderMainChat, {
  parseStagedCardReviewLoaded,
} from './useAgentBuilderMainChat';

beforeEach(() => {
  mocks.loadSessionHistory.mockReset();
  mocks.streamSession.mockReset();
  mocks.waitForBackendReady.mockReset().mockResolvedValue(false);
});

describe('Main chat live observation callbacks', () => {
  it('accepts optional editor review with no selected graph data and no IDF', () => {
    expect(parseStagedCardReviewLoaded({
      ok: true,
      ready: true,
      persisted: false,
      started: false,
      targetCardId: 'card_local_coder',
      targetCardTitle: 'Coder',
      sourceCardId: 'card_hermes_steward',
      mission: 'Review this mission.',
      dataAnchors: [],
      reviewContext: {
        resolvedNativeReads: [],
        resolvedGraphProjection: {
          schemaVersion: 'native-card-context.v1',
          authority: '',
          projectId: 'project-1',
          nodes: [],
          edges: [],
          counts: { nodes: 0, edges: 0 },
        },
      },
    })).toMatchObject({
      targetCardId: 'card_local_coder',
      dataAnchors: [],
      reviewContext: { resolvedNativeReads: [] },
    });
  });

  it('keeps rejoin visible until native history replaces the empty transcript', async () => {
    let resolveHistory!: (messages: Array<{ role: 'assistant' | 'user'; text: string }>) => void;
    mocks.waitForBackendReady.mockResolvedValue(true);
    mocks.loadSessionHistory.mockReturnValue(new Promise((resolve) => {
      resolveHistory = resolve;
    }));
    const { result } = renderHook(() => useAgentBuilderMainChat({
      canvasProjectId: 'project-1',
      deckId: 'deck_builder',
      conversationId: 'main',
      initialMessages: [],
      workspaceView: 'chat',
    }));

    expect(result.current.sessionHistoryLoading).toBe(true);
    await act(async () => {
      resolveHistory([
        { role: 'user', text: 'Run Coder.' },
        { role: 'assistant', text: 'Coder completed.' },
      ]);
      await Promise.resolve();
    });

    expect(result.current.sessionHistoryLoading).toBe(false);
    expect(result.current.messages).toEqual([
      { role: 'user', text: 'Run Coder.' },
      { role: 'assistant', text: 'Coder completed.' },
    ]);
  });

  it('starts locally, forwards native reasoning separately, and settles after completion', async () => {
    const order: string[] = [];
    const onUserTurnStarted = vi.fn(() => order.push('user'));
    const onNativeTurnEvent = vi.fn((turn) => order.push(String(turn.event.kind)));
    const onTurnFinished = vi.fn((turn) => order.push(turn.status));
    mocks.streamSession.mockImplementation(async (args) => {
      order.push('stream');
      expect(args.dataAnchors).toEqual([{
        authority: 'CodeGraph', nativeId: 'pkg.materialize_idf',
        reason: 'Current production definition', priority: 0,
        boundedExpansion: 1, resultLimit: 12, required: true,
      }]);
      args.onEvent({ kind: 'reasoning', text: 'private provider reasoning' });
      args.onEvent({ kind: 'text', text: 'Visible answer.' });
      return { finalText: 'Visible answer.' };
    });
    const { result } = renderHook(() => useAgentBuilderMainChat({
      canvasProjectId: 'project-1',
      deckId: 'deck_builder',
      conversationId: 'main',
      initialMessages: [],
      workspaceView: 'chat',
      dataAnchors: [{
        authority: 'CodeGraph', nativeId: 'pkg.materialize_idf',
        reason: 'Current production definition', order: 0,
        boundedExpansion: 1, resultLimit: 12, required: true,
      }],
      onUserTurnStarted,
      onNativeTurnEvent,
      onTurnFinished,
    }));

    await act(async () => {
      await result.current.requestMainText('Fix the build.');
    });

    expect(order).toEqual(['user', 'stream', 'reasoning', 'text', 'completed']);
    expect(onUserTurnStarted).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1',
      conversationId: 'main',
      text: 'Fix the build.',
      runId: expect.any(String),
    }));
    expect(onNativeTurnEvent).toHaveBeenCalledWith(expect.objectContaining({
      event: { kind: 'reasoning', text: 'private provider reasoning' },
    }));
    expect(onTurnFinished).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed' }));
    expect(result.current.messages).toEqual([
      { role: 'user', text: 'Fix the build.' },
      { role: 'assistant', text: 'Visible answer.' },
    ]);
    expect(JSON.stringify(result.current.messages)).not.toContain('private provider reasoning');
  });

  it('loads one staged Coder mission and exact model-bound graph projection', async () => {
    const onCardReviewStaged = vi.fn();
    const onCardGraphReferenceLoaded = vi.fn();
    mocks.streamSession.mockImplementation(async (args) => {
      args.onEvent({
        kind: 'tool_result',
        toolName: 'card.run_assistant_agent',
        isError: false,
        output: {
          result: {
            nativeEvents: [{
              kind: 'tool_result',
              toolName: 'write_mag_one_instructions',
              isError: false,
              output: JSON.stringify({
                content: [{
                  type: 'text',
                  text: JSON.stringify({
              ok: true,
              ready: true,
              targetCardId: 'card_local_coder',
              targetCardTitle: 'Coder',
              sourceCardId: 'card_hermes_steward',
              mission: '  exact mission\nwith formatting  ',
              dataAnchors: [{
                authority: 'CodeGraph', nativeId: 'symbol:one', reason: 'Current owner',
                priority: 0, boundedExpansion: 0, resultLimit: 4, required: true,
              }],
              reviewContext: {
                cardRevisionId: 'revision-coder',
                cardRevision: 1,
                cardRevisionSha256: 'sha-coder',
                runtimeOwner: 'hermes',
                cardIdentity: { cardId: 'card_local_coder', title: 'Coder' },
                resolvedNativeReads: [{ authority: 'CodeGraph', nativeId: 'symbol:one' }],
                resolvedGraphProjection: {
                  schemaVersion: 'native-card-context.v1', authority: 'codegraph',
                  projectId: 'project-1',
                  nodes: [{ id: 'symbol:one', label: 'Current owner', authority: 'CodeGraph', mentionCount: 1 }],
                  edges: [], counts: { nodes: 1, edges: 0 },
                },
              },
              persisted: false,
              started: false,
                  }),
                }],
              }),
            }],
          },
        },
      });
      args.onEvent({
        kind: 'tool_result',
        toolName: 'card.load_graph_references',
        isError: false,
        output: {
          ok: true,
          targetCardId: 'card_mag_one',
          sourceCardId: 'card_hermes_steward',
          sourceRunId: 'run-helper',
          reference: {
            authority: 'KnowGraph', nativeId: 'episode:one', reason: 'Useful sourced fact',
            order: 0, boundedExpansion: 1, resultLimit: 8, required: true,
          },
          resolvedReferences: [{ authority: 'KnowGraph', nativeId: 'episode:one', provenance: 'Graphiti' }],
          resolvedContextMarkdown: '# KnowGraph\nActual current graph data',
          graphProjection: {
            schemaVersion: 'native-card-context.v1',
            authority: 'knowgraph',
            projectId: 'project-1',
            nodes: [{
              id: 'episode:one', label: 'Sourced episode', authority: 'KnowGraph', mentionCount: 1,
            }],
            edges: [],
            counts: { nodes: 1, edges: 0 },
          },
          resolved: true,
          ready: true,
          persisted: false,
          started: false,
        },
      });
      args.onEvent({ kind: 'text', text: 'Card ready.' });
      return { finalText: 'Card ready.' };
    });
    const { result } = renderHook(() => useAgentBuilderMainChat({
      canvasProjectId: 'project-1',
      deckId: 'deck_builder',
      conversationId: 'main',
      initialMessages: [],
      workspaceView: 'chat',
      onCardReviewStaged,
      onCardGraphReferenceLoaded,
    }));

    await act(async () => {
      await result.current.requestMainText('Prepare the mission.');
    });

    expect(onCardReviewStaged).toHaveBeenCalledOnce();
    expect(onCardReviewStaged).toHaveBeenCalledWith(expect.objectContaining({
      targetCardId: 'card_local_coder',
      sourceCardId: 'card_hermes_steward',
      mission: '  exact mission\nwith formatting  ',
      dataAnchors: [expect.objectContaining({ nativeId: 'symbol:one', required: true })],
      reviewContext: expect.objectContaining({
        resolvedGraphProjection: expect.objectContaining({
          nodes: [expect.objectContaining({ id: 'symbol:one' })],
        }),
      }),
    }));
    expect(onCardGraphReferenceLoaded).toHaveBeenCalledWith(expect.objectContaining({
      targetCardId: 'card_mag_one',
      sourceCardId: 'card_hermes_steward',
      sourceRunId: 'run-helper',
      ready: true,
      resolvedContextMarkdown: '# KnowGraph\nActual current graph data',
      graphProjection: expect.objectContaining({
        projectId: 'project-1',
        nodes: [expect.objectContaining({ id: 'episode:one' })],
      }),
      reference: expect.objectContaining({ authority: 'KnowGraph', nativeId: 'episode:one' }),
    }));
  });
});
