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

  it('accepts an optional free-form resource kind — no enum, only compact-shape checks', () => {
    expect(validateThinkGraphPatch(AUTHORITY, { resources: [{ id: 'x', label: 'X', kind: 'question' }] })).toBeNull();
    expect(validateThinkGraphPatch(AUTHORITY, { resources: [{ id: 'x', label: 'X', kind: 'literally_anything' }] })).toBeNull();
    expect(validateThinkGraphPatch(AUTHORITY, { resources: [{ id: 'x', label: 'X', kind: ' ' }] })).toContain('patch_resource_kind_empty');
    expect(
      validateThinkGraphPatch(AUTHORITY, { resources: [{ id: 'x', label: 'X', kind: 'line one\nline two' }] }),
    ).toContain('patch_resource_kind_not_compact');
  });

  it('accepts an optional free-form statement tag — no enum, only compact-shape checks', () => {
    const base = { id: 'st1', subject: 'a', predicateTerm: 'p', object: 'b' };
    expect(validateThinkGraphPatch(AUTHORITY, { statements: [{ ...base, tag: 'affects' }] })).toBeNull();
    expect(validateThinkGraphPatch(AUTHORITY, { statements: [{ ...base, tag: 'literally_anything' }] })).toBeNull();
    expect(validateThinkGraphPatch(AUTHORITY, { statements: [{ ...base, tag: ' ' }] })).toContain('patch_statement_tag_empty');
  });

  it('rejects source-claiming review status without persisted source provenance (chat language is never enough)', () => {
    for (const claim of ['source_linked', 'supported', 'evidenced', 'verified']) {
      expect(
        validateThinkGraphPatch(AUTHORITY, {
          statements: [{ id: 'st1', subject: 'a', predicateTerm: 'p', object: 'b', review: claim }],
        }),
      ).toContain('patch_statement_review_requires_persisted_source_provenance');
    }
    // Ordinary working-context statuses are free-form and accepted as-is —
    // not a forced ontology.
    for (const ordinary of ['working', 'unverified', 'provisional', 'anything_else']) {
      expect(
        validateThinkGraphPatch(AUTHORITY, {
          statements: [{ id: 'st1', subject: 'a', predicateTerm: 'p', object: 'b', review: ordinary }],
        }),
      ).toBeNull();
    }
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
    // A statement is a DIRECT relationship (subject -> object), never its own node.
    expect(view.nodes.find((n) => n.id === 'st:test:1')).toBeUndefined();
    const statementEdge = view.edges.find((e) => e.id === 'st:test:1');
    expect(statementEdge).toBeDefined();
    expect(statementEdge!.source).toBe('think:test:alpha');
    expect(statementEdge!.target).toBe('think:test:beta');
    expect(statementEdge!.predicate).toBe('term:relates_to');
    const co = view.edges.find((e) => e.predicate === 'co_occurred_with');
    expect(co).toBeDefined();
    expect(co!.weight).toBe(1);
  });

  it('duplicate correlation key does not duplicate graph records', async () => {
    const again = await applyThinkGraphPatch(AUTHORITY, PATCH);
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.status).toBe('duplicate');
    const view = await getThinkGraphView({ projectId: PROJECT });
    // Same counts as the first application: 2 resources, 1 statement edge, 1 co-occurrence edge.
    expect(view.nodes.filter((n) => n.kind === 'resource')).toHaveLength(2);
    expect(view.edges.filter((e) => e.id === 'st:test:1')).toHaveLength(1);
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

describe('direct ordinary graph maintenance — RDW/ASTS-shaped conversation', () => {
  // Mirrors the intended live behavior for "give me some ideas for options
  // calls or puts on RDW and ASTS": one question item, two entities, a few
  // ordinary working-context items, and direct relationships among them.
  // No frame, no lifecycle record, no active-focus wrapper — just resources
  // and statements through the one real patch path.
  const OPTIONS_PATCH = {
    resources: [
      { id: 'think:test:q_rdw_asts_options', label: 'What option approaches fit RDW and ASTS?', kind: 'question' },
      { id: 'think:test:rdw2', label: 'RDW', kind: 'entity' },
      { id: 'think:test:asts2', label: 'ASTS', kind: 'entity' },
      { id: 'think:test:iv_risk', label: 'Implied-volatility risk', kind: 'risk' },
      { id: 'think:test:defined_risk_spreads', label: 'Defined-risk spreads may fit volatile names better than naked options', kind: 'idea' },
    ],
    statements: [
      { id: 'think:test:st_q_rdw', subject: 'think:test:q_rdw_asts_options', predicateTerm: 'investigates', object: 'think:test:rdw2', tag: 'investigates' },
      { id: 'think:test:st_q_asts', subject: 'think:test:q_rdw_asts_options', predicateTerm: 'investigates', object: 'think:test:asts2', tag: 'investigates' },
      { id: 'think:test:st_iv_affects', subject: 'think:test:iv_risk', predicateTerm: 'affects', object: 'think:test:q_rdw_asts_options', tag: 'affects' },
    ],
  };

  it('persists a compact question + entities + working items with direct relationships, no lifecycle records', async () => {
    const applied = await applyThinkGraphPatch(
      { ...AUTHORITY, correlationId: `tg:test-options-${Date.now()}` },
      OPTIONS_PATCH,
    );
    expect(applied.ok).toBe(true);
    if (applied.ok) {
      expect(applied.storedResourceIds).toHaveLength(5);
      expect(applied.storedStatementIds).toHaveLength(3);
    }

    const view = await getThinkGraphView({ projectId: PROJECT });
    const question = view.nodes.find((n) => n.id === 'think:test:q_rdw_asts_options');
    expect(question!.itemKind).toBe('question');
    const rdw = view.nodes.find((n) => n.id === 'think:test:rdw2');
    expect(rdw!.itemKind).toBe('entity');

    const investigatesRdw = view.edges.find((e) => e.id === 'think:test:st_q_rdw');
    expect(investigatesRdw!.source).toBe('think:test:q_rdw_asts_options');
    expect(investigatesRdw!.target).toBe('think:test:rdw2');
    expect(investigatesRdw!.predicate).toBe('investigates');

    const affects = view.edges.find((e) => e.id === 'think:test:st_iv_affects');
    expect(affects!.source).toBe('think:test:iv_risk');
    expect(affects!.target).toBe('think:test:q_rdw_asts_options');

    // No frame/lifecycle vocabulary exists anywhere in the returned view shape.
    expect(view).not.toHaveProperty('frames');
    expect(view).not.toHaveProperty('considerations');
    expect(view).not.toHaveProperty('activeFrame');
  });
});

describe('mention counting is provenance-gated + properties persist and accumulate', () => {
  const RESOURCE_ID = 'think:test:mention_asts';
  const STATEMENT_ID = 'think:test:mention_st';
  const FIRST_CORR = `tg:test-mention-1-${Date.now()}`;
  const SECOND_CORR = `tg:test-mention-2-${Date.now()}`;

  it('a new provenance source increments resource mention_count exactly once', async () => {
    const first = await applyThinkGraphPatch(
      { ...AUTHORITY, correlationId: FIRST_CORR },
      { resources: [{ id: RESOURCE_ID, label: 'ASTS', properties: { ticker: 'ASTS' } }] },
    );
    expect(first.ok).toBe(true);
    let view = await getThinkGraphView({ projectId: PROJECT });
    let node = view.nodes.find((x) => x.id === RESOURCE_ID);
    expect(node!.mentionCount).toBe(1);
    expect(node!.provenanceCount).toBe(1);
    expect(node!.properties).toEqual({ ticker: 'ASTS' });

    // A genuinely new source turn (different correlationId) re-mentions the
    // SAME resource id and adds a NEW property key — count increments once,
    // properties shallow-merge (ticker survives, volatility is added).
    const second = await applyThinkGraphPatch(
      { ...AUTHORITY, correlationId: SECOND_CORR },
      { resources: [{ id: RESOURCE_ID, label: 'ASTS', properties: { volatility: 'high' } }] },
    );
    expect(second.ok).toBe(true);
    view = await getThinkGraphView({ projectId: PROJECT });
    node = view.nodes.find((x) => x.id === RESOURCE_ID);
    expect(node!.mentionCount).toBe(2);
    expect(node!.provenanceCount).toBe(2);
    expect(node!.properties).toEqual({ ticker: 'ASTS', volatility: 'high' }); // accumulated, not overwritten
    expect(node!.lastMentionedAt).toBeTruthy();

    // Only ONE Resource node exists for this id — repeated mentions reuse it,
    // they never create duplicate bubbles.
    expect(view.nodes.filter((x) => x.id === RESOURCE_ID)).toHaveLength(1);
  });

  it('replaying the same provenance source (correlationId) does not increment resource mention_count', async () => {
    // Same correlationId as the "second" mention above, same body: the whole
    // patch is blocked as a duplicate before any resource write runs.
    const replay = await applyThinkGraphPatch(
      { ...AUTHORITY, correlationId: SECOND_CORR },
      { resources: [{ id: RESOURCE_ID, label: 'ASTS', properties: { volatility: 'high' } }] },
    );
    expect(replay.ok).toBe(true);
    if (replay.ok) expect(replay.status).toBe('duplicate');
    const view = await getThinkGraphView({ projectId: PROJECT });
    const node = view.nodes.find((x) => x.id === RESOURCE_ID);
    expect(node!.mentionCount).toBe(2); // unchanged by the replay
  });

  it('a new provenance source increments statement mention_count exactly once, reusing the same edge', async () => {
    const first = await applyThinkGraphPatch(
      { ...AUTHORITY, correlationId: `tg:test-st-mention-1-${Date.now()}` },
      {
        resources: [
          { id: 'think:test:mention_spacex', label: 'SpaceX launch services' },
        ],
        statements: [
          {
            id: STATEMENT_ID,
            subject: RESOURCE_ID,
            predicateTerm: 'may depend on',
            object: 'think:test:mention_spacex',
            properties: { source: 'working project reasoning' },
          },
        ],
      },
    );
    expect(first.ok).toBe(true);
    let view = await getThinkGraphView({ projectId: PROJECT });
    let edge = view.edges.find((e) => e.id === STATEMENT_ID);
    expect(edge!.mentionCount).toBe(1);
    expect(edge!.provenanceCount).toBe(1);
    expect(edge!.properties).toEqual({ source: 'working project reasoning' });

    const secondCorr = `tg:test-st-mention-2-${Date.now()}`;
    const second = await applyThinkGraphPatch(
      { ...AUTHORITY, correlationId: secondCorr },
      {
        statements: [
          { id: STATEMENT_ID, subject: RESOURCE_ID, predicateTerm: 'may depend on', object: 'think:test:mention_spacex' },
        ],
      },
    );
    expect(second.ok).toBe(true);
    view = await getThinkGraphView({ projectId: PROJECT });
    edge = view.edges.find((e) => e.id === STATEMENT_ID);
    expect(edge!.mentionCount).toBe(2); // one real new mention
    expect(edge!.properties).toEqual({ source: 'working project reasoning' }); // preserved, not wiped
    expect(view.edges.filter((e) => e.id === STATEMENT_ID)).toHaveLength(1); // reused, not duplicated

    // Replaying the SAME correlationId again does not increment further.
    const replay = await applyThinkGraphPatch(
      { ...AUTHORITY, correlationId: secondCorr },
      {
        statements: [
          { id: STATEMENT_ID, subject: RESOURCE_ID, predicateTerm: 'may depend on', object: 'think:test:mention_spacex' },
        ],
      },
    );
    expect(replay.ok).toBe(true);
    if (replay.ok) expect(replay.status).toBe('duplicate');
    view = await getThinkGraphView({ projectId: PROJECT });
    edge = view.edges.find((e) => e.id === STATEMENT_ID);
    expect(edge!.mentionCount).toBe(2); // unchanged by the replay
  });
});

describe('triple closure (storage invariant): every statement is an entity-to-entity edge', () => {
  it('rejects the whole patch when a statement object does not resolve to any resource', async () => {
    const subjectId = 'think:test:closure_subject';
    const corr = `tg:test-closure-reject-${Date.now()}`;
    const result = await applyThinkGraphPatch(
      { ...AUTHORITY, correlationId: corr },
      {
        resources: [{ id: subjectId, label: 'Closure Subject' }],
        statements: [
          { id: 'think:test:st_closure', subject: subjectId, predicateTerm: 'relates_to', object: 'think:test:never_declared' },
        ],
      },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('patch_statement_object_unresolved');

    // Rolled back entirely — even the subject resource that would have been
    // valid alone never persists when the rest of the patch is rejected.
    const view = await getThinkGraphView({ projectId: PROJECT });
    expect(view.nodes.find((n) => n.id === subjectId)).toBeUndefined();
  });
});

describe('endpoint mention counting: a resource referenced only as a statement subject/object still advances', () => {
  const A = 'think:test:endpoint_a';
  const B = 'think:test:endpoint_b';

  it('counts an entity mention for statement endpoints even when never redeclared in resources[]', async () => {
    const seedCorr = `tg:test-endpoint-seed-${Date.now()}`;
    const seed = await applyThinkGraphPatch(
      { ...AUTHORITY, correlationId: seedCorr },
      { resources: [{ id: A, label: 'Endpoint A' }, { id: B, label: 'Endpoint B' }] },
    );
    expect(seed.ok).toBe(true);
    let view = await getThinkGraphView({ projectId: PROJECT });
    expect(view.nodes.find((n) => n.id === A)!.mentionCount).toBe(1);
    expect(view.nodes.find((n) => n.id === B)!.mentionCount).toBe(1);

    // A later, distinct source turn references BOTH only as statement
    // endpoints — never redeclared via resources[] — and both still advance
    // exactly once, per the SPEC's endpoint-mention rule.
    const touchCorr = `tg:test-endpoint-touch-${Date.now()}`;
    const touched = await applyThinkGraphPatch(
      { ...AUTHORITY, correlationId: touchCorr },
      { statements: [{ id: 'think:test:st_endpoint', subject: A, predicateTerm: 'relates_to', object: B }] },
    );
    expect(touched.ok).toBe(true);
    view = await getThinkGraphView({ projectId: PROJECT });
    expect(view.nodes.find((n) => n.id === A)!.mentionCount).toBe(2);
    expect(view.nodes.find((n) => n.id === B)!.mentionCount).toBe(2);

    // Replaying the SAME correlationId again does not inflate the endpoint bump.
    const replay = await applyThinkGraphPatch(
      { ...AUTHORITY, correlationId: touchCorr },
      { statements: [{ id: 'think:test:st_endpoint', subject: A, predicateTerm: 'relates_to', object: B }] },
    );
    expect(replay.ok).toBe(true);
    if (replay.ok) expect(replay.status).toBe('duplicate');
    view = await getThinkGraphView({ projectId: PROJECT });
    expect(view.nodes.find((n) => n.id === A)!.mentionCount).toBe(2);
    expect(view.nodes.find((n) => n.id === B)!.mentionCount).toBe(2);
  });
});

describe('no code classification from label text', () => {
  it('labels containing "unknown"/"confirmed"/"evidence"/"gap" persist verbatim, stored kind untouched', async () => {
    const applied = await applyThinkGraphPatch(
      { ...AUTHORITY, correlationId: `tg:test-noclassify-${Date.now()}` },
      { resources: [{ id: 'think:test:wordy', label: 'EvidenceGaps_Unknown_Confirmed_gap' }] },
    );
    expect(applied.ok).toBe(true);
    const view = await getThinkGraphView({ projectId: PROJECT });
    const node = view.nodes.find((n) => n.id === 'think:test:wordy');
    expect(node!.label).toBe('EvidenceGaps_Unknown_Confirmed_gap'); // stored exactly as authored
    expect(node!.kind).toBe('resource'); // storage mechanics, not a derived semantic class
    expect(node!.itemKind).toBeUndefined(); // no kind was supplied — none invented
  });
});
