import { pool } from '../../db/pool';
import { runCypherOnGraph } from '../graphService';
import {
  compareThinkAndKnowContext,
  createEmptyGraphContextPacket,
  mergeSelectedContextPacket,
  type CodeGraphContextPacket,
  type GraphContextConfidenceLevel,
  type GraphContextPacket,
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
  userMessage?: string | null;
  selectedBoardNodeIds?: string[];
  selectedGraphNodeIds?: string[];
  planDraft?: unknown;
  maxItems?: number;
  requestId?: string | null;
  turnId?: string | null;
};

export type GraphContextBuilderDeps = {
  now?: () => string;
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

async function readCodeGraphContextFallback(): Promise<GraphContextStreamResult<CodeGraphContextPacket | null>> {
  return {
    data: {
      relevantFiles: [],
      components: [],
      routes: [],
      schemas: [],
      tools: [],
      agentCards: [],
      promptTemplates: [],
      implementationNotes: [
        'CodeGraph builder stream is currently read-only and partial.',
        'No backend CodeGraph query boundary is wired yet; UI layout/read surface exists separately.',
      ],
    },
    sourceLabels: ['CodeGraph'],
    debugNotes: ['codegraph_partial: backend read path not wired yet'],
  };
}

export async function buildGraphContextPacket(
  args: BuildGraphContextPacketArgs,
  deps: GraphContextBuilderDeps = {},
): Promise<GraphContextPacket> {
  const now = deps.now ?? (() => new Date().toISOString());
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

  const [thinkResult, knowResult, codeResult] = await Promise.allSettled([
    (deps.readThinkGraphContext ?? readThinkGraphContextFromAge)(args),
    (deps.readKnowGraphContext ?? readKnowGraphContextFromNeo4j)(args),
    (deps.readCodeGraphContext ?? readCodeGraphContextFallback)(args),
  ]);

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
  };

  return packet;
}
