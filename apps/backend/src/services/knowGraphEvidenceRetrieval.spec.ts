import { describe, expect, it, vi } from 'vitest';

import {
  buildLuceneQuery,
  luceneEscape,
  retrieveGroundedEvidence,
  type Neo4jRunner,
} from './knowGraphEvidenceRetrieval';

describe('KnowGraph scoped evidence retrieval', () => {
  it('escapes Lucene specials and builds a bounded OR query', () => {
    expect(luceneEscape('RDW:RWE')).toBe('RDW\\:RWE');
    expect(buildLuceneQuery('Redwire RDW SpaceX')).toBe('Redwire OR RDW OR SpaceX');
    expect(buildLuceneQuery('   ')).toBe('');
  });

  it('runs a project-scoped, read-only full-text read and maps full provenance', async () => {
    const calls: Array<{ cypher: string; params: Record<string, unknown> }> = [];
    const run: Neo4jRunner = async (cypher, params) => {
      calls.push({ cypher, params });
      return [
        {
          id: 'a1',
          subject: 'Redwire Corporation',
          predicate: 'has_ticker_symbol',
          object: 'RDW',
          outcome: 'supported',
          confidence: 0.9,
          source_ref: 'src-1',
          source_title: 'Redwire (RDW) Stock Quote - NYSE',
          source_url: 'https://example.com/rdw',
          evidence_text: 'RDW trades on NYSE.',
          retrieval_summary: 'RDW ticker confirmed.',
          created_at: '2026-06-20T00:00:00.000Z',
          score: 3.2,
        },
      ];
    };

    const out = await retrieveGroundedEvidence(
      { projectId: 'proj-A', query: 'Redwire RDW ticker', limit: 4 },
      { run },
    );

    expect(calls).toHaveLength(1);
    // Project scope is enforced inside the Cypher (cross-project rows can't leak).
    expect(calls[0].cypher).toContain('node.project_id = $projectId');
    expect(calls[0].cypher).toContain('db.index.fulltext.queryNodes');
    expect(calls[0].cypher).not.toMatch(/\b(MERGE|CREATE|SET|DELETE|REMOVE)\b/);
    expect(calls[0].params).toMatchObject({ projectId: 'proj-A', index: 'kg_assertion_fulltext' });
    expect(out[0]).toMatchObject({
      assertionId: 'a1',
      subject: 'Redwire Corporation',
      object: 'RDW',
      outcome: 'supported',
      sourceTitle: 'Redwire (RDW) Stock Quote - NYSE',
      sourceUrl: 'https://example.com/rdw',
    });
    expect(out[0].confidence).toBe(0.9);
  });

  it('returns honest empty for blank project or unusable query — never touches Neo4j', async () => {
    const run = vi.fn();
    expect(await retrieveGroundedEvidence({ projectId: '', query: 'RDW' }, { run })).toEqual([]);
    expect(await retrieveGroundedEvidence({ projectId: 'p', query: ' ' }, { run })).toEqual([]);
    expect(run).not.toHaveBeenCalled();
  });
});
