// vitest/config re-exports Vite's defineConfig with the `test` key typed.
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    // The one Vitest workspace definition (replaces the deprecated
    // vitest.workspace.ts). Three projects, nothing else is ever collected:
    //   client  — inline below; owns ONLY client/src specs. Vendored repos
    //             (localcoder, worldsignal, src/vendor),
    //             e2e/playwright (a Playwright runner), and stale Claude
    //             worktrees under .claude are full repo copies / foreign
    //             runners that used to produce hundreds of phantom failures.
    //   backend — apps/backend/vitest.config.ts
    //   scripts — scripts/vitest.config.ts
    projects: [
      {
        // Inherit this root config (react plugin + resolve.alias below).
        extends: true,
        test: {
          name: "client",
          include: ["client/src/**/*.{spec,test}.{ts,tsx}"],
          exclude: [
            "**/node_modules/**",
            "**/dist/**",
            "client/src/vendor/**",
          ],
        },
      },
      "apps/*/vitest.config.{mjs,js,ts,mts}",
      "scripts/vitest.config.{mjs,js,ts,mts}",
    ],
  },
  resolve: {
    alias: {
      // npm hoists these packages to the root node_modules (the old
      // client/node_modules copies no longer exist), so every alias must point
      // at the hoisted copy — a stale client path fails vitest collection for
      // any spec that transitively imports the package.
      // Verified against disk 2026-07-08; the dead "allotment" alias (no copy
      // anywhere, no importer) was removed.
      "react-router-dom": path.resolve(process.cwd(), "node_modules/react-router-dom"),
      "d3": path.resolve(process.cwd(), "node_modules/d3"),
    },
  },
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    hmr: {
      host: "localhost",
      port: 5173,
    },
    proxy: {
      "/api": {
        target: "http://127.0.0.1:4000",
        changeOrigin: true,
      },
    },
  },
});
