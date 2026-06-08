import { describe, expect, it } from 'vitest';

import { buildProjectSelfSeed, toSeedTriples } from './projectSelfSeed';

describe('project self-seed', () => {
  it('builds a typed first-pass seed payload', () => {
    const seed = buildProjectSelfSeed('proj_123', new Date('2026-04-18T00:00:00.000Z'));

    expect(seed.schemaVersion).toBe('project_knowledge_seed/v1');
    expect(seed.projectId).toBe('proj_123');
    expect(seed.entities.length).toBeGreaterThan(8);
    expect(seed.relationships.length).toBeGreaterThan(8);
    expect(seed.truths.length).toBeGreaterThan(2);
    expect(seed.patterns.map((p) => p.name)).toContain('Goal -> Tasks -> Output');
  });

  it('derives relationship triples for future ingestion adapters', () => {
    const seed = buildProjectSelfSeed('proj_abc', new Date('2026-04-18T00:00:00.000Z'));
    const triples = toSeedTriples(seed);

    expect(triples.length).toBe(seed.relationships.length);
    expect(triples[0]).toMatchObject({
      source: expect.any(String),
      relationship: expect.any(String),
      target: expect.any(String),
    });
  });
});
