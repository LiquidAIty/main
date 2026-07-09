import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: '.',
  test: {
    environment: 'node',
    // Paths resolve against this config's directory (scripts/), so the old
    // 'scripts/**/*.spec.ts' matched nothing and these specs silently never ran.
    include: ['**/*.spec.ts'],
    globals: false,
  },
});
