/**
 * Entity: Hermes UI Integration
 * Relationship: Obtains authenticated WebSocket URLs from the public Hermes dashboard plugin SDK and reuses Hermes's generated JSON-RPC client without another decoder or backend requester.
 */

import {
  JsonRpcGatewayClient,
  type GatewayEvent,
  type GatewayEventName,
} from '../../../../HermesLatest/apps/shared/src/json-rpc-gateway';
import type {
  RpcMethods,
} from '../../../../HermesLatest/apps/shared/src/gateway-contract.generated';

type DashboardPluginSdk = {
  buildWsUrl(path: string, params?: Record<string, string>): Promise<string>;
  fetchJSON?<T>(path: string, init?: RequestInit): Promise<T>;
  authedFetch?(path: string, init?: RequestInit): Promise<Response>;
};

type HermesWindow = Window & {
  __HERMES_PLUGIN_SDK__?: DashboardPluginSdk;
};

const clients = new Map<string, JsonRpcGatewayClient>();
const connections = new Map<string, Promise<JsonRpcGatewayClient>>();
const reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
const reconnectAttempts = new Map<string, number>();
const stateUnsubscribers = new Map<string, () => void>();
const MAX_RECONNECT_DELAY_MS = 30_000;

export function hermesDashboardSdk(): DashboardPluginSdk {
  const sdk = (window as HermesWindow).__HERMES_PLUGIN_SDK__;
  if (!sdk?.buildWsUrl) {
    throw new Error('LiquidAIty must run as a Hermes web-dashboard plugin.');
  }
  return sdk;
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
  const connecting = hermesDashboardSdk().buildWsUrl('/api/ws', {
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
  return hermesDashboardSdk().buildWsUrl('/api/pty', { ...params, profile });
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
