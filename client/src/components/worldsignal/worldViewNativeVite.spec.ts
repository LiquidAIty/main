// @vitest-environment node

/**
 * Graph + less = more: less code that does the same work as more code is more useful.
 * Entity names the feature; Relationship explains why this file belongs and what it contributes.
 * Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
 * Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
 * Entity: WorldView
 * Relationship: WorldView verifies that development uses the supervised module URL while production uses the bundled module graph without a localhost dependency.
 */

import { describe, expect, it } from 'vitest';

import { worldviewNativeMountModuleSource } from '../../../vite.config';

describe('WorldView Vite module doorway', () => {
  it('uses only the public supervised module URL in development', () => {
    const source = worldviewNativeMountModuleSource('serve');
    expect(source).toContain('http://127.0.0.1:4174/src/app/mount.js');
    expect(source).not.toContain('/@fs/');
    expect(source).not.toMatch(/[A-Z]:\//);
  });

  it('uses the bundled module graph in production without a localhost dependency', () => {
    const source = worldviewNativeMountModuleSource('build');
    expect(source).toContain('virtual:worldview-native-mount-bundled');
    expect(source).not.toContain('127.0.0.1');
    expect(source).not.toContain('/@fs/');
  });
});
