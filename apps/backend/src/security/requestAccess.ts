import crypto from 'crypto';
import type { Request } from 'express';

const DEFAULT_LOCAL_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:4000',
  'http://127.0.0.1:4000',
];

function normalizeHost(value: string): string {
  const trimmed = String(value || '').trim().toLowerCase();
  if (!trimmed) return '';
  const withoutScheme = trimmed.replace(/^[a-z]+:\/\//, '');
  const withoutPath = withoutScheme.split('/')[0];
  const withoutPort = withoutPath.startsWith('[')
    ? withoutPath.replace(/^\[|](:\d+)?$/g, '')
    : withoutPath.split(':')[0];
  return withoutPort;
}

function parseOriginHost(origin: string): string {
  try {
    return normalizeHost(new URL(origin).host);
  } catch {
    return normalizeHost(origin);
  }
}

function isLoopbackHost(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
}

function isLoopbackAddress(value: string): boolean {
  const normalized = String(value || '').trim().toLowerCase();
  return (
    normalized === '127.0.0.1' ||
    normalized === '::1' ||
    normalized === '::ffff:127.0.0.1' ||
    normalized === 'localhost'
  );
}

export function isLocalDevLoopbackRequest(req: Request): boolean {
  const nodeEnv = (process.env.NODE_ENV || 'development').toLowerCase();
  if (nodeEnv === 'production') return false;

  const hostHeader = normalizeHost(String(req.headers.host || req.hostname || ''));
  const originHeader = parseOriginHost(String(req.headers.origin || ''));
  const remoteAddress = String(req.socket.remoteAddress || '');

  return (
    isLoopbackHost(hostHeader) ||
    isLoopbackHost(originHeader) ||
    isLoopbackAddress(remoteAddress)
  );
}

function safeTokenEquals(expected: string, actual: string): boolean {
  const left = Buffer.from(expected, 'utf8');
  const right = Buffer.from(actual, 'utf8');
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function readBootstrapToken(req: Request): string {
  const headerToken = String(req.headers['x-bootstrap-token'] || '').trim();
  if (headerToken) return headerToken;
  if (typeof req.body?.bootstrapToken === 'string' && req.body.bootstrapToken.trim()) {
    return req.body.bootstrapToken.trim();
  }
  if (typeof req.query?.bootstrapToken === 'string' && req.query.bootstrapToken.trim()) {
    return req.query.bootstrapToken.trim();
  }
  return '';
}

export function canIssueBootstrapSession(req: Request): boolean {
  if (isLocalDevLoopbackRequest(req)) return true;
  const expectedToken = String(process.env.AUTH_BOOTSTRAP_TOKEN || '').trim();
  const providedToken = readBootstrapToken(req);
  if (!expectedToken || !providedToken) return false;
  return safeTokenEquals(expectedToken, providedToken);
}

export function getAllowedCorsOrigins(): string[] {
  const configured = String(process.env.CORS_ALLOWED_ORIGINS || '')
    .split(/[;,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (configured.length > 0) {
    return Array.from(new Set(configured));
  }
  return DEFAULT_LOCAL_ORIGINS;
}
