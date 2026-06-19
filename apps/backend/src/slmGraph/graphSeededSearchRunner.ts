// Safe bridge: ONE compiled graph-seeded search task -> ONE Tavily web search (the existing
// safe MCP client) -> ONE normalized SearchAgentResultPacket the convergence detector accepts.
// Boundaries: requires an explicit env key (fails closed with `search_tool_not_configured`),
// caps queries + results, uses a timeout, never scrapes pages, never runs browser automation,
// never writes graph memory, never fakes a run when the key is missing. NOT a crawler, NOT
// intent classification — the query already came deterministically from graph seeds.
import { tavilySearch } from '../agents/mcp/tavilyClient';
import type { ResearchTargetPacket, TavilySearchResult } from '../services/research/types';
import type { GraphSeededSearchTask, SearchAgentResultPacket } from './graphSeededSearchConvergence';

export const SAFE_SEARCH_PROVIDER = 'tavily' as const;
export const MAX_SEARCH_QUERIES = 3;
export const MAX_RESULTS_PER_QUERY = 5;

/** Explicit env-key gate. No key -> the tool is not configured (fail closed, never faked). */
export function isSafeSearchConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(String(env.TAVILY_API_KEY || '').trim() && String(env.TAVILY_MCP_URL || '').trim());
}

export type SafeSearchFn = (
  packet: ResearchTargetPacket,
  opts?: { toolsConfig?: any[] },
) => Promise<{ toolName: string; results: TavilySearchResult[]; raw: any }>;

export type RunGraphSeededSearchOpts = {
  projectId?: string;
  turnId?: string;
  maxResults?: number;
  env?: NodeJS.ProcessEnv;
};

export type RunGraphSeededSearchDeps = {
  search?: SafeSearchFn;
};

export type RunSearchTaskResult =
  | { ok: true; packet: SearchAgentResultPacket; toolName: string; resultCount: number }
  | { ok: false; reason: 'search_tool_not_configured' | string };

function dedupeLower(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const t = String(v ?? '').trim();
    if (!t || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
  }
  return out;
}

/** Map a graph-seeded task into the existing safe ResearchTargetPacket (bounded). */
function taskToTargetPacket(task: GraphSeededSearchTask, opts: RunGraphSeededSearchOpts): ResearchTargetPacket {
  return {
    projectId: String(opts.projectId || ''),
    turnId: String(opts.turnId || `graph-seeded-search-${task.id}`),
    query: task.query,
    priorityEntities: dedupeLower(task.seedRefs.entities || []),
    priorityRelationships: dedupeLower(task.seedRefs.relations || []),
    attentionEdges: [],
    triplets: [],
    gaps: [],
    searchTasks: [],
    openQuestions: [],
    maxResults: Math.min(Math.max(1, opts.maxResults ?? MAX_RESULTS_PER_QUERY), MAX_RESULTS_PER_QUERY),
    searchDepth: 'basic',
    mode: 'web_research',
  };
}

/**
 * Normalize Tavily results into a SearchAgentResultPacket. Conservative v1 extraction: source
 * refs from result URLs; entities are the task's GRAPH seed entities that actually appear in a
 * result title/snippet (grounded, not invented); relations/claims are left for a later, more
 * careful extraction pass. Substring matching of known graph entities — no regex routing, no
 * intent classification.
 */
export function tavilyResultsToPacket(
  task: GraphSeededSearchTask,
  results: TavilySearchResult[],
): SearchAgentResultPacket {
  const capped = (Array.isArray(results) ? results : []).slice(0, MAX_RESULTS_PER_QUERY);
  const sourceRefs = capped
    .filter((r) => r && r.url)
    .map((r) => ({ ref: r.url, url: r.url, title: r.title || r.url, sourceType: 'web' }));

  const seedEntities = dedupeLower(task.seedRefs.entities || []);
  const haystacks = capped.map((r) =>
    `${r.title || ''} ${r.snippet || ''} ${r.summary || ''} ${r.content || ''}`.toLowerCase(),
  );
  const bestScore = capped.reduce((m, r) => Math.max(m, Number.isFinite(Number(r.score)) ? Number(r.score) : 0), 0);
  const entities = seedEntities
    .filter((label) => haystacks.some((h) => h.includes(label.toLowerCase())))
    .map((label) => ({ label, confidence: Number((bestScore > 0 ? Math.min(0.9, bestScore) : 0.5).toFixed(2)) }));

  return {
    agentId: `${task.kind}-agent`,
    searchTaskId: task.id,
    query: task.query,
    sourceRefs,
    entities,
    relations: [],
    claims: [],
    uncertainty: ['live_v1: entities grounded by source title/snippet match only; relations/claims not yet extracted'],
  };
}

/**
 * Run ONE graph-seeded search task through the safe Tavily client and normalize the result.
 * Fails closed (no key -> search_tool_not_configured; provider error -> ok:false with the real
 * message). Never writes graph memory.
 */
export async function runGraphSeededSearchTask(
  task: GraphSeededSearchTask,
  opts: RunGraphSeededSearchOpts = {},
  deps: RunGraphSeededSearchDeps = {},
): Promise<RunSearchTaskResult> {
  if (!isSafeSearchConfigured(opts.env ?? process.env)) {
    return { ok: false, reason: 'search_tool_not_configured' };
  }
  const search = deps.search ?? tavilySearch;
  try {
    const res = await search(taskToTargetPacket(task, opts));
    return {
      ok: true,
      packet: tavilyResultsToPacket(task, res.results),
      toolName: res.toolName,
      resultCount: Array.isArray(res.results) ? res.results.length : 0,
    };
  } catch (err: any) {
    const message = String(err?.message || err);
    // Missing MCP config is "not configured", not a fake/crash.
    if (message.includes('tavily_mcp_config_missing')) {
      return { ok: false, reason: 'search_tool_not_configured' };
    }
    return { ok: false, reason: message };
  }
}

export type RunSearchTasksResult =
  | { ok: true; packets: SearchAgentResultPacket[]; ran: number; errors: string[] }
  | { ok: false; reason: 'search_tool_not_configured' };

/**
 * Run up to MAX_SEARCH_QUERIES graph-seeded tasks and collect normalized packets. Fails closed
 * when the tool is not configured. Per-task provider errors are recorded, not faked.
 */
export async function runGraphSeededSearchTasks(
  tasks: GraphSeededSearchTask[],
  opts: RunGraphSeededSearchOpts = {},
  deps: RunGraphSeededSearchDeps = {},
): Promise<RunSearchTasksResult> {
  if (!isSafeSearchConfigured(opts.env ?? process.env)) {
    return { ok: false, reason: 'search_tool_not_configured' };
  }
  const bounded = (Array.isArray(tasks) ? tasks : []).slice(0, MAX_SEARCH_QUERIES);
  const packets: SearchAgentResultPacket[] = [];
  const errors: string[] = [];
  for (const task of bounded) {
    const result = await runGraphSeededSearchTask(task, opts, deps);
    if (result.ok) packets.push(result.packet);
    else errors.push(`${task.id}: ${result.reason}`);
  }
  return { ok: true, packets, ran: bounded.length, errors };
}
