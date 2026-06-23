/**
 * KnowGraph bounded-neighborhood projection for the REAL Three/R3F graph engine.
 *
 * Renders a Neo4j-Bloom / GraphXR style bounded slice of the ACTUAL stored knowledge graph —
 * never the whole database, never a tree, never fabricated topology. The scene is the currently
 * explored neighborhood of one seed issuer, grown only through real stored edges:
 *
 *   Issuer --HAS_CONTEXT--> {BusinessContext | RiskContext | ManagementDiscussionContext}
 *          (each context, when expanded) --SUPPORTED_BY--> EvidenceSection
 *
 * Every emitted edge is an actual stored edge between two emitted nodes. No Universe/Theme/
 * Filing/Source/category/co-occurrence/similarity/layout nodes or edges are ever invented. The
 * graph is allowed to be sparse — that is honest. Output is `GraphViewData` (x/y/z laid out
 * deterministically) consumed by the existing CodeGraphScene; layout is fixed-radius radial, so
 * it is stable across rerenders with no random seed and no force simulation (no spiral hairball).
 */

import type { GraphNode, GraphViewData } from '../../types/agentgraph';

export const ISSUER_OWLCLASS = 'Issuer';
export const EVIDENCE_OWLCLASS = 'EvidenceSection';

export type ContextRoleKey = 'business' | 'risk' | 'mda';
const CONTEXT_OWLCLASS_ROLE: Readonly<Record<string, ContextRoleKey>> = {
  BusinessContext: 'business',
  RiskContext: 'risk',
  ManagementDiscussionContext: 'mda',
};
const ROLE_LABEL: Readonly<Record<ContextRoleKey, string>> = {
  business: 'Business',
  risk: 'Risks',
  mda: 'Management',
};
const ROLE_ORDER: readonly ContextRoleKey[] = ['business', 'risk', 'mda'];

// Real stored relationship types this neighborhood traverses (case-insensitive match).
const HAS_CONTEXT = 'has_context';
const SUPPORTED_BY = 'supported_by';

// Dark graph-paper / cyan-teal cockpit palette (no orange, no purple).
const COLOR = {
  issuer: '#8fe3ff',
  business: '#56d364',
  risk: '#ff7b72',
  mda: '#79c0ff',
  evidence: '#9fb4c4',
} as const;
const SIZE = { issuer: 17, context: 11, evidence: 7 } as const;

// Fixed-radius radial layout (world units). Deterministic; no physics.
const R_CONTEXT = 150;
const R_EVIDENCE = 110;

export type ProjectionNodeInput = {
  id: string;
  label?: string | null;
  owlClass?: string | string[] | null;
  type?: string | null;
  properties?: Record<string, unknown> | null;
};
export type ProjectionEdgeInput = {
  source?: string | null;
  target?: string | null;
  a?: string | null;
  b?: string | null;
  type?: string | null;
};

export type KnowGraphExploration = {
  /** Issuer node id whose neighborhood is shown. Empty → the first issuer by ticker is seeded. */
  seedIssuerId?: string | null;
  /** Context node ids whose SUPPORTED_BY evidence is currently revealed. */
  expandedContextIds?: string[];
};

export type KnowGraphNeighborhood = {
  data: GraphViewData;
  seedIssuerId: string | null;
  /** Issuer ids available to seed (for the Controls picker), sorted by ticker. */
  issuerOptions: Array<{ id: string; ticker: string }>;
};

function str(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return '';
}
function firstOwl(node: ProjectionNodeInput): string {
  const owl = node.owlClass;
  return (Array.isArray(owl) ? str(owl[0]) : str(owl)).trim();
}
function ticker(node: ProjectionNodeInput): string {
  return str(node.properties?.['ticker']).trim() || str(node.label).trim() || node.id;
}
function edgeEnds(e: ProjectionEdgeInput): [string, string, string] | null {
  const s = str(e.source ?? e.a).trim();
  const t = str(e.target ?? e.b).trim();
  if (!s || !t) return null;
  return [s, t, str(e.type).trim().toLowerCase()];
}

function makeNode(
  node: ProjectionNodeInput,
  role: 'issuer' | ContextRoleKey | 'evidence',
  label: string,
  x: number,
  y: number,
): GraphNode {
  const color = role === 'issuer' ? COLOR.issuer : COLOR[role];
  const size = role === 'issuer' ? SIZE.issuer : role === 'evidence' ? SIZE.evidence : SIZE.context;
  return {
    id: node.id,
    label,
    type: role === 'issuer' ? 'issuer' : role === 'evidence' ? 'evidence' : `${role}_context`,
    x,
    y,
    z: 0,
    color,
    size,
    summary: str(node.properties?.['summary']).trim() || undefined,
    sourceIds: [node.id],
  };
}

/**
 * Build the bounded real neighborhood for the seed issuer. Only stored Issuer→HAS_CONTEXT→Context
 * and (for expanded contexts) Context→SUPPORTED_BY→EvidenceSection nodes/edges are emitted.
 */
export function buildKnowGraphNeighborhood(input: {
  nodes: ProjectionNodeInput[];
  edges: ProjectionEdgeInput[];
  exploration: KnowGraphExploration;
}): KnowGraphNeighborhood {
  const nodeById = new Map(input.nodes.map((n) => [n.id, n] as const));
  const issuers = input.nodes
    .filter((n) => firstOwl(n) === ISSUER_OWLCLASS)
    .sort((a, b) => ticker(a).localeCompare(ticker(b)));
  const issuerOptions = issuers.map((n) => ({ id: n.id, ticker: ticker(n) }));

  const seedIssuerId =
    (input.exploration.seedIssuerId && issuers.some((n) => n.id === input.exploration.seedIssuerId)
      ? input.exploration.seedIssuerId
      : issuers[0]?.id) ?? null;

  const empty: GraphViewData = { kind: 'knowgraph', nodes: [], edges: [] };
  if (!seedIssuerId) return { data: empty, seedIssuerId: null, issuerOptions };

  const issuer = nodeById.get(seedIssuerId)!;
  const expanded = new Set(input.exploration.expandedContextIds ?? []);

  const nodes: GraphNode[] = [makeNode(issuer, 'issuer', ticker(issuer), 0, 0)];
  const edges: GraphViewData['edges'] = [];

  // Real Issuer --HAS_CONTEXT--> Context neighbors (deduped per role, deterministic order).
  type Ctx = { node: ProjectionNodeInput; role: ContextRoleKey };
  const contexts: Ctx[] = [];
  const seenCtx = new Set<string>();
  for (const e of input.edges) {
    const ends = edgeEnds(e);
    if (!ends) continue;
    const [s, t, type] = ends;
    if (type !== HAS_CONTEXT) continue;
    let ctxId: string | null = null;
    if (s === seedIssuerId) ctxId = t;
    else if (t === seedIssuerId) ctxId = s;
    else continue;
    if (seenCtx.has(ctxId)) continue;
    const ctx = nodeById.get(ctxId);
    const role = ctx ? CONTEXT_OWLCLASS_ROLE[firstOwl(ctx)] : undefined;
    if (!ctx || !role) continue;
    seenCtx.add(ctxId);
    contexts.push({ node: ctx, role });
  }
  contexts.sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || a.node.id.localeCompare(b.node.id));

  contexts.forEach((ctx, i) => {
    const angle = (2 * Math.PI * i) / Math.max(1, contexts.length) - Math.PI / 2;
    const cx = Math.cos(angle) * R_CONTEXT;
    const cy = Math.sin(angle) * R_CONTEXT;
    nodes.push(makeNode(ctx.node, ctx.role, ROLE_LABEL[ctx.role], cx, cy));
    edges.push({ id: `${issuer.id}->${ctx.node.id}`, source: issuer.id, target: ctx.node.id, type: 'HAS_CONTEXT' });

    if (!expanded.has(ctx.node.id)) return;

    // Real Context --SUPPORTED_BY--> EvidenceSection neighbors, fanned outward from the context.
    const evidence: ProjectionNodeInput[] = [];
    const seenEv = new Set<string>();
    for (const e of input.edges) {
      const ends = edgeEnds(e);
      if (!ends) continue;
      const [s, t, type] = ends;
      if (type !== SUPPORTED_BY) continue;
      let evId: string | null = null;
      if (s === ctx.node.id) evId = t;
      else if (t === ctx.node.id) evId = s;
      else continue;
      if (seenEv.has(evId)) continue;
      const ev = nodeById.get(evId);
      if (!ev || firstOwl(ev) !== EVIDENCE_OWLCLASS) continue;
      seenEv.add(evId);
      evidence.push(ev);
    }
    evidence.sort((a, b) => a.id.localeCompare(b.id));
    const spreadRad = Math.PI / 3;
    evidence.forEach((ev, j) => {
      const offset = evidence.length === 1 ? 0 : (j / (evidence.length - 1) - 0.5) * spreadRad;
      const evAngle = angle + offset;
      const ex = cx + Math.cos(evAngle) * R_EVIDENCE;
      const ey = cy + Math.sin(evAngle) * R_EVIDENCE;
      const item = str(ev.properties?.['sectionItemId']).trim();
      nodes.push(makeNode(ev, 'evidence', item ? `Evidence ${item}` : 'Evidence', ex, ey));
      edges.push({ id: `${ctx.node.id}->${ev.id}`, source: ctx.node.id, target: ev.id, type: 'SUPPORTED_BY' });
    });
  });

  return { data: { kind: 'knowgraph', nodes, edges }, seedIssuerId, issuerOptions };
}

/** Toggle a context's expansion (reveal/hide its real SUPPORTED_BY evidence). */
export function toggleExpandedContext(current: string[], contextId: string): string[] {
  return current.includes(contextId) ? current.filter((id) => id !== contextId) : [...current, contextId];
}
