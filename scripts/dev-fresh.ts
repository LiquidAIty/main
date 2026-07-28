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
import { existsSync } from 'node:fs';
import { join } from 'node:path';
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
    const child = spawn(command, args, { windowsHide: true });
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
    if (process.platform !== 'win32') {
      throw new Error('Docker is not running; start the Docker engine and retry.');
    }
    const dockerDesktop = join(
      process.env.ProgramFiles || 'C:\\Program Files',
      'Docker',
      'Docker',
      'Docker Desktop.exe',
    );
    if (!existsSync(dockerDesktop)) {
      throw new Error(`Docker Desktop was not found at ${dockerDesktop}`);
    }
    console.log('[fresh] starting Docker Desktop');
    const docker = spawn(dockerDesktop, [], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    docker.unref();
    for (let attempt = 0; attempt < 20 && !(await dockerIsReady()); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2500));
    }
    if (!(await dockerIsReady())) {
      throw new Error('Docker Desktop did not become ready within 50 seconds.');
    }
  }

  const started = await runCommand('docker', ['start', 'sim-pg', 'neo4j']);
  if (started.code !== 0) {
    throw new Error(`failed to start graph databases: ${started.output}`);
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
  // Windows requires shell:true for npm: npm is npm.cmd (a batch shim), and
  // Node 24+ refuses to spawn .cmd/.bat without shell (CVE-2024-27980 fix).
  // spawn('npm.cmd', [], {shell:false}) throws EINVAL. The DEP0190 warning
  // fires because args + shell:true concatenates unescaped, but these args are
  // static literals (no user input) so the security risk is theoretical.
  // Non-Windows uses shell:false. This is the minimum-honest form.
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
