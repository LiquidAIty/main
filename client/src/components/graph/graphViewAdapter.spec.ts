import { describe, expect, it } from 'vitest';

import {
  knowGraphAdapter,
  nodePresenceReason,
  findSearchMatch,
  focusRefOf,
  mergeExploreLensPayloads,
  type GraphViewNode,
} from './graphViewAdapter';

// A realistic `/api/knowgraph/explore` lens payload shaped exactly like projectExplorationLens
// returns: a Redwire focus with RDW/RWE competing tickers, a derived CONTRADICTS edge, EDGAR
// Business/Risks sections, and real assertion/source ids carried on the edges. This is the data the
// Sigma explorer must render WITHOUT losing provenance.
function redwireLens() {
  return {
    status: 'ok',
    warnings: [],
    lens: {
      focus: { id: 'kg:ent:redwire', canonicalName: 'Redwire Corporation', matched: true },
      lens: 'entity',
      depth: 1,
      nodes: [
        { id: 'kg:ent:redwire', rawIds: ['neo-1'], explorationRole: 'semantic-primary', semanticKind: 'company', displayLabel: 'Redwire Corporation', canonicalName: 'Redwire Corporation', evidenceCount: 2, statusSummary: { supported: 1, contradicted: 1 }, sourceCount: 2, sourceDates: [], degree: 4 },
        { id: 'kg:ent:rdw', rawIds: ['neo-2'], explorationRole: 'semantic-primary', semanticKind: 'ticker', displayLabel: 'RDW', canonicalName: 'RDW', evidenceCount: 0, statusSummary: {}, sourceCount: 0, sourceDates: [], degree: 2 },
        { id: 'kg:ent:rwe', rawIds: ['neo-3'], explorationRole: 'semantic-primary', semanticKind: 'ticker', displayLabel: 'RWE', canonicalName: 'RWE', evidenceCount: 0, statusSummary: {}, sourceCount: 0, sourceDates: [], degree: 2 },
        { id: 'kg:sec:business', rawIds: ['neo-4'], explorationRole: 'semantic-secondary', semanticKind: 'businesscontext', displayLabel: 'Business', canonicalName: 'Business', evidenceCount: 0, statusSummary: {}, sourceCount: 0, sourceDates: [], degree: 1 },
        { id: 'kg:sec:risks', rawIds: ['neo-5'], explorationRole: 'semantic-secondary', semanticKind: 'riskcontext', displayLabel: 'Risks', canonicalName: 'Risks', evidenceCount: 0, statusSummary: {}, sourceCount: 0, sourceDates: [], degree: 1 },
      ],
      edges: [
        { id: 'kg:ent:redwire|TRADES_AS|kg:ent:rdw', rawIds: ['assert-1'], source: 'kg:ent:redwire', target: 'kg:ent:rdw', predicate: 'TRADES_AS', direction: 'directed', evidenceIds: ['assert-1'], sourceIds: ['src-edgar-1'], statusCounts: { supported: 1 }, weight: 1, directness: 'asserted' },
        { id: 'kg:ent:redwire|TRADES_AS|kg:ent:rwe', rawIds: ['assert-2'], source: 'kg:ent:redwire', target: 'kg:ent:rwe', predicate: 'TRADES_AS', direction: 'directed', evidenceIds: ['assert-2'], sourceIds: ['src-news-1'], statusCounts: { contradicted: 1 }, weight: 1, directness: 'asserted' },
        { id: 'kg:ent:rwe|CONTRADICTS|kg:ent:rdw', rawIds: [], source: 'kg:ent:rwe', target: 'kg:ent:rdw', predicate: 'CONTRADICTS', direction: 'directed', evidenceIds: [], sourceIds: [], statusCounts: { contradicted: 1 }, weight: 1, directness: 'derived' },
        { id: 'kg:ent:redwire|HAS_CONTEXT|kg:sec:business', rawIds: ['edge-b'], source: 'kg:ent:redwire', target: 'kg:sec:business', predicate: 'HAS_CONTEXT', direction: 'directed', evidenceIds: [], sourceIds: [], statusCounts: {}, weight: 1, directness: 'structural' },
        { id: 'kg:ent:redwire|HAS_CONTEXT|kg:sec:risks', rawIds: ['edge-r'], source: 'kg:ent:redwire', target: 'kg:sec:risks', predicate: 'HAS_CONTEXT', direction: 'directed', evidenceIds: [], sourceIds: [], statusCounts: {}, weight: 1, directness: 'structural' },
      ],
      excludedFromTopology: { byRole: { storage: 3, process: 1 }, note: '' },
      warnings: [],
    },
  };
}

describe('knowGraphAdapter (semantic lens → Sigma GraphView, provenance preserved)', () => {
  it('resolves the Redwire focus and keeps every node/edge', () => {
    const view = knowGraphAdapter(redwireLens());
    expect(view.focus).toEqual({ id: 'kg:ent:redwire', label: 'Redwire Corporation' });
    expect(view.nodes).toHaveLength(5);
    expect(view.edges).toHaveLength(5);
    expect(view.activeLayers).toEqual(['know']);
    expect(view.nodes.every((n) => n.ownerGraph === 'know')).toBe(true);
  });

  it('preserves edge predicate, assertion ids, source ids and status counts', () => {
    const view = knowGraphAdapter(redwireLens());
    const tradesRwe = view.edges.find((e) => e.id === 'kg:ent:redwire|TRADES_AS|kg:ent:rwe')!;
    expect(tradesRwe.predicate).toBe('TRADES_AS');
    expect(tradesRwe.evidenceIds).toEqual(['assert-2']);
    expect(tradesRwe.sourceIds).toEqual(['src-news-1']);
    expect(tradesRwe.statusCounts).toEqual({ contradicted: 1 });
  });

  it('carries the explicit RWE↔RDW contradiction edge', () => {
    const view = knowGraphAdapter(redwireLens());
    const contradiction = view.edges.find((e) => e.predicate === 'CONTRADICTS');
    expect(contradiction).toBeTruthy();
    expect(contradiction!.source).toBe('kg:ent:rwe');
    expect(contradiction!.target).toBe('kg:ent:rdw');
  });

  it('aggregates incident assertion/source ids onto nodes for the Inspector', () => {
    const view = knowGraphAdapter(redwireLens());
    const redwire = view.nodes.find((n) => n.id === 'kg:ent:redwire')!;
    expect(new Set(redwire.evidenceIds)).toEqual(new Set(['assert-1', 'assert-2']));
    expect(new Set(redwire.sourceIds)).toEqual(new Set(['src-edgar-1', 'src-news-1']));
    const rdw = view.nodes.find((n) => n.id === 'kg:ent:rdw')!;
    expect(rdw.evidenceIds).toEqual(['assert-1']);
    expect(rdw.sourceIds).toEqual(['src-edgar-1']);
  });

  it('attaches a human "why present" reason per node', () => {
    const view = knowGraphAdapter(redwireLens());
    const rdw = view.nodes.find((n) => n.id === 'kg:ent:rdw')!;
    expect(String((rdw.provenance as any)?.why)).toMatch(/ticker/i);
    const redwire = view.nodes.find((n) => n.id === 'kg:ent:redwire')!;
    expect(String((redwire.provenance as any)?.why)).toMatch(/focus/i);
  });

  it('returns an honest unavailable view when there is no lens', () => {
    const view = knowGraphAdapter({ status: 'unavailable', warnings: ['neo4j down'] });
    expect(view.nodes).toHaveLength(0);
    expect(view.availability[0].state).toBe('unavailable');
    expect(view.availability[0].reason).toMatch(/neo4j down/i);
  });
});

describe('nodePresenceReason', () => {
  const n = (id: string, semanticKind: string, explorationRole = ''): GraphViewNode =>
    ({ id, semanticKind, explorationRole } as GraphViewNode);
  it('labels the focus node distinctly', () => {
    expect(nodePresenceReason(n('f', 'company'), 'f')).toBe('Current research focus');
  });
  it('maps EDGAR section roles', () => {
    expect(nodePresenceReason(n('x', 'riskcontext'), 'f')).toMatch(/Risk Factors/i);
    expect(nodePresenceReason(n('x', 'businesscontext'), 'f')).toMatch(/Business/i);
    expect(nodePresenceReason(n('x', 'managementdiscussioncontext'), 'f')).toMatch(/MD&A/i);
  });
  it('maps tickers and companies', () => {
    expect(nodePresenceReason(n('x', 'ticker'), 'f')).toMatch(/ticker/i);
    expect(nodePresenceReason(n('x', 'company'), 'f')).toMatch(/company|issuer/i);
  });
});

describe('findSearchMatch (in-view research search)', () => {
  const nodes = knowGraphAdapter(redwireLens()).nodes;
  it('finds an exact ticker by label', () => {
    expect(findSearchMatch(nodes, 'RDW')?.id).toBe('kg:ent:rdw');
  });
  it('finds a company by prefix', () => {
    expect(findSearchMatch(nodes, 'redwire')?.id).toBe('kg:ent:redwire');
  });
  it('matches a raw graph id', () => {
    expect(findSearchMatch(nodes, 'neo-5')?.id).toBe('kg:sec:risks');
  });
  it('returns null when nothing in view matches (caller escalates to server focus)', () => {
    expect(findSearchMatch(nodes, 'tesla')).toBeNull();
  });
});

describe('focusRefOf (exact-id focus/expand contract)', () => {
  it('uses the unique raw graph id, not the display label', () => {
    const view = knowGraphAdapter(redwireLens());
    const rdw = view.nodes.find((n) => n.id === 'kg:ent:rdw')!;
    const ref = focusRefOf(rdw);
    expect(ref.focusId).toBe('neo-2'); // raw graph id, NOT 'RDW'
    expect(ref.focusKind).toBe('ticker');
    expect(ref.focusLabel).toBe('RDW');
  });
  it('duplicate display labels cannot produce the same focus id (no wrong-node selection)', () => {
    // Two distinct nodes sharing a display label still carry different unique raw ids.
    const a: GraphViewNode = { id: 'kg:ent:a', ownerGraph: 'know', semanticKind: 'company', displayLabel: 'Acme', rawIds: ['neo-A'] } as GraphViewNode;
    const b: GraphViewNode = { id: 'kg:ent:b', ownerGraph: 'know', semanticKind: 'company', displayLabel: 'Acme', rawIds: ['neo-B'] } as GraphViewNode;
    expect(focusRefOf(a).focusId).toBe('neo-A');
    expect(focusRefOf(b).focusId).toBe('neo-B');
    expect(focusRefOf(a).focusId).not.toBe(focusRefOf(b).focusId);
  });
  it('falls back to the canonical id only when a node has no raw ids', () => {
    const n: GraphViewNode = { id: 'kg:ev:x', ownerGraph: 'know', semanticKind: 'claim', displayLabel: 'a claim', rawIds: [] } as GraphViewNode;
    expect(focusRefOf(n).focusId).toBe('kg:ev:x');
  });
});

describe('mergeExploreLensPayloads (expand-one-hop integrity)', () => {
  // A small expand response that overlaps Redwire (already on screen) and adds a NEW claim + source.
  function expandAddition() {
    return {
      status: 'ok',
      warnings: ['expanded'],
      lens: {
        focus: { id: 'kg:ent:rdw', canonicalName: 'RDW', matched: true }, // different focus — must be ignored on merge
        lens: 'entity',
        depth: 1,
        nodes: [
          { id: 'kg:ent:redwire', semanticKind: 'company', displayLabel: 'Redwire Corporation', rawIds: ['neo-1'], degree: 4 }, // overlap
          { id: 'kg:ev:a-new', semanticKind: 'claim', displayLabel: 'redwire develops x', rawIds: ['a-new'], degree: 2 }, // NEW
          { id: 'kg:src:s-new', semanticKind: 'source', displayLabel: 'sec.gov', rawIds: ['src-sec'], degree: 1 }, // NEW
        ],
        edges: [
          { id: 'kg:ev:a-new|FROM_SOURCE|kg:src:s-new', source: 'kg:ev:a-new', target: 'kg:src:s-new', predicate: 'FROM_SOURCE', evidenceIds: ['a-new'], sourceIds: ['src-sec'], rawIds: [], statusCounts: {}, weight: 1, directness: 'asserted' }, // NEW
        ],
        excludedFromTopology: { byRole: {}, note: '' },
        warnings: [],
      },
    };
  }

  it('preserves every existing node/edge and adds ONLY the new server-returned ones', () => {
    const base = redwireLens();
    const merged = mergeExploreLensPayloads(base, expandAddition());
    const ids = new Set(merged.lens.nodes.map((n: any) => n.id));
    // all 5 original Redwire nodes preserved
    for (const id of ['kg:ent:redwire', 'kg:ent:rdw', 'kg:ent:rwe', 'kg:sec:business', 'kg:sec:risks']) expect(ids.has(id)).toBe(true);
    // the 2 genuinely new nodes added
    expect(ids.has('kg:ev:a-new')).toBe(true);
    expect(ids.has('kg:src:s-new')).toBe(true);
    // no duplication of the overlapping node
    expect(merged.lens.nodes.filter((n: any) => n.id === 'kg:ent:redwire')).toHaveLength(1);
    // all 5 original edges preserved + 1 new edge
    expect(merged.lens.edges).toHaveLength(base.lens.edges.length + 1);
  });

  it('keeps the CURRENT focus (expand never refocuses)', () => {
    const base = redwireLens();
    const merged = mergeExploreLensPayloads(base, expandAddition());
    expect(merged.lens.focus.id).toBe('kg:ent:redwire'); // base focus, not the addition's RDW focus
  });

  it('edge provenance stays complete after merge (rawIds/evidenceIds/sourceIds/predicate/status/weight/directness)', () => {
    const merged = mergeExploreLensPayloads(redwireLens(), expandAddition());
    const view = knowGraphAdapter(merged);
    const tradesRwe = view.edges.find((e) => e.id === 'kg:ent:redwire|TRADES_AS|kg:ent:rwe')!;
    expect(tradesRwe.predicate).toBe('TRADES_AS');
    expect(tradesRwe.evidenceIds).toEqual(['assert-2']);
    expect(tradesRwe.sourceIds).toEqual(['src-news-1']);
    expect(tradesRwe.statusCounts).toEqual({ contradicted: 1 });
    expect(tradesRwe.weight).toBe(1);
    const newEdge = view.edges.find((e) => e.predicate === 'FROM_SOURCE')!;
    expect(newEdge.evidenceIds).toEqual(['a-new']);
    expect(newEdge.sourceIds).toEqual(['src-sec']);
  });

  it('does not fabricate nodes or edges (merge is a strict union of real inputs)', () => {
    const base = redwireLens();
    const merged = mergeExploreLensPayloads(base, expandAddition());
    const realIds = new Set([...base.lens.nodes, ...expandAddition().lens.nodes].map((n: any) => n.id));
    for (const n of merged.lens.nodes) expect(realIds.has(n.id)).toBe(true);
  });
});
