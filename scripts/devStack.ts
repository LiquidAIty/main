/**
 * LiquidAIty dev-stack ownership helpers — the smallest grounded logic for
 * "reuse a valid running OpenClaude gRPC, never start a duplicate, never kill an
 * unrelated process". Pure decision functions are exported and unit-tested; the
 * OS-touching helpers (inspectPort / stopProcess) are thin and only used by the
 * grpc-guard / dev-fresh entry scripts.
 *
 * This is NOT a process-management platform: it inspects ONE known port and
 * matches processes ONLY by their exact, grounded LiquidAIty startup signatures.
 */

import { spawn } from 'node:child_process';

export const GRPC_PORT = 50051;

export type PortListener = { pid: number; name: string; commandLine: string };
export type ProcInfo = { pid: number; name: string; commandLine: string };

function norm(value: string): string {
  return String(value || '').toLowerCase().replace(/\\/g, '/');
}

/**
 * Is this 50051 listener the expected LiquidAIty OpenClaude Bun gRPC server?
 * Grounded on the exact vendored startup command (`bun run scripts/start-grpc.ts`)
 * — a bun process whose command line runs start-grpc.ts. A random bun/node/python
 * process never matches, so it can never be treated as reusable.
 */
export function isLiquidAItyGrpcListener(listener: PortListener | null): boolean {
  if (!listener) return false;
  const name = norm(listener.name);
  const cmd = norm(listener.commandLine);
  return name.includes('bun') && /(^|[\s/])scripts\/start-grpc\.ts(\s|$)/.test(cmd);
}

export type GrpcAction =
  | { action: 'start' }
  | { action: 'reuse'; pid: number }
  | { action: 'conflict'; pid: number; commandLine: string };

/**
 * Decide what a dev startup should do about port 50051, from the current listener:
 *  - no listener            → start the one gRPC server
 *  - valid LiquidAIty gRPC  → reuse it (do NOT start a second)
 *  - unknown listener       → conflict (fail honestly; never kill it, never start a rival)
 */
export function decideGrpcAction(listener: PortListener | null): GrpcAction {
  if (!listener) return { action: 'start' };
  if (isLiquidAItyGrpcListener(listener)) return { action: 'reuse', pid: listener.pid };
  return { action: 'conflict', pid: listener.pid, commandLine: listener.commandLine };
}

export type OwnedRole = 'grpc' | 'autogen' | 'backend' | 'frontend' | 'supervisor';

/**
 * May `dev:fresh` stop this process? ONLY when its command line carries a grounded
 * LiquidAIty dev signature. The gRPC server matches by its bun+start-grpc.ts
 * signature; every other role must ALSO point into the repo root, so a bare
 * bun/node/python/vite/postgres/docker process is never a match.
 */
export function isLiquidAItyOwnedDevProcess(
  proc: ProcInfo,
  repoRoot: string,
): { owned: false } | { owned: true; role: OwnedRole } {
  const cmd = norm(proc.commandLine);
  if (!cmd) return { owned: false };
  const root = norm(repoRoot);

  // gRPC: identified by the exact vendored startup command (its cmdline does not
  // include the repo path, but bun + scripts/start-grpc.ts is unambiguous).
  if (norm(proc.name).includes('bun') && /(^|[\s/])scripts\/start-grpc\.ts(\s|$)/.test(cmd)) {
    return { owned: true, role: 'grpc' };
  }

  // Everything else must be grounded in the repo root path to be ownable.
  if (!root || !cmd.includes(root)) return { owned: false };
  if (/uvicorn\b[\s\S]*app\.main:app[\s\S]*8003/.test(cmd)) return { owned: true, role: 'autogen' };
  if (/\bnx\b[\s\S]*serve backend/.test(cmd) || /apps\/backend\b[\s\S]*run-executor/.test(cmd)) {
    return { owned: true, role: 'backend' };
  }
  if (/\/client\/[\s\S]*vite[\s\S]*\bdev\b/.test(cmd) || /--workspace client run dev/.test(cmd)) {
    return { owned: true, role: 'frontend' };
  }
  if (/concurrently[\s\S]*dev:grpc/.test(cmd) || /run dev:all\b/.test(cmd)) {
    return { owned: true, role: 'supervisor' };
  }
  return { owned: false };
}

// --------------------------------------------------------------------------- //
// OS-touching helpers (not unit-tested; exercised by the entry scripts + proof).
// --------------------------------------------------------------------------- //

function runCapture(command: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    let out = '';
    const child = spawn(command, args, { windowsHide: true });
    child.stdout?.on('data', (d) => (out += String(d)));
    child.on('error', () => resolve(''));
    child.on('close', () => resolve(out));
  });
}

/** The single listener on `port`, or null. Non-destructive inspection only. */
export async function inspectPort(port: number): Promise<PortListener | null> {
  if (process.platform === 'win32') {
    const ps = [
      '-NoProfile', '-Command',
      `$c = Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1;` +
      `if ($c) { $p = Get-CimInstance Win32_Process -Filter ("ProcessId=" + $c.OwningProcess) -ErrorAction SilentlyContinue;` +
      ` if ($p) { [pscustomobject]@{ pid=$p.ProcessId; name=$p.Name; commandLine=$p.CommandLine } | ConvertTo-Json -Compress } }`,
    ];
    const raw = (await runCapture('powershell.exe', ps)).trim();
    if (!raw) return null;
    try {
      const j = JSON.parse(raw);
      return { pid: Number(j.pid), name: String(j.name || ''), commandLine: String(j.commandLine || '') };
    } catch {
      return null;
    }
  }
  // POSIX: lsof for the listening pid, then the process command.
  const lsof = (await runCapture('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fp'])).trim();
  const pidLine = lsof.split('\n').find((l) => l.startsWith('p'));
  if (!pidLine) return null;
  const pid = Number(pidLine.slice(1));
  if (!Number.isFinite(pid)) return null;
  const cmd = (await runCapture('ps', ['-p', String(pid), '-o', 'comm=,args='])).trim();
  const name = cmd.split(/\s+/)[0] || '';
  return { pid, name, commandLine: cmd };
}

/** Enumerate candidate dev processes (bun/node/python/powershell) with command
 * lines, so dev-fresh can match ONLY grounded LiquidAIty owners. */
export async function enumerateProcesses(): Promise<ProcInfo[]> {
  if (process.platform === 'win32') {
    const ps = [
      '-NoProfile', '-Command',
      `Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'bun|node|python|powershell' } |` +
      ` ForEach-Object { [pscustomobject]@{ pid=$_.ProcessId; name=$_.Name; commandLine=$_.CommandLine } } | ConvertTo-Json -Compress`,
    ];
    const raw = (await runCapture('powershell.exe', ps)).trim();
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      const arr = Array.isArray(parsed) ? parsed : [parsed];
      return arr.map((x) => ({ pid: Number(x.pid), name: String(x.name || ''), commandLine: String(x.commandLine || '') }));
    } catch {
      return [];
    }
  }
  const raw = await runCapture('ps', ['-eo', 'pid=,comm=,args=']);
  return raw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const m = l.match(/^(\d+)\s+(\S+)\s+([\s\S]*)$/);
      return m ? { pid: Number(m[1]), name: m[2], commandLine: m[3] } : null;
    })
    .filter((x): x is ProcInfo => x !== null);
}

/** Stop a process and its children. Windows: taskkill /T; POSIX: SIGTERM. */
export function stopProcessTree(pid: number): void {
  if (process.platform === 'win32') {
    spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true });
  } else {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      /* already gone */
    }
  }
}
