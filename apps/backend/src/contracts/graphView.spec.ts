import { describe, expect, it } from 'vitest';

import {
  attachGraphViewsToRuntime,
  completeGraphViews,
  parseGraphViewIdentities,
  parseGraphViews,
} from './graphView';

const candidate = {
  schemaVersion: 'graph-view.v1',
  viewId: 'candidate-1',
  authority: 'codegraph',
  status: 'candidate',
  projectId: 'untrusted-project',
  conversationId: 'untrusted-conversation',
  producingRole: 'user',
  receivingRole: 'coder',
  rootCanonicalNodeIds: ['symbol:one'],
  includedCanonicalNodeIds: ['symbol:one'],
  includedRelationships: [],
  records: [{
    canonicalId: 'symbol:one',
    summary: 'symbol:one is the selected implementation seam.',
    selectionReason: 'User included this record',
    provenanceRefs: ['client/src/one.ts'],
  }],
  query: 'Resolve the selected implementation seam',
  filter: { nodeTypes: ['Function'], trustStates: [] },
  hopDepth: 1,
  provenanceRefs: ['client/src/one.ts'],
  omittedNeighborCount: 7,
  createdAt: '2026-07-15T00:00:00.000Z',
  updatedAt: '2026-07-15T00:00:00.000Z',
};

describe('Graph View contract', () => {
  it('mints trusted scope and preserves the exact candidate membership', () => {
    const [parsed] = parseGraphViews([candidate], { projectId: 'project-1', conversationId: 'conversation-1' }, 'candidate');
    expect(parsed).toMatchObject({ projectId: 'project-1', conversationId: 'conversation-1', status: 'candidate' });
    expect(parsed.includedCanonicalNodeIds).toEqual(['symbol:one']);
    expect(parsed.records[0].estimatedCharacters).toBe(parsed.records[0].summary.length);
  });

  it('derives an active runtime view and completes that same invocation view', () => {
    const parsed = parseGraphViews([candidate], { projectId: 'project-1', conversationId: 'conversation-1' }, 'candidate');
    const [active] = attachGraphViewsToRuntime(parsed, {
      provider: 'openai', model: 'gpt-5.3', role: 'main_chat', invocationId: 'req-1', attachedAt: '2026-07-15T01:00:00.000Z',
    });
    expect(active).toMatchObject({ viewId: 'candidate-1', status: 'active', invocationId: 'req-1' });
    expect(active.runtime).toMatchObject({ invocationId: 'req-1', includedRecords: 1, excludedRecords: 7 });
    expect(completeGraphViews([active])[0]).toMatchObject({ viewId: active.viewId, status: 'consumed' });
  });

  it('rejects records outside included canonical references', () => {
    expect(() => parseGraphViews([{ ...candidate, includedCanonicalNodeIds: [] }], {
      projectId: 'project-1', conversationId: 'conversation-1',
    })).toThrow('record_not_included');
  });

  it('parses identity/lifecycle transport without accepting membership content', () => {
    const [identity] = parseGraphViewIdentities([{
      schemaVersion: 'graph-view.v1',
      viewId: 'candidate-1',
      authority: 'codegraph',
      status: 'attached',
      projectId: 'project-1',
      conversationId: 'conversation-1',
      producingRole: 'main_chat',
      receivingRole: 'coder',
      recordCount: 6,
      relationshipCount: 4,
      omittedNeighborCount: 2,
      createdAt: '2026-07-15T00:00:00.000Z',
      updatedAt: '2026-07-15T00:00:00.000Z',
      records: [{ summary: 'must not cross this boundary' }],
    }], { projectId: 'project-1', conversationId: 'conversation-1' });
    expect(identity).toMatchObject({ viewId: 'candidate-1', recordCount: 6, relationshipCount: 4 });
    expect(identity).not.toHaveProperty('records');
    expect(() => parseGraphViewIdentities([{
      ...identity,
      projectId: 'other',
    }], { projectId: 'project-1', conversationId: 'conversation-1' })).toThrow('graph_view_scope_mismatch');
  });
});
