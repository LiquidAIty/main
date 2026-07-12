/**
 * Uvicorn startup guard — replaces blind `uvicorn ...` starts in the dev stack
 * for BOTH project Python services (KnowGraph on 8001, AutoGen rails on 8003).
 * It makes startup IDEMPOTENT, exactly like the gRPC guard: reuse a HEALTHY
 * running instance, stop-and-replace an unhealthy one, start one only when the
 * port is free, and fail honestly on an unknown listener (never launch a
 * competing server that would 10048, never kill a foreign process).
 *
 * The venv python resolves through a uv shim whose command line carries no repo
 * root, so dev-fresh's cmdline ownership check cannot ground these services —
 * port-scoped inspection (devStack.isLiquidAItyUvicornListener) is the safe
 * identity signal, exactly as 50051 is for gRPC.
 *
 * Usage: tsx scripts/uvicorn-guard.ts <knowgraph|autogen> [--check]
 * `--check` prints the decision and exits WITHOUT starting or stopping anything
 * beyond a read-only /health GET.
 */

import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import {
  AUTOGEN_PORT,
  KNOWGRAPH_PORT,
  decideUvicornAction,
  inspectPort,
  stopProcessTree,
} from './devStack';

const SERVICES = {
  knowgraph: {
    port: KNOWGRAPH_PORT,
    appModule: 'app:app',
    cwd: 'services/knowgraph',
    label: 'KnowGraph',
  },
  autogen: {
    port: AUTOGEN_PORT,
    appModule: 'app.main:app',
    cwd: 'apps/python-models',
    label: 'AutoGen',
  },
} as const;

type ServiceName = keyof typeof SERVICES;

async function isHealthy(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

function startService(svc: (typeof SERVICES)[ServiceName]): void {
  console.log(`[dev] ${svc.label}: starting on port ${svc.port}...`);
  const child = spawn(
    '.venv\\Scripts\\python.exe',
    ['-X', 'utf8', '-m', 'uvicorn', svc.appModule, '--host', '127.0.0.1', '--port', String(svc.port)],
    { cwd: svc.cwd, stdio: 'inherit', shell: process.platform === 'win32' },
  );
  child.on('error', (err) => {
    console.error(`[dev] ${svc.label}: failed to spawn uvicorn — ${err.message}`);
    process.exit(1);
  });
  child.on('exit', (code) => process.exit(code ?? 0));
}

async function main(): Promise<void> {
  const serviceName = process.argv[2] as ServiceName;
  const svc = SERVICES[serviceName];
  if (!svc) {
    console.error(`[dev] uvicorn-guard: unknown service "${serviceName}" (known: ${Object.keys(SERVICES).join(', ')})`);
    process.exit(1);
  }
  const checkOnly = process.argv.includes('--check');
  const listener = await inspectPort(svc.port);
  const decision = decideUvicornAction(listener, svc.appModule, svc.port);

  if (decision.action === 'reuse') {
    // Only reuse a HEALTHY instance; a hung/half-dead one is stopped and replaced.
    // The /health GET is read-only, so it is safe even under --check.
    if (await isHealthy(svc.port)) {
      console.log(`[dev] ${svc.label}: reused healthy pid=${decision.pid} port=${svc.port}`);
      return;
    }
    if (checkOnly) {
      console.log(
        `[dev] ${svc.label}: pid=${decision.pid} on ${svc.port} is not answering /health — would stop and replace`,
      );
      return;
    }
    console.log(
      `[dev] ${svc.label}: pid=${decision.pid} on ${svc.port} is not answering /health — stopping and replacing`,
    );
    stopProcessTree(decision.pid);
    await delay(1500);
  } else if (decision.action === 'conflict') {
    console.error(
      `[dev] ${svc.label}: port ${svc.port} is held by pid=${decision.pid} which is NOT verified as ` +
        `LiquidAIty-owned:\n        ${decision.commandLine}`,
    );
    console.error(
      `[dev] refusing to start a competing ${svc.label} server. Stop that process, or run "npm run dev:fresh".`,
    );
    process.exit(1);
  }

  if (checkOnly) {
    console.log(`[dev] ${svc.label}: would start on port ${svc.port}`);
    return;
  }
  startService(svc);
}

main().catch((err) => {
  console.error('[dev] uvicorn-guard failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
