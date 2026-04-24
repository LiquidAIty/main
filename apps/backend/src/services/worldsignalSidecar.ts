import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const WORLDSIGNAL_HEALTH_URL = 'http://127.0.0.1:3117/api/health';
const AUTOSTART_ENABLED =
  String(process.env.WORLDSIGNAL_AUTOSTART || 'true').toLowerCase() !== 'false';
const STARTUP_WAIT_MS = 20000;
const POLL_MS = 500;

let sidecarProcess: ChildProcess | null = null;
let startingPromise: Promise<boolean> | null = null;
let resolvedWorldsignalDir: string | null = null;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function isHealthy(timeoutMs: number): Promise<boolean> {
  try {
    const res = await fetch(WORLDSIGNAL_HEALTH_URL, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function resolveWorldsignalDir(): string | null {
  if (resolvedWorldsignalDir) return resolvedWorldsignalDir;

  const moduleDir = __dirname;
  const candidates = new Set<string>();
  const pushWalkCandidates = (startDir: string, maxDepth = 8) => {
    let current = path.resolve(startDir);
    for (let depth = 0; depth <= maxDepth; depth += 1) {
      candidates.add(path.join(current, 'worldsignal'));
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  };
  pushWalkCandidates(process.cwd());
  pushWalkCandidates(moduleDir);

  for (const candidate of candidates.values()) {
    if (fs.existsSync(path.join(candidate, 'package.json'))) {
      resolvedWorldsignalDir = candidate;
      return resolvedWorldsignalDir;
    }
  }
  return null;
}

function buildSpawnEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') env[key] = value;
  }
  env.PORT = env.WORLDSIGNAL_PORT || '3117';
  env.HOST = env.WORLDSIGNAL_HOST || '127.0.0.1';
  env.BROWSER = 'none';
  env.OPEN = 'false';
  env.CRUCIX_OPEN_BROWSER = 'false';
  return env;
}

function isProcessAlive(proc: ChildProcess | null): proc is ChildProcess {
  return Boolean(proc && proc.exitCode == null && !proc.killed);
}

function spawnWorldsignal(): void {
  if (isProcessAlive(sidecarProcess)) {
    console.log('[worldsignal] autostart skipped: process already running');
    return;
  }

  const worldsignalDir = resolveWorldsignalDir();
  if (!worldsignalDir) {
    console.warn(
      `[worldsignal] autostart skipped: worldsignal directory not found (cwd=${process.cwd()})`,
    );
    return;
  }
  console.log(`[worldsignal] autostart using directory: ${worldsignalDir}`);

  const isWindows = process.platform === 'win32';
  const command = isWindows
    ? process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe'
    : 'npm';
  const args = isWindows ? ['/d', '/s', '/c', 'npm run dev:headless'] : ['run', 'dev:headless'];

  const env = buildSpawnEnv();
  console.log(
    `[worldsignal] autostart spawn command="${command}" args="${args.join(' ')}" cwd="${worldsignalDir}" port="${env.PORT}" host="${env.HOST}"`,
  );

  sidecarProcess = spawn(command, args, {
    cwd: worldsignalDir,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
    env,
  });

  sidecarProcess.stdout?.on('data', (chunk) => {
    const text = String(chunk || '').trim();
    if (text) console.log(`[worldsignal] ${text}`);
  });
  sidecarProcess.stderr?.on('data', (chunk) => {
    const text = String(chunk || '').trim();
    if (text) console.error(`[worldsignal] ${text}`);
  });
  sidecarProcess.on('error', (err) => {
    console.error(
      `[worldsignal] sidecar process error command="${command}" cwd="${worldsignalDir}"`,
      err,
    );
    sidecarProcess = null;
  });
  sidecarProcess.on('exit', (code, signal) => {
    console.error(
      `[worldsignal] sidecar exited code=${String(code)} signal=${String(signal)}`,
    );
    sidecarProcess = null;
  });
}

export async function ensureWorldsignalSidecarRunning(): Promise<{
  attempted: boolean;
  healthy: boolean;
  error?: string;
}> {
  const alreadyHealthy = await isHealthy(1200);
  if (alreadyHealthy) return { attempted: false, healthy: true };

  if (!AUTOSTART_ENABLED) return { attempted: false, healthy: false };

  if (startingPromise) {
    const healthy = await startingPromise;
    return { attempted: true, healthy };
  }

  startingPromise = (async () => {
    try {
      if (!isProcessAlive(sidecarProcess)) {
        spawnWorldsignal();
      }
      const start = Date.now();
      while (Date.now() - start < STARTUP_WAIT_MS) {
        if (await isHealthy(1200)) return true;
        await sleep(POLL_MS);
      }
      return false;
    } catch (err: any) {
      console.error('[worldsignal] autostart failed', err);
      return false;
    } finally {
      startingPromise = null;
    }
  })();

  const healthy = await startingPromise;
  return { attempted: true, healthy };
}
