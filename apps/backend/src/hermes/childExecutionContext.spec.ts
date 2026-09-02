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
    const [coder, kanban] = await Promise.all([
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

    expect(coder.runId).not.toBe(kanban.runId);
    expect(coder.cardId).toBe('card_main_chat');
    expect(kanban.cardId).toBe('card_main_chat');
    expect(coder.grantedTools).toEqual(['canvas.inspect']);
    expect(kanban.grantedTools).toEqual(['canvas.inspect']);
    expect(coder.parentRunId).toBe('main-run');
    expect(kanban.parentRunId).toBe('main-run');
    expect(executionToolCallMeta(coder.contextId)).toEqual({
      'liquidaity/execution': coder.contextId,
    });
    expect(JSON.stringify(executionToolCallMeta(coder.contextId))).not.toMatch(/token|secret|credential/i);
    expect(request).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(request.mock.calls[0][1]?.body))).toMatchObject({
      nativeChildId: 'sa-one',
      provider: 'openai-codex',
      model: 'gpt-5.6-luna',
    });
  });

  it('keeps concurrent saved Coder root Runs isolated before their first MCP call', () => {
    const first = registerHermesRootExecutionContext({
      sessionId: 'coder-session-one',
      runId: 'coder-run-one',
      projectId: 'project-1',
      deckId: 'deck_builder',
      conversationId: 'coder-conversation-one',
      cardId: 'card_local_coder',
      runtimeMode: 'delegate',
      grantedTools: ['cbm.get_code_snippet', 'cbm.search_graph'],
    });
    const second = registerHermesRootExecutionContext({
      sessionId: 'coder-session-two',
      runId: 'coder-run-two',
      projectId: 'project-1',
      deckId: 'deck_builder',
      conversationId: 'coder-conversation-two',
      cardId: 'card_local_coder',
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
      callerCardId: 'card_local_coder',
      callerRuntimeKind: 'hermes',
      callerRuntimeMode: 'delegate',
      grantedTools: ['cbm.get_code_snippet', 'cbm.search_graph'],
    });

    expect(resolveHermesExecutionContext({
      contextId: first.contextId,
      principal: principal('coder-run-one', 'coder-conversation-one'),
    })).toMatchObject({
      runId: 'coder-run-one',
      conversationId: 'coder-conversation-one',
      cardId: 'card_local_coder',
    });
    expect(resolveHermesExecutionContext({
      contextId: second.contextId,
      principal: principal('coder-run-two', 'coder-conversation-two'),
    })).toMatchObject({
      runId: 'coder-run-two',
      conversationId: 'coder-conversation-two',
      cardId: 'card_local_coder',
    });
    expect(() => resolveHermesExecutionContext({
      contextId: first.contextId,
      principal: principal('coder-run-two', 'coder-conversation-two'),
    })).toThrow('hermes_execution_context_principal_mismatch');
  });

  it('retains one exact Agent Builder effect target through native children', async () => {
    const builder = registerHermesRootExecutionContext({
      sessionId: 'builder-session',
      runId: 'builder-run',
      projectId: 'project-1',
      deckId: 'deck_builder',
      conversationId: 'builder-conversation',
      cardId: 'card_agent_builder',
      runtimeMode: 'delegate',
      grantedTools: ['card.update_configuration'],
      effectTarget: {
        cardId: 'card_trading_workbench',
        cardRevisionId: 'trading-revision-one',
        deckRevision: 'deck-revision-one',
      },
    });
    const child = await createHermesChildExecutionContext({
      sessionId: 'builder-session',
      parentExecutionContextId: builder.contextId,
      nativeChildId: 'builder-helper',
      request: vi.fn(persistRequestedRun),
    });

    expect(child).toMatchObject({
      effectTargetCardId: 'card_trading_workbench',
      effectTargetCardRevisionId: 'trading-revision-one',
      effectTargetDeckRevision: 'deck-revision-one',
    });
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
    const coder = await createHermesChildExecutionContext({
      sessionId: 'acp-session-1',
      parentExecutionContextId: parent.contextId,
      nativeChildId: 'sa-coder',
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
    expect(resolveHermesExecutionContext({ contextId: coder.contextId, principal }).runId)
      .toBe(coder.runId);
    expect(() => resolveHermesExecutionContext({
      contextId: coder.contextId,
      principal: { ...principal, callerCardId: 'card_forged' },
    })).toThrow('hermes_execution_context_principal_mismatch');
    expect(() => resolveHermesExecutionContext({
      contextId: coder.contextId,
      principal: { ...principal, grantedTools: ['cbm.index_repository'] },
    })).toThrow('hermes_execution_context_principal_mismatch');
    expect(() => resolveHermesExecutionContext({
      contextId: 'unknown-context', principal,
    })).toThrow('hermes_execution_context_unknown');
    expect(() => resolveHermesExecutionContext({
      contextId: coder.contextId, principal, now: coder.expiresAt + 1,
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
