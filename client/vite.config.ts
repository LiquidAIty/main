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
      include: ['react', 'react-dom'],
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
      alias: {
        react: path.resolve(__dirname, 'node_modules/react'),
        'react/jsx-runtime': path.resolve(__dirname, 'node_modules/react/jsx-runtime.js'),
        'react/jsx-dev-runtime': path.resolve(__dirname, 'node_modules/react/jsx-dev-runtime.js'),
        'react-dom': path.resolve(__dirname, 'node_modules/react-dom'),
        'react-dom/client': path.resolve(__dirname, 'node_modules/react-dom/client.js'),
        'react-reconciler': path.resolve(__dirname, 'node_modules/react-reconciler'),
        '@react-three/fiber': path.resolve(
          __dirname,
          'node_modules/@react-three/fiber/dist/react-three-fiber.esm.js',
        ),
        '@react-three/drei': path.resolve(__dirname, 'node_modules/@react-three/drei/index.js'),
        '@react-three/postprocessing': path.resolve(
          __dirname,
          'node_modules/@react-three/postprocessing/dist/index.js',
        ),
      },
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
