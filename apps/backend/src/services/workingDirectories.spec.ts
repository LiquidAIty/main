/**
 * Entity: Working Directories
 * Relationship: Working Directories verifies portable checkout discovery and explicit packaged-runtime root injection without binding the application to one machine path.
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
