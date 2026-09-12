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

  it('signs an independent non-Main Card terminal without inventing a Run or conversation', () => {
    const token = createInternalMcpBearer({
      kind: 'agent-terminal',
      projectId: 'project-1',
      deckId: 'deck_builder',
      callerCardId: 'card_hermes_steward',
      terminalSessionId: 'a4d8e59a-5ac4-4f4d-a7df-a5c87e53d7eb',
      profile: 'liquidaity-hermes-steward',
      callerRuntimeKind: 'hermes',
      callerRuntimeMode: 'delegate',
      grantedTools: ['canvas.inspect', 'canvas.inspect'],
    }, env, 1000);
    const principal = verifyInternalMcpBearerForTest(token, env).principal as Record<string, unknown>;
    expect(principal).toEqual({
      kind: 'agent-terminal',
      projectId: 'project-1',
      deckId: 'deck_builder',
      callerCardId: 'card_hermes_steward',
      terminalSessionId: 'a4d8e59a-5ac4-4f4d-a7df-a5c87e53d7eb',
      profile: 'liquidaity-hermes-steward',
      callerRuntimeKind: 'hermes',
      callerRuntimeMode: 'delegate',
      grantedTools: ['canvas.inspect'],
      presentedTools: ['canvas.inspect'],
    });
    expect(principal).not.toHaveProperty('conversationId');
    expect(principal).not.toHaveProperty('parentRunId');
  });

  it('does not normalize forged runtime or extra Run fields into a terminal claim', () => {
    const base = {
      kind: 'agent-terminal', projectId: 'project-1', deckId: 'deck_builder',
      callerCardId: 'card_hermes_steward', terminalSessionId: 'terminal-1',
      profile: 'liquidaity-hermes-steward', callerRuntimeKind: 'hermes',
      callerRuntimeMode: 'delegate', grantedTools: ['canvas.inspect'],
    } as const;
    expect(() => createInternalMcpBearer({ ...base, callerRuntimeKind: 'autogen' } as any, env, 100))
      .toThrow('internal_mcp_agent_terminal_principal_invalid');
    const principal = verifyInternalMcpBearerForTest(createInternalMcpBearer({
      ...base, conversationId: 'forged-conversation', parentRunId: 'forged-run',
      requiresExecutionContext: true,
    } as any, env, 100), env).principal as Record<string, unknown>;
    expect(principal).not.toHaveProperty('conversationId');
    expect(principal).not.toHaveProperty('parentRunId');
    expect(principal).not.toHaveProperty('requiresExecutionContext');
  });

  it.each([
    { callerCardId: 'card_main_chat' },
    { callerCardId: 'builder' },
    { terminalSessionId: '' },
    { profile: 'main' },
    { profile: 'default' },
    { profile: 'builder' },
    { profile: 'liquidaity-main' },
  ])('rejects a forbidden or incomplete agent terminal principal', (override) => {
    expect(() => createInternalMcpBearer({
      kind: 'agent-terminal',
      projectId: 'project-1', deckId: 'deck_builder', callerCardId: 'card_hermes_steward',
      terminalSessionId: 'terminal-1', profile: 'liquidaity-hermes-steward',
      callerRuntimeKind: 'hermes', callerRuntimeMode: 'delegate', grantedTools: ['canvas.inspect'],
      ...override,
    }, env, 100)).toThrow('internal_mcp_agent_terminal_principal_invalid');
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
