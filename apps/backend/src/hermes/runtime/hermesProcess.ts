import { createHash, randomBytes } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { tsImport } from 'tsx/esm/api';
import { resolveRepoRoot } from '../../services/workspaceRoot';

const READY_TIMEOUT_MS = 120_000;
const REQUEST_TIMEOUT_MS = 30 * 60_000;

export type HermesRuntimeEvent = {
  type: string;
  session_id?: string;
  seq?: number;
  payload?: Record<string, unknown>;
};

export type HermesRuntimeClient = {
  readonly connectionState: string;
  connect(url: string): Promise<void>;
  close(): void;
  request<T>(
    method: string,
    params?: Record<string, unknown>,
    timeoutMs?: number,
    signal?: AbortSignal,
  ): Promise<T>;
  onEvent(handler: (event: HermesRuntimeEvent) => void): () => void;
  onState(handler: (state: string) => void): () => void;
};

export type HermesProcessSpec = {
  executable: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
};

export type HermesProcessDependencies = {
  spawnProcess?: (
    executable: string,
    args: string[],
    options: { cwd: string; env: Record<string, string>; windowsHide: boolean },
  ) => ChildProcess;
  createClient?: () => Promise<HermesRuntimeClient>;
  createCredential?: () => string;
};

export type HermesProcessHandle = {
  pid: number;
  url: string;
  credential: string;
  credentialId: string;
  client: HermesRuntimeClient;
  exitCode(): number | null;
  stop(): void;
};

export async function createHermesRuntimeClient(): Promise<HermesRuntimeClient> {
  const source = path.join(
    resolveRepoRoot(), 'Hermes', 'apps', 'shared', 'src', 'json-rpc-gateway.ts',
  );
  if (!existsSync(source)) throw new Error('hermes_process_client_missing');
  const loaded = await tsImport(
    pathToFileURL(source).href,
    pathToFileURL(__filename).href,
  ) as {
    JsonRpcGatewayClient?: new (options?: Record<string, unknown>) => HermesRuntimeClient;
  };
  if (typeof loaded.JsonRpcGatewayClient !== 'function') {
    throw new Error('hermes_process_client_invalid');
  }
  return new loaded.JsonRpcGatewayClient({
    requestIdPrefix: 'card',
    requestTimeoutMs: REQUEST_TIMEOUT_MS,
  });
}

function waitForReady(process: ChildProcess, timeoutMs = READY_TIMEOUT_MS): Promise<number> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let buffered = '';
    const timer = setTimeout(() => finish(new Error('hermes_process_start_timeout')), timeoutMs);
    timer.unref?.();
    const finish = (error?: Error, port?: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      process.off('error', onError);
      process.off('exit', onExit);
      process.stdout?.off('data', onData);
      process.stderr?.off('data', onData);
      if (error) reject(error);
      else resolve(port!);
    };
    const onError = () => finish(new Error('hermes_process_start_failed'));
    const onExit = (code: number | null) => finish(
      new Error(`hermes_process_exited_before_ready:${code ?? 'null'}`),
    );
    const onData = (value: Buffer | string) => {
      buffered = `${buffered}${String(value)}`.slice(-16_384);
      const match = /HERMES_BACKEND_READY\s+port=(\d+)/.exec(buffered);
      if (!match) return;
      const port = Number(match[1]);
      if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
        finish(new Error('hermes_process_ready_invalid'));
        return;
      }
      finish(undefined, port);
    };
    process.once('error', onError);
    process.once('exit', onExit);
    process.stdout?.on('data', onData);
    process.stderr?.on('data', onData);
  });
}

export async function startHermesProcess(
  spec: HermesProcessSpec,
  callbacks: {
    onExit(code: number | null): void;
    onTransportClosed(): void;
  },
  dependencies: HermesProcessDependencies = {},
): Promise<HermesProcessHandle> {
  if (!dependencies.spawnProcess && !existsSync(spec.executable)) {
    throw new Error('hermes_process_executable_missing');
  }
  const spawnProcess = dependencies.spawnProcess ?? ((executable, args, options) => spawn(
    executable,
    args,
    { ...options, stdio: ['ignore', 'pipe', 'pipe'] },
  ));
  const createClient = dependencies.createClient ?? createHermesRuntimeClient;
  const credential = (dependencies.createCredential ?? (() => randomBytes(32).toString('hex')))();
  if (!/^[a-f0-9]{64}$/i.test(credential)) throw new Error('hermes_process_credential_invalid');
  const process = spawnProcess(spec.executable, spec.args, {
    cwd: spec.cwd,
    env: { ...spec.env, HERMES_DASHBOARD_SESSION_TOKEN: credential },
    windowsHide: true,
  });
  let client: HermesRuntimeClient | null = null;
  let stopping = false;
  let detachState = () => {};
  try {
    if (!process.pid) throw new Error('hermes_process_pid_missing');
    const port = await waitForReady(process);
    client = await createClient();
    const url = `ws://127.0.0.1:${port}/api/ws?token=${encodeURIComponent(credential)}`;
    await client.connect(url);
    const connected = client;
    let finished = false;
    const finish = (code: number | null) => {
      if (finished) return;
      finished = true;
      detachState();
      connected.close();
      if (!stopping) callbacks.onExit(code);
    };
    process.once('exit', finish);
    process.once('error', () => finish(null));
    detachState = connected.onState((state) => {
      if (state !== 'open' && !stopping) callbacks.onTransportClosed();
    });
    return {
      pid: process.pid,
      url,
      credential,
      credentialId: createHash('sha256').update(credential, 'utf8').digest('hex'),
      client: connected,
      exitCode: () => process.exitCode,
      stop: () => {
        if (stopping) return;
        stopping = true;
        detachState();
        connected.close();
        if (process.exitCode === null && !process.killed) process.kill();
      },
    };
  } catch (error) {
    stopping = true;
    detachState();
    client?.close();
    if (process.exitCode === null && !process.killed) process.kill();
    throw error;
  }
}
