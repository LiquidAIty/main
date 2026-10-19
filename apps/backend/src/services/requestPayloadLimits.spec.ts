// Entity: Application Startup
// Relationship: This file verifies development and production mount the same bounded JSON envelope and ignore retired request-size overrides.

import { afterEach, describe, expect, it, vi } from 'vitest';

import { requestJsonBodyLimit } from './requestPayloadLimits';

afterEach(() => vi.unstubAllEnvs());

describe('request payload limits', () => {
  it('keeps one fixed web boundary across environments and ignores legacy overrides', () => {
    for (const environment of ['development', 'production']) {
      vi.stubEnv('NODE_ENV', environment);
      vi.stubEnv('DEVELOPMENT_JSON_BODY_LIMIT', '1gb');
      expect(requestJsonBodyLimit()).toBe('20mb');
    }
  });
});
