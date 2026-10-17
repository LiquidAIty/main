/**
 * Entity: Internal MCP Auth
 * Relationship: Restricts backend-to-MCP transport to loopback, mints the catalog-reader bearer, and timing-safely verifies the supervised process secret for internal routes.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

const INTERNAL_MCP_ISSUER = 'liquidaity-runtime';
const INTERNAL_MCP_AUDIENCE = 'liquidaity-internal-mcp';
const DEFAULT_INTERNAL_MCP_URL = 'http://127.0.0.1:8765/mcp';
const TOKEN_LIFETIME_SECONDS = 12 * 60 * 60;

export type InternalMcpPrincipal = { kind: 'catalog-reader' };

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
  if (principal.kind !== 'catalog-reader') {
    throw new Error('internal_mcp_principal_kind_invalid');
  }
  const header = base64UrlJson({ alg: 'HS256', typ: 'JWT' });
  const payload = base64UrlJson({
    iss: INTERNAL_MCP_ISSUER,
    aud: INTERNAL_MCP_AUDIENCE,
    sub: 'catalog-reader',
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
