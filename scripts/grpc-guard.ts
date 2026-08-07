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
import { setTimeout as delay } from 'node:timers/promises';
import {
  GRPC_PORT,
  buildProductChatGrpcEnvironment,
  decideGrpcAction,
  inspectPort,
} from './devStack';

const CORE_HEALTH = [
  ['backend', 'http://127.0.0.1:4000/api/health'],
  ['Graphiti ingestion API', 'http://127.0.0.1:8001/health'],
  ['Python rails', 'http://127.0.0.1:8003/health'],
] as const;

async function waitForHealth(label: string, url: string): Promise<void> {
  for (let attempt = 1; attempt <= 90; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) return;
    } catch {
      // A dependency that is still compiling or binding is expected here.
    }
    await delay(1_000);
  }
  throw new Error(`${label} did not become healthy at ${url}`);
}

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
  console.log('[dev] OpenClaude gRPC: waiting for backend, Graphiti ingestion, and Python rails...');
  await Promise.all(CORE_HEALTH.map(([label, url]) => waitForHealth(label, url)));
  console.log('[dev] OpenClaude gRPC: core services healthy; initializing official Python MCP...');
  console.log(`[dev] OpenClaude gRPC: starting on port ${GRPC_PORT}...`);
  // shell:false — bun resolves on PATH directly; args are static literals.
  // Dropping shell:true clears DEP0190 without changing cwd/stdio/ownership.
  const child = spawn('bun', ['run', 'scripts/start-grpc.ts'], {
    cwd: 'localcoder',
    env: buildProductChatGrpcEnvironment(process.env),
    stdio: 'inherit',
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
