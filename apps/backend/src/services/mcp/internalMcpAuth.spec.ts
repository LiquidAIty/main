import { describe, expect, it } from 'vitest';

import {
  createInternalMcpBearer,
  internalMcpBridgeSecretAuthorized,
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
      grantedTools: ['canvas.inspect', 'canvas.inspect', 'run_mag_one'],
      nativeChildId: 'native-child-1',
      nativeRunId: 'native-run-1',
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
        grantedTools: ['canvas.inspect', 'run_mag_one'],
        nativeChildId: 'native-child-1',
        nativeRunId: 'native-run-1',
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

  it('signs a runless materializer principal with the exact saved Card grants', () => {
    const token = createInternalMcpBearer({
      kind: 'materializer-read',
      projectId: ' project-1 ',
      deckId: ' deck_builder ',
      callerCardId: ' builder ',
      conversationId: ' main ',
      grantedTools: ['cbm.search_graph', 'card.create', 'cbm.search_graph'],
      grantedConnections: ['graphiti', 'cbm', 'graphiti'],
    }, env, 1000);
    const claims = verifyInternalMcpBearerForTest(token, env);
    expect(claims).toMatchObject({
      sub: 'materializer-read:builder',
      iat: 1000,
      exp: 1060,
      principal: {
        kind: 'materializer-read',
        projectId: 'project-1',
        deckId: 'deck_builder',
        callerCardId: 'builder',
        conversationId: 'main',
        grantedTools: ['card.create', 'cbm.search_graph'],
        grantedConnections: ['cbm', 'graphiti'],
      },
    });
    expect(claims.principal).not.toHaveProperty('parentRunId');
  });

  it('rejects an incomplete runless materializer identity', () => {
    expect(() => createInternalMcpBearer({
      kind: 'materializer-read',
      projectId: 'project-1',
      deckId: '',
      callerCardId: 'builder',
      grantedTools: ['cbm.search_graph'],
    }, env)).toThrow('internal_mcp_principal_incomplete');
  });

  it('rejects the replaced runless terminal principal', () => {
    expect(() => createInternalMcpBearer({ kind: 'agent-terminal' } as any, env))
      .toThrow('internal_mcp_principal_kind_invalid');
  });

  const terminalRun = {
    kind: 'card-runtime' as const, projectId: 'project', deckId: 'deck',
    conversationId: 'conversation-1', parentRunId: 'persisted-run', callerCardId: 'saved-agent',
    callerRuntimeKind: 'hermes' as const, callerRuntimeMode: 'delegate' as const,
    grantedTools: ['canvas.inspect'], nativeChildId: 'native-child', nativeRunId: 'native-run',
  };
  it('signs a real Card Run with direct saved authority and native attribution', () => {
    const principal = verifyInternalMcpBearerForTest(createInternalMcpBearer(terminalRun, env), env).principal;
    expect(principal).toMatchObject(terminalRun);
  });
  it.each([
    ['card_main_chat', 'main'],
    ['builder', 'delegate'],
  ] as const)('accepts valid saved Card attribution for %s', (callerCardId, callerRuntimeMode) => {
    const value = {
      ...terminalRun,
      callerCardId,
      callerRuntimeMode,
    };
    const principal = verifyInternalMcpBearerForTest(createInternalMcpBearer(value, env), env).principal;
    expect(principal).toMatchObject(value);
  });
  it.each([
    { projectId: '' }, { deckId: '' }, { conversationId: '' }, { parentRunId: '' },
    { callerCardId: '' }, { callerRuntimeKind: '' }, { callerRuntimeMode: '' },
  ])('rejects incomplete saved Run identity: %j', (override) => {
    expect(() => createInternalMcpBearer({ ...terminalRun, ...override } as any, env))
      .toThrow('internal_mcp_principal_incomplete');
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

  it('authenticates the existing process bridge secret without accepting short or foreign values', () => {
    expect(internalMcpBridgeSecretAuthorized(env.LIQUIDAITY_INTERNAL_MCP_SECRET, env)).toBe(true);
    expect(internalMcpBridgeSecretAuthorized('wrong', env)).toBe(false);
    expect(internalMcpBridgeSecretAuthorized('', env)).toBe(false);
    expect(internalMcpBridgeSecretAuthorized('short', {
      LIQUIDAITY_INTERNAL_MCP_SECRET: 'short',
    })).toBe(false);
  });
});
