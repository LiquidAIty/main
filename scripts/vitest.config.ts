import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: '.',
  test: {
    environment: 'node',
    include: ['scripts/**/*.spec.ts'],
    globals: false,
  },
});
