// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { worldviewRuntimeMountModuleSource } from '../../../vite.config';

describe('WorldView Vite module doorway', () => {
  it('uses only the public supervised module URL in development', () => {
    const source = worldviewRuntimeMountModuleSource('serve');
    expect(source).toContain('http://127.0.0.1:4174/src/app/mount.js');
    expect(source).not.toContain('/@fs/');
    expect(source).not.toMatch(/[A-Z]:\//);
  });

  it('uses the bundled module graph in production without a localhost dependency', () => {
    const source = worldviewRuntimeMountModuleSource('build');
    expect(source).toContain('virtual:worldview-runtime-mount-bundled');
    expect(source).not.toContain('127.0.0.1');
    expect(source).not.toContain('/@fs/');
  });
});
