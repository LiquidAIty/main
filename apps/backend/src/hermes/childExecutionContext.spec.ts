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
      delegateProfiles: [{
        profileId: 'card_coder',
        cardId: 'card_coder',
        runtimeMode: 'delegate',
        grantedTools: ['cbm.search_graph'],
      }, {
        profileId: 'card_hermes_steward',
        cardId: 'card_hermes_steward',
        runtimeMode: 'kanban',
        grantedTools: ['knowgraph.search'],
      }],
    });
    bindHermesRootExecutionSession(context.contextId, 'acp-session-1');
    return context;
  }

  it('creates concurrent saved-profile children without crossing Card or Run identity', async () => {
    const parent = root();
    const request = vi.fn(async () => ({ ok: true }));
    const [coder, kanban] = await Promise.all([
      createHermesChildExecutionContext({
        sessionId: 'acp-session-1',
        parentExecutionContextId: parent.contextId,
        nativeChildId: 'sa-coder',
        delegateProfileId: 'card_coder',
        request,
      }),
      createHermesChildExecutionContext({
        sessionId: 'acp-session-1',
        parentExecutionContextId: parent.contextId,
        nativeChildId: 'sa-kanban',
        delegateProfileId: 'card_hermes_steward',
        request,
      }),
    ]);

    expect(coder.runId).not.toBe(kanban.runId);
    expect(coder.cardId).toBe('card_coder');
    expect(kanban.cardId).toBe('card_hermes_steward');
    expect(coder.parentRunId).toBe('main-run');
    expect(kanban.parentRunId).toBe('main-run');
    expect(executionToolCallMeta(coder.contextId)).toEqual({
      'liquidaity/execution': coder.contextId,
    });
    expect(JSON.stringify(executionToolCallMeta(coder.contextId))).not.toMatch(/token|secret|credential/i);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('keeps an ephemeral child on the originating saved Card with a distinct Run', async () => {
    const parent = root();
    const child = await createHermesChildExecutionContext({
      sessionId: 'acp-session-1',
      parentExecutionContextId: parent.contextId,
      nativeChildId: 'sa-ephemeral',
      request: vi.fn(async () => ({ ok: true })),
    });
    expect(child.cardId).toBe('card_main_chat');
    expect(child.runId).not.toBe(parent.runId);
    expect(child.parentRunId).toBe(parent.runId);
    expect(child.runtimeMode).toBe('main');
  });

  it('fails closed for unauthorized profiles, forged principals, and grant widening', async () => {
    const parent = root();
    const request = vi.fn(async () => ({ ok: true }));
    await expect(createHermesChildExecutionContext({
      sessionId: 'acp-session-1',
      parentExecutionContextId: parent.contextId,
      nativeChildId: 'sa-forged',
      delegateProfileId: 'card_unknown',
      request,
    })).rejects.toThrow('hermes_delegate_profile_not_authorized');

    const coder = await createHermesChildExecutionContext({
      sessionId: 'acp-session-1',
      parentExecutionContextId: parent.contextId,
      nativeChildId: 'sa-coder',
      delegateProfileId: 'card_coder',
      request,
    });
    const principal = {
      kind: 'card-runtime',
      requiresExecutionContext: true,
      projectId: 'project-1',
      deckId: 'deck_builder',
      conversationId: 'conversation-1',
      parentRunId: 'main-run',
      callerCardId: 'card_coder',
      callerRuntimeKind: 'hermes',
      callerRuntimeMode: 'delegate',
      grantedTools: ['cbm.search_graph'],
    };
    expect(resolveHermesExecutionContext({ contextId: coder.contextId, principal }).runId)
      .toBe(coder.runId);
    expect(() => resolveHermesExecutionContext({
      contextId: coder.contextId,
      principal: { ...principal, callerCardId: 'card_main_chat' },
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
    const createRequest = vi.fn(async () => ({ ok: true }));
    const child = await createHermesChildExecutionContext({
      sessionId: 'acp-session-1',
      parentExecutionContextId: parent.contextId,
      nativeChildId: 'sa-one',
      request: createRequest,
    });
    const finishRequest = vi.fn(async () => ({ ok: true }));
    await expect(finishHermesExecutionContext({
      contextId: child.contextId,
      state: 'completed',
      request: finishRequest,
    })).resolves.toBe(true);
    await expect(finishHermesExecutionContext({
      contextId: child.contextId,
      state: 'failed',
      request: finishRequest,
    })).resolves.toBe(false);
    expect(finishRequest).toHaveBeenCalledTimes(1);
  });
});
