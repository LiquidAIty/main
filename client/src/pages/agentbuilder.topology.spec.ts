import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import { INITIAL_DECK } from '../features/agentbuilder/deck/newProjectDeck';
import {
  deriveVisibleRailItems,
  hasDirectedCardConnection,
} from '../features/agentbuilder/rail/railVisibility';

const mainToGraphAgentConnected = (nodes: typeof INITIAL_DECK.nodes, edges: typeof INITIAL_DECK.edges) =>
  hasDirectedCardConnection(
    nodes,
    edges,
    (card) => card.runtime.kind === 'hermes' && card.runtime.mode === 'main',
    (card) => card.id === 'card_hermes_steward'
      && card.runtime.kind === 'hermes'
      && card.runtime.mode === 'delegate',
  );

describe('Main / Hermes / graph authority topology', () => {
  it('keeps Main as one conversation and presents the saved Agent Builder Run beneath it', () => {
    const source = readFileSync(new URL('./agentbuilder.tsx', import.meta.url), 'utf8');
    const mainInspectorProjection = /terminalContent=\{selectedCard\.runtime\.kind === 'hermes'[\s\S]*?runtime\.mode === 'main'\s*\?([\s\S]*?)\s*: selectedCard\.runtime\.kind/.exec(source)?.[1] || '';
    expect(mainInspectorProjection).toContain('main-card-cli-location');
    expect(mainInspectorProjection).not.toContain('CoderTerminalPanel');
    expect(source).toContain('data-testid="under-chat-agent-builder"');
    expect(source).toContain('run={agentBuilderRunResult}');
    expect(source).toMatch(/executeStandaloneInvocation\(\s*agentBuilderCard,\s*agentBuilderInput\.trim\(\),\s*preparedAgentBuilderOperation,\s*\)/);
    expect(source).toContain('data-testid="under-chat-agent-builder-proposal"');
    expect(source).not.toContain('title="Main CLI Terminal"');
  });
  it('preserves the stable steward identity as the temporary Graph Agent', () => {
    const serialized = JSON.stringify(INITIAL_DECK);
    expect(serialized).not.toMatch(/thinkgraph_agent|codegraph_agent|knowgraph_agent/);
    expect(INITIAL_DECK.nodes.map((node) => node.id)).toEqual(expect.arrayContaining([
      'card_main_chat',
      'card_hermes_steward',
      'card_magentic',
      'card_local_coder',
      'card_agent_builder',
    ]));
    expect(INITIAL_DECK.nodes.find((node) => node.id === 'card_hermes_steward')).toMatchObject({
      title: 'Graph Agent',
      runtime: { kind: 'hermes', mode: 'delegate', profile: 'liquidaity-hermes-steward' },
    });
  });

  it('keeps the graph workspace owner-visible regardless of Graph Agent topology', () => {
    expect(mainToGraphAgentConnected(INITIAL_DECK.nodes, INITIAL_DECK.edges)).toBe(true);
    expect(deriveVisibleRailItems({ deck: INITIAL_DECK, workspaceView: 'chat' }).showKnowledge).toBe(true);
    const disconnected = { ...INITIAL_DECK, edges: INITIAL_DECK.edges.filter((edge) => edge.target !== 'card_hermes_steward') };
    expect(mainToGraphAgentConnected(disconnected.nodes, disconnected.edges)).toBe(false);
    expect(deriveVisibleRailItems({ deck: disconnected, workspaceView: 'chat' }).showKnowledge).toBe(true);
  });

  it('requires the directed Main to Graph Agent flow edge', () => {
    const withoutHermesFlow = INITIAL_DECK.edges.filter((edge) => edge.id !== 'edge_main_chat_hermes');
    const replacement = (edgeType: string, source = 'card_main_chat', target = 'card_hermes_steward') => ({
      id: `test:${edgeType}:${source}:${target}`,
      source,
      target,
      edgeType,
    });
    expect(mainToGraphAgentConnected(INITIAL_DECK.nodes, [
      ...withoutHermesFlow,
      replacement('flow', 'card_hermes_steward', 'card_main_chat'),
    ] as any)).toBe(false);
    expect(mainToGraphAgentConnected(INITIAL_DECK.nodes, [
      ...withoutHermesFlow,
      replacement('invalid'),
    ] as any)).toBe(false);
  });

  it('keeps internal Hermes roles off the Mag One worker bus', () => {
    expect(INITIAL_DECK.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'card_main_chat', target: 'card_hermes_steward', edgeType: 'flow' }),
      expect.objectContaining({ source: 'card_worldsignals_agent', target: 'card_magentic', edgeType: 'magentic_option' }),
    ]));
    for (const internalCardId of ['card_main_chat', 'card_agent_builder', 'card_hermes_steward']) {
      expect(INITIAL_DECK.edges).not.toContainEqual(expect.objectContaining({
        source: internalCardId,
        target: 'card_magentic',
        edgeType: 'magentic_option',
      }));
    }
    expect(INITIAL_DECK.edges).toContainEqual(expect.objectContaining({
      source: 'card_magentic', target: 'card_local_coder', edgeType: 'magentic_option',
    }));
  });

  it('uses wires only as explicit help authority and gives Graph Agent no outward flow', () => {
    expect(INITIAL_DECK.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'card_main_chat', target: 'card_agent_builder', edgeType: 'flow' }),
      expect.objectContaining({ source: 'card_main_chat', target: 'card_hermes_steward', edgeType: 'flow' }),
    ]));
    expect(INITIAL_DECK.edges).toHaveLength(6);
    expect(INITIAL_DECK.edges).not.toContainEqual(expect.objectContaining({
      source: 'card_local_coder', edgeType: 'flow',
    }));
    expect(INITIAL_DECK.edges).not.toContainEqual(expect.objectContaining({
      source: 'card_main_chat', target: 'card_local_coder', edgeType: 'flow',
    }));
    expect(INITIAL_DECK.edges).not.toContainEqual(expect.objectContaining({
      source: 'card_agent_builder', target: 'card_magentic', edgeType: 'magentic_option',
    }));
    expect(INITIAL_DECK.edges).not.toContainEqual(expect.objectContaining({
      source: 'card_hermes_steward', edgeType: 'flow',
    }));
    expect(JSON.stringify(INITIAL_DECK.edges)).not.toContain('autoRun');
  });

  it('stores bounded write authority without the retired public Card-run model tool', () => {
    const byId = new Map(INITIAL_DECK.nodes.map((node) => [node.id, node]));
    const mainTools = byId.get('card_main_chat')?.runtimeOptions?.tools ?? [];
    const hermesTools = byId.get('card_hermes_steward')?.runtimeOptions?.tools ?? [];
    expect(mainTools).toEqual(expect.arrayContaining([
      'constellation.remember',
      'run_mag_one',
    ]));
    expect(mainTools).not.toEqual(expect.arrayContaining([
      'constellation.context',
      'canvas.inspect',
      'agentgraph.inspect',
      'mag_one.describe_connected_agents',
    ]));
    expect(mainTools).not.toContain('card.run_assistant_agent');
    expect(mainTools).not.toContain('web_search');
    expect(hermesTools).toEqual([
      'graphiti.add_memory',
      'graphiti.add_triplet',
      'write_mag_one_instructions',
      'card.load_graph_references',
    ]);
    expect(hermesTools).not.toEqual(expect.arrayContaining(['web_search', 'run_mag_one']));
    expect(byId.has('card_research_agent')).toBe(false);
    const hermesPrompt = byId.get('card_hermes_steward')?.prompt ?? '';
    expect(hermesPrompt).toContain('You are Graph Agent');
    expect(hermesPrompt).toContain('Team is a capability, not your identity');
    expect(hermesPrompt).toContain('Before Magentic-One');
    expect(hermesPrompt).toContain('After Magentic-One');
    expect(byId.get('card_hermes_steward')?.title).toBe('Graph Agent');
    expect(hermesPrompt).not.toContain('external Hermes agent runtime');
  });

  it('publishes explicit role grants that are filtered before Python MCP startup', () => {
    const cards = INITIAL_DECK.nodes.filter((node) =>
      node.runtime.kind === 'hermes'
      && (node.runtime.mode === 'main' || node.runtime.mode === 'delegate')
    );
    const granted = [...new Set(cards.flatMap((card) => card.runtimeOptions?.tools ?? []))];
    expect(granted.length).toBeGreaterThan(0);
    expect(granted.every((tool) => typeof tool === 'string' && tool.trim() === tool)).toBe(true);
    expect(granted).not.toContain('web_search');
    expect(INITIAL_DECK.edges).toContainEqual(expect.objectContaining({
      source: 'card_main_chat',
      target: 'card_magentic',
      targetHandle: 'task-bus-top',
      edgeType: 'magentic_control',
    }));
  });

  it('keeps broad read discovery separate from explicit write selections', () => {
    const byId = new Map(INITIAL_DECK.nodes.map((node) => [node.id, node]));
    const main = byId.get('card_main_chat');
    const coder = byId.get('card_local_coder');
    const agentBuilder = byId.get('card_agent_builder');
    const steward = byId.get('card_hermes_steward');
    const magOne = byId.get('card_magentic');

    for (const card of [main, coder, agentBuilder, steward]) {
      expect(card?.runtimeOptions?.subagentModel).toEqual({
        provider: 'openai',
        accessMode: 'chatgpt-account',
        modelKey: 'gpt-5.6-luna',
        providerModelId: 'gpt-5.6-luna',
      });
    }
    for (const card of [coder, steward]) {
      expect(card?.runtimeOptions?.team).toEqual({
        mode: 'auto', maxWorkers: 4, retryLimit: 1,
        workerModel: {
          provider: 'openai', accessMode: 'chatgpt-account',
          modelKey: 'gpt-5.6-luna', providerModelId: 'gpt-5.6-luna',
        },
        leadModel: {
          provider: 'openai', accessMode: 'chatgpt-account',
          modelKey: 'gpt-5.6-terra', providerModelId: 'gpt-5.6-terra',
        },
      });
    }
    expect(main?.runtimeOptions?.team?.mode).toBe('off');
    expect(agentBuilder?.runtimeOptions?.team?.mode).toBe('off');

    expect(main?.runtimeOptions?.tools).toContain('run_mag_one');
    expect(main?.runtimeOptions?.tools).not.toContain('card.run_assistant_agent');
    expect(main?.runtimeOptions?.toolsets).toEqual(['file', 'terminal']);
    expect(main?.runtimeOptions?.toolCatalogPolicy).toBe('all_healthy');
    expect(main?.prompt).toContain('delegate_task(role="profile")');
    expect(main?.prompt).toContain('A wire grants authority but never starts work');
    expect(main?.prompt).toContain('send one exact mission and the deliberately selected native graph references');
    expect(main?.prompt).toContain('Do not copy this conversation or Main memory into another Card');
    expect(main?.prompt).toContain('A normal handoff executes immediately');
    expect(main?.prompt).toContain('existing Card CLI input and Context editors');
    expect(main?.prompt).toContain('official MCP run_mag_one seam');

    expect(coder).toMatchObject({
      title: 'Local Coder',
      runtime: { kind: 'hermes', mode: 'delegate', profile: 'coder' },
      runtimeOptions: {
        accessMode: 'chatgpt-account',
        nativeTools: ['memory'],
        toolsets: ['hermes-acp', 'computer_use'],
        toolCatalogPolicy: 'all_healthy',
      },
    });
    expect(coder?.runtimeOptions?.tools).toEqual([
      'cbm.search_graph',
      'cbm.trace_path',
      'cbm.get_code_snippet',
      'cbm.check_index_coverage',
      'cbm.detect_changes',
    ]);
    expect(coder?.runtimeOptions?.tools).not.toContain('card.run_assistant_agent');
    expect(coder?.runtimeOptions?.tools).not.toEqual(expect.arrayContaining([
      'run_mag_one',
      'graphiti.add_memory',
    ]));
    expect(coder?.prompt).toContain('You are Local Coder');
    expect(coder?.prompt).toContain('Native delegate_task is available');
    expect(coder?.prompt).toContain('children remain parts of this Coder Card');
    expect(coder?.prompt).not.toContain('retask the saved Kanban Card');

    expect(agentBuilder).toMatchObject({
      title: 'Agent Builder',
      runtime: { kind: 'hermes', mode: 'delegate', profile: 'liquidaity-agent-builder' },
      runtimeOptions: {
        accessMode: 'chatgpt-account',
        nativeTools: ['memory'],
        skills: ['hermes-agent', 'agent-builder-inspection'],
        toolsets: ['hermes-acp'],
        toolCatalogPolicy: 'selected',
        tools: [
          'canvas.inspect', 'card.create', 'card.update_configuration',
          'cbm.search_graph', 'cbm.trace_path', 'cbm.get_code_snippet',
          'cbm.check_index_coverage', 'cbm.detect_changes',
        ],
      },
    });
    expect(agentBuilder?.runtimeOptions?.toolCatalogPolicy).toBe('selected');
    expect(agentBuilder?.runtimeOptions).toMatchObject({
      modelKey: 'gpt-5.6-sol',
      providerModelId: 'gpt-5.6-sol',
    });
    expect(agentBuilder?.prompt).toContain('Execute the one run-issued Agent Builder create or edit operation');
    expect(agentBuilder?.prompt).toContain('Use card.update_configuration only in edit mode');
    expect(agentBuilder?.prompt).toContain('IDD supplies compositional templates, types, and effect contracts');
    expect(agentBuilder?.prompt).toContain('Never copy Local Coder memory');

    expect(steward?.runtimeOptions?.tools).not.toContain('run_mag_one');
    expect(steward?.runtimeOptions?.tools).not.toContain('card.run_assistant_agent');
    expect(steward?.runtimeOptions?.tools).toContain('write_mag_one_instructions');
    expect(steward?.runtimeOptions?.toolsets ?? []).toEqual(['web']);
    expect(steward?.runtimeOptions?.toolCatalogPolicy).toBe('all_healthy');
    expect(steward?.prompt).toContain('Do not use a repository-writing terminal');
    expect(steward?.prompt).toContain('Use native delegate_task(role="profile")');
    expect(steward?.prompt).toContain('Use card.load_graph_references and write_mag_one_instructions only when');
    expect(steward?.prompt).toContain('Inspect the supplied current native graph data first');
    expect(steward?.prompt).toContain('Firecrawl backend');
    expect(steward?.prompt).toContain('Do not create recursive workers');

    expect(magOne).toMatchObject({
      runtime: { kind: 'autogen', mode: 'magentic_one' },
    });
    expect(INITIAL_DECK.nodes.filter(
      (node) => node.runtime.kind === 'hermes' && node.runtime.mode === 'kanban',
    )).toEqual([]);
  });

});
