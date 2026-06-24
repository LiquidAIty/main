// @graph entity: ContextPackBuilder
// @graph role: bounded-harness-turn-context
//
// Builds a BOUNDED Context Pack for a Harness turn from the ACTIVE conversation
// branch + reply anchor lineage + active Plan context + curated graph seams.
// The model never receives the whole saved transcript: old retired messages are
// excluded by default; only the recent active tail (and, when replying to an old
// message, that anchor's lineage) is included, within a token/char budget. Plan
// context is the Plan Draft root + selected step. ThinkGraph/KnowGraph are pulled
// only through injected retrieval seams (no automatic transcript→graph dump, no
// regex intent classifier). Every included item carries provenance for debugging.

import type { ConversationMessage } from './store';
import { lineageOf } from './store';

export type ContextPackItemSource =
  | 'active_tail'
  | 'reply_anchor'
  | 'plan_root'
  | 'plan_step'
  | 'thinkgraph'
  | 'knowgraph';

export type ContextPackItem = {
  source: ContextPackItemSource;
  ref?: string;
  text: string;
  reason: string;
};

export type PlanDraftLike = {
  id?: string;
  objective?: string;
  summary?: string;
  assumptions?: string[];
  openQuestions?: string[];
  constraints?: string[];
  acceptanceCriteria?: string[];
  steps?: Array<{
    id?: string;
    shortTitle?: string;
    shortSummary?: string;
    detail?: string;
    expectedOutcome?: string;
    dependencies?: string[];
    constraints?: string[];
    acceptanceCriteria?: string[];
    state?: string;
  }>;
} | null | undefined;

export type GraphContextItem = { ref?: string; text: string; reason: string };
export type GraphRetriever = (args: {
  projectId: string;
  planDraftId?: string | null;
  planStepId?: string | null;
  anchorMessageId?: string | null;
  budgetChars: number;
}) => Promise<GraphContextItem[]>;

export type BuildContextPackArgs = {
  projectId: string;
  conversationId: string;
  messages: ConversationMessage[];
  // Leaf of the ACTIVE branch (usually the latest message on the active path).
  activeLeafMessageId?: string | null;
  // When the user replied "from here", the selected anchor message id.
  anchorMessageId?: string | null;
  // Whether the live runtime session is fresh (new tab / post-restart) — only then
  // do we rebuild the active tail into the pack (otherwise the live gRPC session
  // already carries it and we avoid duplication).
  runtimeFresh?: boolean;
  planDraft?: PlanDraftLike;
  selectedPlanStepId?: string | null;
  maxPairs?: number;
  budgetChars?: number;
  // Optional curated-memory seams. Absent → honest empty (no auto graph dump).
  thinkGraphRetriever?: GraphRetriever;
  knowGraphRetriever?: GraphRetriever;
};

export type ContextPack = {
  preamble: string;
  items: ContextPackItem[];
  excluded: { retiredMessageCount: number; note: string };
};

function clip(text: string, cap: number): string {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  return t.length <= cap ? t : `${t.slice(0, cap - 1)}…`;
}

function indexById(messages: ConversationMessage[]): Record<string, ConversationMessage> {
  const byId: Record<string, ConversationMessage> = {};
  for (const m of messages) byId[m.messageId] = m;
  return byId;
}

/** The active branch = lineage of the active leaf (or the latest message). */
function activeBranch(messages: ConversationMessage[], activeLeafMessageId?: string | null): ConversationMessage[] {
  const byId = indexById(messages);
  if (activeLeafMessageId && byId[activeLeafMessageId]) return lineageOf(byId, activeLeafMessageId);
  if (messages.length === 0) return [];
  const latest = [...messages].sort((a, b) => a.seq - b.seq)[messages.length - 1];
  return lineageOf(byId, latest.messageId);
}

/** Last N user/assistant pairs of a branch, oldest→newest, char-bounded. */
function tailPairs(branch: ConversationMessage[], maxPairs: number, budgetChars: number): ConversationMessage[] {
  const convo = branch.filter((m) => m.role === 'user' || m.role === 'assistant' && m.content.trim());
  const tail = convo.slice(-(maxPairs * 2));
  // Trim from the front until under budget.
  let used = 0;
  const kept: ConversationMessage[] = [];
  for (let i = tail.length - 1; i >= 0; i -= 1) {
    const len = tail[i].content.length + 16;
    if (used + len > budgetChars && kept.length > 0) break;
    used += len;
    kept.unshift(tail[i]);
  }
  return kept;
}

export async function buildContextPack(args: BuildContextPackArgs): Promise<ContextPack> {
  const maxPairs = args.maxPairs ?? 3;
  const budgetChars = args.budgetChars ?? 6000;
  const items: ContextPackItem[] = [];
  const branch = activeBranch(args.messages, args.activeLeafMessageId);

  // 1) Active branch tail — rebuilt into the pack only on a fresh runtime session
  // OR when replying from an old anchor (branch lineage differs from the live one).
  const includeTail = Boolean(args.runtimeFresh || args.anchorMessageId);
  if (includeTail) {
    for (const m of tailPairs(branch, maxPairs, Math.floor(budgetChars * 0.5))) {
      items.push({
        source: 'active_tail',
        ref: m.messageId,
        text: `${m.role}: ${clip(m.content, 600)}`,
        reason: args.runtimeFresh ? 'fresh-runtime-rebuild' : 'reply-branch-tail',
      });
    }
  }

  // 2) Reply anchor lineage — the selected old message + necessary parent lineage.
  if (args.anchorMessageId) {
    const byId = indexById(args.messages);
    const lineage = byId[args.anchorMessageId] ? lineageOf(byId, args.anchorMessageId) : [];
    const anchorTail = lineage.slice(-(maxPairs * 2));
    for (const m of anchorTail) {
      if (!m.content.trim()) continue;
      items.push({
        source: 'reply_anchor',
        ref: m.messageId,
        text: `${m.role}: ${clip(m.content, 600)}`,
        reason: m.messageId === args.anchorMessageId ? 'selected-anchor' : 'anchor-parent-lineage',
      });
    }
  }

  // 3) Active Plan context — Plan Draft root + selected step (never the chat plan text).
  const plan = args.planDraft;
  if (plan && (plan.objective || (plan.steps && plan.steps.length))) {
    const rootBits = [
      plan.objective ? `objective: ${clip(plan.objective, 300)}` : '',
      plan.summary ? `summary: ${clip(plan.summary, 300)}` : '',
      plan.openQuestions?.length ? `open questions: ${clip(plan.openQuestions.join('; '), 300)}` : '',
      plan.constraints?.length ? `constraints: ${clip(plan.constraints.join('; '), 300)}` : '',
    ].filter(Boolean);
    items.push({ source: 'plan_root', ref: plan.id ?? undefined, text: `Active plan — ${rootBits.join(' | ')}`, reason: 'active-plan-root' });
    const step = args.selectedPlanStepId
      ? (plan.steps ?? []).find((s) => s.id === args.selectedPlanStepId)
      : undefined;
    if (step) {
      const stepBits = [
        step.shortTitle ? `title: ${clip(step.shortTitle, 120)}` : '',
        step.detail ? `detail: ${clip(step.detail, 500)}` : '',
        step.expectedOutcome ? `expected: ${clip(step.expectedOutcome, 300)}` : '',
        step.dependencies?.length ? `depends on: ${step.dependencies.join(', ')}` : '',
        step.acceptanceCriteria?.length ? `acceptance: ${clip(step.acceptanceCriteria.join('; '), 300)}` : '',
      ].filter(Boolean);
      items.push({ source: 'plan_step', ref: step.id ?? undefined, text: `Selected step — ${stepBits.join(' | ')}`, reason: 'selected-plan-step' });
    }
  }

  // 4 & 5) Curated ThinkGraph / KnowGraph — only via injected retrieval seams. No
  // automatic transcript→graph dump; absent retriever → honest empty.
  const graphBudget = Math.floor(budgetChars * 0.25);
  const planDraftId = plan?.id ?? null;
  if (args.thinkGraphRetriever) {
    try {
      const tg = await args.thinkGraphRetriever({ projectId: args.projectId, planDraftId, planStepId: args.selectedPlanStepId ?? null, anchorMessageId: args.anchorMessageId ?? null, budgetChars: graphBudget });
      for (const g of tg) items.push({ source: 'thinkgraph', ref: g.ref, text: clip(g.text, 500), reason: g.reason || 'curated-thinkgraph' });
    } catch {
      /* graph retrieval is best-effort; never blocks a turn */
    }
  }
  if (args.knowGraphRetriever) {
    try {
      const kg = await args.knowGraphRetriever({ projectId: args.projectId, planDraftId, planStepId: args.selectedPlanStepId ?? null, anchorMessageId: args.anchorMessageId ?? null, budgetChars: graphBudget });
      for (const g of kg) items.push({ source: 'knowgraph', ref: g.ref, text: clip(g.text, 500), reason: g.reason || 'grounded-knowgraph' });
    } catch {
      /* best-effort */
    }
  }

  // Retired = saved messages NOT in the active branch tail / anchor lineage.
  const includedIds = new Set(items.filter((i) => i.ref).map((i) => i.ref as string));
  const retiredMessageCount = args.messages.filter((m) => !includedIds.has(m.messageId)).length;

  const preamble =
    items.length === 0
      ? ''
      : [
          '[CONTEXT PACK — bounded active context for this turn; not the full transcript]',
          ...items.map((i) => `- (${i.source}) ${i.text}`),
          '[END CONTEXT PACK]',
        ].join('\n');

  return {
    preamble,
    items,
    excluded: {
      retiredMessageCount,
      note: 'Retired transcript excluded by default; included only the active tail, reply-anchor lineage, active plan, and curated graph context.',
    },
  };
}
