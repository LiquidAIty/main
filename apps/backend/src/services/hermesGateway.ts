/**
 * Entity: Hermes Gateway
 * Relationship: Owns the backend's authenticated singleton connection to the repository-controlled Hermes JSON-RPC Gateway, including readiness, cancellation, reconnect, and close behavior.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { tsImport } from 'tsx/esm/api';
import { resolveRepoRoot } from './workingDirectories';

export type HermesGatewayEvent = {
  type: string;
  session_id?: string;
  seq?: number;
  payload?: Record<string, unknown>;
};

export type HermesGatewayClient = {
  readonly connectionState: string;
  connect(url: string): Promise<void>;
  close(): void;
  request<T>(
    method: string,
    params?: Record<string, unknown>,
    timeoutMs?: number,
    signal?: AbortSignal,
  ): Promise<T>;
  onEvent(handler: (event: HermesGatewayEvent) => void): () => void;
  onState(handler: (state: string) => void): () => void;
  onRequest(handler: (request: {
    id: string;
    method: string;
    params: Record<string, unknown>;
    respond(result: Record<string, unknown>): void;
    fail(code: number, message: string): void;
    replayed?: boolean;
  }) => boolean | void): () => void;
};

let connectedClient: HermesGatewayClient | null = null;
let connecting: {
  generation: number;
  client: HermesGatewayClient | null;
  promise: Promise<HermesGatewayClient>;
} | null = null;
let connectionGeneration = 0;

export function resolveHermesGatewayUrl(env: NodeJS.ProcessEnv = process.env): string {
  const configured = String(env.HERMES_GATEWAY_URL || '').trim();
  const token = String(env.HERMES_DASHBOARD_SESSION_TOKEN || '').trim();
  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new Error('hermes_gateway_url_invalid');
  }
  const loopback = ['127.0.0.1', '::1', 'localhost'].includes(url.hostname.toLowerCase());
  if (!['ws:', 'wss:'].includes(url.protocol)
    || (url.protocol === 'ws:' && !loopback)
    || url.username
    || url.password
    || url.hash
    || url.searchParams.has('token')) {
    throw new Error('hermes_gateway_url_invalid');
  }
  if (!/^[a-f0-9]{64}$/i.test(token)) throw new Error('hermes_gateway_credential_missing');
  url.searchParams.set('token', token);
  return url.toString();
}

async function newGatewayClient(): Promise<HermesGatewayClient> {
  const source = path.join(
    resolveRepoRoot(),
    'HermesLatest',
    'apps',
    'shared',
    'src',
    'json-rpc-gateway.ts',
  );
  if (!existsSync(source)) throw new Error('hermes_gateway_client_missing');
  const loaded = await tsImport(
    pathToFileURL(source).href,
    pathToFileURL(__filename).href,
  ) as {
    JsonRpcGatewayClient?: new (options?: Record<string, unknown>) => HermesGatewayClient;
  };
  if (typeof loaded.JsonRpcGatewayClient !== 'function') {
    throw new Error('hermes_gateway_client_invalid');
  }
  return new loaded.JsonRpcGatewayClient({
    requestIdPrefix: 'app',
    requestTimeoutMs: 30 * 60_000,
  });
}

export async function hermesGateway(): Promise<HermesGatewayClient> {
  if (connectedClient?.connectionState === 'open') return connectedClient;
  if (connecting) return connecting.promise;
  const generation = connectionGeneration;
  const attempt = {
    generation,
    client: null as HermesGatewayClient | null,
    promise: null as unknown as Promise<HermesGatewayClient>,
  };
  attempt.promise = (async () => {
    let cancelReady: () => void = () => undefined;
    let client: HermesGatewayClient | null = null;
    try {
      const url = resolveHermesGatewayUrl();
      client = await newGatewayClient();
      attempt.client = client;
      if (generation !== connectionGeneration) {
        throw new Error('hermes_gateway_closed_during_connect');
      }
      const ready = new Promise<void>((resolve, reject) => {
        let detachEvent: () => void = () => undefined;
        let detachState: () => void = () => undefined;
        let timer: ReturnType<typeof setTimeout> | null = null;
        const cleanup = () => {
          if (timer !== null) clearTimeout(timer);
          detachEvent();
          detachState();
        };
        cancelReady = cleanup;
        timer = setTimeout(() => {
          cleanup();
          reject(new Error('hermes_gateway_ready_timeout'));
        }, 15_000);
        timer.unref?.();
        detachEvent = client!.onEvent((event) => {
          if (event.type !== 'gateway.ready') return;
          cleanup();
          resolve();
        });
        detachState = client!.onState((state) => {
          if (state !== 'closed' && state !== 'error') return;
          cleanup();
          reject(new Error(`hermes_gateway_${state}_before_ready`));
        });
      });
      client.onRequest((request) => {
        request.fail(-32601, `Unsupported application request: ${request.method}`);
        return true;
      });
      client.onState((state) => {
        if (['closed', 'error'].includes(state) && connectedClient === client) {
          connectedClient = null;
        }
      });
      const readyOutcome = ready.then(
        () => null,
        (error: unknown) => error,
      );
      await client.connect(url);
      const readinessError = await readyOutcome;
      if (readinessError) throw readinessError;
      if (generation !== connectionGeneration) {
        throw new Error('hermes_gateway_closed_during_connect');
      }
      connectedClient = client;
      return client;
    } catch (error) {
      cancelReady();
      client?.close();
      throw error;
    }
  })().finally(() => {
    if (connecting === attempt) connecting = null;
  });
  connecting = attempt;
  return attempt.promise;
}

export function closeHermesGateway(): void {
  connectionGeneration += 1;
  connecting?.client?.close();
  connectedClient?.close();
  connectedClient = null;
  if (connecting?.generation !== connectionGeneration) connecting = null;
}
