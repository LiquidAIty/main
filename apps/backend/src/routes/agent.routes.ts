import { Router } from 'express';
import type { AgentConfig } from '../types/agentBuilder';
import {
  listAgentCards,
  saveAgentConfig as persistAgentConfig,
  getAgentConfig as fetchAgentConfig,
} from '../services/agentBuilderStore';
import { runLLM } from '../llm/client';
import { createOpenRouterEmbedding } from '../llm/openrouterEmbeddings';
import { captureProbability } from '../lib/receiptCapture';
import { resolveAgentConfig } from '../services/resolveAgents';
import { getConfiguredPositiveInt, isDevTestModeEnabled } from '../services/devTest';
import { ragSearchDirect } from '../tools/rag.search';
import type { KgEntity, KgRelationship } from './v2/chunking';
import { runKgChatTurnNow, runResearchPacketForProject } from './v2/kg.routes';
import type { CandidateEdge, KnowGraphGap, ResearchSearchTask } from '../services/research/types';

export const agentRoutes = Router();
const lastResponseIdByProject = new Map<string, string>();
// DEV TEST LIMIT RAISED: keep more candidate edges during real document loop testing.
const TEMP_STABILIZATION_MAX_CANDIDATE_EDGES = getConfiguredPositiveInt(
  'LOOP_MAX_CANDIDATE_EDGES',
  isDevTestModeEnabled() ? 12 : 5,
);
// DEV TEST LIMIT RAISED: allow more KnowGraph gaps to trigger research on real projects.
const TEMP_STABILIZATION_MAX_GAPS_PER_TURN = getConfiguredPositiveInt(
  'LOOP_MAX_GAPS_PER_TURN',
  isDevTestModeEnabled() ? 10 : 3,
);
// DEV TEST LIMIT RAISED: keep more attention entities when building the research packet.
const TEMP_STABILIZATION_MAX_PRIORITY_ENTITIES = getConfiguredPositiveInt(
  'LOOP_MAX_PRIORITY_ENTITIES',
  isDevTestModeEnabled() ? 10 : 5,
);
// DEV TEST LIMIT RAISED: let reply synthesis see a deeper evidence bundle on real documents.
const TEMP_STABILIZATION_MAX_REPLY_EVIDENCE_NODES = getConfiguredPositiveInt(
  'LOOP_MAX_REPLY_EVIDENCE_NODES',
  isDevTestModeEnabled() ? 10 : 3,
);
// DEV TEST LIMIT RAISED: allow evidence from more source documents in the reply context.
const TEMP_STABILIZATION_MAX_REPLY_SOURCE_DOCS = getConfiguredPositiveInt(
  'LOOP_MAX_REPLY_SOURCE_DOCS',
  isDevTestModeEnabled() ? 6 : 2,
);
// DEV TEST LIMIT RAISED: scan more evidence rows before trimming the final reply bundle.
const TEMP_STABILIZATION_REPLY_QUERY_LIMIT = getConfiguredPositiveInt(
  'LOOP_REPLY_QUERY_LIMIT',
  isDevTestModeEnabled() ? 40 : 12,
);
const TEMP_STABILIZATION_REPLY_WEIGHTED_QUERY_LIMIT = getConfiguredPositiveInt(
  'LOOP_REPLY_WEIGHTED_QUERY_LIMIT',
  isDevTestModeEnabled() ? 32 : 10,
);
// DEV TEST LIMIT RAISED: carry larger evidence snippets from real technical documents.
const TEMP_STABILIZATION_REPLY_SNIPPET_CHARS = getConfiguredPositiveInt(
  'LOOP_REPLY_SNIPPET_CHARS',
  isDevTestModeEnabled() ? 900 : 320,
);
const DEFAULT_REPLY_EMBED_MODEL =
  process.env.OPENROUTER_DEFAULT_EMBED_MODEL || 'openai/text-embedding-3-small';
const TEMP_STABILIZATION_STALE_EVIDENCE_DAYS = getConfiguredPositiveInt(
  'LOOP_STALE_EVIDENCE_DAYS',
  30,
);
const HEURISTIC_STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'compare', 'does', 'evidence',
  'for', 'from', 'how', 'if', 'in', 'is', 'it', 'of', 'on', 'or', 'the', 'their',
  'this', 'time', 'to', 'use', 'using', 'what', 'with',
]);
const GAP_CONFLICT_RELATION_TYPES = new Set([
  'contradicts',
  'conflicts_with',
  'opposes',
  'disputes',
  'counterevidence',
]);

type RetrievedEvidence = {
  entityName: string;
  title: string;
  snippet: string;
  url: string;
  documentId: string;
  fetchedAt: string | null;
};

type RetrievedEvidenceBundle = {
  evidence: RetrievedEvidence[];
  mode: 'graph' | 'hybrid' | 'weighted_fallback' | 'disabled';
  weightedResults: number;
  graphResults: number;
};

function normalizeRelationType(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function parseTimestampMs(value: unknown): number | null {
  if (value == null) return null;
  const time = Date.parse(String(value));
  return Number.isFinite(time) ? time : null;
}

function normalizeHeuristicPhrase(value: string): string {
  return String(value || '')
    .replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function pickRecentEntityNames(userText: string, entities: KgEntity[], limit = 5): string[] {
  const loweredUserText = userText.toLowerCase();
  const ranked = entities
    .map((entity, index) => {
      const name = String(entity?.name || '').trim();
      return {
        name,
        lastIdx: name ? loweredUserText.lastIndexOf(name.toLowerCase()) : -1,
        index,
      };
    })
    .filter((entry) => entry.name);

  ranked.sort((a, b) => {
    if (a.lastIdx !== b.lastIdx) return b.lastIdx - a.lastIdx;
    return a.index - b.index;
  });

  return Array.from(new Set(ranked.map((entry) => entry.name))).slice(0, limit);
}

function extractFallbackEntityNames(userText: string): string[] {
  const text = String(userText || '').trim();
  if (!text) return [];
  const seen = new Set<string>();
  const candidates: Array<{ value: string; score: number }> = [];
  const pushCandidate = (raw: string) => {
    const value = normalizeHeuristicPhrase(raw);
    if (!value || value.length < 3) return;
    const lower = value.toLowerCase();
    if (seen.has(lower)) return;
    if (HEURISTIC_STOPWORDS.has(lower)) return;
    if (lower.split(' ').some((word) => HEURISTIC_STOPWORDS.has(word))) return;
    seen.add(lower);
    candidates.push({ value, score: text.toLowerCase().lastIndexOf(lower) });
  };

  for (const match of text.matchAll(/\b(?:[A-Z][a-z0-9]+(?:\s+[A-Za-z][a-z0-9-]+)*)\b/g)) {
    pushCandidate(match[0]);
  }

  const words = Array.from(text.matchAll(/[A-Za-z][A-Za-z0-9-]*/g)).map((match) => match[0]);
  for (let size = 3; size >= 2; size -= 1) {
    for (let i = 0; i <= words.length - size; i += 1) {
      const slice = words.slice(i, i + size);
      if (slice.some((word) => HEURISTIC_STOPWORDS.has(word.toLowerCase()) || word.length < 3)) continue;
      pushCandidate(slice.join(' '));
    }
  }

  return candidates
    .sort((a, b) => b.score - a.score || b.value.length - a.value.length)
    .map((entry) => entry.value)
    .slice(0, 3);
}

function buildCandidateEdges(userText: string, entities: KgEntity[], relationships: KgRelationship[]): CandidateEdge[] {
  const entityById = new Map(entities.map((entity) => [entity.id, String(entity.name || '').trim()]));
  const loweredUserText = userText.toLowerCase();
  const seen = new Set<string>();
  const edges: Array<CandidateEdge & { recency: number; order: number }> = [];

  relationships.forEach((relationship, order) => {
    const entityA = String(entityById.get(relationship.from) || relationship.from || '').trim();
    const entityB = String(entityById.get(relationship.to) || relationship.to || '').trim();
    const relationshipType = normalizeRelationType(relationship.type);
    if (!entityA || !entityB || !relationshipType) return;
    const key = `${entityA.toLowerCase()}::${relationshipType}::${entityB.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({
      entityA,
      relationshipType,
      entityB,
      confidence: typeof relationship.confidence === 'number' ? relationship.confidence : null,
      source: 'thinkgraph',
      recency: Math.max(
        loweredUserText.lastIndexOf(entityA.toLowerCase()),
        loweredUserText.lastIndexOf(entityB.toLowerCase()),
      ),
      order,
    });
  });

  if (!edges.length) {
    const recentEntities = pickRecentEntityNames(userText, entities, 2);
    const fallbackEntities =
      recentEntities.length >= 2 ? recentEntities : extractFallbackEntityNames(userText);
    if (recentEntities.length >= 2) {
      edges.push({
        entityA: recentEntities[0],
        relationshipType: 'related_to',
        entityB: recentEntities[1],
        confidence: 0.1,
        source: 'fallback',
        recency: Math.max(
          loweredUserText.lastIndexOf(recentEntities[0].toLowerCase()),
          loweredUserText.lastIndexOf(recentEntities[1].toLowerCase()),
        ),
        order: Number.MAX_SAFE_INTEGER,
      });
    } else if (fallbackEntities.length >= 2) {
      edges.push({
        entityA: fallbackEntities[0],
        relationshipType:
          loweredUserText.includes('compare') || loweredUserText.includes(' vs ')
            ? 'competes_with'
            : 'related_to',
        entityB: fallbackEntities[1],
        confidence: 0.1,
        source: 'fallback',
        recency: Math.max(
          loweredUserText.lastIndexOf(fallbackEntities[0].toLowerCase()),
          loweredUserText.lastIndexOf(fallbackEntities[1].toLowerCase()),
        ),
        order: Number.MAX_SAFE_INTEGER - 1,
      });
    }
  }

  return edges
    .sort((a, b) => {
      if (a.recency !== b.recency) return b.recency - a.recency;
      const aConfidence = typeof a.confidence === 'number' ? a.confidence : -1;
      const bConfidence = typeof b.confidence === 'number' ? b.confidence : -1;
      if (aConfidence !== bConfidence) return bConfidence - aConfidence;
      return a.order - b.order;
    })
    .slice(0, TEMP_STABILIZATION_MAX_CANDIDATE_EDGES)
    .map(({ recency: _recency, order: _order, ...edge }) => edge);
}

function humanizeResearchRelation(value: string): string {
  return normalizeRelationType(value).replace(/_/g, ' ').trim() || 'related to';
}

function inferResearchIntent(userText: string, edge: CandidateEdge | null): ResearchSearchTask['intent'] {
  const lowered = String(userText || '').toLowerCase();
  const relation = normalizeRelationType(edge?.relationshipType || '');
  if (lowered.includes('compare') || lowered.includes(' vs ') || relation.includes('compare') || relation.includes('compete')) {
    return 'compare';
  }
  if (lowered.includes('why') || lowered.includes('how') || relation.includes('cause') || relation.includes('explain')) {
    return 'explain';
  }
  return 'verify';
}

function buildResearchSearchTasks(
  userText: string,
  candidateEdges: CandidateEdge[],
  entityNames: string[],
): ResearchSearchTask[] {
  const seen = new Set<string>();
  const tasks: ResearchSearchTask[] = [];

  const pushTask = (
    query: string,
    priority: ResearchSearchTask['priority'],
    edge: CandidateEdge | null,
  ) => {
    const normalizedQuery = String(query || '').trim();
    if (!normalizedQuery) return;
    const key = normalizedQuery.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    tasks.push({
      query: normalizedQuery,
      intent: inferResearchIntent(userText, edge),
      priority,
      gap: null,
    });
  };

  pushTask(userText, 'high', null);

  candidateEdges.forEach((edge) => {
    const relation = humanizeResearchRelation(edge.relationshipType);
    pushTask(`${edge.entityA} ${relation} ${edge.entityB}`.trim(), 'high', edge);
    pushTask(`${edge.entityA} ${edge.entityB} ${userText}`.trim(), 'medium', edge);
  });

  entityNames.forEach((entityName) => {
    pushTask(`${entityName} ${userText}`.trim(), 'medium', null);
  });

  return tasks.slice(0, TEMP_STABILIZATION_MAX_CANDIDATE_EDGES);
}

function buildResearchOpenQuestions(candidateEdges: CandidateEdge[]): string[] {
  return candidateEdges
    .slice(0, 4)
    .map((edge) => {
      const relation = humanizeResearchRelation(edge.relationshipType);
      return `What source-backed evidence supports ${edge.entityA} ${relation} ${edge.entityB}?`;
    });
}

function buildDebugResearchPacket(
  projectId: string,
  turnId: string,
  userText: string,
  candidateEdges: CandidateEdge[],
  entityNames: string[],
) {
  const priorityRelationships = Array.from(
    new Set(candidateEdges.map((edge) => normalizeRelationType(edge.relationshipType)).filter(Boolean)),
  );
  const searchTasks = buildResearchSearchTasks(userText, candidateEdges, entityNames);

  return {
    projectId,
    turnId,
    query: userText,
    priorityEntities: entityNames,
    priorityRelationships,
    attentionEdges: candidateEdges,
    gaps: [],
    searchTasks,
    openQuestions: buildResearchOpenQuestions(candidateEdges),
  };
}

async function openNeo4jSession(): Promise<{ driver: any; session: any } | null> {
  const uri = process.env.NEO4J_URI;
  const user = process.env.NEO4J_USER;
  const password = process.env.NEO4J_PASSWORD;
  if (!uri || !user || !password) {
    return null;
  }

  const neo4jModule: any = await import('neo4j-driver');
  const neo4j: any = neo4jModule?.default ?? neo4jModule;
  const driver = neo4j.driver(uri, neo4j.auth.basic(user, password));
  const database = process.env.NEO4J_DATABASE || undefined;
  const session = driver.session(database ? { database } : undefined);
  return { driver, session };
}

async function fetchCandidateEdgeGap(
  session: any,
  projectId: string,
  edge: CandidateEdge,
): Promise<KnowGraphGap | null> {
  const params = {
    projectId,
    entityA: edge.entityA.toLowerCase(),
    entityB: edge.entityB.toLowerCase(),
    relationshipType: normalizeRelationType(edge.relationshipType),
    conflictTypes: Array.from(GAP_CONFLICT_RELATION_TYPES),
  };

  const endpointResult = await session.run(
    `
      MATCH (n)
      WHERE coalesce(n.project_id, '') = $projectId
        AND toLower(coalesce(n.name, '')) IN [$entityA, $entityB]
      RETURN
        count(DISTINCT CASE WHEN toLower(coalesce(n.name, '')) = $entityA THEN n END) AS a_nodes,
        count(DISTINCT CASE WHEN toLower(coalesce(n.name, '')) = $entityB THEN n END) AS b_nodes
    `,
    params,
  );
  const endpointRow = endpointResult.records[0];
  const entityANodes = Number(endpointRow?.get('a_nodes') || 0);
  const entityBNodes = Number(endpointRow?.get('b_nodes') || 0);

  const relationResult = await session.run(
    `
      MATCH (a)-[r]-(b)
      WHERE coalesce(a.project_id, '') = $projectId
        AND coalesce(b.project_id, '') = $projectId
        AND toLower(coalesce(a.name, '')) = $entityA
        AND toLower(coalesce(b.name, '')) = $entityB
      RETURN
        count(DISTINCT r) AS rel_count,
        count(DISTINCT CASE WHEN toLower(type(r)) = $relationshipType THEN r END) AS exact_rel_count,
        count(DISTINCT CASE WHEN toLower(type(r)) IN $conflictTypes THEN r END) AS conflict_rel_count,
        [relType IN collect(DISTINCT toLower(type(r))) WHERE relType IS NOT NULL][0..8] AS relation_types,
        max(coalesce(r.fetched_at, r.last_seen_ts, toString(r.updated_at), toString(r.created_at))) AS last_rel_ts
    `,
    params,
  );
  const relationRow = relationResult.records[0];
  const exactRelationCount = Number(relationRow?.get('exact_rel_count') || 0);
  const conflictRelationCount = Number(relationRow?.get('conflict_rel_count') || 0);
  const relationTypes = Array.isArray(relationRow?.get('relation_types'))
    ? (relationRow.get('relation_types') as string[]).map((value) => normalizeRelationType(value)).filter(Boolean)
    : [];
  const lastRelationTs = String(relationRow?.get('last_rel_ts') || '').trim() || null;

  const mentionResult = await session.run(
    `
      MATCH (doc:Document {project_id: $projectId})-[:HAS_CHUNK]->(chunk:Chunk)
      WITH doc, chunk,
           EXISTS {
             MATCH (chunk)-[:MENTIONS]->(a)
             WHERE toLower(coalesce(a.name, '')) = $entityA
           } AS has_a,
           EXISTS {
             MATCH (chunk)-[:MENTIONS]->(b)
             WHERE toLower(coalesce(b.name, '')) = $entityB
           } AS has_b
      WHERE has_a AND has_b
      RETURN
        count(DISTINCT chunk) AS shared_chunk_count,
        count(DISTINCT doc) AS shared_doc_count,
        max(coalesce(doc.fetched_at, chunk.fetched_at, toString(doc.ingested_at), toString(chunk.ingested_at))) AS last_doc_ts
    `,
    params,
  );
  const mentionRow = mentionResult.records[0];
  const sharedChunkCount = Number(mentionRow?.get('shared_chunk_count') || 0);
  const sharedDocCount = Number(mentionRow?.get('shared_doc_count') || 0);
  const lastDocTs = String(mentionRow?.get('last_doc_ts') || '').trim() || null;

  const evidenceCount = exactRelationCount + sharedDocCount;
  const lastEvidenceMs = parseTimestampMs(lastDocTs || lastRelationTs);
  const staleCutoffMs = Date.now() - TEMP_STABILIZATION_STALE_EVIDENCE_DAYS * 24 * 60 * 60 * 1000;
  const isStale = typeof lastEvidenceMs === 'number' && lastEvidenceMs < staleCutoffMs;

  if (conflictRelationCount > 0) {
    return {
      entityA: edge.entityA,
      relationshipType: params.relationshipType,
      entityB: edge.entityB,
      gapType: 'conflict',
      evidenceCount,
      contradictionCount: conflictRelationCount,
      priority: 'high',
      reason: `conflicting relationship evidence already exists for ${edge.entityA} ${params.relationshipType} ${edge.entityB}`,
      existingRelationTypes: relationTypes,
      lastEvidenceAt: lastDocTs || lastRelationTs,
    };
  }

  if (entityANodes === 0 || entityBNodes === 0) {
    return {
      entityA: edge.entityA,
      relationshipType: params.relationshipType,
      entityB: edge.entityB,
      gapType: 'missing_evidence',
      evidenceCount,
      contradictionCount: 0,
      priority: 'high',
      reason:
        entityANodes === 0 && entityBNodes === 0
          ? 'both endpoint entities are missing from KnowGraph'
          : 'one endpoint entity is missing from KnowGraph',
      existingRelationTypes: relationTypes,
      lastEvidenceAt: lastDocTs || lastRelationTs,
    };
  }

  if (exactRelationCount === 0 && sharedDocCount === 0 && sharedChunkCount === 0) {
    return {
      entityA: edge.entityA,
      relationshipType: params.relationshipType,
      entityB: edge.entityB,
      gapType: 'missing_evidence',
      evidenceCount: 0,
      contradictionCount: 0,
      priority: 'high',
      reason: 'no KnowGraph relationship or co-mentioned evidence exists for this candidate edge',
      existingRelationTypes: relationTypes,
      lastEvidenceAt: null,
    };
  }

  if (isStale) {
    return {
      entityA: edge.entityA,
      relationshipType: params.relationshipType,
      entityB: edge.entityB,
      gapType: 'stale_evidence',
      evidenceCount,
      contradictionCount: 0,
      priority: 'medium',
      reason: `supporting evidence is older than ${TEMP_STABILIZATION_STALE_EVIDENCE_DAYS} days`,
      existingRelationTypes: relationTypes,
      lastEvidenceAt: lastDocTs || lastRelationTs,
    };
  }

  if (exactRelationCount === 0 || evidenceCount <= 1) {
    return {
      entityA: edge.entityA,
      relationshipType: params.relationshipType,
      entityB: edge.entityB,
      gapType: 'weak_evidence',
      evidenceCount,
      contradictionCount: 0,
      priority: exactRelationCount === 0 ? 'high' : 'medium',
      reason:
        exactRelationCount === 0
          ? 'only indirect co-mention evidence exists for this edge'
          : 'supporting evidence for this edge is still weak',
      existingRelationTypes: relationTypes,
      lastEvidenceAt: lastDocTs || lastRelationTs,
    };
  }

  return null;
}

function compareGapPriority(a: KnowGraphGap, b: KnowGraphGap) {
  const rank = { high: 3, medium: 2, low: 1 } as const;
  if (rank[a.priority] !== rank[b.priority]) return rank[b.priority] - rank[a.priority];
  if (a.evidenceCount !== b.evidenceCount) return a.evidenceCount - b.evidenceCount;
  return a.reason.localeCompare(b.reason);
}

export async function checkKnowGraphGaps(
  session: any,
  projectId: string,
  candidateEdges: CandidateEdge[],
): Promise<KnowGraphGap[]> {
  const gaps: KnowGraphGap[] = [];
  for (const edge of candidateEdges) {
    try {
      const gap = await fetchCandidateEdgeGap(session, projectId, edge);
      if (!gap) continue;
      console.log('[Gap] %s %s %s -> %s', gap.entityA, gap.relationshipType, gap.entityB, gap.gapType);
      gaps.push(gap);
    } catch (err: any) {
      console.warn(
        '[KnowGraph] gap check failed for edge %s %s %s: %s',
        edge.entityA,
        edge.relationshipType,
        edge.entityB,
        err?.message || String(err),
      );
    }
  }
  return gaps.sort(compareGapPriority).slice(0, TEMP_STABILIZATION_MAX_GAPS_PER_TURN);
}

function appendEvidenceRows(
  rows: RetrievedEvidence[],
  kept: RetrievedEvidence[],
  seenDocs: Set<string>,
): void {
  for (const row of rows) {
    if (!row.snippet) continue;
    if (row.documentId) {
      if (!seenDocs.has(row.documentId) && seenDocs.size >= TEMP_STABILIZATION_MAX_REPLY_SOURCE_DOCS) continue;
      seenDocs.add(row.documentId);
    }
    kept.push(row);
    if (kept.length >= TEMP_STABILIZATION_MAX_REPLY_EVIDENCE_NODES) return;
  }
}

function buildWeightedEvidenceQuery(
  userMessage: string,
  attentionEdges: CandidateEdge[],
  entityNames: string[],
): string {
  const parts = [
    String(userMessage || '').trim(),
    ...attentionEdges.slice(0, 4).map((edge) => `${edge.entityA} ${edge.relationshipType} ${edge.entityB}`.trim()),
    ...entityNames.slice(0, 4).map((name) => String(name || '').trim()),
  ]
    .map((value) => value.trim())
    .filter(Boolean);

  return Array.from(new Set(parts)).join('\n');
}

async function loadKnowGraphDocumentMeta(
  session: any,
  projectId: string,
  docIds: string[],
): Promise<Map<string, { title: string; url: string; fetchedAt: string | null }>> {
  const normalizedDocIds = Array.from(new Set(docIds.map((docId) => String(docId || '').trim()).filter(Boolean)));
  if (!normalizedDocIds.length) return new Map();

  const result = await session.run(
    `
      MATCH (doc:Document {project_id: $projectId})
      WHERE coalesce(doc.document_id, '') IN $docIds
      RETURN
        coalesce(doc.document_id, '') AS document_id,
        coalesce(doc.source_name, doc.title, doc.document_id, 'Untitled') AS title,
        coalesce(doc.source_url, '') AS url,
        coalesce(doc.fetched_at, toString(doc.ingested_at), '') AS fetched_at
    `,
    { projectId, docIds: normalizedDocIds },
  );

  const metaByDocId = new Map<string, { title: string; url: string; fetchedAt: string | null }>();
  result.records.forEach((record: any) => {
    const documentId = String(record.get('document_id') || '').trim();
    if (!documentId) return;
    metaByDocId.set(documentId, {
      title: String(record.get('title') || 'Untitled').trim(),
      url: String(record.get('url') || '').trim(),
      fetchedAt: String(record.get('fetched_at') || '').trim() || null,
    });
  });
  return metaByDocId;
}

async function retrieveWeightedSourceBackedEvidence(
  session: any,
  projectId: string,
  userMessage: string,
  attentionEdges: CandidateEdge[],
  entityNames: string[],
): Promise<RetrievedEvidence[]> {
  const queryText = buildWeightedEvidenceQuery(userMessage, attentionEdges, entityNames);
  if (!queryText) return [];

  const embedding = await createOpenRouterEmbedding(queryText, DEFAULT_REPLY_EMBED_MODEL);
  const weighted = await ragSearchDirect(embedding, TEMP_STABILIZATION_REPLY_WEIGHTED_QUERY_LIMIT);
  const rows = Array.isArray((weighted as any)?.rows) ? ((weighted as any).rows as any[]) : [];
  if (!rows.length) return [];

  const docMeta = await loadKnowGraphDocumentMeta(
    session,
    projectId,
    rows.map((row) => String(row?.doc_id || '').trim()),
  );
  if (!docMeta.size) return [];

  return rows
    .map((row) => {
      const documentId = String(row?.doc_id || '').trim();
      const meta = docMeta.get(documentId);
      if (!meta) return null;
      const snippet = String(row?.chunk || '').trim().slice(0, TEMP_STABILIZATION_REPLY_SNIPPET_CHARS);
      if (!snippet) return null;
      const evidenceRow: RetrievedEvidence = {
        entityName: '',
        title: meta.title,
        snippet,
        url: meta.url,
        documentId,
        fetchedAt:
          meta.fetchedAt ||
          (String(row?.created_at || '').trim() || null),
      };
      return evidenceRow;
    })
    .filter((row): row is RetrievedEvidence => Boolean(row));
}

async function retrieveKnowGraphEvidenceForTurn(
  session: any,
  projectId: string,
  userMessage: string,
  attentionEdges: CandidateEdge[],
  entityNames: string[],
  turnId: string | null,
): Promise<RetrievedEvidenceBundle> {
  if (!projectId) {
    return {
      evidence: [],
      mode: 'disabled',
      weightedResults: 0,
      graphResults: 0,
    };
  }

  const kept: RetrievedEvidence[] = [];
  const seenDocs = new Set<string>();
  let weightedResults = 0;
  let graphResults = 0;

  if (attentionEdges.length > 0) {
    const edgeRowsResult = await session.run(
      `
        UNWIND $edges AS edge
        MATCH (doc:Document {project_id: $projectId})-[:HAS_CHUNK]->(chunk:Chunk)
        WHERE EXISTS {
          MATCH (chunk)-[:MENTIONS]->(a)
          WHERE toLower(coalesce(a.name, '')) = edge.entity_a
        }
          AND EXISTS {
            MATCH (chunk)-[:MENTIONS]->(b)
            WHERE toLower(coalesce(b.name, '')) = edge.entity_b
          }
        RETURN
          edge.entity_a AS entity_name,
          coalesce(doc.source_name, doc.document_id, 'Untitled') AS title,
          left(coalesce(chunk.text, doc.snippet, ''), $snippetChars) AS snippet,
          coalesce(doc.source_url, chunk.source_url, '') AS url,
          coalesce(doc.document_id, '') AS document_id,
          coalesce(doc.fetched_at, chunk.fetched_at, toString(doc.ingested_at), '') AS fetched_at
        ORDER BY coalesce(doc.fetched_at, chunk.fetched_at, toString(doc.ingested_at), '') DESC
        LIMIT toInteger($queryLimit)
      `,
      {
        projectId,
        queryLimit: TEMP_STABILIZATION_REPLY_QUERY_LIMIT,
        snippetChars: TEMP_STABILIZATION_REPLY_SNIPPET_CHARS,
        edges: attentionEdges.map((edge) => ({
          entity_a: edge.entityA.toLowerCase(),
          entity_b: edge.entityB.toLowerCase(),
        })),
      },
    );
    const mappedRows = edgeRowsResult.records.map((record: any) => ({
        entityName: String(record.get('entity_name') || '').trim(),
        title: String(record.get('title') || 'Untitled').trim(),
        snippet: String(record.get('snippet') || '').trim(),
        url: String(record.get('url') || '').trim(),
        documentId: String(record.get('document_id') || '').trim(),
        fetchedAt: String(record.get('fetched_at') || '').trim() || null,
      }));
    graphResults += mappedRows.length;
    appendEvidenceRows(mappedRows, kept, seenDocs);
  }

  if (kept.length < TEMP_STABILIZATION_MAX_REPLY_EVIDENCE_NODES && entityNames.length > 0) {
    const entityResult = await session.run(
      `
        MATCH (doc:Document {project_id: $projectId})-[:HAS_CHUNK]->(chunk:Chunk)-[:MENTIONS]->(entity)
        WHERE toLower(coalesce(entity.name, '')) IN $entityNames
        RETURN
          coalesce(entity.name, '') AS entity_name,
          coalesce(doc.source_name, doc.document_id, 'Untitled') AS title,
          left(coalesce(chunk.text, doc.snippet, ''), $snippetChars) AS snippet,
          coalesce(doc.source_url, chunk.source_url, entity.source_url, '') AS url,
          coalesce(doc.document_id, entity.document_id, '') AS document_id,
          coalesce(doc.fetched_at, chunk.fetched_at, entity.fetched_at, toString(doc.ingested_at), '') AS fetched_at
        ORDER BY coalesce(doc.fetched_at, chunk.fetched_at, entity.fetched_at, toString(doc.ingested_at), '') DESC
        LIMIT toInteger($queryLimit)
      `,
      {
        projectId,
        queryLimit: TEMP_STABILIZATION_REPLY_QUERY_LIMIT,
        snippetChars: TEMP_STABILIZATION_REPLY_SNIPPET_CHARS,
        entityNames: entityNames.map((name) => name.toLowerCase()),
      },
    );
    const mappedRows = entityResult.records.map((record: any) => ({
        entityName: String(record.get('entity_name') || '').trim(),
        title: String(record.get('title') || 'Untitled').trim(),
        snippet: String(record.get('snippet') || '').trim(),
        url: String(record.get('url') || '').trim(),
        documentId: String(record.get('document_id') || '').trim(),
        fetchedAt: String(record.get('fetched_at') || '').trim() || null,
      }));
    graphResults += mappedRows.length;
    appendEvidenceRows(mappedRows, kept, seenDocs);
  }

  if (kept.length < TEMP_STABILIZATION_MAX_REPLY_EVIDENCE_NODES && turnId) {
    const turnResult = await session.run(
      `
        MATCH (doc:Document {project_id: $projectId})-[:HAS_CHUNK]->(chunk:Chunk)
        WHERE doc.document_id STARTS WITH $docPrefix
        RETURN
          '' AS entity_name,
          coalesce(doc.source_name, doc.document_id, 'Untitled') AS title,
          left(coalesce(chunk.text, doc.snippet, ''), $snippetChars) AS snippet,
          coalesce(doc.source_url, chunk.source_url, '') AS url,
          coalesce(doc.document_id, '') AS document_id,
          coalesce(doc.fetched_at, chunk.fetched_at, toString(doc.ingested_at), '') AS fetched_at
        ORDER BY coalesce(doc.fetched_at, chunk.fetched_at, toString(doc.ingested_at), '') DESC
        LIMIT toInteger($queryLimit)
      `,
      {
        projectId,
        docPrefix: `research:${turnId}`,
        queryLimit: TEMP_STABILIZATION_REPLY_QUERY_LIMIT,
        snippetChars: TEMP_STABILIZATION_REPLY_SNIPPET_CHARS,
      },
    );
    const mappedRows = turnResult.records.map((record: any) => ({
        entityName: String(record.get('entity_name') || '').trim(),
        title: String(record.get('title') || 'Untitled').trim(),
        snippet: String(record.get('snippet') || '').trim(),
        url: String(record.get('url') || '').trim(),
        documentId: String(record.get('document_id') || '').trim(),
        fetchedAt: String(record.get('fetched_at') || '').trim() || null,
      }));
    graphResults += mappedRows.length;
    appendEvidenceRows(mappedRows, kept, seenDocs);
  }

  const minGraphEvidenceRows = Math.min(2, TEMP_STABILIZATION_MAX_REPLY_EVIDENCE_NODES);
  const minGraphSourceDocs = Math.min(2, TEMP_STABILIZATION_MAX_REPLY_SOURCE_DOCS);
  const graphEvidenceWeak =
    graphResults === 0 ||
    kept.length < minGraphEvidenceRows ||
    seenDocs.size < minGraphSourceDocs;

  if (graphEvidenceWeak && kept.length < TEMP_STABILIZATION_MAX_REPLY_EVIDENCE_NODES) {
    try {
      const weightedRows = await retrieveWeightedSourceBackedEvidence(
        session,
        projectId,
        userMessage,
        attentionEdges,
        entityNames,
      );
      weightedResults = weightedRows.length;
      appendEvidenceRows(weightedRows, kept, seenDocs);
    } catch (err: any) {
      console.warn('[EvidenceRetrieval] weighted retrieval unavailable: %s', err?.message || String(err));
    }
  }

  const evidence = kept.slice(0, TEMP_STABILIZATION_MAX_REPLY_EVIDENCE_NODES);
  const mode: RetrievedEvidenceBundle['mode'] =
    graphResults > 0
      ? weightedResults > 0
        ? 'hybrid'
        : 'graph'
      : weightedResults > 0
        ? 'weighted_fallback'
        : 'graph';

  return {
    evidence,
    mode,
    weightedResults,
    graphResults,
  };
}

function buildReplyContext(userMessage: string, previousResponseId: string | null, evidence: RetrievedEvidence[]) {
  return {
    user_message: userMessage,
    previous_response_id: previousResponseId,
    evidence: evidence.map((item) => ({
      source_title: item.title,
      snippet: item.snippet,
      url: item.url,
    })),
  };
}

agentRoutes.post('/boss', async (req, res) => {
  const body = req.body || {};
  const { goal, query, q, domain } = body;
  const userText = typeof goal === 'string' ? goal : typeof query === 'string' ? query : typeof q === 'string' ? q : '';

  if (!userText || typeof userText !== 'string') {
    return res.status(400).json({ ok: false, error: "missing_goal", message: "Missing 'goal' (or 'query'/'q') in body" });
  }

  const project =
    (body.projectId || body.project_id || req.query?.projectId || req.query?.project_id || '').toString().trim();
  if (!project) {
    return res.status(400).json({ ok: false, error: 'missing_projectId', message: 'projectId required' });
  }

  try {
    const resolved = await resolveAgentConfig(project, 'llm_chat', '/api/agents/boss');
    if (!resolved) {
      return res.status(409).json({
        ok: false,
        error: 'assist_main_agent_missing',
        message: 'No agent configuration found for main chat.',
      });
    }

    let llmRes;
    const turnId =
      typeof body.turnId === 'string' && body.turnId.trim()
        ? body.turnId.trim()
        : `assist:${Date.now()}`;
    let researchEntityNames: string[] = [];
    let evidence: RetrievedEvidence[] = [];
    let evidenceMode: RetrievedEvidenceBundle['mode'] = 'disabled';
    let weightedEvidenceResults = 0;
    let graphEvidenceResults = 0;
    let researchDocumentCount = 0;
    const previousResponseId = lastResponseIdByProject.get(project) || resolved.previousResponseId || null;
    try {
      const thinkGraph = await runKgChatTurnNow({
        projectId: project,
        turnId,
        src: 'chat.auto',
        mode: 'assist',
        userText,
        assistantText: '',
      });
      console.log(
        '[ThinkGraph] projectId=%s entities=%d relationships=%d',
        project,
        thinkGraph.entities.length,
        thinkGraph.relationships.length,
      );

      const candidateEdges = buildCandidateEdges(userText, thinkGraph.entities, thinkGraph.relationships);
      researchEntityNames = Array.from(
        new Set([
          ...pickRecentEntityNames(userText, thinkGraph.entities, TEMP_STABILIZATION_MAX_PRIORITY_ENTITIES),
          ...candidateEdges.flatMap((edge) => [edge.entityA, edge.entityB]),
        ]),
      ).slice(0, TEMP_STABILIZATION_MAX_PRIORITY_ENTITIES);
      console.log(
        '[ThinkGraph] projectId=%s candidate_edges=%d priority_entities=%d',
        project,
        candidateEdges.length,
        researchEntityNames.length,
      );
      if (thinkGraph.relationships.length === 0 && candidateEdges.some((edge) => edge.source === 'fallback')) {
        console.log('[ThinkGraph] fallback synthesized %d candidate edges', candidateEdges.length);
      }

      const researchPacket = buildDebugResearchPacket(
        project,
        turnId,
        userText,
        candidateEdges,
        researchEntityNames,
      );
      console.log(
        '[ResearchPacket] projectId=%s edges=%d entities=%d tasks=%d',
        project,
        researchPacket.attentionEdges.length,
        researchPacket.priorityEntities.length,
        researchPacket.searchTasks.length,
      );

      try {
        const researchResult = await runResearchPacketForProject(project, researchPacket, turnId);
        researchDocumentCount = researchResult.ingested_document_count;
        console.log(
          '[Research] projectId=%s turnId=%s ingested_documents=%d',
          project,
          researchResult.turn_id,
          researchResult.ingested_document_count,
        );
      } catch (err: any) {
        console.warn('[Research] projectId=%s turnId=%s failed: %s', project, turnId, err?.message || String(err));
      }

      const neo4jCtx = await openNeo4jSession();
      try {
        if (neo4jCtx) {
          console.log(
            '[KnowGraphQuery] projectId=%s traversal=post_research candidate_edges=%d research_docs=%d',
            project,
            candidateEdges.length,
            researchDocumentCount,
          );
          const evidenceBundle = await retrieveKnowGraphEvidenceForTurn(
            neo4jCtx.session,
            project,
            userText,
            candidateEdges,
            researchEntityNames,
            turnId,
          );
          evidence = evidenceBundle.evidence;
          evidenceMode = evidenceBundle.mode;
          weightedEvidenceResults = evidenceBundle.weightedResults;
          graphEvidenceResults = evidenceBundle.graphResults;
        } else {
          evidence = [];
          evidenceMode = 'disabled';
        }
      } finally {
        if (neo4jCtx) {
          await neo4jCtx.session.close();
          await neo4jCtx.driver.close();
        }
      }
      console.log(
        '[EvidenceRetrieval] mode=%s strategy=graph_first_post_research projectId=%s results=%d weighted_results=%d graph_results=%d source_docs=%d',
        evidenceMode,
        project,
        evidence.length,
        weightedEvidenceResults,
        graphEvidenceResults,
        new Set(evidence.map((item) => item.documentId).filter(Boolean)).size,
      );
    } catch (err: any) {
      console.warn('[ASSIST_CHAT] pre-reply loop failed', {
        projectId: project,
        agent_id: resolved.agentId,
        error: err?.message || String(err),
      });
    }

    const replyContext = buildReplyContext(userText, previousResponseId, evidence);
    try {
      console.log(
        '[RUNTIME_MODEL] route=/api/agents/boss projectId=%s agentType=%s agent_id=%s provider=%s model_key=%s provider_model_id=%s',
        project,
        'llm_chat',
        resolved.agentId,
        resolved.provider,
        resolved.modelKey,
        resolved.providerModelId,
      );
      llmRes = await runLLM(
        [
          'Answer the user using the provided evidence when relevant.',
          'If the evidence is insufficient or only partially relevant, say so plainly.',
          '',
          'Reply context bundle:',
          JSON.stringify(replyContext, null, 2),
        ].join('\n'),
        {
          modelKey: resolved.modelKey,
          provider: resolved.provider,
          providerModelId: resolved.providerModelId,
          temperature: resolved.temperature ?? undefined,
          maxTokens: resolved.maxTokens ?? undefined,
          previousResponseId,
          useResponsesApi: resolved.provider === 'openai',
          system: [
            resolved.systemPrompt,
            'Use retrieved evidence snippets when relevant.',
            'Do not claim unsupported facts.',
            'When you rely on evidence, mention the source title or URL naturally.',
          ]
            .filter(Boolean)
            .join('\n\n'),
        },
      );
      if (typeof llmRes?.responseId === 'string' && llmRes.responseId.trim()) {
        lastResponseIdByProject.set(project, llmRes.responseId.trim());
      }
      console.log('[Reply] generated response', {
        projectId: project,
        evidence: evidence.length,
        used_previous_response_id: Boolean(previousResponseId),
      });
    } catch (err: any) {
      console.error('[ASSIST_CHAT] llm failed', { projectId: project, agent_id: resolved.agentId, error: err?.message });
      return res.status(502).json({ ok: false, error: 'assist_boss_failed', message: err?.message || 'agent failed' });
    }

    const finalText = (llmRes.text || '').trim();
    if (!finalText) {
      return res.status(502).json({ ok: false, error: 'empty_assistant_reply', message: 'assistant returned empty text' });
    }

    // Capture probability (fire-and-forget)
    void captureProbability({
      projectId: project,
      outputText: finalText
    }).catch(err => console.error('[ASSIST_CHAT] probability capture failed:', err));

    return res.json({
      ok: true,
      projectId: project,
      domain: domain ?? 'general',
      result: { final: finalText },
      model: llmRes.model,
      provider: llmRes.provider,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      message.includes('llm_chat_prompt_missing') ||
      message.includes('llm_chat_model_missing') ||
      message.includes('assist_main_prompt_missing')
    ) {
      return res.status(409).json({
        ok: false,
        error: message,
        message,
      });
    }
    console.error('[ASSIST_CHAT] unexpected failure', error);
    return res.status(502).json({
      ok: false,
      error: 'assist_boss_failed',
      message,
    });
  }
});

agentRoutes.get('/cards', async (_req, res) => {
  try {
    const cards = await listAgentCards();
    return res.json(cards);
  } catch (error) {
    console.error('[AGENT] list cards failed', error);
    return res.status(500).json({ ok: false, error: 'list failed' });
  }
});

// Alias for project list (used by Agent Builder drawer)
agentRoutes.get('/projects', async (_req, res) => {
  try {
    console.log('[AGENT] /projects called');
    const cards = await listAgentCards();
    console.log('[AGENT] /projects success, returned', cards?.length || 0, 'cards');
    return res.json(cards);
  } catch (error: any) {
    console.error('[AGENT] list projects failed:', {
      message: error?.message,
      name: error?.name,
      code: error?.code,
      stack: error?.stack,
    });
    return res.status(500).json({ 
      ok: false, 
      error: error?.message || 'list failed',
      details: {
        name: error?.name,
        code: error?.code,
      }
    });
  }
});

agentRoutes.post('/save', async (req, res) => {
  const cfg = req.body as AgentConfig;
  if (!cfg || typeof cfg.id !== 'string' || !cfg.id) {
    return res.status(400).json({ ok: false, error: 'id is required' });
  }
  try {
    const saved = await persistAgentConfig(cfg);
    return res.json(saved);
  } catch (error: unknown) {
    console.error('[AGENT] save config failed', error);
    if (error instanceof Error) {
      console.error('[AGENT] save config failed stack:', error.stack);
    }
    return res.status(500).json({ ok: false, error: 'save failed' });
  }
});

agentRoutes.get('/:id', async (req, res) => {
  const projectId = req.params.id;
  if (!projectId) {
    return res.status(400).json({ ok: false, error: 'id is required' });
  }
  try {
    const config = await fetchAgentConfig(projectId);
    return res.json(config);
  } catch (error: unknown) {
    console.error('[AGENT] get config failed', error);
    if (error instanceof Error) {
      console.error('[AGENT] get config failed stack:', error.stack);
    }
    return res.status(500).json({ ok: false, error: 'load failed' });
  }
});
