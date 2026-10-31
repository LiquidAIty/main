/**
 * Graph + less = more: less code that does the same work as more code is more useful.
 * Entity names the feature; Relationship explains why this file belongs and what it contributes.
 * Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
 * Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
 * Entity: MCP Host
 * Relationship: This file verifies loopback-only MCP transport and stable, exactly scoped Card credentials without changing catalog-reader issuance.
 * Entity: Credentials
 * Relationship: This file verifies missing, short, or foreign internal process secrets are rejected without weakening timing-safe comparison.
 * Entity: Authentication
 * Relationship: This file verifies the internal bearer contains the exact issuer, audience, subject, lifetime, scope, and principal claims expected by the MCP host.
 */

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

  it('accepts only the canonical loopback MCP seam', () => {
    expect(resolveInternalMcpUrl(env)).toBe('http://127.0.0.1:8765/mcp');
    expect(() => resolveInternalMcpUrl({ ...env, LIQUIDAITY_INTERNAL_MCP_URL: 'https://example.com/mcp' }))
      .toThrow('internal_mcp_url_must_be_loopback_http');
  });

  it('keeps Card credential bytes stable within the hour and rotates at the next boundary', () => {
    const principal = { kind: 'card-runtime' as const, ownerUserId: 'owner',
      projectId: 'project', deckId: 'deck', profile: 'knowgraph' };
    const token = createInternalMcpBearer(principal, env, 7200);
    expect(createInternalMcpBearer(principal, env, 10799)).toBe(token);
    expect(createInternalMcpBearer(principal, env, 10800)).not.toBe(token);
    const claims = verifyBearer(token);
    expect(claims).toMatchObject({ sub: 'card-runtime', iat: 7200, exp: 50400,
      scope: 'liquidaity.main', principal });
    expect(claims.exp - 10799).toBeLessThanOrEqual(12 * 60 * 60);
  });

  it('never reuses Card credentials across owner, Project, deck, profile, or signing secret', () => {
    const principal = { kind: 'card-runtime' as const, ownerUserId: 'owner',
      projectId: 'project', deckId: 'deck', profile: 'knowgraph' };
    const token = createInternalMcpBearer(principal, env, 7200);
    for (const field of ['ownerUserId', 'projectId', 'deckId', 'profile'] as const) {
      const changed = { ...principal, [field]: `${principal[field]}-other` };
      const scoped = createInternalMcpBearer(changed, env, 7201);
      expect(scoped).not.toBe(token);
      expect(verifyBearer(scoped).principal).toEqual(changed);
      expect(() => createInternalMcpBearer({ ...principal, [field]: '' }, env, 7201))
        .toThrow('internal_mcp_card_scope_required');
    }
    expect(createInternalMcpBearer(principal, {
      ...env, LIQUIDAITY_INTERNAL_MCP_SECRET: 'abcdef0123456789abcdef0123456789ab',
    }, 7201)).not.toBe(token);
    expect(createInternalMcpBearer({ kind: 'catalog-reader' }, env, 7201))
      .not.toBe(createInternalMcpBearer({ kind: 'catalog-reader' }, env, 7202));
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
