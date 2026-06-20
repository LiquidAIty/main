// Compact, task-scoped, relevance-ranked ActiveGraphContext with progressive deltas. This is
// the small ROLLING working context for ONE selected task — NOT a whole-graph dump. It reads a
// BOUNDED KnowGraph neighborhood around the task's known anchors (the source-backed assertion
// subgraph: SourceBackedAssertion -RELATES_TO_ENTITY-> ObservedEntity, -ASSERTED_BY_SOURCE->
// Source, -CONTRADICTS->), keeps a stable summary, and adds only newly relevant material as a
// delta on later updates. Reuses the existing Neo4j singleton + readers; no second graph stack,
// no broad `MATCH (n {project_id})` read, no raw-text-to-Cypher, no vectors/ML/ranker package.
import type { Driver } from 'neo4j-driver';
import { getNeo4jDriver } from '../../connectors/neo4j';

export type ContextOutcome = 'supported' | 'contradicted' | 'uncertain';

export type ActiveGraphAnchor = { id: string; label: string; type?: string; reason: string };
export type ActiveGraphFact = { subject: string; predicate: string; object: string; outcome: ContextOutcome; sourceRef?: string; confidence?: number };
export type ActiveGraphRelation = { from: string; to: string; type: string; outcome?: ContextOutcome; sourceRef?: string };
export type ActiveGraphEvidence = { sourceRef: string; title?: string; url?: string; summary?: string; reason: string };
export type ActiveCodeContext = { path: string; reason: string; symbols?: string[] };

export type ActiveGraphContext = {
  projectId: string;
  taskId?: string;
  graphRevision?: string;
  anchors: ActiveGraphAnchor[];
  facts: ActiveGraphFact[];
  relations: ActiveGraphRelation[];
  evidence: ActiveGraphEvidence[];
  unresolvedQuestions: string[];
  contradictions: string[];
  codeContext?: ActiveCodeContext[];
  stableSummary: string;
  delta: {
    addedAnchors: string[];
    addedFacts: string[];
    addedEvidenceRefs: string[];
    addedQuestions: string[];
    removedAsCold: string[];
  };
  sourceStats: { thinkGraph: number; knowGraph: number; codeGraph: number };
};

export type GraphQueryIntentInclude =
  | 'supported_assertions'
  | 'contradictions'
  | 'uncertainties'
  | 'recent_sources'
  | 'related_entities'
  | 'code_context';

export type GraphQueryIntent = {
  projectId: string;
  taskId?: string;
  anchorLabels: string[];
  anchorIds?: string[];
  relationTypes?: string[];
  labels?: string[];
  maxHops: 1 | 2;
  maxNodes: number;
  maxEvidence: number;
  include: GraphQueryIntentInclude[];
  excludeSeenNodeIds?: string[];
  excludeSeenSourceRefs?: string[];
};

// --- helpers ---------------------------------------------------------------------

function clean(v: unknown): string { return String(v ?? '').trim(); }
function lc(v: unknown): string { return clean(v).toLowerCase(); }
function dedupeStable(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const t = clean(v);
    if (!t || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
  }
  return out;
}
function domainOf(url?: string): string {
  const u = clean(url);
  if (!u) return '';
  try { return new URL(u).hostname.replace(/^www\./i, '').toLowerCase(); } catch { return u.toLowerCase(); }
}
export function factKey(f: { subject: string; predicate: string; object: string; sourceRef?: string }): string {
  return `${lc(f.subject)}|${lc(f.predicate)}|${lc(f.object)}|${lc(f.sourceRef)}`;
}

const DEFAULT_MAX_NODES = 12;
const DEFAULT_MAX_EVIDENCE = 8;
const DEFAULT_CONTEXT_BUDGET = 24; // total facts+evidence+questions kept in the prompt context

/** Selected-task signals (NOT raw chat). The task/planner supplies anchors + requested
 *  inclusion. This compiles them into a bounded retrieval intent — never a text intent classifier. */
export type SelectedTaskInput = {
  projectId: string;
  taskId?: string;
  anchors: Array<{ id?: string; label: string; type?: string }>;
  isCodeTask?: boolean;
  requestsCodeContext?: boolean;
  relationTypes?: string[];
  freshnessMatters?: boolean;
};

export function compileGraphQueryIntent(task: SelectedTaskInput, opts: { maxNodes?: number; maxEvidence?: number; excludeSeenNodeIds?: string[]; excludeSeenSourceRefs?: string[] } = {}): GraphQueryIntent {
  const include: GraphQueryIntentInclude[] = ['supported_assertions', 'contradictions', 'uncertainties', 'recent_sources', 'related_entities'];
  // CodeGraph is opt-in: only when the SELECTED task is a code/repo task or explicitly asks.
  if (task.isCodeTask || task.requestsCodeContext) include.push('code_context');
  return {
    projectId: clean(task.projectId),
    taskId: task.taskId,
    anchorLabels: dedupeStable(task.anchors.map((a) => a.label)),
    anchorIds: dedupeStable(task.anchors.map((a) => a.id)),
    relationTypes: dedupeStable(task.relationTypes || []),
    maxHops: 1,
    maxNodes: Math.max(1, Math.min(opts.maxNodes ?? DEFAULT_MAX_NODES, 50)),
    maxEvidence: Math.max(1, Math.min(opts.maxEvidence ?? DEFAULT_MAX_EVIDENCE, 30)),
    include,
    excludeSeenNodeIds: dedupeStable(opts.excludeSeenNodeIds || []),
    excludeSeenSourceRefs: dedupeStable(opts.excludeSeenSourceRefs || []),
  };
}

// --- bounded KnowGraph anchored read --------------------------------------------

export type NeighborhoodAssertion = {
  id: string;
  subject: string;
  predicate: string;
  object: string;
  outcome: ContextOutcome;
  sourceRef?: string;
  sourceUrl?: string;
  sourceTitle?: string;
  confidence?: number;
  anchorLabel: string;
  contradictsIds: string[];
  /** Why this node was retrieved (e.g. fulltext_exact_match, semantic_similarity,
   *  one_hop_connected_evidence). Folded into the rank reasons. Hybrid retrieval sets these. */
  retrievalReasons?: string[];
};

export type KnowGraphNeighborhood =
  | { ok: true; assertions: NeighborhoodAssertion[] }
  | { ok: false; reason: string };

export type ActiveGraphDeps = {
  driver?: Driver;
  readNeighborhood?: (intent: GraphQueryIntent) => Promise<KnowGraphNeighborhood>;
  readThinkGraph?: (projectId: string, anchors: string[]) => Promise<{ ok: boolean; facts: Array<{ label: string }> }>;
  readCodeContext?: (intent: GraphQueryIntent) => Promise<{ ok: boolean; files: ActiveCodeContext[] }>;
};

/**
 * Read a BOUNDED assertion neighborhood around the anchor entities only. Never a broad
 * project-wide scan: it starts from ObservedEntity nodes matching the task anchors, walks one
 * hop to their SourceBackedAssertions, and pulls each assertion's source + contradiction ids.
 * Excludes already-seen nodes/sourceRefs and caps results.
 */
export async function readKnowGraphAnchorNeighborhood(intent: GraphQueryIntent, deps: ActiveGraphDeps = {}): Promise<KnowGraphNeighborhood> {
  const projectId = clean(intent.projectId);
  const anchorLabels = (intent.anchorLabels || []).map(lc).filter(Boolean);
  if (!projectId || anchorLabels.length === 0) return { ok: true, assertions: [] };

  const driver = deps.driver ?? getNeo4jDriver();
  const database = clean(process.env.NEO4J_DATABASE);
  const session = driver.session(database ? { database } : undefined);
  const maxNodes = Math.max(1, Math.min(intent.maxNodes || DEFAULT_MAX_NODES, 50));
  try {
    const res = await session.run(
      `MATCH (e:ObservedEntity { project_id: $projectId })
       WHERE e.label_lc IN $anchorLabels
       MATCH (a:SourceBackedAssertion { project_id: $projectId })-[:RELATES_TO_ENTITY]->(e)
       WHERE NOT a.id IN $excludeIds
       OPTIONAL MATCH (a)-[:ASSERTED_BY_SOURCE]->(s:Source)
       OPTIONAL MATCH (a)-[:CONTRADICTS]->(c:SourceBackedAssertion)
       RETURN a.id AS id, a.subject AS subject, a.predicate AS predicate, a.object AS object,
         a.outcome AS outcome, a.confidence AS confidence, a.source_ref AS source_ref,
         a.source_url AS source_url, a.source_title AS source_title, e.label AS anchor_label,
         collect(DISTINCT c.id) AS contradicts_ids
       ORDER BY a.outcome, a.id
       LIMIT ${maxNodes}`,
      { projectId, anchorLabels, excludeIds: intent.excludeSeenNodeIds || [] },
    );
    const excludeRefs = new Set((intent.excludeSeenSourceRefs || []).map(lc));
    const assertions: NeighborhoodAssertion[] = [];
    for (const rec of res.records) {
      const sourceRef = clean(rec.get('source_ref'));
      if (sourceRef && excludeRefs.has(sourceRef.toLowerCase())) continue;
      const outcomeRaw = lc(rec.get('outcome'));
      const outcome: ContextOutcome = outcomeRaw === 'supported' || outcomeRaw === 'contradicted' ? (outcomeRaw as ContextOutcome) : 'uncertain';
      const confidenceNum = Number(rec.get('confidence'));
      assertions.push({
        id: clean(rec.get('id')),
        subject: clean(rec.get('subject')),
        predicate: clean(rec.get('predicate')),
        object: clean(rec.get('object')),
        outcome,
        sourceRef: sourceRef || undefined,
        sourceUrl: clean(rec.get('source_url')) || undefined,
        sourceTitle: clean(rec.get('source_title')) || undefined,
        confidence: Number.isFinite(confidenceNum) ? confidenceNum : undefined,
        anchorLabel: clean(rec.get('anchor_label')),
        contradictsIds: (rec.get('contradicts_ids') as any[] | null)?.filter(Boolean).map(String) || [],
      });
    }
    return { ok: true, assertions };
  } catch (err: any) {
    return { ok: false, reason: clean(err?.message) || 'knowgraph_neighborhood_read_failed' };
  } finally {
    await session.close();
  }
}

// --- relevance ranking + diversity ----------------------------------------------

export type RankedAssertion = NeighborhoodAssertion & { score: number; reasons: string[] };

/** Simple explainable scorer. Higher = more relevant to the selected task. */
export function rankNeighborhood(assertions: NeighborhoodAssertion[], ctx: { anchorLabels: string[]; previousFactKeys?: Set<string> }): RankedAssertion[] {
  const anchorSet = new Set(ctx.anchorLabels.map(lc));
  const prev = ctx.previousFactKeys ?? new Set<string>();
  // anchor co-occurrence: how many anchors each subject touches across the set
  const anchorCountBySubject = new Map<string, Set<string>>();
  for (const a of assertions) {
    const k = lc(a.subject);
    if (!anchorCountBySubject.has(k)) anchorCountBySubject.set(k, new Set());
    if (a.anchorLabel) anchorCountBySubject.get(k)!.add(lc(a.anchorLabel));
  }
  return assertions
    .map((a) => {
      const reasons: string[] = [...(a.retrievalReasons || [])];
      let score = 0;
      if (reasons.includes('fulltext_exact_match')) score += 2;
      if (reasons.includes('semantic_similarity')) score += 2;
      if (reasons.includes('one_hop_connected_evidence')) score += 1;
      if (anchorSet.has(lc(a.anchorLabel)) || anchorSet.has(lc(a.subject))) { score += 3; reasons.push(`anchored:${a.anchorLabel || a.subject}`); }
      if (a.sourceRef) { score += 2; reasons.push('source-backed'); }
      if (a.outcome === 'uncertain') { score += 2; reasons.push('unresolved'); }
      if (a.outcome === 'contradicted' || a.contradictsIds.length > 0) { score += 2; reasons.push('contradiction'); }
      if ((anchorCountBySubject.get(lc(a.subject))?.size || 0) >= 2) { score += 1; reasons.push('multi-anchor'); }
      if (!prev.has(factKey(a))) { score += 1; reasons.push('newly-discovered'); }
      else { score -= 3; reasons.push('already-in-stable'); }
      return { ...a, score, reasons };
    })
    .sort((x, y) => y.score - x.score || x.id.localeCompare(y.id));
}

/** Diversity: cap evidence per source domain and assertions per relation type so the context
 *  is not five near-identical sources or five copies of the same relation. */
export function applyDiversity(ranked: RankedAssertion[], opts: { maxPerDomain?: number; maxPerPredicate?: number; max?: number } = {}): RankedAssertion[] {
  const maxPerDomain = opts.maxPerDomain ?? 2;
  const maxPerPredicate = opts.maxPerPredicate ?? 3;
  const max = opts.max ?? DEFAULT_MAX_NODES;
  const perDomain = new Map<string, number>();
  const perPredicate = new Map<string, number>();
  const out: RankedAssertion[] = [];
  for (const a of ranked) {
    if (out.length >= max) break;
    const dom = domainOf(a.sourceUrl) || lc(a.sourceRef) || 'no-domain';
    const pred = lc(a.predicate);
    if ((perDomain.get(dom) || 0) >= maxPerDomain) continue;
    if ((perPredicate.get(pred) || 0) >= maxPerPredicate) continue;
    perDomain.set(dom, (perDomain.get(dom) || 0) + 1);
    perPredicate.set(pred, (perPredicate.get(pred) || 0) + 1);
    out.push(a);
  }
  return out;
}

// --- assembly + progressive delta ------------------------------------------------

function assertionsToContext(args: {
  projectId: string;
  taskId?: string;
  anchors: ActiveGraphAnchor[];
  ranked: RankedAssertion[];
  thinkGraphCount: number;
  codeContext: ActiveCodeContext[];
}): ActiveGraphContext {
  const facts: ActiveGraphFact[] = [];
  const relations: ActiveGraphRelation[] = [];
  const evidenceByRef = new Map<string, ActiveGraphEvidence>();
  const unresolvedQuestions: string[] = [];
  const contradictions: string[] = [];

  for (const a of args.ranked) {
    facts.push({ subject: a.subject, predicate: a.predicate, object: a.object, outcome: a.outcome, sourceRef: a.sourceRef, confidence: a.confidence });
    if (a.object && lc(a.object) !== 'unknown') {
      relations.push({ from: a.subject, to: a.object, type: a.predicate, outcome: a.outcome, sourceRef: a.sourceRef });
    }
    if (a.sourceRef && !evidenceByRef.has(lc(a.sourceRef))) {
      evidenceByRef.set(lc(a.sourceRef), { sourceRef: a.sourceRef, title: a.sourceTitle, url: a.sourceUrl, reason: a.reasons.join('; ') });
    }
    if (a.outcome === 'uncertain') unresolvedQuestions.push(`${a.subject} ${a.predicate}: unresolved (${a.sourceRef || 'no source'})`);
    if (a.outcome === 'contradicted' || a.contradictsIds.length > 0) contradictions.push(`${a.subject} ${a.predicate} -> ${a.object} (contradicted; source ${a.sourceRef || 'n/a'})`);
  }

  const evidence = Array.from(evidenceByRef.values());
  const supportedCount = facts.filter((f) => f.outcome === 'supported').length;
  const stableSummary =
    `Task ${args.taskId || '(none)'} context: ${args.anchors.length} anchor(s) [${args.anchors.map((a) => a.label).join(', ')}]; ` +
    `${facts.length} fact(s) (${supportedCount} supported, ${contradictions.length} contradicted, ${unresolvedQuestions.length} unresolved); ` +
    `${evidence.length} source(s); thinkGraph=${args.thinkGraphCount}; code=${args.codeContext.length}.`;

  return {
    projectId: args.projectId,
    taskId: args.taskId,
    anchors: args.anchors,
    facts,
    relations,
    evidence,
    unresolvedQuestions: dedupeStable(unresolvedQuestions),
    contradictions: dedupeStable(contradictions),
    codeContext: args.codeContext,
    stableSummary,
    delta: {
      addedAnchors: args.anchors.map((a) => a.label),
      addedFacts: facts.map(factKey),
      addedEvidenceRefs: evidence.map((e) => e.sourceRef),
      addedQuestions: dedupeStable(unresolvedQuestions),
      removedAsCold: [],
    },
    sourceStats: { thinkGraph: args.thinkGraphCount, knowGraph: facts.length, codeGraph: args.codeContext.length },
  };
}

/** First build: compile intent -> bounded reads -> rank + diversity -> compact context. */
export async function buildActiveGraphContext(task: SelectedTaskInput, deps: ActiveGraphDeps = {}, opts: { maxNodes?: number; maxEvidence?: number } = {}): Promise<ActiveGraphContext> {
  const intent = compileGraphQueryIntent(task, opts);
  const anchors: ActiveGraphAnchor[] = task.anchors.map((a) => ({ id: clean(a.id) || `${intent.projectId}::obsentity::${lc(a.label)}`, label: a.label, type: a.type, reason: 'selected_task_anchor' }));

  const read = deps.readNeighborhood ?? ((i: GraphQueryIntent) => readKnowGraphAnchorNeighborhood(i, deps));
  const neighborhood = await read(intent);
  const assertions = neighborhood.ok ? neighborhood.assertions : [];

  const ranked = applyDiversity(rankNeighborhood(assertions, { anchorLabels: intent.anchorLabels }), { max: intent.maxNodes });

  let thinkGraphCount = 0;
  if (deps.readThinkGraph) {
    try { const tg = await deps.readThinkGraph(intent.projectId, intent.anchorLabels); thinkGraphCount = tg.ok ? tg.facts.length : 0; } catch { thinkGraphCount = 0; }
  }

  // CodeGraph ONLY when the selected task asked for it (research tasks get an empty, honest zero).
  let codeContext: ActiveCodeContext[] = [];
  if (intent.include.includes('code_context') && deps.readCodeContext) {
    try { const cg = await deps.readCodeContext(intent); codeContext = cg.ok ? cg.files : []; } catch { codeContext = []; }
  }

  return assertionsToContext({ projectId: intent.projectId, taskId: intent.taskId, anchors, ranked, thinkGraphCount, codeContext });
}

export type ActiveGraphNewMaterial = {
  facts?: ActiveGraphFact[];
  evidence?: ActiveGraphEvidence[];
  anchors?: ActiveGraphAnchor[];
};

/**
 * Progressive update: previous active context + NEW graph material -> updated context whose
 * `delta` contains ONLY the newly relevant items, with cold items moved out of the prompt
 * context (removedAsCold) under a bounded budget. Pure: it never reads/writes the graph and
 * never deletes from canonical storage — it is a rolling working cache.
 */
export function applyActiveGraphContextDelta(previous: ActiveGraphContext, material: ActiveGraphNewMaterial, opts: { budget?: number } = {}): ActiveGraphContext {
  const budget = Math.max(4, opts.budget ?? DEFAULT_CONTEXT_BUDGET);
  const prevFactKeys = new Set(previous.facts.map(factKey));
  const prevEvidenceRefs = new Set(previous.evidence.map((e) => lc(e.sourceRef)));
  const prevQuestions = new Set(previous.unresolvedQuestions.map(lc));
  const prevAnchorLabels = new Set(previous.anchors.map((a) => lc(a.label)));

  const addedFacts: ActiveGraphFact[] = [];
  for (const f of material.facts || []) { if (!prevFactKeys.has(factKey(f))) { addedFacts.push(f); prevFactKeys.add(factKey(f)); } }
  const addedEvidence: ActiveGraphEvidence[] = [];
  for (const e of material.evidence || []) { if (e.sourceRef && !prevEvidenceRefs.has(lc(e.sourceRef))) { addedEvidence.push(e); prevEvidenceRefs.add(lc(e.sourceRef)); } }
  const addedAnchors: ActiveGraphAnchor[] = [];
  for (const a of material.anchors || []) { if (!prevAnchorLabels.has(lc(a.label))) { addedAnchors.push(a); prevAnchorLabels.add(lc(a.label)); } }

  // New facts that are uncertain/contradicted become questions/contradictions.
  const addedQuestions: string[] = [];
  const newContradictions: string[] = [];
  const newRelations: ActiveGraphRelation[] = [];
  for (const f of addedFacts) {
    if (f.outcome === 'uncertain') { const q = `${f.subject} ${f.predicate}: unresolved (${f.sourceRef || 'no source'})`; if (!prevQuestions.has(lc(q))) { addedQuestions.push(q); prevQuestions.add(lc(q)); } }
    if (f.outcome === 'contradicted') newContradictions.push(`${f.subject} ${f.predicate} -> ${f.object} (contradicted; source ${f.sourceRef || 'n/a'})`);
    if (f.object && lc(f.object) !== 'unknown') newRelations.push({ from: f.subject, to: f.object, type: f.predicate, outcome: f.outcome, sourceRef: f.sourceRef });
  }

  let facts = [...previous.facts, ...addedFacts];
  let evidence = [...previous.evidence, ...addedEvidence];
  const anchors = [...previous.anchors, ...addedAnchors];
  const relations = [...previous.relations, ...newRelations];
  const unresolvedQuestions = dedupeStable([...previous.unresolvedQuestions, ...addedQuestions]);
  const contradictions = dedupeStable([...previous.contradictions, ...newContradictions]);

  // Budget: keep newest + keep contradictions/uncertainties; drop oldest plain-supported facts
  // out of the PROMPT context as cold (still in canonical graph — we just stop resending them).
  const removedAsCold: string[] = [];
  const overBy = facts.length + evidence.length + unresolvedQuestions.length - budget;
  if (overBy > 0) {
    // cold candidates: oldest supported facts not in this delta and not contradicted
    const newKeys = new Set(addedFacts.map(factKey));
    const cold = facts.filter((f) => f.outcome === 'supported' && !newKeys.has(factKey(f))).slice(0, overBy);
    const coldKeys = new Set(cold.map(factKey));
    facts = facts.filter((f) => !coldKeys.has(factKey(f)));
    for (const f of cold) removedAsCold.push(factKey(f));
  }

  const supportedCount = facts.filter((f) => f.outcome === 'supported').length;
  const stableSummary =
    `Task ${previous.taskId || '(none)'} context: ${anchors.length} anchor(s) [${anchors.map((a) => a.label).join(', ')}]; ` +
    `${facts.length} fact(s) (${supportedCount} supported, ${contradictions.length} contradicted, ${unresolvedQuestions.length} unresolved); ` +
    `${evidence.length} source(s); +${addedFacts.length} new fact(s), ${removedAsCold.length} cold.`;

  return {
    ...previous,
    anchors,
    facts,
    relations,
    evidence,
    unresolvedQuestions,
    contradictions,
    stableSummary,
    delta: {
      addedAnchors: addedAnchors.map((a) => a.label),
      addedFacts: addedFacts.map(factKey),
      addedEvidenceRefs: addedEvidence.map((e) => e.sourceRef),
      addedQuestions,
      removedAsCold,
    },
    sourceStats: { ...previous.sourceStats, knowGraph: facts.length },
  };
}

/** Render the compact context for a model prompt: stable summary + delta + source-backed
 *  assertions (with outcomes) + unresolved questions + contradictions + code context when present.
 *  Additive — it does NOT contain or replace the OWL graphPayload / Task Ledger contract. */
export function renderActiveGraphContextForPrompt(ctx: ActiveGraphContext): string {
  const lines: string[] = [];
  lines.push('activeGraphContext (compact, task-scoped — not the full graph):');
  lines.push(`stable: ${ctx.stableSummary}`);
  lines.push(`delta: +${ctx.delta.addedFacts.length} fact(s), +${ctx.delta.addedEvidenceRefs.length} source(s), +${ctx.delta.addedQuestions.length} question(s), ${ctx.delta.removedAsCold.length} cold-dropped`);
  if (ctx.facts.length) lines.push(`assertions:\n${ctx.facts.slice(0, 16).map((f) => `  - [${f.outcome}] ${f.subject} ${f.predicate} ${f.object}${f.sourceRef ? ` <- ${f.sourceRef}` : ''}`).join('\n')}`);
  if (ctx.unresolvedQuestions.length) lines.push(`unresolvedQuestions:\n${ctx.unresolvedQuestions.slice(0, 12).map((q) => `  - ${q}`).join('\n')}`);
  if (ctx.contradictions.length) lines.push(`contradictions:\n${ctx.contradictions.slice(0, 12).map((c) => `  - ${c}`).join('\n')}`);
  if (ctx.codeContext && ctx.codeContext.length) lines.push(`codeContext:\n${ctx.codeContext.slice(0, 10).map((c) => `  - ${c.path} (${c.reason})`).join('\n')}`);
  lines.push('Use this graph context; do not assume the full graph. Keep the OWL graphPayload output contract intact.');
  return lines.join('\n');
}
