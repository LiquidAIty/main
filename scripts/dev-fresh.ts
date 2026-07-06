/**
 * `dev:fresh` — deliberately reset the LiquidAIty dev stack, then start ONE clean
 * copy. It stops ONLY processes whose command line carries a grounded LiquidAIty
 * dev signature (isLiquidAItyOwnedDevProcess); it never blindly kills bun/node/
 * python/vite/postgres/docker or an unknown port owner.
 *
 * If port 50051 is held by an UNKNOWN (unverified) listener, it refuses to reset
 * and fails honestly rather than killing something it does not own.
 */

import { spawn } from 'node:child_process';
import {
  GRPC_PORT,
  decideGrpcAction,
  enumerateProcesses,
  inspectPort,
  isLiquidAItyOwnedDevProcess,
  stopProcessTree,
} from './devStack';

async function main(): Promise<void> {
  const repoRoot = process.cwd();

  // 1) Never touch an unknown 50051 owner.
  const decision = decideGrpcAction(await inspectPort(GRPC_PORT));
  if (decision.action === 'conflict') {
    console.error(`[fresh] port ${GRPC_PORT} is held by unknown pid=${decision.pid}: ${decision.commandLine}`);
    console.error('[fresh] refusing to reset — stop that process yourself first.');
    process.exit(1);
  }

  // 2) Stop ONLY verified LiquidAIty-owned dev processes (never self).
  const self = process.pid;
  const owned = (await enumerateProcesses())
    .map((p) => ({ p, verdict: isLiquidAItyOwnedDevProcess(p, repoRoot) }))
    .filter((x) => x.verdict.owned && x.p.pid !== self);
  if (owned.length === 0) {
    console.log('[fresh] no verified LiquidAIty dev processes running');
  }
  for (const { p, verdict } of owned) {
    const role = verdict.owned ? verdict.role : 'unknown';
    console.log(`[fresh] stopping ${role} pid=${p.pid}`);
    stopProcessTree(p.pid);
  }

  // 3) Let them exit, then start one clean stack (dev:grpc is guarded, so exactly
  // one gRPC server comes up).
  if (owned.length > 0) await new Promise((r) => setTimeout(r, 1500));
  console.log('[fresh] starting one clean stack: npm run dev:all');
  const child = spawn('npm', ['run', 'dev:all'], {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  child.on('exit', (code) => process.exit(code ?? 0));
}

main().catch((err) => {
  console.error('[fresh] failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
