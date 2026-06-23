import { describe, expect, it } from 'vitest';

import {
  buildKnowGraphNeighborhood,
  toggleExpandedContext,
  type ProjectionEdgeInput,
  type ProjectionNodeInput,
} from './knowGraphNeighborhood';

const issuer = (id: string, ticker: string): ProjectionNodeInput => ({ id, label: ticker, owlClass: 'Issuer', properties: { ticker } });
const context = (id: string, owlClass: string): ProjectionNodeInput => ({ id, owlClass, properties: {} });
const evidence = (id: string, item: string): ProjectionNodeInput => ({ id, owlClass: 'EvidenceSection', properties: { sectionItemId: item } });

// RDW (3 contexts, business has 2 evidence), GHM (1 context). Plus unrelated records that must
// never enter the neighborhood (Source, SearchPacket, and a foreign issuer's context).
const NODES: ProjectionNodeInput[] = [
  issuer('kg:rdw', 'RDW'),
  issuer('kg:ghm', 'GHM'),
  context('kg:rdw-biz', 'BusinessContext'),
  context('kg:rdw-risk', 'RiskContext'),
  context('kg:rdw-mda', 'ManagementDiscussionContext'),
  context('kg:ghm-biz', 'BusinessContext'),
  evidence('kg:ev1', '1'),
  evidence('kg:ev2', '1A'),
  evidence('kg:ev-ghm', '1'),
  { id: 'kg:src1', owlClass: 'Source', properties: {} },
  { id: 'kg:sp1', owlClass: 'SearchPacket', properties: {} },
];
const EDGES: ProjectionEdgeInput[] = [
  { source: 'kg:rdw', target: 'kg:rdw-biz', type: 'HAS_CONTEXT' },
  { source: 'kg:rdw', target: 'kg:rdw-risk', type: 'HAS_CONTEXT' },
  { source: 'kg:rdw', target: 'kg:rdw-mda', type: 'HAS_CONTEXT' },
  { source: 'kg:ghm', target: 'kg:ghm-biz', type: 'HAS_CONTEXT' },
  { source: 'kg:rdw-biz', target: 'kg:ev1', type: 'SUPPORTED_BY' },
  { source: 'kg:rdw-biz', target: 'kg:ev2', type: 'SUPPORTED_BY' },
  { source: 'kg:ghm-biz', target: 'kg:ev-ghm', type: 'SUPPORTED_BY' },
  { source: 'kg:sp1', target: 'kg:src1', type: 'HAS_SOURCE_REF' }, // unrelated subgraph
];

const STORED = new Set(EDGES.map((e) => `${e.source}->${e.target}:${String(e.type).toLowerCase()}`));

describe('buildKnowGraphNeighborhood — bounded real graph slice', () => {
  it('default slice = seed issuer + its real HAS_CONTEXT contexts (evidence hidden)', () => {
    const n = buildKnowGraphNeighborhood({ nodes: NODES, edges: EDGES, exploration: { seedIssuerId: 'kg:rdw' } });
    const ids = n.data.nodes.map((x) => x.id).sort();
    expect(ids).toEqual(['kg:rdw', 'kg:rdw-biz', 'kg:rdw-mda', 'kg:rdw-risk']);
    // no evidence/source/search/foreign nodes
    for (const banned of ['kg:ev1', 'kg:ev2', 'kg:src1', 'kg:sp1', 'kg:ghm', 'kg:ghm-biz']) {
      expect(n.data.nodes.find((x) => x.id === banned)).toBeUndefined();
    }
    // exactly the 3 stored HAS_CONTEXT edges
    expect(n.data.edges.map((e) => e.type)).toEqual(['HAS_CONTEXT', 'HAS_CONTEXT', 'HAS_CONTEXT']);
  });

  it('every visible edge is a real stored edge between two visible nodes', () => {
    const n = buildKnowGraphNeighborhood({ nodes: NODES, edges: EDGES, exploration: { seedIssuerId: 'kg:rdw', expandedContextIds: ['kg:rdw-biz'] } });
    const visible = new Set(n.data.nodes.map((x) => x.id));
    for (const e of n.data.edges) {
      expect(visible.has(e.source)).toBe(true);
      expect(visible.has(e.target)).toBe(true);
      expect(STORED.has(`${e.source}->${e.target}:${e.type.toLowerCase()}`)).toBe(true);
    }
  });

  it('expanding a context reveals exactly its stored SUPPORTED_BY evidence', () => {
    const n = buildKnowGraphNeighborhood({ nodes: NODES, edges: EDGES, exploration: { seedIssuerId: 'kg:rdw', expandedContextIds: ['kg:rdw-biz'] } });
    expect(n.data.nodes.filter((x) => x.type === 'evidence').map((x) => x.id).sort()).toEqual(['kg:ev1', 'kg:ev2']);
    expect(n.data.edges.filter((e) => e.type === 'SUPPORTED_BY').map((e) => e.target).sort()).toEqual(['kg:ev1', 'kg:ev2']);
    // the GHM-only evidence never leaks in
    expect(n.data.nodes.find((x) => x.id === 'kg:ev-ghm')).toBeUndefined();
  });

  it('emits no fabricated node types and no issuer-to-issuer edges', () => {
    const n = buildKnowGraphNeighborhood({ nodes: NODES, edges: EDGES, exploration: { seedIssuerId: 'kg:rdw', expandedContextIds: ['kg:rdw-biz', 'kg:rdw-risk', 'kg:rdw-mda'] } });
    const allowedTypes = new Set(['issuer', 'business_context', 'risk_context', 'mda_context', 'evidence']);
    for (const node of n.data.nodes) expect(allowedTypes.has(node.type)).toBe(true);
    const issuerIds = new Set(n.data.nodes.filter((x) => x.type === 'issuer').map((x) => x.id));
    expect(n.data.edges.some((e) => issuerIds.has(e.source) && issuerIds.has(e.target))).toBe(false);
  });

  it('is deterministic across input order and seeds the first issuer by ticker when unset', () => {
    const a = buildKnowGraphNeighborhood({ nodes: NODES, edges: EDGES, exploration: {} });
    const b = buildKnowGraphNeighborhood({ nodes: [...NODES].reverse(), edges: EDGES, exploration: {} });
    expect(a.seedIssuerId).toBe('kg:ghm'); // GHM < RDW alphabetically
    const pos = (n: typeof a, id: string) => { const x = n.data.nodes.find((y) => y.id === id)!; return [x.x, x.y]; };
    expect(pos(a, 'kg:ghm')).toEqual(pos(b, 'kg:ghm'));
    expect(pos(a, 'kg:ghm-biz')).toEqual(pos(b, 'kg:ghm-biz'));
    expect(a.issuerOptions.map((o) => o.ticker)).toEqual(['GHM', 'RDW']);
  });

  it('toggleExpandedContext adds then removes a context id', () => {
    expect(toggleExpandedContext([], 'c')).toEqual(['c']);
    expect(toggleExpandedContext(['c'], 'c')).toEqual([]);
    expect(toggleExpandedContext(['a'], 'c')).toEqual(['a', 'c']);
  });
});
