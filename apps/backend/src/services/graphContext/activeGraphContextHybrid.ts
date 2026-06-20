// Hybrid KnowGraph retrieval for the EXISTING ActiveGraphContext (extends it; not a v2 stack).
// Combines: (A) the proven bounded anchor traversal, (B) Neo4j full-text retrieval over already-
// stored assertion/source text, (C) Neo4j vector retrieval ONLY through a real configured
// embedding path, and (D) one bounded one-hop expansion (CONTRADICTS) from selected results.
// Results merge into the same ActiveGraphContext (ranked + diversified + delta-aware), each item
// carrying its retrieval reason. No new graph DB, no new embedding vendor, no raw-text-to-Cypher
// (index names are fixed literals; the only user input is a parameterized Lucene query string),
// no whole-project scan. Vector is honestly reported unavailable when no embedding is configured.
import type { Driver } from 'neo4j-driver';
import { getNeo4jDriver } from '../../connectors/neo4j';
import { createOpenRouterEmbedding } from '../../llm/openrouterEmbeddings';
import {
  buildActiveGraphContext,
  compileGraphQueryIntent,
  readKnowGraphAnchorNeighborhood,
  type ActiveGraphContext,
  type ActiveGraphDeps,
  type ContextOutcome,
  type GraphQueryIntent,
  type KnowGraphNeighborhood,
  type NeighborhoodAssertion,
  type SelectedTaskInput,
} from './activeGraphContext';

export const KG_ASSERTION_FULLTEXT_INDEX = 'kg_assertion_fulltext';
export const KG_SOURCE_FULLTEXT_INDEX = 'kg_source_fulltext';
export const KG_ASSERTION_VECTOR_INDEX = 'kg_assertion_vec';

const ONE_HOP_REL_TYPES = ['CONTRADICTS'] as const; // bounded, selected relationship type only

function clean(v: unknown): string { return String(v ?? '').trim(); }
function lc(v: unknown): string { return clean(v).toLowerCase(); }

/** Lucene-escape + phrase-quote a term so user/anchor text can never inject query operators. */
function luceneTerm(term: string): string {
  const t = clean(term).replace(/[+\-!(){}\[\]^"~*?:\\/]|&&|\|\|/g, (m) => ` `).trim();
  if (!t) return '';
  return /\s/.test(t) ? `"${t}"` : t;
}
export function buildFullTextQuery(anchorLabels: string[], extraTerms: string[] = []): string {
  const terms = [...anchorLabels, ...extraTerms].map(luceneTerm).filter(Boolean);
  return Array.from(new Set(terms)).join(' OR ');
}

/** Is a REAL embedding path configured? (an embedding model env + the provider key). */
export function isEmbeddingConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  const model = clean(env.EMBEDDING_MODEL || env.OPENROUTER_EMBEDDING_MODEL);
  return Boolean(model && clean(env.OPENROUTER_API_KEY));
}

export type HybridDiagnostics = {
  exactCount: number;
  fulltextCount: number;
  vectorCount: number;
  vectorMode: 'ran' | 'unavailable';
  vectorBlocker?: string;
  expansionCount: number;
  mergedCount: number;
};

export type HybridRetrievalDeps = {
  driver?: Driver;
  env?: NodeJS.ProcessEnv;
  ensureIndexes?: boolean; // default true (idempotent)
  embed?: (text: string) => Promise<number[]>;
  // injectable per-source readers (for unit tests without a live DB)
  readExact?: (intent: GraphQueryIntent) => Promise<KnowGraphNeighborhood>;
  fullTextSearch?: (args: { projectId: string; query: string; limit: number }) => Promise<NeighborhoodAssertion[]>;
  vectorSearch?: (args: { projectId: string; embedding: number[]; limit: number }) => Promise<NeighborhoodAssertion[]>;
  oneHopExpand?: (args: { projectId: string; assertionIds: string[]; limit: number }) => Promise<NeighborhoodAssertion[]>;
};

// --- index management (idempotent) ----------------------------------------------

export async function ensureKnowGraphFullTextIndexes(deps: HybridRetrievalDeps = {}): Promise<{ ok: boolean; reason?: string }> {
  const driver = deps.driver ?? getNeo4jDriver();
  const session = driver.session();
  try {
    await session.run(`CREATE FULLTEXT INDEX ${KG_ASSERTION_FULLTEXT_INDEX} IF NOT EXISTS FOR (a:SourceBackedAssertion) ON EACH [a.subject, a.predicate, a.object, a.evidence_text, a.source_title]`);
    await session.run(`CREATE FULLTEXT INDEX ${KG_SOURCE_FULLTEXT_INDEX} IF NOT EXISTS FOR (s:Source) ON EACH [s.title, s.url]`);
    return { ok: true };
  } catch (err: any) {
    return { ok: false, reason: clean(err?.message) || 'fulltext_index_create_failed' };
  } finally {
    await session.close();
  }
}

export async function ensureKnowGraphVectorIndex(dimension: number, deps: HybridRetrievalDeps = {}): Promise<{ ok: boolean; reason?: string }> {
  const dim = Math.max(1, Math.trunc(dimension));
  const driver = deps.driver ?? getNeo4jDriver();
  const session = driver.session();
  try {
    await session.run(`CREATE VECTOR INDEX ${KG_ASSERTION_VECTOR_INDEX} IF NOT EXISTS FOR (a:SourceBackedAssertion) ON a.embedding OPTIONS { indexConfig: { \`vector.dimensions\`: ${dim}, \`vector.similarity_function\`: 'cosine' } }`);
    return { ok: true };
  } catch (err: any) {
    return { ok: false, reason: clean(err?.message) || 'vector_index_create_failed' };
  } finally {
    await session.close();
  }
}

// --- bounded reads ---------------------------------------------------------------

function mapAssertionRecord(rec: any, retrievalReasons: string[], score?: number): NeighborhoodAssertion {
  const outcomeRaw = lc(rec.get('outcome'));
  const outcome: ContextOutcome = outcomeRaw === 'supported' || outcomeRaw === 'contradicted' ? (outcomeRaw as ContextOutcome) : 'uncertain';
  const conf = Number(rec.get('confidence'));
  return {
    id: clean(rec.get('id')),
    subject: clean(rec.get('subject')),
    predicate: clean(rec.get('predicate')),
    object: clean(rec.get('object')),
    outcome,
    sourceRef: clean(rec.get('source_ref')) || undefined,
    sourceUrl: clean(rec.get('source_url')) || undefined,
    sourceTitle: clean(rec.get('source_title')) || undefined,
    confidence: Number.isFinite(conf) ? conf : (typeof score === 'number' ? Number(score.toFixed(3)) : undefined),
    anchorLabel: clean(rec.get('anchor_label')) || clean(rec.get('subject')),
    contradictsIds: (rec.get('contradicts_ids') as any[] | null)?.filter(Boolean).map(String) || [],
    retrievalReasons,
  };
}

const ASSERTION_RETURN = `RETURN node.id AS id, node.subject AS subject, node.predicate AS predicate, node.object AS object,
  node.outcome AS outcome, node.confidence AS confidence, node.source_ref AS source_ref,
  node.source_url AS source_url, node.source_title AS source_title, node.subject AS anchor_label,
  collect(DISTINCT c.id) AS contradicts_ids`;

async function defaultFullTextSearch(args: { projectId: string; query: string; limit: number }, deps: HybridRetrievalDeps): Promise<NeighborhoodAssertion[]> {
  if (!clean(args.query)) return [];
  const driver = deps.driver ?? getNeo4jDriver();
  const session = driver.session();
  const limit = Math.max(1, Math.min(args.limit, 25));
  try {
    const res = await session.run(
      `CALL db.index.fulltext.queryNodes('${KG_ASSERTION_FULLTEXT_INDEX}', $q) YIELD node, score
       WHERE node.project_id = $projectId AND node:SourceBackedAssertion
       OPTIONAL MATCH (node)-[:CONTRADICTS]->(c:SourceBackedAssertion)
       WITH node, score, collect(DISTINCT c.id) AS contradicts_ids
       ${ASSERTION_RETURN.replace('collect(DISTINCT c.id) AS contradicts_ids', 'contradicts_ids AS contradicts_ids')}, score AS score
       ORDER BY score DESC LIMIT ${limit}`,
      { q: args.query, projectId: args.projectId },
    );
    return res.records.map((r) => mapAssertionRecord(r, ['fulltext_exact_match'], Number(r.get('score'))));
  } catch (err: any) {
    return [];
  } finally {
    await session.close();
  }
}

async function defaultVectorSearch(args: { projectId: string; embedding: number[]; limit: number }, deps: HybridRetrievalDeps): Promise<NeighborhoodAssertion[]> {
  const driver = deps.driver ?? getNeo4jDriver();
  const session = driver.session();
  const limit = Math.max(1, Math.min(args.limit, 25));
  try {
    const res = await session.run(
      `CALL db.index.vector.queryNodes('${KG_ASSERTION_VECTOR_INDEX}', ${limit}, $embedding) YIELD node, score
       WHERE node.project_id = $projectId
       OPTIONAL MATCH (node)-[:CONTRADICTS]->(c:SourceBackedAssertion)
       WITH node, score, collect(DISTINCT c.id) AS contradicts_ids
       ${ASSERTION_RETURN.replace('collect(DISTINCT c.id) AS contradicts_ids', 'contradicts_ids AS contradicts_ids')}, score AS score
       ORDER BY score DESC`,
      { embedding: args.embedding, projectId: args.projectId },
    );
    return res.records.map((r) => mapAssertionRecord(r, ['semantic_similarity'], Number(r.get('score'))));
  } finally {
    await session.close();
  }
}

async function defaultOneHopExpand(args: { projectId: string; assertionIds: string[]; limit: number }, deps: HybridRetrievalDeps): Promise<NeighborhoodAssertion[]> {
  if (!args.assertionIds.length) return [];
  const driver = deps.driver ?? getNeo4jDriver();
  const session = driver.session();
  const limit = Math.max(1, Math.min(args.limit, 25));
  try {
    // ONE hop only, selected relationship type only (CONTRADICTS), project-scoped.
    const res = await session.run(
      `MATCH (a:SourceBackedAssertion { project_id: $projectId })
       WHERE a.id IN $ids
       MATCH (a)-[:\`${ONE_HOP_REL_TYPES[0]}\`]->(node:SourceBackedAssertion { project_id: $projectId })
       WHERE NOT node.id IN $ids
       OPTIONAL MATCH (node)-[:CONTRADICTS]->(c:SourceBackedAssertion)
       WITH DISTINCT node, collect(DISTINCT c.id) AS contradicts_ids
       ${ASSERTION_RETURN}
       LIMIT ${limit}`,
      { projectId: args.projectId, ids: args.assertionIds },
    );
    return res.records.map((r) => mapAssertionRecord(r, ['one_hop_connected_evidence']));
  } catch (err: any) {
    return [];
  } finally {
    await session.close();
  }
}

// --- merge + hybrid orchestration ------------------------------------------------

function mergeById(...lists: NeighborhoodAssertion[][]): NeighborhoodAssertion[] {
  const byId = new Map<string, NeighborhoodAssertion>();
  for (const list of lists) {
    for (const a of list) {
      if (!a.id) continue;
      const existing = byId.get(a.id);
      if (!existing) {
        byId.set(a.id, { ...a, retrievalReasons: Array.from(new Set(a.retrievalReasons || [])) });
      } else {
        existing.retrievalReasons = Array.from(new Set([...(existing.retrievalReasons || []), ...(a.retrievalReasons || [])]));
      }
    }
  }
  return Array.from(byId.values());
}

function applyExclusions(assertions: NeighborhoodAssertion[], intent: GraphQueryIntent): NeighborhoodAssertion[] {
  const seenIds = new Set((intent.excludeSeenNodeIds || []).map(String));
  const seenRefs = new Set((intent.excludeSeenSourceRefs || []).map(lc));
  return assertions.filter((a) => !seenIds.has(a.id) && !(a.sourceRef && seenRefs.has(lc(a.sourceRef))));
}

/**
 * Hybrid retrieval into the existing neighborhood shape (consumed by buildActiveGraphContext).
 * Returns merged assertions + diagnostics. Vector runs only through a real configured embedding
 * path (or an injected embed/vectorSearch); otherwise it reports the exact blocker.
 */
export async function retrieveHybridKnowGraphContext(
  intent: GraphQueryIntent,
  deps: HybridRetrievalDeps = {},
): Promise<{ neighborhood: KnowGraphNeighborhood; diagnostics: HybridDiagnostics }> {
  const env = deps.env ?? process.env;
  const projectId = clean(intent.projectId);
  const anchorLabels = intent.anchorLabels || [];

  if (deps.ensureIndexes !== false && !deps.fullTextSearch) {
    await ensureKnowGraphFullTextIndexes(deps).catch(() => undefined);
  }

  // A. exact anchored traversal (proven)
  const exactRes = await (deps.readExact ?? ((i: GraphQueryIntent) => readKnowGraphAnchorNeighborhood(i, deps)))(intent);
  const exact = exactRes.ok ? exactRes.assertions.map((a) => ({ ...a, retrievalReasons: Array.from(new Set([...(a.retrievalReasons || []), 'direct_task_anchor', a.sourceRef ? 'source_backed_assertion' : '']).values()).filter(Boolean) })) : [];

  // B. full-text
  const query = buildFullTextQuery(anchorLabels);
  const fullText = (deps.fullTextSearch ? await deps.fullTextSearch({ projectId, query, limit: intent.maxEvidence }) : await defaultFullTextSearch({ projectId, query, limit: intent.maxEvidence }, deps));

  // C. vector — ONLY through a real configured (or injected) embedding path
  let vector: NeighborhoodAssertion[] = [];
  let vectorMode: 'ran' | 'unavailable' = 'unavailable';
  let vectorBlocker: string | undefined;
  const embed = deps.embed ?? (isEmbeddingConfigured(env) ? (t: string) => createOpenRouterEmbedding(t, clean(env.EMBEDDING_MODEL || env.OPENROUTER_EMBEDDING_MODEL)) : undefined);
  if (embed) {
    try {
      const embedding = await embed(query || anchorLabels.join(' '));
      vector = deps.vectorSearch ? await deps.vectorSearch({ projectId, embedding, limit: intent.maxEvidence }) : await defaultVectorSearch({ projectId, embedding, limit: intent.maxEvidence }, deps);
      vectorMode = 'ran';
    } catch (err: any) {
      vectorMode = 'unavailable';
      vectorBlocker = `vector_unavailable: ${clean(err?.message) || err}`;
    }
  } else {
    vectorBlocker = 'embedding_not_configured: no EMBEDDING_MODEL/OPENROUTER_EMBEDDING_MODEL with OPENROUTER_API_KEY; existing createOpenRouterEmbedding helper is unwired and RAG embedding is mocked';
  }

  // merge A+B+C, exclude seen
  let merged = applyExclusions(mergeById(exact, fullText, vector), intent);

  // D. one-hop expansion (bounded) from the top merged assertion ids
  const topIds = merged.slice(0, Math.min(merged.length, 5)).map((a) => a.id);
  const expansion = (deps.oneHopExpand ? await deps.oneHopExpand({ projectId, assertionIds: topIds, limit: Math.max(2, Math.floor(intent.maxNodes / 2)) }) : await defaultOneHopExpand({ projectId, assertionIds: topIds, limit: Math.max(2, Math.floor(intent.maxNodes / 2)) }, deps));
  merged = applyExclusions(mergeById(merged, expansion), intent);

  const diagnostics: HybridDiagnostics = {
    exactCount: exact.length,
    fulltextCount: fullText.length,
    vectorCount: vector.length,
    vectorMode,
    vectorBlocker,
    expansionCount: expansion.length,
    mergedCount: merged.length,
  };
  return { neighborhood: { ok: true, assertions: merged }, diagnostics };
}

/**
 * Build an ActiveGraphContext using HYBRID retrieval (exact + full-text + optional vector +
 * one-hop), feeding the merged neighborhood into the existing buildActiveGraphContext so the
 * stable-summary + delta + rank + diversity behavior is unchanged. Returns the context plus
 * retrieval diagnostics (including the exact vector blocker when vector mode is unavailable).
 */
export async function buildActiveGraphContextHybrid(
  task: SelectedTaskInput,
  deps: HybridRetrievalDeps & ActiveGraphDeps = {},
  opts: { maxNodes?: number; maxEvidence?: number } = {},
): Promise<{ context: ActiveGraphContext; retrieval: HybridDiagnostics }> {
  const intent = compileGraphQueryIntent(task, opts);
  const { neighborhood, diagnostics } = await retrieveHybridKnowGraphContext(intent, deps);
  const context = await buildActiveGraphContext(task, { ...deps, readNeighborhood: async () => neighborhood }, opts);
  return { context, retrieval: diagnostics };
}
