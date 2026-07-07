import { describe, expect, it, vi } from 'vitest';
import { join as pathJoin } from 'node:path';
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
    {
      id: 'card_research',
      kind: 'agent',
      runtimeType: 'assistant_agent',
      title: 'Research Agent',
      runtimeOptions: { modelKey: 'gpt-5.1', provider: 'openai', tools: ['current_datetime'] },
    },
    { id: 'card_lonely', kind: 'agent', runtimeType: 'assistant_agent', title: 'Disconnected' },
  ],
  edges: [{ id: 'e1', source: 'card_magentic', target: 'card_research', edgeType: 'magentic_option' }],
};

function deps(over: Partial<AgentFlowDeps> = {}): AgentFlowDeps {
  return {
    loadDeck: vi.fn(async () => ({ deck: DECK, latestRun: null, runs: [], meta: {} })) as any,
    runCard: vi.fn() as any,
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

describe('runMagOne — regular native Mag One from a Markdown prompt, no wrapper', () => {
  it('runs the orchestrator with the Markdown prompt verbatim as the task', async () => {
    const runCard = vi.fn(async () => ({ output: 'Mission complete.', status: 'success' }));
    const result = await runMagOne(
      { projectId: 'project-1', deckId: 'deck_builder', promptMarkdown: '# Objective\nDo the work.' },
      deps({ runCard: runCard as any }),
    );

    expect(runCard).toHaveBeenCalledTimes(1);
    // The task passed to Mag One is the Markdown prompt itself — never a rendered plan.
    expect(runCard.mock.calls[0][2]).toBe('# Objective\nDo the work.');
    // No approval / plan / taskIds thread into the run context.
    const ctxArg = runCard.mock.calls[0][3] as Record<string, unknown>;
    expect('runApproved' in ctxArg).toBe(false);
    expect('plan' in ctxArg).toBe(false);
    expect('taskIds' in ctxArg).toBe(false);

    expect(result.status).toBe('completed');
    expect(result.finalText).toBe('Mission complete.');
    expect(result.failure).toBeNull();
    // No taskUpdates / needsInput / artifacts wrapper on the result.
    const raw = JSON.stringify(result);
    for (const gone of ['taskUpdates', 'needsInput', 'artifacts', 'evidence']) {
      expect(raw).not.toContain(gone);
    }
  });

  it('returns an honest failure when the run errors — no retry, no fallback', async () => {
    const result = await runMagOne(
      { projectId: 'project-1', deckId: 'deck_builder', promptMarkdown: 'do it' },
      deps({ runCard: vi.fn(async () => ({ output: '', status: 'error', error: 'autogen_rails_unavailable' })) as any }),
    );
    expect(result.status).toBe('failed');
    expect(result.failure).toBe('autogen_rails_unavailable');
  });

  it('rejects a run with neither prompt nor jobId, and a missing orchestrator card', async () => {
    await expect(
      runMagOne({ projectId: 'project-1', deckId: 'deck_builder', promptMarkdown: '  ' }, deps()),
    ).rejects.toThrow(/run_mag_one_missing_input/);
    await expect(
      runMagOne(
        { projectId: 'project-1', deckId: 'deck_builder', promptMarkdown: 'x' },
        deps({ loadDeck: vi.fn(async () => ({ deck: { id: 'd', name: 'x', nodes: [], edges: [] }, latestRun: null, runs: [], meta: {} })) as any }),
      ),
    ).rejects.toThrow(/run_mag_one_no_orchestrator_card/);
  });
});

describe('runMagOne — Coder job-folder handoff (jobId)', () => {
  it('runs from a jobId with the server-forced workspace root (never a client path) and empty inline task', async () => {
    const runCard = vi.fn(async () => ({
      output: 'done',
      status: 'success',
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

    // The task passed to Mag One is empty — Python reads handoff/<jobId>/prompt.md.
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

  it('jobId wins over promptMarkdown (the on-disk file is the contract)', async () => {
    const runCard = vi.fn(async () => ({ output: 'ok', status: 'success' }));
    await runMagOne(
      { projectId: 'project-1', deckId: 'deck_builder', jobId: 'job_x', promptMarkdown: 'ignore me' },
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
});
