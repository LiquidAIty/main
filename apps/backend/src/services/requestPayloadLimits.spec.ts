// Graph + less = more: less code that does the same work as more code is more useful.
// Entity names the feature; Relationship explains why this file belongs and what it contributes.
// Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
// Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
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
