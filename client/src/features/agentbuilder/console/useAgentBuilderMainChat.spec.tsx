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

import useAgentBuilderMainChat from './useAgentBuilderMainChat';

beforeEach(() => {
  mocks.loadSessionHistory.mockReset();
  mocks.streamSession.mockReset();
  mocks.waitForBackendReady.mockReset().mockResolvedValue(false);
});

describe('Main chat live observation callbacks', () => {
  it('starts locally, forwards native reasoning separately, and settles after completion', async () => {
    const order: string[] = [];
    const onUserTurnStarted = vi.fn(() => order.push('user'));
    const onNativeTurnEvent = vi.fn((turn) => order.push(String(turn.event.kind)));
    const onTurnFinished = vi.fn((turn) => order.push(turn.status));
    mocks.streamSession.mockImplementation(async (args) => {
      order.push('stream');
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

  it('forwards the exact transient Mag One proposal from the native tool result', async () => {
    const onMagOneInstructionsProposed = vi.fn();
    mocks.streamSession.mockImplementation(async (args) => {
      args.onEvent({
        kind: 'tool_result',
        toolName: 'write_mag_one_instructions',
        isError: false,
        output: JSON.stringify({
          content: [{
            type: 'text',
            text: JSON.stringify({
              ok: true,
              targetCardId: 'card_mag_one',
              instructions: '  exact mission\nwith formatting  ',
              deckRevision: 'deck-revision-1',
              proposalHash: 'proposal-hash-1',
              existingWorkerCardIds: ['card_worker'],
              approvalRequired: true,
              proposal: {
                goal: 'Bounded source search',
                workers: [{ existingCardId: 'card_worker', title: 'Search Agent' }],
                cardsToCreate: [],
                wiresToAdd: [],
              },
              persisted: false,
              started: false,
            }),
          }],
        }),
      });
      args.onEvent({ kind: 'text', text: 'Proposal ready.' });
      return { finalText: 'Proposal ready.' };
    });
    const { result } = renderHook(() => useAgentBuilderMainChat({
      canvasProjectId: 'project-1',
      deckId: 'deck_builder',
      conversationId: 'main',
      initialMessages: [],
      workspaceView: 'chat',
      onMagOneInstructionsProposed,
    }));

    await act(async () => {
      await result.current.requestMainText('Prepare the mission.');
    });

    expect(onMagOneInstructionsProposed).toHaveBeenCalledOnce();
    expect(onMagOneInstructionsProposed).toHaveBeenCalledWith({
      targetCardId: 'card_mag_one',
      instructions: '  exact mission\nwith formatting  ',
      deckRevision: 'deck-revision-1',
      proposalHash: 'proposal-hash-1',
      existingWorkerCardIds: ['card_worker'],
      approvalRequired: true,
      proposal: {
        goal: 'Bounded source search',
        workers: [{ existingCardId: 'card_worker', title: 'Search Agent' }],
        cardsToCreate: [],
        wiresToAdd: [],
      },
    });
  });
});
