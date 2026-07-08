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
