import { describe, expect, it } from 'vitest';

import {
  classifyRawRole,
  projectExplorationLens,
  type RawEdgeInput,
  type RawNodeInput,
} from './knowGraphExploration';

// Real-shaped raw KnowGraph for project 20ac92da (Redwire): semantic entities + EDGAR issuer/sections
// + source-backed assertions + storage/process control records (the stuff that was wrongly rendered
// as topology hubs). No fabrication — these mirror the live node/edge shapes.
const RAW_NODES: RawNodeInput[] = [
  { id: 'oe-redwire', type: 'ObservedEntity', label: 'Redwire Corporation' },
  { id: 'oe-rdw', type: 'ObservedEntity', label: 'RDW' },
  { id: 'iss-rdw', type: 'Issuer', label: 'RDW 10-K filer', properties: { ticker: 'RDW' } },
  { id: 'ctx-bus', type: 'BusinessContext', label: 'RDW 10-K Item 1 - Business' },
  { id: 'ctx-risk', type: 'RiskContext', label: 'RDW 10-K Item 1A - Risk Factors' },
  { id: 'ctx-mda', type: 'ManagementDiscussionContext', label: 'RDW 10-Q Part I Item 2 - MD&A' },
  { id: 'ev-1', type: 'EvidenceSection', label: 'RDW Item 1 evidence' },
  // source-backed assertions (these become EDGES, not hub nodes):
  { id: 'a-rdw', type: 'SourceBackedAssertion', label: 'long::id::redwire::has_ticker_symbol::rdw', properties: { subject: 'Redwire Corporation', predicate: 'has_ticker_symbol', object: 'RDW', outcome: 'supported', source_ref: 'src-yahoo', source_url: 'https://finance.yahoo.com/quote/RDW', created_at: '2026-06-20T00:00:00Z' } },
  { id: 'a-rwe', type: 'SourceBackedAssertion', label: 'long::id::redwire::has_ticker_symbol::rwe', properties: { subject: 'Redwire Corporation', predicate: 'has_ticker_symbol', object: 'RWE', outcome: 'contradicted', source_ref: 'src-rwe', source_url: 'https://example.com/redwire-rwe', created_at: '2026-06-20T00:00:00Z' } },
  { id: 'a-dev', type: 'SourceBackedAssertion', label: 'long::id::redwire::develops::advanced', properties: { subject: 'Redwire Corporation', predicate: 'DEVELOPS', object: 'advanced technologies', outcome: 'directly_stated', source_ref: 'src-sec', source_url: 'https://sec.gov/x', created_at: '2026-06-20T00:00:00Z' } },
  // storage / process control records — must NOT be topology hubs:
  { id: 'gs-1', type: 'GraphSeed', label: 'edgar_core_graph_v1' },
  { id: 'sp-1', type: 'SearchPacket', label: 'packet-1' },
  { id: 'rr-1', type: 'ResearchRun', label: 'run-1' },
  { id: 'proj-root', type: 'SemanticRecord', label: '20ac92da-project-root' },
];

const RAW_EDGES: RawEdgeInput[] = [
  { id: 'e-ctx-bus', from: 'iss-rdw', to: 'ctx-bus', type: 'HAS_CONTEXT' },
  { id: 'e-ctx-risk', from: 'iss-rdw', to: 'ctx-risk', type: 'HAS_CONTEXT' },
  { id: 'e-ctx-mda', from: 'iss-rdw', to: 'ctx-mda', type: 'HAS_CONTEXT' },
  { id: 'e-sup', from: 'ctx-bus', to: 'ev-1', type: 'SUPPORTED_BY' },
  // storage/process attachment edges (must drop out of topology):
  { id: 'e-seed', from: 'gs-1', to: 'a-rdw', type: 'DERIVED_FROM_GRAPH_SEED' },
  { id: 'e-rel', from: 'a-rdw', to: 'oe-redwire', type: 'RELATES_TO_ENTITY' },
  { id: 'e-pack', from: 'sp-1', to: 'rr-1', type: 'PART_OF_SEARCH_RUN' },
];

function lens(focus = 'Redwire', depth = 1) {
  return projectExplorationLens(RAW_NODES, RAW_EDGES, { focus, lens: 'entity', depth });
}
function edge(l: ReturnType<typeof lens>, predicate: string, fromHint: string, toHint: string) {
  const by = (id: string, hint: string) => l.nodes.find((n) => n.id === id)?.canonicalName.toLowerCase().includes(hint.toLowerCase());
  return l.edges.find((e) => e.predicate === predicate && by(e.source, fromHint) && by(e.target, toHint));
}

describe('KnowGraph semantic exploration lens', () => {
  it('classifies raw roles server-side (semantic vs evidence vs process vs storage)', () => {
    expect(classifyRawRole('ObservedEntity').role).toBe('semantic-primary');
    expect(classifyRawRole('BusinessContext').role).toBe('semantic-secondary');
    expect(classifyRawRole('SourceBackedAssertion').role).toBe('evidence');
    expect(classifyRawRole('SearchPacket').role).toBe('process');
    expect(classifyRawRole('GraphSeed').role).toBe('storage');
  });

  // (1) Default entity focus excludes process/storage/provenance roots from the visual topology.
  it('excludes process/storage/provenance roots from the rendered topology', () => {
    const l = lens();
    expect(l.nodes.every((n) => n.explorationRole === 'semantic-primary' || n.explorationRole === 'semantic-secondary')).toBe(true);
    expect(l.nodes.some((n) => /graphseed|searchpacket|researchrun|project-root/i.test(n.semanticKind) || /project-root/i.test(n.canonicalName))).toBe(false);
    // and they are accounted for (reachable later), not silently dropped
    expect((l.excludedFromTopology.byRole.storage ?? 0) + (l.excludedFromTopology.byRole.process ?? 0)).toBeGreaterThan(0);
  });

  // (2) Redwire → RDW relationship is present.
  it('renders Redwire → TRADES_AS → RDW', () => {
    const l = lens();
    expect(l.focus.canonicalName).toMatch(/Redwire Corporation/i);
    expect(edge(l, 'TRADES_AS', 'redwire', 'rdw')).toBeTruthy();
  });

  // (3) Redwire → RWE competing relationship is present (contradiction shown on state, not deleted).
  it('keeps Redwire → RWE as a competing, contradicted path', () => {
    const l = lens();
    const rwe = edge(l, 'TRADES_AS', 'redwire', 'rwe');
    expect(rwe).toBeTruthy();
    expect((rwe!.statusCounts as any).contradicted).toBe(1);
    // explicit conflict treatment between the competing tickers
    expect(l.edges.some((e) => e.predicate === 'CONTRADICTS')).toBe(true);
  });

  // (4) Both relationship paths retain claim/source raw IDs.
  it('retains claim + source raw IDs on the displayed relationships', () => {
    const l = lens();
    const rdw = edge(l, 'TRADES_AS', 'redwire', 'rdw')!;
    const rwe = edge(l, 'TRADES_AS', 'redwire', 'rwe')!;
    expect(rdw.rawIds).toContain('a-rdw');
    expect(rdw.evidenceIds).toContain('a-rdw');
    expect(rdw.sourceIds).toContain('src-yahoo');
    expect(rwe.rawIds).toContain('a-rwe');
    expect(rwe.sourceIds).toContain('src-rwe');
  });

  // (5) A linked EDGAR issuer → filing/section path is present (RDW ticker merges with the issuer).
  it('weaves the EDGAR issuer → section path into the same lens', () => {
    const l = lens();
    const rdwNode = l.nodes.find((n) => n.canonicalName === 'RDW');
    expect(rdwNode).toBeTruthy();
    const sections = l.edges.filter((e) => e.predicate === 'HAS_CONTEXT' && e.source === rdwNode!.id);
    expect(sections.length).toBeGreaterThanOrEqual(1);
    expect(l.nodes.some((n) => n.displayLabel === 'Business')).toBe(true);
  });

  // (6) Expanding a displayed relation reveals its real source-backed assertion(s).
  it('exposes the underlying assertion id on the relation for expand/inspect', () => {
    const l = lens();
    const rdw = edge(l, 'TRADES_AS', 'redwire', 'rdw')!;
    expect(rdw.evidenceIds.length).toBeGreaterThan(0);
    expect(RAW_NODES.some((n) => n.id === rdw.evidenceIds[0] && /assertion/i.test(String(n.type)))).toBe(true);
  });

  // (7) A raw storage record stays classified/reachable but is never a topology hub.
  it('classifies a storage record but never renders it as a hub', () => {
    const l = lens();
    expect(l.nodes.find((n) => n.id === 'gs-1')).toBeUndefined();
    expect(classifyRawRole('GraphSeed').role).toBe('storage');
    expect(l.excludedFromTopology.byRole.storage).toBeGreaterThanOrEqual(1);
  });

  // (8) The lens is bounded — an unrelated semantic entity with no path to focus does not enter it.
  it('is bounded to the focus neighborhood (no unrelated entity bleed)', () => {
    const withStranger = projectExplorationLens(
      [...RAW_NODES, { id: 'oe-nvda', type: 'ObservedEntity', label: 'NVIDIA Corporation' }],
      RAW_EDGES,
      { focus: 'Redwire', lens: 'entity', depth: 1 },
    );
    expect(withStranger.nodes.some((n) => /nvidia/i.test(n.canonicalName))).toBe(false);
  });
});

// ── Exact-ID focus contract (defects 1 & 2): unique graph IDs, first-class lens types ──────────────
describe('KnowGraph exploration — exact-id focus resolution', () => {
  const redwireCanonicalId = projectExplorationLens(RAW_NODES, RAW_EDGES, { focus: 'Redwire' }).focus.id;

  // (T1) Duplicate / ambiguous labels cannot make an exact focus select the wrong node.
  it('an exact focus id beats an ambiguous label (no wrong-node selection)', () => {
    const nodes = [...RAW_NODES, { id: 'oe-redwire-space', type: 'ObservedEntity', label: 'Redwire Space' }];
    // focusId resolves to EXACTLY the requested raw object, not the look-alike hub.
    const exact = projectExplorationLens(nodes, RAW_EDGES, { focusId: 'oe-redwire-space', focusKind: 'company' });
    expect(exact.focus.canonicalName).toMatch(/Redwire Space/i);
    expect(exact.focus.id).not.toBe(redwireCanonicalId);
    expect(exact.focus.matched).toBe(true);
    // a bare ambiguous label is the SEARCH fallback and ranks by degree → the real hub, never the stub.
    const byLabel = projectExplorationLens(nodes, RAW_EDGES, { focus: 'Redwire' });
    expect(byLabel.focus.canonicalName).toMatch(/Redwire Corporation/i);
  });

  // (T2) Exact raw graph id of Redwire reaches Redwire.
  it('exact raw id focus of Redwire reaches Redwire', () => {
    const l = projectExplorationLens(RAW_NODES, RAW_EDGES, { focusId: 'oe-redwire', focusKind: 'company' });
    expect(l.focus.id).toBe(redwireCanonicalId);
    expect(l.focus.canonicalName).toMatch(/Redwire Corporation/i);
    expect(l.focus.matched).toBe(true);
  });

  // (T3) Exact raw id of an RDW Risks section returns a SECTION-centered graph, not a company lens.
  it('exact section id focus returns a section-centered lens (issuer + section evidence around it)', () => {
    const l = projectExplorationLens(RAW_NODES, RAW_EDGES, { focusId: 'ctx-risk', focusKind: 'riskcontext' });
    const focusNode = l.nodes.find((n) => n.id === l.focus.id)!;
    expect(focusNode.semanticKind).toBe('riskcontext');
    expect(focusNode.displayLabel).toBe('Risks');
    // centered on the SECTION — not silently re-focused to the company/ticker
    expect(l.focus.id).not.toBe(redwireCanonicalId);
    expect(focusNode.semanticKind).not.toMatch(/company|ticker/);
    // its issuer is reachable, and the section's evidence + source are surfaced around it
    expect(l.nodes.some((n) => n.semanticKind === 'claim')).toBe(true);
    expect(l.nodes.some((n) => n.semanticKind === 'source')).toBe(true);
  });

  // (T4) Exact source-backed assertion id focus returns that claim → object/subject → source path.
  it('exact assertion id focus returns the claim/source path', () => {
    const l = projectExplorationLens(RAW_NODES, RAW_EDGES, { focusId: 'a-rdw', focusKind: 'sourcebackedassertion' });
    const focusNode = l.nodes.find((n) => n.id === l.focus.id)!;
    expect(focusNode.semanticKind).toBe('claim');
    expect(focusNode.rawIds).toContain('a-rdw');
    // the claim is connected to its source (FROM_SOURCE) and that source node is present
    const fromSource = l.edges.find((e) => e.predicate === 'FROM_SOURCE' && e.source === l.focus.id);
    expect(fromSource).toBeTruthy();
    expect(l.nodes.some((n) => n.id === fromSource!.target && n.semanticKind === 'source')).toBe(true);
    // and to its subject (the company) via HAS_CLAIM
    expect(l.edges.some((e) => e.predicate === 'HAS_CLAIM' && e.target === l.focus.id)).toBe(true);
  });

  // (T7) A cross-project / out-of-scope focus id is rejected — never silently centers another object.
  it('rejects a focus id that is not in project scope', () => {
    const l = projectExplorationLens(RAW_NODES, RAW_EDGES, { focusId: 'foreign-elementid-from-another-project', focusKind: 'company' });
    expect(l.focus.matched).toBe(false);
    expect(l.focus.id).not.toBe('foreign-elementid-from-another-project');
    expect(l.warnings.some((w) => /focus_id_not_in_project_scope/.test(w))).toBe(true);
  });
});
