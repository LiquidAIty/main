import { describe, expect, it } from 'vitest';

import {
  conciseNodeLabel,
  edgeColorByType,
  nodeColorByRole,
  nodeRole,
  outcomeRingColor,
  type KnowledgeGraphNode,
} from './knowledgeGraphGrammar';

// Real-shaped nodes mirroring the live semantic-graph (one compatible KnowGraph: EDGAR roles +
// source-backed claims + sources). The visual grammar is the fix — every role must read distinctly.
function node(partial: Partial<KnowledgeGraphNode> & { id: string; type: string }): KnowledgeGraphNode {
  return { label: partial.id, source: 'know', scope: 'project', ...partial } as KnowledgeGraphNode;
}

const rdwClaim = node({
  id: 'kg:assertion-rdw', type: 'SourceBackedAssertion',
  label: '20ac92da::assertion::redwire corporation::has_ticker_symbol::rdw::https://finance.yahoo.com/quote/RDW',
  properties: { subject: 'Redwire Corporation', predicate: 'has_ticker_symbol', object: 'RDW', outcome: 'supported', source_url: 'https://finance.yahoo.com/quote/RDW' },
});
const rweClaim = node({
  id: 'kg:assertion-rwe', type: 'SourceBackedAssertion',
  label: '20ac92da::assertion::redwire corporation::has_ticker_symbol::rwe::https://example.com/redwire-rwe',
  properties: { subject: 'Redwire Corporation', predicate: 'has_ticker_symbol', object: 'RWE', outcome: 'contradicted', source_url: 'https://example.com/redwire-rwe' },
});
const directlyStated = node({
  id: 'kg:assertion-ds', type: 'SourceBackedAssertion',
  properties: { subject: 'Redwire', predicate: 'DEVELOPS', object: 'advanced technologies', outcome: 'directly_stated', source_url: 'https://sec.gov/x' },
});

describe('KnowGraph explorer visual grammar', () => {
  // (1) A displayed claim keeps its underlying raw id + source provenance — label is concise, data is intact.
  it('renders a concise claim label by OBJECT but keeps raw id + source reachable', () => {
    expect(conciseNodeLabel(rdwClaim)).toBe('RDW');
    expect(conciseNodeLabel(rweClaim)).toBe('RWE');
    // the full assertion id and source_url remain on the node for hover/Inspector
    expect(rdwClaim.id).toContain('assertion-rdw');
    expect((rdwClaim.properties as any).source_url).toMatch(/^https?:\/\//);
    // never a full sentence as the canvas label
    expect(conciseNodeLabel(rdwClaim).length).toBeLessThanOrEqual(22);
  });

  // (2) RDW and RWE remain discoverable as COMPETING paths: distinct labels, distinct outcome rings.
  it('shows RDW (supported) and RWE (contradicted) as competing claims with distinct outcome encoding', () => {
    expect(conciseNodeLabel(rdwClaim)).not.toBe(conciseNodeLabel(rweClaim));
    expect(outcomeRingColor(rdwClaim)).toBe('#56d364'); // supported = green
    expect(outcomeRingColor(rweClaim)).toBe('#ff5c52'); // contradicted = red
    // the competing relationship reads as a conflict edge
    expect(edgeColorByType('CONTRADICTS', '#fallback')).toBe('#ff5c52');
    expect(edgeColorByType('SUPPORTED_BY', '#fallback')).toBe('#56d364');
  });

  // (3) EDGAR filing/section roles stay first-class and visually distinct (navigable, not gray noise).
  it('gives EDGAR roles distinct colors (Issuer / Business / Risk / MD&A / EvidenceSection)', () => {
    const colors = ['Issuer', 'BusinessContext', 'RiskContext', 'ManagementDiscussionContext', 'EvidenceSection']
      .map((t) => nodeColorByRole(node({ id: t, type: t })));
    // all defined, none collapsed to the same gray dot
    expect(new Set(colors).size).toBe(colors.length);
    expect(colors.every((c) => /^#/.test(c))).toBe(true);
  });

  // (4) directly_stated / hypothesis / source items remain reachable & colored — never filtered as "noise".
  it('keeps directly_stated and source items visible (colored), without a verified-truth ring', () => {
    expect(nodeColorByRole(directlyStated)).toBe('#f2cc60'); // still a claim, still colored
    expect(outcomeRingColor(directlyStated)).toBeNull(); // extracted, not asserted as verified truth
    expect(nodeColorByRole(node({ id: 's', type: 'Source' }))).toBe('#d4a373');
    expect(nodeColorByRole(node({ id: 'e', type: 'ObservedEntity' }))).toBe('#67e8f9');
  });

  // (5) Unknown / ambiguous roles are NOT dropped — they still get a real color (kept visible).
  it('never drops an unknown role — it falls back to a real source color, not nothing', () => {
    const unknown = node({ id: 'weird', type: 'SomeUnmappedRole' });
    expect(nodeColorByRole(unknown)).toMatch(/^#|rgb/);
    expect(nodeRole(unknown)).toBe('someunmappedrole');
  });
});
