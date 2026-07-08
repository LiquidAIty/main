// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import {
  readCachedGraphPayload,
  writeCachedGraphPayload,
  type CachedGraphPayload,
} from './requestGuards';

// Mirrors the real project-scoped cache key the KnowGraph tab builds:
//   `${KG_CACHE_PREFIX}:${projectId}:${typeFilter}:${recencyFilter}:${minConfidence}`
// The project id is part of the key, so a read for project A can never surface project B's
// cached graph (that is the mechanism that stops a stale cross-project hairball rendering).
const KG_CACHE_PREFIX = 'agentbuilder:kg-cache:v1';
const keyFor = (projectId: string) => `${KG_CACHE_PREFIX}:${projectId}:all:all:0`;

// Live CachedGraphPayload shape: {updatedAt, cypher, graphResult} — the old
// knowGraphData field went with the purged KnowGraph viz; project-distinct
// content now rides in graphResult.
const payloadFor = (projectId: string): CachedGraphPayload => ({
  updatedAt: Date.now(),
  cypher: `MATCH (n) WHERE n.projectId = '${projectId}' RETURN n`,
  graphResult: [{ id: `${projectId}-node`, label: projectId, type: 'Issuer' }],
});

afterEach(() => {
  window.localStorage.clear();
});

describe('KnowGraph cache is project-scoped (stale cross-project graph never renders)', () => {
  const PROJECT_A = '20ac92da-01fd-4cf6-97cc-0672421e751a';
  const PROJECT_B = 'ffffffff-1111-2222-3333-444444444444';

  it('reading project A never returns project B cached graph', () => {
    writeCachedGraphPayload(keyFor(PROJECT_B), payloadFor(PROJECT_B));
    // No cache was written for A → A must read null, NOT B's stale graph.
    expect(readCachedGraphPayload(keyFor(PROJECT_A))).toBeNull();
  });

  it('a cache fallback restores the SAME project payload (projectId is never swapped)', () => {
    writeCachedGraphPayload(keyFor(PROJECT_A), payloadFor(PROJECT_A));
    writeCachedGraphPayload(keyFor(PROJECT_B), payloadFor(PROJECT_B));
    const back = readCachedGraphPayload(keyFor(PROJECT_A));
    expect(back?.graphResult).toHaveLength(1);
    expect((back?.graphResult[0] as { id: string }).id).toBe(`${PROJECT_A}-node`);
    expect(back?.cypher).toContain(PROJECT_A);
  });
});
