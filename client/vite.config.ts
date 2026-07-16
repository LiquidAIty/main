import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(() => {
  return {
    root: __dirname,
    envDir: path.resolve(__dirname, '..'),
    plugins: [react()],
    optimizeDeps: {
      include: [
        'react',
        'react-dom',
        'scheduler',
        // zustand's ESM traditional entry imports the selector shim as a default
        // export. This package is CommonJS, so it must be optimized before the
        // Agent Builder module graph evaluates; otherwise the graph workspace
        // fails before any of its authority-specific surfaces can mount.
        // Zustand imports the package's explicit `.js` export path. Vite keys
        // optimized dependencies by the exact specifier, so keep the extension
        // here as well; the extensionless entry leaves that live import raw.
        'use-sync-external-store/shim/with-selector.js',
        // @react-three/* is a raw-ESM exclude (below); its CJS leaf deps must still be
        // pre-bundled, or the raw drei/fiber default imports fail in dev and the
        // ThinkGraph/KnowGraph/CodeGraph scene blanks. Each is a standalone CJS leaf
        // (no three-stdlib in its graph), so this does NOT re-trigger the sourcemap crash.
        'react-reconciler',
        'react-reconciler/constants',
        'stats.js',
        // @react-three/drei -> react-composer (raw ESM) does `import PropTypes from
        // 'prop-types'`. prop-types is CJS with no named `default`, so without
        // pre-bundling Vite serves it raw and the scene's dynamic import dies with
        // "prop-types/index.js does not provide an export named 'default'", blanking
        // every graph tab. Pre-bundling it adds the esbuild CJS->ESM default interop.
        'prop-types',
        // @react-three/postprocessing (raw ESM) pulls `buffer` and does a NAMED
        // `import { Buffer } from 'buffer'`. The CJS `buffer` polyfill exposes no ESM
        // named `Buffer` unless pre-bundled, so the scene died with
        // "buffer/index.js does not provide an export named 'Buffer'" right after the
        // prop-types leaf. Same CJS-leaf fix.
        'buffer',
        // Cytoscape + fCoSE are CJS graph-renderer deps. Without pre-inclusion,
        // Vite can discover them mid-session, re-optimize, and kill lazy graph
        // chunks with "Failed to fetch dynamically imported module".
        'cytoscape',
        'cytoscape-fcose',
      ],
      // Work around corrupted nested sourcemaps in three-stdlib pulled by
      // @react-three/* during esbuild pre-bundling on dev startup.
      exclude: [
        '@react-three/fiber',
        '@react-three/drei',
        '@react-three/postprocessing',
      ],
    },
    resolve: {
      dedupe: [
        'react',
        'react-dom',
        'react-reconciler',
        '@react-three/fiber',
        '@react-three/drei',
        '@react-three/postprocessing',
      ],
      alias: [
        // drei@9.110 pins troika-three-text@^0.49.0, whose <Text> defines
        // customDepthMaterial/customDistanceMaterial as getter-ONLY. three@0.183's
        // Object3D constructor assigns `this.customDepthMaterial = undefined`, so
        // `new Text()` throws "Cannot set property customDepthMaterial of #<Text>
        // which has only a getter" and every graph tab shows "Graph scene
        // unavailable". troika 0.52.4 makes those settable. npm keeps re-nesting
        // 0.49.1 under drei (its range can't take 0.52.x and overrides are ignored),
        // so we pin resolution here to the hoisted 0.52.4 (root direct dep). This is
        // install-proof: Vite uses this regardless of node_modules nesting.
        {
          find: 'troika-three-text',
          replacement: path.resolve(__dirname, '../node_modules/troika-three-text'),
        },
        // npm hoisted react/react-dom to the ROOT node_modules (the old
        // client/node_modules copies no longer exist) — same install-proof
        // pinning as troika above, pointed at the hoisted copies. A stale
        // client-local path here crashes dev startup with
        // ENOENT jsx-dev-runtime.js.
        {
          find: 'react/jsx-runtime',
          replacement: path.resolve(__dirname, '../node_modules/react/jsx-runtime.js'),
        },
        {
          find: 'react/jsx-dev-runtime',
          replacement: path.resolve(__dirname, '../node_modules/react/jsx-dev-runtime.js'),
        },
        {
          find: 'react-dom/client',
          replacement: path.resolve(__dirname, '../node_modules/react-dom/client.js'),
        },
      ],
    },
    server: {
      host: '::',
      port: 5173,
      strictPort: false,
      proxy: {
        // Codebase-memory UI endpoints (dev): forward to local CBM UI server
        '/rpc': {
          target: 'http://127.0.0.1:9749',
          changeOrigin: true,
          secure: false,
        },
        '/api/layout': {
          target: 'http://127.0.0.1:9749',
          changeOrigin: true,
          secure: false,
        },
        // Read-only Alpaca paper market data from the Python rails (port 8003),
        // consumed by the /tradingui surface. Same direct-to-service pattern as /rpc.
        '/market': {
          target: 'http://127.0.0.1:8003',
          changeOrigin: true,
          secure: false,
        },
        // WorldSignals (vendored app, own FastAPI backend on :8000). Its client
        // calls `${API_BASE}/api/...`; the embed mount sets API_BASE to this
        // prefix, so its traffic lands here instead of on LiquidAIty's own /api
        // below. Proxying keeps it same-origin — no CORS grant on the vendor
        // backend, and no second origin in the page.
        // Must precede '/api' — Vite matches proxy keys in insertion order.
        '/worldsignals-api': {
          target: 'http://127.0.0.1:8000',
          changeOrigin: true,
          secure: false,
          rewrite: (p) => p.replace(/^\/worldsignals-api/, ''),
        },
        // App backend API
        '/api': {
          target: 'http://127.0.0.1:4000',
          changeOrigin: true,
          secure: false,
        },
      },
    },
  };
});
