import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { tsImport } from 'tsx/esm/api';
import { resolveRepoRoot } from './workspaceRoot';

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
let connecting: Promise<HermesGatewayClient> | null = null;

function gatewayUrl(env: NodeJS.ProcessEnv = process.env): string {
  const configured = String(env.HERMES_GATEWAY_URL || '').trim();
  const token = String(env.HERMES_DASHBOARD_SESSION_TOKEN || '').trim();
  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new Error('hermes_gateway_url_invalid');
  }
  if (!['ws:', 'wss:'].includes(url.protocol)) throw new Error('hermes_gateway_url_invalid');
  if (!url.searchParams.has('token')) {
    if (!/^[a-f0-9]{64}$/i.test(token)) throw new Error('hermes_gateway_credential_missing');
    url.searchParams.set('token', token);
  }
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
  if (connecting) return connecting;
  connecting = (async () => {
    const client = await newGatewayClient();
    const ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        detach();
        reject(new Error('hermes_gateway_ready_timeout'));
      }, 15_000);
      timer.unref?.();
      const detach = client.onEvent((event) => {
        if (event.type !== 'gateway.ready') return;
        clearTimeout(timer);
        detach();
        resolve();
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
    await client.connect(gatewayUrl());
    await ready;
    connectedClient = client;
    return client;
  })().finally(() => {
    connecting = null;
  });
  return connecting;
}

export function closeHermesGateway(): void {
  connectedClient?.close();
  connectedClient = null;
  connecting = null;
}
