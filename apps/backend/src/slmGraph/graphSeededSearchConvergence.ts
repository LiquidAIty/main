// Deterministic graph-seeded research convergence primitive. Pure: NO LLM, NO web, NO
// crawler, NO Docker Gemma. Given GRAPH-DERIVED seed data (entities/relations/classes from an
// existing graph record — never raw user-text intent), it compiles bounded search tasks, and
// scores convergence across normalized search-agent result packets (repeated entities/
// relations/sourceRefs, stable classes, falling novelty, unresolved contradictions) to decide
// whether a search swarm has started bumping into the same neighborhoods. Same input always
// yields the same output (testable). It never asserts unknown facts (e.g. a live price).
import type { SlmGraphExtraction } from './slmGraphWorker';

export type GraphSearchSeed = {
  projectId?: string;
  sourceRef?: string;
  seedEntities: string[];
  seedRelations: string[];
  seedClasses?: string[];
  nextSearchSeedCandidates?: string[];
  freshness?: string;
  depth?: number;
  maxSources?: number;
};

export type GraphSeededSearchTaskKind =
  | 'entity'
  | 'relation'
  | 'class_neighborhood'
  | 'contradiction'
  | 'missing_source_ref'
  | 'freshness';

export type GraphSeededSearchTask = {
  id: string;
  kind: GraphSeededSearchTaskKind;
  query: string;
  seedRefs: { entities?: string[]; relations?: string[]; classes?: string[] };
};

export type SearchAgentResultPacket = {
  agentId: string;
  searchTaskId: string;
  query: string;
  sourceRefs: Array<{ ref: string; url?: string; title?: string; sourceType?: string }>;
  entities: Array<{ label: string; type?: string; confidence?: number }>;
  relations: Array<{ from?: string; to?: string; type: string; confidence?: number }>;
  claims?: Array<{ subject?: string; predicate?: string; object?: string; sourceRef?: string; confidence?: number }>;
  uncertainty?: string[];
};

export type ResearchConvergenceReport = {
  converged: boolean;
  convergenceScore: number;
  repeatedEntities: string[];
  repeatedRelations: string[];
  overlappingSourceRefs: string[];
  stableClasses: string[];
  noveltyScore: number;
  unresolvedContradictions: string[];
  nextSearchSeedCandidates: string[];
  stopReason?: 'converged' | 'low_novelty' | 'max_depth' | 'needs_more_sources' | 'blocked';
};

// --- helpers ---------------------------------------------------------------------

function norm(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

function humanize(value: unknown): string {
  return String(value ?? '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function dedupeStable(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

/**
 * Build a GraphSearchSeed from a graph extraction (ThinkGraph/KnowGraph record shape). Entity
 * labels -> seedEntities, relation types -> seedRelations, entity types -> seedClasses. This
 * is the bridge that guarantees seeds come from GRAPH DATA, not raw user text.
 */
export function graphSearchSeedFromExtraction(
  extraction: Pick<SlmGraphExtraction, 'entities' | 'relations' | 'nextSearchSeedCandidates'> & {
    sourceRefs?: Array<{ ref: string }>;
  },
  opts: { projectId?: string; sourceRef?: string; freshness?: string } = {},
): GraphSearchSeed {
  const entities = Array.isArray(extraction.entities) ? extraction.entities : [];
  const relations = Array.isArray(extraction.relations) ? extraction.relations : [];
  return {
    projectId: opts.projectId,
    sourceRef: opts.sourceRef || extraction.sourceRefs?.[0]?.ref,
    seedEntities: dedupeStable(entities.map((e) => e.label || e.id)),
    seedRelations: dedupeStable(relations.map((r) => r.type)),
    seedClasses: dedupeStable(entities.map((e) => e.type)),
    nextSearchSeedCandidates: dedupeStable(extraction.nextSearchSeedCandidates || []),
    freshness: opts.freshness,
  };
}

const MAX_ENTITY_TASKS = 8;
const MAX_RELATION_TASKS = 8;

/**
 * Compile a graph seed into bounded, deterministic search tasks. NOT user-intent
 * classification — every task is woven from the seed's entities/relations/classes. Tasks:
 * per-entity, per-relation, one class-neighborhood, one contradiction, per-entity
 * missing-sourceRef, and one freshness task. Bounded by fixed caps.
 */
export function buildGraphSeededSearchTasks(seed: GraphSearchSeed): GraphSeededSearchTask[] {
  const entities = dedupeStable(seed.seedEntities).slice(0, MAX_ENTITY_TASKS);
  const relations = dedupeStable(seed.seedRelations).slice(0, MAX_RELATION_TASKS);
  const classes = dedupeStable(seed.seedClasses || []);
  const relationTerms = relations.map(humanize).filter(Boolean);
  const classTerms = classes.map(humanize).filter(Boolean);
  const tasks: GraphSeededSearchTask[] = [];

  // Entity tasks: each entity + the relation/class themes from its own graph neighborhood.
  entities.forEach((entity, index) => {
    const query = dedupeStable([entity, ...relationTerms.slice(0, 3), ...classTerms.slice(0, 2)]).join(' ');
    tasks.push({ id: `t_entity_${index + 1}`, kind: 'entity', query, seedRefs: { entities: [entity], relations: relations.slice(0, 3), classes } });
  });

  // Relation tasks: each relation type across the seed entities.
  relations.forEach((relation, index) => {
    const query = dedupeStable([...entities.slice(0, 3), humanize(relation)]).join(' ');
    tasks.push({ id: `t_relation_${index + 1}`, kind: 'relation', query, seedRefs: { entities: entities.slice(0, 3), relations: [relation] } });
  });

  // Class-neighborhood task: classes + entities -> related public/adjacent neighborhood.
  if (classTerms.length > 0 || entities.length > 0) {
    const query = dedupeStable([...classTerms, ...entities.slice(0, 3), 'related', 'neighborhood']).join(' ');
    tasks.push({ id: 't_class_neighborhood', kind: 'class_neighborhood', query, seedRefs: { entities: entities.slice(0, 3), classes } });
  }

  // Contradiction task: look for conflicting evidence about the seed entities.
  if (entities.length > 0) {
    const query = dedupeStable([...entities.slice(0, 3), 'contradiction', 'conflicting', 'evidence']).join(' ');
    tasks.push({ id: 't_contradiction', kind: 'contradiction', query, seedRefs: { entities: entities.slice(0, 3) } });
  }

  // Missing-sourceRef tasks: per entity, hunt for a citable source / timestamp.
  entities.forEach((entity, index) => {
    const query = dedupeStable([entity, 'sourceRef', 'citation', 'source', 'timestamp']).join(' ');
    tasks.push({ id: `t_source_${index + 1}`, kind: 'missing_source_ref', query, seedRefs: { entities: [entity] } });
  });

  // Freshness task: latest/current state of the entities within the freshness window.
  if (entities.length > 0) {
    const fresh = humanize(seed.freshness || '');
    const query = dedupeStable([...entities.slice(0, 3), 'latest', 'current', 'update', fresh]).join(' ');
    tasks.push({ id: 't_freshness', kind: 'freshness', query, seedRefs: { entities: entities.slice(0, 3) } });
  }

  return tasks;
}

// --- convergence detection -------------------------------------------------------

function entityKey(label: unknown): string {
  return norm(label);
}
function relationKey(type: unknown): string {
  return norm(type);
}
function refKey(ref: { ref?: string; url?: string }): string {
  return norm(ref.url || ref.ref);
}
function refDomain(ref: { url?: string }): string | null {
  const url = String(ref.url || '').trim();
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return null;
  }
}

/** Items appearing in >=2 distinct packets (deduped within each packet first). */
function repeatedAcrossPackets<T>(
  packets: SearchAgentResultPacket[],
  extract: (p: SearchAgentResultPacket) => string[],
  display: (key: string) => string,
): string[] {
  const packetCount = new Map<string, number>();
  const displayByKey = new Map<string, string>();
  for (const packet of packets) {
    const keys = new Set(extract(packet).filter(Boolean));
    for (const key of keys) {
      packetCount.set(key, (packetCount.get(key) || 0) + 1);
      if (!displayByKey.has(key)) displayByKey.set(key, display(key));
    }
  }
  return Array.from(packetCount.entries())
    .filter(([, count]) => count >= 2)
    .map(([key]) => displayByKey.get(key) || key);
}

function noveltyOf(packet: SearchAgentResultPacket, known: Set<string>): number {
  const items = [
    ...packet.entities.map((e) => `e:${entityKey(e.label)}`),
    ...packet.relations.map((r) => `r:${relationKey(r.type)}`),
    ...packet.sourceRefs.map((s) => `s:${refKey(s)}`),
  ].filter((x) => x.length > 2);
  if (items.length === 0) return 0;
  let fresh = 0;
  for (const item of items) if (!known.has(item)) fresh += 1;
  return fresh / items.length;
}

/**
 * Detect convergence across search-agent result packets seeded from graph memory. Pure +
 * deterministic. converged only when overlap is high, novelty has fallen, and there are no
 * unresolved contradictions. Always returns next search seeds for the gaps. Never invents
 * facts — it reports repetition and gaps, not answers.
 */
export function detectSearchConvergence(
  packets: SearchAgentResultPacket[],
  seed?: GraphSearchSeed,
  opts: { convergeScore?: number; lowNovelty?: number; maxDepth?: number } = {},
): ResearchConvergenceReport {
  const list = Array.isArray(packets) ? packets.filter(Boolean) : [];
  const convergeThreshold = opts.convergeScore ?? 0.7;
  const lowNovelty = opts.lowNovelty ?? 0.2;

  const repeatedEntities = repeatedAcrossPackets(
    list,
    (p) => p.entities.map((e) => entityKey(e.label)),
    (key) => {
      for (const p of list) for (const e of p.entities) if (entityKey(e.label) === key) return e.label;
      return key;
    },
  );
  const repeatedRelations = repeatedAcrossPackets(
    list,
    (p) => p.relations.map((r) => relationKey(r.type)),
    (key) => {
      for (const p of list) for (const r of p.relations) if (relationKey(r.type) === key) return r.type;
      return key;
    },
  );
  const overlappingSourceRefs = repeatedAcrossPackets(
    list,
    (p) => p.sourceRefs.map((s) => refDomain(s) || refKey(s)),
    (key) => key,
  );
  // Stable classes = entity types corroborated across >=2 packets (class neighborhoods).
  const stableClasses = repeatedAcrossPackets(
    list,
    (p) => p.entities.map((e) => norm(e.type)).filter(Boolean),
    (key) => {
      for (const p of list) for (const e of p.entities) if (norm(e.type) === key) return String(e.type);
      return key;
    },
  );

  // Novelty of the latest packet against everything seen before it (falls as agents repeat).
  let noveltyScore = 1;
  if (list.length >= 1) {
    const known = new Set<string>();
    for (let i = 0; i < list.length - 1; i += 1) {
      const p = list[i];
      p.entities.forEach((e) => known.add(`e:${entityKey(e.label)}`));
      p.relations.forEach((r) => known.add(`r:${relationKey(r.type)}`));
      p.sourceRefs.forEach((s) => known.add(`s:${refKey(s)}`));
    }
    noveltyScore = list.length >= 2 ? noveltyOf(list[list.length - 1], known) : 1;
  }

  // Unresolved contradictions: same subject+predicate, different object across claims.
  const claimByKey = new Map<string, Set<string>>();
  for (const p of list) {
    for (const c of p.claims || []) {
      const subject = norm(c.subject);
      const predicate = norm(c.predicate);
      const object = norm(c.object);
      if (!subject || !predicate || !object) continue;
      const key = `${subject}|${predicate}`;
      if (!claimByKey.has(key)) claimByKey.set(key, new Set());
      claimByKey.get(key)!.add(object);
    }
  }
  const unresolvedContradictions = Array.from(claimByKey.entries())
    .filter(([, objects]) => objects.size >= 2)
    .map(([key, objects]) => `${key.replace('|', ' ')} -> {${Array.from(objects).join(' | ')}}`);

  // Overlap ratios -> convergence score.
  const distinctEntities = new Set(list.flatMap((p) => p.entities.map((e) => entityKey(e.label)).filter(Boolean)));
  const distinctRelations = new Set(list.flatMap((p) => p.relations.map((r) => relationKey(r.type)).filter(Boolean)));
  const distinctRefs = new Set(list.flatMap((p) => p.sourceRefs.map((s) => refDomain(s) || refKey(s)).filter(Boolean)));
  const ratio = (n: number, d: number) => (d > 0 ? n / d : 0);
  const convergenceScore = Number(
    (
      0.4 * ratio(repeatedEntities.length, distinctEntities.size) +
      0.3 * ratio(repeatedRelations.length, distinctRelations.size) +
      0.3 * ratio(overlappingSourceRefs.length, distinctRefs.size)
    ).toFixed(3),
  );

  // Next search seeds for the gaps: entities seen only once (need corroboration), unresolved
  // contradictions, and any seed candidates carried forward. Pure terms, never asserted facts.
  const singletons: string[] = [];
  {
    const count = new Map<string, { label: string; n: number }>();
    for (const p of list) {
      const seen = new Set<string>();
      for (const e of p.entities) {
        const key = entityKey(e.label);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        const cur = count.get(key) || { label: e.label, n: 0 };
        cur.n += 1;
        count.set(key, cur);
      }
    }
    for (const { label, n } of count.values()) if (n === 1) singletons.push(`corroborate ${label}`);
  }
  const nextSearchSeedCandidates = dedupeStable([
    ...singletons,
    ...unresolvedContradictions.map((c) => `resolve ${c}`),
    ...(seed?.nextSearchSeedCandidates || []),
  ]).slice(0, 12);

  const enoughSupport = convergenceScore >= convergeThreshold && unresolvedContradictions.length === 0;
  const converged = enoughSupport && noveltyScore <= lowNovelty;
  let stopReason: ResearchConvergenceReport['stopReason'];
  if (converged) stopReason = 'converged';
  else if (noveltyScore <= lowNovelty && !enoughSupport) stopReason = 'low_novelty';
  else stopReason = 'needs_more_sources';

  return {
    converged,
    convergenceScore,
    repeatedEntities,
    repeatedRelations,
    overlappingSourceRefs,
    stableClasses,
    noveltyScore: Number(noveltyScore.toFixed(3)),
    unresolvedContradictions,
    nextSearchSeedCandidates,
    stopReason,
  };
}
