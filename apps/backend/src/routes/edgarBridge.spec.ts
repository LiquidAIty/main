import { describe, expect, it } from 'vitest';

import { buildEdgarContextRecords } from './knowgraph.routes';

const sections = [
  { issuer: 'RDW', cik: '0001819810', accessionNumber: '0001819810-26-000029', sectionItemId: '1', formType: '10-K', originalSecFilingUrl: 'https://www.sec.gov/Archives/edgar/data/1819810/000181981026000029/rdw-20251231.htm', normalizedTextLength: 36999, normalizedText: 'FULL TEXT THAT MUST NOT LEAK', extractionTimestamp: '2026-06-20T00:00:00Z' },
  { issuer: 'RDW', cik: '0001819810', accessionNumber: '0001819810-26-000029', sectionItemId: '1A', formType: '10-K', originalSecFilingUrl: 'https://www.sec.gov/Archives/edgar/data/1819810/000181981026000029/rdw-20251231.htm', normalizedTextLength: 100, normalizedText: 'RISK TEXT', extractionTimestamp: '2026-06-20T00:00:00Z' },
  { issuer: 'RDW', cik: '0001819810', accessionNumber: '0001819810-26-000063', sectionItemId: 'part1item2', formType: '10-Q', originalSecFilingUrl: 'https://www.sec.gov/Archives/edgar/data/1819810/000181981026000063/rdw-20260331.htm', normalizedTextLength: 50, normalizedText: 'MDA TEXT', extractionTimestamp: '2026-06-20T00:00:00Z' },
  { issuer: 'RDW', cik: '0001819810', accessionNumber: '0001819810-26-000099', sectionItemId: '9', formType: '10-K', originalSecFilingUrl: 'https://www.sec.gov/x', normalizedText: 'X' }, // unsupported -> skipped
];

describe('EDGAR cache -> SemanticRecord bridge builder', () => {
  const records = buildEdgarContextRecords(sections);
  const byClass = (c: string) => records.filter((r) => r.owlClass === c);

  it('maps filing items only by structure (Item1->Business, 1A->Risk, part1item2->MD&A)', () => {
    expect(byClass('BusinessContext').map((r) => r.label)).toEqual(['RDW 10-K Item 1 - Business']);
    expect(byClass('RiskContext')).toHaveLength(1);
    expect(byClass('ManagementDiscussionContext')).toHaveLength(1);
  });

  it('skips unsupported section types explicitly (no context for Item 9)', () => {
    expect(records.some((r) => String(r.id).includes(':9'))).toBe(false);
  });

  it('uses deterministic IDs (rerun resolves to same identity)', () => {
    const ctx = byClass('BusinessContext')[0];
    expect(ctx.id).toBe('edgar:BusinessContext:0001819810:0001819810-26-000029:1');
    const second = buildEdgarContextRecords(sections);
    expect(second.find((r) => r.owlClass === 'BusinessContext')!.id).toBe(ctx.id);
  });

  it('every context carries sourceRefs with canonical SEC URL + accession + cacheRef', () => {
    for (const ctx of [...byClass('BusinessContext'), ...byClass('RiskContext'), ...byClass('ManagementDiscussionContext')]) {
      const ref = (ctx.sourceRefs || [])[0];
      expect(ref?.type).toBe('url');
      expect(String(ref?.ref)).toMatch(/^https:\/\/www\.sec\.gov\//);
      expect(String((ctx.properties as any).accessionNumber)).toMatch(/^\d{10}-\d{2}-\d{6}$/);
      expect(String((ctx.properties as any).cacheRef)).toContain('edgar_seed_data/cache/');
      expect(ctx.annotationProperties).toContainEqual({ key: 'seedTag', value: 'edgar_core_seed' });
    }
  });

  it('does NOT leak full extracted text into record properties', () => {
    const blob = JSON.stringify(records);
    expect(blob).not.toContain('FULL TEXT THAT MUST NOT LEAK');
    expect(blob).not.toContain('RISK TEXT');
  });

  it('builds Issuer with HAS_CONTEXT and context SUPPORTED_BY EvidenceSection', () => {
    const issuer = byClass('Issuer')[0];
    expect(issuer.objectProperties.some((op: any) => op.type === 'HAS_CONTEXT')).toBe(true);
    const ctx = byClass('BusinessContext')[0];
    expect(ctx.relationships.some((r) => r.type === 'SUPPORTED_BY')).toBe(true);
  });

  it('creates no Claim/Task/TradeSignal/Portfolio/Hedge/Thesis records', () => {
    const forbidden = ['Claim', 'Task', 'TradeSignal', 'Portfolio', 'Hedge', 'Thesis', 'PaperExperiment'];
    expect(records.some((r) => forbidden.includes(String(r.owlClass)))).toBe(false);
  });
});
