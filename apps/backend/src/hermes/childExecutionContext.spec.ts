import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  bindHermesRootExecutionSession,
  clearHermesExecutionContextsForTest,
  createHermesChildExecutionContext,
  executionToolCallMeta,
  finishHermesExecutionContext,
  registerHermesRootExecutionContext,
  resolveHermesExecutionContext,
} from './childExecutionContext';

describe('Hermes child execution attribution', () => {
  beforeEach(() => clearHermesExecutionContextsForTest());

  const persistRequestedRun = async (_path: string, init?: RequestInit) => ({
    ok: true,
    runId: JSON.parse(String(init?.body || '{}')).runId,
  });

  function root() {
    const context = registerHermesRootExecutionContext({
      sessionId: 'provisional',
      runId: 'main-run',
      projectId: 'project-1',
      deckId: 'deck_builder',
      conversationId: 'conversation-1',
      cardId: 'card_main_chat',
      runtimeMode: 'main',
      grantedTools: ['canvas.inspect'],
    });
    bindHermesRootExecutionSession(context.contextId, 'acp-session-1');
    return context;
  }

  it('creates concurrent native children on one Card without crossing Run identity', async () => {
    const parent = root();
    const request = vi.fn(persistRequestedRun);
    const [delegate, kanban] = await Promise.all([
      createHermesChildExecutionContext({
        sessionId: 'acp-session-1',
        parentExecutionContextId: parent.contextId,
        nativeChildId: 'sa-one',
        provider: 'openai-codex',
        model: 'gpt-5.6-luna',
        request,
      }),
      createHermesChildExecutionContext({
        sessionId: 'acp-session-1',
        parentExecutionContextId: parent.contextId,
        nativeChildId: 'sa-two',
        request,
      }),
    ]);

    expect(delegate.runId).not.toBe(kanban.runId);
    expect(delegate.cardId).toBe('card_main_chat');
    expect(kanban.cardId).toBe('card_main_chat');
    expect(delegate.grantedTools).toEqual(['canvas.inspect']);
    expect(kanban.grantedTools).toEqual(['canvas.inspect']);
    expect(delegate.parentRunId).toBe('main-run');
    expect(kanban.parentRunId).toBe('main-run');
    expect(executionToolCallMeta(delegate.contextId)).toEqual({
      'liquidaity/execution': delegate.contextId,
    });
    expect(JSON.stringify(executionToolCallMeta(delegate.contextId))).not.toMatch(/token|secret|credential/i);
    expect(request).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(request.mock.calls[0][1]?.body))).toMatchObject({
      nativeChildId: 'sa-one',
      provider: 'openai-codex',
      model: 'gpt-5.6-luna',
    });
  });

  it('keeps concurrent saved Delegate root Runs isolated before their first MCP call', () => {
    const first = registerHermesRootExecutionContext({
      sessionId: 'delegate-session-one',
      runId: 'delegate-run-one',
      projectId: 'project-1',
      deckId: 'deck_builder',
      conversationId: 'delegate-conversation-one',
      cardId: 'card_test_delegate',
      runtimeMode: 'delegate',
      grantedTools: ['cbm.get_code_snippet', 'cbm.search_graph'],
    });
    const second = registerHermesRootExecutionContext({
      sessionId: 'delegate-session-two',
      runId: 'delegate-run-two',
      projectId: 'project-1',
      deckId: 'deck_builder',
      conversationId: 'delegate-conversation-two',
      cardId: 'card_test_delegate',
      runtimeMode: 'delegate',
      grantedTools: ['cbm.get_code_snippet', 'cbm.search_graph'],
    });
    const principal = (runId: string, conversationId: string) => ({
      kind: 'card-runtime',
      requiresExecutionContext: true,
      projectId: 'project-1',
      deckId: 'deck_builder',
      conversationId,
      parentRunId: runId,
      callerCardId: 'card_test_delegate',
      callerRuntimeKind: 'hermes',
      callerRuntimeMode: 'delegate',
      grantedTools: ['cbm.get_code_snippet', 'cbm.search_graph'],
    });

    expect(resolveHermesExecutionContext({
      contextId: first.contextId,
      principal: principal('delegate-run-one', 'delegate-conversation-one'),
    })).toMatchObject({
      runId: 'delegate-run-one',
      conversationId: 'delegate-conversation-one',
      cardId: 'card_test_delegate',
    });
    expect(resolveHermesExecutionContext({
      contextId: second.contextId,
      principal: principal('delegate-run-two', 'delegate-conversation-two'),
    })).toMatchObject({
      runId: 'delegate-run-two',
      conversationId: 'delegate-conversation-two',
      cardId: 'card_test_delegate',
    });
    expect(() => resolveHermesExecutionContext({
      contextId: first.contextId,
      principal: principal('delegate-run-two', 'delegate-conversation-two'),
    })).toThrow('hermes_execution_context_principal_mismatch');
  });

  it('inherits Builder identity and saved grants without a preselected effect target', async () => {
    const builder = registerHermesRootExecutionContext({
      sessionId: 'builder-session', runId: 'builder-run', projectId: 'project-1',
      deckId: 'deck_builder', conversationId: 'builder-conversation', cardId: 'card_agent_builder',
      runtimeMode: 'delegate', grantedTools: ['card.update_configuration', 'canvas.inspect'],
    });
    const child = await createHermesChildExecutionContext({
      sessionId: 'builder-session', parentExecutionContextId: builder.contextId,
      nativeChildId: 'builder-helper', request: vi.fn(persistRequestedRun),
    });
    expect(child).toMatchObject({ cardId: builder.cardId, parentRunId: builder.runId,
      rootRunId: builder.runId, grantedTools: ['canvas.inspect', 'card.update_configuration'] });
    expect(child.runId).not.toBe(builder.runId);
    for (const context of [builder, child]) {
      expect(context).not.toHaveProperty('builderOperation');
      expect(context).not.toHaveProperty('effectTargetCardId');
      expect(context).not.toHaveProperty('effectTargetCardRevisionId');
      expect(context).not.toHaveProperty('effectTargetDeckRevision');
    }
  });

  it('keeps an ephemeral child on the originating saved Card with a distinct Run', async () => {
    const parent = root();
    const child = await createHermesChildExecutionContext({
      sessionId: 'acp-session-1',
      parentExecutionContextId: parent.contextId,
      nativeChildId: 'sa-ephemeral',
      request: vi.fn(persistRequestedRun),
    });
    expect(child.cardId).toBe('card_main_chat');
    expect(child.runId).not.toBe(parent.runId);
    expect(child.parentRunId).toBe(parent.runId);
    expect(child.runtimeMode).toBe('main');
  });

  it('fails closed for forged principals and grant widening', async () => {
    const parent = root();
    const request = vi.fn(persistRequestedRun);
    const delegate = await createHermesChildExecutionContext({
      sessionId: 'acp-session-1',
      parentExecutionContextId: parent.contextId,
      nativeChildId: 'sa-delegate',
      request,
    });
    const principal = {
      kind: 'card-runtime',
      requiresExecutionContext: true,
      projectId: 'project-1',
      deckId: 'deck_builder',
      conversationId: 'conversation-1',
      parentRunId: 'main-run',
      callerCardId: 'card_main_chat',
      callerRuntimeKind: 'hermes',
      callerRuntimeMode: 'main',
      grantedTools: ['canvas.inspect'],
    };
    expect(resolveHermesExecutionContext({ contextId: delegate.contextId, principal }).runId)
      .toBe(delegate.runId);
    expect(() => resolveHermesExecutionContext({
      contextId: delegate.contextId,
      principal: { ...principal, callerCardId: 'card_forged' },
    })).toThrow('hermes_execution_context_principal_mismatch');
    expect(() => resolveHermesExecutionContext({
      contextId: delegate.contextId,
      principal: { ...principal, grantedTools: ['cbm.index_repository'] },
    })).toThrow('hermes_execution_context_principal_mismatch');
    expect(() => resolveHermesExecutionContext({
      contextId: 'unknown-context', principal,
    })).toThrow('hermes_execution_context_unknown');
    expect(() => resolveHermesExecutionContext({
      contextId: delegate.contextId, principal, now: delegate.expiresAt + 1,
    })).toThrow('hermes_execution_context_expired');
  });

  it('closes one child Run exactly once', async () => {
    const parent = root();
    const createRequest = vi.fn(persistRequestedRun);
    const child = await createHermesChildExecutionContext({
      sessionId: 'acp-session-1',
      parentExecutionContextId: parent.contextId,
      nativeChildId: 'sa-one',
      request: createRequest,
    });
    const finishRequest = vi.fn(async (_path: string, _init?: RequestInit) => ({ ok: true }));
    await expect(finishHermesExecutionContext({
      contextId: child.contextId,
      state: 'completed',
      configuration: {
        provider: 'openai-codex',
        model: 'gpt-5.6-luna',
        fallbackOccurred: false,
      },
      request: finishRequest,
    })).resolves.toBe(true);
    await expect(finishHermesExecutionContext({
      contextId: child.contextId,
      state: 'failed',
      request: finishRequest,
    })).resolves.toBe(false);
    expect(finishRequest).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(finishRequest.mock.calls[0][1]?.body))).toMatchObject({
      provider: 'openai-codex',
      model: 'gpt-5.6-luna',
      modelFallbackOccurred: false,
    });
  });
});
