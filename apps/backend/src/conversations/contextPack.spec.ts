import { describe, it, expect } from 'vitest';
import { buildContextPack } from './contextPack';
import { lineageOf, type ConversationMessage } from './store';

function m(
  messageId: string,
  role: ConversationMessage['role'],
  content: string,
  seq: number,
  parentMessageId: string | null,
): ConversationMessage {
  return {
    messageId,
    projectId: 'p',
    conversationId: 'c',
    parentMessageId,
    role,
    content,
    status: 'complete',
    createdAt: new Date(2026, 0, 1, 0, 0, seq).toISOString(),
    seq,
    linkedArtifactIds: [],
    linkedEvidenceIds: [],
  };
}

// A single active branch of 3 user/assistant pairs.
const messages: ConversationMessage[] = [
  m('m1', 'user', 'OLD original request about something retired', 1, null),
  m('m2', 'assistant', 'OLD assistant answer that should retire', 2, 'm1'),
  m('m3', 'user', 'recent user one', 3, 'm2'),
  m('m4', 'assistant', 'recent assistant one', 4, 'm3'),
  m('m5', 'user', 'recent user two', 5, 'm4'),
  m('m6', 'assistant', 'recent assistant two', 6, 'm5'),
];

const planDraft = {
  id: 'plandraft_x',
  objective: 'Ship the thing',
  summary: 'A bounded plan',
  openQuestions: ['scope?'],
  steps: [{ id: 's1', shortTitle: 'Do A', detail: 'detail A', expectedOutcome: 'A done', dependencies: [] }],
};

describe('buildContextPack', () => {
  it('includes only the recent active tail (retired old transcript excluded) + plan context', async () => {
    const pack = await buildContextPack({
      projectId: 'p',
      conversationId: 'c',
      messages,
      activeLeafMessageId: 'm6',
      runtimeFresh: true,
      planDraft,
      maxPairs: 2,
    });
    const tailRefs = pack.items.filter((i) => i.source === 'active_tail').map((i) => i.ref);
    // last 2 pairs = m3..m6 included; m1/m2 retired & excluded.
    expect(tailRefs).toEqual(['m3', 'm4', 'm5', 'm6']);
    expect(tailRefs).not.toContain('m1');
    expect(tailRefs).not.toContain('m2');
    expect(pack.excluded.retiredMessageCount).toBeGreaterThanOrEqual(2);
    // plan root + step present.
    expect(pack.items.some((i) => i.source === 'plan_root')).toBe(true);
  });

  it('does NOT blindly include the active tail when the runtime is live (not fresh) and not branching', async () => {
    const pack = await buildContextPack({
      projectId: 'p',
      conversationId: 'c',
      messages,
      activeLeafMessageId: 'm6',
      runtimeFresh: false,
      planDraft,
      maxPairs: 2,
    });
    expect(pack.items.some((i) => i.source === 'active_tail')).toBe(false);
    // plan context still flows.
    expect(pack.items.some((i) => i.source === 'plan_root')).toBe(true);
  });

  it('replying from an old message includes that anchor + its lineage', async () => {
    const pack = await buildContextPack({
      projectId: 'p',
      conversationId: 'c',
      messages,
      activeLeafMessageId: 'm6',
      anchorMessageId: 'm1',
      planDraft,
      maxPairs: 3,
    });
    const anchorRefs = pack.items.filter((i) => i.source === 'reply_anchor').map((i) => i.ref);
    expect(anchorRefs).toContain('m1');
    const anchorItem = pack.items.find((i) => i.source === 'reply_anchor' && i.ref === 'm1');
    expect(anchorItem?.reason).toBe('selected-anchor');
  });

  it('pulls ThinkGraph/KnowGraph context ONLY via injected retrievers (no auto transcript dump)', async () => {
    const noGraph = await buildContextPack({ projectId: 'p', conversationId: 'c', messages, runtimeFresh: true, planDraft, maxPairs: 1 });
    expect(noGraph.items.some((i) => i.source === 'thinkgraph' || i.source === 'knowgraph')).toBe(false);

    const withGraph = await buildContextPack({
      projectId: 'p',
      conversationId: 'c',
      messages,
      runtimeFresh: true,
      planDraft,
      maxPairs: 1,
      thinkGraphRetriever: async () => [{ ref: 'decision_1', text: 'Accepted decision: use X', reason: 'accepted-decision' }],
      knowGraphRetriever: async () => [{ ref: 'claim_1', text: 'Grounded claim: Y', reason: 'grounded-claim' }],
    });
    expect(withGraph.items.find((i) => i.source === 'thinkgraph')?.ref).toBe('decision_1');
    expect(withGraph.items.find((i) => i.source === 'knowgraph')?.ref).toBe('claim_1');
    // The raw old transcript was NOT turned into graph items.
    expect(withGraph.items.filter((i) => i.source === 'thinkgraph' || i.source === 'knowgraph').length).toBe(2);
  });
});

describe('lineageOf (branch traversal)', () => {
  it('returns root→leaf lineage following parentMessageId', () => {
    const byId: Record<string, ConversationMessage> = {};
    for (const x of messages) byId[x.messageId] = x;
    expect(lineageOf(byId, 'm6').map((x) => x.messageId)).toEqual(['m1', 'm2', 'm3', 'm4', 'm5', 'm6']);
    expect(lineageOf(byId, 'm2').map((x) => x.messageId)).toEqual(['m1', 'm2']);
  });
});
