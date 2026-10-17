/**
 * Entity: Application Runtime
 * Relationship: Proves development and production use the same bounded JSON envelope required by the canonical four-image Main input contract.
 */

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
