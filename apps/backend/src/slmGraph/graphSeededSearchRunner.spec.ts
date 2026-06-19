import { describe, expect, it, vi } from 'vitest';

import {
  buildGraphSeededSearchTasks,
  detectSearchConvergence,
  graphSearchSeedFromExtraction,
  type GraphSeededSearchTask,
} from './graphSeededSearchConvergence';
import {
  MAX_RESULTS_PER_QUERY,
  MAX_SEARCH_QUERIES,
  isSafeSearchConfigured,
  runGraphSeededSearchTask,
  runGraphSeededSearchTasks,
  tavilyResultsToPacket,
  type SafeSearchFn,
} from './graphSeededSearchRunner';
import type { TavilySearchResult } from '../services/research/types';

const CONFIGURED = { TAVILY_API_KEY: 'k', TAVILY_MCP_URL: 'https://tavily.example/mcp' } as any;

const SEED = graphSearchSeedFromExtraction(
  {
    entities: [
      { id: 'e_rdw', label: 'Redwire Corporation', type: 'company' },
      { id: 'e_rdw_ticker', label: 'RDW', type: 'ticker' },
      { id: 'e_spacex', label: 'SpaceX', type: 'company' },
    ],
    relations: [{ from: 'e_t1', to: 'e_rdw', type: 'requires' }],
    nextSearchSeedCandidates: [],
  } as any,
  { projectId: 'p' },
);
const TASKS = buildGraphSeededSearchTasks(SEED);
const ONE_TASK: GraphSeededSearchTask = TASKS[0];

function tavilyResult(url: string, title: string, snippet = ''): TavilySearchResult {
  return { url, title, snippet, score: 0.8, metadata: {} };
}

const fakeSearch: SafeSearchFn = async () => ({
  toolName: 'tavily_search',
  results: [
    tavilyResult('https://www.redwirespace.com/investors', 'Redwire Corporation (RDW) Investors', 'RDW current price and market data'),
    tavilyResult('https://forgeglobal.com/spacex', 'SpaceX secondary market valuation', 'SpaceX private market tender offers'),
  ],
  raw: {},
});

describe('safe search boundary (fail closed without key)', () => {
  it('reports search_tool_not_configured when the key is missing, and never calls the provider', async () => {
    const spy = vi.fn(fakeSearch);
    const res = await runGraphSeededSearchTask(ONE_TASK, { env: {} as any }, { search: spy });
    expect(res).toEqual({ ok: false, reason: 'search_tool_not_configured' });
    expect(spy).not.toHaveBeenCalled();
  });

  it('isSafeSearchConfigured requires both the key and the MCP url', () => {
    expect(isSafeSearchConfigured({} as any)).toBe(false);
    expect(isSafeSearchConfigured({ TAVILY_API_KEY: 'k' } as any)).toBe(false);
    expect(isSafeSearchConfigured(CONFIGURED)).toBe(true);
  });

  it('runGraphSeededSearchTasks also fails closed without a key', async () => {
    const spy = vi.fn(fakeSearch);
    const res = await runGraphSeededSearchTasks(TASKS, { env: {} as any }, { search: spy });
    expect(res).toEqual({ ok: false, reason: 'search_tool_not_configured' });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('search task -> safe provider request', () => {
  it('maps a graph-seeded task into a bounded ResearchTargetPacket', async () => {
    const spy = vi.fn(fakeSearch);
    await runGraphSeededSearchTask(ONE_TASK, { env: CONFIGURED, projectId: 'p', maxResults: 99 }, { search: spy });
    expect(spy).toHaveBeenCalledTimes(1);
    const target = spy.mock.calls[0][0];
    expect(target.query).toBe(ONE_TASK.query);
    expect(target.maxResults).toBe(MAX_RESULTS_PER_QUERY); // capped, not 99
    expect(target.searchDepth).toBe('basic');
    expect(target.mode).toBe('web_research');
    expect(target.priorityEntities.length).toBeGreaterThan(0); // seeded from graph
  });

  it('enforces max queries across a task batch', async () => {
    const spy = vi.fn(fakeSearch);
    const res = await runGraphSeededSearchTasks(TASKS, { env: CONFIGURED }, { search: spy });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.ran).toBeLessThanOrEqual(MAX_SEARCH_QUERIES);
    expect(spy.mock.calls.length).toBeLessThanOrEqual(MAX_SEARCH_QUERIES);
  });
});

describe('provider result -> SearchAgentResultPacket', () => {
  it('normalizes results into a packet with preserved sourceRefs and graph-grounded entities', async () => {
    const res = await runGraphSeededSearchTask(ONE_TASK, { env: CONFIGURED }, { search: fakeSearch });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const p = res.packet;
    expect(p.searchTaskId).toBe(ONE_TASK.id);
    expect(p.query).toBe(ONE_TASK.query);
    expect(p.sourceRefs.map((s) => s.url)).toContain('https://www.redwirespace.com/investors');
    expect(p.sourceRefs.every((s) => !!s.ref && s.sourceType === 'web')).toBe(true);
    // entities are only the GRAPH seed entities that appear in a source title/snippet
    const labels = p.entities.map((e) => e.label.toLowerCase());
    expect(labels).toContain('redwire corporation');
    expect(p.relations).toEqual([]); // conservative v1 — no invented relations
    expect(p.claims).toEqual([]); // no invented claims
  });

  it('caps sourceRefs at MAX_RESULTS_PER_QUERY', () => {
    const many: TavilySearchResult[] = Array.from({ length: 12 }, (_, i) => tavilyResult(`https://ex${i}.com/a`, `Redwire ${i}`));
    const packet = tavilyResultsToPacket(ONE_TASK, many);
    expect(packet.sourceRefs.length).toBeLessThanOrEqual(MAX_RESULTS_PER_QUERY);
  });
});

describe('convergence accepts live-normalized packets', () => {
  it('runs the detector over runner-produced packets without throwing', async () => {
    const batch = await runGraphSeededSearchTasks(TASKS, { env: CONFIGURED }, { search: fakeSearch });
    expect(batch.ok).toBe(true);
    if (!batch.ok) return;
    const report = detectSearchConvergence(batch.packets, SEED);
    expect(report).toHaveProperty('convergenceScore');
    expect(report.convergenceScore).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(report.nextSearchSeedCandidates)).toBe(true);
  });

  it('introduces no draft-generator naming', () => {
    const packet = tavilyResultsToPacket(ONE_TASK, []);
    expect(JSON.stringify(packet).toLowerCase()).not.toContain('draft');
  });
});
