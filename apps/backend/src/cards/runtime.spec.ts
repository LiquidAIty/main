import { describe, it, expect } from 'vitest';
import {
  resolvedMagenticOptions,
  resolvedMagenticControllers,
  resolveDirectSubagents,
  buildPythonAutoGenCardRuntimePayload,
  runCardWithContract,
  resolveCardModelStrict,
} from './runtime';

// Canonical DeepSeek model — same saved-card validation path as any other
// OpenRouter entry; no override logic, no OpenAI fallback.
describe('canonical DeepSeek V4 Flash 0731 card contract', () => {
  it('resolves through the saved OpenRouter card contract', () => {
    expect(
      resolveCardModelStrict({
        id: 'card_deepseek',
        runtimeType: 'assistant_agent',
        runtimeOptions: {
          provider: 'openrouter',
          modelKey: 'deepseek/deepseek-v4-flash-0731',
        },
      }),
    ).toEqual({
      provider: 'openrouter',
      providerModelId: 'deepseek/deepseek-v4-flash-0731',
    });
  });

  it('rejects an OpenRouter selection that mismatches the saved provider', () => {
    expect(() =>
      resolveCardModelStrict({
        id: 'card_deepseek',
        runtimeType: 'assistant_agent',
        runtimeOptions: {
          provider: 'openai',
          modelKey: 'deepseek/deepseek-v4-flash-0731',
        },
      }),
    ).toThrow(/card_model_config_mismatch/);
  });
});

// C-1 regressed twice because an unrecognised edgeType silently normalised to
// 'flow' — the one type that grants invocation authority. These lock that shut.
describe('Edge authority: only an explicit type grants anything', () => {
  const main = {
    id: 'card_main_chat', kind: 'agent', runtimeType: 'assistant_agent',
    runtimeBinding: 'main_chat', title: 'Main',
  };
  const hermes = {
    id: 'card_hermes_steward', kind: 'agent', runtimeType: 'assistant_agent',
    runtimeBinding: 'hermes_steward', title: 'Hermes',
  };
  const mag = { id: 'card_magentic', kind: 'agent', runtimeType: 'magentic_one', title: 'Mag One' };
  const worker = {
    id: 'card_research_agent', kind: 'agent', runtimeType: 'assistant_agent',
    runtimeBinding: 'research_agent', title: 'Research',
  };
  const cards = [main, hermes, mag, worker];

  const edge = (source: string, target: string, edgeType: unknown) => ({
    id: `e_${source}_${target}`, source, target, edgeType,
  });

  it.each([
    ['a typo', 'floww'],
    ['a legacy label', 'reports_to'],
    ['empty string', ''],
    ['undefined', undefined],
    ['null', null],
    ['an object', { nope: true }],
  ])('an unknown edge type (%s) from Main creates NO doorway', (_label, badType) => {
    const doorways = resolveDirectSubagents(main.id, cards, [edge(main.id, hermes.id, badType)]);
    expect(doorways).toEqual([]);
  });

  it('an explicit flow edge from Main DOES create a doorway (Main -> Hermes Call)', () => {
    const doorways = resolveDirectSubagents(main.id, cards, [edge(main.id, hermes.id, 'flow')]);
    expect(doorways.map((d: any) => d.id)).toEqual(['card_hermes_steward']);
  });

  it('an unknown edge type never becomes a Mag One worker plug', () => {
    const workers = resolvedMagenticOptions(mag.id, cards, [edge(worker.id, mag.id, 'magentic_optionn')]);
    expect(workers).toEqual([]);
  });

  it('one invalid edge does not silently alter valid topology around it', () => {
    const edges = [
      edge(main.id, hermes.id, 'flow'),              // valid Call
      edge(main.id, mag.id, 'magentic_control'),     // valid Control plug
      edge(worker.id, mag.id, 'magentic_option'),    // valid Worker plug
      edge(worker.id, main.id, 'garbage'),           // invalid: must be inert
    ];
    expect(resolveDirectSubagents(main.id, cards, edges).map((d: any) => d.id))
      .toEqual(['card_hermes_steward']);
    expect(resolvedMagenticOptions(mag.id, cards, edges).map((w: any) => w.id))
      .toEqual(['card_research_agent']);
    expect(resolvedMagenticControllers(mag.id, cards, edges).map((c: any) => c.id))
      .toEqual(['card_main_chat']);
  });

  it('the Main → Hermes flow edge exposes Hermes directly but never as a Mag One worker', () => {
    const persisted = [
      { id: 'edge_main_chat_magentic_control', source: 'card_main_chat', target: 'card_magentic', edgeType: 'magentic_control' },
      { id: 'edge_main_chat_hermes', source: 'card_main_chat', target: 'card_hermes_steward', edgeType: 'flow' },
      { id: 'edge_k0psgj4i', source: 'card_research_agent', target: 'card_magentic', edgeType: 'magentic_option' },
    ];
    expect(resolveDirectSubagents('card_main_chat', cards, persisted).map((d: any) => d.id))
      .toContain('card_hermes_steward');
    expect(resolvedMagenticOptions('card_magentic', cards, persisted).map((w: any) => w.id))
      .not.toContain('card_hermes_steward');
  });

});

describe('Canonical Cards Runtime', () => {
  it('normal chat submit is planning only: no coding-intent participant gate, no coder dispatch', async () => {
    // Chat submit must not classify intent or impose a coding participant gate.
    // With no bus-connected agents it fails with the honest "no participants"
    // error — never the coder-console gate, and never a coder dispatch/timeout.
    const card = { id: 'mag1', kind: 'agent', runtimeType: 'magentic_one' };
    await expect(
      runCardWithContract(card, 'can you do a code audit', { allCards: [card], allEdges: [] }),
    ).rejects.toThrow('magentic_runtime_no_current_bus_connected_participants');
    await expect(
      runCardWithContract(card, 'can you do a code audit', { allCards: [card], allEdges: [] }),
    ).rejects.not.toThrow(/MAGONE_CODER_CONSOLE_BLOCKED_PARTICIPANT_GATE/);
  });

  it('chat submit builds no codingWorkflowPacket and does not classify intent as coding', () => {
    const mag = { id: 'mag', kind: 'agent', runtimeType: 'magentic_one', title: 'Magentic-One' };
    const coder = {
      id: 'coder', kind: 'agent', runtimeType: 'local_coder', runtimeBinding: 'local_coder',
      title: 'Local Coder', runtimeOptions: {
        modelKey: 'deepseek/deepseek-v4-flash-0731',
        provider: 'openrouter',
        tools: ['run_local_coder', 'cbm.list_projects'],
      },
    };
    const codegraph = {
      id: 'codegraph', kind: 'agent', runtimeType: 'assistant_agent', runtimeBinding: 'codegraph_agent',
      title: 'CodeGraph Agent', runtimeOptions: { modelKey: 'gpt-5.6-luna' },
    };
    const allCards = [mag, coder, codegraph];
    const allEdges = [coder, codegraph].map((agent) => ({
      id: `edge-${agent.id}`, source: agent.id, target: mag.id, edgeType: 'magentic_option',
    }));
    const callable = resolvedMagenticOptions(mag.id, allCards, allEdges);
    const payload = buildPythonAutoGenCardRuntimePayload(
      mag, 'fix the code', { projectId: 'admin', deckId: 'deck', allCards, allEdges }, {}, callable, '2026',
    );

    // No TypeScript coder packet is ever attached to a planning turn. Retired
    // fields have no type-level home anymore, so assert their absence on the
    // untyped payload shape rather than a property that no longer compiles.
    const untypedPayload = payload as unknown as Record<string, unknown>;
    expect(untypedPayload.codingWorkflowPacket).toBeUndefined();
    // The capability manifest carries no intent/workflow classifier at all.
    expect((untypedPayload.routingManifest as any)?.intent).toBeUndefined();
    // Native team: every bus-connected saved card participates. Coder keeps its
    // saved identity/model while its outer wrapper carries only run_local_coder.
    expect(payload.cardRuntime.participants.map((p) => p.cardId)).toContain('coder');
    expect(payload.cardRuntime.participants.map((p) => p.cardId)).toContain('codegraph');
    const coderParticipant = payload.cardRuntime.participants.find((p) => p.cardId === 'coder');
    expect(coderParticipant?.runtimeType).toBe('assistant_agent');
    expect(coderParticipant?.runtimeBinding).toBe('local_coder');
    expect(coderParticipant?.tools).toEqual(['run_local_coder']);
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

  it('discovers an explicitly bus-connected workspace card without pretending topology proves readiness', () => {
    const cardM = { id: 'mag1', kind: 'agent', runtimeType: 'magentic_one' };
    const workbench = {
      id: 'trading',
      kind: 'agent',
      runtimeType: 'assistant_agent',
      runtimeBinding: 'trading_agent',
      parentGraphId: 'workbench_trading',
    };
    const edges = [
      { id: 'trading-worker', source: workbench.id, target: cardM.id, edgeType: 'magentic_option' },
    ];

    expect(resolvedMagenticOptions(cardM.id, [cardM, workbench], edges).map((node) => node.id))
      .toEqual(['trading']);
  });

  it('does not treat the visually bus-connected main_chat controller as a Mag One worker', () => {
    const cardM = { id: 'card_magentic', kind: 'agent', runtimeType: 'magentic_one' };
    const mainChat = {
      id: 'card_main_chat',
      kind: 'agent',
      runtimeType: 'assistant_agent',
      runtimeBinding: 'main_chat',
      runtimeOptions: { provider: 'openai', modelKey: 'gpt-5.6-luna' },
    };
    const think = {
      id: 'card_saved_worker',
      kind: 'agent',
      runtimeType: 'assistant_agent',
      runtimeBinding: 'saved_worker',
      runtimeOptions: { modelKey: 'gpt-5.6-luna' },
    };
    const edges = [
      { id: 'edge_main_chat_harness_bus', source: mainChat.id, target: cardM.id, edgeType: 'magentic_option' },
      { id: 'edge_thinkgraph', source: think.id, target: cardM.id, edgeType: 'magentic_option' },
    ];

    const resolved = resolvedMagenticOptions(cardM.id, [cardM, mainChat, think], edges);
    expect(resolved.map((node) => node.id)).toEqual(['card_saved_worker']);
  });

  it('resolves magentic_control separately from worker options', () => {
    const mag = { id: 'mag', kind: 'agent', runtimeType: 'magentic_one' };
    const main = { id: 'main', kind: 'agent', runtimeType: 'assistant_agent', runtimeBinding: 'main_chat' };
    const worker = { id: 'worker', kind: 'agent', runtimeType: 'assistant_agent' };
    const edges = [
      { id: 'control', source: main.id, target: mag.id, targetHandle: 'task-bus-top', edgeType: 'magentic_control' },
      { id: 'option', source: mag.id, target: worker.id, edgeType: 'magentic_option' },
    ];
    expect(resolvedMagenticControllers(mag.id, [mag, main, worker], edges).map((node) => node.id)).toEqual(['main']);
    expect(resolvedMagenticOptions(mag.id, [mag, main, worker], edges).map((node) => node.id)).toEqual(['worker']);
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
      'test',
      { previousOutput: 'Some Apollo 11 text' },
      {},
      [{ id: 'agentA', runtimeType: 'assistant_agent', runtimeOptions: { modelKey: 'gpt-5.6-luna' } }],
      '2026'
    );
    // No deterministic keyword classifier: 'test'/'go'/'hello' no longer strip the
    // prior assistant text — the mission passes through unchanged.
    expect(payload).not.toHaveProperty('priorAssistantText');
    expect(payload.userText).toBe('test');
  });

  it('invalid saved maxTokens fails visibly instead of being omitted', () => {
    expect(() => buildPythonAutoGenCardRuntimePayload(
      { id: 'mag1', runtimeOptions: { maxTokens: 0 } },
      'test input',
      {},
      {},
      [{ id: 'agentA', runtimeType: 'assistant_agent', runtimeOptions: { modelKey: 'gpt-5.6-luna' } }],
      '2026'
    )).toThrow('card_maxTokens_invalid');
  });

  it('transports a card-selected KnowGraph retrieval tool to the Python participant set', () => {
    const cardM = { id: 'mag1', kind: 'agent', runtimeType: 'magentic_one' };
    const research = {
      id: 'research', kind: 'agent', runtimeType: 'assistant_agent', title: 'Research Agent',
      runtimeOptions: { modelKey: 'gpt-5.6-luna', tools: ['calculator'] },
    };
    const allCards = [cardM, research];
    const allEdges = [{ id: 'e', source: research.id, target: cardM.id, edgeType: 'magentic_option' }];
    const callable = resolvedMagenticOptions(cardM.id, allCards, allEdges);
    const payload = buildPythonAutoGenCardRuntimePayload(
      cardM, 'do research', { projectId: 'p', deckId: 'd', allCards, allEdges }, {}, callable, '2026',
    );
    const participant = payload.cardRuntime.participants.find((p) => p.cardId === 'research');
    expect(participant?.tools).toContain('calculator');
  });

  it('passes a worker tool selection without adding hidden graph authority', () => {
    const cardM = { id: 'mag1', kind: 'agent', runtimeType: 'magentic_one' };
    const think = {
      id: 'think',
      kind: 'agent',
      runtimeType: 'assistant_agent',
      runtimeBinding: 'world_signals',
      runtimeOptions: {
        modelKey: 'z-ai/glm-5.2',
        provider: 'openrouter',
        tools: ['worldsignals.capabilities', 'worldsignals.command'],
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
      cardM, 'probe graph tools', { projectId: 'project-1', deckId: 'deck', allCards, allEdges }, {}, callable, '2026',
    );

    expect(payload.cardRuntime.participants.find((p) => p.cardId === 'think')?.tools).toEqual([
      'worldsignals.capabilities',
      'worldsignals.command',
    ]);
  });

  it('contains no prompt packet graph authority field or hard-coded mission strings in the Mag One payload', () => {
    const cardM = { id: 'mag1', kind: 'agent', runtimeType: 'magentic_one' };
    const think = {
      id: 'think',
      kind: 'agent',
      runtimeType: 'assistant_agent',
      runtimeBinding: 'world_signals',
      runtimeOptions: { modelKey: 'z-ai/glm-5.2', provider: 'openrouter', tools: ['worldsignals.capabilities'] },
    };
    const payload = buildPythonAutoGenCardRuntimePayload(
      cardM, 'generic task', { projectId: 'project-1', deckId: 'deck', allCards: [cardM, think], allEdges: [] }, {}, [think], '2026',
    );
    const raw = JSON.stringify(payload);
    expect(raw).not.toContain('thinkGraphReadAuthority');
    expect(raw).not.toContain('magone_graph_tool_probe');
    expect(raw).not.toContain('trading');
    expect(raw).not.toContain('EDGAR');
    expect(raw).not.toContain('liquidity');
  });

  it('Python payload compatibility matches expected shape', () => {
    const cardM = { id: 'mag1', kind: 'agent', runtimeType: 'magentic_one', prompt: 'test system prompt' };
    const cardA = { id: 'agentA', kind: 'agent', runtimeType: 'assistant_agent', runtimeOptions: { modelKey: 'gpt-5.6-luna' } };
    const context = { deckId: 'deck1', allCards: [cardM, cardA], allEdges: [] };

    const payload = buildPythonAutoGenCardRuntimePayload(cardM, 'hello', context, {}, [cardA], '2026');

    expect(payload.session.orchestrator).toBe('magentic_one');
    // System prompt is EXACTLY the card's own prompt — no backend-authored global
    // coding persona is prepended.
    expect(payload.cardRuntime.prompt).toBe('test system prompt');
    expect(payload.cardRuntime.prompt).not.toContain('disconnected cards are ineligible');
    expect(payload.cardRuntime.participants.map((participant) => participant.cardId)).toContain('agentA');
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
    const cardA = { id: 'agentA', runtimeType: 'assistant_agent', runtimeOptions: { modelKey: 'gpt-5.6-luna' } };
    const payload = buildPythonAutoGenCardRuntimePayload(
      cardM, 'Continue RDW research', { allCards: [cardM, cardA], allEdges: [] }, {}, [cardA], '2026',
    );
    // No grounding field on the payload and no grounding/ActiveGraphContext prose in
    // the system prompt — the system prompt is exactly the card prompt.
    expect((payload as any).taskLedgerGroundingContext).toBeUndefined();
    expect((payload as any).activeGraphContext).toBeUndefined();
    expect(payload.cardRuntime.prompt).toBe('sys');
    expect(payload.cardRuntime.prompt).not.toContain('graphGroundingContext');
    expect(payload.cardRuntime.prompt).not.toMatch(/READ it before creating tasks/i);
    // The forced task-ledger output contract is gone from the payload entirely.
    expect((payload.cardRuntime as any).taskLedgerOutputContract).toBeUndefined();
    // No approval gate rides the payload.
    expect((payload as any).runApproved).toBeUndefined();
  });

  it('includes the Local Coder as a native bus participant like any other agent', () => {
    // Bus connectivity is the only activation. The saved Coder remains a normal
    // eligible card; only its established controller-tool boundary is distinct.
    const mag = { id: 'mag', kind: 'agent', runtimeType: 'magentic_one', title: 'Magentic-One' };
    const plan = { id: 'plan', kind: 'agent', runtimeType: 'assistant_agent', runtimeBinding: 'plan_agent', title: 'Plan Agent', runtimeOptions: { modelKey: 'gpt-5.6-luna' } };
    const codegraph = { id: 'codegraph', kind: 'agent', runtimeType: 'assistant_agent', runtimeBinding: 'codegraph_agent', title: 'CodeGraph Agent', runtimeOptions: { modelKey: 'gpt-5.6-luna' } };
    const coder = {
      id: 'coder',
      kind: 'agent',
      runtimeType: 'local_coder',
      runtimeBinding: 'local_coder',
      title: 'Local Coder',
      runtimeOptions: {
        modelKey: 'deepseek/deepseek-v4-flash-0731',
        provider: 'openrouter',
        tools: ['run_local_coder', 'cbm.list_projects'],
      },
    };
    const think = { id: 'worker', kind: 'agent', runtimeType: 'assistant_agent', runtimeBinding: 'saved_worker', title: 'Saved Worker', runtimeOptions: { modelKey: 'gpt-5.6-luna' } };
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
      'fix the code',
      { projectId: 'admin', deckId: 'deck', allCards, allEdges },
      {},
      callable,
      '2026',
    );

    // Bus connectivity activates the saved Coder. Its Python participant is the
    // outer AssistantAgent controller, not a second Coder engine.
    expect(payload.cardRuntime.participants.map((agent) => agent.cardId)).toContain('coder');
    const coderParticipant = payload.cardRuntime.participants.find((agent) => agent.cardId === 'coder');
    expect(coderParticipant?.runtimeType).toBe('assistant_agent');
    expect(coderParticipant?.runtimeBinding).toBe('local_coder');
    expect(coderParticipant?.tools).toEqual(['run_local_coder']);
    expect(payload.cardRuntime.participants.map((agent) => agent.cardId)).toEqual(
      expect.arrayContaining(['plan', 'codegraph', 'worker']),
    );
  });

  it('disconnected cards do not appear in model-visible workspace context or payload participants', () => {
    const cardM = { id: 'mag1', kind: 'agent', runtimeType: 'magentic_one' };
    const cardConnected = { id: 'conn1', kind: 'agent', runtimeType: 'assistant_agent', runtimeOptions: { modelKey: 'gpt-5.6-luna' } };
    const cardDisconnected = { id: 'disc1', kind: 'agent', runtimeType: 'assistant_agent' };

    // cardConnected is connected, cardDisconnected is not.
    const context = {
      deckId: 'deck1',
      allCards: [cardM, cardConnected, cardDisconnected],
      allEdges: [{ id: 'e1', source: cardM.id, target: cardConnected.id, edgeType: 'magentic_option' }]
    };

    const callableHeads = resolvedMagenticOptions(cardM.id, context.allCards, context.allEdges);

    const payload = buildPythonAutoGenCardRuntimePayload(
      cardM, 'hello', context, {}, callableHeads, '2026'
    );

    // disconnected cards should not be in participants
    expect(payload.cardRuntime.participants.map(p => p.cardId)).not.toContain('disc1');
    expect(payload.cardRuntime.participants.map(p => p.cardId)).toContain('conn1');

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
      cardM, 'hello', context, {}, callableHeads, '2026'
    );

    expect(payload.cardRuntime.participants.map(p => p.cardId)).not.toContain('flow1');
  });

  // T002 — Failing tests: card-selected model config must propagate to payload exactly.
  // These tests must fail before T003 is applied (current code hardcodes 'openrouter'/'default').

  it('participants carry the card-selected provider and model exactly once', () => {
    const selectedModelKey = 'gpt-5.6-luna';         // real MODEL_REGISTRY key — fixture only, not a default
    const selectedProvider = 'openai';                        // MODEL_REGISTRY[selectedModelKey].provider
    const selectedProviderModelId = 'gpt-5.6-luna';  // MODEL_REGISTRY[selectedModelKey].id

    const cardM = { id: 'mag1', kind: 'agent', runtimeType: 'magentic_one' };
    const cardA = {
      id: 'agentA', kind: 'agent', runtimeType: 'assistant_agent',
      runtimeOptions: { modelKey: selectedModelKey },
    };

    const payload = buildPythonAutoGenCardRuntimePayload(
      cardM, 'test', {}, {}, [cardA], '2026',
    );

    const participant = payload.cardRuntime.participants[0];
    expect(participant).toBeDefined();
    expect(participant?.provider).toBe(selectedProvider);
    expect(participant?.providerModelId).toBe(selectedProviderModelId);
    expect(participant?.providerModelId).not.toBe('default');
    expect(participant?.providerModelId).not.toBe('');
    expect(payload.cardRuntime).not.toHaveProperty('privateParticipants');
  });

  it('participants[] carry the same card-selected provider and providerModelId', () => {
    const selectedModelKey = 'gpt-5.6-luna';
    const selectedProvider = 'openai';
    const selectedProviderModelId = 'gpt-5.6-luna';

    const cardM = { id: 'mag1', kind: 'agent', runtimeType: 'magentic_one' };
    const cardA = {
      id: 'agentA', kind: 'agent', runtimeType: 'assistant_agent',
      runtimeOptions: { modelKey: selectedModelKey },
    };

    const payload = buildPythonAutoGenCardRuntimePayload(
      cardM, 'test', {}, {}, [cardA], '2026',
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
      buildPythonAutoGenCardRuntimePayload(cardM, 'test', {}, {}, [cardA], '2026'),
    ).toThrow('card_model_config_missing');
  });

  it('throws card_model_config_mismatch when runtimeOptions.provider conflicts with registry provider', () => {
    const cardM = { id: 'mag1', kind: 'agent', runtimeType: 'magentic_one' };
    const cardA = {
      id: 'agentA', kind: 'agent', runtimeType: 'assistant_agent',
      runtimeOptions: {
        modelKey: 'gpt-5.6-luna',   // registry provider = 'openai'
        provider: 'openrouter',    // conflicts → mismatch
      },
    };

    expect(() =>
      buildPythonAutoGenCardRuntimePayload(cardM, 'test', {}, {}, [cardA], '2026'),
    ).toThrow('card_model_config_mismatch');
  });

  it('card settings survive: tools, explicit model config, and instructions', () => {
    const cardM = { id: 'mag1', kind: 'agent', runtimeType: 'magentic_one' };
    const cardFan = {
      id: 'fan1', kind: 'agent', runtimeType: 'assistant_agent', title: 'Fan',
      prompt: 'Fan instructions.',
      runtimeOptions: {
        modelKey: 'gpt-5.6-luna',
        tools: ['current_datetime'],
      },
    };
    const cardSom = {
      id: 'som1', kind: 'agent', runtimeType: 'assistant_agent', title: 'Som',
      prompt: 'Som instructions.',
      runtimeOptions: { modelKey: 'gpt-5.6-luna' },
    };
    const child = {
      id: 'child1', kind: 'agent', runtimeType: 'assistant_agent', parentGraphId: 'som1',
      prompt: 'Child instructions.',
      runtimeOptions: { modelKey: 'gpt-5.6-luna', tools: ['calculator'] },
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
      cardM, 'hello', context, {}, [cardFan, cardSom], '2026',
    );

    const fanParticipant = payload.cardRuntime.participants.find((p) => p.cardId === 'fan1');
    expect(fanParticipant?.tools).toEqual(['current_datetime']);
    expect(fanParticipant?.provider).toBe('openai');
    expect(fanParticipant?.providerModelId).toBe('gpt-5.6-luna');
    expect(fanParticipant?.prompt).toBe('Fan instructions.');

  });

  it('transports selected tool ids to the canonical Python registry unchanged', () => {
    const cardM = { id: 'mag1', kind: 'agent', runtimeType: 'magentic_one' };
    const cardA = {
      id: 'agentA', kind: 'agent', runtimeType: 'assistant_agent',
      runtimeOptions: { modelKey: 'gpt-5.6-luna', tools: ['made_up_tool'] },
    };

    const payload = buildPythonAutoGenCardRuntimePayload(cardM, 'test', {}, {}, [cardA], '2026');
    const participant = payload.cardRuntime.participants.find((entry) => entry.cardId === 'agentA');
    expect(participant?.tools).toEqual(['made_up_tool']);
  });

  it('empty card tool name fails loudly with card_tool_name_empty', () => {
    const cardM = { id: 'mag1', kind: 'agent', runtimeType: 'magentic_one' };
    const cardA = {
      id: 'agentA', kind: 'agent', runtimeType: 'assistant_agent',
      runtimeOptions: { modelKey: 'gpt-5.6-luna', tools: ['  '] },
    };

    expect(() =>
      buildPythonAutoGenCardRuntimePayload(cardM, 'test', {}, {}, [cardA], '2026'),
    ).toThrow('card_tool_name_empty');
  });

  it('known enabled tools pass through unchanged', () => {
    const cardM = { id: 'mag1', kind: 'agent', runtimeType: 'magentic_one' };
    const cardA = {
      id: 'agentA', kind: 'agent', runtimeType: 'assistant_agent',
      runtimeOptions: { modelKey: 'gpt-5.6-luna', tools: ['current_datetime', 'calculator'] },
    };

    const payload = buildPythonAutoGenCardRuntimePayload(cardM, 'test', {}, {}, [cardA], '2026');
    const participant = payload.cardRuntime.participants.find((p) => p.cardId === 'agentA');
    expect(participant?.tools).toEqual(['current_datetime', 'calculator']);
  });

  it('providerModelId is never default or empty string in any participant payload', () => {
    const selectedModelKey = 'gpt-5.6-luna';  // fixture — not a default

    const cardM = { id: 'mag1', kind: 'agent', runtimeType: 'magentic_one' };
    const cardA = {
      id: 'agentA', kind: 'agent', runtimeType: 'assistant_agent',
      runtimeOptions: { modelKey: selectedModelKey },
    };

    const payload = buildPythonAutoGenCardRuntimePayload(
      cardM, 'test', {}, {}, [cardA], '2026',
    );

    const pub = payload.cardRuntime.participants?.[0];
    expect(pub?.providerModelId).not.toBe('default');
    expect(pub?.providerModelId).not.toBe('');
    expect(payload.cardRuntime).not.toHaveProperty('privateParticipants');
  });
});
