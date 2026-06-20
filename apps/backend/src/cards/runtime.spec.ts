import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { RUNTIME_TOOL_SPECS } from '../contracts/runtimeContracts';
import {
  MAG_ONE_CODING_RUN_SYSTEM_PROMPT,
  buildMagOneRoutingManifest,
  buildMagOneRoutingDiagnostics,
  resolvedMagenticOptions,
  buildPythonAutoGenCardRuntimePayload,
  runCardWithContract,
} from './runtime';

describe('Canonical Cards Runtime', () => {
  it('PLAN.md documents current dogfood root and future explicit external roots', () => {
    const plan = readFileSync(path.join(process.cwd(), 'PLAN.md'), 'utf8');
    expect(plan).toContain('`C:\\Projects\\main`');
    expect(plan).toContain('The same CoderPacket-in/CoderReport-out lifecycle will later target explicit external repo roots');
    expect(plan).toMatch(/vendored\r?\n`localcoder\/` runtime stays excluded from CBM/);
  });

  it('normal chat submit is planning only: no coding-intent participant gate, no coder dispatch', async () => {
    // Chat submit must not classify intent or impose a coding participant gate.
    // With no bus-connected agents it fails with the honest "no participants"
    // error — never the coder-console gate, and never a coder dispatch/timeout.
    const card = { id: 'mag1', kind: 'agent', runtimeType: 'magentic_one' };
    await expect(
      runCardWithContract(card, {}, 'can you do a code audit', { allCards: [card], allEdges: [] }),
    ).rejects.toThrow('magentic_runtime_no_current_bus_connected_participants');
    await expect(
      runCardWithContract(card, {}, 'can you do a code audit', { allCards: [card], allEdges: [] }),
    ).rejects.not.toThrow(/MAGONE_CODER_CONSOLE_BLOCKED_PARTICIPANT_GATE/);
  });

  it('chat submit builds no codingWorkflowPacket and does not classify intent as coding', () => {
    const mag = { id: 'mag', kind: 'agent', runtimeType: 'magentic_one', title: 'Magentic-One' };
    const coder = {
      id: 'coder', kind: 'agent', runtimeType: 'local_coder', runtimeBinding: 'local_coder',
      title: 'Local Coder', runtimeOptions: { modelKey: 'gpt-5-nano' },
    };
    const codegraph = {
      id: 'codegraph', kind: 'agent', runtimeType: 'assistant_agent', runtimeBinding: 'codegraph_agent',
      title: 'CodeGraph Agent', runtimeOptions: { modelKey: 'gpt-5-nano' },
    };
    const allCards = [mag, coder, codegraph];
    const allEdges = [coder, codegraph].map((agent) => ({
      id: `edge-${agent.id}`, source: agent.id, target: mag.id, edgeType: 'magentic_option',
    }));
    const callable = resolvedMagenticOptions(mag.id, allCards, allEdges);
    const payload = buildPythonAutoGenCardRuntimePayload(
      mag, {}, 'fix the code', { projectId: 'admin', deckId: 'deck', allCards, allEdges }, {}, callable, '2026',
    );

    // No TypeScript coder packet is ever attached to a planning turn.
    expect(payload.codingWorkflowPacket).toBeUndefined();
    // The capability manifest carries no intent/workflow classifier at all.
    expect((payload.routingManifest as any)?.intent).toBeUndefined();
    expect((payload.cardRuntime.runtimeScope?.routingDiagnostics as any)?.workflowType).toBeUndefined();
    // Local Coder is excluded from the planning run (execution is Run-only),
    // but CodeGraph (and other non-coder agents) still participate in planning.
    expect(payload.cardRuntime.participants.map((p) => p.cardId)).not.toContain('coder');
    expect(payload.cardRuntime.participants.map((p) => p.cardId)).toContain('codegraph');
  });

  it('magentic_option direction-agnostic', () => {
    const cardM = { id: 'mag1', kind: 'agent', runtimeType: 'magentic_one' };
    const cardA = { id: 'agentA', kind: 'agent', runtimeType: 'assistant_agent' };
    const cardB = { id: 'agentB', kind: 'agent', runtimeType: 'assistant_agent' };

    const edges = [
      { id: 'e1', source: cardA.id, target: cardM.id, edgeType: 'magentic_option' }, // incoming
      { id: 'e2', source: cardM.id, target: cardB.id, edgeType: 'magentic_option' }, // outgoing
    ];

    const resolved = resolvedMagenticOptions(cardM.id, [cardM, cardA, cardB], edges);
    expect(resolved.length).toBe(2);
    expect(resolved.map(r => r.id)).toEqual(expect.arrayContaining(['agentA', 'agentB']));
  });

  it('flow-only edge does not imply Magentic option', () => {
    const cardM = { id: 'mag1', kind: 'agent', runtimeType: 'magentic_one' };
    const cardA = { id: 'agentA', kind: 'agent', runtimeType: 'assistant_agent' };
    const edges = [{ id: 'e1', source: cardM.id, target: cardA.id, edgeType: 'flow' }];

    const resolved = resolvedMagenticOptions(cardM.id, [cardM, cardA], edges);
    expect(resolved.length).toBe(0);
  });

  it('generic prompt strips prior assistant text', () => {
    const payload = buildPythonAutoGenCardRuntimePayload(
      { id: 'mag1' },
      {},
      'test',
      { previousOutput: 'Some Apollo 11 text' },
      {},
      [{ id: 'agentA', runtimeType: 'assistant_agent', runtimeOptions: { modelKey: 'gpt-5-nano' } }],
      '2026'
    );
    expect(payload.priorAssistantText).toBe('');
  });

  it('maxTokens 0 or invalid is omitted/normalized', () => {
    const payload = buildPythonAutoGenCardRuntimePayload(
      { id: 'mag1', runtimeOptions: { maxTokens: 0 } },
      {},
      'test input',
      {},
      {},
      [{ id: 'agentA', runtimeType: 'assistant_agent', runtimeOptions: { modelKey: 'gpt-5-nano' } }],
      '2026'
    );
    expect(payload.cardRuntime.runtimeOptions.maxTokens).toBeUndefined();
  });

  it('RUNTIME_TOOL_SPECS exposes retrieve_knowgraph_context for transport validation', () => {
    const spec = RUNTIME_TOOL_SPECS.find((entry) => entry.name === 'retrieve_knowgraph_context');
    expect(spec).toBeTruthy();
    expect(spec?.enabled).toBe(true);
    expect(spec?.inputSchema?.type).toBe('object');
    expect((spec?.inputSchema as any)?.required).toEqual(['project_id', 'query']);
  });

  it('transports a card-selected KnowGraph retrieval tool to the Python participant set', () => {
    const cardM = { id: 'mag1', kind: 'agent', runtimeType: 'magentic_one' };
    const research = {
      id: 'research', kind: 'agent', runtimeType: 'assistant_agent', title: 'Research Agent',
      runtimeOptions: { modelKey: 'gpt-5-nano', tools: ['retrieve_knowgraph_context'] },
    };
    const allCards = [cardM, research];
    const allEdges = [{ id: 'e', source: research.id, target: cardM.id, edgeType: 'magentic_option' }];
    const callable = resolvedMagenticOptions(cardM.id, allCards, allEdges);
    const payload = buildPythonAutoGenCardRuntimePayload(
      cardM, {}, 'do research', { projectId: 'p', deckId: 'd', allCards, allEdges }, {}, callable, '2026',
    );
    const participant = payload.cardRuntime.participants.find((p) => p.cardId === 'research');
    expect(participant?.tools).toContain('retrieve_knowgraph_context');
  });

  it('rejects an unknown card tool id honestly (not silently dropped)', () => {
    const cardM = { id: 'mag1', kind: 'agent', runtimeType: 'magentic_one' };
    const research = {
      id: 'research', kind: 'agent', runtimeType: 'assistant_agent',
      runtimeOptions: { modelKey: 'gpt-5-nano', tools: ['does_not_exist_tool'] },
    };
    const allCards = [cardM, research];
    const allEdges = [{ id: 'e', source: research.id, target: cardM.id, edgeType: 'magentic_option' }];
    const callable = resolvedMagenticOptions(cardM.id, allCards, allEdges);
    expect(() =>
      buildPythonAutoGenCardRuntimePayload(
        cardM, {}, 'x', { projectId: 'p', deckId: 'd', allCards, allEdges }, {}, callable, '2026',
      ),
    ).toThrow(/card_tool_unknown/);
  });

  it('Python payload compatibility matches expected shape', () => {
    const cardM = { id: 'mag1', kind: 'agent', runtimeType: 'magentic_one', prompt: 'test system prompt' };
    const cardA = { id: 'agentA', kind: 'agent', runtimeType: 'assistant_agent', runtimeOptions: { modelKey: 'gpt-5-nano' } };
    const context = { deckId: 'deck1', allCards: [cardM, cardA], allEdges: [] };

    const payload = buildPythonAutoGenCardRuntimePayload(cardM, {}, 'hello', context, {}, [cardA], '2026');

    expect(payload.session.orchestrator).toBe('magentic_one');
    expect(payload.systemPrompt).toContain('test system prompt');
    expect(payload.systemPrompt).toContain('disconnected cards are ineligible');
    expect(payload.cardRuntime.runtimeScope?.pythonWorkerIds).toContain('agentA');
    // Ensure task_ledger, progress_ledger are completely absent
    expect((payload as any).task_ledger).toBeUndefined();
    expect((payload as any).progress_ledger).toBeUndefined();
  });

  it('grounds the Task Ledger payload with graph context, keeping the graphPayload contract intact', () => {
    const grounding = {
      projectId: 'p',
      userText: 'Continue RDW / SpaceX research',
      thinkGraph: {
        ok: true,
        facts: [{ label: 'Redwire Corporation', type: 'company', sourceRef: 'user_request_stream', confidence: 0.99 }],
        relations: [{ from: 'e_rdw_ticker', to: 'e_rdw', type: 'identifies', sourceRef: 'user_request_stream' }],
        uncertainty: ['Live RDW price unknown until lookup'],
        nextSearchSeedCandidates: ['live_market_data_for_RDW'],
      },
      warnings: ['codegraph_not_run_on_task_ledger_hot_path'],
    };
    const cardM = {
      id: 'mag1',
      runtimeType: 'magentic_one',
      prompt: 'sys',
      runtimeOptions: { taskLedgerOutputContract: 'PlanFlow contract: produce planFlowTaskObjects AND an OWL-shaped graphPayload.' },
    };
    const cardA = { id: 'agentA', runtimeType: 'assistant_agent', runtimeOptions: { modelKey: 'gpt-5-nano' } };
    const payload = buildPythonAutoGenCardRuntimePayload(
      cardM, {}, 'Continue RDW / SpaceX research', { allCards: [cardM, cardA], allEdges: [] }, {}, [cardA], '2026', undefined, grounding as any,
    );

    // Grounding reaches the model-call payload.
    expect(payload.taskLedgerGroundingContext).toBeDefined();
    expect((payload.taskLedgerGroundingContext as any).thinkGraph.facts[0].label).toBe('Redwire Corporation');
    // Directive + the accepted facts are injected into the system prompt.
    expect(payload.systemPrompt).toContain('graphGroundingContext');
    expect(payload.systemPrompt).toMatch(/READ it before creating tasks/i);
    expect(payload.systemPrompt).toContain('Redwire Corporation');
    // The OWL graphPayload output contract is preserved, not replaced.
    expect(payload.cardRuntime.taskLedgerOutputContract).toContain('graphPayload');
    expect(payload.systemPrompt).toMatch(/graphPayload output contract intact/i);
  });

  it('omits grounding cleanly when none is provided (backward compatible)', () => {
    const cardM = { id: 'mag1', runtimeType: 'magentic_one', prompt: 'sys' };
    const cardA = { id: 'agentA', runtimeType: 'assistant_agent', runtimeOptions: { modelKey: 'gpt-5-nano' } };
    const payload = buildPythonAutoGenCardRuntimePayload(
      cardM, {}, 'hello', { allCards: [cardM, cardA], allEdges: [] }, {}, [cardA], '2026',
    );
    expect(payload.taskLedgerGroundingContext).toBeUndefined();
    expect(payload.systemPrompt).not.toContain('graphGroundingContext');
  });

  it('does NOT accept, transport, or render ActiveGraphContext (runtime injection removed)', () => {
    const cardM = { id: 'mag1', runtimeType: 'magentic_one', prompt: 'sys', runtimeOptions: { taskLedgerOutputContract: 'produce planFlowTaskObjects AND an OWL-shaped graphPayload.' } };
    const cardA = { id: 'agentA', runtimeType: 'assistant_agent', runtimeOptions: { modelKey: 'gpt-5-nano' } };
    // Even if a caller passes an extra arg, the builder ignores it: no param, no field, no render.
    const payload = buildPythonAutoGenCardRuntimePayload(
      cardM, {}, 'Continue RDW research', { allCards: [cardM, cardA], allEdges: [] }, {}, [cardA], '2026', undefined, undefined,
      { facts: [{ subject: 'X', object: 'Y' }] } as any,
    );
    // no ActiveGraphContext is transported or rendered
    expect((payload as any).activeGraphContext).toBeUndefined();
    expect(payload.systemPrompt).not.toContain('activeGraphContext');
    expect(payload.systemPrompt).not.toMatch(/active graph context/i);
    expect(payload.systemPrompt).not.toContain('graphRetrievalMode');
    // the pre-existing Task Ledger / OWL graphPayload contract is untouched
    expect(payload.cardRuntime.taskLedgerOutputContract).toContain('graphPayload');
  });

  it('Mag One coding-run prompt states bus eligibility, coding path, and graph-memory tool limits', () => {
    expect(MAG_ONE_CODING_RUN_SYSTEM_PROMPT).toContain(
      'direct connection to the vertical\nMagentic bus means an agent is eligible',
    );
    expect(MAG_ONE_CODING_RUN_SYSTEM_PROMPT).toContain('disconnected cards are ineligible');
    expect(MAG_ONE_CODING_RUN_SYSTEM_PROMPT).toContain(
      'Plan Agent is the approval/planning surface',
    );
    expect(MAG_ONE_CODING_RUN_SYSTEM_PROMPT).toContain(
      'CodeGraph Agent owns structural code memory',
    );
    expect(MAG_ONE_CODING_RUN_SYSTEM_PROMPT).toContain(
      'Local Coder is the controlled patch/test/runtime worker',
    );
    expect(MAG_ONE_CODING_RUN_SYSTEM_PROMPT).toContain(
      'ThinkGraph Agent',
    );
    expect(MAG_ONE_CODING_RUN_SYSTEM_PROMPT).toContain('stores project decisions');
    expect(MAG_ONE_CODING_RUN_SYSTEM_PROMPT).toContain(
      'do not ask graph-memory',
    );
    expect(MAG_ONE_CODING_RUN_SYSTEM_PROMPT).toContain('agents to run tools they do not own');
    expect(MAG_ONE_CODING_RUN_SYSTEM_PROMPT).toContain('coder_console_task');
    expect(MAG_ONE_CODING_RUN_SYSTEM_PROMPT).toContain('watch in Code Console');
    expect(MAG_ONE_CODING_RUN_SYSTEM_PROMPT).toContain(
      'Ordinary chat must not invoke coder_console_task',
    );
  });

  it('routing diagnostics use current bus edges and ignore stale research-shaped flow topology', () => {
    const mag = { id: 'mag', kind: 'agent', runtimeType: 'magentic_one', title: 'Magentic-One' };
    const plan = { id: 'plan', kind: 'agent', runtimeType: 'assistant_agent', runtimeBinding: 'plan_agent', title: 'Plan Agent' };
    const think = { id: 'think', kind: 'agent', runtimeType: 'assistant_agent', runtimeBinding: 'thinkgraph_agent', title: 'ThinkGraph Agent' };
    const codegraph = { id: 'codegraph', kind: 'agent', runtimeType: 'assistant_agent', runtimeBinding: 'codegraph_agent', title: 'CodeGraph Agent' };
    const coder = { id: 'coder', kind: 'agent', runtimeType: 'local_coder', runtimeBinding: 'local_coder', title: 'Local Coder' };
    const know = { id: 'know', kind: 'agent', runtimeType: 'assistant_agent', runtimeBinding: 'knowgraph_agent', title: 'KnowGraph Agent' };
    const research = { id: 'research', kind: 'agent', runtimeType: 'assistant_agent', runtimeBinding: 'research_agent', title: 'Research Agent' };
    const diagnostics = buildMagOneRoutingDiagnostics(
      mag,
      [mag, plan, think, codegraph, coder, know, research],
      [
        { id: 'p', source: 'plan', target: 'mag', edgeType: 'magentic_option' },
        { id: 't', source: 'think', target: 'mag', edgeType: 'magentic_option' },
        { id: 'old1', source: 'know', target: 'research', edgeType: 'flow' },
        { id: 'old2', source: 'research', target: 'think', edgeType: 'flow' },
      ],
      'fix the LocalCoder runtime',
      { projectId: 'admin', deckId: 'deck_builder' },
    );

    expect(diagnostics.projectId).toBe('admin');
    // TypeScript does not classify the request: there is no workflowType field
    // and no coding participant gate. The diagnostics only describe availability.
    expect((diagnostics as any).workflowType).toBeUndefined();
    expect(diagnostics.eligibleBusConnectedAgents.map((agent) => agent.id)).toEqual(['plan', 'think']);
    expect(diagnostics.selectedExecutionPath.map((agent) => agent.id)).toEqual(['plan', 'think']);
    expect(diagnostics.disconnectedAgentsIgnored.map((agent) => agent.id)).toEqual(
      expect.arrayContaining(['codegraph', 'coder', 'know', 'research']),
    );
    expect(diagnostics.missingRequiredAgents).toEqual([]);
    expect(diagnostics.blockedReason).toBeNull();
  });

  it('planning manifest still describes the Local Coder as an available agent, but never runs or dispatches it', () => {
    // The capability manifest may *describe* the Local Coder (so Python can
    // propose it in its Progress Ledger), but the planning run must not include
    // it as a participant and must not ship a coder-dispatch packet.
    const mag = { id: 'mag', kind: 'agent', runtimeType: 'magentic_one', title: 'Magentic-One' };
    const plan = { id: 'plan', kind: 'agent', runtimeType: 'assistant_agent', runtimeBinding: 'plan_agent', title: 'Plan Agent', runtimeOptions: { modelKey: 'gpt-5-nano' } };
    const codegraph = { id: 'codegraph', kind: 'agent', runtimeType: 'assistant_agent', runtimeBinding: 'codegraph_agent', title: 'CodeGraph Agent', runtimeOptions: { modelKey: 'gpt-5-nano' } };
    const coder = {
      id: 'coder',
      kind: 'agent',
      runtimeType: 'local_coder',
      runtimeBinding: 'local_coder',
      title: 'Local Coder',
      runtimeOptions: { modelKey: 'gpt-5-nano' },
    };
    const think = { id: 'think', kind: 'agent', runtimeType: 'assistant_agent', runtimeBinding: 'thinkgraph_agent', title: 'ThinkGraph Agent', runtimeOptions: { modelKey: 'gpt-5-nano' } };
    const allCards = [mag, plan, codegraph, coder, think];
    const allEdges = [plan, codegraph, coder, think].map((agent) => ({
      id: `edge-${agent.id}`,
      source: agent.id,
      target: mag.id,
      edgeType: 'magentic_option',
    }));
    const callable = resolvedMagenticOptions(mag.id, allCards, allEdges);
    const payload = buildPythonAutoGenCardRuntimePayload(
      mag,
      {},
      'fix the code',
      { projectId: 'admin', deckId: 'deck', allCards, allEdges },
      {},
      callable,
      '2026',
    );

    expect(payload.cardRuntime.runtimeScope?.routingDiagnostics?.blockedReason).toBeNull();
    // Local Coder is excluded from the planning participants and python workers.
    expect(payload.cardRuntime.participants.map((agent) => agent.cardId)).not.toContain('coder');
    expect(payload.cardRuntime.runtimeScope?.pythonWorkerIds).not.toContain('coder');
    // Other agents still plan.
    expect(payload.cardRuntime.participants.map((agent) => agent.cardId)).toEqual(
      expect.arrayContaining(['plan', 'codegraph', 'think']),
    );
    // No intent/workflow classifier, no coder-dispatch packet on a planning turn.
    expect((payload.routingManifest as any)?.intent).toBeUndefined();
    expect(payload.codingWorkflowPacket).toBeUndefined();
    // The manifest still lists the coder as a bus-connected, describable agent.
    expect(payload.routingManifest?.agents.find((agent) => agent.cardId === 'coder')).toMatchObject({
      busConnected: true,
      role: 'local_coder',
    });
  });

  it('provides the correct manifest for a task', () => {
    const mag = { id: 'mag', kind: 'agent', runtimeType: 'magentic_one', title: 'Magentic-One' };
    const coder = { id: 'coder', kind: 'agent', runtimeType: 'local_coder', title: 'Local Coder' };
    const codegraph = { id: 'codegraph', kind: 'agent', runtimeType: 'assistant_agent', title: 'CodeGraph Agent' };
    const research = { id: 'research', kind: 'agent', runtimeType: 'assistant_agent', title: 'Research Agent' };
    const manifest = buildMagOneRoutingManifest(
      mag,
      [mag, coder, codegraph, research],
      [
        { id: 'coder-edge', source: coder.id, target: mag.id, edgeType: 'magentic_option' },
        { id: 'code-edge', source: codegraph.id, target: mag.id, edgeType: 'magentic_option' },
      ],
      'inspect this repo',
    );
    expect(manifest.agents.find((agent) => agent.cardId === 'coder')?.capabilities).toContain('coding.execute');
    expect(manifest.agents.find((agent) => agent.cardId === 'codegraph')?.capabilities).toContain('code.context');
    expect(manifest.agents.find((agent) => agent.cardId === 'research')).toMatchObject({
      busConnected: false,
      blockedReason: 'not_bus_connected',
      priority: 0,
    });
  });



  it('disconnected cards do not appear in model-visible workspace context or payload participants', () => {
    const cardM = { id: 'mag1', kind: 'agent', runtimeType: 'magentic_one' };
    const cardConnected = { id: 'conn1', kind: 'agent', runtimeType: 'assistant_agent', runtimeOptions: { modelKey: 'gpt-5-nano' } };
    const cardDisconnected = { id: 'disc1', kind: 'agent', runtimeType: 'assistant_agent' };

    // cardConnected is connected, cardDisconnected is not.
    const context = {
      deckId: 'deck1',
      allCards: [cardM, cardConnected, cardDisconnected],
      allEdges: [{ id: 'e1', source: cardM.id, target: cardConnected.id, edgeType: 'magentic_option' }]
    };

    const callableHeads = resolvedMagenticOptions(cardM.id, context.allCards, context.allEdges);

    const payload = buildPythonAutoGenCardRuntimePayload(
      cardM, {}, 'hello', context, {}, callableHeads, '2026'
    );

    // disconnected cards should not be in participants
    expect(payload.cardRuntime.participants.map(p => p.cardId)).not.toContain('disc1');
    expect(payload.cardRuntime.participants.map(p => p.cardId)).toContain('conn1');

    // disconnected cards should not be in visibleNodeIds
    expect(payload.cardRuntime.runtimeScope?.visibleNodeIds).not.toContain('disc1');
    expect(payload.cardRuntime.runtimeScope?.visibleNodeIds).toContain('conn1');

    // excludedAgentIds should be completely empty to prevent leakage
    expect(payload.cardRuntime.runtimeScope?.excludedAgentIds).toEqual([]);

    // workspaceObjectContext should be completely undefined to prevent global leak
    expect(payload.workspaceObjectContext).toBeUndefined();
  });

  it('flow-only cards do not become callable participants', () => {
    const cardM = { id: 'mag1', kind: 'agent', runtimeType: 'magentic_one' };
    const cardFlow = { id: 'flow1', kind: 'agent', runtimeType: 'assistant_agent' };

    const context = {
      deckId: 'deck1',
      allCards: [cardM, cardFlow],
      allEdges: [{ id: 'e1', source: cardM.id, target: cardFlow.id, edgeType: 'flow' }]
    };

    const callableHeads = resolvedMagenticOptions(cardM.id, context.allCards, context.allEdges);

    const payload = buildPythonAutoGenCardRuntimePayload(
      cardM, {}, 'hello', context, {}, callableHeads, '2026'
    );

    expect(payload.cardRuntime.participants.map(p => p.cardId)).not.toContain('flow1');
    expect(payload.cardRuntime.runtimeScope?.visibleNodeIds).not.toContain('flow1');
  });

  // T002 — Failing tests: card-selected model config must propagate to payload exactly.
  // These tests must fail before T003 is applied (current code hardcodes 'openrouter'/'default').

  it('privateParticipants carry the participant card selected provider and providerModelId', () => {
    const selectedModelKey = 'gpt-5.1-chat-latest';         // real MODEL_REGISTRY key — fixture only, not a default
    const selectedProvider = 'openai';                        // MODEL_REGISTRY[selectedModelKey].provider
    const selectedProviderModelId = 'gpt-5.1-chat-latest';  // MODEL_REGISTRY[selectedModelKey].id

    const cardM = { id: 'mag1', kind: 'agent', runtimeType: 'magentic_one' };
    const cardA = {
      id: 'agentA', kind: 'agent', runtimeType: 'assistant_agent',
      runtimeOptions: { modelKey: selectedModelKey },
    };

    const payload = buildPythonAutoGenCardRuntimePayload(
      cardM, {}, 'test', {}, {}, [cardA], '2026',
    );

    const priv = payload.cardRuntime.privateParticipants?.[0];
    expect(priv).toBeDefined();
    expect(priv?.provider).toBe(selectedProvider);
    expect(priv?.providerModelId).toBe(selectedProviderModelId);
    expect(priv?.providerModelId).not.toBe('default');
    expect(priv?.providerModelId).not.toBe('');
  });

  it('participants[] carry the same card-selected provider and providerModelId', () => {
    const selectedModelKey = 'gpt-5.1-chat-latest';
    const selectedProvider = 'openai';
    const selectedProviderModelId = 'gpt-5.1-chat-latest';

    const cardM = { id: 'mag1', kind: 'agent', runtimeType: 'magentic_one' };
    const cardA = {
      id: 'agentA', kind: 'agent', runtimeType: 'assistant_agent',
      runtimeOptions: { modelKey: selectedModelKey },
    };

    const payload = buildPythonAutoGenCardRuntimePayload(
      cardM, {}, 'test', {}, {}, [cardA], '2026',
    );

    const pub = payload.cardRuntime.participants?.[0];
    expect(pub).toBeDefined();
    expect(pub?.provider).toBe(selectedProvider);
    expect(pub?.providerModelId).toBe(selectedProviderModelId);
  });

  it('throws card_model_config_missing when participant card has no runtimeOptions.modelKey', () => {
    const cardM = { id: 'mag1', kind: 'agent', runtimeType: 'magentic_one' };
    const cardA = { id: 'agentA', kind: 'agent', runtimeType: 'assistant_agent' };

    expect(() =>
      buildPythonAutoGenCardRuntimePayload(cardM, {}, 'test', {}, {}, [cardA], '2026'),
    ).toThrow('card_model_config_missing');
  });

  it('throws card_model_config_mismatch when runtimeOptions.provider conflicts with registry provider', () => {
    const cardM = { id: 'mag1', kind: 'agent', runtimeType: 'magentic_one' };
    const cardA = {
      id: 'agentA', kind: 'agent', runtimeType: 'assistant_agent',
      runtimeOptions: {
        modelKey: 'gpt-5-nano',   // registry provider = 'openai'
        provider: 'openrouter',    // conflicts → mismatch
      },
    };

    expect(() =>
      buildPythonAutoGenCardRuntimePayload(cardM, {}, 'test', {}, {}, [cardA], '2026'),
    ).toThrow('card_model_config_mismatch');
  });

  // T005 — graph nodes, graph edges, and card settings must survive into the Python rails payload.

  it('graph nodes and edges survive into the payload with edge relationships intact', () => {
    const cardM = { id: 'mag1', kind: 'agent', runtimeType: 'magentic_one', runtimeOptions: { modelKey: 'gpt-5.1-chat-latest' } };
    const cardA = { id: 'agentA', kind: 'agent', runtimeType: 'assistant_agent', runtimeOptions: { modelKey: 'gpt-5-nano' } };
    const cardB = { id: 'agentB', kind: 'agent', runtimeType: 'assistant_agent', runtimeOptions: { modelKey: 'gpt-5-nano' } };

    const context = {
      deckId: 'deck1',
      allCards: [cardM, cardA, cardB],
      allEdges: [
        { id: 'mo1', source: 'mag1', target: 'agentA', edgeType: 'magentic_option' },
        { id: 'mo2', source: 'agentB', target: 'mag1', edgeType: 'magentic_option' },
        { id: 'f1', source: 'agentA', target: 'agentB', edgeType: 'flow' },
        {
          id: 'f2', source: 'agentB', target: 'agentA', edgeType: 'flow',
          data: { loop: { maxIterations: 2, exitOnText: 'DONE' } },
        },
      ],
    };

    const payload = buildPythonAutoGenCardRuntimePayload(
      cardM, {}, 'hello', context, { provider: 'openai', providerModelId: 'gpt-5.1-chat-latest' },
      [cardA, cardB], '2026',
    );

    const graph = payload.cardRuntime.graph;
    expect(graph.nodes.map((n) => n.cardId)).toEqual(['mag1', 'agentA', 'agentB']);
    expect(graph.edges.map((e) => e.id)).toEqual(['mo1', 'mo2', 'f1', 'f2']);
    const flowEdge = graph.edges.find((e) => e.id === 'f1');
    expect(flowEdge).toMatchObject({ source: 'agentA', target: 'agentB', edgeType: 'flow' });
    const loopEdge = graph.edges.find((e) => e.id === 'f2');
    expect(loopEdge?.loop).toEqual({ maxIterations: 2, exitOnText: 'DONE' });
    const magenticEdge = graph.edges.find((e) => e.id === 'mo1');
    expect(magenticEdge?.edgeType).toBe('magentic_option');
  });

  it('card settings survive: tools, fan-out, isSocietyOfMind, explicit model config, instructions, role', () => {
    const cardM = { id: 'mag1', kind: 'agent', runtimeType: 'magentic_one' };
    const cardFan = {
      id: 'fan1', kind: 'agent', runtimeType: 'assistant_agent', title: 'Fan',
      prompt: 'Fan instructions.',
      runtimeOptions: {
        modelKey: 'gpt-5-nano',
        role: 'fan-out specialist',
        tools: ['current_datetime'],
        fanOut: { enabled: true, count: 2, items: ['x', 'y'] },
      },
    };
    const cardSom = {
      id: 'som1', kind: 'agent', runtimeType: 'assistant_agent', title: 'Som',
      prompt: 'Som instructions.',
      runtimeOptions: { modelKey: 'gpt-5-nano' },
    };
    const child = {
      id: 'child1', kind: 'agent', runtimeType: 'assistant_agent', parentGraphId: 'som1',
      prompt: 'Child instructions.',
      runtimeOptions: { modelKey: 'gpt-5-mini', tools: ['calculator'] },
    };

    const context = {
      deckId: 'deck1',
      allCards: [cardM, cardFan, cardSom, child],
      allEdges: [
        { id: 'mo1', source: 'mag1', target: 'fan1', edgeType: 'magentic_option' },
        { id: 'mo2', source: 'mag1', target: 'som1', edgeType: 'magentic_option' },
      ],
    };

    const payload = buildPythonAutoGenCardRuntimePayload(
      cardM, {}, 'hello', context, {}, [cardFan, cardSom], '2026',
    );

    const fanParticipant = payload.cardRuntime.participants.find((p) => p.cardId === 'fan1');
    expect(fanParticipant?.tools).toEqual(['current_datetime']);
    expect(fanParticipant?.fanOut).toEqual({ enabled: true, count: 2, items: ['x', 'y'] });
    expect(fanParticipant?.isSocietyOfMind).toBe(false);
    expect(fanParticipant?.prompt).toBe('Fan instructions.');
    expect(fanParticipant?.provider).toBe('openai');
    expect(fanParticipant?.providerModelId).toBe('gpt-5-nano');

    const somParticipant = payload.cardRuntime.participants.find((p) => p.cardId === 'som1');
    expect(somParticipant?.isSocietyOfMind).toBe(true);

    const graph = payload.cardRuntime.graph;
    const fanNode = graph.nodes.find((n) => n.cardId === 'fan1');
    expect(fanNode?.role).toBe('fan-out specialist');
    expect(fanNode?.fanOut).toEqual({ enabled: true, count: 2, items: ['x', 'y'] });
    const childNode = graph.nodes.find((n) => n.cardId === 'child1');
    expect(childNode).toBeDefined();
    expect(childNode?.parentGraphId).toBe('som1');
    expect(childNode?.tools).toEqual(['calculator']);
    expect(childNode?.provider).toBe('openai');
    expect(childNode?.providerModelId).toBe('gpt-5-mini');
    expect(childNode?.prompt).toBe('Child instructions.');
  });

  it('child subgraph node without explicit model config fails loudly', () => {
    const cardM = { id: 'mag1', kind: 'agent', runtimeType: 'magentic_one' };
    const cardSom = {
      id: 'som1', kind: 'agent', runtimeType: 'assistant_agent',
      runtimeOptions: { modelKey: 'gpt-5-nano' },
    };
    const child = { id: 'child1', kind: 'agent', runtimeType: 'assistant_agent', parentGraphId: 'som1' };

    const context = { deckId: 'deck1', allCards: [cardM, cardSom, child], allEdges: [] };

    expect(() =>
      buildPythonAutoGenCardRuntimePayload(cardM, {}, 'hello', context, {}, [cardSom], '2026'),
    ).toThrow('card_model_config_missing');
  });

  // T001 — ToolSpec: only known enabled card tools pass into the payload.

  it('unknown card tool fails loudly with card_tool_unknown', () => {
    const cardM = { id: 'mag1', kind: 'agent', runtimeType: 'magentic_one' };
    const cardA = {
      id: 'agentA', kind: 'agent', runtimeType: 'assistant_agent',
      runtimeOptions: { modelKey: 'gpt-5-nano', tools: ['made_up_tool'] },
    };

    expect(() =>
      buildPythonAutoGenCardRuntimePayload(cardM, {}, 'test', {}, {}, [cardA], '2026'),
    ).toThrow('card_tool_unknown: made_up_tool');
  });

  it('empty card tool name fails loudly with card_tool_name_empty', () => {
    const cardM = { id: 'mag1', kind: 'agent', runtimeType: 'magentic_one' };
    const cardA = {
      id: 'agentA', kind: 'agent', runtimeType: 'assistant_agent',
      runtimeOptions: { modelKey: 'gpt-5-nano', tools: ['  '] },
    };

    expect(() =>
      buildPythonAutoGenCardRuntimePayload(cardM, {}, 'test', {}, {}, [cardA], '2026'),
    ).toThrow('card_tool_name_empty');
  });

  it('known enabled tools pass through unchanged', () => {
    const cardM = { id: 'mag1', kind: 'agent', runtimeType: 'magentic_one' };
    const cardA = {
      id: 'agentA', kind: 'agent', runtimeType: 'assistant_agent',
      runtimeOptions: { modelKey: 'gpt-5-nano', tools: ['current_datetime', 'calculator'] },
    };

    const payload = buildPythonAutoGenCardRuntimePayload(cardM, {}, 'test', {}, {}, [cardA], '2026');
    const participant = payload.cardRuntime.participants.find((p) => p.cardId === 'agentA');
    expect(participant?.tools).toEqual(['current_datetime', 'calculator']);
  });

  it('coder_console_task advertises explicit asynchronous status and delivery contracts', () => {
    const spec = RUNTIME_TOOL_SPECS.find((tool) => tool.name === 'coder_console_task');
    expect((spec?.outputSchema.properties as any).status.enum).toEqual([
      'started', 'queued', 'running', 'completed', 'failed', 'blocked',
    ]);
    expect((spec?.outputSchema.properties as any).delivery_status.enum).toEqual([
      'accepted', 'queued', 'blocked',
    ]);
  });

  it('coder_console_task cannot be selected by a non-Local-Coder card', () => {
    const cardM = { id: 'mag1', kind: 'agent', runtimeType: 'magentic_one' };
    const cardA = {
      id: 'agentA',
      kind: 'agent',
      runtimeType: 'assistant_agent',
      runtimeOptions: { modelKey: 'gpt-5-nano', tools: ['coder_console_task'] },
    };
    expect(() =>
      buildPythonAutoGenCardRuntimePayload(cardM, {}, 'fix code', {}, {}, [cardA], '2026'),
    ).toThrow('coder_console_tool_requires_local_coder_card');
  });

  it('does not add a direct chat-to-console bypass', () => {
    const chatRoute = readFileSync(
      path.join(process.cwd(), 'apps/backend/src/routes/agentBuilder.routes.ts'),
      'utf8',
    );
    expect(chatRoute).not.toContain('/openclaude/console/task');
    expect(chatRoute).not.toContain('routeCodingTaskToConsole');
  });

  it('providerModelId is never default or empty string in any participant payload', () => {
    const selectedModelKey = 'gpt-5-nano';  // fixture — not a default

    const cardM = { id: 'mag1', kind: 'agent', runtimeType: 'magentic_one' };
    const cardA = {
      id: 'agentA', kind: 'agent', runtimeType: 'assistant_agent',
      runtimeOptions: { modelKey: selectedModelKey },
    };

    const payload = buildPythonAutoGenCardRuntimePayload(
      cardM, {}, 'test', {}, {}, [cardA], '2026',
    );

    const priv = payload.cardRuntime.privateParticipants?.[0];
    const pub = payload.cardRuntime.participants?.[0];
    expect(priv?.providerModelId).not.toBe('default');
    expect(priv?.providerModelId).not.toBe('');
    expect(pub?.providerModelId).not.toBe('default');
    expect(pub?.providerModelId).not.toBe('');
  });
});
