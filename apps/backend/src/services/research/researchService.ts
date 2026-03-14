import crypto from 'node:crypto';
import type { ResolvedAgentConfig } from '../resolveAgents';
import { tavilySearch } from '../../agents/mcp/tavilyClient';
import { getConfiguredPositiveInt, isDevTestModeEnabled } from '../devTest';
import type {
  CandidateEdge,
  KnowGraphGap,
  NormalizedResearchDocument,
  ResearchIntent,
  ResearchIngestResult,
  ResearchSearchTask,
  ResearchTargetPacket,
  TavilySearchResult,
} from './types';

const DEFAULT_KNOWGRAPH_URL = 'http://localhost:8001';
// DEV TEST LIMIT RAISED: allow larger normalized research documents during real loop testing.
const TEMP_STABILIZATION_MAX_WEB_DOCUMENT_TEXT_CHARS = getConfiguredPositiveInt(
  'RESEARCH_MAX_WEB_DOCUMENT_TEXT_CHARS',
  isDevTestModeEnabled() ? 80_000 : 8_000,
);
// DEV TEST LIMIT RAISED: keep substantially larger excerpts when a full page body is available.
const TEMP_STABILIZATION_MAX_WEB_DOCUMENT_FULLTEXT_EXCERPT_CHARS = getConfiguredPositiveInt(
  'RESEARCH_MAX_WEB_DOCUMENT_FULLTEXT_EXCERPT_CHARS',
  isDevTestModeEnabled() ? 40_000 : 4_000,
);
// DEV TEST LIMIT RAISED: allow multi-document research ingest during real book testing.
const TEMP_STABILIZATION_MAX_WEB_DOCUMENTS_PER_RUN = getConfiguredPositiveInt(
  'RESEARCH_MAX_WEB_DOCUMENTS_PER_RUN',
  isDevTestModeEnabled() ? 6 : 1,
);
// DEV TEST LIMIT RAISED: allow more search tasks when multiple graph gaps need evidence.
const TEMP_STABILIZATION_MAX_RESEARCH_SEARCH_TASKS = getConfiguredPositiveInt(
  'RESEARCH_MAX_SEARCH_TASKS',
  isDevTestModeEnabled() ? 12 : 4,
);
// DEV TEST LIMIT RAISED: permit larger explicit `max_results` values on manual research runs.
const TEMP_STABILIZATION_MAX_PACKET_RESULTS = getConfiguredPositiveInt(
  'RESEARCH_MAX_PACKET_RESULTS',
  isDevTestModeEnabled() ? 12 : 10,
);

function trimBaseUrl(value: string): string {
  return value.replace(/\/+$/, '');
}

function buildKnowgraphBaseUrls(): string[] {
  const configured = String(process.env.KNOWGRAPH_URL || '').trim();
  if (!configured) return [DEFAULT_KNOWGRAPH_URL];

  const primary = trimBaseUrl(configured);
  const urls = [primary];
  if (/^https?:\/\/knowgraph(?::\d+)?(?:\/|$)/i.test(primary)) {
    urls.push(DEFAULT_KNOWGRAPH_URL);
  }
  return Array.from(new Set(urls));
}

function coerceStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => String(entry ?? '').trim())
    .filter(Boolean);
}

function normalizeRelationText(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function humanizeRelationText(value: string): string {
  return normalizeRelationText(value).replace(/_/g, ' ').trim() || 'related to';
}

function coerceCandidateEdges(value: unknown): CandidateEdge[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: CandidateEdge[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const entityA = String((raw as any).entityA ?? (raw as any).entity_a ?? '').trim();
    const relationshipType = normalizeRelationText((raw as any).relationshipType ?? (raw as any).relationship_type);
    const entityB = String((raw as any).entityB ?? (raw as any).entity_b ?? '').trim();
    if (!entityA || !entityB || !relationshipType) continue;
    const key = `${entityA.toLowerCase()}::${relationshipType}::${entityB.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const confidenceRaw = Number((raw as any).confidence);
    out.push({
      entityA,
      relationshipType,
      entityB,
      confidence: Number.isFinite(confidenceRaw) ? confidenceRaw : null,
      source:
        (raw as any).source === 'fallback' || (raw as any).source === 'manual'
          ? (raw as any).source
          : 'thinkgraph',
    });
  }
  return out;
}

function coerceGaps(value: unknown): KnowGraphGap[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: KnowGraphGap[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const entityA = String((raw as any).entityA ?? (raw as any).entity_a ?? '').trim();
    const relationshipType = normalizeRelationText((raw as any).relationshipType ?? (raw as any).relationship_type);
    const entityB = String((raw as any).entityB ?? (raw as any).entity_b ?? '').trim();
    const gapTypeRaw = String((raw as any).gapType ?? (raw as any).gap_type ?? '').trim();
    const gapType =
      gapTypeRaw === 'weak_evidence' ||
      gapTypeRaw === 'conflict' ||
      gapTypeRaw === 'stale_evidence'
        ? (gapTypeRaw as KnowGraphGap['gapType'])
        : 'missing_evidence';
    const priorityRaw = String((raw as any).priority ?? '').trim().toLowerCase();
    const priority = priorityRaw === 'low' || priorityRaw === 'medium' ? priorityRaw : 'high';
    if (!entityA || !entityB || !relationshipType) continue;
    const key = `${entityA.toLowerCase()}::${relationshipType}::${entityB.toLowerCase()}::${gapType}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      entityA,
      relationshipType,
      entityB,
      gapType,
      evidenceCount: Math.max(0, Number((raw as any).evidenceCount ?? (raw as any).evidence_count ?? 0) || 0),
      contradictionCount: Math.max(
        0,
        Number((raw as any).contradictionCount ?? (raw as any).contradiction_count ?? 0) || 0,
      ),
      priority,
      reason: String((raw as any).reason ?? '').trim() || `${gapType} for ${entityA} ${relationshipType} ${entityB}`,
      existingRelationTypes: Array.isArray((raw as any).existingRelationTypes ?? (raw as any).existing_relation_types)
        ? ((raw as any).existingRelationTypes ?? (raw as any).existing_relation_types)
            .map((entry: unknown) => normalizeRelationText(entry))
            .filter(Boolean)
        : [],
      lastEvidenceAt: String((raw as any).lastEvidenceAt ?? (raw as any).last_evidence_at ?? '').trim() || null,
    });
  }
  return out;
}

function coerceSearchTasks(value: unknown): ResearchSearchTask[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: ResearchSearchTask[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const query = String((raw as any).query ?? '').trim();
    if (!query) continue;
    const intentRaw = String((raw as any).intent ?? '').trim();
    const intent: ResearchIntent =
      intentRaw === 'explain' ||
      intentRaw === 'compare' ||
      intentRaw === 'resolve_conflict' ||
      intentRaw === 'deepen_evidence'
        ? (intentRaw as ResearchIntent)
        : 'verify';
    if (seen.has(query.toLowerCase())) continue;
    seen.add(query.toLowerCase());
    const priorityRaw = String((raw as any).priority ?? '').trim().toLowerCase();
    const gap = coerceGaps([(raw as any).gap])[0] ?? null;
    out.push({
      query,
      intent,
      priority: priorityRaw === 'low' || priorityRaw === 'medium' ? priorityRaw : 'high',
      gap,
    });
  }
  return out;
}

export function normalizeResearchTargetPacket(projectId: string, body: any): ResearchTargetPacket {
  const turnId = String(body?.turnId ?? body?.turn_id ?? '').trim();
  const query = String(body?.query ?? body?.question ?? '').trim();
  const searchDepthRaw = String(body?.searchDepth ?? body?.search_depth ?? 'advanced').trim().toLowerCase();
  const searchDepth = searchDepthRaw === 'basic' ? 'basic' : 'advanced';
  const maxResultsRaw = Number(body?.maxResults ?? body?.max_results ?? 5);
  const maxResults = Number.isFinite(maxResultsRaw)
    ? Math.max(1, Math.min(TEMP_STABILIZATION_MAX_PACKET_RESULTS, Math.floor(maxResultsRaw)))
    : 5;
  const normalizedProjectId = String(body?.projectId ?? body?.project_id ?? (projectId || '')).trim();

  return {
    projectId: normalizedProjectId,
    turnId,
    query,
    priorityEntities: coerceStringList(body?.priorityEntities ?? body?.priority_entities ?? body?.entities),
    priorityRelationships: coerceStringList(
      body?.priorityRelationships ?? body?.priority_relationships ?? body?.relationships,
    ),
    attentionEdges: coerceCandidateEdges(body?.attentionEdges ?? body?.attention_edges ?? body?.edges),
    gaps: coerceGaps(body?.gaps),
    searchTasks: coerceSearchTasks(body?.searchTasks ?? body?.search_tasks),
    openQuestions: coerceStringList(body?.openQuestions ?? body?.open_questions),
    maxResults,
    searchDepth,
    mode: 'web_research',
  };
}

function hashText(value: string): string {
  return crypto.createHash('sha1').update(value).digest('hex');
}

function buildResearchDocumentId(packet: ResearchTargetPacket, result: TavilySearchResult, index: number): string {
  const urlHash = hashText(result.url);
  const turnPart = packet.turnId || 'manual';
  return `research:${turnPart}:${index + 1}:${urlHash.slice(0, 16)}`;
}

function buildDocumentText(result: TavilySearchResult): { text: string; snippet: string | null; summary: string | null; fullText: string | null } {
  const title = String(result.title || '').trim();
  const url = String(result.url || '').trim();
  const summary = String(result.summary || '').trim() || null;
  const snippet = String(result.snippet || '').trim() || String(result.content || '').trim() || summary;
  const fullText = String(result.rawContent || '').trim() || null;
  const excerpt = fullText ? fullText.slice(0, TEMP_STABILIZATION_MAX_WEB_DOCUMENT_FULLTEXT_EXCERPT_CHARS) : '';
  const contentBody = excerpt || snippet || summary || '';

  const parts = [
    title ? `Title: ${title}` : '',
    url ? `Source URL: ${url}` : '',
    snippet ? `Summary: ${snippet}` : '',
    summary && summary !== snippet ? `Answer: ${summary}` : '',
    contentBody ? `Source Excerpt:\n${contentBody}` : '',
  ].filter(Boolean);

  const joined = parts.join('\n\n').slice(0, TEMP_STABILIZATION_MAX_WEB_DOCUMENT_TEXT_CHARS);
  return {
    text: joined,
    snippet: snippet || null,
    summary,
    fullText,
  };
}

function normalizeResearchDocuments(
  packet: ResearchTargetPacket,
  results: TavilySearchResult[],
  toolName: string,
): NormalizedResearchDocument[] {
  const fetchedAt = new Date().toISOString();
  const documents: NormalizedResearchDocument[] = [];
  results.forEach((result, index) => {
    const docId = buildResearchDocumentId(packet, result, index);
    const docText = buildDocumentText(result);
    if (!docText.text.trim()) return;
    documents.push({
      project_id: packet.projectId,
      document_id: docId,
      source_url: result.url,
      title: result.title || result.url,
      snippet: docText.snippet,
      summary: docText.summary,
      fetched_at: fetchedAt,
      full_text: docText.fullText,
      text: docText.text,
      metadata: {
        source: 'tavily_mcp',
        tool_name: toolName,
        score: result.score ?? null,
        published_at: result.publishedAt ?? null,
        search_query: packet.query,
        search_depth: packet.searchDepth,
        turn_id: packet.turnId,
        priority_entities: packet.priorityEntities,
        priority_relationships: packet.priorityRelationships,
        attention_edges: packet.attentionEdges,
        gaps: packet.gaps,
        search_tasks: packet.searchTasks,
        open_questions: packet.openQuestions,
        tavily_result: result.metadata ?? {},
      },
    });
  });
  return documents;
}

async function readResponseDataSafe(response: Response): Promise<any> {
  const text = await response.text().catch(() => '');
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { ok: response.ok, message: text };
  }
}

function pickErrorMessage(payload: any): string {
  const candidate =
    payload?.error?.message ??
    payload?.message ??
    payload?.error ??
    '';
  return String(candidate || '').trim();
}

async function postKnowgraphWebIngest(
  documents: NormalizedResearchDocument[],
  packet: ResearchTargetPacket,
  resolvedAgent: ResolvedAgentConfig,
  toolName: string,
): Promise<any> {
  const baseUrls = buildKnowgraphBaseUrls();
  let lastError: any;

  const body = {
    project_id: packet.projectId,
    documents,
    prompt_template: resolvedAgent.systemPrompt,
    organizing_principle: resolvedAgent.organizingPrinciple ?? null,
    entity_taxonomy: resolvedAgent.entityTaxonomy ?? null,
    relationship_taxonomy: resolvedAgent.relationshipTaxonomy ?? null,
    extraction_policy: resolvedAgent.extractionPolicy ?? null,
    research_focus: {
      turn_id: packet.turnId,
      query: packet.query,
      priority_entities: packet.priorityEntities,
      priority_relationships: packet.priorityRelationships,
      attention_edges: packet.attentionEdges,
      gaps: packet.gaps,
      search_tasks: packet.searchTasks,
      open_questions: packet.openQuestions,
      search_depth: packet.searchDepth,
      mode: packet.mode,
      tool_name: toolName,
    },
  };

  for (const baseUrl of baseUrls) {
    try {
      const response = await fetch(`${baseUrl}/ingest_web_results`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-agent-id': resolvedAgent.agentId,
          'x-agent-provider': resolvedAgent.provider,
          'x-agent-model-key': resolvedAgent.modelKey,
          'x-agent-model-id': resolvedAgent.providerModelId,
        },
        body: JSON.stringify(body),
      });
      const data = await readResponseDataSafe(response);
      if (response.ok) return data;
      throw new Error(pickErrorMessage(data) || `knowgraph_web_ingest_${response.status}`);
    } catch (error: any) {
      lastError = error;
      const code = String(error?.cause?.code || error?.code || '');
      const canRetryNetworkLookup =
        code === 'ENOTFOUND' || code === 'ECONNREFUSED' || code === 'EAI_AGAIN';
      if (!canRetryNetworkLookup) break;
    }
  }

  throw lastError || new Error('knowgraph_web_ingest_failed');
}

function pickIntentForGap(edge: CandidateEdge | null, gap: KnowGraphGap | null): ResearchIntent {
  if (gap?.gapType === 'conflict') return 'resolve_conflict';
  const rel = normalizeRelationText(gap?.relationshipType ?? edge?.relationshipType);
  if (rel.includes('compete') || rel.includes('compare') || rel === 'vs') return 'compare';
  if (gap?.gapType === 'stale_evidence') return 'deepen_evidence';
  if (gap?.gapType === 'weak_evidence') return 'deepen_evidence';
  if (
    rel.includes('used_for') ||
    rel.includes('applied_to') ||
    rel.includes('supports') ||
    rel.includes('improves')
  ) {
    return 'verify';
  }
  if (rel.includes('explains') || rel.includes('causes')) return 'explain';
  return 'verify';
}

function buildTaskQueries(task: ResearchSearchTask, packet: ResearchTargetPacket): string[] {
  const baseGoal = packet.query.trim();
  const gap = task.gap;
  const entityA = String(gap?.entityA || '').trim();
  const entityB = String(gap?.entityB || '').trim();
  const relText = humanizeRelationText(gap?.relationshipType || '');
  const queries: string[] = [];

  if (task.intent === 'compare' && entityA && entityB) {
    queries.push(`${entityA} vs ${entityB} ${baseGoal}`.trim());
    queries.push(`${entityA} ${entityB} comparison evidence`.trim());
  } else if (task.intent === 'resolve_conflict' && entityA && entityB) {
    queries.push(`${entityA} ${entityB} conflicting evidence ${baseGoal}`.trim());
    queries.push(`${entityA} ${entityB} counter evidence`.trim());
  } else if (task.intent === 'deepen_evidence' && entityA && entityB) {
    queries.push(`${entityA} ${relText} ${entityB} evidence`.trim());
    queries.push(`${entityA} ${entityB} ${baseGoal}`.trim());
  } else if (task.intent === 'explain' && entityA && entityB) {
    queries.push(`${entityA} ${relText} ${entityB}`.trim());
    queries.push(`${entityA} ${baseGoal}`.trim());
  } else if (entityA && entityB) {
    queries.push(`${entityA} ${relText} ${entityB} evidence`.trim());
    queries.push(`${entityA} ${entityB} ${baseGoal}`.trim());
  } else if (baseGoal) {
    queries.push(baseGoal);
  }

  return Array.from(new Set(queries.map((query) => query.trim()).filter(Boolean)));
}

function planGapResearchTasks(packet: ResearchTargetPacket): ResearchSearchTask[] {
  if (packet.searchTasks.length > 0) {
    return packet.searchTasks.slice(0, TEMP_STABILIZATION_MAX_RESEARCH_SEARCH_TASKS);
  }

  const tasks: ResearchSearchTask[] = [];
  const seen = new Set<string>();
  const gaps = packet.gaps.slice(0, TEMP_STABILIZATION_MAX_RESEARCH_SEARCH_TASKS);
  for (const gap of gaps) {
    const intent = pickIntentForGap(
      packet.attentionEdges.find(
        (edge) =>
          edge.entityA.toLowerCase() === gap.entityA.toLowerCase() &&
          edge.entityB.toLowerCase() === gap.entityB.toLowerCase() &&
          normalizeRelationText(edge.relationshipType) === normalizeRelationText(gap.relationshipType),
      ) || null,
      gap,
    );
    const task: ResearchSearchTask = {
      query: '',
      intent,
      priority: gap.priority,
      gap,
    };
    for (const query of buildTaskQueries(task, packet)) {
      const key = query.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      tasks.push({ ...task, query });
      if (tasks.length >= TEMP_STABILIZATION_MAX_RESEARCH_SEARCH_TASKS) {
        return tasks;
      }
    }
  }

  if (tasks.length === 0) {
    const fallbackQueries = Array.from(
      new Set(
        [
          ...packet.priorityRelationships,
          ...packet.priorityEntities.map((entity) => `${entity} ${packet.query}`.trim()),
          packet.query,
        ]
          .map((entry) => String(entry || '').trim())
          .filter(Boolean),
      ),
    ).slice(0, TEMP_STABILIZATION_MAX_RESEARCH_SEARCH_TASKS);
    fallbackQueries.forEach((query) => {
      tasks.push({
        query,
        intent: 'verify',
        priority: 'medium',
        gap: null,
      });
    });
  }

  return tasks;
}

export async function runResearchIngest(
  packet: ResearchTargetPacket,
  resolvedAgent: ResolvedAgentConfig,
): Promise<ResearchIngestResult> {
  const plannedTasks = planGapResearchTasks(packet);
  console.log(
    '[ResearchPlanner] projectId=%s gaps=%d tasks=%d',
    packet.projectId,
    packet.gaps.length,
    plannedTasks.length,
  );
  if (!plannedTasks.length) {
    return {
      ok: true,
      project_id: packet.projectId,
      turn_id: packet.turnId,
      query: packet.query,
      planned_task_count: 0,
      gap_count: packet.gaps.length,
      tool_name: 'tavily_search',
      search_result_count: 0,
      ingested_document_count: 0,
      document_ids: [],
      upstream: {},
    };
  }
  const queries = Array.from(new Set(plannedTasks.map((task) => task.query.trim()).filter(Boolean)));
  const aggregatedResults: TavilySearchResult[] = [];
  let toolName = 'tavily_search';
  let searchResultCount = 0;

  for (const query of queries) {
    console.log('[Research] projectId=%s querying Tavily for: %s', packet.projectId, query);
    const search = await tavilySearch(
      {
        ...packet,
        query,
      },
      { toolsConfig: resolvedAgent.tools },
    );
    toolName = search.toolName;
    searchResultCount += search.results.length;
    search.results.forEach((result) => {
      aggregatedResults.push({
        ...result,
        metadata: {
          ...(result.metadata || {}),
          search_query_used: query,
          original_question: packet.query,
        },
      });
    });
  }

  const dedupedResults = Array.from(
    new Map(
      aggregatedResults.map((result) => [String(result.url || '').trim(), result]),
    ).values(),
  ).filter((result) => String(result.url || '').trim());

  const limitedResults = dedupedResults
    .sort((a, b) => Number(b.score ?? 0) - Number(a.score ?? 0))
    .slice(0, Math.max(1, Math.min(packet.maxResults, TEMP_STABILIZATION_MAX_WEB_DOCUMENTS_PER_RUN)));
  console.log(
    '[Research] projectId=%s deduped_results=%d ingest_documents=%d',
    packet.projectId,
    dedupedResults.length,
    limitedResults.length,
  );

  const documents = normalizeResearchDocuments(
    {
      ...packet,
      searchTasks: plannedTasks,
    },
    limitedResults,
    toolName,
  );
  if (!documents.length) {
    throw new Error('research_no_ingestable_documents');
  }

  console.log(
    '[Ingest] projectId=%s source=research documents=%d provider=%s model=%s',
    packet.projectId,
    documents.length,
    resolvedAgent.provider,
    resolvedAgent.providerModelId,
  );
  const upstream = await postKnowgraphWebIngest(
    documents,
    {
      ...packet,
      searchTasks: plannedTasks,
    },
    resolvedAgent,
    toolName,
  );
  console.log(
    '[Ingest] projectId=%s source=research ingested_documents=%d',
    packet.projectId,
    Number(upstream?.ingested_document_count ?? upstream?.ingested ?? documents.length) || documents.length,
  );
  console.log(
    '[KnowGraph] ingested %d documents',
    Number(upstream?.ingested_document_count ?? upstream?.ingested ?? documents.length) || documents.length,
  );
  return {
    ok: true,
    project_id: packet.projectId,
    turn_id: packet.turnId,
    query: packet.query,
    planned_task_count: plannedTasks.length,
    gap_count: packet.gaps.length,
    tool_name: toolName,
    search_result_count: searchResultCount,
    ingested_document_count:
      Number(upstream?.ingested_document_count ?? upstream?.ingested ?? documents.length) || documents.length,
    document_ids: documents.map((doc) => doc.document_id),
    upstream,
  };
}
