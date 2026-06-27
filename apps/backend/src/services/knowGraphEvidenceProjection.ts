// @graph entity: KnowGraphEvidenceProjection
// @graph role: read-time-evidence-graph-projection
// @graph relates_to: KnowGraphEvidenceRetrieval, knowgraph.routes(/evidence-graph)
// @graph depends_on: Neo4j (KnowGraph :SourceBackedAssertion)
//
// PURE, read-time projection of REAL stored source-backed assertions into a typed,
// explorable evidence graph. Phase A of the KnowGraph exploration round: it never
// writes Neo4j, never invents a fact, and never promotes a model statement to a
// fact. Every node and edge is derived from a field that already exists on a stored
// :SourceBackedAssertion (subject/predicate/object/outcome/confidence/source_*).
//
// The four epistemic kinds stay DISTINCT (never collapsed into one node kind):
//   1. source statement   -> :Source node
//   2. source-backed claim -> :Claim node (carries outcome + confidence)
//   3. system assessment   -> :Assessment node (coverage/uncertainty, as-of a time)
//   4. (model interpretation is never produced here)
// An "unknown"/uncertain object (e.g. SpaceX valuation) is represented as a
// :Question + :Assessment — NOT as a fact-property of the subject entity.

export type AssertionRow = {
  id: string;
  subject: string;
  predicate: string;
  object: string;
  outcome: string;
  confidence: number | null;
  source_ref: string;
  source_title: string;
  source_url: string;
  evidence_text: string;
  created_at: string;
};

export type EvidenceNodeType =
  | 'Company'
  | 'Ticker'
  | 'Topic'
  | 'Entity'
  | 'Claim'
  | 'Source'
  | 'Question'
  | 'Assessment';

export type EvidenceNode = {
  id: string;
  label: string;
  type: EvidenceNodeType;
  source: 'know';
  properties: Record<string, unknown>;
};

export type EvidenceRelationship = {
  id: string;
  from: string;
  to: string;
  type: string;
  source: 'know';
  properties: Record<string, unknown>;
};

export type EvidenceGraph = {
  nodes: EvidenceNode[];
  relationships: EvidenceRelationship[];
};

const COMPANY_RE = /\b(Corp|Corporation|Inc|Incorporated|Company|Co|Ltd|PLC|LLC|Holdings|Group|Technologies|Industries|Systems)\b/i;
const TICKER_RE = /^[A-Z]{1,5}$/;
const UNKNOWN_OBJECT = new Set(['unknown', 'n/a', 'na', 'tbd', 'unresolved', '']);
const UNCERTAIN_OUTCOME = new Set(['uncertain', 'unresolved', 'unknown']);

function s(v: unknown): string {
  return typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim();
}

/** Stable slug for node identity / dedupe (case-insensitive on the canonical name). */
function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80);
}

/** Structural (NOT model-inferred) entity typing from the literal string only. */
export function classifyEntityType(name: string): EvidenceNodeType {
  const n = s(name);
  if (!n) return 'Entity';
  if (TICKER_RE.test(n)) return 'Ticker';
  // Multi-word lowercase descriptors ("airborne systems", "national security") read as
  // topics — checked BEFORE Company so a generic word like "systems" doesn't mis-type them.
  if (/\s/.test(n) && n === n.toLowerCase()) return 'Topic';
  if (COMPANY_RE.test(n)) return 'Company';
  return 'Entity';
}

/** Predicate → typed relationship (never collapse everything to RELATED_TO). */
export function predicateToRelType(predicate: string): string {
  const p = s(predicate).toLowerCase();
  if (p === 'has_ticker_symbol' || p === 'trades_as') return 'TRADES_AS';
  if (p === 'has_current_valuation' || p === 'valuation') return 'HAS_VALUATION';
  if (!p) return 'RELATED_TO';
  return p.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'RELATED_TO';
}

function isUnknownObject(object: string, outcome: string): boolean {
  return UNKNOWN_OBJECT.has(s(object).toLowerCase()) || UNCERTAIN_OUTCOME.has(s(outcome).toLowerCase());
}

type Acc = {
  nodes: Map<string, EvidenceNode>;
  rels: Map<string, EvidenceRelationship>;
};

function addNode(acc: Acc, node: EvidenceNode): string {
  if (!acc.nodes.has(node.id)) acc.nodes.set(node.id, node);
  return node.id;
}
function addRel(acc: Acc, rel: Omit<EvidenceRelationship, 'source'>): void {
  const id = rel.id || `${rel.from}|${rel.type}|${rel.to}`;
  if (!acc.rels.has(id)) acc.rels.set(id, { ...rel, id, source: 'know' });
}

function entityNode(acc: Acc, name: string): string | null {
  const n = s(name);
  if (!n) return null;
  const id = `entity:${slug(n)}`;
  return addNode(acc, { id, label: n, type: classifyEntityType(n), source: 'know', properties: { canonicalName: n } });
}

function sourceNode(acc: Acc, a: AssertionRow): string | null {
  const ref = s(a.source_ref) || s(a.source_url) || s(a.source_title);
  if (!ref) return null;
  const id = `source:${slug(ref)}`;
  return addNode(acc, {
    id,
    label: s(a.source_title) || s(a.source_url) || ref,
    type: 'Source',
    source: 'know',
    properties: {
      source_ref: s(a.source_ref),
      source_title: s(a.source_title),
      source_url: s(a.source_url),
      created_at: s(a.created_at),
    },
  });
}

/**
 * Project real stored assertions into a typed, explorable evidence graph.
 * Pure + deterministic. Dedupes entities/sources by canonical id; competing
 * supported-vs-contradicted objects of the same (subject, predicate) get an
 * explicit CONTRADICTS edge so the conflict is visible during exploration.
 */
export function projectEvidenceGraph(assertions: AssertionRow[]): EvidenceGraph {
  const acc: Acc = { nodes: new Map(), rels: new Map() };
  // (subject|predicate) -> outcome -> objectNodeId, to detect real conflicts.
  const competing = new Map<string, Map<string, string>>();

  for (const a of Array.isArray(assertions) ? assertions : []) {
    const subject = s(a.subject);
    if (!subject) continue;
    const subjectId = entityNode(acc, subject);
    if (!subjectId) continue;
    const srcId = sourceNode(acc, a);
    const outcome = s(a.outcome).toLowerCase() || 'directly_stated';
    const relType = predicateToRelType(a.predicate);

    const claimId = `claim:${slug(a.id) || `${slug(subject)}_${slug(a.predicate)}_${slug(a.object)}`}`;
    addNode(acc, {
      id: claimId,
      label: `${subject} ${s(a.predicate)} ${s(a.object)}`.trim(),
      type: 'Claim',
      source: 'know',
      properties: {
        subject,
        predicate: s(a.predicate),
        object: s(a.object),
        outcome,
        confidence: a.confidence ?? null,
        evidence_text: s(a.evidence_text),
        source_ref: s(a.source_ref),
        source_title: s(a.source_title),
        source_url: s(a.source_url),
        created_at: s(a.created_at),
      },
    });
    addRel(acc, { id: `${claimId}|ABOUT|${subjectId}`, from: claimId, to: subjectId, type: 'ABOUT', properties: {} });
    if (srcId) addRel(acc, { id: `${claimId}|SOURCED_FROM|${srcId}`, from: claimId, to: srcId, type: 'SOURCED_FROM', properties: {} });

    if (isUnknownObject(a.object, outcome)) {
      // Epistemic kind 3: a Question + coverage Assessment, NOT a fact on the subject.
      const qId = `question:${slug(subject)}_${slug(a.predicate)}`;
      addNode(acc, {
        id: qId,
        label: `What is ${subject}'s ${s(a.predicate).replace(/_/g, ' ')}?`,
        type: 'Question',
        source: 'know',
        properties: { subject, predicate: s(a.predicate) },
      });
      const asId = `assessment:${slug(a.id) || slug(subject)}`;
      addNode(acc, {
        id: asId,
        label: `coverage: ${outcome} (as of ${s(a.created_at) || 'unknown date'})`,
        type: 'Assessment',
        source: 'know',
        properties: { status: outcome, asOf: s(a.created_at), confidence: a.confidence ?? null },
      });
      addRel(acc, { id: `${qId}|ASKS_ABOUT|${subjectId}`, from: qId, to: subjectId, type: 'ASKS_ABOUT', properties: {} });
      addRel(acc, { id: `${asId}|ASSESSES|${qId}`, from: asId, to: qId, type: 'ASSESSES', properties: { status: outcome } });
      if (srcId) addRel(acc, { id: `${asId}|SOURCED_FROM|${srcId}`, from: asId, to: srcId, type: 'SOURCED_FROM', properties: {} });
      continue;
    }

    // Concrete object → typed entity + the readable entity→entity edge carrying outcome.
    const objectId = entityNode(acc, a.object);
    if (objectId) {
      addRel(acc, {
        id: `${subjectId}|${relType}|${objectId}|${outcome}`,
        from: subjectId,
        to: objectId,
        type: relType,
        properties: { outcome, confidence: a.confidence ?? null, claimId, source_title: s(a.source_title), source_url: s(a.source_url) },
      });
      addRel(acc, { id: `${claimId}|ASSERTS|${objectId}`, from: claimId, to: objectId, type: 'ASSERTS', properties: { outcome } });

      const key = `${slug(subject)}|${slug(a.predicate)}`;
      const byOutcome = competing.get(key) ?? new Map<string, string>();
      byOutcome.set(outcome, objectId);
      competing.set(key, byOutcome);
    }
  }

  // Explicit CONTRADICTS edge wherever the SAME (subject, predicate) has both a
  // supported and a contradicted object — a real conflict drawn from real outcomes.
  for (const byOutcome of competing.values()) {
    const supported = byOutcome.get('supported');
    const contradicted = byOutcome.get('contradicted');
    if (supported && contradicted && supported !== contradicted) {
      addRel(acc, { id: `${supported}|CONTRADICTS|${contradicted}`, from: contradicted, to: supported, type: 'CONTRADICTS', properties: { reason: 'competing_claim_same_predicate' } });
    }
  }

  return { nodes: [...acc.nodes.values()], relationships: [...acc.rels.values()] };
}
