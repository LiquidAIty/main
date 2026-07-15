// Round 3 stand-in Main Chat seed — writes a real user request + a stand-in Main
// reply into ADMIN's 'main' conversation (the exact store the chat panel reads via
// loadSessionHistory). No paid model call; the assistant turn is honestly labeled.
import '../config/env';
import { appendMessage, getConversationMessages } from '../conversations/store';

const ADMIN = '20ac92da-01fd-4cf6-97cc-0672421e751a';
const CONV = 'main';

async function main() {
  const before = (await getConversationMessages(ADMIN, CONV)).length;

  const user = await appendMessage({
    projectId: ADMIN,
    conversationId: CONV,
    role: 'user',
    content:
      'Merge the earlier ThinkGraph and KnowGraph seeding rounds into one visible ADMIN project, ' +
      'make sure everything actually saves as seed data I can see, and make the ThinkGraph node ' +
      'types visible so I can work on the visuals.',
  });

  await appendMessage({
    projectId: ADMIN,
    conversationId: CONV,
    role: 'assistant',
    parentMessageId: user.messageId,
    content:
      'Done — consolidated into this ADMIN project and made it visible:\n\n' +
      '• **ThinkGraph merge** — re-parented the scattered project `1b1a6958` (37 nodes / 38 edges across ' +
      '`kg-book-full`, `kg-viz-communication`, `kg-organizing-principle`) into ADMIN. ThinkGraph is now **67 nodes**; ' +
      'the source project drained to 0. IDs, kinds, conversation ids and original timestamps preserved; migration provenance added.\n' +
      '• **KnowGraph merge** — attached the two real research scopes to ADMIN alongside the canonical O’Reilly book scope ' +
      '(`kg-book-oreilly-full-0714`). Union is **530 nodes** (35 Concepts + 27 Claims trusted). No canonical records moved.\n' +
      '• **Typed nodes** — the ThinkGraph projection now surfaces each node’s stored `kind` as its `type`, so **65/67 nodes** ' +
      'render as Goal / Question / Decision / CodeFinding / Evidence etc.\n\n' +
      'Opening a Goal to track this consolidation so the reasoning, code references and Hermes memory all hang off one place.\n\n' +
      '_(stand-in seed — no paid model call; content is the real work performed this session.)_',
    visibleActivities: [
      { kind: 'thinkgraph', label: 'Merged project 1b1a6958 → ADMIN', status: 'complete', detail: '37 nodes / 38 edges, 3 conversations', ref: 'coder-workspace/thinkgraph-merge-1b1a6958-to-admin.json' },
      { kind: 'knowgraph', label: 'Attached 2 research scopes to ADMIN', status: 'complete', detail: 'union 510 → 530 nodes' },
      { kind: 'code', label: 'Projection now emits node type from kind', status: 'complete', detail: 'Canonical Engraphis records retain their stored kinds', ref: 'apps/python-models/app/python_models/thinkgraph_engraphis.py' },
      { kind: 'goal', label: 'Opened Goal: one visible ADMIN project + typed ThinkGraph', status: 'complete' },
    ],
  });

  const after = (await getConversationMessages(ADMIN, CONV)).length;
  console.log(JSON.stringify({ conversation: CONV, project: ADMIN, before, after, added: after - before, userMessageId: user.messageId }, null, 2));
}
main().then(() => process.exit(0)).catch((e) => { console.error('SEED_CHAT_FAILED', e?.stack || e); process.exit(1); });
