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

type CommandResult = { code: number; output: string };

function runCommand(command: string, args: string[]): Promise<CommandResult> {
  return new Promise((resolve) => {
    let output = '';
    const child = spawn(command, args, { windowsHide: false });
    child.stdout?.on('data', (data) => (output += String(data)));
    child.stderr?.on('data', (data) => (output += String(data)));
    child.on('error', (error) => resolve({ code: -1, output: error.message }));
    child.on('close', (code) => resolve({ code: code ?? -1, output: output.trim() }));
  });
}

async function dockerIsReady(): Promise<boolean> {
  return (await runCommand('docker', ['info', '--format', '{{.ServerVersion}}'])).code === 0;
}

async function ensureGraphDatabases(): Promise<void> {
  if (!(await dockerIsReady())) {
    throw new Error(
      'Docker is not running. Start Docker Desktop visibly, then rerun npm run dev:fresh.',
    );
  }

  const neo4j = await runCommand('docker', [
    'compose', '-p', 'main', '--env-file', 'apps/backend/.env',
    'up', '-d', '--wait', '--wait-timeout', '180', 'neo4j',
  ]);
  if (neo4j.code !== 0) {
    throw new Error(`repository Neo4j did not become Bolt-ready: ${neo4j.output}`);
  }

  // sim-pg predates this compose project and owns persistent AGE data. Start
  // that exact container without silently replacing its data volume.
  const age = await runCommand('docker', ['start', 'sim-pg']);
  if (age.code !== 0) {
    throw new Error(`failed to start existing PostgreSQL/AGE container: ${age.output}`);
  }
  console.log('[fresh] PostgreSQL/AGE and Neo4j are running');
}

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

  // 3) Bring up the two existing graph database containers. They are persistent
  // stores, not children of the app supervisor, so a reboot must start them
  // before the application stack.
  await ensureGraphDatabases();

  // 4) Let owned processes exit, then start one clean stack (dev:grpc is guarded, so exactly
  // one gRPC server comes up).
  if (owned.length > 0) await new Promise((r) => setTimeout(r, 1500));
  console.log('[fresh] starting one clean stack: npm run dev:all');
  // On Windows, invoke the npm batch shim through cmd explicitly. This keeps
  // output in the current terminal and avoids Node's deprecated args+shell path.
  const command = process.platform === 'win32'
    ? (process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe')
    : 'npm';
  const args = process.platform === 'win32'
    ? ['/d', '/s', '/c', 'npm run dev:all']
    : ['run', 'dev:all'];
  const child = spawn(command, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: false,
  });
  child.on('exit', (code) => process.exit(code ?? 0));
}

main().catch((err) => {
  console.error('[fresh] failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
