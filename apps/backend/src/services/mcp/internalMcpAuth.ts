import { createHmac, timingSafeEqual } from 'node:crypto';

const INTERNAL_MCP_ISSUER = 'liquidaity-runtime';
const INTERNAL_MCP_AUDIENCE = 'liquidaity-internal-mcp';
const DEFAULT_INTERNAL_MCP_URL = 'http://127.0.0.1:8765/mcp';
const TOKEN_LIFETIME_SECONDS = 12 * 60 * 60;

export type InternalMcpPrincipal =
  | {
      kind: 'catalog-reader';
    }
  | {
      kind: 'system-root' | 'card-runtime';
      projectId: string;
      deckId: string;
      conversationId: string;
      parentRunId: string;
      callerCardId: string;
      callerRuntimeKind: 'hermes' | 'autogen';
      callerRuntimeMode: 'main' | 'delegate' | 'kanban' | 'assistant' | 'magentic_one';
      grantedTools: string[];
      presentedTools?: string[];
      requiresExecutionContext?: boolean;
      executionContextId?: string;
      // Signed native attribution only; these do not grant permissions or
      // change token lifetime, revocation, or execution-context enforcement.
      nativeChildId?: string;
      nativeRunId?: string;
    };

function requiredSecret(env: NodeJS.ProcessEnv): string {
  const secret = String(env.LIQUIDAITY_INTERNAL_MCP_SECRET || '').trim();
  if (secret.length < 32) throw new Error('internal_mcp_secret_missing');
  return secret;
}

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function uniqueStrings(values: string[]): string[] {
  return values
    .map((value) => String(value || '').trim())
    .filter((value, index, all) => Boolean(value) && all.indexOf(value) === index)
    .sort((left, right) => left.localeCompare(right));
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
  const normalized = principal.kind === 'catalog-reader'
    ? principal
    : {
        ...principal,
        projectId: String(principal.projectId || '').trim(),
        deckId: String(principal.deckId || '').trim(),
        conversationId: String(principal.conversationId || '').trim(),
        parentRunId: String(principal.parentRunId || '').trim(),
        callerCardId: String(principal.callerCardId || '').trim(),
        callerRuntimeKind: String(principal.callerRuntimeKind || '').trim() as typeof principal.callerRuntimeKind,
        callerRuntimeMode: String(principal.callerRuntimeMode || '').trim() as typeof principal.callerRuntimeMode,
        grantedTools: uniqueStrings(principal.grantedTools),
        presentedTools: uniqueStrings(principal.presentedTools ?? principal.grantedTools),
        requiresExecutionContext: principal.requiresExecutionContext === true,
        executionContextId: String(principal.executionContextId || '').trim() || undefined,
      };
  if (normalized.kind !== 'catalog-reader') {
    const required = [
      normalized.projectId,
      normalized.deckId,
      normalized.conversationId,
      normalized.parentRunId,
      normalized.callerCardId,
      normalized.callerRuntimeKind,
      normalized.callerRuntimeMode,
    ];
    if (required.some((value) => !value)) throw new Error('internal_mcp_principal_incomplete');
    if (normalized.presentedTools.some((name) => !normalized.grantedTools.includes(name))) {
      throw new Error('internal_mcp_presentation_exceeds_grant');
    }
  }
  const header = base64UrlJson({ alg: 'HS256', typ: 'JWT' });
  const payload = base64UrlJson({
    iss: INTERNAL_MCP_ISSUER,
    aud: INTERNAL_MCP_AUDIENCE,
    sub: normalized.kind === 'catalog-reader'
      ? 'catalog-reader'
      : `${normalized.kind}:${normalized.callerCardId}`,
    iat: nowSeconds,
    exp: nowSeconds + TOKEN_LIFETIME_SECONDS,
    scope: 'liquidaity.main',
    principal: normalized,
  });
  const unsigned = `${header}.${payload}`;
  const signature = createHmac('sha256', secret).update(unsigned).digest('base64url');
  return `${unsigned}.${signature}`;
}

export function internalMcpAuthorization(
  principal: InternalMcpPrincipal,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return `Bearer ${createInternalMcpBearer(principal, env)}`;
}

export function verifyInternalMcpBearerForTest(
  token: string,
  env: NodeJS.ProcessEnv,
): Record<string, unknown> {
  const [header, payload, signature, extra] = token.split('.');
  if (!header || !payload || !signature || extra) throw new Error('internal_mcp_token_invalid');
  const expected = createHmac('sha256', requiredSecret(env))
    .update(`${header}.${payload}`)
    .digest();
  const actual = Buffer.from(signature, 'base64url');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new Error('internal_mcp_token_invalid');
  }
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
}

export function withoutInternalMcpSecret(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const childEnv = { ...env };
  delete childEnv.LIQUIDAITY_INTERNAL_MCP_SECRET;
  return childEnv;
}
