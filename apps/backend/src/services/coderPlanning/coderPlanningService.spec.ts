import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../thinkgraph/thinkgraphMemory', () => ({
  readThinkGraphContextPacket: vi.fn(),
  recordThinkGraphEvent: vi.fn(),
}));

import { recordThinkGraphEvent } from '../thinkgraph/thinkgraphMemory';
import {
  assembleCoderContextPacket,
  persistCoderRunOutcome,
  prepareActiveCoderPacket,
  resolveCoderPlannerConfig,
} from './coderPlanningService';

const recordEvent = vi.mocked(recordThinkGraphEvent);

const thinkGraphPacket = {
  packet_version: 1 as const,
  source: 'thinkgraph' as const,
  project_id: 'project-1',
  planflow_nodes: ['planflow:route:plan-md'],
  recent_events: [],
  active_decisions: [],
  assumptions: [],
  open_questions: [],
  last_runs: [],
  next_task: 'Wire PlanFlow.',
  warnings: [],
};

const graphContextPacket = {
  projectId: 'project-1',
  requestId: null,
  turnId: null,
  selectedBoardContext: {
    selectedNodeIds: [],
    selectedEdgeIds: [],
    selectedCardId: null,
    selectedCardTitle: null,
    selectedObjectId: null,
    selectedObjectType: null,
    selectedObjectTitle: null,
    activeSurface: null,
    activeWorkbench: null,
    references: [],
  },
  thinkGraphContext: {
    intent: [],
    assumptions: [],
    hypotheses: [],
    uncertainties: [],
    goals: [],
    decisions: [],
    outcomes: [],
    reasoningNotes: [],
    confidenceNotes: [],
  },
  knowGraphContext: {
    entities: [],
    relations: [],
    evidence: [],
    sources: [],
    citations: [],
    provenance: [],
    confidence: [],
    timestamps: [],
  },
  codeGraphContext: {
    relevantFiles: ['client/src/features/agentbuilder/plan/ActiveCoderJobPanel.tsx'],
    relevantSymbols: [
      'C-Projects-main.client.src.features.agentbuilder.plan.ActiveCoderJobPanel.ActiveCoderJobPanel',
    ],
    codeAnchors: ['client/src/features/agentbuilder/plan/ActiveCoderJobPanel.tsx'],
    cbmQueries: ['search_graph query="Connect Context Packet to PlanFlow."'],
    components: ['ActiveCoderJobPanel'],
    routes: ['/api/coder/localcoder/run'],
    schemas: ['CoderPacket'],
    tools: ['search_graph'],
    agentCards: ['card_magentic'],
    promptTemplates: [],
    implementationNotes: ['Fresh CodeGraph service result.'],
    freshness: {
      status: 'fresh',
      project: 'C-Projects-main',
      nodes: 4640,
      edges: 8596,
      checkedAt: '2026-06-13T00:00:00.000Z',
      detail: 'cbm_fresh: indexed graph matches tracked HEAD changes',
    },
    blocker: null,
  },
  comparison: {
    congruence: [],
    conflicts: [],
    missingEvidence: [],
    confidenceGaps: [],
    staleContextWarnings: [],
  },
  provenance: {
    generatedAt: '2026-06-13T00:00:00.000Z',
    sourceLabels: ['ThinkGraph', 'CodeGraph'],
    debugNotes: [],
    packetVersion: 'stage0.v1',
    sourceDiagnostics: [
      {
        source: 'graph_thinkgraph' as const,
        critical: false,
        status: 'empty' as const,
        elapsedMs: 1,
        evidenceCount: 0,
        summary: 'graph_thinkgraph returned 0 evidence item(s)',
        blocker: '',
      },
      {
        source: 'knowgraph' as const,
        critical: false,
        status: 'empty' as const,
        elapsedMs: 1,
        evidenceCount: 0,
        summary: 'knowgraph returned 0 evidence item(s)',
        blocker: '',
      },
      {
        source: 'codegraph_cbm' as const,
        critical: true,
        status: 'ok' as const,
        elapsedMs: 2,
        evidenceCount: 3,
        summary: 'codegraph_cbm returned 3 evidence item(s)',
        blocker: '',
      },
    ],
  },
};

const generatedPacket = {
  id: 'planner-id',
  projectId: 'planner-project',
  repoPath: '/planner/repo',
  objective: 'Connect Context Packet to PlanFlow.',
  planExcerpt: 'Planner excerpt.',
  contextSummary: 'Real sources assembled.',
  codeAnchors: ['invented.ts'],
  cbmQueries: ['invented query'],
  guardrails: ['Keep work bounded.'],
  allowedFiles: ['apps/backend/src/services/coderPlanning/**'],
  forbiddenWork: ['Do not broaden scope.'],
  proofRequired: ['Run focused tests.'],
  reportFormat: 'CoderReport JSON',
  stopConditions: ['Stop after one job.'],
  writeMode: 'edit' as const,
};

function deps() {
  return {
    now: () => '2026-06-13T00:00:00.000Z',
    repoRoot: 'C:\\Projects\\main',
    readPlan: vi.fn(async () => '# Plan\nUse `PLAN.md` and `apps/backend/src/routes/coder.routes.ts`.'),
    readThinkGraph: vi.fn(async () => thinkGraphPacket),
    buildGraphContext: vi.fn(async () => graphContextPacket),
    readSkillContext: vi.fn(async () => ({
      source: 'skillgraph_neo4j' as const,
      skills: [
        {
          id: 'context-packet',
          sourcePath: 'skills/context-packet-skill.md',
          guardrails: ['Never invent context.'],
          queryPatterns: ['search_graph query="Context Packet"'],
        },
      ],
      warnings: [],
    })),
  };
}

function plannerProvenance(contextSources: string[] = ['PLAN.md']) {
  return {
    source: 'backend_planning_service' as const,
    provider: 'openai',
    model: 'gpt-5',
    configSource: 'SOL_CODER_PLANNER_MODEL_KEY',
    contextSources,
  };
}

describe('coder planning service', () => {
  beforeEach(() => {
    recordEvent.mockReset();
    recordEvent.mockResolvedValue({ id: 'event-1', ts: '2026-06-13T00:00:00.000Z' });
  });

  it('assembles real PLAN.md, ThinkGraph, SkillGraph, and CodeGraph inputs', async () => {
    const testDeps = deps();
    const { contextPacket } = await assembleCoderContextPacket(
      {
        projectId: 'project-1',
        userInput: 'Connect Context Packet to PlanFlow.',
        planFlowState: { magenticRunId: 'run-1' },
      },
      testDeps,
    );

    expect(testDeps.readPlan).toHaveBeenCalled();
    expect(testDeps.readThinkGraph).toHaveBeenCalledWith('project-1', 20);
    expect(testDeps.readSkillContext).toHaveBeenCalledWith('Connect Context Packet to PlanFlow.');
    expect(contextPacket.planExcerpt).toContain('PLAN.md');
    expect(contextPacket.thinkGraphContext).toMatchObject({ next_task: 'Wire PlanFlow.' });
    expect(contextPacket.skillContext).toMatchObject({ source: 'skillgraph_neo4j' });
    expect(contextPacket.codeAnchors).toContain(
      'client/src/features/agentbuilder/plan/ActiveCoderJobPanel.tsx',
    );
    expect(contextPacket.cbmQueries).toContain('search_graph query="Context Packet"');
    expect(contextPacket.provenance.sources).toContain('CodeGraph/Codebase Memory MCP');
    expect(contextPacket.sourceDiagnostics.map((item) => item.source)).toEqual(
      expect.arrayContaining([
        'plan_md',
        'thinkgraph',
        'skillgraph',
        'graph_context',
        'codegraph_cbm',
        'planflow_state',
        'selected_context',
      ]),
    );
  });

  it('blocks loudly when no explicit planner configuration exists', () => {
    expect(() => resolveCoderPlannerConfig({})).toThrow(
      'coder_planner_model_missing: accepted options: SOL_CODER_PLANNER_MODEL_KEY; SOL_CODER_PLANNER_PROVIDER plus SOL_CODER_PLANNER_MODEL_ID; or explicit SOL_PRIMARY=openai|openrouter with its matching provider API key',
    );
  });

  it('accepts each explicit planner configuration path', () => {
    expect(resolveCoderPlannerConfig({ SOL_CODER_PLANNER_MODEL_KEY: 'gpt-5' })).toEqual({
      modelKey: 'gpt-5',
      configSource: 'SOL_CODER_PLANNER_MODEL_KEY',
    });
    expect(
      resolveCoderPlannerConfig({
        SOL_CODER_PLANNER_PROVIDER: 'openrouter',
        SOL_CODER_PLANNER_MODEL_ID: 'openai/gpt-5.1-chat',
      }),
    ).toEqual({
      provider: 'openrouter',
      providerModelId: 'openai/gpt-5.1-chat',
      configSource: 'SOL_CODER_PLANNER_PROVIDER+SOL_CODER_PLANNER_MODEL_ID',
    });
    expect(
      resolveCoderPlannerConfig({
        SOL_PRIMARY: 'openai',
        OPENAI_API_KEY: 'configured-for-test',
      }),
    ).toEqual({
      provider: 'openai',
      providerModelId: 'gpt-5.1-chat-latest',
      configSource: 'SOL_PRIMARY',
    });
  });

  it('validates one generated active packet, keeps trusted anchors, and adds tasking instruction', async () => {
    const persistPacket = vi.fn(async () => undefined);
    const generatePacket = vi.fn(async (contextPacket) => ({
      packet: generatedPacket,
      provenance: plannerProvenance(contextPacket.provenance.sources),
    }));

    const result = await prepareActiveCoderPacket(
      {
        projectId: 'project-1',
        userInput: 'Connect Context Packet to PlanFlow.',
      },
      { ...deps(), generatePacket, persistPacket },
    );

    expect(result.packet.projectId).toBe('project-1');
    expect(result.packet.repoPath).toBe('C:\\Projects\\main');
    expect(result.packet.codeAnchors).not.toContain('invented.ts');
    expect(result.packet.reportFormat).toContain('bounded task list');
    expect(result.packet.reportFormat).toContain('task-by-task CoderReport');
    expect(persistPacket).toHaveBeenCalledWith(
      result.packet,
      result.contextPacket,
      result.plannerProvenance,
    );
  });



  it('records a visible CBM blocker in the CoderPacket instead of inventing anchors', async () => {
    const blockedContext = {
      ...graphContextPacket,
      codeGraphContext: {
        ...graphContextPacket.codeGraphContext,
        relevantFiles: [],
        relevantSymbols: [],
        codeAnchors: [],
        freshness: {
          ...graphContextPacket.codeGraphContext.freshness,
          status: 'unavailable',
          detail: 'cbm_unavailable: stdio server offline',
        },
        blocker: 'cbm_unavailable: stdio server offline',
      },
      provenance: {
        ...graphContextPacket.provenance,
        debugNotes: ['cbm_unavailable: stdio server offline'],
      },
    };
    const result = await prepareActiveCoderPacket(
      { projectId: 'project-1', userInput: 'Connect Context Packet to PlanFlow.' },
      {
        ...deps(),
        buildGraphContext: vi.fn(async () => blockedContext),
        generatePacket: async () => ({
          packet: generatedPacket,
          provenance: plannerProvenance(['CodeGraph/Codebase Memory MCP']),
        }),
        persistPacket: async () => undefined,
      },
    );

    expect(result.packet.codeAnchors).toEqual([]);
    expect(result.packet.contextSummary).toContain('CBM blocker: cbm_unavailable');
    expect(result.packet.guardrails).toContain('CBM blocker: cbm_unavailable: stdio server offline');
  });

  it('persists packet context evidence and CBM freshness to ThinkGraph', async () => {
    await prepareActiveCoderPacket(
      { projectId: 'project-1', userInput: 'Connect Context Packet to PlanFlow.' },
      {
        ...deps(),
        generatePacket: async (contextPacket) => ({
          packet: generatedPacket,
          provenance: plannerProvenance(contextPacket.provenance.sources),
        }),
      },
    );

    expect(recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'coder_packet_created',
        projectId: 'project-1',
        coderPacketObjective: 'Connect Context Packet to PlanFlow.',
        cbmStatus: 'fresh',
        codeAnchors: ['client/src/features/agentbuilder/plan/ActiveCoderJobPanel.tsx'],
        contextEvidenceSummary: expect.arrayContaining([
          'CBM status: fresh',
          'CBM graph: 4640 nodes / 8596 edges',
        ]),
        sourceDiagnosticsSummary: expect.arrayContaining([
          expect.stringContaining('codegraph_cbm: ok'),
        ]),
        plannerProvider: 'openai',
        plannerModel: 'gpt-5',
        plannerConfigSource: 'SOL_CODER_PLANNER_MODEL_KEY',
      }),
    );
  });

  it('continues after a bounded non-critical timeout and adds visible packet guardrails', async () => {
    const startedAt = Date.now();
    const result = await prepareActiveCoderPacket(
      { projectId: 'project-1', userInput: 'Connect Context Packet to PlanFlow.' },
      {
        ...deps(),
        sourceTimeoutMs: { thinkgraph: 10 },
        readThinkGraph: () => new Promise(() => undefined),
        generatePacket: async (contextPacket) => ({
          packet: generatedPacket,
          provenance: plannerProvenance(contextPacket.provenance.sources),
        }),
        persistPacket: async () => undefined,
      },
    );

    expect(Date.now() - startedAt).toBeLessThan(500);
    expect(result.contextPacket.sourceDiagnostics).toContainEqual(
      expect.objectContaining({ source: 'thinkgraph', status: 'timed_out', critical: false }),
    );
    expect(result.contextPacket.provenance.warnings).toContainEqual(
      expect.stringContaining('context_source_timed_out: thinkgraph'),
    );
    expect(result.packet.guardrails).toContainEqual(
      expect.stringContaining('Context source blocker: thinkgraph timed_out'),
    );
  });

  it('blocks when critical PLAN.md context times out', async () => {
    await expect(
      assembleCoderContextPacket(
        { projectId: 'project-1', userInput: 'Connect Context Packet to PlanFlow.' },
        {
          ...deps(),
          sourceTimeoutMs: { plan_md: 10 },
          readPlan: () => new Promise(() => undefined),
        },
      ),
    ).rejects.toThrow(
      'context_packet_critical_source_blocked: plan_md: source_timeout:plan_md:10ms',
    );
  });

  it('blocks when the critical CBM source diagnostic reports a timeout', async () => {
    const timedOutGraphContext = {
      ...graphContextPacket,
      provenance: {
        ...graphContextPacket.provenance,
        sourceDiagnostics: graphContextPacket.provenance.sourceDiagnostics.map((diagnostic) =>
          diagnostic.source === 'codegraph_cbm'
            ? {
                ...diagnostic,
                status: 'timed_out' as const,
                evidenceCount: 0,
                summary: 'source_timeout:codegraph_cbm:10ms',
                blocker: 'source_timeout:codegraph_cbm:10ms',
              }
            : diagnostic,
        ),
      },
    };

    await expect(
      assembleCoderContextPacket(
        { projectId: 'project-1', userInput: 'Connect Context Packet to PlanFlow.' },
        {
          ...deps(),
          buildGraphContext: async () => timedOutGraphContext,
        },
      ),
    ).rejects.toThrow(
      'context_packet_critical_source_blocked: codegraph_cbm: source_timeout:codegraph_cbm:10ms',
    );
  });

  it('persists summarized packet/report reconciliation to ThinkGraph', async () => {
    await persistCoderRunOutcome({
      packet: { ...generatedPacket, id: 'packet-1', projectId: 'project-1' },
      report: {
        coderPacketId: 'packet-1',
        status: 'partial',
        summary: 'One requirement remains blocked.',
        specComparison: [],
        filesChanged: ['client/src/features/agentbuilder/plan/ActiveCoderJobPanel.tsx'],
        proofCommands: ['npm test'],
        proofResults: [{ command: 'npm test', status: 'passed', output: 'passed' }],
        failedCommands: [],
        blockers: ['CodeGraph backend unavailable'],
        assumptions: [],
        outOfScopeFindings: ['Unrelated UI issue'],
        nextRecommendedTask: 'Wire CodeGraph backend reader.',
        rawOutput: 'large raw output that must not be stored',
      },
      comparison: {
        completedRequirements: ['PlanFlow UI'],
        incompleteRequirements: ['CodeGraph reader'],
        blockedRequirements: ['Fresh CBM context'],
        changedRequirements: [],
        outOfScopeFindings: ['Unrelated UI issue'],
        nextNarrowerFocus: 'Wire CodeGraph backend reader.',
      },
    });

    expect(recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'coder_report_recorded',
        coderPacketId: 'packet-1',
        coderReportStatus: 'partial',
        completedRequirements: ['PlanFlow UI'],
        blockedRequirements: ['Fresh CBM context'],
        proofSummary: ['passed: npm test: passed'],
        nextTask: 'Wire CodeGraph backend reader.',
      }),
    );
    expect(JSON.stringify(recordEvent.mock.calls[0]?.[0])).not.toContain('large raw output');
  });
});
