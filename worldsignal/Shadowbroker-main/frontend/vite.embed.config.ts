import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));

// Builds the WorldSignals app as a self-contained ES module that a host page
// mounts directly (src/embed/mountWorldSignals.tsx). This is a second output of
// the same source tree — `next build` (docker-compose, standalone app) is
// untouched and remains the way the app runs on its own.
//
// The bundle carries its own React because the current host shell runs React 18
// while this app requires 19. Each side keeps its own root; see the mount entry.
//
// Output lands in the host's static dir so its dev server can serve the module
// without a second origin. Rebuild after changing app source:
//   npm run build:embed
export default defineConfig({
  root: dirname,
  // Relative base: the bundle is served under the host's /worldsignals/ prefix,
  // so emitted asset URLs (module worker chunks especially) must resolve against
  // import.meta.url, not the host origin root. Without this the dynamic map
  // layer workers 404 to the host SPA fallback and every worker-built layer
  // (aircraft, ships, SIGINT) stays silently empty when embedded.
  base: './',
  plugins: [react()],
  resolve: {
    alias: [
      // The app is written against Next's module aliases; the embed build has no
      // Next runtime, so route the two client-side ones it uses to local shims.
      { find: 'next/dynamic', replacement: path.resolve(dirname, 'src/embed/nextDynamicShim.tsx') },
      { find: 'next/image', replacement: path.resolve(dirname, 'src/embed/nextImageShim.tsx') },
      { find: '@', replacement: path.resolve(dirname, 'src') },
    ],
  },
  define: {
    // Next injects process.env at build time; nothing does here. The app reads
    // four optional NEXT_PUBLIC_* vars (agentShellWs, desktopBridge, meshDmClient,
    // MeshTerminal) — with no Next they must resolve to undefined, which is the
    // same "unset" branch the standalone app takes when they are not configured.
    // Without this, `process` is simply not defined in the browser and the module
    // throws on evaluation.
    'process.env.NODE_ENV': JSON.stringify('production'),
    'process.env': '({})',
  },
  build: {
    outDir: path.resolve(dirname, '../../../client/public/worldsignals'),
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
    lib: {
      entry: path.resolve(dirname, 'src/embed/mountWorldSignals.tsx'),
      formats: ['es'],
      fileName: () => 'embed.js',
    },
    rollupOptions: {
      output: { assetFileNames: 'embed.[ext]' },
      onwarn(warning, warn) {
        // 'use client' is a Next/RSC directive; meaningless (and noisy) here.
        if (warning.code === 'MODULE_LEVEL_DIRECTIVE') return;
        warn(warning);
      },
    },
  },
});
