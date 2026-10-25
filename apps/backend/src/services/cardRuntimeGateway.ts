/**
 * Entity: Card Runtime Transport
 * Relationship: This file is the sole application boundary for the external Card runtime connection, exact protocol literals, and terminal socket creation.
 * Entity: Credentials
 * Relationship: This file validates the configured external origin and injects its session token only into authenticated loopback connections.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { tsImport } from 'tsx/esm/api';
import WebSocket from 'ws';
import { resolveRepoRoot } from './workingDirectories';

export type CardRuntimeEvent = {
  type: string;
  session_id?: string;
  seq?: number;
  payload?: Record<string, unknown>;
};

export type CardRuntimeClient = {
  readonly connectionState: string;
  connect(url: string): Promise<void>;
  close(): void;
  request<T>(
    method: string,
    params?: Record<string, unknown>,
    timeoutMs?: number,
    signal?: AbortSignal,
  ): Promise<T>;
  onEvent(handler: (event: CardRuntimeEvent) => void): () => void;
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

// This is the sole application-owned declaration of exact external runtime identifiers.
// Product code imports these as opaque transport contracts and uses Card/agent vocabulary.
export const CARD_RUNTIME_CONTRACT = Object.freeze({
  kind: 'hermes' as const,
  messageSessionTitle: 'Bot Chat',
  profileMarkerKey: 'hermes-bots',
  profileRosterField: 'bot_mode_roster',
  profileHeader: 'X-LiquidAIty-Hermes-Profile',
});

let connectedClient: CardRuntimeClient | null = null;
let connecting: {
  generation: number;
  client: CardRuntimeClient | null;
  promise: Promise<CardRuntimeClient>;
} | null = null;
let connectionGeneration = 0;
let connectedOrigin = '';
let closeTicketBridges: (() => void) | null = null;

function terminalSessionToken(env: NodeJS.ProcessEnv = process.env): string {
  const token = String(env.HERMES_DASHBOARD_SESSION_TOKEN || '').trim();
  if (
    token.length !== 64
    || [...token.toLowerCase()].some((character) => !'0123456789abcdef'.includes(character))
  ) throw new Error('card_terminal_gateway_credential_missing');
  return token;
}

async function newGatewayConnection(): Promise<{
  client: CardRuntimeClient;
  origin: string;
  url: string;
}> {
  const repoRoot = resolveRepoRoot();
  const hermesRoot = path.join(repoRoot, 'HermesLatest');
  const python = path.join(
    hermesRoot,
    '.venv',
    process.platform === 'win32' ? 'Scripts' : 'bin',
    process.platform === 'win32' ? 'python.exe' : 'python',
  );
  const profileRoot = path.join(hermesRoot, '.hermes');
  const clientSource = path.join(hermesRoot, 'apps', 'desktop', 'src', 'api', 'client.ts');
  const localGatewaySource = path.join(hermesRoot, 'apps', 'desktop', 'electron', 'local-gateway.ts');
  const ticketSource = path.join(
    hermesRoot,
    'apps',
    'desktop',
    'electron',
    'local-gateway-python.ts',
  );
  if (
    !existsSync(python)
    || !existsSync(path.join(profileRoot, 'config.yaml'))
    || !existsSync(clientSource)
    || !existsSync(localGatewaySource)
    || !existsSync(ticketSource)
  ) throw new Error('card_runtime_gateway_client_missing');
  const [clientModule, localGateway, ticketModule] = await Promise.all([
    tsImport(pathToFileURL(clientSource).href, pathToFileURL(__filename).href),
    tsImport(pathToFileURL(localGatewaySource).href, pathToFileURL(__filename).href),
    tsImport(pathToFileURL(ticketSource).href, pathToFileURL(__filename).href),
  ]) as Array<Record<string, any>>;
  if (
    typeof clientModule.HermesGateway !== 'function'
    || typeof localGateway.ensureLocalGateway !== 'function'
    || typeof localGateway.runGatewayEnsure !== 'function'
    || typeof localGateway.createLocalGatewayDials !== 'function'
    || typeof ticketModule.createGatewayTicketResolver !== 'function'
  ) throw new Error('card_runtime_gateway_client_invalid');
  const runtime = {
    command: python,
    args: ['-m', 'hermes_cli.main', '-p', 'default', 'gateway', 'ensure', '--json'],
    kind: 'python',
    shell: false,
    env: { PYTHONPATH: hermesRoot },
  };
  const descriptor = await localGateway.ensureLocalGateway(() => (
    localGateway.runGatewayEnsure(runtime, hermesRoot, profileRoot)
  ));
  const endpoint = descriptor.gatewayEndpoint;
  if (!endpoint || typeof endpoint.api_origin !== 'string') {
    throw new Error('card_runtime_gateway_owner_unavailable');
  }
  const ticketResolver = ticketModule.createGatewayTicketResolver(
    async () => runtime,
    () => hermesRoot,
  );
  const ticket = await ticketResolver(endpoint, 'interactive');
  const url = localGateway.createLocalGatewayDials().prepare(endpoint.api_origin, ticket, 0);
  closeTicketBridges = typeof ticketModule.closeGatewayTicketBridges === 'function'
    ? ticketModule.closeGatewayTicketBridges
    : null;
  const client = new clientModule.HermesGateway() as CardRuntimeClient;
  return { client, origin: endpoint.api_origin, url };
}

export async function cardRuntimeGateway(): Promise<CardRuntimeClient> {
  if (connectedClient?.connectionState === 'open') return connectedClient;
  if (connecting) return connecting.promise;
  const generation = connectionGeneration;
  const attempt = {
    generation,
    client: null as CardRuntimeClient | null,
    promise: null as unknown as Promise<CardRuntimeClient>,
  };
  attempt.promise = (async () => {
    let cancelReady: () => void = () => undefined;
    let client: CardRuntimeClient | null = null;
    try {
      const connection = await newGatewayConnection();
      client = connection.client;
      attempt.client = client;
      if (generation !== connectionGeneration) {
        throw new Error('card_runtime_gateway_closed_during_connect');
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
          reject(new Error('card_runtime_gateway_ready_timeout'));
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
          reject(new Error(`card_runtime_gateway_${state}_before_ready`));
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
      await client.connect(connection.url);
      const readinessError = await readyOutcome;
      if (readinessError) throw readinessError;
      if (generation !== connectionGeneration) {
        throw new Error('card_runtime_gateway_closed_during_connect');
      }
      connectedClient = client;
      connectedOrigin = connection.origin;
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

export function closeCardRuntimeGateway(): void {
  connectionGeneration += 1;
  connecting?.client?.close();
  connectedClient?.close();
  connectedClient = null;
  connectedOrigin = '';
  closeTicketBridges?.();
  closeTicketBridges = null;
  if (connecting?.generation !== connectionGeneration) connecting = null;
}

export function openCardTerminalSocket(query: URLSearchParams): WebSocket {
  if (!connectedOrigin) throw new Error('card_terminal_gateway_unavailable');
  const url = new URL(connectedOrigin);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = '/api/pty';
  for (const [name, value] of query) url.searchParams.set(name, value);
  url.searchParams.set('token', terminalSessionToken());
  url.hash = '';
  return new WebSocket(url, { maxPayload: 256 * 1024 });
}
