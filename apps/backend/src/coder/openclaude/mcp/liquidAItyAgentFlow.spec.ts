import { describe, expect, it, vi } from 'vitest';
import { join as pathJoin } from 'node:path';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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

function packet(over: Record<string, unknown> = {}) {
  return {
    version: 'run_packet_v0' as const,
    preparedBy: 'hermes' as const,
    parentRunId: 'req_parent',
    projectId: 'project-1',
    deckId: 'deck_builder',
    conversationId: 'main',
    route: 'mag_one' as const,
    userRequest: 'Do the work — exactly.',
    objective: 'Do the work — exactly.',
    contextSummary: 'ThinkGraph was read.',
    graphContext: { thinkGraph: 'available' as const, knowGraph: 'not_consulted' as const, codeGraph: 'not_consulted' as const },
    connectedParticipants: ['card_research'],
    disconnectedExclusions: ['card_lonely'],
    proofRequirements: ['Return real evidence.'],
    expectedVisibleOutput: 'A grounded answer.',
    noFallbackRules: ['Report failures honestly.'],
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

describe('runMagOne — regular native Mag One from one Hermes RunPacket', () => {
  it('validates the packet, links the parent run, and passes its UTF-8 JSON to Mag One', async () => {
    const runCard = vi.fn(async () => ({ output: 'Mission complete.', status: 'success' }));
    const runPacket = packet();
    const result = await runMagOne(
      { runPacket },
      deps({ runCard: runCard as any }),
    );

    expect(runCard).toHaveBeenCalledTimes(1);
    expect(runCard.mock.calls[0][2]).toBe(JSON.stringify(runPacket));
    expect(runCard.mock.calls[0][2]).toContain('—');
    // No approval / plan / taskIds thread into the run context.
    const ctxArg = runCard.mock.calls[0][3] as Record<string, unknown>;
    expect('runApproved' in ctxArg).toBe(false);
    expect('plan' in ctxArg).toBe(false);
    expect('taskIds' in ctxArg).toBe(false);

    expect(result.status).toBe('completed');
    expect(result.finalText).toBe('Mission complete.');
    expect(result.failure).toBeNull();
    expect(result.parentRunId).toBe('req_parent');
    expect(result.conversationId).toBe('main');
    // No taskUpdates / needsInput / artifacts wrapper on the result.
    const raw = JSON.stringify(result);
    for (const gone of ['taskUpdates', 'needsInput', 'artifacts', 'evidence']) {
      expect(raw).not.toContain(gone);
    }
  });

  it('returns an honest failure when the run errors — no retry, no fallback', async () => {
    const result = await runMagOne(
      { runPacket: packet() },
      deps({ runCard: vi.fn(async () => ({ output: '', status: 'error', error: 'autogen_rails_unavailable' })) as any }),
    );
    expect(result.status).toBe('failed');
    expect(result.failure).toBe('autogen_rails_unavailable');
  });

  it('rejects a missing/invalid packet, a non-team route, stale participants, and a missing orchestrator', async () => {
    await expect(
      runMagOne({}, deps()),
    ).rejects.toThrow(/run_mag_one_invalid_run_packet/);
    await expect(
      runMagOne({ runPacket: packet({ route: 'direct' }) as any }, deps()),
    ).rejects.toThrow(/run_mag_one_route_mismatch/);
    await expect(
      runMagOne({ runPacket: packet({ connectedParticipants: ['card_other'] }) }, deps()),
    ).rejects.toThrow(/run_mag_one_stale_participants/);
    await expect(
      runMagOne(
        { runPacket: packet() },
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

  it('jobId wins over runPacket (the on-disk file is the contract)', async () => {
    const runCard = vi.fn(async () => ({ output: 'ok', status: 'success' }));
    await runMagOne(
      { projectId: 'project-1', deckId: 'deck_builder', jobId: 'job_x', runPacket: packet() },
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

describe('runMagOne — dev telemetry at the dispatch boundary', () => {
  it('records started + completed events with participants and real calledAgents', async () => {
    const { clearAgentEvents, listAgentEvents } = await import('../../../services/agentTelemetry');
    clearAgentEvents();
    const runCard = vi.fn(async () => ({
      status: 'success',
      output: 'team answer',
      magenticTrace: {
        plan: {
          autogenMessages: [
            { source: 'user', type: 'TextMessage', content: 'task' },
            { source: 'Research Agent', type: 'TextMessage', content: 'finding' },
          ],
        },
      },
    }));
    await runMagOne(
      { runPacket: packet() },
      deps({ runCard: runCard as any }),
    );
    const events = listAgentEvents().filter((e) => e.stage === 'mag_one_dispatch');
    expect(events.map((e) => e.status)).toEqual(['started', 'completed']);
    expect(events[1]).toMatchObject({
      mode: 'real_model_call',
      cardId: 'card_magentic',
      conversationId: 'main',
      metadata: {
        connectedParticipants: ['card_research'],
        parentRunId: 'req_parent',
        calledAgents: ['Research Agent'],
      },
    });
    expect(events[1].correlationId).toMatch(/^mag_one_run_/);
    clearAgentEvents();
  });

  it('records a failed dispatch event when the run throws', async () => {
    const { clearAgentEvents, listAgentEvents } = await import('../../../services/agentTelemetry');
    clearAgentEvents();
    await expect(
      runMagOne(
        { runPacket: packet() },
        deps({ runCard: vi.fn(async () => { throw new Error('rails down'); }) as any }),
      ),
    ).rejects.toThrow('rails down');
    const events = listAgentEvents().filter((e) => e.stage === 'mag_one_dispatch');
    expect(events.map((e) => e.status)).toEqual(['started', 'failed']);
    expect(events[1].errorSummary).toBe('rails down');
    clearAgentEvents();
  });
});
