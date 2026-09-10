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
  it('keeps Main as one conversation and presents the saved Agent Builder native CLI beneath it', () => {
    const source = readFileSync(new URL('./agentbuilder.tsx', import.meta.url), 'utf8');
    expect(source).not.toContain('main-card-cli-location');
    expect(source).not.toContain('onOpenMainChat');
    expect(source).toContain("BUILDER_NODE_TABS.filter((entry) => entry !== 'CLI'");
    expect(source).toContain('selectedCard.id !== mainCardId && selectedCard.id !== agentBuilderCard?.id');
    expect(source).toContain("setTab(cardId === mainCardId || cardId === agentBuilderCard?.id ? 'Prompt' : 'CLI')");
    expect(source).toContain('data-testid="under-chat-agent-builder"');
    const underChat = source.slice(source.indexOf('const agentBuilderTerminal ='), source.indexOf('terminal={agentBuilderTerminal}'));
    expect(underChat).toContain('<CoderTerminalPanel');
    expect(underChat).toContain('ownerCardId={agentBuilderCard.id}');
    expect(underChat).toContain('profile: agentBuilderCard.runtime.profile');
    expect(underChat).not.toContain('workspaceView');
    expect(underChat).not.toContain('data-testid="agent-builder-output"');
    expect(underChat).not.toContain('builderResult');
    expect(underChat).toContain('readOnly={!directInput}');
    expect(underChat).not.toContain('<AdaptiveCardTerminal');
    expect(underChat).not.toContain('Run Agent Builder');
    expect(source).not.toContain('title="Main CLI Terminal"');
  });
  it('preserves the stable steward identity as the temporary Graph Agent', () => {
    const serialized = JSON.stringify(INITIAL_DECK);
    expect(serialized).not.toMatch(/thinkgraph_agent|codegraph_agent|knowgraph_agent/);
    expect(INITIAL_DECK.nodes.map((node) => node.id)).toEqual(expect.arrayContaining([
      'card_main_chat',
      'card_hermes_steward',
      'card_magentic',
      'builder',
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
    for (const internalCardId of ['card_main_chat', 'builder', 'card_hermes_steward']) {
      expect(INITIAL_DECK.edges).not.toContainEqual(expect.objectContaining({
        source: internalCardId,
        target: 'card_magentic',
        edgeType: 'magentic_option',
      }));
    }
    expect(INITIAL_DECK.nodes.some(node => node.id === 'card_local_coder')).toBe(false);
  });

  it('connects Main only to Builder, Graph Agent, and Mag One, with other workers on the bus', () => {
    expect(INITIAL_DECK.edges.filter((edge) => edge.edgeType === 'flow')).toEqual([
      expect.objectContaining({ source: 'card_main_chat', target: 'card_hermes_steward', edgeType: 'flow' }),
      expect.objectContaining({ source: 'card_main_chat', target: 'builder', edgeType: 'flow' }),
    ]);
    expect(INITIAL_DECK.edges).toHaveLength(5);
    expect(INITIAL_DECK.edges.filter((edge) => edge.edgeType === 'magentic_control')).toEqual([
      expect.objectContaining({ source: 'card_main_chat', target: 'card_magentic' }),
    ]);
    const workerEdges = INITIAL_DECK.edges.filter((edge) => edge.edgeType === 'magentic_option');
    expect(workerEdges.map((edge) => edge.source === 'card_magentic' ? edge.target : edge.source).sort())
      .toEqual(['card_trading_workbench', 'card_worldsignals_agent']);
    expect(workerEdges.every((edge) => edge.source === 'card_magentic' || edge.target === 'card_magentic')).toBe(true);
    expect(INITIAL_DECK.edges).not.toContainEqual(expect.objectContaining({
      source: 'card_local_coder', edgeType: 'flow',
    }));
    expect(INITIAL_DECK.edges).not.toContainEqual(expect.objectContaining({
      source: 'card_main_chat', target: 'card_local_coder', edgeType: 'flow',
    }));
    expect(INITIAL_DECK.edges).not.toContainEqual(expect.objectContaining({
      source: 'builder', target: 'card_magentic', edgeType: 'magentic_option',
    }));
    expect(JSON.stringify(INITIAL_DECK.edges)).not.toContain('autoRun');
  });

  it('stores bounded write authority without the retired public Card-run model tool', () => {
    const byId = new Map(INITIAL_DECK.nodes.map((node) => [node.id, node]));
    const mainTools = byId.get('card_main_chat')?.runtimeOptions?.tools ?? [];
    const hermesTools = byId.get('card_hermes_steward')?.runtimeOptions?.tools ?? [];
    expect(mainTools).toEqual(expect.arrayContaining([
      'engraphis_remember',
      'run_mag_one',
    ]));
    expect(mainTools).not.toEqual(expect.arrayContaining([
      'engraphis_recall_context',
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
    const agentBuilder = byId.get('builder');
    const steward = byId.get('card_hermes_steward');
    const magOne = byId.get('card_magentic');

    for (const card of [main, agentBuilder, steward]) {
      expect(card?.runtimeOptions?.subagentModel).toEqual({
        provider: 'openai',
        accessMode: 'chatgpt-account',
        modelKey: 'gpt-5.6-luna',
        providerModelId: 'gpt-5.6-luna',
      });
    }
    for (const card of [steward]) {
      expect(card?.runtimeOptions?.delegationRole).toBe('team');
    }
    // Native delegation consumes the saved role and subagent model. The
    // removed host Team configuration must not return in new-project seeds.
    for (const card of [main, agentBuilder, steward]) {
      expect(card?.runtimeOptions).not.toHaveProperty('team');
    }
    expect(main?.runtimeOptions?.delegationRole).toBe('profile');
    expect(agentBuilder?.runtimeOptions?.delegationRole ?? 'off').toBe('off');

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

    expect(agentBuilder).toMatchObject({
      title: 'Builder',
      runtime: { kind: 'hermes', mode: 'delegate', profile: 'builder' },
      runtimeOptions: {
        accessMode: 'chatgpt-account',
        nativeTools: ['memory'],
        skills: ['hermes-agent', 'agent-builder-inspection'],
        toolsets: ['web', 'terminal', 'file', 'browser', 'vision', 'code_execution'],
        toolCatalogPolicy: 'selected',
        tools: [
          'canvas.inspect', 'card.create', 'card.update_configuration',
          'cbm.search_graph', 'cbm.trace_path', 'cbm.get_code_snippet',
          'cbm.check_index_coverage', 'cbm.detect_changes', 'cbm.search_code', 'cbm.query_graph',
        ],
      },
    });
    expect(agentBuilder?.runtimeOptions?.toolCatalogPolicy).toBe('selected');
    expect(agentBuilder?.runtimeOptions).toMatchObject({
      modelKey: 'gpt-5.6-sol',
      providerModelId: 'gpt-5.6-sol',
    });
    expect(agentBuilder?.prompt).toContain('general construction agent');
    expect(agentBuilder?.prompt).toContain('card.create or card.update_configuration with explicit arguments');
    expect(agentBuilder?.prompt).toContain('Saving a Card and running it are separate actions');
    expect(agentBuilder?.prompt).not.toMatch(/agentBuilderOperation|agentBuilderGuidance|PLAN\.md|edit mode|create mode/);

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
