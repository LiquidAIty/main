import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { describe, expect, it, vi } from 'vitest';

// Capture the repoPath the edit-scope gate is called with. The gate is invoked
// as this.cbmScopeGate(packet.repoPath), so it observes exactly the root the
// route resolved. It returns a blocked structural result so the real coder
// process is never launched — we only assert which root reached it.
const captured = vi.hoisted(() => ({ repoPaths: [] as string[] }));

vi.mock('../services/graphContext/cbmScopeGate', () => ({
  runLocalCoderCbmScopeGate: vi.fn(async (repoPath: string) => {
    captured.repoPaths.push(repoPath);
    return {
      sourceRoot: repoPath,
      scopeStatus: 'blocked' as const,
      editAllowed: false,
      blockedReason: 'test_capture_only',
    };
  }),
}));

async function createServer(): Promise<{ server: Server; baseUrl: string }> {
  const express = (await import('express')).default;
  const router = (await import('./coder.routes')).default;
  const app = express();
  app.use(express.json());
  app.use('/api/coder', router);
  const server = await new Promise<Server>((resolve) => {
    const next = app.listen(0, '127.0.0.1', () => resolve(next));
  });
  const address = server.address() as AddressInfo;
  return { server, baseUrl: `http://127.0.0.1:${address.port}/api/coder` };
}

describe('POST /localcoder/run — trusted root injection', () => {
  it('ignores a caller-supplied repoPath and uses the server-trusted root', async () => {
    captured.repoPaths.length = 0;
    const { server, baseUrl } = await createServer();
    try {
      const evilRoot = 'C:/attacker/anywhere';
      await fetch(`${baseUrl}/localcoder/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          coderPacket: {
            id: 'caller-id',
            projectId: 'p',
            repoPath: evilRoot,
            objective: 'o',
            planExcerpt: 'p',
            contextSummary: 'c',
            codeAnchors: [],
            cbmQueries: [],
            guardrails: [],
            allowedFiles: [],
            forbiddenWork: [],
            proofRequired: [],
            reportFormat: 'r',
            stopConditions: [],
          },
        }),
      });
      const trustedRoot = process.env.LIQUIDAITY_GRPC_CWD || 'C:/Projects/main';
      expect(captured.repoPaths).toContain(trustedRoot);
      expect(captured.repoPaths).not.toContain(evilRoot);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
    // Real-service integration (runtime discovery probes the filesystem):
    // ~1.5s idle but past vitest's 5s default under full-suite load.
  }, 20_000);
});
