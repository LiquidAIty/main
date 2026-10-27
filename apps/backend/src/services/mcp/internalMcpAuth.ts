/**
 * Graph + less = more: less code that does the same work as more code is more useful.
 * Entity names the feature; Relationship explains why this file belongs and what it contributes.
 * Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
 * Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
 * Entity: MCP Host
 * Relationship: This file restricts backend-to-MCP transport to the canonical loopback endpoint and signs catalog-reader or saved-Card scope for the host.
 * Entity: Credentials
 * Relationship: This file loads and timing-safely verifies the supervised internal process secret used by protected backend and MCP seams.
 * Entity: Authentication
 * Relationship: This file signs the exact short-lived internal principal accepted by the MCP host and rejects unsupported principal kinds.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

const INTERNAL_MCP_ISSUER = 'liquidaity-runtime';
const INTERNAL_MCP_AUDIENCE = 'liquidaity-internal-mcp';
const DEFAULT_INTERNAL_MCP_URL = 'http://127.0.0.1:8765/mcp';
const TOKEN_LIFETIME_SECONDS = 12 * 60 * 60;

export type InternalMcpPrincipal = { kind: 'catalog-reader' } | {
  kind: 'card-runtime';
  ownerUserId: string;
  projectId: string;
  deckId: string;
  profile: string;
};

function requiredSecret(env: NodeJS.ProcessEnv): string {
  const secret = String(env.LIQUIDAITY_INTERNAL_MCP_SECRET || '').trim();
  if (secret.length < 32) throw new Error('internal_mcp_secret_missing');
  return secret;
}

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

export function resolveInternalMcpUrl(env: NodeJS.ProcessEnv = process.env): string {
  const value = String(env.LIQUIDAITY_INTERNAL_MCP_URL || DEFAULT_INTERNAL_MCP_URL).trim();
  const parsed = new URL(value);
  if (parsed.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(parsed.hostname)) {
    throw new Error('internal_mcp_url_must_be_loopback_http');
  }
  if (parsed.pathname !== '/mcp') throw new Error('internal_mcp_url_path_invalid');
  return parsed.toString();
}

export function createInternalMcpBearer(
  principal: InternalMcpPrincipal,
  env: NodeJS.ProcessEnv = process.env,
  nowSeconds = Math.floor(Date.now() / 1000),
): string {
  const secret = requiredSecret(env);
  if (!['catalog-reader', 'card-runtime'].includes(principal.kind)) {
    throw new Error('internal_mcp_principal_kind_invalid');
  }
  if (principal.kind === 'card-runtime'
    && [principal.ownerUserId, principal.projectId, principal.deckId, principal.profile]
      .some(value => typeof value !== 'string' || !value.trim())) {
    throw new Error('internal_mcp_card_scope_required');
  }
  const header = base64UrlJson({ alg: 'HS256', typ: 'JWT' });
  const payload = base64UrlJson({
    iss: INTERNAL_MCP_ISSUER,
    aud: INTERNAL_MCP_AUDIENCE,
    sub: principal.kind,
    iat: nowSeconds,
    exp: nowSeconds + TOKEN_LIFETIME_SECONDS,
    scope: 'liquidaity.main',
    principal,
  });
  const unsigned = `${header}.${payload}`;
  const signature = createHmac('sha256', secret).update(unsigned).digest('base64url');
  return `${unsigned}.${signature}`;
}

export function internalMcpProcessSecretAuthorized(
  value: unknown,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const expected = Buffer.from(String(env.LIQUIDAITY_INTERNAL_MCP_SECRET || '').trim(), 'utf8');
  const supplied = Buffer.from(String(value || '').trim(), 'utf8');
  return expected.length >= 32
    && supplied.length === expected.length
    && timingSafeEqual(supplied, expected);
}
