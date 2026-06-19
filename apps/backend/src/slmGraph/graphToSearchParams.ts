// Deterministic compiler: SLM graph result -> KnowGraph search params. No LLM, no
// planner. Same input always yields the same output (pure + testable).
import type { SlmGraphResult } from './slmGraphWorker';

export type SearchSourceType = 'web' | 'local' | 'thinkgraph' | 'knowgraph';

export type KnowGraphSearchParams = {
  query: string;
  seedEntities: string[];
  seedRelations: string[];
  sourceType: SearchSourceType;
  freshness: string; // ISO-8601 duration window, advisory
  depth: number;
  maxSources: number;
  stopCondition: string;
};

export type CompileOptions = {
  sourceType?: SearchSourceType;
  freshness?: string;
  maxDepth?: number;
  maxSourcesCap?: number;
};

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const t = String(v ?? '').trim();
    if (!t || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
  }
  return out;
}

/**
 * Compile a graph fragment into deterministic search params. seedEntities come from
 * entity labels, seedRelations from relation types; depth/maxSources scale with the
 * graph size within fixed caps; the query joins seeds + any next-seed candidates.
 */
export function compileSearchParams(
  graph: Pick<SlmGraphResult, 'entities' | 'relations' | 'nextSearchSeedCandidates'>,
  opts: CompileOptions = {},
): KnowGraphSearchParams {
  const maxDepth = Math.max(1, Math.trunc(opts.maxDepth ?? 3));
  const maxSourcesCap = Math.max(1, Math.trunc(opts.maxSourcesCap ?? 25));

  const seedEntities = dedupe((graph.entities || []).map((e) => e.label || e.id));
  const seedRelations = dedupe((graph.relations || []).map((r) => r.type));
  const seedCandidates = dedupe(graph.nextSearchSeedCandidates || []);

  // Deterministic query: entity seeds first, then relation types, then any explicit
  // next-seed candidates, joined stably.
  const queryParts = [...seedEntities, ...seedRelations, ...seedCandidates];
  const query = queryParts.join(' ');

  // Depth grows with relation count (more structure -> dig deeper), capped.
  const depth = Math.min(maxDepth, 1 + Math.min(seedRelations.length, maxDepth - 1));
  // maxSources grows with entity count, capped.
  const maxSources = Math.min(maxSourcesCap, Math.max(1, seedEntities.length * 3));

  return {
    query,
    seedEntities,
    seedRelations,
    sourceType: opts.sourceType ?? 'web',
    freshness: opts.freshness ?? 'P30D',
    depth,
    maxSources,
    stopCondition: 'budget_exhausted_or_no_new_entities',
  };
}
