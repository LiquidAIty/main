// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadMainDriverStatus: vi.fn(),
  loadSessionHistory: vi.fn(),
  stopSession: vi.fn(),
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
    loadMainDriverStatus: mocks.loadMainDriverStatus,
    loadSessionHistory: mocks.loadSessionHistory,
    stopSession: mocks.stopSession,
    streamSession: mocks.streamSession,
  };
});

import useAgentBuilderMainChat, {
  parseStagedCardReviewLoaded,
} from './useAgentBuilderMainChat';
import { SessionStreamError } from './mainSessionClient';

beforeEach(() => {
  mocks.loadMainDriverStatus.mockReset().mockResolvedValue({ ready: true, activeDriver: null });
  mocks.loadSessionHistory.mockReset();
  mocks.stopSession.mockReset();
  mocks.streamSession.mockReset();
  mocks.waitForBackendReady.mockReset().mockResolvedValue(false);
});

describe('Main chat live observation callbacks', () => {
  it('surfaces the server-owned active Main input driver', async () => {
    mocks.loadMainDriverStatus.mockResolvedValue({
      ready: true,
      activeDriver: 'external_plugin',
    });
    const { result } = renderHook(() => useAgentBuilderMainChat({
      canvasProjectId: 'project-1',
      deckId: 'deck_builder',
      conversationId: 'main',
    }));

    await waitFor(() => expect(result.current.mainDriverSource).toBe('external_plugin'));
  });

  it('keeps duplicate technical events under the server-issued Run and out of chat', async () => {
    const onUserTurnStarted = vi.fn();
    const onNativeTurnEvent = vi.fn();
    const onTurnFinished = vi.fn();
    const event = { projectId: 'project-1', deckId: 'deck_builder', cardId: 'main-card', cardName: 'Main',
      runId: 'server-run', parentRunId: null, nativeChildId: null, id: 'server-run:tool:1',
      category: 'execution.tool', kind: 'tool_error', toolName: 'lookup', status: 'failed', sequence: 1,
      timestamp: null, detail: 'not found' };
    mocks.streamSession.mockImplementation(async ({ onEvent }) => {
      onEvent({ kind: 'tool_result', terminalEvent: event });
      onEvent({ kind: 'tool_result', terminalEvent: event });
      onEvent({ kind: 'text', text: 'Actual reply' });
      return { finalText: 'Actual reply' };
    });
    const { result } = renderHook(() => useAgentBuilderMainChat({ canvasProjectId: 'project-1', deckId: 'deck_builder', conversationId: 'main',
      onUserTurnStarted, onNativeTurnEvent, onTurnFinished }));
    await act(async () => { await result.current.requestMainText('Question'); });
    expect(result.current.technicalEvents).toEqual([event]);
    expect(onUserTurnStarted).toHaveBeenCalledOnce();
    expect(onUserTurnStarted).toHaveBeenCalledWith(expect.objectContaining({ runId: 'server-run' }));
    expect(onNativeTurnEvent.mock.calls.every(([turn]) => turn.runId === 'server-run')).toBe(true);
    expect(onTurnFinished).toHaveBeenCalledWith(expect.objectContaining({ runId: 'server-run' }));
    expect(result.current.messages).toEqual([{ role: 'user', text: 'Question' }, { role: 'assistant', text: 'Actual reply' }]);
  });

  it('projects input and final answer into Chat exactly once while execution stays terminal-only', async () => {
    const base = { projectId: 'project-1', deckId: 'deck_builder', cardId: 'card_main_chat',
      cardName: 'Main Chat', runId: 'server-run', parentRunId: null, nativeChildId: null,
      schemaVersion: 'liquidaity.main.projection.v1' as const, nativeTurnId: 'turn-1',
      timestamp: '2026-08-31T12:00:00.000Z' };
    const input = { ...base, id: 'input-1', category: 'conversation.input' as const,
      kind: 'mission' as const, sequence: 1, text: 'Question' };
    const tool = { ...base, id: 'tool-1', category: 'execution.tool' as const,
      kind: 'tool_call' as const, sequence: 2, toolName: 'main.context', status: 'started', detail: 'context read' };
    const answer = { ...base, id: 'answer-1', category: 'conversation.answer' as const,
      kind: 'model' as const, sequence: 3, status: 'completed', text: 'Short answer.' };
    mocks.streamSession.mockImplementation(async ({ onEvent }) => {
      onEvent({ kind: 'projection', runId: 'server-run', projection: input });
      onEvent({ kind: 'projection', runId: 'server-run', projection: input });
      onEvent({ kind: 'projection', runId: 'server-run', projection: tool, terminalEvent: tool });
      onEvent({ kind: 'projection', runId: 'server-run', projection: tool, terminalEvent: tool });
      onEvent({ kind: 'projection', runId: 'server-run', projection: answer });
      onEvent({ kind: 'projection', runId: 'server-run', projection: answer });
      return { finalText: 'Short answer.' };
    });
    const { result } = renderHook(() => useAgentBuilderMainChat({ canvasProjectId: 'project-1',
      deckId: 'deck_builder', conversationId: 'main' }));
    await act(async () => { await result.current.requestMainText('Question'); });

    expect(result.current.messages).toEqual([
      { role: 'user', text: 'Question' },
      { role: 'assistant', text: 'Short answer.' },
    ]);
    expect(result.current.technicalEvents).toEqual([tool]);
    expect(JSON.stringify(result.current.technicalEvents)).not.toContain('Short answer.');
  });
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

  it('stages exact unresolved references from a delegated native tool start', () => {
    expect(parseStagedCardReviewLoaded({
      result: JSON.stringify({
        nativeEvents: [{
          kind: 'tool_start',
          toolName: 'mcp__main_runtime_one__write_mag_one_instructions',
          argsJson: JSON.stringify({
            targetCardId: 'card_agent_builder',
            mission: 'Exact unsent mission.',
            dataAnchors: [{
              authority: 'ThinkGraph', nativeId: 'think-one', reason: 'Accepted intent',
              priority: 1, boundedExpansion: 0, resultLimit: 1,
            }],
          }),
        }],
      }),
    })).toEqual({
      targetCardId: 'card_agent_builder',
      mission: 'Exact unsent mission.',
      dataAnchors: [{
        authority: 'ThinkGraph', nativeId: 'think-one', reason: 'Accepted intent',
        priority: 1, boundedExpansion: 0, resultLimit: 1, required: true,
      }],
    });
  });

  it('keeps rejoin visible until native history replaces the empty transcript', async () => {
    let resolveHistory!: (history: {
      messages: Array<{ role: 'assistant' | 'user'; text: string }>;
      terminalEvents: Array<Record<string, unknown>>;
    }) => void;
    mocks.waitForBackendReady.mockResolvedValue(true);
    mocks.loadSessionHistory.mockReturnValue(new Promise((resolve) => {
      resolveHistory = resolve;
    }));
    const { result } = renderHook(() => useAgentBuilderMainChat({
      canvasProjectId: 'project-1',
      deckId: 'deck_builder',
      conversationId: 'main',
    }));

    expect(result.current.sessionHistoryLoading).toBe(true);
    await act(async () => {
      resolveHistory({
        messages: [
          { role: 'user', text: 'Run Coder.' },
          { role: 'assistant', text: 'Coder completed.' },
        ],
        terminalEvents: [{
          projectId: 'project-1', deckId: 'deck_builder', cardId: 'card_main_chat', cardName: 'Main',
          runId: 'run-history', parentRunId: null, nativeChildId: null, id: 'run-history:tool:1',
          category: 'execution.tool', kind: 'tool_result', toolName: 'lookup', status: 'completed',
          sequence: 1, timestamp: null,
        }],
      });
      await Promise.resolve();
    });

    expect(result.current.sessionHistoryLoading).toBe(false);
    expect(result.current.messages).toEqual([
      { role: 'user', text: 'Run Coder.' },
      { role: 'assistant', text: 'Coder completed.' },
    ]);
    expect(result.current.technicalEvents).toEqual([
      expect.objectContaining({ id: 'run-history:tool:1', category: 'execution.tool' }),
    ]);
  });

  it('keeps a history failure out of the transcript and clears the loading state', async () => {
    mocks.waitForBackendReady.mockResolvedValue(true);
    mocks.loadSessionHistory.mockRejectedValue(new Error('native history unavailable'));
    const { result } = renderHook(() => useAgentBuilderMainChat({
      canvasProjectId: 'project-1',
      deckId: 'deck_builder',
      conversationId: 'main',
    }));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.sessionHistoryLoading).toBe(false);
    expect(result.current.messages).toEqual([]);
  });

  it('uses the native Run identity, forwards native reasoning separately, and settles after completion', async () => {
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
      args.onEvent({ kind: 'reasoning', runId: 'native-run', text: 'private provider reasoning' });
      args.onEvent({ kind: 'tool_result', toolName: 'main.context', output: 'tool status text' });
      args.onEvent({ kind: 'native_attention', label: 'graph status text' });
      args.onEvent({ kind: 'text', text: 'Visible answer.' });
      return { finalText: 'Visible answer.' };
    });
    const { result } = renderHook(() => useAgentBuilderMainChat({
      canvasProjectId: 'project-1',
      deckId: 'deck_builder',
      conversationId: 'main',
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

    expect(order).toEqual([
      'stream', 'user', 'reasoning', 'tool_result', 'native_attention', 'text', 'completed',
    ]);
    expect(onUserTurnStarted).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-1',
      conversationId: 'main',
      text: 'Fix the build.',
      runId: 'native-run',
    }));
    expect(onNativeTurnEvent).toHaveBeenCalledWith(expect.objectContaining({
      runId: 'native-run', event: { kind: 'reasoning', runId: 'native-run', text: 'private provider reasoning' },
    }));
    expect(onTurnFinished).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed' }));
    expect(result.current.messages).toEqual([
      { role: 'user', text: 'Fix the build.' },
      { role: 'assistant', text: 'Visible answer.' },
    ]);
    expect(JSON.stringify(result.current.messages)).not.toContain('private provider reasoning');
    expect(JSON.stringify(result.current.messages)).not.toContain('tool status text');
    expect(JSON.stringify(result.current.messages)).not.toContain('graph status text');
  });

  it('keeps exact user bytes and replaces stream framing with the persisted native completion', async () => {
    mocks.streamSession.mockImplementation(async (args) => {
      expect(args.message).toBe('  Normal human message.  ');
      args.onEvent({ kind: 'session', sessionId: 'native-session' });
      args.onEvent({ kind: 'text', text: '\n\nNative answer.' });
      return { finalText: 'Native answer.' };
    });
    const { result } = renderHook(() => useAgentBuilderMainChat({
      canvasProjectId: 'project-1',
      deckId: 'deck_builder',
      conversationId: 'conversation-exact',
    }));

    await act(async () => {
      await expect(result.current.requestMainText('  Normal human message.  '))
        .resolves.toBe('Native answer.');
    });

    expect(result.current.messages).toEqual([
      { role: 'user', text: '  Normal human message.  ' },
      { role: 'assistant', text: 'Native answer.' },
    ]);
  });

  it('loads one staged Coder mission and exact model-bound graph projection', async () => {
    const onCardReviewStaged = vi.fn();
    const onCardGraphReferenceLoaded = vi.fn();
    mocks.streamSession.mockImplementation(async (args) => {
      args.onEvent({
        kind: 'tool_result',
        toolName: 'delegate_task',
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

  it('keys transcript state by conversation and never shows A while B loads', async () => {
    type LoadedHistory = {
      messages: Array<{ role: 'assistant' | 'user'; text: string }>;
      terminalEvents: Array<Record<string, unknown>>;
    };
    let resolveA!: (history: LoadedHistory) => void;
    let resolveB!: (history: LoadedHistory) => void;
    mocks.waitForBackendReady.mockResolvedValue(true);
    mocks.loadSessionHistory.mockImplementation(({ conversationId }) => new Promise((resolve) => {
      if (conversationId === 'conversation-a') resolveA = resolve;
      if (conversationId === 'conversation-b') resolveB = resolve;
    }));
    const { result, rerender } = renderHook(
      ({ conversationId }) => useAgentBuilderMainChat({
        canvasProjectId: 'project-1',
        deckId: 'deck_builder',
        conversationId,
      }),
      { initialProps: { conversationId: 'conversation-a' } },
    );

    await waitFor(() => expect(mocks.loadSessionHistory).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'conversation-a' }),
    ));
    await act(async () => {
      resolveA({ messages: [
        { role: 'user', text: 'A user' },
        { role: 'assistant', text: 'A model' },
      ], terminalEvents: [] });
      await Promise.resolve();
    });
    expect(result.current.messages).toEqual([
      { role: 'user', text: 'A user' },
      { role: 'assistant', text: 'A model' },
    ]);

    rerender({ conversationId: 'conversation-b' });
    expect(result.current.messages).toEqual([]);
    expect(result.current.sessionHistoryLoading).toBe(true);

    await waitFor(() => expect(mocks.loadSessionHistory).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'conversation-b' }),
    ));
    await act(async () => {
      resolveB({ messages: [{ role: 'user', text: 'B user' }], terminalEvents: [] });
      await Promise.resolve();
    });
    expect(result.current.messages).toEqual([{ role: 'user', text: 'B user' }]);
  });

  it('keeps native failures outside the transcript', async () => {
    const onUserTurnStarted = vi.fn();
    const onTurnFinished = vi.fn();
    mocks.streamSession.mockRejectedValue(new SessionStreamError({
      code: 'harness_turn_failed',
      message: 'provider failed',
      correlationId: 'req_failure',
    }));
    const { result } = renderHook(() => useAgentBuilderMainChat({
      canvasProjectId: 'project-1',
      deckId: 'deck_builder',
      conversationId: 'conversation-failure',
      onUserTurnStarted, onTurnFinished,
    }));

    await act(async () => {
      await expect(result.current.requestMainText('Normal user message.')).rejects.toThrow();
    });

    expect(result.current.messages).toEqual([
      { role: 'user', text: 'Normal user message.' },
    ]);
    expect(result.current.nativeSessionActive).toBe(false);
    expect(onUserTurnStarted).not.toHaveBeenCalled();
    expect(onTurnFinished).not.toHaveBeenCalled();
  });

  it('rejects a different Run in the same stream instead of merging its activity', async () => {
    const onNativeTurnEvent = vi.fn();
    mocks.streamSession.mockImplementation(async ({ onEvent }) => {
      onEvent({ kind: 'session', runId: 'native-run' });
      onEvent({ kind: 'tool_result', runId: 'another-run', output: 'another Run output' });
      return { finalText: 'must not complete' };
    });
    const { result } = renderHook(() => useAgentBuilderMainChat({ canvasProjectId: 'project-1',
      deckId: 'deck_builder', conversationId: 'main', onNativeTurnEvent }));
    await act(async () => { await expect(result.current.requestMainText('Question')).rejects.toThrow('Run identity changed'); });
    expect(onNativeTurnEvent).toHaveBeenCalledTimes(1);
    expect(result.current.technicalError).toBe('main_run_identity_mismatch');
    expect(result.current.messages).toEqual([{ role: 'user', text: 'Question' }]);
  });

  it('removes an unfinished assistant stream when the native turn fails', async () => {
    mocks.streamSession.mockImplementation(async ({ onEvent }) => {
      onEvent({ kind: 'session', sessionId: 'native-session' });
      onEvent({ kind: 'text', text: 'Unfinished native text' });
      throw new SessionStreamError({
        code: 'harness_turn_failed',
        message: 'provider failed',
        correlationId: 'req_partial_failure',
      });
    });
    const { result } = renderHook(() => useAgentBuilderMainChat({
      canvasProjectId: 'project-1',
      deckId: 'deck_builder',
      conversationId: 'conversation-partial-failure',
    }));

    await act(async () => {
      await expect(result.current.requestMainText('Normal user message.')).rejects.toThrow();
    });

    expect(result.current.messages).toEqual([
      { role: 'user', text: 'Normal user message.' },
    ]);
  });

  it('clears the native active state when the backend reports no active turn', async () => {
    mocks.streamSession.mockImplementation(({ signal, onEvent }) => new Promise((_resolve, reject) => {
      onEvent({ kind: 'session', sessionId: 'native-session', runId: 'native-run' });
      signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), {
        once: true,
      });
    }));
    mocks.stopSession.mockRejectedValue(new SessionStreamError({
      code: 'no_active_turn',
      message: 'no active turn',
    }));
    const { result } = renderHook(() => useAgentBuilderMainChat({
      canvasProjectId: 'project-1',
      deckId: 'deck_builder',
      conversationId: 'conversation-stale-working',
    }));

    let request!: Promise<string>;
    await act(async () => {
      request = result.current.requestMainText('Normal user message.');
      await Promise.resolve();
    });
    expect(result.current.nativeSessionActive).toBe(true);

    await act(async () => {
      await result.current.stopMainTurn();
      await request.catch(() => undefined);
    });
    expect(result.current.nativeSessionActive).toBe(false);
    expect(result.current.messages).toEqual([
      { role: 'user', text: 'Normal user message.' },
    ]);
  });
});
