import { describe, expect, it, vi } from 'vitest';

// Mock the AGE write layer so the real default write path is provable without a DB.
vi.mock('../services/graphService', () => ({
  runCypherOnGraph: vi.fn().mockResolvedValue([]),
}));

import { runCypherOnGraph } from '../services/graphService';
import { runSlmGraphTask, type SlmGraphInput, type SlmGraphParse } from './slmGraphWorker';
import { writeSlmExtractionToThinkGraph } from './thinkGraphWrite';

const SAMPLE_TEXT = 'User wants to add Local Gemma as an SLM graph worker for OWL extraction.';

const VALID_SLM = JSON.stringify({
  entities: [
    { id: 'local_gemma', label: 'Local Gemma', type: 'Model' },
    { id: 'owl_extraction', label: 'OWL extraction', type: 'Task' },
  ],
  relations: [{ from: 'local_gemma', to: 'owl_extraction', type: 'performs' }],
  categories: ['Model', 'Task'],
  assertions: [],
  sourceRefs: [{ ref: 'chat-1', type: 'chat' }],
  confidence: 0.82,
  uncertainty: ['exact ontology class unknown'],
  nextSearchSeedCandidates: [],
});

const baseInput: SlmGraphInput = {
  targetGraph: 'thinkgraph',
  inputKind: 'llm_chat_useful_part',
  sourceRef: 'chat-1',
  text: SAMPLE_TEXT,
  ontologySlice: {},
  allowedClasses: ['Model', 'Task'],
  allowedRelations: ['performs'],
  nearbyEntities: [],
  nearbyRelations: [],
};

function runSample(returns: string): Promise<SlmGraphParse> {
  return runSlmGraphTask(baseInput, { call: async () => returns });
}

describe('SLM graph extraction -> ThinkGraph write', () => {
  it('valid SLM output creates a ThinkGraph write payload with the required fields', async () => {
    const slm = await runSample(VALID_SLM);
    const writes: any[] = [];
    const res = await writeSlmExtractionToThinkGraph(
      slm,
      { projectId: 'p1', sourceRef: 'chat-1' },
      { write: async (record) => { writes.push(record); return { id: 'tg1', ts: 't' }; } },
    );

    expect(res.ok).toBe(true);
    expect(writes).toHaveLength(1);
    const rec = writes[0];
    expect(rec.entities.length).toBeGreaterThan(0); // entity
    expect(rec.relations.length).toBeGreaterThan(0); // relation
    expect(rec.categories).toContain('Model'); // category
    expect(rec.sourceRefs.some((s: any) => s.ref === 'chat-1')).toBe(true); // sourceRef
    expect(rec.confidence).toBeCloseTo(0.82); // confidence
    expect(rec.uncertainty.length).toBeGreaterThan(0); // uncertainty
    expect(rec.createdBy).toBe('slmGraphWorker'); // createdBy
  });

  it('writes canonical fields (no undefined) from a LIVE gemma3-qat-shaped extraction', async () => {
    // Exact live drift: name/class/source/target/relation + string sourceRefs + numeric uncertainty.
    const LIVE = JSON.stringify({
      entities: [{ id: 'e1', name: 'Local Gemma', class: 'Model', confidence: 0.95, uncertainty: 0.05 }],
      relations: [{ source: 'e1', target: 'thinkgraph', relation: 'performs', confidence: 0.9, uncertainty: 0.1 }],
      categories: ['SLM Graph Worker'],
      assertions: [{ relation: 'performs', confidence: 0.9, uncertainty: 0.1 }],
      sourceRefs: ['live-probe'],
      confidence: 0.85,
      uncertainty: 0.15,
    });
    const slm = await runSample(LIVE);
    const writes: any[] = [];
    const res = await writeSlmExtractionToThinkGraph(
      slm,
      { projectId: 'p1', sourceRef: 'live-probe' },
      { write: async (record) => { writes.push(record); return { id: 'tg-live', ts: 't' }; } },
    );

    expect(res.ok).toBe(true);
    const rec = writes[0];
    // Canonical entity fields, no undefined.
    expect(rec.entities[0].label).toBe('Local Gemma');
    expect(rec.entities[0].type).toBe('Model');
    expect(rec.entities.every((e: any) => e.label !== undefined && e.type !== undefined)).toBe(true);
    // Canonical relation fields, no undefined.
    expect(rec.relations[0].from).toBe('e1');
    expect(rec.relations[0].to).toBe('thinkgraph');
    expect(rec.relations[0].type).toBe('performs');
    expect(
      rec.relations.every((r: any) => r.from !== undefined && r.to !== undefined && r.type !== undefined),
    ).toBe(true);
    // sourceRefs normalized to object refs.
    expect(rec.sourceRefs.some((s: any) => s.ref === 'live-probe')).toBe(true);
  });

  it('invalid SLM output fails closed (no write attempted)', async () => {
    const bad = await runSample('not json at all');
    expect(bad.ok).toBe(false);

    let called = false;
    const res = await writeSlmExtractionToThinkGraph(
      bad,
      { projectId: 'p1' },
      { write: async () => { called = true; return { id: 'x', ts: 't' }; } },
    );
    expect(res.ok).toBe(false);
    expect(called).toBe(false);
  });

  it('does not report fake success when the ThinkGraph write fails', async () => {
    const slm = await runSample(VALID_SLM);
    const res = await writeSlmExtractionToThinkGraph(
      slm,
      { projectId: 'p1' },
      { write: async () => { throw new Error('age_unavailable'); } },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('age_unavailable');
  });

  it('default path issues a real ThinkGraph AGE cypher write', async () => {
    const slm = await runSample(VALID_SLM);
    const res = await writeSlmExtractionToThinkGraph(slm, { projectId: 'p1', sourceRef: 'chat-1' });

    expect(res.ok).toBe(true);
    expect(runCypherOnGraph).toHaveBeenCalled();
    const call = (runCypherOnGraph as any).mock.calls.at(-1);
    expect(call[0]).toBe('thinkgraph_liq'); // wrote into the ThinkGraph graph
    expect(String(call[1])).toContain('SlmGraphRecord');
    expect(call[2]).toMatchObject({ projectId: 'p1', createdBy: 'slmGraphWorker' });
  });
});
