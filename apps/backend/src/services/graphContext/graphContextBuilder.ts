import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { pool } from '../../db/pool';
import { loadMcpServersConfig } from '../../agents/mcp/mcpConfig';
import { runCypherOnGraph } from '../graphService';
import {
  compareThinkAndKnowContext,
  createEmptyGraphContextPacket,
  mergeSelectedContextPacket,
  type CodeGraphContextPacket,
  type GraphContextConfidenceLevel,
  type GraphContextPacket,
  type GraphContextSourceDiagnostic,
  type KnowGraphContextPacket,
  type ThinkGraphContextPacket,
} from './graphContextPacket';

const THINKGRAPH_GRAPH_NAME = 'graph_liq';
const DEFAULT_MAX_ITEMS = 12;

type GraphContextStreamResult<T> = {
  data: T;
  debugNotes?: string[];
  sourceLabels?: string[];
};

type ThinkGraphNodeRow = {
  node_id?: unknown;
  node_name?: unknown;
  node_type?: unknown;
  node_props?: unknown;
};

type ThinkGraphRelationRow = {
  a_id?: unknown;
  a_name?: unknown;
  a_type?: unknown;
  a_props?: unknown;
  r_id?: unknown;
  r_type?: unknown;
  r_props?: unknown;
  b_id?: unknown;
  b_name?: unknown;
  b_type?: unknown;
  b_props?: unknown;
};

export type BuildGraphContextPacketArgs = {
  projectId: string;
  repoPath?: string | null;
  userMessage?: string | null;
  selectedBoardNodeIds?: string[];
  selectedGraphNodeIds?: string[];
  planDraft?: unknown;
  maxItems?: number;
  requestId?: string | null;
  turnId?: string | null;
};

type CbmToolCaller = (tool: string, args: Record<string, unknown>) => Promise<Record<string, any>>;

type CbmBoundaryDeps = {
  callTool?: CbmToolCaller;
  now?: () => string;
};

export type GraphContextBuilderDeps = {
  now?: () => string;
  clock?: () => number;
  sourceTimeoutMs?: Partial<Record<GraphContextSourceDiagnostic['source'], number>>;
  readThinkGraphContext?: (
    args: BuildGraphContextPacketArgs,
  ) => Promise<GraphContextStreamResult<ThinkGraphContextPacket>>;
  readKnowGraphContext?: (
    args: BuildGraphContextPacketArgs,
  ) => Promise<GraphContextStreamResult<KnowGraphContextPacket>>;
  readCodeGraphContext?: (
    args: BuildGraphContextPacketArgs,
  ) => Promise<GraphContextStreamResult<CodeGraphContextPacket | null>>;
};

const GRAPH_SOURCE_TIMEOUT_MS: Record<GraphContextSourceDiagnostic['source'], number> = {
  graph_thinkgraph: 5_000,
  knowgraph: 5_000,
  codegraph_cbm: 20_000,
};

function clampMaxItems(value: unknown): number {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_MAX_ITEMS;
  return Math.max(1, Math.min(50, parsed));
}

function mapConfidenceLevel(value: unknown): GraphContextConfidenceLevel | null {
  if (typeof value === 'number') {
    if (value >= 0.8) return 'high';
    if (value >= 0.5) return 'medium';
    if (value >= 0) return 'low';
    return 'unknown';
  }

  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === 'high' || normalized === 'medium' || normalized === 'low' || normalized === 'unknown') {
    return normalized;
  }
  const numeric = Number.parseFloat(normalized);
  if (Number.isFinite(numeric)) {
    return mapConfidenceLevel(numeric);
  }
  return 'unknown';
}

function dedupeStrings(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  values.forEach((value) => {
    const normalized = String(value || '').trim();
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    result.push(normalized);
  });
  return result;
}

function pushUnique(target: string[], ...values: Array<string | null | undefined>) {
  for (const value of values) {
    const normalized = String(value || '').trim();
    if (!normalized || target.includes(normalized)) continue;
    target.push(normalized);
  }
}

function inferSourceLabel(url: string | null | undefined, fallback: string | null | undefined): string {
  const fallbackText = String(fallback || '').trim();
  if (fallbackText) return fallbackText;
  const urlText = String(url || '').trim();
  if (!urlText) return 'Unknown source';
  try {
    return new URL(urlText).hostname.replace(/^www\./i, '') || 'Unknown source';
  } catch {
    return 'Unknown source';
  }
}

function toPlainJson(value: any): any {
  if (value == null) return value;
  if (Array.isArray(value)) return value.map((item) => toPlainJson(item));
  if (typeof value !== 'object') return value;
  if (typeof value.toNumber === 'function') {
    try {
      return value.toNumber();
    } catch {
      // fall through
    }
  }
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    out[key] = toPlainJson(child);
  }
  return out;
}

function asRecord(value: unknown): Record<string, any> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, any>)
    : null;
}

function parseJsonText(value: unknown): Record<string, any> | null {
  if (typeof value !== 'string') return null;
  try {
    return asRecord(JSON.parse(value));
  } catch {
    return null;
  }
}

function normalizeMcpToolResult(value: unknown): Record<string, any> {
  const record = asRecord(value);
  if (!record) return {};
  if (record.structuredContent && typeof record.structuredContent === 'object') {
    return asRecord(record.structuredContent) || {};
  }
  if (Array.isArray(record.content)) {
    for (const block of record.content) {
      const blockRecord = asRecord(block);
      const parsed = parseJsonText(blockRecord?.text);
      if (parsed) return parsed;
    }
  }
  return record;
}

async function withTimeout<T>(label: string, ms: number, fn: () => Promise<T>): Promise<T> {
  let timeoutId: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      fn(),
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(`${label}_timeout_${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function normalizeFsPath(value: unknown): string {
  return path.resolve(String(value ?? '')).replace(/\\/g, '/').toLowerCase();
}

function graphEvidenceCount(source: GraphContextSourceDiagnostic['source'], data: unknown): number {
  const record = asRecord(data);
  if (!record) return 0;
  if (source === 'graph_thinkgraph') {
    return [
      'intent',
      'assumptions',
      'hypotheses',
      'uncertainties',
      'goals',
      'decisions',
      'outcomes',
      'reasoningNotes',
    ].reduce((count, key) => count + (Array.isArray(record[key]) ? record[key].length : 0), 0);
  }
  if (source === 'knowgraph') {
    return ['entities', 'relations', 'evidence', 'sources', 'citations'].reduce(
      (count, key) => count + (Array.isArray(record[key]) ? record[key].length : 0),
      0,
    );
  }
  return ['relevantFiles', 'relevantSymbols', 'codeAnchors'].reduce(
    (count, key) => count + (Array.isArray(record[key]) ? record[key].length : 0),
    0,
  );
}

async function settleGraphSource<T>(args: {
  source: GraphContextSourceDiagnostic['source'];
  critical: boolean;
  timeoutMs: number;
  clock: () => number;
  operation: () => Promise<GraphContextStreamResult<T>>;
}): Promise<{
  result: PromiseSettledResult<GraphContextStreamResult<T>>;
  diagnostic: GraphContextSourceDiagnostic;
}> {
  const startedAt = args.clock();
  let timeoutId: NodeJS.Timeout | null = null;
  try {
    const value = await Promise.race([
      args.operation(),
      new Promise<GraphContextStreamResult<T>>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error(`source_timeout:${args.source}:${args.timeoutMs}ms`)),
          args.timeoutMs,
        );
      }),
    ]);
    const evidenceCount = graphEvidenceCount(args.source, value.data);
    const blocker =
      args.source === 'codegraph_cbm'
        ? String(asRecord(value.data)?.blocker || '').trim()
        : '';
    return {
      result: { status: 'fulfilled', value },
      diagnostic: {
        source: args.source,
        critical: args.critical,
        status: blocker ? 'blocked' : evidenceCount > 0 ? 'ok' : 'empty',
        elapsedMs: Math.max(0, Math.round(args.clock() - startedAt)),
        evidenceCount,
        summary: blocker || `${args.source} returned ${evidenceCount} evidence item(s)`,
        blocker,
      },
    };
  } catch (error) {
    const blocker = error instanceof Error ? error.message : String(error);
    return {
      result: { status: 'rejected', reason: error },
      diagnostic: {
        source: args.source,
        critical: args.critical,
        status: blocker.startsWith('source_timeout:') ? 'timed_out' : 'failed',
        elapsedMs: Math.max(0, Math.round(args.clock() - startedAt)),
        evidenceCount: 0,
        summary: blocker,
        blocker,
      },
    };
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function createCodebaseMemoryMcpCaller(
  repoPath: string,
): Promise<{ callTool: CbmToolCaller; close: () => Promise<void> }> {
  const config = loadMcpServersConfig();
  const server = config['codebase-memory'] as
    | { transport?: 'stdio'; command?: string; args?: string[] }
    | undefined;
  if (!server?.command) {
    throw new Error('cbm_mcp_config_missing: codebase-memory stdio command not configured');
  }
  if (server.transport && server.transport !== 'stdio') {
    throw new Error(`cbm_mcp_transport_unsupported: ${server.transport}`);
  }

  const client = new Client({ name: 'liquidaity-codegraph-context', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: server.command,
    args: server.args || [],
    cwd: repoPath,
    stderr: 'pipe',
  });
  await withTimeout('cbm_mcp_connect', 15_000, () => client.connect(transport));
  return {
    callTool: async (tool, args) => {
      const result = await withTimeout('cbm_mcp_call', 30_000, () =>
        client.request(
          {
            method: 'tools/call',
            params: { name: tool, arguments: args },
          },
          CallToolResultSchema,
        ),
      );
      if (result.isError) {
        throw new Error(`cbm_tool_failed: ${tool}`);
      }
      return normalizeMcpToolResult(result);
    },
    close: () => transport.close().catch(() => undefined),
  };
}

function unavailableCodeGraphContext(
  checkedAt: string,
  blocker: string,
  queries: string[] = [],
): GraphContextStreamResult<CodeGraphContextPacket> {
  return {
    data: {
      relevantFiles: [],
      relevantSymbols: [],
      codeAnchors: [],
      cbmQueries: queries,
      components: [],
      routes: [],
      schemas: [],
      tools: [],
      agentCards: [],
      promptTemplates: [],
      implementationNotes: [blocker],
      freshness: {
        status: 'unavailable',
        project: null,
        nodes: null,
        edges: null,
        checkedAt,
        detail: blocker,
      },
      blocker,
    },
    sourceLabels: ['CodeGraph/Codebase Memory MCP'],
    debugNotes: [blocker],
  };
}

export async function readCodeGraphContextFromCbm(
  args: BuildGraphContextPacketArgs,
  deps: CbmBoundaryDeps = {},
): Promise<GraphContextStreamResult<CodeGraphContextPacket>> {
  const checkedAt = (deps.now ?? (() => new Date().toISOString()))();
  const repoPath = path.resolve(args.repoPath || process.cwd());
  const query = String(args.userMessage || '').trim();
  const queries = query ? [`search_graph query="${query.replace(/"/g, "'")}"`] : [];
  if (!query) {
    return unavailableCodeGraphContext(checkedAt, 'cbm_query_terms_required', queries);
  }

  let session: Awaited<ReturnType<typeof createCodebaseMemoryMcpCaller>> | null = null;
  try {
    session = deps.callTool ? null : await createCodebaseMemoryMcpCaller(repoPath);
    const callTool = deps.callTool ?? session!.callTool;
    const projectList = await callTool('list_projects', {});
    const projects = Array.isArray(projectList.projects) ? projectList.projects : [];
    const project = projects
      .map(asRecord)
      .find((candidate) => normalizeFsPath(candidate?.root_path) === normalizeFsPath(repoPath));
    const projectName = String(project?.name || '').trim();
    if (!projectName) {
      return unavailableCodeGraphContext(
        checkedAt,
        `cbm_project_not_indexed: ${repoPath}`,
        queries,
      );
    }

    const [status, search, changes] = await Promise.all([
      callTool('index_status', { project: projectName }),
      callTool('search_graph', {
        project: projectName,
        query,
        limit: clampMaxItems(args.maxItems),
      }),
      callTool('detect_changes', { project: projectName, depth: 1 }),
    ]);
    const results = Array.isArray(search.results) ? search.results.map(asRecord).filter(Boolean) : [];
    const relevantFiles = dedupeStrings(results.map((result) => String(result?.file_path || '')));
    const relevantSymbols = dedupeStrings(
      results.map((result) => String(result?.qualified_name || result?.name || '')),
    );
    const changedCount = Number(changes.changed_count || 0);
    const statusReady = String(status.status || '').toLowerCase() === 'ready';
    const freshnessStatus = !statusReady ? 'unavailable' : changedCount > 0 ? 'stale' : 'fresh';
    const freshnessDetail = !statusReady
      ? `cbm_index_not_ready: ${String(status.status || 'unknown')}`
      : changedCount > 0
        ? `cbm_freshness_unverified: ${changedCount} tracked working-tree file(s) differ from HEAD and index_status exposes no indexed revision`
        : 'cbm_fresh: indexed graph matches tracked HEAD changes';
    const evidenceBlocker =
      relevantFiles.length === 0 || relevantSymbols.length === 0
        ? `cbm_no_matching_code_evidence: ${query}`
        : null;
    const blocker = freshnessStatus === 'fresh' ? evidenceBlocker : freshnessDetail;

    return {
      data: {
        relevantFiles,
        relevantSymbols,
        codeAnchors: relevantFiles,
        cbmQueries: queries,
        components: dedupeStrings(
          results
            .filter((result) => ['Function', 'Method', 'Class', 'Interface'].includes(String(result?.label)))
            .map((result) => String(result?.name || '')),
        ),
        routes: dedupeStrings(
          results
            .filter((result) => String(result?.label) === 'Route')
            .map((result) => String(result?.name || '')),
        ),
        schemas: dedupeStrings(
          results
            .filter((result) => ['Type', 'Interface'].includes(String(result?.label)))
            .map((result) => String(result?.name || '')),
        ),
        tools: ['list_projects', 'index_status', 'search_graph', 'detect_changes'],
        agentCards: [],
        promptTemplates: [],
        implementationNotes: [
          `CodeGraph context returned ${relevantFiles.length} file(s) and ${relevantSymbols.length} symbol(s).`,
          freshnessDetail,
          ...(evidenceBlocker ? [evidenceBlocker] : []),
        ],
        freshness: {
          status: freshnessStatus,
          project: projectName,
          nodes: Number.isFinite(Number(status.nodes)) ? Number(status.nodes) : null,
          edges: Number.isFinite(Number(status.edges)) ? Number(status.edges) : null,
          checkedAt,
          detail: freshnessDetail,
        },
        blocker,
      },
      sourceLabels: ['CodeGraph/Codebase Memory MCP'],
      debugNotes: blocker ? [blocker] : [],
    };
  } catch (error) {
    return unavailableCodeGraphContext(
      checkedAt,
      `cbm_unavailable: ${error instanceof Error ? error.message : String(error)}`,
      queries,
    );
  } finally {
    await session?.close();
  }
}

function asAgeRowObject<T extends Record<string, any>>(raw: unknown): T | null {
  const parsed =
    typeof raw === 'string'
      ? (() => {
          try {
            return JSON.parse(raw);
          } catch {
            return null;
          }
        })()
      : raw;
  if (!parsed || typeof parsed !== 'object') return null;
  if ((parsed as any).row && typeof (parsed as any).row === 'object') {
    return (parsed as any).row as T;
  }
  return parsed as T;
}

async function resolveProjectScopeIds(projectId: string): Promise<string[]> {
  const seed = String(projectId || '').trim();
  if (!seed) return [];

  const scopeIds = new Set<string>([seed]);
  try {
    const result = await pool.query(
      `
        SELECT
          id::text AS id,
          coalesce(name, '') AS name,
          coalesce(code, '') AS code
        FROM ag_catalog.projects
        WHERE id::text = $1
           OR lower(coalesce(name, '')) = lower($1)
           OR lower(coalesce(code, '')) = lower($1)
        LIMIT 1
      `,
      [seed],
    );
    const row = result?.rows?.[0] as { id?: string; name?: string; code?: string } | undefined;
    if (!row) return Array.from(scopeIds);
    for (const rawValue of [row.id, row.name, row.code]) {
      const value = String(rawValue || '').trim();
      if (value) scopeIds.add(value);
    }
  } catch (error: any) {
    console.warn('[graph-context] project alias resolution failed', error?.message || error);
  }
  return Array.from(scopeIds);
}

async function readKnowGraphContextFromNeo4j(
  args: BuildGraphContextPacketArgs,
): Promise<GraphContextStreamResult<KnowGraphContextPacket>> {
  const uri = String(process.env.NEO4J_URI || '').trim();
  const user = String(process.env.NEO4J_USER || '').trim();
  const password = String(process.env.NEO4J_PASSWORD || '').trim();
  if (!uri || !user || !password) {
    return {
      data: createEmptyGraphContextPacket().knowGraphContext,
      debugNotes: ['knowgraph_unavailable: neo4j env missing'],
    };
  }

  const projectScopeIds = await resolveProjectScopeIds(args.projectId);
  const maxItems = clampMaxItems(args.maxItems);
  const database = String(process.env.NEO4J_DATABASE || '').trim() || undefined;
  const neo4jModule: any = await import('neo4j-driver');
  const neo4j: any = neo4jModule?.default ?? neo4jModule;
  const driver = neo4j.driver(uri, neo4j.auth.basic(user, password));
  const session = driver.session(database ? { database } : undefined);

  try {
    const nodeResult = await session.run(
      `
        MATCH (n)
        WHERE toString(n.project_id) IN $projectScopeIds
        RETURN DISTINCT
          elementId(n) AS node_id,
          labels(n) AS node_labels,
          properties(n) AS node_props
        ORDER BY coalesce(n.updated_at, n.created_at, '') DESC
        LIMIT toInteger($limit)
      `,
      { projectScopeIds, limit: maxItems },
    );

    const relResult = await session.run(
      `
        MATCH (a)-[r]->(b)
        WHERE toString(a.project_id) IN $projectScopeIds
          AND toString(b.project_id) IN $projectScopeIds
          AND toString(r.project_id) IN $projectScopeIds
        RETURN DISTINCT
          elementId(r) AS rel_id,
          type(r) AS rel_type,
          properties(r) AS rel_props,
          elementId(a) AS from_id,
          elementId(b) AS to_id
        ORDER BY coalesce(r.updated_at, r.created_at, '') DESC
        LIMIT toInteger($limit)
      `,
      { projectScopeIds, limit: maxItems },
    );

    const packet = createEmptyGraphContextPacket().knowGraphContext;
    const sourceIds = new Set<string>();
    const provenanceIds = new Set<string>();
    const evidenceIds = new Set<string>();

    nodeResult.records.forEach((record: any) => {
      const nodeId = String(record.get('node_id') || '').trim();
      if (!nodeId) return;
      const labels = Array.isArray(record.get('node_labels'))
        ? (record.get('node_labels') as string[])
        : [];
      const props = (toPlainJson(record.get('node_props') || {}) || {}) as Record<string, unknown>;
      const label = String(props.name ?? props.title ?? props.label ?? props.id ?? nodeId).trim() || nodeId;
      const type = String(labels[0] || props.type || props.kind || 'NeoEntity').trim() || 'NeoEntity';
      const confidence = mapConfidenceLevel(props.confidence);
      packet.entities.push({
        id: nodeId,
        label,
        type,
        confidence,
      });

      const sourceRefs = Array.isArray(props.sourceRefs) ? props.sourceRefs : [];
      const sourceUrl = String(props.source_url ?? props.url ?? '').trim() || null;
      const sourceLabel = inferSourceLabel(
        sourceUrl || String((sourceRefs[0] as any)?.ref || '').trim() || null,
        String(props.source_title ?? (sourceRefs[0] as any)?.title ?? '').trim() || null,
      );
      const summary = String(
        props.summary ??
          props.description ??
          props.snippet ??
          props.text ??
          props.vectorText ??
          '',
      ).trim();

      if ((summary || sourceUrl || sourceRefs.length > 0) && !evidenceIds.has(nodeId)) {
        evidenceIds.add(nodeId);
        packet.evidence.push({
          id: nodeId,
          title: label,
          snippet: summary || label,
          sourceLabel,
          sourceUrl,
          provenance: String((props.provenance as any)?.reasoningSummary ?? (props.provenance as any)?.createdByAgent ?? '').trim() || null,
          confidence,
          timestamp: String(props.updated_at ?? props.created_at ?? '').trim() || null,
        });
      }

      if (sourceUrl || sourceRefs.length > 0) {
        const sourceId = String((sourceRefs[0] as any)?.id ?? `source:${sourceLabel}:${sourceUrl || nodeId}`).trim();
        if (!sourceIds.has(sourceId)) {
          sourceIds.add(sourceId);
          packet.sources.push({
            id: sourceId,
            label: sourceLabel,
            url: sourceUrl || String((sourceRefs[0] as any)?.ref || '').trim() || null,
            kind: String((sourceRefs[0] as any)?.type || props.source_kind || '').trim() || null,
          });
        }
      }

      const provenanceLabel = String(
        (props.provenance as any)?.reasoningSummary ??
          (props.provenance as any)?.createdByAgent ??
          '',
      ).trim();
      if (provenanceLabel) {
        const provenanceId = `${nodeId}:${provenanceLabel}`;
        if (!provenanceIds.has(provenanceId)) {
          provenanceIds.add(provenanceId);
          packet.provenance.push({
            id: provenanceId,
            label: provenanceLabel,
            sourceId: packet.sources[0]?.id || null,
            confidence,
            timestamp: String((props.provenance as any)?.createdAt ?? props.updated_at ?? props.created_at ?? '').trim() || null,
          });
        }
      }

      pushUnique(packet.confidence, confidence ? `${label}: ${confidence}` : null);
      pushUnique(
        packet.timestamps,
        String(props.updated_at ?? props.created_at ?? '').trim() || null,
      );
    });

    relResult.records.forEach((record: any) => {
      const relId = String(record.get('rel_id') || '').trim();
      const fromId = String(record.get('from_id') || '').trim();
      const toId = String(record.get('to_id') || '').trim();
      if (!relId || !fromId || !toId) return;
      const relProps = (toPlainJson(record.get('rel_props') || {}) || {}) as Record<string, unknown>;
      packet.relations.push({
        fromId,
        toId,
        type: String(record.get('rel_type') || 'RELATED_TO').trim() || 'RELATED_TO',
        confidence: mapConfidenceLevel(relProps.confidence),
      });
      const excerpt = String(relProps.snippet ?? relProps.summary ?? '').trim();
      if (excerpt) {
        packet.citations.push({
          id: relId,
          label: String(record.get('rel_type') || 'RELATED_TO').trim() || 'RELATED_TO',
          excerpt,
        });
      }
    });

    return {
      data: {
        entities: packet.entities.slice(0, maxItems),
        relations: packet.relations.slice(0, maxItems),
        evidence: packet.evidence.slice(0, maxItems),
        sources: packet.sources.slice(0, maxItems),
        citations: packet.citations.slice(0, maxItems),
        provenance: packet.provenance.slice(0, maxItems),
        confidence: packet.confidence.slice(0, maxItems),
        timestamps: packet.timestamps.slice(0, maxItems),
      },
      sourceLabels: ['KnowGraph'],
      debugNotes:
        packet.entities.length > 0 || packet.relations.length > 0
          ? []
          : ['knowgraph_unavailable: no project-scoped records found'],
    };
  } finally {
    await session.close();
    await driver.close();
  }
}

function collectThinkGraphField(
  packet: ThinkGraphContextPacket,
  labelRaw: unknown,
  typeRaw: unknown,
  propsRaw: unknown,
) {
  const label = String(labelRaw ?? '').trim();
  const type = String(typeRaw ?? '').trim().toLowerCase();
  const props = (toPlainJson(propsRaw || {}) || {}) as Record<string, unknown>;
  const summary = String(
    props.summary ??
      props.description ??
      props.reasoning ??
      props.note ??
      props.snippet ??
      '',
  ).trim();
  const candidates = dedupeStrings([label, summary]);
  const typeMatches = (...needles: string[]) => needles.some((needle) => type.includes(needle));

  if (typeMatches('intent')) {
    packet.intent.push(...candidates);
    return;
  }
  if (typeMatches('assumption')) {
    packet.assumptions.push(...candidates);
    return;
  }
  if (typeMatches('hypothesis')) {
    packet.hypotheses.push(...candidates);
    return;
  }
  if (typeMatches('uncert', 'question', 'gap')) {
    packet.uncertainties.push(...candidates);
    return;
  }
  if (typeMatches('goal', 'objective')) {
    packet.goals.push(...candidates);
    return;
  }
  if (typeMatches('decision')) {
    packet.decisions.push(...candidates);
    return;
  }
  if (typeMatches('outcome', 'result')) {
    packet.outcomes.push(...candidates);
    return;
  }
  if (summary) {
    pushUnique(packet.reasoningNotes, summary);
  }
}

async function readThinkGraphContextFromAge(
  args: BuildGraphContextPacketArgs,
): Promise<GraphContextStreamResult<ThinkGraphContextPacket>> {
  const maxItems = clampMaxItems(args.maxItems);
  const packet = createEmptyGraphContextPacket().thinkGraphContext;
  const relationRows = await runCypherOnGraph(
    THINKGRAPH_GRAPH_NAME,
    `
      MATCH (a:Entity { project_id: $projectId })-[r:REL { project_id: $projectId }]->(b:Entity { project_id: $projectId })
      RETURN {
        a_id: id(a),
        a_name: coalesce(a.name, toString(id(a))),
        a_type: coalesce(a.etype, a.type, 'unknown'),
        a_props: properties(a),
        r_id: id(r),
        r_type: coalesce(r.rtype, r.type, 'related_to'),
        r_props: properties(r),
        b_id: id(b),
        b_name: coalesce(b.name, toString(id(b))),
        b_type: coalesce(b.etype, b.type, 'unknown'),
        b_props: properties(b)
      } AS row
      LIMIT toInteger($limit)
    `,
    { projectId: args.projectId, limit: maxItems },
  );

  const nodeRows = await runCypherOnGraph(
    THINKGRAPH_GRAPH_NAME,
    `
      MATCH (n:Entity { project_id: $projectId })
      RETURN {
        node_id: id(n),
        node_name: coalesce(n.name, toString(id(n))),
        node_type: coalesce(n.etype, n.type, 'unknown'),
        node_props: properties(n)
      } AS row
      LIMIT toInteger($limit)
    `,
    { projectId: args.projectId, limit: maxItems },
  );

  relationRows.forEach((rawRow) => {
    const row = asAgeRowObject<ThinkGraphRelationRow>(rawRow);
    if (!row) return;
    collectThinkGraphField(packet, row.a_name, row.a_type, row.a_props);
    collectThinkGraphField(packet, row.b_name, row.b_type, row.b_props);
    const relProps = (toPlainJson(row.r_props || {}) || {}) as Record<string, unknown>;
    pushUnique(
      packet.reasoningNotes,
      String(relProps.snippet ?? relProps.summary ?? relProps.reasoning ?? '').trim() || null,
    );
    const relConfidence = mapConfidenceLevel(relProps.confidence ?? relProps.weight);
    pushUnique(
      packet.confidenceNotes,
      relConfidence ? `${String(row.r_type || 'related_to')}: ${relConfidence}` : null,
    );
  });

  nodeRows.forEach((rawRow) => {
    const row = asAgeRowObject<ThinkGraphNodeRow>(rawRow);
    if (!row) return;
    collectThinkGraphField(packet, row.node_name, row.node_type, row.node_props);
  });

  packet.intent = dedupeStrings(packet.intent).slice(0, maxItems);
  packet.assumptions = dedupeStrings(packet.assumptions).slice(0, maxItems);
  packet.hypotheses = dedupeStrings(packet.hypotheses).slice(0, maxItems);
  packet.uncertainties = dedupeStrings(packet.uncertainties).slice(0, maxItems);
  packet.goals = dedupeStrings(packet.goals).slice(0, maxItems);
  packet.decisions = dedupeStrings(packet.decisions).slice(0, maxItems);
  packet.outcomes = dedupeStrings(packet.outcomes).slice(0, maxItems);
  packet.reasoningNotes = dedupeStrings(packet.reasoningNotes).slice(0, maxItems);
  packet.confidenceNotes = dedupeStrings(packet.confidenceNotes).slice(0, maxItems);

  const hasTypedData =
    packet.intent.length > 0 ||
    packet.assumptions.length > 0 ||
    packet.hypotheses.length > 0 ||
    packet.uncertainties.length > 0 ||
    packet.goals.length > 0 ||
    packet.decisions.length > 0 ||
    packet.outcomes.length > 0;

  return {
    data: packet,
    sourceLabels: ['ThinkGraph'],
    debugNotes: hasTypedData
      ? []
      : relationRows.length > 0 || nodeRows.length > 0
        ? ['thinkgraph_partial: rows found but no typed intent/decision fields recognized']
        : ['thinkgraph_unavailable: no project-scoped rows found'],
  };
}

export async function buildGraphContextPacket(
  args: BuildGraphContextPacketArgs,
  deps: GraphContextBuilderDeps = {},
): Promise<GraphContextPacket> {
  const now = deps.now ?? (() => new Date().toISOString());
  const clock = deps.clock ?? (() => Date.now());
  const packetBase = createEmptyGraphContextPacket({
    projectId: args.projectId,
    requestId: args.requestId ?? null,
    turnId: args.turnId ?? null,
    generatedAt: now(),
  });

  const packet = mergeSelectedContextPacket(packetBase, {
    selectedNodeIds: args.selectedBoardNodeIds || [],
    references: [
      ...((args.selectedBoardNodeIds || []).map((id) => ({
        id,
        label: id,
        kind: 'board_node',
      }))),
      ...((args.selectedGraphNodeIds || []).map((id) => ({
        id,
        label: id,
        kind: 'graph_node',
      }))),
    ],
  });

  const [thinkSettled, knowSettled, codeSettled] = await Promise.all([
    settleGraphSource({
      source: 'graph_thinkgraph',
      critical: false,
      timeoutMs: deps.sourceTimeoutMs?.graph_thinkgraph ?? GRAPH_SOURCE_TIMEOUT_MS.graph_thinkgraph,
      clock,
      operation: () => (deps.readThinkGraphContext ?? readThinkGraphContextFromAge)(args),
    }),
    settleGraphSource({
      source: 'knowgraph',
      critical: false,
      timeoutMs: deps.sourceTimeoutMs?.knowgraph ?? GRAPH_SOURCE_TIMEOUT_MS.knowgraph,
      clock,
      operation: () => (deps.readKnowGraphContext ?? readKnowGraphContextFromNeo4j)(args),
    }),
    settleGraphSource({
      source: 'codegraph_cbm',
      critical: true,
      timeoutMs: deps.sourceTimeoutMs?.codegraph_cbm ?? GRAPH_SOURCE_TIMEOUT_MS.codegraph_cbm,
      clock,
      operation: () => (deps.readCodeGraphContext ?? readCodeGraphContextFromCbm)(args),
    }),
  ]);
  const thinkResult = thinkSettled.result;
  const knowResult = knowSettled.result;
  const codeResult = codeSettled.result;

  const sourceLabels = new Set<string>();
  const debugNotes = new Set<string>();

  const applyStreamResult = <T>(
    result: PromiseSettledResult<GraphContextStreamResult<T>>,
    onFulfilled: (value: GraphContextStreamResult<T>) => void,
    onRejectedLabel: string,
  ) => {
    if (result.status === 'fulfilled') {
      result.value.sourceLabels?.forEach((label) => sourceLabels.add(label));
      result.value.debugNotes?.forEach((note) => debugNotes.add(note));
      onFulfilled(result.value);
      return;
    }
    debugNotes.add(onRejectedLabel + String(result.reason instanceof Error ? `: ${result.reason.message}` : ''));
  };

  applyStreamResult(
    thinkResult,
    (value) => {
      packet.thinkGraphContext = value.data;
    },
    'thinkgraph_unavailable',
  );

  applyStreamResult(
    knowResult,
    (value) => {
      packet.knowGraphContext = value.data;
    },
    'knowgraph_unavailable',
  );

  applyStreamResult(
    codeResult,
    (value) => {
      packet.codeGraphContext = value.data;
    },
    'codegraph_unavailable',
  );

  packet.comparison = compareThinkAndKnowContext(
    packet.thinkGraphContext,
    packet.knowGraphContext,
  );

  if (args.userMessage) {
    debugNotes.add('user_message_present');
  }
  if (args.planDraft != null) {
    debugNotes.add('plan_draft_present');
  }
  if ((args.selectedGraphNodeIds || []).length > 0) {
    debugNotes.add('selected_graph_nodes_present');
  }

  packet.provenance = {
    ...packet.provenance,
    sourceLabels: Array.from(sourceLabels),
    debugNotes: Array.from(debugNotes),
    sourceDiagnostics: [
      thinkSettled.diagnostic,
      knowSettled.diagnostic,
      codeSettled.diagnostic,
    ],
  };

  return packet;
}
