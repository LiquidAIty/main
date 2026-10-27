/**
 * Graph + less = more: less code that does the same work as more code is more useful.
 * Entity names the feature; Relationship explains why this file belongs and what it contributes.
 * Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
 * Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
 * Entity: Application Startup
 * Relationship: This file verifies that startup discovers the repository from portable markers or an explicit packaged-runtime root without binding the application to one machine path.
 */

import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { resolveRepoRoot } from './workingDirectories';

describe('repository root', () => {
  it('discovers this checkout from repository markers without a machine path', () => {
    const previous = process.env.LIQUIDAITY_REPO_ROOT;
    try {
      delete process.env.LIQUIDAITY_REPO_ROOT;
      expect(path.resolve(resolveRepoRoot())).toBe(path.resolve(process.cwd()));
    } finally {
      if (previous === undefined) delete process.env.LIQUIDAITY_REPO_ROOT;
      else process.env.LIQUIDAITY_REPO_ROOT = previous;
    }
  });

  it('honors the injected repository root used by packaged runtimes', () => {
    const previous = process.env.LIQUIDAITY_REPO_ROOT;
    try {
      process.env.LIQUIDAITY_REPO_ROOT = path.join(process.cwd(), 'injected-root');
      expect(resolveRepoRoot()).toBe(path.resolve(process.cwd(), 'injected-root'));
    } finally {
      if (previous === undefined) delete process.env.LIQUIDAITY_REPO_ROOT;
      else process.env.LIQUIDAITY_REPO_ROOT = previous;
    }
  });
});
