import { describe, it, expect } from 'vitest';
import { RUNTIME_TOOL_SPECS } from '../contracts/runtimeContracts';
import {
  resolvedMagenticOptions,
  buildPythonAutoGenCardRuntimePayload,
  runCardWithContract,
} from './runtime';

describe('Canonical Cards Runtime', () => {
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
      title: 'Local Coder', runtimeOptions: { modelKey: 'z-ai/glm-5.2', provider: 'openrouter' },
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
    // Native team: every bus-connected agent participates, including the Local Coder
    // (no project-specific participant filtering). Execution is the Run route only.
    expect(payload.cardRuntime.participants.map((p) => p.cardId)).toContain('coder');
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

  it('does not treat the visually bus-connected main_chat controller as a Mag One worker', () => {
    const cardM = { id: 'card_magentic', kind: 'agent', runtimeType: 'magentic_one' };
    const mainChat = {
      id: 'card_main_chat',
      kind: 'agent',
      runtimeType: 'assistant_agent',
      runtimeBinding: 'main_chat',
      runtimeOptions: { provider: 'openai', modelKey: 'gpt-5.1-chat-latest' },
    };
    const think = {
      id: 'card_thinkgraph_agent',
      kind: 'agent',
      runtimeType: 'assistant_agent',
      runtimeBinding: 'thinkgraph_agent',
      runtimeOptions: { modelKey: 'gpt-5-nano' },
    };
    const edges = [
      { id: 'edge_main_chat_harness_bus', source: mainChat.id, target: cardM.id, edgeType: 'magentic_option' },
      { id: 'edge_thinkgraph', source: think.id, target: cardM.id, edgeType: 'magentic_option' },
    ];

    const resolved = resolvedMagenticOptions(cardM.id, [cardM, mainChat, think], edges);
    expect(resolved.map((node) => node.id)).toEqual(['card_thinkgraph_agent']);
  });

  it('flow-only edge does not imply Magentic option', () => {
    const cardM = { id: 'mag1', kind: 'agent', runtimeType: 'magentic_one' };
    const cardA = { id: 'agentA', kind: 'agent', runtimeType: 'assistant_agent' };
    const edges = [{ id: 'e1', source: cardM.id, target: cardA.id, edgeType: 'flow' }];

    const resolved = resolvedMagenticOptions(cardM.id, [cardM, cardA], edges);
    expect(resolved.length).toBe(0);
  });

  it('passes mission input through normally and preserves prior assistant text (no keyword classifier)', () => {
    const payload = buildPythonAutoGenCardRuntimePayload(
      { id: 'mag1' },
      {},
      'test',
      { previousOutput: 'Some Apollo 11 text' },
      {},
      [{ id: 'agentA', runtimeType: 'assistant_agent', runtimeOptions: { modelKey: 'gpt-5-nano' } }],
      '2026'
    );
    // No deterministic keyword classifier: 'test'/'go'/'hello' no longer strip the
    // prior assistant text — the mission passes through unchanged.
    expect(payload.priorAssistantText).toBe('Some Apollo 11 text');
    expect(payload.userText).toBe('test');
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

  it('does not add ThinkGraph authority to the Mag One runtime scope', () => {
    const cardM = { id: 'mag1', kind: 'agent', runtimeType: 'magentic_one' };
    const think = {
      id: 'think',
      kind: 'agent',
      runtimeType: 'assistant_agent',
      runtimeBinding: 'thinkgraph_agent',
      runtimeOptions: {
        modelKey: 'z-ai/glm-5.2',
        provider: 'openrouter',
        tools: ['read_thinkgraph_scope', 'apply_thinkgraph_patch'],
      },
    };
    const plan = {
      id: 'plan',
      kind: 'agent',
      runtimeType: 'assistant_agent',
      runtimeBinding: 'plan_agent',
      runtimeOptions: { modelKey: 'z-ai/glm-5.2', provider: 'openrouter', tools: ['calculator'] },
    };
    const allCards = [cardM, think, plan];
    const allEdges = [think, plan].map((agent) => ({
      id: `edge-${agent.id}`, source: agent.id, target: cardM.id, edgeType: 'magentic_option',
    }));
    const callable = resolvedMagenticOptions(cardM.id, allCards, allEdges);
    const payload = buildPythonAutoGenCardRuntimePayload(
      cardM, {}, 'probe graph tools', { projectId: 'project-1', deckId: 'deck', allCards, allEdges }, {}, callable, '2026',
    );

    expect((payload.cardRuntime.runtimeScope as any)?.thinkGraphReadAuthority).toBeUndefined();
    expect(payload.cardRuntime.participants.find((p) => p.cardId === 'think')?.tools).toEqual([
      'read_thinkgraph_scope',
      'apply_thinkgraph_patch',
    ]);
  });

  it('does not add hidden graph authority for non-ThinkGraph workers or ThinkGraph cards without the read tool', () => {
    const cardM = { id: 'mag1', kind: 'agent', runtimeType: 'magentic_one' };
    const thinkNoRead = {
      id: 'think',
      kind: 'agent',
      runtimeType: 'assistant_agent',
      runtimeBinding: 'thinkgraph_agent',
      runtimeOptions: { modelKey: 'z-ai/glm-5.2', provider: 'openrouter', tools: ['calculator'] },
    };
    const researchWithReadToolButWrongBinding = {
      id: 'research',
      kind: 'agent',
      runtimeType: 'assistant_agent',
      runtimeBinding: 'research_agent',
      runtimeOptions: { modelKey: 'z-ai/glm-5.2', provider: 'openrouter', tools: ['read_thinkgraph_scope'] },
    };
    const allCards = [cardM, thinkNoRead, researchWithReadToolButWrongBinding];
    const allEdges = [thinkNoRead, researchWithReadToolButWrongBinding].map((agent) => ({
      id: `edge-${agent.id}`, source: agent.id, target: cardM.id, edgeType: 'magentic_option',
    }));
    const callable = resolvedMagenticOptions(cardM.id, allCards, allEdges);
    const payload = buildPythonAutoGenCardRuntimePayload(
      cardM, {}, 'probe graph tools', { projectId: 'project-1', deckId: 'deck', allCards, allEdges }, {}, callable, '2026',
    );

    expect((payload.cardRuntime.runtimeScope as any)?.thinkGraphReadAuthority).toBeUndefined();
  });

  it('contains no magnet packet graph authority field or hard-coded mission strings in the Mag One runtime scope', () => {
    const cardM = { id: 'mag1', kind: 'agent', runtimeType: 'magentic_one' };
    const think = {
      id: 'think',
      kind: 'agent',
      runtimeType: 'assistant_agent',
      runtimeBinding: 'thinkgraph_agent',
      runtimeOptions: { modelKey: 'z-ai/glm-5.2', provider: 'openrouter', tools: ['read_thinkgraph_scope'] },
    };
    const payload = buildPythonAutoGenCardRuntimePayload(
      cardM, {}, 'generic task', { projectId: 'project-1', deckId: 'deck', allCards: [cardM, think], allEdges: [] }, {}, [think], '2026',
    );
    const raw = JSON.stringify(payload.cardRuntime.runtimeScope);
    expect(raw).not.toContain('thinkGraphReadAuthority');
    expect(raw).not.toContain('magone_graph_tool_probe');
    expect(raw).not.toContain('trading');
    expect(raw).not.toContain('EDGAR');
    expect(raw).not.toContain('liquidity');
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
    // System prompt is EXACTLY the card's own prompt — no backend-authored global
    // coding persona is prepended.
    expect(payload.systemPrompt).toBe('test system prompt');
    expect(payload.systemPrompt).not.toContain('disconnected cards are ineligible');
    expect(payload.cardRuntime.runtimeScope?.pythonWorkerIds).toContain('agentA');
    // Ensure task_ledger, progress_ledger are completely absent
    expect((payload as any).task_ledger).toBeUndefined();
    expect((payload as any).progress_ledger).toBeUndefined();
  });

  it('injects no graph grounding or task-ledger output contract into native reasoning', () => {
    const cardM = {
      id: 'mag1',
      runtimeType: 'magentic_one',
      prompt: 'sys',
      // Even a stored taskLedgerOutputContract is now ignored — the forced
      // task-ledger exposure / PlanFlow output contract was removed.
      runtimeOptions: { taskLedgerOutputContract: 'produce an OWL-shaped graphPayload.' },
    };
    const cardA = { id: 'agentA', runtimeType: 'assistant_agent', runtimeOptions: { modelKey: 'gpt-5-nano' } };
    const payload = buildPythonAutoGenCardRuntimePayload(
      cardM, {}, 'Continue RDW research', { allCards: [cardM, cardA], allEdges: [] }, {}, [cardA], '2026',
    );
    // No grounding field on the payload and no grounding/ActiveGraphContext prose in
    // the system prompt — the system prompt is exactly the card prompt.
    expect((payload as any).taskLedgerGroundingContext).toBeUndefined();
    expect((payload as any).activeGraphContext).toBeUndefined();
    expect(payload.systemPrompt).toBe('sys');
    expect(payload.systemPrompt).not.toContain('graphGroundingContext');
    expect(payload.systemPrompt).not.toMatch(/READ it before creating tasks/i);
    // The forced task-ledger output contract is gone from the payload entirely.
    expect((payload.cardRuntime as any).taskLedgerOutputContract).toBeUndefined();
    // No approval gate rides the payload.
    expect((payload as any).runApproved).toBeUndefined();
  });

  it('includes the Local Coder as a native bus participant like any other agent', () => {
    // Bus connectivity is the only activation. The Local Coder participates like
    // any other bus-connected agent — no role classification, no priority, no
    // coder special-casing, no dispatch packet.
    const mag = { id: 'mag', kind: 'agent', runtimeType: 'magentic_one', title: 'Magentic-One' };
    const plan = { id: 'plan', kind: 'agent', runtimeType: 'assistant_agent', runtimeBinding: 'plan_agent', title: 'Plan Agent', runtimeOptions: { modelKey: 'gpt-5-nano' } };
    const codegraph = { id: 'codegraph', kind: 'agent', runtimeType: 'assistant_agent', runtimeBinding: 'codegraph_agent', title: 'CodeGraph Agent', runtimeOptions: { modelKey: 'gpt-5-nano' } };
    const coder = {
      id: 'coder',
      kind: 'agent',
      runtimeType: 'local_coder',
      runtimeBinding: 'local_coder',
      title: 'Local Coder',
      runtimeOptions: { modelKey: 'z-ai/glm-5.2', provider: 'openrouter' },
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

    // Bus connectivity is the only activation: the Local Coder is a participant
    // and a python worker like any other bus-connected agent — no filtering, no
    // role classification, no dispatch packet.
    expect(payload.cardRuntime.participants.map((agent) => agent.cardId)).toContain('coder');
    expect(payload.cardRuntime.runtimeScope?.pythonWorkerIds).toContain('coder');
    expect(payload.cardRuntime.participants.map((agent) => agent.cardId)).toEqual(
      expect.arrayContaining(['plan', 'codegraph', 'think']),
    );
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
    expect(fanParticipant?.provider).toBe('openai');
    expect(fanParticipant?.providerModelId).toBe('gpt-5-nano');
    // The prompt is private (sent only to Python), so it lives in privateParticipants, not the
    // public participant. That separation is intentional.
    const fanPrivate = payload.cardRuntime.privateParticipants?.find((p) => p.cardId === 'fan1');
    expect(fanPrivate?.prompt).toBe('Fan instructions.');

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
