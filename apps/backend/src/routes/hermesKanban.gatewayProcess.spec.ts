import { describe, expect, it } from 'vitest';
import { spawnRunScopedHermesGateway } from './hermesKanban.routes';

describe('run-scoped Hermes gateway process boundary', () => {
  it('returns after spawn while the detached process remains alive', async () => {
    const startedAt = Date.now();
    const pid = await spawnRunScopedHermesGateway({}, {
      bin: process.execPath,
      args: ['-e', 'setTimeout(() => process.exit(0), 5000)'],
      cwd: process.cwd(),
      inheritedEnv: process.env,
    });

    try {
      expect(Date.now() - startedAt).toBeLessThan(2_000);
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(() => process.kill(pid, 0)).not.toThrow();
    } finally {
      try {
        process.kill(pid);
      } catch {
        // The bounded test process may have exited between the liveness check
        // and cleanup; either outcome leaves no background process behind.
      }
    }
  }, 10_000);
});
