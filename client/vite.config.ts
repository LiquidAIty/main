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
        // @react-three/* is intentionally excluded below; include its nested
        // CJS reconciler constants so Vite pre-bundles named exports like
        // ConcurrentRoot instead of serving raw CJS in the browser.
        'react-reconciler',
        'react-reconciler/constants',
      ],
      // @react-three/fiber@8 imports default from zustand in one ESM chunk;
      // keep interop so Vite prebundle exposes a default export.
      needsInterop: ['zustand'],
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
        {
          find: /^@react-three\/fiber$/,
          replacement: path.resolve(
            __dirname,
            'node_modules/@react-three/fiber/dist/react-three-fiber.esm.js',
          ),
        },
        {
          find: /^@react-three\/drei$/,
          replacement: path.resolve(__dirname, 'node_modules/@react-three/drei/index.js'),
        },
        {
          find: /^@react-three\/postprocessing$/,
          replacement: path.resolve(
            __dirname,
            'node_modules/@react-three/postprocessing/dist/index.js',
          ),
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
