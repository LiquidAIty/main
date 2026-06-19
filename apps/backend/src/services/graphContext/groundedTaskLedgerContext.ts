// Smallest Task Ledger grounding projection. Does NOT build a second graph-context stack:
// it composes the existing readers — `readRecentThinkGraphSemanticRecords` (accepted
// :SlmGraphRecord graphPayloads, now un-islanded) for cheap project memory, and the mature
// `buildGraphContextPacket` service for CodeGraph ONLY when explicitly requested (heavy CBM
// is never forced onto the chat hot path). Read-only: no graph writes, no LLM, no Docker
// Gemma, no deterministic intent routing. Honest unavailable per source.
import {
  buildGraphContextPacket,
  type BuildGraphContextPacketArgs,
} from './graphContextBuilder';
import {
  readRecentThinkGraphSemanticRecords,
  type ThinkGraphSemanticListResult,
} from '../thinkgraph/thinkgraphMemory';

export type TaskLedgerGraphGroundingContext = {
  projectId?: string;
  userText: string;
  thinkGraph: {
    ok: boolean;
    facts: Array<{ label: string; type?: string; sourceRef?: string; confidence?: number }>;
    relations?: Array<{ from?: string; to?: string; type: string; sourceRef?: string; confidence?: number }>;
    uncertainty?: string[];
    nextSearchSeedCandidates?: string[];
    blocker?: string;
  };
  skillGraph?: {
    ok: boolean;
    matchedSkills: MatchedSkill[];
    blocker?: string;
  };
  codeGraph?: {
    ok: boolean;
    relevantFiles: Array<{ path: string; reason?: string; symbols?: string[] }>;
    blocker?: string;
  };
  warnings: string[];
};

export type MatchedSkill = { name: string; path?: string; reason?: string; guardrails?: string[] };

export type SkillContextReader = (
  userText: string,
) => Promise<{ ok: boolean; matchedSkills: MatchedSkill[]; blocker?: string }>;

export type GroundedTaskLedgerArgs = {
  userText: string;
  projectId?: string;
  repoPath?: string | null;
  /** Heavy CodeGraph/CBM is off by default — the chat hot path must stay cheap. */
  includeCodeGraph?: boolean;
  thinkGraphLimit?: number;
};

export type GroundedTaskLedgerDeps = {
  clock?: () => number;
  readThinkGraphRecords?: typeof readRecentThinkGraphSemanticRecords;
  buildGraphContext?: (
    args: BuildGraphContextPacketArgs,
  ) => ReturnType<typeof buildGraphContextPacket>;
  readSkillContext?: SkillContextReader;
  codeGraphTimeoutMs?: number;
};

const DEFAULT_THINKGRAPH_LIMIT = 8;
const DEFAULT_CODEGRAPH_TIMEOUT_MS = 12_000;

function clamp(list: string[] | undefined, limit = 12): string[] {
  return Array.from(new Set((list ?? []).map((s) => String(s).trim()).filter(Boolean))).slice(0, limit);
}

function mapThinkGraph(
  result: ThinkGraphSemanticListResult,
): TaskLedgerGraphGroundingContext['thinkGraph'] {
  if (!result.ok) {
    return { ok: false, facts: [], blocker: `thinkgraph_unavailable: ${result.error}` };
  }
  const facts: TaskLedgerGraphGroundingContext['thinkGraph']['facts'] = [];
  const relations: NonNullable<TaskLedgerGraphGroundingContext['thinkGraph']['relations']> = [];
  const uncertainty: string[] = [];
  const seeds: string[] = [];
  for (const record of result.records) {
    for (const e of record.entities) {
      if (!e || !e.label) continue;
      facts.push({ label: e.label, type: e.type, sourceRef: record.sourceRef, confidence: (e as any).confidence ?? record.confidence ?? undefined });
    }
    for (const r of record.relations) {
      if (!r || !r.type) continue;
      relations.push({ from: r.from, to: r.to, type: r.type, sourceRef: record.sourceRef, confidence: (r as any).confidence ?? undefined });
    }
    uncertainty.push(...(record.uncertainty ?? []));
    seeds.push(...(record.nextSearchSeedCandidates ?? []));
  }
  return {
    ok: true,
    facts: facts.slice(0, 24),
    relations: relations.slice(0, 24),
    uncertainty: clamp(uncertainty),
    nextSearchSeedCandidates: clamp(seeds),
  };
}

async function withTimeout<T>(label: string, ms: number, fn: () => Promise<T>): Promise<T> {
  let t: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      fn(),
      new Promise<T>((_, reject) => {
        t = setTimeout(() => reject(new Error(`${label}_timeout_${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (t) clearTimeout(t);
  }
}

/**
 * Build the small Task Ledger grounding context. ThinkGraph accepted records are the cheap,
 * always-on source. SkillGraph is included only when a (cheap) reader is provided. CodeGraph
 * runs only when `includeCodeGraph` is true — and even then a failure/timeout degrades to an
 * honest blocker rather than blocking task generation. Never writes; never throws.
 */
export async function buildGroundedTaskLedgerContext(
  args: GroundedTaskLedgerArgs,
  deps: GroundedTaskLedgerDeps = {},
): Promise<TaskLedgerGraphGroundingContext> {
  const userText = String(args.userText || '');
  const projectId = args.projectId ? String(args.projectId) : undefined;
  const warnings: string[] = [];

  // 1) ThinkGraph accepted records (cheap, always-on). Honest unavailable on failure.
  const readThink = deps.readThinkGraphRecords ?? readRecentThinkGraphSemanticRecords;
  let thinkGraph: TaskLedgerGraphGroundingContext['thinkGraph'];
  try {
    const result = await readThink({ projectId: projectId ?? '', limit: args.thinkGraphLimit ?? DEFAULT_THINKGRAPH_LIMIT });
    thinkGraph = mapThinkGraph(result);
  } catch (err: any) {
    thinkGraph = { ok: false, facts: [], blocker: `thinkgraph_unavailable: ${err?.message || err}` };
  }
  if (thinkGraph.ok && thinkGraph.facts.length === 0) {
    warnings.push('thinkgraph_no_accepted_records_for_project');
  }
  if (!thinkGraph.ok && thinkGraph.blocker) warnings.push(thinkGraph.blocker);

  // 2) SkillGraph — optional/cheap. Only when a reader is provided.
  let skillGraph: TaskLedgerGraphGroundingContext['skillGraph'];
  if (deps.readSkillContext) {
    try {
      const s = await deps.readSkillContext(userText);
      skillGraph = { ok: s.ok, matchedSkills: s.matchedSkills ?? [], blocker: s.blocker };
      if (s.blocker) warnings.push(s.blocker);
    } catch (err: any) {
      skillGraph = { ok: false, matchedSkills: [], blocker: `skillgraph_unavailable: ${err?.message || err}` };
      warnings.push(skillGraph.blocker!);
    }
  } else {
    skillGraph = { ok: false, matchedSkills: [], blocker: 'skillgraph_reader_not_provided' };
    warnings.push('skillgraph_reader_not_provided');
  }

  // 3) CodeGraph/CBM — heavy, OFF by default. Reuses the existing graph-context service.
  let codeGraph: TaskLedgerGraphGroundingContext['codeGraph'];
  if (args.includeCodeGraph) {
    const build = deps.buildGraphContext ?? buildGraphContextPacket;
    try {
      const packet = await withTimeout('codegraph_cbm', deps.codeGraphTimeoutMs ?? DEFAULT_CODEGRAPH_TIMEOUT_MS, () =>
        build({ projectId: projectId ?? '', userMessage: userText, repoPath: args.repoPath ?? null, maxItems: 12 }),
      );
      const cg = packet.codeGraphContext;
      const blocker = String(cg?.blocker || '').trim();
      codeGraph = {
        ok: Boolean(cg && cg.relevantFiles.length > 0 && !blocker),
        relevantFiles: (cg?.relevantFiles ?? []).slice(0, 12).map((path) => ({ path })),
        blocker: blocker || undefined,
      };
      if (blocker) warnings.push(`codegraph_cbm: ${blocker}`);
    } catch (err: any) {
      codeGraph = { ok: false, relevantFiles: [], blocker: `codegraph_unavailable: ${err?.message || err}` };
      warnings.push(codeGraph.blocker!);
    }
  } else {
    codeGraph = { ok: false, relevantFiles: [], blocker: 'codegraph_not_run_on_task_ledger_hot_path' };
    warnings.push('codegraph_not_run_on_task_ledger_hot_path');
  }

  return { projectId, userText, thinkGraph, skillGraph, codeGraph, warnings };
}

export const TASK_LEDGER_GRAPH_GROUNDING_DIRECTIVE = `Task Ledger graph grounding.

A graphGroundingContext block accompanies this request. READ it before creating tasks.
- Prefer tasks grounded in the prior accepted facts, sourceRefs, prior blockers, matched
  skills, and relevant files it provides. Reuse known entities/relations instead of restating
  them from scratch.
- Do not invent repo files, completed proof, or graph facts. If a value is unknown, keep a
  task that fetches it (mark it uncertain) rather than asserting it.
- If a grounding source is marked unavailable, treat it as unavailable — do not fabricate it.
- Carry the relevant sourceRef forward so new tasks stay traceable to the graph memory.
- Record which grounding facts you used in the task diagnostics when the output shape supports
  it, and keep task text user-facing while graph/proof details stay structured.
- Keep the OWL-shaped graphPayload output contract intact — this grounding is additional
  context, not a replacement.`;

/** Compact, prompt-safe rendering of the grounding directive + the available context. */
export function renderTaskLedgerGroundingDirective(ctx: TaskLedgerGraphGroundingContext): string {
  const summary = {
    thinkGraph: {
      ok: ctx.thinkGraph.ok,
      facts: ctx.thinkGraph.facts.slice(0, 16),
      relations: (ctx.thinkGraph.relations ?? []).slice(0, 16),
      priorBlockers: ctx.thinkGraph.uncertainty ?? [],
      nextSearchSeedCandidates: ctx.thinkGraph.nextSearchSeedCandidates ?? [],
      blocker: ctx.thinkGraph.blocker,
    },
    skillGraph: ctx.skillGraph ? { ok: ctx.skillGraph.ok, matchedSkills: ctx.skillGraph.matchedSkills, blocker: ctx.skillGraph.blocker } : undefined,
    codeGraph: ctx.codeGraph ? { ok: ctx.codeGraph.ok, relevantFiles: ctx.codeGraph.relevantFiles, blocker: ctx.codeGraph.blocker } : undefined,
    warnings: ctx.warnings,
  };
  return `${TASK_LEDGER_GRAPH_GROUNDING_DIRECTIVE}\n\ngraphGroundingContext:\n${JSON.stringify(summary, null, 2)}`;
}
