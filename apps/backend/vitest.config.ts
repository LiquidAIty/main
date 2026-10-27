/**
 * Graph + less = more: less code that does the same work as more code is more useful.
 * Entity names the feature; Relationship explains why this file belongs and what it contributes.
 * Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
 * Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: '.',
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    globals: false,
    // Backend specs are integration-style by design: real express servers,
    // the real service layer, and filesystem runtime discovery. They finish
    // in 1–3s idle but drift past vitest's 5s default under full-suite load.
    testTimeout: 20_000,
  },
});
