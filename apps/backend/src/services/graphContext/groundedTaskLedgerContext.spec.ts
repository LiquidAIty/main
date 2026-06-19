import { describe, expect, it, vi } from 'vitest';

import {
  buildGroundedTaskLedgerContext,
  renderTaskLedgerGroundingDirective,
} from './groundedTaskLedgerContext';
import type { ThinkGraphSemanticListResult } from '../thinkgraph/thinkgraphMemory';

const ACCEPTED_RECORD = {
  id: 'tgsem:p:1',
  projectId: 'magone-graphpayload-test',
  sourceRef: 'user_request_stream',
  createdBy: 'slmGraphWorker',
  entities: [
    { id: 'e_rdw', label: 'Redwire Corporation', type: 'company', confidence: 0.99 },
    { id: 'e_spacex', label: 'SpaceX', type: 'company', confidence: 0.99 },
  ],
  relations: [{ from: 'e_rdw_ticker', to: 'e_rdw', type: 'identifies', confidence: 0.99 }],
  categories: ['market_research'],
  sourceRefs: [{ ref: 'user_request_stream' }],
  confidence: 0.99,
  uncertainty: ['Live RDW price unknown until lookup'],
  nextSearchSeedCandidates: ['live_market_data_for_RDW', 'private_market_sources_for_SpaceX'],
  createdAt: '2026-06-19T17:59:26.921Z',
};

const okThinkGraph = async (): Promise<ThinkGraphSemanticListResult> => ({ ok: true, records: [ACCEPTED_RECORD] });

describe('Task Ledger graph grounding projection', () => {
  it('surfaces accepted ThinkGraph records as facts/relations/seeds (cheap, default)', async () => {
    const ctx = await buildGroundedTaskLedgerContext(
      { userText: 'Continue RDW / SpaceX research', projectId: 'magone-graphpayload-test' },
      { readThinkGraphRecords: okThinkGraph },
    );
    expect(ctx.thinkGraph.ok).toBe(true);
    expect(ctx.thinkGraph.facts.map((f) => f.label)).toEqual(['Redwire Corporation', 'SpaceX']);
    expect(ctx.thinkGraph.facts[0].sourceRef).toBe('user_request_stream');
    expect(ctx.thinkGraph.relations?.some((r) => r.type === 'identifies')).toBe(true);
    expect(ctx.thinkGraph.uncertainty).toContain('Live RDW price unknown until lookup');
    expect(ctx.thinkGraph.nextSearchSeedCandidates).toContain('live_market_data_for_RDW');
  });

  it('does NOT run heavy CodeGraph on the hot path by default', async () => {
    const buildGraphContext = vi.fn();
    const ctx = await buildGroundedTaskLedgerContext(
      { userText: 'x', projectId: 'p' },
      { readThinkGraphRecords: okThinkGraph, buildGraphContext: buildGraphContext as any },
    );
    expect(buildGraphContext).not.toHaveBeenCalled();
    expect(ctx.codeGraph?.ok).toBe(false);
    expect(ctx.codeGraph?.blocker).toBe('codegraph_not_run_on_task_ledger_hot_path');
    expect(ctx.warnings).toContain('codegraph_not_run_on_task_ledger_hot_path');
  });

  it('REUSES the existing graph-context service when CodeGraph is requested', async () => {
    const buildGraphContext = vi.fn().mockResolvedValue({
      codeGraphContext: { relevantFiles: ['apps/backend/src/slmGraph/slmGraphWorker.ts'], blocker: '' },
    });
    const ctx = await buildGroundedTaskLedgerContext(
      { userText: 'graph extraction worker', projectId: 'p', includeCodeGraph: true },
      { readThinkGraphRecords: okThinkGraph, buildGraphContext: buildGraphContext as any },
    );
    expect(buildGraphContext).toHaveBeenCalledTimes(1);
    expect(ctx.codeGraph?.ok).toBe(true);
    expect(ctx.codeGraph?.relevantFiles[0].path).toContain('slmGraphWorker.ts');
  });

  it('does not fake success when CodeGraph is requested but unavailable', async () => {
    const buildGraphContext = vi.fn().mockResolvedValue({
      codeGraphContext: { relevantFiles: [], blocker: 'cbm_index_not_ready' },
    });
    const ctx = await buildGroundedTaskLedgerContext(
      { userText: 'x', projectId: 'p', includeCodeGraph: true },
      { readThinkGraphRecords: okThinkGraph, buildGraphContext: buildGraphContext as any },
    );
    expect(ctx.codeGraph?.ok).toBe(false);
    expect(ctx.codeGraph?.blocker).toBe('cbm_index_not_ready');
    expect(ctx.warnings.some((w) => w.includes('cbm_index_not_ready'))).toBe(true);
  });

  it('returns honest unavailable when ThinkGraph read fails (no throw, no fake)', async () => {
    const ctx = await buildGroundedTaskLedgerContext(
      { userText: 'x', projectId: 'p' },
      { readThinkGraphRecords: async () => ({ ok: false, reason: 'age_query_failed', error: 'ECONNREFUSED' }) },
    );
    expect(ctx.thinkGraph.ok).toBe(false);
    expect(ctx.thinkGraph.blocker).toContain('ECONNREFUSED');
    expect(ctx.warnings.some((w) => w.includes('thinkgraph_unavailable'))).toBe(true);
  });

  it('warns honestly when a project has no accepted records yet (empty, not faked)', async () => {
    const ctx = await buildGroundedTaskLedgerContext(
      { userText: 'x', projectId: 'fresh-project' },
      { readThinkGraphRecords: async () => ({ ok: true, records: [] }) },
    );
    expect(ctx.thinkGraph.ok).toBe(true);
    expect(ctx.thinkGraph.facts).toHaveLength(0);
    expect(ctx.warnings).toContain('thinkgraph_no_accepted_records_for_project');
  });

  it('renders a prompt-safe grounding directive that keeps the graphPayload contract intact', async () => {
    const ctx = await buildGroundedTaskLedgerContext(
      { userText: 'x', projectId: 'p' },
      { readThinkGraphRecords: okThinkGraph },
    );
    const rendered = renderTaskLedgerGroundingDirective(ctx);
    expect(rendered).toMatch(/READ it before creating tasks/i);
    expect(rendered).toMatch(/Do not invent repo files, completed proof, or graph facts/i);
    expect(rendered).toMatch(/graphPayload output contract intact/i);
    expect(rendered).toContain('graphGroundingContext');
    expect(rendered).toContain('Redwire Corporation');
    expect(rendered.toLowerCase()).not.toContain('draft');
  });
});
