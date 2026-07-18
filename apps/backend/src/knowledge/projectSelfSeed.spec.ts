import { describe, expect, it } from 'vitest';

import { buildProjectSelfSeed, toSeedTriples } from './projectSelfSeed';

describe('project self-seed', () => {
  it('builds a typed first-pass seed payload', () => {
    const seed = buildProjectSelfSeed('proj_123', new Date('2026-04-18T00:00:00.000Z'));

    expect(seed.schemaVersion).toBe('project_knowledge_seed/v1');
    expect(seed.projectId).toBe('proj_123');
    expect(seed.entities.length).toBeGreaterThan(8);
    expect(seed.relationships.length).toBeGreaterThan(8);
    expect(seed.patterns.map((p) => p.name)).toContain('Goal -> Tasks -> Output');

    // Truths are a CURATED list: one is retired whenever the thing it asserts
    // stops being true (93bef07e correctly dropped
    // `truth.runtime.workspace_context_consumed` when that routing logic was
    // purged, taking the count 3 -> 2 and leaving this suite red). A magic
    // minimum count therefore fails on correct maintenance, so assert the shape
    // every truth must hold instead of how many happen to exist today.
    expect(seed.truths.length).toBeGreaterThan(0);
    for (const truth of seed.truths) {
      expect(truth.id).toMatch(/^truth\./);
      expect(truth.statement.trim().length).toBeGreaterThan(0);
      // scope/status/sourceRef are optional on SeedTruth but every curated
      // truth sets them — prove presence before .trim() so a future truth
      // that omits one fails loudly here instead of throwing on undefined.
      expect(truth.scope).toBeDefined();
      expect(truth.scope!.trim().length).toBeGreaterThan(0);
      expect(truth.status).toBeDefined();
      expect(truth.status!.trim().length).toBeGreaterThan(0);
      expect(truth.confidence).toBeGreaterThan(0);
      expect(truth.confidence).toBeLessThanOrEqual(1);
      expect(truth.sourceRef).toBeDefined();
      expect(truth.sourceRef!.trim().length).toBeGreaterThan(0);
    }
    // Ids are the join key for later ingestion — duplicates would silently merge.
    expect(new Set(seed.truths.map((t) => t.id)).size).toBe(seed.truths.length);
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
