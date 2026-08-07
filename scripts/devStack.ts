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
export const GRAPHITI_PORT = 8001;
export const PYTHON_RAILS_PORT = 8003;

export function buildProductChatGrpcEnvironment(
  parentEnv: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  return {
    ...parentEnv,
    CLAUDE_CODE_DISABLE_CLAUDE_MDS: '1',
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
  };
}

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

/**
 * Is this listener one of OUR python uvicorn services? The venv python is
 * launched through a uv shim whose resolved command line carries the uv-store
 * python path, NOT the repo root — so the cmdline enumeration used for
 * backend/frontend cannot ground it. Instead we identify it by the ONE thing
 * that is unambiguous on our reserved port: a python `uvicorn <appModule>`
 * bound to that port. Graphiti ingestion's `app:app` and Python rails'
 * `app.main:app` never
 * match each other. A random uvicorn on some OTHER port is never inspected —
 * each predicate only ever runs against whatever holds its own reserved port,
 * exactly as the gRPC guard only inspects 50051.
 */
export function isLiquidAItyUvicornListener(
  listener: PortListener | null,
  appModule: string,
  port: number,
): boolean {
  if (!listener) return false;
  const name = norm(listener.name);
  const cmd = norm(listener.commandLine);
  const moduleToken = new RegExp(`(^|[\\s"'])${appModule.replace(/\./g, '\\.')}($|[\\s"'])`);
  return (
    name.includes('python') &&
    /\buvicorn\b/.test(cmd) &&
    moduleToken.test(cmd) &&
    new RegExp(`\\b${port}\\b`).test(cmd)
  );
}

export type UvicornAction =
  | { action: 'start' }
  | { action: 'reuse'; pid: number }
  | { action: 'conflict'; pid: number; commandLine: string };

/**
 * Reuse/start/conflict discipline for a reserved uvicorn port, same as gRPC:
 *  - no listener        → start the one service
 *  - our uvicorn        → reuse it (do NOT launch a duplicate that 10048s)
 *  - unknown listener   → conflict (fail honestly; never kill it, never rival)
 */
export function decideUvicornAction(
  listener: PortListener | null,
  appModule: string,
  port: number,
): UvicornAction {
  if (!listener) return { action: 'start' };
  if (isLiquidAItyUvicornListener(listener, appModule, port)) return { action: 'reuse', pid: listener.pid };
  return { action: 'conflict', pid: listener.pid, commandLine: listener.commandLine };
}

export function isLiquidAItyGraphitiListener(listener: PortListener | null): boolean {
  return isLiquidAItyUvicornListener(listener, 'app:app', GRAPHITI_PORT);
}

export function decideGraphitiAction(listener: PortListener | null): UvicornAction {
  return decideUvicornAction(listener, 'app:app', GRAPHITI_PORT);
}

export function isLiquidAItyPythonRailsListener(listener: PortListener | null): boolean {
  return isLiquidAItyUvicornListener(listener, 'app.main:app', PYTHON_RAILS_PORT);
}

export function decidePythonRailsAction(listener: PortListener | null): UvicornAction {
  return decideUvicornAction(listener, 'app.main:app', PYTHON_RAILS_PORT);
}

export type OwnedRole = 'grpc' | 'rails' | 'backend' | 'frontend' | 'mcp' | 'tunnel' | 'supervisor';

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

  // Public MCP tunnel: the reserved LiquidAIty ngrok domain targeting the
  // official HTTP MCP port is unambiguous even though ngrok's child command
  // line does not carry the repository root.
  if (
    norm(proc.name).includes('ngrok') &&
    /\bhttp\b/.test(cmd) &&
    /--(?:url|domain)(?:=|\s+)(?:https:\/\/)?exemption-unstable-wolverine\.ngrok-free\.dev\b/.test(cmd) &&
    /\b8765\b/.test(cmd)
  ) {
    return { owned: true, role: 'tunnel' };
  }

  // Everything else must be grounded in the repo root path to be ownable.
  if (!root || !cmd.includes(root)) return { owned: false };
  if (/uvicorn\b[\s\S]*app\.main:app[\s\S]*8003/.test(cmd)) return { owned: true, role: 'rails' };
  if (/\bnx\b[\s\S]*serve backend/.test(cmd) || /apps\/backend\b[\s\S]*run-executor/.test(cmd)) {
    return { owned: true, role: 'backend' };
  }
  if (/\/client\/[\s\S]*vite[\s\S]*\bdev\b/.test(cmd) || /--workspace client run dev/.test(cmd)) {
    return { owned: true, role: 'frontend' };
  }
  if (
    norm(proc.name).includes('python') &&
    /(?:apps\/python-models\/app\/)?mcp_host\.py(?:\s|$)/.test(cmd)
  ) {
    return { owned: true, role: 'mcp' };
  }
  if (/concurrently[\s\S]*dev:grpc/.test(cmd) || /run dev:services\b/.test(cmd)) {
    return { owned: true, role: 'supervisor' };
  }
  return { owned: false };
}

// --------------------------------------------------------------------------- //
// OS-touching helpers (not unit-tested; exercised by the entry scripts + proof).
// --------------------------------------------------------------------------- //

type CaptureResult = { completed: boolean; output: string };

function runCaptureBounded(
  command: string,
  args: string[],
  timeoutMs: number,
): Promise<CaptureResult> {
  return new Promise((resolve) => {
    let out = '';
    let settled = false;
    const child = spawn(command, args, { windowsHide: true });
    child.stdout?.on('data', (d) => (out += String(d)));
    const finish = (completed: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ completed, output: out });
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(false);
    }, timeoutMs);
    child.on('error', () => finish(false));
    child.on('close', (code) => finish(code === 0));
  });
}

async function runCapture(command: string, args: string[]): Promise<string> {
  return (await runCaptureBounded(command, args, 30_000)).output;
}

/** Parse only a Windows netstat local LISTENING row for `port`.
 * Remote-port matches and connection rows are deliberately ignored. */
export function parseWindowsNetstatListenerPid(output: string, port: number): number | null {
  for (const line of output.split(/\r?\n/)) {
    const columns = line.trim().split(/\s+/);
    if (columns.length < 5 || columns[0].toUpperCase() !== 'TCP') continue;
    const localAddress = columns[1];
    const state = columns[3].toUpperCase();
    const pid = Number(columns[4]);
    const separator = localAddress.lastIndexOf(':');
    const localPort = separator >= 0 ? Number(localAddress.slice(separator + 1)) : NaN;
    if (state === 'LISTENING' && localPort === port && Number.isInteger(pid) && pid > 0) {
      return pid;
    }
  }
  return null;
}

/** The single listener on `port`, or null. Non-destructive inspection only. */
export async function inspectPort(port: number): Promise<PortListener | null> {
  if (process.platform === 'win32') {
    const listeners = await runCaptureBounded('netstat.exe', ['-ano', '-p', 'tcp'], 5_000);
    if (!listeners.completed) {
      throw new Error(`dev_port_inspection_failed: netstat timed out for port ${port}`);
    }
    const pid = parseWindowsNetstatListenerPid(listeners.output, port);
    if (pid === null) return null;
    const ps = [
      '-NoProfile', '-Command',
      `$p = Get-CimInstance Win32_Process -Filter "ProcessId=${pid}" -ErrorAction SilentlyContinue;` +
      `if ($p) { [pscustomobject]@{ pid=$p.ProcessId; name=$p.Name; commandLine=$p.CommandLine } | ConvertTo-Json -Compress }`,
    ];
    const processLookup = await runCaptureBounded('powershell.exe', ps, 15_000);
    if (!processLookup.completed) {
      throw new Error(`dev_port_inspection_failed: process lookup timed out for pid ${pid} port ${port}`);
    }
    const raw = processLookup.output.trim();
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

/** Enumerate candidate dev processes (bun/node/python/powershell/ngrok) with command
 * lines, so dev-fresh can match ONLY grounded LiquidAIty owners. */
export async function enumerateProcesses(): Promise<ProcInfo[]> {
  if (process.platform === 'win32') {
    const ps = [
      '-NoProfile', '-Command',
      `Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'bun|node|python|powershell|ngrok' } |` +
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
