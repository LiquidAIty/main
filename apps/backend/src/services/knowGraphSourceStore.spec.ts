import { describe, expect, it, vi } from 'vitest';

import {
  readKnowGraphSourceRecord,
  writeKnowGraphSourceRecord,
  type KnowGraphSourceRecord,
  type Neo4jRunner,
} from './knowGraphSourceStore';

// Static-source-derived deterministic normalized extraction (NO model call).
const RECORD: KnowGraphSourceRecord = {
  projectId: 'kg-static-source-test',
  sourceRef: 'static-knowgraph-source-1',
  sourceType: 'static_source_chunk',
  title: 'Local graph intelligence note',
  textHash: 'abc123',
  entities: [
    { id: 'e1', label: 'LiquidAIty', type: 'System', confidence: 0.9 },
    { id: 'e2', label: 'Local Gemma', type: 'Model', confidence: 0.95 },
    { id: 'e3', label: 'KnowGraph', type: 'Graph', confidence: 0.9 },
  ],
  relations: [{ from: 'e1', to: 'e2', type: 'uses', confidence: 0.9 }],
  categories: ['local_model_worker', 'knowgraph_ingestion', 'graph_search'],
  assertions: [],
  sourceRefs: [{ ref: 'static-knowgraph-source-1', kind: 'static_source' }],
  confidence: 0.85,
  uncertainty: ['0.15'],
  createdBy: 'staticKnowGraphProbe',
};

describe('KnowGraph source record write (mocked Neo4j)', () => {
  it('writes a :KnowGraphSourceRecord keyed by project_id + source_ref with canonical fields', async () => {
    const calls: Array<{ cypher: string; params: Record<string, any> }> = [];
    const run: Neo4jRunner = async (cypher, params) => {
      calls.push({ cypher, params });
      return [{ source_ref: RECORD.sourceRef }];
    };
    const res = await writeKnowGraphSourceRecord(RECORD, { run });

    expect(res.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].cypher).toContain('KnowGraphSourceRecord');
    expect(calls[0].params.projectId).toBe('kg-static-source-test');
    expect(calls[0].params.sourceRef).toBe('static-knowgraph-source-1');
    // canonical entity label/type survive into the stored JSON
    const storedEntities = JSON.parse(calls[0].params.entitiesJson);
    expect(storedEntities[0].label).toBe('LiquidAIty');
    expect(storedEntities[0].type).toBe('System');
    const storedRels = JSON.parse(calls[0].params.relationsJson);
    expect(storedRels[0].from).toBe('e1');
    expect(storedRels[0].to).toBe('e2');
    expect(storedRels[0].type).toBe('uses');
    expect(calls[0].params.categories).toContain('local_model_worker');
  });

  it('returns honest knowgraph_write_failed when Neo4j throws', async () => {
    const run: Neo4jRunner = async () => {
      throw new Error('Neo4jError: ServiceUnavailable');
    };
    const res = await writeKnowGraphSourceRecord(RECORD, { run });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe('knowgraph_write_failed');
    expect(res.error).toContain('ServiceUnavailable');
  });
});

describe('KnowGraph source record read-back (mocked Neo4j)', () => {
  const storedRow = {
    project_id: 'kg-static-source-test',
    source_ref: 'static-knowgraph-source-1',
    source_type: 'static_source_chunk',
    title: 'Local graph intelligence note',
    url: '',
    text_hash: 'abc123',
    entities_json: JSON.stringify([
      { id: 'e1', label: 'LiquidAIty', type: 'System' },
      { id: 'e2', label: 'Local Gemma', type: 'Model' },
    ]),
    relations_json: JSON.stringify([{ from: 'e1', to: 'e2', type: 'uses' }]),
    categories: ['local_model_worker', 'knowgraph_ingestion', 'graph_search'],
    assertions_json: '[]',
    source_refs_json: JSON.stringify([{ ref: 'static-knowgraph-source-1' }]),
    confidence: 0.85,
    uncertainty: ['0.15'],
    created_by: 'staticKnowGraphProbe',
  };

  it('reads by project_id + source_ref and returns canonical fields', async () => {
    const calls: Array<{ cypher: string; params: Record<string, any> }> = [];
    const run: Neo4jRunner = async (cypher, params) => {
      calls.push({ cypher, params });
      return [storedRow];
    };
    const res = await readKnowGraphSourceRecord(
      { projectId: 'kg-static-source-test', sourceRef: 'static-knowgraph-source-1' },
      { run },
    );

    expect(calls[0].cypher).toContain('KnowGraphSourceRecord');
    expect(calls[0].params).toEqual({ projectId: 'kg-static-source-test', sourceRef: 'static-knowgraph-source-1' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.record.entities[0].label).toBe('LiquidAIty');
    expect(res.record.entities[0].type).toBe('System');
    expect(res.record.relations[0].from).toBe('e1');
    expect(res.record.relations[0].to).toBe('e2');
    expect(res.record.relations[0].type).toBe('uses');
    expect(res.record.categories).toContain('local_model_worker');
    expect(res.record.sourceRef).toBe('static-knowgraph-source-1');
  });

  it('returns honest not_found when no row matches', async () => {
    const run: Neo4jRunner = async () => [];
    const res = await readKnowGraphSourceRecord({ projectId: 'p', sourceRef: 'missing' }, { run });
    expect(res).toEqual({ ok: false, reason: 'not_found' });
  });

  it('returns honest knowgraph_query_failed when Neo4j throws', async () => {
    const run: Neo4jRunner = async () => {
      throw new Error('ServiceUnavailable: connection refused');
    };
    const res = await readKnowGraphSourceRecord({ projectId: 'p', sourceRef: 'rt' }, { run });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe('knowgraph_query_failed');
  });

  it('does not query with incomplete identity (honest not_found)', async () => {
    const run = vi.fn();
    const res = await readKnowGraphSourceRecord({ projectId: '', sourceRef: 'rt' }, { run });
    expect(res).toEqual({ ok: false, reason: 'not_found' });
    expect(run).not.toHaveBeenCalled();
  });
});
