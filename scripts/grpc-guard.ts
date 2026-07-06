/**
 * gRPC startup guard — replaces the blind `bun run scripts/start-grpc.ts` in the
 * dev stack. It makes gRPC startup IDEMPOTENT: reuse a valid running OpenClaude
 * Bun gRPC on 50051, start one only when the port is free, and fail honestly on
 * an unknown listener (never start a competing server, never kill anything).
 *
 * This is why running `npm run dev` a second time no longer produces the red
 * "No address added out of total 2 resolved" bind error.
 *
 * `--check` prints the decision and exits WITHOUT starting anything (used by the
 * controlled dev-stack proof so it never spawns a second server).
 */

import { spawn } from 'node:child_process';
import { GRPC_PORT, decideGrpcAction, inspectPort } from './devStack';

async function main(): Promise<void> {
  const checkOnly = process.argv.includes('--check');
  const listener = await inspectPort(GRPC_PORT);
  const decision = decideGrpcAction(listener);

  if (decision.action === 'reuse') {
    console.log(`[dev] OpenClaude gRPC: reused pid=${decision.pid} port=${GRPC_PORT}`);
    return;
  }
  if (decision.action === 'conflict') {
    console.error(
      `[dev] OpenClaude gRPC: port ${GRPC_PORT} is held by pid=${decision.pid} which is NOT verified as ` +
      `LiquidAIty-owned:\n        ${decision.commandLine}`,
    );
    console.error(
      `[dev] refusing to start a competing gRPC server. Stop that process, or run "npm run dev:fresh".`,
    );
    process.exit(1);
  }

  // action === 'start'
  if (checkOnly) {
    console.log(`[dev] OpenClaude gRPC: would start on port ${GRPC_PORT} (no listener present)`);
    return;
  }
  console.log(`[dev] OpenClaude gRPC: starting on port ${GRPC_PORT}...`);
  const child = spawn('bun', ['run', 'scripts/start-grpc.ts'], {
    cwd: 'localcoder',
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  child.on('error', (err) => {
    console.error(`[dev] OpenClaude gRPC: failed to spawn bun — ${err.message}`);
    process.exit(1);
  });
  child.on('exit', (code) => process.exit(code ?? 0));
}

main().catch((err) => {
  console.error('[dev] grpc-guard failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
