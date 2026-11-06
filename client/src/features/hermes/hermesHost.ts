/**
 * Entity: Hermes UI Integration
 * Relationship: Connects the unchanged LiquidAIty UI through Hermes Webapp launch-session authentication and Hermes's generated JSON-RPC client without a dashboard SDK, another decoder, or a backend requester.
 */

import {
  JsonRpcGatewayClient,
  type GatewayEvent,
  type GatewayEventName,
} from '../../../../HermesLatest/apps/shared/src/json-rpc-gateway';
import type {
  RpcMethods,
} from '../../../../HermesLatest/apps/shared/src/gateway-contract.generated';
import { buildHermesWebSocketUrl, normalizeBasePath } from '../../../../HermesLatest/apps/shared/src/websocket-url';

type HermesWebappHost = {
  buildWsUrl(path: string, params?: Record<string, string>): Promise<string>;
  fetchJSON?<T>(path: string, init?: RequestInit): Promise<T>;
  authedFetch?(path: string, init?: RequestInit): Promise<Response>;
};

type HermesWindow = Window & {
  __HERMES_AUTH_REQUIRED__?: boolean;
  __HERMES_BASE_PATH__?: string;
  __HERMES_UI_SURFACE__?: string;
};

const WEBAPP_SESSION_HEADER = 'X-Hermes-Session-Token';
const WEBAPP_NATIVE_DIAL = 'browser';

type WebappBootstrap = {
  authRequired: boolean;
  basePath: string;
  token: string;
};

function webappSessionKey(basePath: string): string {
  return `hermes.webapp.session.v1:${JSON.stringify([window.location.origin, basePath])}`;
}

function webappBootstrap(): WebappBootstrap | null {
  const host = window as HermesWindow;
  if (host.__HERMES_UI_SURFACE__ !== 'webapp') return null;
  const basePath = normalizeBasePath(host.__HERMES_BASE_PATH__);
  let token = '';
  try {
    token = window.sessionStorage.getItem(webappSessionKey(basePath)) || '';
  } catch {
    token = '';
  }
  return {
    authRequired: host.__HERMES_AUTH_REQUIRED__ === true,
    basePath,
    token,
  };
}

function webappEndpoint(basePath: string, path: string): string {
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${basePath}${suffix}`;
}

async function webappFetch(
  bootstrap: WebappBootstrap,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  if (!bootstrap.authRequired && !bootstrap.token) {
    throw new Error('Run hermes webapp to sign this browser into LiquidAIty.');
  }
  const headers = new Headers(init?.headers);
  if (bootstrap.token) headers.set(WEBAPP_SESSION_HEADER, bootstrap.token);
  return fetch(webappEndpoint(bootstrap.basePath, path), {
    ...init,
    credentials: 'same-origin',
    headers,
  });
}

function webappHost(bootstrap: WebappBootstrap): HermesWebappHost {
  return {
    async buildWsUrl(path, params = {}) {
      if (path === '/api/ws') {
        const query = new URLSearchParams({ socket: 'gateway' });
        if (params.profile) query.set('profile', params.profile);
        const response = await webappFetch(
          bootstrap,
          `/api/webapp/socket-ticket?${query.toString()}`,
          { method: 'POST' },
        );
        if (!response.ok) {
          throw new Error(`Hermes Webapp ticket mint failed (${response.status}).`);
        }
        const payload = await response.json() as { ticket?: unknown };
        const ticket = typeof payload.ticket === 'string' ? payload.ticket.trim() : '';
        if (!ticket) throw new Error('Hermes Webapp did not return a Gateway ticket.');
        return buildHermesWebSocketUrl({
          authParam: ['ticket', ticket],
          basePath: bootstrap.basePath,
          params: { ...params, native_dial: WEBAPP_NATIVE_DIAL },
          path,
        });
      }

      return buildHermesWebSocketUrl({
        authParam: bootstrap.token ? ['token', bootstrap.token] : undefined,
        basePath: bootstrap.basePath,
        params,
        path,
      });
    },
    async fetchJSON<T>(path: string, init?: RequestInit): Promise<T> {
      const response = await webappFetch(bootstrap, path, init);
      const body = await response.text();
      if (!response.ok) {
        throw new Error(body || `Hermes Webapp request failed (${response.status}).`);
      }
      return (body ? JSON.parse(body) : null) as T;
    },
    authedFetch(path: string, init?: RequestInit): Promise<Response> {
      return webappFetch(bootstrap, path, init);
    },
  };
}

const clients = new Map<string, JsonRpcGatewayClient>();
const connections = new Map<string, Promise<JsonRpcGatewayClient>>();
const reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
const reconnectAttempts = new Map<string, number>();
const stateUnsubscribers = new Map<string, () => void>();
const MAX_RECONNECT_DELAY_MS = 30_000;

export function hermesWebappHost(): HermesWebappHost {
  const bootstrap = webappBootstrap();
  if (bootstrap) return webappHost(bootstrap);
  throw new Error('LiquidAIty must run through Hermes Webapp.');
}

function scheduleReconnect(profile: string, client: JsonRpcGatewayClient): void {
  if (clients.get(profile) !== client || reconnectTimers.has(profile)) return;
  const attempt = reconnectAttempts.get(profile) || 0;
  const delay = Math.min(MAX_RECONNECT_DELAY_MS, 500 * (2 ** Math.min(attempt, 6)));
  reconnectAttempts.set(profile, attempt + 1);
  reconnectTimers.set(profile, setTimeout(() => {
    reconnectTimers.delete(profile);
    if (clients.get(profile) !== client) return;
    void connectClient(profile, client).catch(() => scheduleReconnect(profile, client));
  }, delay));
}

function connectClient(
  profile: string,
  client: JsonRpcGatewayClient,
): Promise<JsonRpcGatewayClient> {
  const pending = connections.get(profile);
  if (pending) return pending;
  const connecting = hermesWebappHost().buildWsUrl('/api/ws', {
    profile,
  }).then(async (url) => {
    await client.connect(url);
    return client;
  }).finally(() => {
    connections.delete(profile);
  });
  connections.set(profile, connecting);
  return connecting;
}

export async function hermesGateway(profile: string): Promise<JsonRpcGatewayClient> {
  const canonicalProfile = String(profile || '').trim().toLowerCase();
  if (!canonicalProfile) throw new Error('Hermes profile is required.');
  const existing = clients.get(canonicalProfile);
  if (existing?.connectionState === 'open') return existing;
  const client = existing || new JsonRpcGatewayClient({
    requestIdPrefix: `${canonicalProfile}-`,
    connectErrorMessage: `Could not connect to Hermes profile ${canonicalProfile}`,
    closedErrorMessage: `Hermes profile ${canonicalProfile} disconnected`,
    notConnectedErrorMessage: `Hermes profile ${canonicalProfile} is not connected`,
  });
  if (!existing) {
    clients.set(canonicalProfile, client);
    stateUnsubscribers.set(canonicalProfile, client.onState((state) => {
      if (state === 'open') {
        reconnectAttempts.delete(canonicalProfile);
        const timer = reconnectTimers.get(canonicalProfile);
        if (timer) clearTimeout(timer);
        reconnectTimers.delete(canonicalProfile);
      } else if (state === 'closed' || state === 'error') {
        scheduleReconnect(canonicalProfile, client);
      }
    }));
  }
  return connectClient(canonicalProfile, client);
}

export async function hermesRequest<M extends keyof RpcMethods>(
  profile: string,
  method: M,
  params: RpcMethods[M]['params'],
  timeoutMs?: number,
): Promise<RpcMethods[M]['result']> {
  const client = await hermesGateway(profile);
  return client.request<RpcMethods[M]['result']>(
    method,
    { profile, ...(params as Record<string, unknown>) },
    timeoutMs,
  );
}

export async function hermesPtyUrl(
  profile: string,
  params: Record<string, string>,
): Promise<string> {
  return hermesWebappHost().buildWsUrl('/api/pty', { ...params, profile });
}

export async function onHermesEvent<K extends GatewayEventName>(
  profile: string,
  type: K,
  handler: (event: GatewayEvent<K>) => void,
): Promise<() => void> {
  return (await hermesGateway(profile)).on(type, handler);
}

export function closeHermesClientsForTests(): void {
  for (const timer of reconnectTimers.values()) clearTimeout(timer);
  reconnectTimers.clear();
  for (const [profile, client] of [...clients]) {
    clients.delete(profile);
    stateUnsubscribers.get(profile)?.();
    stateUnsubscribers.delete(profile);
    client.close();
  }
  connections.clear();
  reconnectAttempts.clear();
}
