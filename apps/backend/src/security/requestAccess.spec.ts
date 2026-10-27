/**
 * Graph + less = more: less code that does the same work as more code is more useful.
 * Entity names the feature; Relationship explains why this file belongs and what it contributes.
 * Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
 * Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
 * Entity: Authentication
 * Relationship: This file verifies development bootstrap trusts only real loopback sockets with matching headers, exposes only loopback CORS origins, and never activates in production.
 * Entity: Credentials
 * Relationship: This file protects the bootstrap-token boundary by proving remote requests cannot manufacture local authority through caller-controlled headers.
 */

import type { Request } from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { getAllowedCorsOrigins, isLocalDevLoopbackRequest } from './requestAccess';

const originalNodeEnv = process.env.NODE_ENV;
const originalCorsOrigins = process.env.CORS_ALLOWED_ORIGINS;

function request(input: {
  remoteAddress: string;
  host?: string;
  origin?: string;
  forwardedFor?: string;
}): Request {
  return {
    headers: {
      ...(input.host ? { host: input.host } : {}),
      ...(input.origin ? { origin: input.origin } : {}),
      ...(input.forwardedFor ? { 'x-forwarded-for': input.forwardedFor } : {}),
    },
    hostname: input.host || '',
    socket: { remoteAddress: input.remoteAddress },
  } as unknown as Request;
}

afterEach(() => {
  if (originalNodeEnv === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = originalNodeEnv;
  }
  if (originalCorsOrigins === undefined) {
    delete process.env.CORS_ALLOWED_ORIGINS;
  } else {
    process.env.CORS_ALLOWED_ORIGINS = originalCorsOrigins;
  }
});

describe('local development request authority', () => {
  it('allows both dev and production-preview loopback browser origins', () => {
    delete process.env.CORS_ALLOWED_ORIGINS;
    const origins = getAllowedCorsOrigins();
    expect(origins).toContain('http://127.0.0.1:5173');
    expect(origins).toContain('http://127.0.0.1:4173');
    expect(origins.every(origin => new URL(origin).hostname === '127.0.0.1'
      || new URL(origin).hostname === 'localhost')).toBe(true);
  });

  it('rejects caller-controlled loopback headers from a remote socket', () => {
    process.env.NODE_ENV = 'development';

    expect(isLocalDevLoopbackRequest(request({
      remoteAddress: '10.0.0.25',
      host: 'localhost:4000',
      origin: 'http://127.0.0.1:5173',
      forwardedFor: '127.0.0.1',
    }))).toBe(false);
  });

  it('requires supplied Host and Origin headers to agree with the loopback socket', () => {
    process.env.NODE_ENV = 'development';

    expect(isLocalDevLoopbackRequest(request({
      remoteAddress: '127.0.0.1',
      host: 'example.test',
    }))).toBe(false);
    expect(isLocalDevLoopbackRequest(request({
      remoteAddress: '::1',
      host: '[::1]:4000',
      origin: 'https://example.test',
    }))).toBe(false);
  });

  it('accepts IPv4, mapped IPv4, and IPv6 loopback requests in development', () => {
    process.env.NODE_ENV = 'development';

    expect(isLocalDevLoopbackRequest(request({
      remoteAddress: '127.0.0.1',
      host: 'localhost:4000',
      origin: 'http://localhost:5173',
    }))).toBe(true);
    expect(isLocalDevLoopbackRequest(request({
      remoteAddress: '::ffff:127.0.0.1',
      host: '127.0.0.1:4000',
    }))).toBe(true);
    expect(isLocalDevLoopbackRequest(request({
      remoteAddress: '::1',
      host: '[::1]:4000',
    }))).toBe(true);
  });

  it('never grants local-development authority in production', () => {
    process.env.NODE_ENV = 'production';

    expect(isLocalDevLoopbackRequest(request({
      remoteAddress: '127.0.0.1',
      host: 'localhost:4000',
    }))).toBe(false);
  });
});
