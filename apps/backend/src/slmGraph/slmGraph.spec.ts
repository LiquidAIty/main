import { describe, expect, it } from 'vitest';

import {
  buildSlmGraphPrompt,
  parseSlmGraphExtraction,
  runSlmGraphTask,
} from './slmGraphWorker';
import { compileSearchParams } from './graphToSearchParams';
import { storedThinkGraphRecordToSearchParams } from './thinkGraphRecordToSearch';

function slmJson(
  entities: { id: string; label: string; type: string }[],
  relations: { from: string; to: string; type: string }[] = [],
): string {
  return JSON.stringify({
    entities,
    relations,
    categories: ['Thing'],
    assertions: [],
    sourceRefs: [],
    confidence: 0.8,
    uncertainty: [],
    nextSearchSeedCandidates: [],
  });
}

describe('SLM graph extraction (JSON only, fail closed)', () => {
  it('parses valid SLM graph JSON', () => {
    const res = parseSlmGraphExtraction(slmJson([{ id: 'a', label: 'Acme', type: 'org' }]));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.result.entities).toHaveLength(1);
      expect(res.result.categories).toContain('Thing');
    }
  });

  // The exact shape observed from a live gemma3-qat run (name/class/source/target/
  // relation + string sourceRefs + numeric uncertainty).
  const LIVE_GEMMA_SHAPE = JSON.stringify({
    entities: [{ id: 'e1', name: 'Local Gemma', class: 'Model', confidence: 0.95, uncertainty: 0.05 }],
    relations: [{ source: 'e1', target: 'thinkgraph', relation: 'performs', confidence: 0.9, uncertainty: 0.1 }],
    categories: ['SLM Graph Worker'],
    assertions: [{ relation: 'performs', confidence: 0.9, uncertainty: 0.1 }],
    sourceRefs: ['live-probe'],
    confidence: 0.85,
    uncertainty: 0.15,
  });

  it('normalizes the live gemma3-qat field variants into canonical shape', () => {
    const res = parseSlmGraphExtraction(LIVE_GEMMA_SHAPE);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const { entities, relations, sourceRefs, uncertainty } = res.result;
    expect(entities[0].label).toBe('Local Gemma'); // name -> label
    expect(entities[0].type).toBe('Model'); // class -> type
    expect(entities[0].label).not.toBeUndefined();
    expect(entities[0].type).not.toBeUndefined();
    expect(relations[0].from).toBe('e1'); // source -> from
    expect(relations[0].to).toBe('thinkgraph'); // target -> to
    expect(relations[0].type).toBe('performs'); // relation -> type
    expect(relations[0].from).not.toBeUndefined();
    expect(relations[0].to).not.toBeUndefined();
    expect(relations[0].type).not.toBeUndefined();
    expect(sourceRefs[0]).toEqual({ ref: 'live-probe' }); // string -> { ref }
    expect(Array.isArray(uncertainty)).toBe(true); // numeric -> notes array (no crash)
    expect(uncertainty).toEqual(['0.15']);
  });

  it('fails closed when content normalizes to no usable entity/relation', () => {
    // entities/relations present but each lacks required meaning (no label / no from-to-type).
    const bad = JSON.stringify({ entities: [{ confidence: 0.5 }], relations: [{ confidence: 0.5 }] });
    expect(parseSlmGraphExtraction(bad).ok).toBe(false);
  });

  it('fails closed on non-JSON', () => {
    expect(parseSlmGraphExtraction('not json at all').ok).toBe(false);
  });

  it('fails closed when required arrays are missing', () => {
    expect(parseSlmGraphExtraction('{"relations":[]}').ok).toBe(false); // no entities
    expect(parseSlmGraphExtraction('{"entities":{}}').ok).toBe(false); // entities not an array
  });

  it('runSlmGraphTask fails closed when the model returns garbage', async () => {
    const run = await runSlmGraphTask(
      {
        targetGraph: 'knowgraph',
        inputKind: 'search_result_chunk',
        sourceRef: '',
        text: 'x',
        ontologySlice: {},
        allowedClasses: [],
        allowedRelations: [],
        nearbyEntities: [],
        nearbyRelations: [],
      },
      { call: async () => 'definitely not json' },
    );
    expect(run.ok).toBe(false);
  });

  it('prompt is JSON-only and scoped to the ontology slice', () => {
    const { system, user } = buildSlmGraphPrompt({
      targetGraph: 'knowgraph',
      inputKind: 'search_result_chunk',
      sourceRef: 'doc-1',
      text: 'Bob works for Acme',
      ontologySlice: { classes: ['liq:Org', 'liq:Person'] },
      allowedClasses: ['liq:Org', 'liq:Person'],
      allowedRelations: ['works_for'],
    });
    expect(system).toMatch(/JSON ONLY/);
    expect(user).toContain('liq:Org');
    expect(user).toContain('works_for');
    expect(user).toContain('search_result_chunk');
  });
});

describe('deterministic graph -> search params', () => {
  const graph = {
    entities: [
      { id: 'a', label: 'Acme', type: 'org' },
      { id: 'b', label: 'Bob', type: 'person' },
    ],
    relations: [{ from: 'b', to: 'a', type: 'works_for' }],
    nextSearchSeedCandidates: ['funding'],
  };

  it('compiles seeds, query, and bounded depth/maxSources deterministically', () => {
    const p1 = compileSearchParams(graph);
    const p2 = compileSearchParams(graph);
    expect(p1).toEqual(p2); // pure / deterministic
    expect(p1.seedEntities).toEqual(['Acme', 'Bob']);
    expect(p1.seedRelations).toEqual(['works_for']);
    expect(p1.query).toContain('Acme');
    expect(p1.query).toContain('funding');
    expect(p1.depth).toBeGreaterThanOrEqual(1);
    expect(p1.maxSources).toBeGreaterThan(0);
    expect(p1.stopCondition).toBeTruthy();
  });
});

describe('stored ThinkGraph record -> deterministic search params', () => {
  // Shape as read back from thinkgraph_liq via readThinkGraphSemanticRecord.
  const stored = {
    projectId: 'slm-roundtrip-test',
    sourceRef: 'thinkgraph-live-roundtrip-test',
    entities: [
      { id: 'e1', label: 'Local Gemma', type: 'Model', confidence: 0.95 },
      { id: 'e2', label: 'OWL extraction', type: 'Task', confidence: 0.9 },
    ],
    relations: [{ from: 'e1', to: 'e2', type: 'performs', confidence: 0.9 }],
    categories: ['local_model_worker'],
    confidence: 0.85,
    uncertainty: ['0.15'],
  };

  it('produces deterministic search params with the expected seeds and query', () => {
    const a = storedThinkGraphRecordToSearchParams(stored);
    const b = storedThinkGraphRecordToSearchParams(stored);
    expect(a).toEqual(b); // pure / deterministic

    expect(a.ok).toBe(true);
    // entity labels -> seed entities
    expect(a.searchParams.seedEntities).toEqual(['Local Gemma', 'OWL extraction']);
    // relation types -> seed relations
    expect(a.searchParams.seedRelations).toEqual(['performs']);
    // search intent around "Local Gemma OWL extraction" + relation seed "performs"
    expect(a.searchParams.query).toContain('Local Gemma');
    expect(a.searchParams.query).toContain('OWL extraction');
    expect(a.searchParams.query).toContain('performs');
    // categories influence the query deterministically
    expect(a.searchParams.query).toContain('local_model_worker');
    expect(a.categories).toContain('local_model_worker');
    // sourceRef preserved
    expect(a.sourceRef).toBe('thinkgraph-live-roundtrip-test');
    expect(a.projectId).toBe('slm-roundtrip-test');
  });

  it('honors compile options (sourceType targetGraph)', () => {
    const a = storedThinkGraphRecordToSearchParams(stored, { sourceType: 'knowgraph', freshness: 'P7D' });
    expect(a.searchParams.sourceType).toBe('knowgraph');
    expect(a.searchParams.freshness).toBe('P7D');
  });

  it('returns honest empty (ok:false) for a record with no entities/relations', () => {
    const empty = { projectId: 'p', sourceRef: 's', entities: [], relations: [], categories: [], confidence: null, uncertainty: [] };
    const a = storedThinkGraphRecordToSearchParams(empty);
    expect(a.ok).toBe(false);
    expect(a.searchParams.seedEntities).toEqual([]);
    expect(a.searchParams.query).toBe('');
  });
});
