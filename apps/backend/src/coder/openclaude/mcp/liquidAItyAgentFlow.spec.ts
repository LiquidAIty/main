import { describe, expect, it, vi } from 'vitest';
import { join as pathJoin } from 'node:path';
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
// Type-only import of the canonical runCard signature so the vi.fn mocks below
// capture the real 4-arg call shape (card, effectiveAgent, input, context) —
// otherwise mock.calls is typed as [][] and tuple indexing fails truthfully.
import type { runCardWithContract } from '../../../cards/runtime';
import {
  describeConnectedAgents,
  runMagOne,
  type AgentFlowDeps,
} from './liquidAItyAgentFlow';

const DECK = {
  id: 'deck_builder',
  name: 'Builder Deck',
  nodes: [
    { id: 'card_magentic', kind: 'agent', runtimeType: 'magentic_one', title: 'Mag One' },
    { id: 'card_main_chat', kind: 'agent', runtimeType: 'assistant_agent', runtimeBinding: 'main_chat', title: 'Main' },
    {
      id: 'card_research',
      kind: 'agent',
      runtimeType: 'assistant_agent',
      title: 'Research Agent',
      runtimeOptions: { modelKey: 'gpt-5.1', provider: 'openai', tools: ['current_datetime'] },
    },
    { id: 'card_lonely', kind: 'agent', runtimeType: 'assistant_agent', title: 'Disconnected' },
  ],
  edges: [
    { id: 'control', source: 'card_main_chat', target: 'card_magentic', targetHandle: 'task-bus-top', edgeType: 'magentic_control' },
    { id: 'e1', source: 'card_magentic', target: 'card_research', edgeType: 'magentic_option' },
  ],
};

function deps(over: Partial<AgentFlowDeps> = {}): AgentFlowDeps {
  return {
    loadDeck: vi.fn(async () => ({ deck: DECK, latestRun: null, runs: [], meta: {} })) as any,
    runCard: vi.fn() as any,
    // Most routing tests do not materialize a workspace. Production uses the
    // default atomic prompt claim; these tests focus on the downstream seam.
    claimJob: vi.fn(() => ({ claimed: true })),
    ...over,
  };
}

describe('describeConnectedAgents (mag_one.describe_connected_agents)', () => {
  it('reports only the connected, bus-eligible agents + real capabilities — no visible-flow fields', async () => {
    const result = await describeConnectedAgents({ projectId: 'project-1', deckId: 'deck_builder' }, deps());
    expect(result.orchestratorCardId).toBe('card_magentic');
    expect(result.connectedAgents).toEqual([
      {
        cardId: 'card_research',
        title: 'Research Agent',
        model: { modelKey: 'gpt-5.1', provider: 'openai' },
        tools: ['current_datetime'],
        connected: true,
      },
    ]);
    // No old visible-flow / plan / mission fields leak into the result.
    const raw = JSON.stringify(result);
    for (const gone of ['graphReadScopes', 'requiredInputs', 'constraints', 'expectedArtifacts', 'needsInputConditions', 'graphWritePolicy', 'visibleFlows', 'activePlanSummary', 'taskLedger']) {
      expect(raw).not.toContain(gone);
    }
  });

  it('returns an empty connected-agent list when nothing is on the bus', async () => {
    // Orchestrator present but no magentic_option edges -> nothing bus-eligible.
    const busLessDeck = { id: 'deck_builder', name: 'Builder Deck', nodes: [DECK.nodes[0]], edges: [] };
    const result = await describeConnectedAgents(
      { projectId: 'project-1', deckId: 'deck_builder' },
      deps({ loadDeck: vi.fn(async () => ({ deck: busLessDeck, latestRun: null, runs: [], meta: {} })) as any }),
    );
    expect(result.connectedAgents).toEqual([]);
    expect(result.orchestratorCardId).toBe('card_magentic');
  });

  it('throws honestly when the deck is missing', async () => {
    await expect(
      describeConnectedAgents(
        { projectId: 'project-1', deckId: 'deck_builder' },
        deps({ loadDeck: vi.fn(async () => ({ deck: null, latestRun: null, runs: [], meta: {} })) as any }),
      ),
    ).rejects.toThrow(/describe_connected_agents_deck_not_found/);
  });
});

describe('runMagOne — canonical job-folder handoff', () => {
  it('uses job identity and passes no semantic task through TypeScript', async () => {
    const runCard = vi.fn<typeof runCardWithContract>(async () => ({
      output: 'Mission complete.',
      status: 'success',
      startedAt: '2026-07-01T00:00:00.000Z',
      endedAt: '2026-07-01T00:00:01.000Z',
    }));
    const result = await runMagOne(
      { projectId: 'project-1', deckId: 'deck_builder', conversationId: 'main', jobId: 'job_abc' },
      deps({ runCard: runCard as any }),
    );
    expect(runCard).toHaveBeenCalledTimes(1);
    expect(runCard.mock.calls[0][2]).toBe('');
    expect((runCard.mock.calls[0][3] as any).jobHandoff.jobId).toBe('job_abc');
    expect(result.status).toBe('completed');
    expect(result.finalText).toBe('Mission complete.');
    expect(result.jobId).toBe('job_abc');
    expect(result.conversationId).toBe('main');
  });

  it('returns an honest failure when the run errors — no retry or fallback', async () => {
    const result = await runMagOne(
      { projectId: 'project-1', deckId: 'deck_builder', jobId: 'job_abc' },
      deps({ runCard: vi.fn(async () => ({ output: '', status: 'error', error: 'autogen_rails_unavailable' })) as any }),
    );
    expect(result.status).toBe('failed');
    expect(result.failure).toBe('autogen_rails_unavailable');
  });

  it('requires the canonical job identity and rejects a missing orchestrator', async () => {
    await expect(runMagOne({ projectId: 'project-1', deckId: 'deck_builder', jobId: '' }, deps())).rejects.toThrow(
      /run_mag_one_missing_job_identity/,
    );
    await expect(
      runMagOne(
        { projectId: 'project-1', deckId: 'deck_builder', jobId: 'job_abc' },
        deps({ loadDeck: vi.fn(async () => ({ deck: { id: 'd', name: 'x', nodes: [], edges: [] }, latestRun: null, runs: [], meta: {} })) as any }),
      ),
    ).rejects.toThrow(/run_mag_one_no_orchestrator_card/);
  });

  it('fails closed without exactly one live Main magentic_control edge', async () => {
    const deckWithoutControl = { ...DECK, edges: DECK.edges.filter((edge) => edge.edgeType !== 'magentic_control') };
    await expect(runMagOne(
      { projectId: 'project-1', deckId: 'deck_builder', jobId: 'job_abc' },
      deps({ loadDeck: vi.fn(async () => ({ deck: deckWithoutControl, latestRun: null, runs: [], meta: {} })) as any }),
    )).rejects.toThrow(/run_mag_one_main_control_not_authorized/);
  });
});

describe('runMagOne — Coder job-folder handoff (jobId)', () => {
  it('fails closed when prompt.md is absent and never dispatches Mag One', async () => {
    const root = mkdtempSync(pathJoin(tmpdir(), 'liq-magone-no-prompt-'));
    const previous = process.env.LIQUIDAITY_GRPC_CWD;
    process.env.LIQUIDAITY_GRPC_CWD = root;
    const runCard = vi.fn(async () => ({ output: 'should not run', status: 'success' }));
    try {
      const result = await runMagOne(
        { projectId: 'project-1', deckId: 'deck_builder', jobId: 'job_missing_prompt' },
        deps({ runCard: runCard as any, claimJob: undefined }),
      );
      expect(result.status).toBe('failed');
      expect(result.failure).toBe('mag_one_prompt_missing');
      expect(runCard).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) delete process.env.LIQUIDAITY_GRPC_CWD;
      else process.env.LIQUIDAITY_GRPC_CWD = previous;
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('claims a finalized prompt atomically so duplicate arrival events and restarts do not relaunch it', async () => {
    const root = mkdtempSync(pathJoin(tmpdir(), 'liq-magone-claim-'));
    const previous = process.env.LIQUIDAITY_GRPC_CWD;
    process.env.LIQUIDAITY_GRPC_CWD = root;
    try {
      const promptDir = pathJoin(root, 'coder-workspace', 'handoff', 'job_once');
      mkdirSync(promptDir, { recursive: true });
      writeFileSync(pathJoin(promptDir, 'prompt.md'), 'final Main Chat instruction', 'utf8');
      const runCard = vi.fn(async () => ({ output: 'done', status: 'success' }));
      const first = await runMagOne(
        { projectId: 'project-1', deckId: 'deck_builder', jobId: 'job_once' },
        deps({ runCard: runCard as any, claimJob: undefined }),
      );
      const second = await runMagOne(
        { projectId: 'project-1', deckId: 'deck_builder', jobId: 'job_once' },
        deps({ runCard: runCard as any, claimJob: undefined }),
      );
      expect(first.status).toBe('completed');
      expect(second.status).toBe('failed');
      expect(second.failure).toBe('mag_one_job_already_claimed');
      expect(runCard).toHaveBeenCalledTimes(1);
      expect(existsSync(pathJoin(promptDir, 'mag-one.claim.json'))).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.LIQUIDAITY_GRPC_CWD;
      else process.env.LIQUIDAITY_GRPC_CWD = previous;
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('runs from a jobId with the server-forced workspace root (never a client path) and empty inline task', async () => {
    const runCard = vi.fn<typeof runCardWithContract>(async () => ({
      output: 'done',
      status: 'success',
      startedAt: '2026-07-01T00:00:00.000Z',
      endedAt: '2026-07-01T00:00:01.000Z',
      jobHandoffResult: {
        returnsDir: 'returns/job_abc/',
        returnedFiles: ['returns/job_abc/proposed/example.patch'],
        returnStatus: 'return_files_created',
      },
    }));
    // A bogus client-supplied workspaceRoot must be ignored — RunMagOneInput has
    // no such field, so the trusted server root is always used.
    const result = await runMagOne(
      { projectId: 'project-1', deckId: 'deck_builder', jobId: 'job_abc', workspaceRoot: '/evil' } as any,
      deps({ runCard: runCard as any }),
    );

    // The task passed to Mag One is empty — Python reads the prompt.md variable context packet.
    expect(runCard.mock.calls[0][2]).toBe('');
    const ctxArg = runCard.mock.calls[0][3] as any;
    // The trusted job-folder root is the default owned Coder workspace
    // (<repo-root>/coder-workspace), never a client path.
    const forcedRoot = pathJoin(process.env.LIQUIDAITY_GRPC_CWD || 'C:/Projects/main', 'coder-workspace');
    expect(ctxArg.jobHandoff).toEqual({ workspaceRoot: forcedRoot, jobId: 'job_abc' });
    expect(ctxArg.jobHandoff.workspaceRoot).not.toBe('/evil');
    expect(ctxArg.jobHandoff.workspaceRoot).toContain('coder-workspace');

    // The returns surface + written files are threaded back to the Coder result.
    expect(result.status).toBe('completed');
    expect(result.jobId).toBe('job_abc');
    expect(result.returnsDir).toBe('returns/job_abc/');
    expect(result.returnedFiles).toEqual(['returns/job_abc/proposed/example.patch']);
    expect(result.returnStatus).toBe('return_files_created');
  });

  it('uses the on-disk file as the only semantic contract', async () => {
    const runCard = vi.fn<typeof runCardWithContract>(async () => ({
      output: 'ok',
      status: 'success',
      startedAt: '2026-07-01T00:00:00.000Z',
      endedAt: '2026-07-01T00:00:01.000Z',
    }));
    await runMagOne(
      { projectId: 'project-1', deckId: 'deck_builder', jobId: 'job_x' },
      deps({ runCard: runCard as any }),
    );
    expect(runCard.mock.calls[0][2]).toBe('');
    expect((runCard.mock.calls[0][3] as any).jobHandoff).toEqual({
      workspaceRoot: pathJoin(process.env.LIQUIDAITY_GRPC_CWD || 'C:/Projects/main', 'coder-workspace'),
      jobId: 'job_x',
    });
  });

  it('reports an empty return folder honestly (no_return_files_created), never a fake file', async () => {
    const runCard = vi.fn(async () => ({
      output: 'done',
      status: 'success',
      jobHandoffResult: { returnsDir: 'returns/job_empty/', returnedFiles: [], returnStatus: 'no_return_files_created' },
    }));
    const result = await runMagOne(
      { projectId: 'project-1', deckId: 'deck_builder', jobId: 'job_empty' },
      deps({ runCard: runCard as any }),
    );
    expect(result.returnStatus).toBe('no_return_files_created');
    expect(result.returnedFiles).toEqual([]);
    expect(result.returnsDir).toBe('returns/job_empty/');
    expect(JSON.stringify(result)).not.toContain('result.md');
  });

  it('returns partial artifact metadata when Python aborts after a handoff artifact exists', async () => {
    const root = mkdtempSync(pathJoin(tmpdir(), 'liq-magone-artifact-'));
    const previous = process.env.LIQUIDAITY_GRPC_CWD;
    process.env.LIQUIDAITY_GRPC_CWD = root;
    try {
      const artifactDir = pathJoin(root, 'coder-workspace', 'returns', 'job_partial', 'card_plan_agent');
      mkdirSync(artifactDir, { recursive: true });
      writeFileSync(pathJoin(artifactDir, 'trading_intelligence_research_plan.md'), '# plan\n');
      const result = await runMagOne(
        { projectId: 'project-1', deckId: 'deck_builder', jobId: 'job_partial' },
        deps({ runCard: vi.fn(async () => { throw new Error('This operation was aborted'); }) as any }),
      );
      expect(result.status).toBe('partial');
      expect(result.failure).toBe('This operation was aborted');
      expect(result.returnsDir).toBe('returns/job_partial/');
      expect(result.returnStatus).toBe('return_files_created');
      expect(result.returnedFiles).toEqual([
        'returns/job_partial/card_plan_agent/trading_intelligence_research_plan.md',
      ]);
    } finally {
      if (previous === undefined) delete process.env.LIQUIDAITY_GRPC_CWD;
      else process.env.LIQUIDAITY_GRPC_CWD = previous;
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('returns a structured failure when Python aborts before any handoff artifact exists', async () => {
    const root = mkdtempSync(pathJoin(tmpdir(), 'liq-magone-empty-'));
    const previous = process.env.LIQUIDAITY_GRPC_CWD;
    process.env.LIQUIDAITY_GRPC_CWD = root;
    try {
      const result = await runMagOne(
        { projectId: 'project-1', deckId: 'deck_builder', jobId: 'job_empty_abort' },
        deps({ runCard: vi.fn(async () => { throw new Error('This operation was aborted'); }) as any }),
      );
      expect(result.status).toBe('failed');
      expect(result.failure).toBe('This operation was aborted');
      expect(result.returnsDir).toBe('returns/job_empty_abort/');
      expect(result.returnStatus).toBe('no_return_files_created');
      expect(result.returnedFiles).toEqual([]);
    } finally {
      if (previous === undefined) delete process.env.LIQUIDAITY_GRPC_CWD;
      else process.env.LIQUIDAITY_GRPC_CWD = previous;
      rmSync(root, { recursive: true, force: true });
    }
  });
});
