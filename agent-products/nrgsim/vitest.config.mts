// Entity: Building Interface Verification
// Relationship: This confines component tests and their cache to NRGSIM without building or starting the host application.
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  cacheDir: '.data/vitest-cache',
  esbuild: { jsx: 'automatic' },
  resolve: { dedupe: ['react', 'react-dom'] },
  test: { include: ['tests/*.spec.tsx'], maxWorkers: 1, minWorkers: 1 },
});
