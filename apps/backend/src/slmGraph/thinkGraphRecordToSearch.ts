// Smallest adapter: a stored ThinkGraph :SlmGraphRecord (read back via
// readThinkGraphSemanticRecord) -> the existing deterministic graph-to-search compiler
// input -> deterministic search params. No LLM, no search call, no second compiler.
// Pure parameter generation. Type-only import of the stored-record type keeps this off
// the DB runtime path.
import {
  compileSearchParams,
  type CompileOptions,
  type KnowGraphSearchParams,
} from './graphToSearchParams';
import type { StoredThinkGraphSemanticRecord } from '../services/thinkgraph/thinkgraphMemory';

/** The stored-record fields this adapter reads. */
export type ThinkGraphRecordSearchInput = Pick<
  StoredThinkGraphSemanticRecord,
  'projectId' | 'sourceRef' | 'entities' | 'relations' | 'categories' | 'confidence' | 'uncertainty'
>;

export type ThinkGraphSearchSeedResult = {
  /** false when the record carries no usable entity/relation (honest empty). */
  ok: boolean;
  projectId: string;
  sourceRef: string;
  searchParams: KnowGraphSearchParams;
  // Provenance of the seed material.
  entityLabels: string[];
  relationTypes: string[];
  categories: string[];
};

/**
 * Convert a stored ThinkGraph record into deterministic graph-to-search params via the
 * existing `compileSearchParams`. entity labels -> seedEntities, relation types ->
 * seedRelations, categories -> next-seed candidates (so they appear in the query).
 * sourceRef/projectId are preserved as provenance. Same record always yields the same
 * params. Returns ok:false (honest empty) when there is no entity/relation content.
 */
export function storedThinkGraphRecordToSearchParams(
  record: ThinkGraphRecordSearchInput,
  opts: CompileOptions = {},
): ThinkGraphSearchSeedResult {
  const entities = Array.isArray(record.entities) ? record.entities : [];
  const relations = Array.isArray(record.relations) ? record.relations : [];
  const categories = Array.isArray(record.categories) ? record.categories : [];

  const searchParams = compileSearchParams(
    {
      entities: entities.map((e) => ({ id: e.id, label: e.label, type: e.type })),
      relations: relations.map((r) => ({ from: r.from, to: r.to, type: r.type })),
      // Categories become deterministic next-seed candidates so they influence the query.
      nextSearchSeedCandidates: categories,
    },
    opts,
  );

  return {
    ok: entities.length > 0 || relations.length > 0,
    projectId: String(record.projectId || ''),
    sourceRef: String(record.sourceRef || ''),
    searchParams,
    entityLabels: entities.map((e) => e.label),
    relationTypes: relations.map((r) => r.type),
    categories,
  };
}
