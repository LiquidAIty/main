/**
 * Entity: Shared Gateway Connection
 * Relationship: Connects backend callers to the one already-running Hermes Gateway owner through Hermes Desktop's discovery, ticket, and client contracts.
 */

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
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
  request<T>(method: string, params?: Record<string, unknown>): Promise<T>;
  onEvent(handler: (event: CardRuntimeEvent) => void): () => void;
  onState(handler: (state: string) => void): () => void;
  onRequest(handler: (request: {
    id: string;
    method: string;
    params: Record<string, unknown>;
    respond(result: Record<string, unknown>): void;
    fail(code: number, message: string): void;
  }) => boolean | void): () => void;
};

export const CARD_RUNTIME_CONTRACT = Object.freeze({
  kind: 'hermes' as const,
  messageSessionTitle: 'Bot Chat',
  profileMarkerKey: 'hermes-bots',
  profileRosterField: 'bot_mode_roster',
  profileHeader: 'X-LiquidAIty-Hermes-Profile',
});

type GatewayEndpoint = {
  profile_id: string;
  instance_id: string;
  runtime_protocol: number;
  api_origin: string;
  capabilities: string[];
  control_home?: string | null;
};

type SharedConnection = {
  client: CardRuntimeClient;
  endpoint: GatewayEndpoint;
  hermesHome: string;
  resolveTicket: (endpoint: GatewayEndpoint, purpose: 'interactive') => Promise<string>;
  routedTicketEndpoint: (
    endpoint: GatewayEndpoint,
    profile: string,
    launchHome: string,
  ) => Promise<GatewayEndpoint>;
  closeTicketBridge: () => void;
};

const execFileAsync = promisify(execFile);
const DISCOVER = [
  'import json, sys',
  'from dataclasses import asdict',
  'from hermes_cli.gateway_runtime import discover_gateway_endpoint',
  'result = discover_gateway_endpoint(sys.argv[1])',
  "print(json.dumps({'state': result.state, 'endpoint': asdict(result.endpoint) if result.endpoint else None}, default=lambda value: list(value) if isinstance(value, frozenset) else str(value)))",
].join('; ');

let shared: Promise<SharedConnection> | null = null;
let connected: SharedConnection | null = null;

function samePath(left: string, right: string): boolean {
  const first = path.resolve(left);
  const second = path.resolve(right);
  return process.platform === 'win32'
    ? first.toLowerCase() === second.toLowerCase()
    : first === second;
}

function loopbackOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol)
      && ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname);
  } catch {
    return false;
  }
}

async function discoverOwner(
  python: string,
  hermesRoot: string,
  hermesHome: string,
): Promise<GatewayEndpoint> {
  const { stdout } = await execFileAsync(python, ['-P', '-c', DISCOVER, hermesHome], {
    cwd: hermesRoot,
    env: {
      ...process.env,
      HERMES_HOME: hermesHome,
      PYTHONPATH: hermesRoot,
      PYTHONIOENCODING: 'utf-8',
      PYTHONUTF8: '1',
    },
    encoding: 'utf8',
    windowsHide: true,
  });
  const result = JSON.parse(String(stdout || '').trim()) as {
    state?: unknown;
    endpoint?: Partial<GatewayEndpoint>;
  };
  const endpoint = result.endpoint;
  if (
    result.state !== 'ready'
    || !endpoint
    || typeof endpoint.profile_id !== 'string'
    || !samePath(endpoint.profile_id, hermesHome)
    || typeof endpoint.instance_id !== 'string'
    || !endpoint.instance_id
    || endpoint.runtime_protocol !== 1
    || typeof endpoint.api_origin !== 'string'
    || !loopbackOrigin(endpoint.api_origin)
    || !Array.isArray(endpoint.capabilities)
    || !endpoint.capabilities.includes('session-authority-v1')
  ) throw new Error('card_runtime_gateway_owner_unavailable');
  return endpoint as GatewayEndpoint;
}

async function connectSharedOwner(): Promise<SharedConnection> {
  const repoRoot = resolveRepoRoot();
  const hermesRoot = path.join(repoRoot, 'HermesLatest');
  const hermesHome = path.join(hermesRoot, '.hermes');
  const python = path.join(
    hermesRoot,
    '.venv',
    process.platform === 'win32' ? 'Scripts' : 'bin',
    process.platform === 'win32' ? 'python.exe' : 'python',
  );
  const clientPath = path.join(hermesRoot, 'apps', 'desktop', 'src', 'api', 'client.ts');
  const dialPath = path.join(hermesRoot, 'apps', 'desktop', 'electron', 'local-gateway.ts');
  const ticketPath = path.join(
    hermesRoot,
    'apps',
    'desktop',
    'electron',
    'local-gateway-python.ts',
  );
  if (
    !existsSync(python)
    || !existsSync(path.join(hermesHome, 'config.yaml'))
    || !existsSync(clientPath)
    || !existsSync(dialPath)
    || !existsSync(ticketPath)
  ) throw new Error('card_runtime_gateway_client_missing');

  const [clientModule, dialModule, ticketModule] = await Promise.all([
    tsImport(pathToFileURL(clientPath).href, pathToFileURL(__filename).href),
    tsImport(pathToFileURL(dialPath).href, pathToFileURL(__filename).href),
    tsImport(pathToFileURL(ticketPath).href, pathToFileURL(__filename).href),
  ]) as Array<Record<string, any>>;
  if (
    typeof clientModule.HermesGateway !== 'function'
    || typeof dialModule.createLocalGatewayDials !== 'function'
    || typeof dialModule.routedTicketEndpoint !== 'function'
    || typeof ticketModule.createGatewayTicketResolver !== 'function'
    || typeof ticketModule.closeGatewayTicketBridges !== 'function'
  ) throw new Error('card_runtime_gateway_client_invalid');

  const endpoint = await discoverOwner(python, hermesRoot, hermesHome);
  const resolveTicket = ticketModule.createGatewayTicketResolver(
    async () => ({
      command: python,
      args: [],
      kind: 'python',
      shell: false,
      env: { PYTHONPATH: hermesRoot },
    }),
    () => hermesRoot,
  );
  const ticket = await resolveTicket(endpoint, 'interactive');
  const url = dialModule.createLocalGatewayDials().prepare(endpoint.api_origin, ticket, 0);
  const client = new clientModule.HermesGateway() as CardRuntimeClient;
  client.onRequest((request) => {
    request.fail(-32601, `Unsupported application request: ${request.method}`);
    return true;
  });
  await client.connect(url);

  const current = {
    client,
    endpoint,
    hermesHome,
    resolveTicket,
    routedTicketEndpoint: dialModule.routedTicketEndpoint,
    closeTicketBridge: ticketModule.closeGatewayTicketBridges,
  };
  client.onState((state) => {
    if ((state === 'closed' || state === 'error') && connected === current) {
      connected = null;
      shared = null;
    }
  });
  return current;
}

export async function cardRuntimeGateway(): Promise<CardRuntimeClient> {
  return (await connectAndRemember()).client;
}

export async function openCardTerminalSocket(profile: string, sessionId: string): Promise<WebSocket> {
  const current = await connectAndRemember();
  const endpoint = await current.routedTicketEndpoint(
    current.endpoint,
    profile,
    current.hermesHome,
  );
  const ticket = await current.resolveTicket(endpoint, 'interactive');
  const url = new URL('/api/pty', endpoint.api_origin);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('profile', profile);
  url.searchParams.set('resume', sessionId);
  return new WebSocket(url, [
    'hermes-gateway-v1',
    `hermes-gateway-ticket.${ticket}`,
  ], { maxPayload: 256 * 1024 });
}

async function connectAndRemember(): Promise<SharedConnection> {
  if (!shared) {
    shared = connectSharedOwner()
      .then((current) => {
        connected = current;
        return current;
      })
      .catch((error) => {
        connected = null;
        shared = null;
        throw error;
      });
  }
  const current = await shared;
  if (current.client.connectionState !== 'open') {
    connected = null;
    shared = null;
    throw new Error('card_runtime_gateway_connection_closed');
  }
  return current;
}

export function closeCardRuntimeGateway(): void {
  const closing = shared;
  shared = null;
  connected = null;
  void closing?.then(({ client, closeTicketBridge }) => {
    client.close();
    closeTicketBridge();
  }).catch(() => undefined);
}
