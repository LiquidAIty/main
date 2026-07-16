import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// WorldSignals runs as its own FastAPI application (vendored under
// worldsignal/Shadowbroker-main, started by its own docker-compose). LiquidAIty
// renders its frontend in-process from a built module — see
// client/src/components/worldsignal/WorldSignalSurface.tsx — so the backend is
// the only part of that stack this product path depends on. Compose still runs
// the vendor's own Next.js UI container; that is the standalone app, not ours.
const BACKEND_URL = process.env.WORLDSIGNALS_BACKEND_URL || 'http://127.0.0.1:8000';
const AUTOSTART = String(process.env.WORLDSIGNALS_AUTOSTART || 'true').toLowerCase() !== 'false';
let starting: Promise<boolean> | null = null;

async function reachable(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1800) });
    return response.ok;
  } catch {
    return false;
  }
}

function resolveRuntimeDir(): string | null {
  let current = path.resolve(process.cwd());
  for (let depth = 0; depth < 9; depth += 1) {
    const candidate = path.join(current, 'worldsignal', 'Shadowbroker-main');
    if (fs.existsSync(path.join(candidate, 'docker-compose.yml'))) return candidate;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

async function startRuntime(): Promise<boolean> {
  const runtimeDir = resolveRuntimeDir();
  if (!runtimeDir) return false;
  return new Promise((resolve) => {
    const executable = process.platform === 'win32' ? 'docker.exe' : 'docker';
    const child = spawn(executable, ['compose', 'up', '-d'], {
      cwd: runtimeDir,
      windowsHide: true,
      stdio: 'ignore',
    });
    child.once('error', () => resolve(false));
    child.once('exit', (code) => resolve(code === 0));
  });
}

export async function ensureWorldsignalSidecarRunning(): Promise<boolean> {
  if (await reachable(`${BACKEND_URL}/api/health`)) return true;
  if (!AUTOSTART) return false;
  if (!starting) {
    starting = (async () => {
      if (!(await startRuntime())) return false;
      for (let attempt = 0; attempt < 40; attempt += 1) {
        if (await reachable(`${BACKEND_URL}/api/health`)) return true;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      return false;
    })().finally(() => { starting = null; });
  }
  return starting;
}

export const worldSignalsRuntimeUrls = { backend: BACKEND_URL } as const;
