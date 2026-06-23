// Regression guard for the graph-scene blank-canvas bug.
//
// The ThinkGraph/KnowGraph/CodeGraph scene lazy-loads @react-three/{fiber,drei,
// postprocessing}, which are optimizeDeps.exclude (raw ESM) to dodge a three-stdlib
// sourcemap crash. Their CJS leaf deps must be force-included or Vite serves them
// raw and the browser dies on a CJS->ESM interop error, blanking every graph tab:
//   - react-composer (via drei) -> `import PropTypes from 'prop-types'`
//   - @react-three/postprocessing -> `import { Buffer } from 'buffer'`
// This test fails closed if any required CJS leaf drops out of optimizeDeps.include.
import { describe, it, expect } from 'vitest';
import viteConfig from '../vite.config';

describe('graph renderer optimizeDeps leaves', () => {
  it('pre-bundles every CJS leaf the @react-three scene chain needs', () => {
    const resolved = typeof viteConfig === 'function' ? (viteConfig as any)({ command: 'serve', mode: 'development' }) : viteConfig;
    const include: string[] = resolved?.optimizeDeps?.include ?? [];
    for (const leaf of ['react-reconciler', 'stats.js', 'prop-types', 'buffer']) {
      expect(include, `optimizeDeps.include must contain '${leaf}'`).toContain(leaf);
    }
  });

  it('keeps @react-three/* excluded (raw ESM) to avoid the sourcemap crash', () => {
    const resolved = typeof viteConfig === 'function' ? (viteConfig as any)({ command: 'serve', mode: 'development' }) : viteConfig;
    const exclude: string[] = resolved?.optimizeDeps?.exclude ?? [];
    expect(exclude).toEqual(
      expect.arrayContaining(['@react-three/fiber', '@react-three/drei', '@react-three/postprocessing']),
    );
  });
});
