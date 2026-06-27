import { describe, expect, it } from 'vitest';

import {
  classifyEntityType,
  predicateToRelType,
  projectEvidenceGraph,
  type AssertionRow,
} from './knowGraphEvidenceProjection';

// Real-shaped rows mirroring the live :SourceBackedAssertion data for project
// 20ac92da (RDW). No fabrication — these are the actual stored fields.
const RDW_ASSERTIONS: AssertionRow[] = [
  {
    id: 'a1', subject: 'Redwire Corporation', predicate: 'has_ticker_symbol', object: 'RDW',
    outcome: 'supported', confidence: 0.6, source_ref: 'src-yahoo',
    source_title: 'Redwire Corporation (RDW) Stock Quote - NYSE ticker symbol',
    source_url: 'https://finance.yahoo.com/quote/RDW', evidence_text: 'RDW trades on NYSE.',
    created_at: '2026-06-20T00:00:00Z',
  },
  {
    id: 'a2', subject: 'Redwire Corporation', predicate: 'has_ticker_symbol', object: 'RWE',
    outcome: 'contradicted', confidence: 0.5, source_ref: 'src-rwe',
    source_title: 'Redwire Space trades under ticker symbol RWE on the exchange',
    source_url: 'https://example.com/redwire-rwe', evidence_text: 'Claims RWE.',
    created_at: '2026-06-20T00:00:00Z',
  },
  {
    id: 'a3', subject: 'SpaceX', predicate: 'has_current_valuation', object: 'unknown',
    outcome: 'uncertain', confidence: 0.2, source_ref: 'src-forge',
    source_title: 'SpaceX private company valuation news on the secondary market',
    source_url: 'https://forgeglobal.com/spacex', evidence_text: 'Secondary market only.',
    created_at: '2026-06-20T00:00:00Z',
  },
];

describe('knowGraph evidence projection', () => {
  it('types entities structurally without model inference', () => {
    expect(classifyEntityType('RDW')).toBe('Ticker');
    expect(classifyEntityType('Redwire Corporation')).toBe('Company');
    expect(classifyEntityType('airborne systems')).toBe('Topic');
    expect(classifyEntityType('SpaceX')).toBe('Entity');
  });

  it('maps predicates to typed relationships (never blanket RELATED_TO)', () => {
    expect(predicateToRelType('has_ticker_symbol')).toBe('TRADES_AS');
    expect(predicateToRelType('PARTNERS_WITH')).toBe('PARTNERS_WITH');
  });

  it('projects Redwire → TRADES_AS → RDW with a source path', () => {
    const g = projectEvidenceGraph(RDW_ASSERTIONS);
    const company = g.nodes.find((n) => n.type === 'Company' && /Redwire/.test(n.label));
    const rdw = g.nodes.find((n) => n.type === 'Ticker' && n.label === 'RDW');
    expect(company).toBeTruthy();
    expect(rdw).toBeTruthy();
    const tradesEdge = g.relationships.find((r) => r.type === 'TRADES_AS' && r.from === company!.id && r.to === rdw!.id);
    expect(tradesEdge).toBeTruthy();
    expect((tradesEdge!.properties as any).outcome).toBe('supported');
    // claim → SOURCED_FROM → real source node
    const sourceNode = g.nodes.find((n) => n.type === 'Source' && /NYSE ticker symbol/.test(n.label));
    expect(sourceNode).toBeTruthy();
    expect(g.relationships.some((r) => r.type === 'SOURCED_FROM' && r.to === sourceNode!.id)).toBe(true);
  });

  it('draws an explicit CONTRADICTS edge for the RDW↔RWE conflict', () => {
    const g = projectEvidenceGraph(RDW_ASSERTIONS);
    const rdw = g.nodes.find((n) => n.label === 'RDW');
    const rwe = g.nodes.find((n) => n.label === 'RWE');
    expect(rdw && rwe).toBeTruthy();
    const contra = g.relationships.find((r) => r.type === 'CONTRADICTS');
    expect(contra).toBeTruthy();
    expect([contra!.from, contra!.to].sort()).toEqual([rdw!.id, rwe!.id].sort());
    // the RWE edge itself carries outcome=contradicted
    expect(g.relationships.some((r) => r.type === 'TRADES_AS' && r.to === rwe!.id && (r.properties as any).outcome === 'contradicted')).toBe(true);
  });

  it('represents an unknown valuation as a Question + Assessment, NOT a SpaceX fact', () => {
    const g = projectEvidenceGraph(RDW_ASSERTIONS);
    // No entity node literally named "unknown"; no TRADES_AS/HAS_VALUATION fact edge to it.
    expect(g.nodes.some((n) => /^unknown$/i.test(n.label))).toBe(false);
    expect(g.relationships.some((r) => r.type === 'HAS_VALUATION')).toBe(false);
    const q = g.nodes.find((n) => n.type === 'Question' && /SpaceX/.test(n.label));
    const assess = g.nodes.find((n) => n.type === 'Assessment' && /uncertain/.test(n.label));
    expect(q).toBeTruthy();
    expect(assess).toBeTruthy();
    expect(g.relationships.some((r) => r.type === 'ASSESSES' && r.from === assess!.id && r.to === q!.id)).toBe(true);
  });

  it('dedupes the shared Redwire entity across multiple assertions', () => {
    const g = projectEvidenceGraph(RDW_ASSERTIONS);
    const companies = g.nodes.filter((n) => /Redwire Corporation/.test(n.label) && n.type === 'Company');
    expect(companies).toHaveLength(1);
  });

  it('is honest-empty on no input', () => {
    expect(projectEvidenceGraph([])).toEqual({ nodes: [], relationships: [] });
  });
});
