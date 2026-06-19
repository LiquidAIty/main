import { describe, expect, it } from 'vitest';

import {
  buildSlmGraphPrompt,
  parseSlmGraphOutput,
  runSlmGraphTask,
} from './slmGraphWorker';
import { compileSearchParams } from './graphToSearchParams';

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
    const res = parseSlmGraphOutput(slmJson([{ id: 'a', label: 'Acme', type: 'org' }]));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.result.entities).toHaveLength(1);
      expect(res.result.categories).toContain('Thing');
    }
  });

  it('fails closed on non-JSON', () => {
    expect(parseSlmGraphOutput('not json at all').ok).toBe(false);
  });

  it('fails closed when required arrays are missing', () => {
    expect(parseSlmGraphOutput('{"relations":[]}').ok).toBe(false); // no entities
    expect(parseSlmGraphOutput('{"entities":{}}').ok).toBe(false); // entities not an array
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
