import { describe, expect, it } from 'vitest';

import {
  attachGraphViewsToRuntime,
  completeGraphViews,
  parseGraphViewIdentities,
} from './graphView';

const candidate = {
  schemaVersion: 'graph-view.v1',
  viewId: 'graphview:one',
  authority: 'agentgraph',
  status: 'candidate',
  projectId: 'project-1',
  conversationId: 'conversation-1',
  correlationId: 'run:one',
  displayLabel: 'Selected implementation references',
  producingRole: 'main_chat',
  receivingRole: 'coder',
  references: [{
    referenceId: 'symbol:one',
    referenceType: 'codegraph',
    required: true,
  }],
  createdAt: '2026-07-15T00:00:00.000Z',
  updatedAt: '2026-07-15T00:00:00.000Z',
};

describe('AgentGraph reference-view contract', () => {
  it('accepts stable references and rejects copied graph payloads by omission', () => {
    const [parsed] = parseGraphViewIdentities(
      [candidate],
      { projectId: 'project-1', conversationId: 'conversation-1' },
    );
    expect(parsed).toMatchObject({
      authority: 'agentgraph',
      referenceCount: 1,
      references: candidate.references,
    });
    expect(parsed).not.toHaveProperty('records');
    expect(parsed).not.toHaveProperty('includedRelationships');
  });

  it('stamps lifecycle without creating a second payload contract', () => {
    const parsed = parseGraphViewIdentities(
      [candidate],
      { projectId: 'project-1', conversationId: 'conversation-1' },
    );
    const [active] = attachGraphViewsToRuntime(parsed, {
      provider: 'openai',
      model: 'gpt-5.3',
      role: 'main_chat',
      invocationId: 'req-1',
      attachedAt: '2026-07-15T01:00:00.000Z',
    });
    expect(active).toMatchObject({
      viewId: 'graphview:one',
      status: 'active',
      correlationId: 'req-1',
    });
    expect(active.runtime).toMatchObject({
      invocationId: 'req-1',
      includedReferences: 1,
    });
    expect(completeGraphViews([active])[0]).toMatchObject({
      viewId: active.viewId,
      status: 'consumed',
    });
  });

  it('rejects unknown reference types and scope mismatches', () => {
    expect(() => parseGraphViewIdentities([{
      ...candidate,
      references: [{ referenceId: 'one', referenceType: 'invented' }],
    }], { projectId: 'project-1', conversationId: 'conversation-1' }))
      .toThrow('reference_0_invalid');
    expect(() => parseGraphViewIdentities([{
      ...candidate,
      projectId: 'other',
    }], { projectId: 'project-1', conversationId: 'conversation-1' }))
      .toThrow('graph_view_scope_mismatch');
  });
});
