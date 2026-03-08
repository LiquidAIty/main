import crypto from 'node:crypto';
import type { ResolvedAgentConfig } from '../resolveAgents';
import { tavilySearch } from '../../agents/mcp/tavilyClient';
import type {
  NormalizedResearchDocument,
  ResearchIngestResult,
  ResearchTargetPacket,
  TavilySearchResult,
} from './types';

const DEFAULT_KNOWGRAPH_URL = 'http://localhost:8001';
const MAX_WEB_DOCUMENT_TEXT_CHARS = 120_000;

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

export function normalizeResearchTargetPacket(projectId: string, body: any): ResearchTargetPacket {
  const turnId = String(body?.turnId ?? body?.turn_id ?? '').trim();
  const query = String(body?.query ?? '').trim();
  const searchDepthRaw = String(body?.searchDepth ?? body?.search_depth ?? 'advanced').trim().toLowerCase();
  const searchDepth = searchDepthRaw === 'basic' ? 'basic' : 'advanced';
  const maxResultsRaw = Number(body?.maxResults ?? body?.max_results ?? 5);
  const maxResults = Number.isFinite(maxResultsRaw) ? Math.max(1, Math.min(10, Math.floor(maxResultsRaw))) : 5;

  return {
    projectId: String(projectId || '').trim(),
    turnId,
    query,
    priorityEntities: coerceStringList(body?.priorityEntities ?? body?.priority_entities),
    priorityRelationships: coerceStringList(body?.priorityRelationships ?? body?.priority_relationships),
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
  const contentBody = fullText || snippet || summary || '';

  const parts = [
    title ? `Title: ${title}` : '',
    url ? `Source URL: ${url}` : '',
    snippet ? `Summary: ${snippet}` : '',
    contentBody ? `Content:\n${contentBody}` : '',
  ].filter(Boolean);

  const joined = parts.join('\n\n').slice(0, MAX_WEB_DOCUMENT_TEXT_CHARS);
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

export async function runResearchIngest(
  packet: ResearchTargetPacket,
  resolvedAgent: ResolvedAgentConfig,
): Promise<ResearchIngestResult> {
  const search = await tavilySearch(packet, { toolsConfig: resolvedAgent.tools });
  const documents = normalizeResearchDocuments(packet, search.results, search.toolName);
  if (!documents.length) {
    throw new Error('research_no_ingestable_documents');
  }

  const upstream = await postKnowgraphWebIngest(documents, packet, resolvedAgent, search.toolName);
  return {
    ok: true,
    project_id: packet.projectId,
    turn_id: packet.turnId,
    query: packet.query,
    tool_name: search.toolName,
    search_result_count: search.results.length,
    ingested_document_count:
      Number(upstream?.ingested_document_count ?? upstream?.ingested ?? documents.length) || documents.length,
    document_ids: documents.map((doc) => doc.document_id),
    upstream,
  };
}
