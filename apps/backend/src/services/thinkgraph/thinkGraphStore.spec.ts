// REAL-DB integration coverage for the ONE ThinkGraph writer (SPEC: do not mock
// away the AGE transaction, idempotency, or the graph read projection).
// Uses a disposable test project id and cleans up its own records afterward.
// Plumbing test data only — clearly labeled, never a product seed.
import { afterAll, describe, expect, it } from 'vitest';

import {
  applyThinkGraphPatch,
  getThinkGraphView,
  validateThinkGraphPatch,
  type ThinkGraphPatchAuthority,
} from './thinkGraphStore';
import { runCypherOnGraph } from '../graphService';

// Unique per test process: the vitest workspace runs this file under two projects
// concurrently, so a Date.now()-only id can collide across them.
const PROJECT = `tg-spec-test-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const AUTHORITY: ThinkGraphPatchAuthority = {
  projectId: PROJECT,
  cardId: 'card_thinkgraph_agent',
  correlationId: `tg:test-corr-${Date.now()}`,
  conversationId: 'main',
  userMessageId: 'msg_test_user',
  assistantMessageId: 'msg_test_assistant',
};

const PATCH = {
  resources: [
    { id: 'think:test:alpha', label: 'Alpha Concept' },
    { id: 'think:test:beta', label: 'Beta Concept' },
  ],
  relations: [{ a: 'think:test:alpha', b: 'think:test:beta' }],
  statements: [
    {
      id: 'st:test:1',
      subject: 'think:test:alpha',
      predicateTerm: 'term:relates_to',
      object: 'think:test:beta',
      rationale: 'test statement',
      review: 'provisional',
    },
  ],
};

afterAll(async () => {
  // Remove ONLY this test project's records (never a whole-graph operation).
  for (const label of ['Resource', 'Statement', 'ThinkDeltaApplied']) {
    await runCypherOnGraph(
      'thinkgraph_liq',
      `MATCH (n:${label} {project_id: $projectId}) DETACH DELETE n`,
      { projectId: PROJECT },
    ).catch(() => undefined);
  }
});

describe('validateThinkGraphPatch — structural/ownership only', () => {
  it('rejects incomplete authority (provenance is mandatory)', () => {
    expect(validateThinkGraphPatch({ ...AUTHORITY, userMessageId: '' }, PATCH)).toContain('patch_authority_userMessageId_missing');
  });
  it('rejects self-pair relations and unlabeled resources', () => {
    expect(validateThinkGraphPatch(AUTHORITY, { relations: [{ a: 'x', b: 'x' }] })).toContain('self_pair');
    expect(validateThinkGraphPatch(AUTHORITY, { resources: [{ id: 'x', label: ' ' }] })).toContain('label_required');
  });
  it('rejects oversized patches (bounded payload safety)', () => {
    const many = Array.from({ length: 41 }, (_, i) => ({ id: `r${i}`, label: `L${i}` }));
    expect(validateThinkGraphPatch(AUTHORITY, { resources: many })).toBe('patch_too_many_resources');
  });
});

describe('applyThinkGraphPatch — one real AGE transaction + idempotency + projection', () => {
  it('empty patch = zero mutation', async () => {
    const result = await applyThinkGraphPatch(AUTHORITY, {});
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.status).toBe('empty');
    const view = await getThinkGraphView({ projectId: PROJECT });
    expect(view.nodes).toHaveLength(0);
  });

  it('valid patch persists exactly once with full pair/card/run provenance', async () => {
    const applied = await applyThinkGraphPatch(AUTHORITY, PATCH);
    expect(applied.ok).toBe(true);
    if (applied.ok) {
      expect(applied.status).toBe('applied');
      expect(applied.storedResourceIds).toEqual(['think:test:alpha', 'think:test:beta']);
      expect(applied.storedStatementIds).toEqual(['st:test:1']);
      expect(applied.relationCount).toBe(1);
    }

    // Projection exposes the REAL stored records + direct provenance.
    const view = await getThinkGraphView({ projectId: PROJECT });
    const alpha = view.nodes.find((n) => n.id === 'think:test:alpha');
    expect(alpha).toBeDefined();
    expect(alpha!.userMessageId).toBe('msg_test_user');
    expect(alpha!.assistantMessageId).toBe('msg_test_assistant');
    expect(alpha!.cardId).toBe('card_thinkgraph_agent');
    expect(alpha!.correlationId).toBe(AUTHORITY.correlationId);
    expect(alpha!.conversationId).toBe('main');
    const statement = view.nodes.find((n) => n.id === 'st:test:1');
    expect(statement).toBeDefined();
    expect(statement!.kind).toBe('statement');
    expect(statement!.review).toBe('provisional');
    const co = view.edges.find((e) => e.predicate === 'co_occurred_with');
    expect(co).toBeDefined();
    expect(co!.weight).toBe(1);
  });

  it('duplicate correlation key does not duplicate graph records', async () => {
    const again = await applyThinkGraphPatch(AUTHORITY, PATCH);
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.status).toBe('duplicate');
    const view = await getThinkGraphView({ projectId: PROJECT });
    // Same counts as the first application: 2 resources + 1 statement node.
    expect(view.nodes.filter((n) => n.kind === 'resource')).toHaveLength(2);
    expect(view.nodes.filter((n) => n.kind === 'statement')).toHaveLength(1);
    const co = view.edges.find((e) => e.predicate === 'co_occurred_with');
    expect(co!.weight).toBe(1); // not incremented by the duplicate
  });

  it('cross-project reads stay isolated (out-of-project records invisible)', async () => {
    const other = await getThinkGraphView({ projectId: `${PROJECT}-other` });
    expect(other.nodes).toHaveLength(0);
    expect(other.edges).toHaveLength(0);
  });

  it('malformed patch fails honestly with zero mutation', async () => {
    const bad = await applyThinkGraphPatch(
      { ...AUTHORITY, correlationId: `tg:test-bad-${Date.now()}` },
      { statements: [{ id: 'st:x', subject: '', predicateTerm: 'p', object: 'o' }] },
    );
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toContain('patch_statement_endpoints_required');
  });
});
