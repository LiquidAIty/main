// @graph entity: ProcessThinkGraphPair
// @graph role: post-chat-thinkgraph-card-invocation
// @graph relates_to: ConversationStore, DeckStore, ConfiguredCardRuntime, ThinkGraphStore
//
// THE mechanical post-chat ThinkGraph runner. After a normal project chat pair
// completes, this processes the EXACT referenced pair by running the deck's
// configured ThinkGraph card through the proven single-card runtime. The card
// (its persisted prompt + its persisted tools) decides what, if anything, to
// add to the graph — this module decides NOTHING semantic. It only: validates
// structural references, loads the exact pair from the canonical conversation
// store, resolves the server-trusted deck binding, enforces the card's
// allowed-tool contract, checks idempotency, invokes the card, and reports
// honestly via neutral mechanical counts (never a semantic outcome inferred
// from the model's final text). Failure never touches the normal chat result
// (callers fire-and-forget); there is no fallback extractor, model, card, or
// writer.

import { getConversationPair } from '../../conversations/store';
import { getDeckDocument } from '../../decks/store';
import { runConfiguredCard } from '../../cards/runtime';
import { resolveRuntimeBinding } from '../../contracts/runtimeBinding';
import { runCypherOnGraph, ensureVertexLabel } from '../graphService';

const GRAPH = 'thinkgraph_liq';
const REQUIRED_TOOLS = ['mcp__liquidaity__thinkgraph_get_graph_slice', 'mcp__liquidaity__thinkgraph_apply_live_patch'];
const ALLOWED_ARG_KEYS = ['projectId', 'deckId', 'conversationId', 'userMessageId', 'assistantMessageId', 'correlationId'] as const;
const PAIR_TEXT_CAP = 24_000;

export type ProcessPairArgs = {
  projectId: string;
  deckId: string;
  conversationId: string;
  userMessageId: string;
  assistantMessageId: string;
  correlationId: string;
};

// `status` distinguishes only OPERATIONAL states of the run itself (did it run,
// was it already done, could it not be configured) — never a semantic decision
// about what the model chose to write. Whatever it actually wrote is reported
// through the neutral mechanical counts below, derived from real persisted
// records, never inferred from the model's final text.
export type ProcessPairResult = {
  status: 'duplicate' | 'failed' | 'not_configured' | null;
  completed: boolean;
  toolCallCount: number | null;
  tripleWriteCount: number;
  resourceWriteCount: number;
  statementWriteCount: number;
  correlationId: string;
  cardId: string | null;
  cardSummary: string;
  error: string | null;
  startedAt: string;
  endedAt: string;
};

function s(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v);
}

function parseRow(raw: unknown): Record<string, any> | null {
  const v = typeof raw === 'string' ? (() => { try { return JSON.parse(raw); } catch { return null; } })() : raw;
  return v && typeof v === 'object' ? (v as Record<string, any>) : null;
}

function clipText(v: unknown): string {
  const t = s(v);
  return t.length > PAIR_TEXT_CAP ? `${t.slice(0, PAIR_TEXT_CAP)}\n[...truncated]` : t;
}

export type ThinkGraphCardResolution =
  | { ok: true; card: any }
  | { ok: false; error: string };

/**
 * Pure structural resolution from persisted deck nodes: exactly ONE card whose
 * persisted runtimeBinding classifies as 'thinkgraph_agent' (the same existing
 * mechanism the agent-fabric capability uses). Zero matches → not configured;
 * multiple → honest ambiguity. Never display-name matching.
 */
export function resolveThinkGraphCardFromDeck(nodes: any[]): ThinkGraphCardResolution {
  const matches = (nodes || []).filter(
    (n) =>
      resolveRuntimeBinding(n?.runtimeOptions?.binding ?? n?.runtimeBinding ?? n?.binding, n?.id) ===
      'thinkgraph_agent',
  );
  if (matches.length === 0) {
    return { ok: false, error: 'thinkgraph_card_not_found: no persisted card with runtimeBinding thinkgraph_agent' };
  }
  if (matches.length > 1) {
    return { ok: false, error: `thinkgraph_card_ambiguous: ${matches.map((m) => s(m?.id)).join(',')}` };
  }
  return { ok: true, card: matches[0] };
}

/**
 * The persisted card must carry EXACTLY the two scoped ThinkGraph tools
 * (order-insensitive). Anything else — legacy defaults, subsets, extras — is an
 * honest configuration error; the runtime never substitutes or supplements the
 * saved selection. Pure, so the gate is directly unit-testable.
 */
export function validateThinkGraphCardTools(card: any): string | null {
  const cardTools = (Array.isArray(card?.runtimeOptions?.tools) ? card.runtimeOptions.tools : []).map(
    (t: unknown) => s(t),
  );
  const toolsOk =
    cardTools.length === REQUIRED_TOOLS.length && REQUIRED_TOOLS.every((t) => cardTools.includes(t));
  if (toolsOk) return null;
  return `thinkgraph_card_tools_invalid: expected exactly [${REQUIRED_TOOLS.join(',')}], got [${cardTools.join(',')}]`;
}

async function patchMarkerExists(projectId: string, correlationId: string): Promise<boolean> {
  await ensureVertexLabel(GRAPH, 'ThinkDeltaApplied');
  const rows = await runCypherOnGraph(
    GRAPH,
    `MATCH (m:ThinkDeltaApplied {project_id: $projectId, correlation_id: $correlationId}) RETURN m.correlation_id LIMIT 1`,
    { projectId, correlationId },
  );
  return Array.isArray(rows) && rows.length > 0;
}

/** Neutral mechanical counts of what THIS correlationId actually left behind in
 * storage — never inferred from the model's final text. Every record touched
 * during a run (created or merely mention-bumped) carries this correlationId,
 * so a direct count is the honest source of truth. */
async function countWrittenByCorrelation(
  projectId: string,
  correlationId: string,
): Promise<{ resourceWriteCount: number; statementWriteCount: number }> {
  const resourceRows = await runCypherOnGraph(
    GRAPH,
    `MATCH (n:Resource {project_id: $projectId, correlation_id: $correlationId}) RETURN { c: count(n) } AS row`,
    { projectId, correlationId },
  );
  const statementRows = await runCypherOnGraph(
    GRAPH,
    `MATCH (n:Statement {project_id: $projectId, correlation_id: $correlationId}) RETURN { c: count(n) } AS row`,
    { projectId, correlationId },
  );
  const firstCount = (rows: unknown[]): number => {
    const row = parseRow(rows[0]);
    const c = Number(row?.c);
    return Number.isFinite(c) && c > 0 ? c : 0;
  };
  return { resourceWriteCount: firstCount(resourceRows), statementWriteCount: firstCount(statementRows) };
}

/**
 * Process one exact completed conversation pair through the configured ThinkGraph card.
 * Deterministic per correlation key: an already-patched correlation returns `duplicate`
 * without re-running the card.
 */
export async function processThinkGraphPair(args: ProcessPairArgs): Promise<ProcessPairResult> {
  const startedAt = new Date().toISOString();
  const done = (partial: Partial<ProcessPairResult>): ProcessPairResult => ({
    status: null,
    completed: false,
    toolCallCount: null,
    tripleWriteCount: 0,
    resourceWriteCount: 0,
    statementWriteCount: 0,
    correlationId: s(args?.correlationId),
    cardId: null,
    cardSummary: '',
    error: null,
    startedAt,
    endedAt: new Date().toISOString(),
    ...partial,
  });

  // Structural override rejection: only the six trusted references are accepted.
  const extra = Object.keys(args || {}).filter((k) => !(ALLOWED_ARG_KEYS as readonly string[]).includes(k));
  if (extra.length > 0) {
    return done({ status: 'failed', error: `thinkgraph_pair_overrides_rejected: ${extra.join(',')}` });
  }
  for (const k of ALLOWED_ARG_KEYS) {
    if (!s(args?.[k]).trim()) return done({ status: 'failed', error: `thinkgraph_pair_${k}_required` });
  }
  const projectId = s(args.projectId).trim();
  const deckId = s(args.deckId).trim();
  const correlationId = s(args.correlationId).trim();

  // Exact pair from the canonical conversation store — never "the latest pair".
  const pair = await getConversationPair({
    projectId,
    conversationId: s(args.conversationId).trim(),
    userMessageId: s(args.userMessageId).trim(),
    assistantMessageId: s(args.assistantMessageId).trim(),
  });
  if (!pair.ok) return done({ status: 'failed', error: pair.error });

  // Server-trusted STRUCTURAL resolution from the persisted deck: the existing
  // runtimeBinding classification ('thinkgraph_agent') identifies the card — the
  // same persisted mechanism the agent-fabric capability already uses. Never
  // display-name matching, never browser-supplied card ids, no extra binding field.
  const doc = await getDeckDocument(projectId, deckId);
  const nodes: any[] = Array.isArray((doc?.deck as any)?.nodes) ? (doc!.deck as any).nodes : [];
  const resolution = resolveThinkGraphCardFromDeck(nodes);
  if (!resolution.ok) {
    return done({ status: 'not_configured', error: resolution.error });
  }
  const card = resolution.card;
  const binding = s(card.id);
  const toolsError = validateThinkGraphCardTools(card);
  if (toolsError) {
    return done({ status: 'not_configured', cardId: binding, error: toolsError });
  }

  // Idempotency: a correlation that already produced a patch is never reprocessed.
  if (await patchMarkerExists(projectId, correlationId)) {
    return done({ status: 'duplicate', cardId: binding });
  }

  // Bounded pair input: neutral mechanical delimiters only, so the exact raw
  // pair can pass through the string-only card runtime. No interpretation, no
  // extraction, no instruction text — the card's own persisted prompt owns all
  // semantics; the tools carry authority via the trusted run context.
  const input = [
    'COMPLETED CONVERSATION PAIR',
    '',
    'USER MESSAGE:',
    clipText(pair.user.content),
    '',
    'ASSISTANT MESSAGE:',
    clipText(pair.assistant.content),
  ].join('\n');

  const run = await runConfiguredCard({
    projectId,
    deckId,
    cardId: binding,
    correlationId,
    input,
    runAuthority: {
      kind: 'thinkgraph_pair',
      projectId,
      deckId,
      cardId: binding,
      correlationId,
      conversationId: s(args.conversationId).trim(),
      userMessageId: s(args.userMessageId).trim(),
      assistantMessageId: s(args.assistantMessageId).trim(),
    },
  });

  if (run.status !== 'completed') {
    return done({ status: 'failed', cardId: binding, error: run.error || `card_run_${run.status}` });
  }

  // Neutral mechanical counts of what this correlationId actually left in
  // storage — never a semantic decision inferred from the model's final text.
  const { resourceWriteCount, statementWriteCount } = await countWrittenByCorrelation(projectId, correlationId);
  return done({
    status: null,
    completed: true,
    toolCallCount: run.toolCallCount,
    tripleWriteCount: statementWriteCount,
    resourceWriteCount,
    statementWriteCount,
    cardId: binding,
    cardSummary: run.output.slice(0, 2000),
  });
}
