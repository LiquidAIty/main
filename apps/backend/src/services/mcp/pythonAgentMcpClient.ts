// @graph entity: PythonAgentMcpClient
// @graph role: harness-mcp-client-to-python-agent-host
//
// THE backend MCP client for the one supervised Python Agent MCP host.
// Saved-Card adapters call agent capabilities through this MCP boundary —
// never by spawning another host. One lazy authenticated HTTP connection
// (official @modelcontextprotocol/sdk client); a dead transport is honestly
// re-created on the NEXT call — a failed call itself is never retried.

import path from 'node:path';
import { existsSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  createInternalMcpBearer,
  resolveInternalMcpUrl,
  type InternalMcpPrincipal,
} from './internalMcpAuth';

function firstExisting(candidates: string[], kind: string): string {
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`python_agent_mcp_${kind}_not_found: checked ${candidates.join(' | ')}`);
}

export function resolvePythonAgentMcpCommand(): string {
  const fromEnv = String(process.env.MAIN_MCP_PYTHON || '').trim();
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  return firstExisting(
    [
      path.resolve(process.cwd(), 'apps/python-models/.venv/Scripts/python.exe'),
      path.resolve(process.cwd(), '../../apps/python-models/.venv/Scripts/python.exe'),
    ],
    'python',
  );
}

export function resolvePythonAgentMcpHostPath(): string {
  const fromEnv = String(process.env.MAIN_MCP_HOST || '').trim();
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  return firstExisting(
    [
      path.resolve(process.cwd(), 'apps/python-models/app/mcp_host.py'),
      path.resolve(process.cwd(), '../../apps/python-models/app/mcp_host.py'),
    ],
    'host',
  );
}

let clientPromise: Promise<Client> | null = null;

const OPTIONAL_CATALOG_PROBE_TIMEOUT_MS = 500;
const OPTIONAL_CATALOG_FAMILIES = new Set(['cbm', 'graphiti']);

function authorizedOptionalCatalogFamilies(principal: InternalMcpPrincipal): Set<string> | null {
  if (principal.kind === 'catalog-reader') return null;
  const toolFamilies = principal.grantedTools
    .map((name) => String(name || '').trim().split('.', 1)[0])
    .filter((family) => OPTIONAL_CATALOG_FAMILIES.has(family));
  const connectionFamilies = principal.kind === 'materializer-read'
    ? (principal.grantedConnections ?? [])
      .map((name) => String(name || '').trim())
      .filter((family) => OPTIONAL_CATALOG_FAMILIES.has(family))
    : [];
  return new Set([...toolFamilies, ...connectionFamilies]);
}

async function connect(
  principal: InternalMcpPrincipal,
  sharedLifecycle = false,
): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL(resolveInternalMcpUrl()), {
    requestInit: {
      headers: {
        Authorization: `Bearer ${createInternalMcpBearer(principal)}`,
      },
    },
  });
  const client = new Client({ name: 'main-harness', version: '0.1.0' });
  if (sharedLifecycle) {
    client.onclose = () => {
      // Honest teardown: the NEXT call re-connects lazily; no in-flight retry.
      clientPromise = null;
    };
  }
  await client.connect(transport);
  return client;
}

function getClient(): Promise<Client> {
  if (!clientPromise) {
    clientPromise = connect({ kind: 'catalog-reader' }, true).catch((error) => {
      clientPromise = null;
      throw error;
    });
  }
  return clientPromise;
}

/** Close the one backend-owned client connection to the supervised MCP host. */
export async function closePythonAgentMcpClient(): Promise<void> {
  const pending = clientPromise;
  clientPromise = null;
  if (!pending) return;
  const client = await pending;
  await client.close();
}

export type PythonMcpToolResult = { ok: boolean; [key: string]: unknown };

export type PythonMcpToolDescriptor = {
  name: string;
  title?: string;
  description?: string;
  sourceId: string;
  namespace: string;
  providerToolName: string;
  connectionKind: string;
  publication: 'private-runtime' | 'external-mcp';
  access: 'read' | 'write';
  available: boolean;
  grantEligible: boolean;
  requiredCallerRuntimeKind?: 'hermes';
  requiredCallerRuntimeMode?: 'main' | 'delegate' | 'magentic_one';
  inputSchema: Record<string, unknown>;
  canonicalInputSchema: Record<string, unknown>;
  serverInjectedArguments: string[];
  dispatcherContextArguments: string[];
  dispatcherOwner: string;
  authenticatedProjection: boolean;
  outputSchema?: Record<string, unknown>;
  annotations?: Record<string, unknown>;
  securitySchemes?: Record<string, unknown>[];
};

export type PythonMcpCatalogRead =
  | {
    state: 'available';
    tools: PythonMcpToolDescriptor[];
    unavailableFamilies: string[];
    toolFailures: Record<string, string>;
  }
  | {
    state: 'unavailable';
    tools: [];
    unavailableFamilies: string[];
    toolFailures: Record<string, string>;
    reason: 'catalog_unavailable';
  };

/** The one supervised official Python MCP host used by every saved-Card adapter. */
export function resolvePythonAgentMcpServerSpec(
  principal: InternalMcpPrincipal = { kind: 'catalog-reader' },
  env: NodeJS.ProcessEnv = process.env,
): {
  type: 'http'; url: string; headers: Record<string, string>;
} {
  return {
    type: 'http',
    url: resolveInternalMcpUrl(env),
    headers: {
      Authorization: `Bearer ${createInternalMcpBearer(principal, env)}`,
    },
  };
}

/** Call one tool on the Python Agent MCP host and parse its JSON text result. */
export async function callPythonAgentMcpTool(
  name: string,
  args: Record<string, unknown>,
): Promise<PythonMcpToolResult> {
  const client = await getClient();
  const result = await client.callTool({ name, arguments: args });
  const content = Array.isArray(result?.content) ? result.content : [];
  const text = String((content[0] as { text?: unknown })?.text ?? '').trim();
  if (!text) throw new Error(`python_agent_mcp_empty_result: ${name}`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    if (result.isError) {
      return { ok: false, error: text };
    }
    throw new Error(`python_agent_mcp_invalid_json_result: ${name}`);
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`python_agent_mcp_invalid_result: ${name}`);
  }
  return parsed as PythonMcpToolResult;
}

function parsePythonMcpTool(tool: any): PythonMcpToolDescriptor {
      const metadata = (tool._meta || {}) as Record<string, unknown>;
      const source = metadata.liquidaitySource;
      if (!source || typeof source !== 'object' || Array.isArray(source)) {
        throw new Error(`python_agent_mcp_source_metadata_missing: ${tool.name}`);
      }
      const providerSource = source as Record<string, unknown>;
      const sourceId = String(providerSource.sourceId || '').trim();
      const namespace = String(providerSource.namespace || '').trim();
      const providerToolName = String(providerSource.providerToolName || '').trim();
      const connectionKind = String(providerSource.connectionKind || '').trim();
      const publication = String(providerSource.publication || '').trim();
      const access = String(
        providerSource.access || metadata.liquidaityAccess || '',
      ).trim();
      const available = providerSource.available;
      const grantEligible = providerSource.grantEligible;
      const canonicalInputSchema = providerSource.canonicalInputSchema;
      const serverInjectedArguments = providerSource.serverInjectedArguments;
      const dispatcherContextArguments = providerSource.dispatcherContextArguments;
      const dispatcherOwner = String(providerSource.dispatcherOwner || '').trim();
      const authenticatedProjection = providerSource.authenticatedProjection;
      const requiredCallerRuntimeKind = String(
        providerSource.requiredCallerRuntimeKind || '',
      ).trim();
      const requiredCallerRuntimeMode = String(
        providerSource.requiredCallerRuntimeMode || '',
      ).trim();
      if (
        !sourceId
        || !namespace
        || !providerToolName
        || !['private-runtime', 'external-mcp'].includes(connectionKind)
        || publication !== connectionKind
        || !['read', 'write'].includes(access)
        || typeof available !== 'boolean'
        || typeof grantEligible !== 'boolean'
        || !canonicalInputSchema
        || typeof canonicalInputSchema !== 'object'
        || Array.isArray(canonicalInputSchema)
        || !Array.isArray(serverInjectedArguments)
        || serverInjectedArguments.some((field) => typeof field !== 'string' || !field)
        || !Array.isArray(dispatcherContextArguments)
        || dispatcherContextArguments.some((field) => typeof field !== 'string' || !field)
        || !serverInjectedArguments.every((field) => dispatcherContextArguments.includes(field))
        || !dispatcherOwner
        || typeof authenticatedProjection !== 'boolean'
        || Boolean(requiredCallerRuntimeKind) !== Boolean(requiredCallerRuntimeMode)
        || (requiredCallerRuntimeKind && requiredCallerRuntimeKind !== 'hermes')
        || (
          requiredCallerRuntimeMode
          && !['main', 'delegate', 'magentic_one'].includes(requiredCallerRuntimeMode)
        )
      ) {
        throw new Error(`python_agent_mcp_source_metadata_invalid: ${tool.name}`);
      }
      const raw = tool as typeof tool & {
        outputSchema?: unknown;
        annotations?: unknown;
        securitySchemes?: unknown;
      };
      const securitySchemes = Array.isArray(raw.securitySchemes)
        ? raw.securitySchemes
        : metadata.securitySchemes;
      return {
        name: tool.name,
        ...(tool.title ? { title: tool.title } : {}),
        ...(tool.description ? { description: tool.description } : {}),
        sourceId,
        namespace,
        providerToolName,
        connectionKind,
        publication: publication as 'private-runtime' | 'external-mcp',
        access: access as 'read' | 'write',
        available,
        grantEligible,
        ...(requiredCallerRuntimeKind
          ? {
            requiredCallerRuntimeKind: 'hermes' as const,
            requiredCallerRuntimeMode: requiredCallerRuntimeMode as
              'main' | 'delegate' | 'magentic_one',
          }
          : {}),
        inputSchema: tool.inputSchema as Record<string, unknown>,
        canonicalInputSchema: canonicalInputSchema as Record<string, unknown>,
        serverInjectedArguments: [...serverInjectedArguments] as string[],
        dispatcherContextArguments: [...dispatcherContextArguments] as string[],
        dispatcherOwner,
        authenticatedProjection,
        ...(raw.outputSchema && typeof raw.outputSchema === 'object' && !Array.isArray(raw.outputSchema)
          ? { outputSchema: raw.outputSchema as Record<string, unknown> }
          : {}),
        ...(raw.annotations && typeof raw.annotations === 'object' && !Array.isArray(raw.annotations)
          ? { annotations: raw.annotations as Record<string, unknown> }
          : {}),
        ...(Array.isArray(securitySchemes)
          ? { securitySchemes: securitySchemes as Record<string, unknown>[] }
          : {}),
      };
}

/** Read factual live MCP contracts. Optional failures isolate malformed tools for a Run. */
export async function listPythonAgentMcpCatalog(
  principal: InternalMcpPrincipal = { kind: 'catalog-reader' },
  failures?: Record<string, string>,
): Promise<PythonMcpToolDescriptor[]> {
  const shared = principal.kind === 'catalog-reader';
  const client = shared ? await getClient() : await connect(principal);
  try {
    const result = await client.listTools();
    const tools: PythonMcpToolDescriptor[] = [];
    for (const raw of result.tools || []) {
      try {
        tools.push(parsePythonMcpTool(raw));
      } catch (error) {
        if (!failures) throw error;
        const name = String(raw?.name || '').trim() || `catalog-entry-${tools.length}`;
        failures[name] = error instanceof Error
          ? error.message
          : `python_agent_mcp_contract_invalid:${name}`;
      }
    }
    return tools.sort((left, right) => left.name.localeCompare(right.name));
  } finally {
    if (!shared) await client.close();
  }
}

async function readPythonAgentMcpCatalogProbe(): Promise<{
  ready: boolean;
  unavailableFamilies: string[];
}> {
  const url = new URL(resolveInternalMcpUrl());
  url.pathname = '/health/catalog';
  url.search = '';
  url.hash = '';
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(OPTIONAL_CATALOG_PROBE_TIMEOUT_MS),
    });
    if (!response.ok) return { ready: false, unavailableFamilies: [] };
    const value = await response.json() as Record<string, unknown>;
    const rawFamilies = value.unavailableCatalogFamilies;
    if (
      rawFamilies !== undefined
      && (
        !Array.isArray(rawFamilies)
        || rawFamilies.some((family) => (
          typeof family !== 'string'
          || !/^[a-z][a-z0-9_-]*$/.test(family)
          || !OPTIONAL_CATALOG_FAMILIES.has(family)
        ))
      )
    ) {
      return { ready: false, unavailableFamilies: [] };
    }
    return {
      ready: value.catalogState === 'ready',
      unavailableFamilies: [...new Set((rawFamilies || []) as string[])],
    };
  } catch {
    return { ready: false, unavailableFamilies: [] };
  }
}

/**
 * Read the optional live external-tool list without erasing a dependency failure.
 *
 * Saved Card preparation passes this state to Python so unavailable external
 * catalog families remain visible as unavailable grants while Card-local
 * conversation and private-runtime tools can continue.
 */
export async function readPythonAgentMcpCatalog(
  principal: InternalMcpPrincipal = { kind: 'catalog-reader' },
): Promise<PythonMcpCatalogRead> {
  let unavailableFamilies: string[] = [];
  const toolFailures: Record<string, string> = {};
  try {
    if (principal.kind === 'catalog-reader') {
      const initialProbe = await readPythonAgentMcpCatalogProbe();
      unavailableFamilies = initialProbe.unavailableFamilies;
      if (!initialProbe.ready) throw new Error('catalog_unavailable');
    }
    const tools = await listPythonAgentMcpCatalog(principal, toolFailures);
    if (principal.kind !== 'catalog-reader') {
      const probe = await readPythonAgentMcpCatalogProbe();
      const authorizedFamilies = authorizedOptionalCatalogFamilies(principal)!;
      unavailableFamilies = probe.unavailableFamilies.filter((family) => (
        authorizedFamilies.has(family)
      ));
      if (!probe.ready) throw new Error('catalog_unavailable');
    }
    return {
      state: 'available',
      tools,
      unavailableFamilies,
      toolFailures,
    };
  } catch {
    return {
      state: 'unavailable',
      tools: [],
      unavailableFamilies,
      toolFailures,
      reason: 'catalog_unavailable',
    };
  }
}

/** List only names for runtime grant validation, derived from the same catalog. */
export async function listPythonAgentMcpTools(): Promise<string[]> {
  return (await listPythonAgentMcpCatalog()).map((tool) => tool.name);
}
