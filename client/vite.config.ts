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
        // @react-three/* is a raw-ESM exclude (below); its CJS leaf deps must still be
        // pre-bundled, or the raw drei/fiber default imports fail in dev and the
        // ThinkGraph/KnowGraph/CodeGraph scene blanks. Each is a standalone CJS leaf
        // (no three-stdlib in its graph), so this does NOT re-trigger the sourcemap crash.
        'react-reconciler',
        'react-reconciler/constants',
        'stats.js',
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
        {
          find: '@data-formulator',
          replacement: path.resolve(__dirname, '../data-formulator-main/src'),
        },
        {
          find: 'react/jsx-runtime',
          replacement: path.resolve(__dirname, 'node_modules/react/jsx-runtime.js'),
        },
        {
          find: 'react/jsx-dev-runtime',
          replacement: path.resolve(__dirname, 'node_modules/react/jsx-dev-runtime.js'),
        },
        {
          find: 'react-dom/client',
          replacement: path.resolve(__dirname, 'node_modules/react-dom/client.js'),
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
