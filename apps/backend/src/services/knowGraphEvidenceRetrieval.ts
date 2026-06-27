// @graph entity: KnowGraphEvidenceRetrieval
// @graph role: scoped-source-backed-evidence-read
// @graph relates_to: KnowGraphSourceStore, ContextPackBuilder
// @graph depends_on: Neo4j (KnowGraph)
//
// Smallest real KnowGraph scoped-evidence retrieval (Batch A). A thin, READ-ONLY
// backend adapter over the EXISTING proven KnowGraph substrate: the Neo4j
// `:SourceBackedAssertion` nodes and the existing `kg_assertion_fulltext`
// full-text index (the same index the Python hybrid-retrieval full-text channel
// uses). It returns source-backed evidence with full provenance, scoped by
// project_id (the Batch A boundary) so another project's rows can never surface.
//
// Deliberately NOT the full Python hybrid path: no vector/RRF fusion, no
// EmbeddingGemma, no Mag One, no Cypher writes, no text2cypher. Vector + rank
// fusion remain in the proven `services/knowgraph/hybrid_retrieval.py` tool path
// (out of scope for this batch). This adapter does exact full-text + project
// scope only — a real, honest subset, never a fabricated result.

import neo4j from 'neo4j-driver';
import type { Driver } from 'neo4j-driver';

const ASSERTION_FULLTEXT_INDEX = 'kg_assertion_fulltext';
const MAX_RESULTS_CEILING = 25;
// Lucene reserved characters that must be escaped for a full-text query.
const LUCENE_SPECIAL = /([+\-!(){}\[\]^"~*?:\\/]|&&|\|\|)/g;
// Read-only guard: the generated Cypher must contain no write clause.
const WRITE_CLAUSE_RE = /\b(MERGE|CREATE|SET|DELETE|DETACH|REMOVE|DROP)\b/i;

export type GroundedEvidenceItem = {
  assertionId: string;
  subject: string;
  predicate: string;
  object: string;
  outcome: string;
  confidence: number | null;
  sourceRef: string;
  sourceTitle: string;
  sourceUrl: string;
  evidence: string;
  retrievalSummary: string;
  createdAt: string;
  score: number;
};

export type EvidenceRetrievalRequest = {
  projectId: string;
  query: string;
  limit?: number;
};

/** Executes Cypher against KnowGraph (Neo4j), returning rows as plain objects. */
export type Neo4jRunner = (cypher: string, params: Record<string, unknown>) => Promise<Record<string, any>[]>;

let driver: Driver | null = null;
function getDriver(): Driver {
  if (driver) return driver;
  const uri = process.env.NEO4J_URI || 'bolt://localhost:7687';
  const user = process.env.NEO4J_USER || 'neo4j';
  const password = process.env.NEO4J_PASSWORD || 'changeme';
  driver = neo4j.driver(uri, neo4j.auth.basic(user, password));
  return driver;
}

export async function closeEvidenceDriver(): Promise<void> {
  if (driver) {
    const d = driver;
    driver = null;
    await d.close();
  }
}

const defaultRunner: Neo4jRunner = async (cypher, params) => {
  const session = getDriver().session({ defaultAccessMode: neo4j.session.READ });
  try {
    const result = await session.run(cypher, params);
    return result.records.map((r) => r.toObject());
  } finally {
    await session.close();
  }
};

export function luceneEscape(text: string): string {
  return String(text ?? '').replace(LUCENE_SPECIAL, '\\$1');
}

/** Build a bounded OR Lucene query from the request terms. Empty when no usable term. */
export function buildLuceneQuery(query: string): string {
  const terms = String(query ?? '')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2)
    .slice(0, 24)
    .map((t) => luceneEscape(t))
    .filter(Boolean);
  return terms.join(' OR ');
}

function toNumber(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  // neo4j Integer / float wrappers expose toNumber()
  if (typeof (value as any).toNumber === 'function') {
    const n = (value as any).toNumber();
    return Number.isFinite(n) ? n : null;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Retrieve project-scoped, source-backed evidence for a query. Read-only.
 * Returns [] (honest empty) when the project/query is blank or nothing matches —
 * never a generic model summary, never another project's rows.
 */
export async function retrieveGroundedEvidence(
  req: EvidenceRetrievalRequest,
  deps: { run?: Neo4jRunner } = {},
): Promise<GroundedEvidenceItem[]> {
  const projectId = String(req.projectId || '').trim();
  if (!projectId) return [];
  const lucene = buildLuceneQuery(req.query);
  if (!lucene) return [];
  const limit = Math.min(Math.max(Math.trunc(req.limit ?? 5) || 5, 1), MAX_RESULTS_CEILING);
  const run = deps.run ?? defaultRunner;

  // Full-text retrieval over the existing index, then HARD project scope so
  // cross-project rows can never surface. LIMIT is an inlined sanitized int.
  const cypher = `
    CALL db.index.fulltext.queryNodes($index, $lucene) YIELD node, score
    WHERE node.project_id = $projectId
    RETURN
      node.id AS id, node.subject AS subject, node.predicate AS predicate,
      node.object AS object, node.outcome AS outcome, node.confidence AS confidence,
      node.source_ref AS source_ref, node.source_title AS source_title,
      node.source_url AS source_url, node.evidence_text AS evidence_text,
      node.retrieval_summary AS retrieval_summary, node.created_at AS created_at,
      score AS score
    ORDER BY score DESC
    LIMIT ${limit}
  `;
  if (WRITE_CLAUSE_RE.test(cypher)) {
    // Defensive: this capability is read-only by contract.
    throw new Error('knowgraph_evidence_read_only_violation');
  }

  const rows = await run(cypher, { index: ASSERTION_FULLTEXT_INDEX, lucene, projectId });
  return rows.map((row) => ({
    assertionId: String(row.id ?? ''),
    subject: String(row.subject ?? ''),
    predicate: String(row.predicate ?? ''),
    object: String(row.object ?? ''),
    outcome: String(row.outcome ?? ''),
    confidence: toNumber(row.confidence),
    sourceRef: String(row.source_ref ?? ''),
    sourceTitle: String(row.source_title ?? ''),
    sourceUrl: String(row.source_url ?? ''),
    evidence: String(row.evidence_text ?? ''),
    retrievalSummary: String(row.retrieval_summary ?? ''),
    createdAt: String(row.created_at ?? ''),
    score: toNumber(row.score) ?? 0,
  }));
}
