// @graph entity: ToolCatalogMcpClient
// @graph role: backend-client-to-canonical-mcp-catalog
//
// The backend client for the one supervised Python MCP host. It reads the
// authenticated canonical tool catalog and never executes a Card or tool.
// One lazy authenticated HTTP connection
// (official @modelcontextprotocol/sdk client); a dead transport is honestly
// re-created on the NEXT call — a failed call itself is never retried.

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  createInternalMcpBearer,
  resolveInternalMcpUrl,
  type InternalMcpPrincipal,
} from './internalMcpAuth';

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
  const client = new Client({ name: 'backend-tool-catalog', version: '0.0.1' });
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
export async function closeToolCatalogMcpClient(): Promise<void> {
  const pending = clientPromise;
  clientPromise = null;
  if (!pending) return;
  const client = await pending;
  await client.close();
}

export type ToolCatalogDescriptor = {
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

export type ToolCatalogRead =
  | {
    state: 'available';
    tools: ToolCatalogDescriptor[];
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

function parseToolCatalogDescriptor(tool: any): ToolCatalogDescriptor {
      const metadata = (tool._meta || {}) as Record<string, unknown>;
      const source = metadata.liquidaitySource;
      if (!source || typeof source !== 'object' || Array.isArray(source)) {
        throw new Error(`tool_catalog_source_metadata_missing: ${tool.name}`);
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
        throw new Error(`tool_catalog_source_metadata_invalid: ${tool.name}`);
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
export async function listToolCatalog(
  principal: InternalMcpPrincipal = { kind: 'catalog-reader' },
  failures?: Record<string, string>,
): Promise<ToolCatalogDescriptor[]> {
  const shared = principal.kind === 'catalog-reader';
  const client = shared ? await getClient() : await connect(principal);
  try {
    const result = await client.listTools();
    const tools: ToolCatalogDescriptor[] = [];
    for (const raw of result.tools || []) {
      try {
        tools.push(parseToolCatalogDescriptor(raw));
      } catch (error) {
        if (!failures) throw error;
        const name = String(raw?.name || '').trim() || `catalog-entry-${tools.length}`;
        failures[name] = error instanceof Error
          ? error.message
          : `tool_catalog_contract_invalid:${name}`;
      }
    }
    return tools.sort((left, right) => left.name.localeCompare(right.name));
  } finally {
    if (!shared) await client.close();
  }
}

async function readToolCatalogReadiness(): Promise<{
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
export async function readToolCatalog(
  principal: InternalMcpPrincipal = { kind: 'catalog-reader' },
): Promise<ToolCatalogRead> {
  let unavailableFamilies: string[] = [];
  const toolFailures: Record<string, string> = {};
  try {
    if (principal.kind === 'catalog-reader') {
      const initialProbe = await readToolCatalogReadiness();
      unavailableFamilies = initialProbe.unavailableFamilies;
      if (!initialProbe.ready) throw new Error('catalog_unavailable');
    }
    const tools = await listToolCatalog(principal, toolFailures);
    if (principal.kind !== 'catalog-reader') {
      const probe = await readToolCatalogReadiness();
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
