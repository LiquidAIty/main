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
import { createConnection } from 'node:net';
import {
  GRAPHITI_PORT,
  GRPC_PORT,
  PYTHON_RAILS_PORT,
  decideGrpcAction,
  enumerateProcesses,
  inspectPort,
  isLiquidAItyOwnedDevProcess,
  isLiquidAItyUvicornListener,
  stopProcessTree,
} from './devStack';

type CommandResult = { code: number; output: string };

function runCommand(
  command: string,
  args: string[],
  timeoutMs = 30_000,
): Promise<CommandResult> {
  return new Promise((resolve) => {
    let output = '';
    let settled = false;
    const child = spawn(command, args, { windowsHide: false });
    child.stdout?.on('data', (data) => (output += String(data)));
    child.stderr?.on('data', (data) => (output += String(data)));
    const finish = (result: CommandResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish({ code: -2, output: `${command} timed out after ${timeoutMs}ms` });
    }, timeoutMs);
    child.on('error', (error) => finish({ code: -1, output: error.message }));
    child.on('close', (code) => finish({ code: code ?? -1, output: output.trim() }));
  });
}

async function dockerIsReady(): Promise<boolean> {
  return (await runCommand('docker', ['info', '--format', '{{.ServerVersion}}'])).code === 0;
}

function tcpIsReady(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    const finish = (ready: boolean) => {
      socket.destroy();
      resolve(ready);
    };
    socket.setTimeout(1_000);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

async function waitForTcp(port: number, label: string): Promise<void> {
  for (let attempt = 1; attempt <= 60; attempt += 1) {
    if (await tcpIsReady(port)) return;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`${label} did not become reachable on host port ${port}`);
}

async function waitForPostgresAge(): Promise<void> {
  const readinessCommand = `pg_isready -q -U "$POSTGRES_USER" -d "$POSTGRES_DB" && test "$(psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "SELECT extname FROM pg_extension WHERE extname='age'")" = age`;
  const check = [
    'exec', 'sim-pg', 'sh', '-lc',
    readinessCommand,
  ];
  for (let attempt = 1; attempt <= 60; attempt += 1) {
    if ((await runCommand('docker', check)).code === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error('existing PostgreSQL/AGE container did not become query-ready');
}

async function waitForBackendPostgresAge(): Promise<void> {
  // Container-internal pg_isready plus a host TCP accept do not prove the
  // Windows-published port can complete the same PostgreSQL protocol path the
  // backend uses. Import the backend's one Prisma authority so this check uses
  // its exact env loader, DATABASE_URL, generated client, and target database.
  const { prisma } = await import('../apps/backend/src/services/database');
  try {
    const rows = await prisma.$queryRaw<Array<{ extname: string }>>`
      SELECT extname FROM pg_extension WHERE extname = 'age'
    `;
    if (!rows.some((row) => row.extname === 'age')) {
      throw new Error('AGE extension is not installed in the backend target database');
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`backend DATABASE_URL did not reach PostgreSQL/AGE: ${detail}`);
  } finally {
    await prisma.$disconnect();
  }
}

async function waitForNeo4jQuery(): Promise<void> {
  const query = [
    'exec', 'neo4j', 'sh', '-lc',
    'auth="${NEO4J_AUTH}"; exec /var/lib/neo4j/bin/cypher-shell --non-interactive -a bolt://127.0.0.1:7687 -u "${auth%%/*}" -p "${auth#*/}" "RETURN 1 AS ok" --format plain',
  ];
  let lastOutput = '';
  // Docker's published Bolt port may accept TCP before Neo4j has finished
  // recovery and opened the database. A cold start with the repository volume
  // currently takes about 50 seconds, so prove readiness with the authenticated
  // query for a bounded 90-second window. Warm starts return on the first try.
  for (let attempt = 1; attempt <= 45; attempt += 1) {
    const result = await runCommand('docker', query, 5_000);
    if (result.code === 0) return;
    lastOutput = result.output;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error(`existing Neo4j container did not answer an authenticated query: ${lastOutput}`);
}

async function ensureGraphDatabases(): Promise<void> {
  if (!(await dockerIsReady())) {
    throw new Error(
      'Docker is not running. Start Docker Desktop visibly, then rerun npm run dev:fresh.',
    );
  }

  // Persistent databases are authorities, not disposable app children. Keep a
  // healthy running instance warm; starting dev must not force Neo4j recovery,
  // reload plugins, or briefly tear PostgreSQL's Windows host binding down.
  const ageExists = await runCommand('docker', ['inspect', 'sim-pg']);
  if (ageExists.code !== 0) {
    throw new Error(
      'existing PostgreSQL/AGE container sim-pg is missing; refusing to create a replacement that could lose its persistent data',
    );
  }
  const ageStart = await runCommand('docker', ['start', 'sim-pg']);
  if (ageStart.code !== 0) {
    throw new Error(`failed to start existing PostgreSQL/AGE container: ${ageStart.output}`);
  }
  await waitForPostgresAge();
  await waitForTcp(5433, 'PostgreSQL/AGE');
  await waitForBackendPostgresAge();

  const neo4jExists = await runCommand('docker', ['inspect', 'neo4j']);
  if (neo4jExists.code === 0) {
    const running = await runCommand('docker', ['inspect', '--format', '{{.State.Running}}', 'neo4j']);
    if (running.code !== 0) {
      throw new Error(`failed to inspect existing Neo4j container: ${running.output}`);
    }
    if (running.output.trim().toLowerCase() !== 'true') {
      const neo4jStart = await runCommand('docker', ['start', 'neo4j'], 60_000);
      if (neo4jStart.code !== 0) {
        throw new Error(`failed to start existing Neo4j container: ${neo4jStart.output}`);
      }
    }
  } else {
    const neo4jCreate = await runCommand('docker', [
      'compose', '-p', 'main', '--env-file', 'apps/backend/.env',
      'up', '-d', 'neo4j',
    ], 240_000);
    if (neo4jCreate.code !== 0) {
      throw new Error(`failed to create repository Neo4j container: ${neo4jCreate.output}`);
    }
  }
  await waitForTcp(7687, 'Neo4j Bolt');
  await waitForNeo4jQuery();
  console.log('[fresh] PostgreSQL/AGE and Neo4j are query-ready through canonical application paths (healthy containers preserved)');
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

  // The uv shim can hide the repository root from a Python process command
  // line. The two reserved rails ports still give us an exact, existing
  // ownership check, so a fresh start replaces those services too.
  for (const [port, appModule, role] of [
    [GRAPHITI_PORT, 'app:app', 'graphiti'],
    [PYTHON_RAILS_PORT, 'app.main:app', 'rails'],
  ] as const) {
    const listener = await inspectPort(port);
    if (
      listener &&
      isLiquidAItyUvicornListener(listener, appModule, port) &&
      !owned.some(({ p }) => p.pid === listener.pid)
    ) {
      owned.push({ p: listener, verdict: { owned: true, role } });
    }
  }
  if (owned.length === 0) {
    console.log('[fresh] no verified LiquidAIty dev processes running');
  }
  for (const { p, verdict } of owned) {
    const role = verdict.owned ? verdict.role : 'unknown';
    console.log(`[fresh] stopping ${role} pid=${p.pid}`);
    stopProcessTree(p.pid);
  }

  // Let process-tree termination finish before restarting shared databases;
  // otherwise old clients can overlap the database restart and poison the next
  // catalog handshake.
  if (owned.length > 0) await new Promise((r) => setTimeout(r, 1500));

  // 3) Start only missing database containers and prove container-query plus
  // host-port readiness before any backend, MCP, or Harness process starts.
  await ensureGraphDatabases();

  // 4) Start one clean application supervisor (dev:grpc is guarded, so exactly
  // one gRPC server comes up). `dev:services` is intentionally the internal
  // post-readiness command; user-facing `dev:all` routes back through this rail.
  console.log('[fresh] starting one clean stack: npm run dev:services');
  // On Windows, invoke the npm batch shim through cmd explicitly. This keeps
  // output in the current terminal and avoids Node's deprecated args+shell path.
  const command = process.platform === 'win32'
    ? (process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe')
    : 'npm';
  const args = process.platform === 'win32'
    ? ['/d', '/s', '/c', 'npm run dev:services']
    : ['run', 'dev:services'];
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
