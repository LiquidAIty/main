// Source-neutral GraphView contract for the ONE shared Sigma/Graphology Graph Explorer.
// Every node/edge declares which graph OWNS it (know / think / code / composite). Adapters map a
// specific backend response into this contract; the renderer (GraphExplorerCore) never knows about
// EDGAR, ThinkGraph, or CBM specifics. Cross-graph links are only ever real references or explicitly
// `proposed` (AI-suggested, unverified) — never silently blended into factual topology.

export type OwnerGraph = 'know' | 'think' | 'code' | 'composite';

export type GraphViewNode = {
  id: string;
  ownerGraph: OwnerGraph;
  semanticKind: string;
  displayLabel: string;
  explorationRole?: string;
  rawIds: string[];
  evidenceIds?: string[];
  sourceIds?: string[];
  provenance?: Record<string, unknown> | null;
  status?: string | null;        // think objects: provisional | accepted | rejected | unresolved
  proposed?: boolean;            // AI-proposed, unverified
  degree?: number;
  evidenceCount?: number;
  sourceCount?: number;
  statusSummary?: Record<string, number>;
};

export type GraphViewEdge = {
  id: string;
  source: string;
  target: string;
  ownerGraph: OwnerGraph;
  predicate: string;
  direction?: 'directed' | 'undirected';
  rawIds?: string[];
  evidenceIds?: string[];
  sourceIds?: string[];
  statusCounts?: Record<string, number>;
  proposed?: boolean;            // cross-graph / AI-proposed link — rendered distinctly
  weight?: number;
  properties?: Record<string, unknown>;  // raw stored edge properties (faithful ThinkGraph Inspector)
};

export type GraphLayerAvailability = {
  layer: OwnerGraph;
  state: 'available' | 'sparse' | 'unavailable';
  reason: string;
};

export type GraphView = {
  focus: { id: string; label: string } | null;
  activeLayers: OwnerGraph[];
  nodes: GraphViewNode[];
  edges: GraphViewEdge[];
  availability: GraphLayerAvailability[];
  expansionQueries?: Array<{ nodeId: string; label: string; query: string }>;
};

const ASSERTION_LIKE = /assertion/i;

/** Exact, unambiguous reference to a node for server-side focus/expand — a unique raw graph id
 * (or the canonical lens id as fallback) plus its semantic kind. NEVER a display label, so a label
 * collision can never make a focus/expand request select the wrong node. */
export type GraphFocusRef = { focusId: string; focusKind: string; focusLabel: string };

/** Build the exact focus reference for a node — prefer its unique raw graph id over any label. */
export function focusRefOf(node: Pick<GraphViewNode, 'id' | 'rawIds' | 'semanticKind' | 'displayLabel'>): GraphFocusRef {
  return {
    focusId: (node.rawIds && node.rawIds[0]) || node.id,
    focusKind: node.semanticKind || 'entity',
    focusLabel: node.displayLabel || node.id,
  };
}

/**
 * Human-readable "why is this node here" reason for the Inspector — derived from the node's
 * semantic role, never raw JSON. Pure + deterministic so it is unit-testable without Sigma.
 */
export function nodePresenceReason(node: Pick<GraphViewNode, 'semanticKind' | 'explorationRole' | 'id'>, focusId: string | null): string {
  if (focusId && node.id === focusId) return 'Current research focus';
  const kind = String(node.semanticKind || '').toLowerCase();
  if (['company', 'issuer', 'organization'].includes(kind)) return 'Company / issuer in this evidence neighborhood';
  if (['ticker', 'security'].includes(kind)) return 'Ticker / security linked to the focus company';
  if (['businesscontext', 'business'].includes(kind)) return 'EDGAR Business (Item 1) context';
  if (['riskcontext', 'risk'].includes(kind)) return 'EDGAR Risk Factors (Item 1A) context';
  if (['managementdiscussioncontext', 'mda'].includes(kind)) return 'EDGAR MD&A (Item 2) context';
  if (['documentsection', 'evidencesection'].includes(kind)) return 'Filing / document section';
  if (kind === 'filing') return 'EDGAR filing';
  if (kind === 'source') return 'Source document';
  if (['claim', 'assertion'].includes(kind)) return 'Source-backed assertion';
  if (['topic', 'entity', 'person', 'product', 'event'].includes(kind)) return 'Extracted topic / entity';
  const role = String(node.explorationRole || '').toLowerCase();
  if (role === 'semantic-primary') return 'Primary entity you can explore from';
  if (role === 'semantic-secondary') return 'Context reached through the focus';
  return 'Connected in the evidence neighborhood';
}

/**
 * Find the best node match for a free-text search over the CURRENT view (company / ticker / filing
 * / section / topic / source by label or raw id). Returns the strongest match, or null when nothing
 * in-view matches (the caller then escalates to a server `/explore?focus=` re-fetch). Pure.
 */
export function findSearchMatch(nodes: GraphViewNode[], query: string): GraphViewNode | null {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return null;
  const scored = nodes
    .map((n) => {
      const label = String(n.displayLabel || '').toLowerCase();
      const raws = (n.rawIds || []).map((r) => String(r).toLowerCase());
      let score = 0;
      if (label === q || raws.includes(q)) score = 100;
      else if (label.startsWith(q)) score = 60;
      else if (label.includes(q) || raws.some((r) => r.includes(q))) score = 30;
      return { n, score: score > 0 ? score + Math.min(9, n.degree || 0) : 0 };
    })
    .filter((s) => s.score >= 30);
  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.n ?? null;
}

/**
 * Merge an EXPAND-one-hop `/explore` response into the current one: union nodes + edges by id,
 * keeping every node/edge already on screen and adding ONLY the server-returned ones. The current
 * research focus is preserved (expand never refocuses), and no client-only relationship is invented.
 * Pure + deterministic — the real-data integrity test runs against this directly.
 */
export function mergeExploreLensPayloads(base: any, addition: any): any {
  if (!base?.lens || !Array.isArray(base.lens.nodes)) return addition;
  if (!addition?.lens || !Array.isArray(addition.lens.nodes)) return base;
  const nodeById = new Map<string, any>();
  for (const n of base.lens.nodes) nodeById.set(String(n.id), n);          // current items first…
  for (const n of addition.lens.nodes) if (!nodeById.has(String(n.id))) nodeById.set(String(n.id), n); // …only ADD new
  const edgeById = new Map<string, any>();
  for (const e of base.lens.edges || []) edgeById.set(String(e.id), e);
  for (const e of addition.lens.edges || []) if (!edgeById.has(String(e.id))) edgeById.set(String(e.id), e);
  const warnings = Array.from(new Set([...(base.warnings || []), ...(addition.warnings || [])]));
  return {
    ...base,
    warnings,
    lens: {
      ...base.lens,
      focus: base.lens.focus,                 // expand preserves the current focus
      nodes: [...nodeById.values()],
      edges: [...edgeById.values()],
    },
  };
}

/**
 * Union the enabled real source graphs into one view for the shared canvas. Each node/edge keeps its
 * ownerGraph (source identity). NO cross-graph edge is ever invented — only the real edges each source
 * already carries are present. (This is a plain union, not a generic "layer framework".)
 */
export function composeSources(views: GraphView[]): GraphView {
  const nodes = new Map<string, GraphViewNode>();
  const edges = new Map<string, GraphViewEdge>();
  let focus: GraphView['focus'] = null;
  const activeLayers: OwnerGraph[] = [];
  for (const v of views) {
    for (const n of v.nodes) if (!nodes.has(n.id)) nodes.set(n.id, n);
    for (const e of v.edges) if (!edges.has(e.id)) edges.set(e.id, e);
    for (const l of v.activeLayers) if (!activeLayers.includes(l)) activeLayers.push(l);
    if (!focus && v.focus) focus = v.focus;
  }
  return { focus, activeLayers: activeLayers.length ? activeLayers : ['know'], nodes: [...nodes.values()], edges: [...edges.values()], availability: [] };
}

/** Adapt a /api/knowgraph/explore response (the semantic lens) into a source-neutral GraphView. */
export function knowGraphAdapter(explore: any): GraphView {
  const lens = explore?.lens;
  if (!lens || !Array.isArray(lens.nodes)) {
    return {
      focus: null, activeLayers: ['know'], nodes: [], edges: [],
      availability: [{ layer: 'know', state: 'unavailable', reason: String((explore?.warnings || [])[0] || 'no knowledge lens for this focus') }],
    };
  }
  const focusId = lens.focus?.id ? String(lens.focus.id) : null;
  const edges: GraphViewEdge[] = lens.edges.map((e: any) => ({
    id: String(e.id),
    source: String(e.source),
    target: String(e.target),
    ownerGraph: 'know',
    predicate: String(e.predicate || 'RELATED_TO'),
    direction: 'directed',
    rawIds: Array.isArray(e.rawIds) ? e.rawIds.map(String) : [],
    evidenceIds: Array.isArray(e.evidenceIds) ? e.evidenceIds.map(String) : [],
    sourceIds: Array.isArray(e.sourceIds) ? e.sourceIds.map(String) : [],
    statusCounts: e.statusCounts || {},
    weight: Number(e.weight) || 1,
  }));
  // Aggregate the assertion + source ids of every incident edge onto each node so the Inspector can
  // expose the real provenance reachable from a selected company / ticker / section.
  const evidenceByNode = new Map<string, Set<string>>();
  const sourceByNode = new Map<string, Set<string>>();
  for (const e of edges) {
    for (const endpoint of [e.source, e.target]) {
      const ev = evidenceByNode.get(endpoint) ?? evidenceByNode.set(endpoint, new Set()).get(endpoint)!;
      const sr = sourceByNode.get(endpoint) ?? sourceByNode.set(endpoint, new Set()).get(endpoint)!;
      (e.evidenceIds || []).forEach((id) => ev.add(id));
      (e.sourceIds || []).forEach((id) => sr.add(id));
    }
  }
  const nodes: GraphViewNode[] = lens.nodes.map((n: any) => {
    const id = String(n.id);
    const node: GraphViewNode = {
      id,
      ownerGraph: 'know',
      semanticKind: String(n.semanticKind || 'entity'),
      displayLabel: String(n.displayLabel || n.canonicalName || n.id),
      explorationRole: n.explorationRole,
      rawIds: Array.isArray(n.rawIds) ? n.rawIds.map(String) : [],
      evidenceIds: [...(evidenceByNode.get(id) ?? [])],
      sourceIds: [...(sourceByNode.get(id) ?? [])],
      degree: Number(n.degree) || 0,
      evidenceCount: Number(n.evidenceCount) || 0,
      sourceCount: Number(n.sourceCount) || 0,
      statusSummary: n.statusSummary || {},
    };
    node.provenance = { canonicalName: n.canonicalName, why: nodePresenceReason(node, focusId) };
    return node;
  });
  return {
    focus: focusId ? { id: focusId, label: String(lens.focus.canonicalName || lens.focus.id) } : null,
    activeLayers: ['know'],
    nodes,
    edges,
    availability: [{ layer: 'know', state: nodes.length > 0 ? 'available' : 'unavailable', reason: nodes.length > 0 ? 'source-backed evidence and filings available' : 'no source-backed evidence for this focus yet' }],
    // edges carry the underlying assertion ids → an "expand evidence" query per relation
    expansionQueries: edges
      .filter((e) => (e.evidenceIds?.length ?? 0) > 0)
      .map((e) => ({ nodeId: e.id, label: 'expand evidence', query: `evidence:${e.evidenceIds!.join(',')}` })),
  };
}

/** Merge several owner-graph GraphViews into one, keeping owner identity. Cross-graph links must be
 * supplied explicitly (real references or proposed) — this never invents relationships. */
export function compositeView(
  views: GraphView[],
  crossLinks: GraphViewEdge[] = [],
  activeLayers: OwnerGraph[] = ['know', 'think'],
): GraphView {
  const nodes = new Map<string, GraphViewNode>();
  const edges = new Map<string, GraphViewEdge>();
  const availability: GraphLayerAvailability[] = [];
  let focus: GraphView['focus'] = null;
  for (const v of views) {
    for (const n of v.nodes) if (!nodes.has(n.id)) nodes.set(n.id, n);
    for (const e of v.edges) if (!edges.has(e.id)) edges.set(e.id, e);
    availability.push(...v.availability);
    if (!focus && v.focus) focus = v.focus;
  }
  for (const e of crossLinks) {
    if (nodes.has(e.source) && nodes.has(e.target)) edges.set(e.id, { ...e, ownerGraph: 'composite', proposed: e.proposed ?? false });
  }
  return { focus, activeLayers, nodes: [...nodes.values()], edges: [...edges.values()], availability };
}
