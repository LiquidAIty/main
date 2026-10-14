import { createHmac, timingSafeEqual } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  createInternalMcpBearer,
  internalMcpProcessSecretAuthorized,
  resolveInternalMcpUrl,
} from './internalMcpAuth';

const env = {
  LIQUIDAITY_INTERNAL_MCP_SECRET: '0123456789abcdef0123456789abcdef',
  LIQUIDAITY_INTERNAL_MCP_URL: 'http://127.0.0.1:8765/mcp',
};

function verifyBearer(token: string): Record<string, any> {
  const [header, payload, signature, extra] = token.split('.');
  if (!header || !payload || !signature || extra) throw new Error('internal_mcp_token_invalid');
  const expected = createHmac('sha256', env.LIQUIDAITY_INTERNAL_MCP_SECRET)
    .update(`${header}.${payload}`)
    .digest();
  const actual = Buffer.from(signature, 'base64url');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new Error('internal_mcp_token_invalid');
  }
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
}

describe('internal MCP catalog authentication', () => {
  it('signs only the catalog-reader principal', () => {
    const claims = verifyBearer(createInternalMcpBearer({ kind: 'catalog-reader' }, env, 1000));
    expect(claims).toMatchObject({
      iss: 'liquidaity-runtime',
      aud: 'liquidaity-internal-mcp',
      sub: 'catalog-reader',
      iat: 1000,
      principal: { kind: 'catalog-reader' },
    });
    expect(() => createInternalMcpBearer({ kind: 'unknown' } as any, env))
      .toThrow('internal_mcp_principal_kind_invalid');
  });

  it('signs one bounded saved-Card runtime principal without widening its tools', () => {
    const claims = verifyBearer(createInternalMcpBearer({
      kind: 'card-runtime',
      projectId: 'project-one',
      deckId: 'deck_builder',
      conversationId: 'main',
      parentRunId: 'run-one',
      callerCardId: 'builder',
      callerRuntimeKind: 'hermes',
      callerRuntimeMode: 'delegate',
      grantedTools: ['graphiti.search_nodes', 'cbm.search_graph'],
      presentedTools: ['cbm.search_graph'],
    }, env, 1000));
    expect(claims).toMatchObject({
      sub: 'card-runtime:builder',
      principal: {
        kind: 'card-runtime',
        callerCardId: 'builder',
        callerRuntimeMode: 'delegate',
        grantedTools: ['cbm.search_graph', 'graphiti.search_nodes'],
        presentedTools: ['cbm.search_graph'],
      },
    });
    expect(() => createInternalMcpBearer({
      kind: 'card-runtime',
      projectId: 'project-one',
      deckId: 'deck_builder',
      conversationId: 'main',
      parentRunId: 'run-one',
      callerCardId: 'builder',
      callerRuntimeKind: 'hermes',
      callerRuntimeMode: 'delegate',
      grantedTools: [],
      presentedTools: ['cbm.search_graph'],
    }, env)).toThrow('internal_mcp_presentation_exceeds_grant');
  });

  it('accepts only the canonical loopback MCP seam', () => {
    expect(resolveInternalMcpUrl(env)).toBe('http://127.0.0.1:8765/mcp');
    expect(() => resolveInternalMcpUrl({ ...env, LIQUIDAITY_INTERNAL_MCP_URL: 'https://example.com/mcp' }))
      .toThrow('internal_mcp_url_must_be_loopback_http');
  });

  it('authenticates the process bridge secret without accepting short or foreign values', () => {
    expect(internalMcpProcessSecretAuthorized(env.LIQUIDAITY_INTERNAL_MCP_SECRET, env)).toBe(true);
    expect(internalMcpProcessSecretAuthorized('wrong', env)).toBe(false);
    expect(internalMcpProcessSecretAuthorized('', env)).toBe(false);
    expect(internalMcpProcessSecretAuthorized('short', {
      LIQUIDAITY_INTERNAL_MCP_SECRET: 'short',
    })).toBe(false);
  });
});
