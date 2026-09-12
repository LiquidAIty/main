import { describe, expect, it } from 'vitest';

import {
  createInternalMcpBearer,
  resolveInternalMcpUrl,
  verifyInternalMcpBearerForTest,
  withoutInternalMcpSecret,
} from './internalMcpAuth';

const env = {
  LIQUIDAITY_INTERNAL_MCP_SECRET: '0123456789abcdef0123456789abcdef',
  LIQUIDAITY_INTERNAL_MCP_URL: 'http://127.0.0.1:8765/mcp',
};

describe('internal MCP Card authentication', () => {
  it('signs fixed server-owned Card identity and grants', () => {
    const token = createInternalMcpBearer({
      kind: 'card-runtime',
      projectId: 'project-1',
      deckId: 'deck_builder',
      conversationId: 'conversation-1',
      parentRunId: 'run-1',
      callerCardId: 'card-main',
      callerRuntimeKind: 'hermes',
      callerRuntimeMode: 'main',
      grantedTools: ['canvas.inspect', 'canvas.inspect', 'card.run_assistant_agent'],
      requiresExecutionContext: true,
      executionContextId: 'context-root-1',
    }, env, 1000);
    const claims = verifyInternalMcpBearerForTest(token, env);
    expect(claims).toMatchObject({
      iss: 'liquidaity-runtime',
      aud: 'liquidaity-internal-mcp',
      iat: 1000,
      principal: {
        kind: 'card-runtime',
        callerCardId: 'card-main',
        callerRuntimeKind: 'hermes',
        callerRuntimeMode: 'main',
        grantedTools: ['canvas.inspect', 'card.run_assistant_agent'],
        requiresExecutionContext: true,
        executionContextId: 'context-root-1',
      },
    });
  });

  it('keeps presentation bounded by the signed authorization ceiling', () => {
    expect(() => createInternalMcpBearer({
      kind: 'card-runtime',
      projectId: 'project-1', deckId: 'deck-1', conversationId: 'conversation-1',
      parentRunId: 'run-1', callerCardId: 'card-1', callerRuntimeKind: 'hermes',
      callerRuntimeMode: 'main', grantedTools: ['canvas.inspect'],
      presentedTools: ['cbm.search_graph'],
    }, env, 100)).toThrow('internal_mcp_presentation_exceeds_grant');
  });

  it('rejects the replaced runless terminal principal', () => {
    expect(() => createInternalMcpBearer({ kind: 'agent-terminal' } as any, env))
      .toThrow('internal_mcp_principal_kind_invalid');
  });

  const terminalRun = {
    kind: 'card-runtime' as const, projectId: 'project', deckId: 'deck',
    conversationId: '', parentRunId: 'persisted-run', callerCardId: 'saved-agent',
    callerRuntimeKind: 'hermes' as const, callerRuntimeMode: 'delegate' as const,
    grantedTools: ['canvas.inspect'], requiresExecutionContext: true,
    terminalOwner: { userId: 'owner', terminalSessionId: 'terminal', profile: 'saved-agent', cardRevisionId: 'revision' },
  };
  it('signs a real Card Run with full terminal ownership and no invented conversation', () => {
    const principal = verifyInternalMcpBearerForTest(createInternalMcpBearer(terminalRun, env), env).principal;
    expect(principal).toMatchObject(terminalRun);
  });
  it.each([
    { callerCardId: 'card_main_chat' }, { callerCardId: 'builder' },
    { callerRuntimeKind: 'autogen' }, { requiresExecutionContext: false },
    ...['main', 'default', 'builder', 'liquidaity-main'].map((profile) => ({ terminalOwner: { ...terminalRun.terminalOwner, profile } })),
    ...['userId', 'terminalSessionId', 'profile', 'cardRevisionId'].map((field) => ({ terminalOwner: { ...terminalRun.terminalOwner, [field]: '' } })),
  ])('rejects incomplete or foreign terminal Run identity: %j', (override) => {
    expect(() => createInternalMcpBearer({ ...terminalRun, ...override } as any, env))
      .toThrow('internal_mcp_terminal_run_identity_invalid');
  });
  it('requires a persisted Run and rejects a wider presented grant', () => {
    expect(() => createInternalMcpBearer({ ...terminalRun, parentRunId: '' }, env))
      .toThrow('internal_mcp_principal_incomplete');
    expect(() => createInternalMcpBearer({ ...terminalRun, presentedTools: ['card.create'] }, env))
      .toThrow('internal_mcp_presentation_exceeds_grant');
  });

  it('keeps the signing secret out of model runtime environments', () => {
    const child = withoutInternalMcpSecret({ ...env, SAFE: 'yes' });
    expect(child.LIQUIDAITY_INTERNAL_MCP_SECRET).toBeUndefined();
    expect(child.SAFE).toBe('yes');
  });

  it('accepts only the canonical loopback MCP seam', () => {
    expect(resolveInternalMcpUrl(env)).toBe('http://127.0.0.1:8765/mcp');
    expect(() => resolveInternalMcpUrl({ ...env, LIQUIDAITY_INTERNAL_MCP_URL: 'https://example.com/mcp' }))
      .toThrow('internal_mcp_url_must_be_loopback_http');
  });
});
