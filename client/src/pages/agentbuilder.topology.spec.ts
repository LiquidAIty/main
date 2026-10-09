// @vitest-environment jsdom

import { createElement, useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { INITIAL_DECK } from '../features/agentbuilder/deck/newProjectDeck';
import {
  isWorldSignalsAgentCard,
  isWorldViewCard,
} from '../features/agentbuilder/rail/railVisibility';
import AgentCardChooserDialog from '../features/agentbuilder/project/AgentCardChooserDialog';
import AgentBuilderInspectorDrawer from '../features/agentbuilder/inspector/AgentBuilderInspectorDrawer';
import { builderTerminalBinding } from '../features/agentbuilder/console/agentBuilderChatWorkSurfacePolicy';
import {
  CARD_CONFIGURATION_TABS,
  cardInspectorTabs,
  isCardCliEligible,
  isTaskLedgerCard,
} from '../features/agentbuilder/inspector/agentCardInspectorPolicy';
import { projectCardChatTargets } from '../features/agentbuilder/console/sharedChatClient';

afterEach(cleanup);

const mainToKnowGraphConnected = (
  nodes: typeof INITIAL_DECK.nodes,
  edges: typeof INITIAL_DECK.edges,
) => {
  const mainIds = new Set(nodes.filter((card) => (
    card.runtime.kind === 'hermes' && card.runtime.mode === 'main'
  )).map((card) => card.id));
  const knowIds = new Set(nodes.filter((card) => (
    card.id === 'card_knowgraph'
    && card.runtime.kind === 'hermes'
    && card.runtime.mode === 'delegate'
  )).map((card) => card.id));
  return edges.some((edge) => (
    edge.edgeType === 'flow' && mainIds.has(edge.source) && knowIds.has(edge.target)
  ));
};

describe('Main / Hermes / graph authority topology', () => {
  it('renders saved reuse and new Card creation inside one Add Agent chooser', () => {
    const createNew = vi.fn();
    const attachSaved = vi.fn();
    const choice = {
      cardId: 'saved-helper',
      cardRevisionId: 'revision-one',
      title: 'Saved Helper',
      subtitle: 'Reusable Card',
      runtimeProfile: 'saved-helper',
    };
    render(createElement(AgentCardChooserDialog, {
      open: true,
      choices: [choice],
      busy: false,
      error: null,
      colors: {
        primary: '#4FA2AD', bg: '#1F1F1F', panel: '#2B2B2B',
        border: '#3A3A3A', text: '#FFFFFF', neutral: '#E0DED5', warn: '#D98458',
      },
      onClose: vi.fn(),
      onCreateNewAgent: createNew,
      onAttachSavedCard: attachSaved,
    }));

    expect(screen.getByTestId('saved-card-chooser')).toBeTruthy();
    expect(screen.getByText('Reuse a saved Card unchanged, or create and save one new Card.'))
      .toBeTruthy();
    fireEvent.click(screen.getByTestId('add-agent-new-card'));
    fireEvent.click(screen.getByTestId('saved-card-choice-saved-helper'));
    expect(createNew).toHaveBeenCalledOnce();
    expect(attachSaved).toHaveBeenCalledExactlyOnceWith(choice);
  });

  it('derives exact configuration, Tasks, and CLI tabs from saved Card identity', () => {
    const byId = new Map(INITIAL_DECK.nodes.map((card) => [card.id, card]));
    const mainCardId = 'card_main_chat';
    const builderCardId = 'builder';
    const tabs = (cardId: string) => cardInspectorTabs({
      card: byId.get(cardId), mainCardId, builderCardId,
    });

    expect(CARD_CONFIGURATION_TABS).toEqual([
      'Prompt', 'Runtime', 'Memory', 'Skills', 'Tools',
    ]);
    expect(tabs('card_knowgraph')).toEqual([...CARD_CONFIGURATION_TABS, 'CLI']);
    expect(tabs(mainCardId)).toEqual([...CARD_CONFIGURATION_TABS]);
    expect(tabs(builderCardId)).toEqual([...CARD_CONFIGURATION_TABS]);
    expect(tabs('card_magentic')).toEqual([...CARD_CONFIGURATION_TABS, 'Tasks']);
    expect(tabs('card_team')).toEqual([...CARD_CONFIGURATION_TABS, 'Tasks']);
    expect(isTaskLedgerCard(byId.get('card_magentic'))).toBe(true);
    expect(isTaskLedgerCard(byId.get('card_team'))).toBe(true);
    expect(isCardCliEligible({
      card: byId.get('card_knowgraph'), mainCardId, builderCardId,
    })).toBe(true);
    for (const cardId of [mainCardId, builderCardId, 'card_magentic', 'card_team']) {
      expect(isCardCliEligible({ card: byId.get(cardId), mainCardId, builderCardId }))
        .toBe(false);
    }
    expect(tabs('card_magentic')).not.toEqual(expect.arrayContaining(['Kanban', 'Results']));
  });

  it('binds the permanent under-chat terminal to the saved Builder Card', () => {
    const builder = INITIAL_DECK.nodes.find((card) => card.id === 'builder')!;
    const binding = builderTerminalBinding({
      canvasProjectId: 'project-one',
      conversationId: 'conversation-one',
      builderCard: builder,
    });

    expect(binding).toMatchObject({
      cardId: 'builder',
      key: 'project-one:builder:builder',
    });
    expect(binding?.identity).toEqual({
      projectId: 'project-one',
      deckId: INITIAL_DECK.id,
      cardId: 'builder',
      conversationId: 'conversation-one',
    });
    expect(builderTerminalBinding({
      canvasProjectId: null,
      conversationId: 'conversation-one',
      builderCard: builder,
    })).toBeNull();
  });
  it('uses the clean KnowGraph identity', () => {
    const serialized = JSON.stringify(INITIAL_DECK);
    expect(serialized).not.toMatch(/thinkgraph_agent|codegraph_agent|knowgraph_agent/);
    expect(INITIAL_DECK.nodes.map((node) => node.id)).toEqual(expect.arrayContaining([
      'card_main_chat',
      'card_thinkgraph',
      'card_knowgraph',
      'card_magentic',
      'card_team',
      'builder',
    ]));
    expect(INITIAL_DECK.nodes.find((node) => node.id === 'card_knowgraph')).toMatchObject({
      title: 'KnowGraph',
      runtime: { kind: 'hermes', mode: 'delegate', profile: 'knowgraph' },
      runtimeOptions: { subagentType: 'none' },
    });
  });

  it('requires the KnowGraph flow connection to originate from Main', () => {
    const withoutHermesFlow = INITIAL_DECK.edges.filter((edge) => edge.id !== 'edge_main_chat_hermes');
    const replacement = (edgeType: string, source = 'card_main_chat', target = 'card_knowgraph') => ({
      id: `test:${edgeType}:${source}:${target}`,
      source,
      target,
      edgeType,
    });
    expect(mainToKnowGraphConnected(INITIAL_DECK.nodes, [
      ...withoutHermesFlow,
      replacement('flow', 'card_knowgraph', 'card_main_chat'),
    ] as any)).toBe(false);
    expect(mainToKnowGraphConnected(INITIAL_DECK.nodes, [
      ...withoutHermesFlow,
      replacement('flow'),
    ] as any)).toBe(true);
    expect(mainToKnowGraphConnected(INITIAL_DECK.nodes, [
      ...withoutHermesFlow,
      replacement('invalid'),
    ] as any)).toBe(false);
  });

  it('collapses and reopens the mounted WorldSignals inspector without clearing its section', () => {
    function WorldSignalsInspectorHarness() {
      const [section, setSection] = useState<'markets' | 'layers'>('markets');
      const [open, setOpen] = useState(true);
      return createElement(AgentBuilderInspectorDrawer, {
        role: {
          kind: 'worldsignals',
          open,
          section,
          bridge: null,
          layerState: null,
          onClose: () => setOpen(false),
          onOpen: () => setOpen(true),
          onSectionChange: setSection,
        },
      });
    }

    render(createElement(WorldSignalsInspectorHarness));
    fireEvent.click(screen.getByTestId('worldsignals-inspector-tab-layers'));
    expect(screen.getByTestId('worldsignals-inspector-tab-layers').getAttribute('aria-pressed'))
      .toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Close drawer' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open WorldSignals Inspector' }));
    expect(screen.getByTestId('worldsignals-inspector-tab-layers').getAttribute('aria-pressed'))
      .toBe('true');
    expect(screen.getByTestId('worldsignals-inspector-note').textContent)
      .toContain('layer controls appear once the map is mounted');
  });

  it('selects direct chat responders from exact Card-owned companion surfaces without topology mutation', () => {
    const before = JSON.stringify(INITIAL_DECK);
    const currentCards = INITIAL_DECK.nodes.map((card) => ({
      ...card,
      _cardRevisionId: `revision:${card.id}`,
    }));
    const directChatTargets = projectCardChatTargets(currentCards);
    const targetIds = new Set(directChatTargets.map((target) => target.cardId));
    const worldSignalsCardId = currentCards.find(isWorldSignalsAgentCard)?.id;
    const worldViewCards = currentCards.filter(isWorldViewCard);
    const tradingCardId = currentCards.find(
      (card) => card.id === 'card_trading_workbench',
    )?.id;

    expect(worldSignalsCardId).toBeTruthy();
    expect(tradingCardId).toBeTruthy();
    expect(targetIds.has(worldSignalsCardId!)).toBe(true);
    for (const worldViewCard of worldViewCards) {
      expect(targetIds.has(worldViewCard.id)).toBe(true);
    }
    expect(targetIds.has(tradingCardId!)).toBe(true);
    expect(directChatTargets.every((target) => (
      INITIAL_DECK.nodes.some((card) => card.id === target.cardId)
    ))).toBe(true);
    expect(INITIAL_DECK.edges).not.toContainEqual(expect.objectContaining({
      source: 'card_main_chat', target: 'card_worldsignals_agent', edgeType: 'flow',
    }));
    expect(JSON.stringify(INITIAL_DECK)).toBe(before);
  });

  it('stores bounded write authority without the retired public Card-run model tool', () => {
    const byId = new Map(INITIAL_DECK.nodes.map((node) => [node.id, node]));
    const mainTools = byId.get('card_main_chat')?.runtimeOptions?.tools ?? [];
    const knowgraphTools = byId.get('card_knowgraph')?.runtimeOptions?.tools ?? [];
    expect(mainTools).toEqual([
      'canvas.inspect',
      'engraphis_recall_context',
      'graphiti.search_memory_facts',
      'graphiti.search_nodes',
      'graphiti.get_episodes',
      'cbm.search_graph',
      'cbm.trace_path',
      'run_mag_one',
      'worldview.set_capability',
    ]);
    expect(mainTools).not.toEqual(expect.arrayContaining([
      'engraphis_remember',
      'agentgraph.inspect',
      'mag_one.describe_connected_agents',
    ]));
    expect(mainTools).not.toContain('card.run_assistant_agent');
    expect(mainTools).not.toContain('hermes:tool:message_agent');
    expect(mainTools).not.toContain('web_search');
    expect(knowgraphTools).toEqual([
      'engraphis_get_memory',
      'graphiti.search_memory_facts',
      'graphiti.search_nodes',
      'graphiti.get_episodes',
      'graphiti.get_episode_entities',
      'graphiti.add_memory',
    ]);
    expect(knowgraphTools).not.toEqual(expect.arrayContaining(['web_search', 'run_mag_one']));
    expect(byId.has('card_research_agent')).toBe(false);
    const knowgraphPrompt = byId.get('card_knowgraph')?.prompt ?? '';
    expect(knowgraphPrompt).toContain('You are KnowGraph');
    expect(knowgraphPrompt).not.toContain('Team delegation');
    expect(knowgraphPrompt).not.toContain('Team is a capability');
    expect(knowgraphPrompt).toContain('Perform sourced research and maintain knowledge and provenance through Graphiti');
    expect(knowgraphPrompt).toContain('Do not use CBM or become a coding worker');
    expect(byId.get('card_knowgraph')?.title).toBe('KnowGraph');
    expect(knowgraphPrompt).not.toContain('external Hermes agent runtime');
    expect(knowgraphPrompt).not.toContain('task ledger');
    expect(knowgraphPrompt).not.toContain('Before Magnetic');
    expect(knowgraphPrompt).not.toContain('After Magnetic');
    expect(byId.get('card_trading_workbench')?.prompt).not.toContain('optional Team');
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
  });

  it('keeps broad read discovery separate from explicit write selections', () => {
    const byId = new Map(INITIAL_DECK.nodes.map((node) => [node.id, node]));
    const main = byId.get('card_main_chat');
    const agentBuilder = byId.get('builder');
    const thinkgraph = byId.get('card_thinkgraph');
    const knowgraph = byId.get('card_knowgraph');
    const team = byId.get('card_team');
    const magOne = byId.get('card_magentic');

    for (const card of [main, agentBuilder, thinkgraph, knowgraph, team]) {
      expect(card?.runtimeOptions?.subagentModel).toEqual({
        provider: 'openai',
        accessMode: 'chatgpt-account',
        modelKey: 'gpt-5.6-luna',
        providerModelId: 'gpt-5.6-luna',
      });
    }
    // The saved subagent model remains distinct from the removed host Team
    // configuration and from the visible Team Card.
    for (const card of [main, agentBuilder, thinkgraph, knowgraph, team]) {
      expect(card?.runtimeOptions).not.toHaveProperty('team');
    }

    expect(main?.runtimeOptions?.tools).toContain('run_mag_one');
    expect(main?.runtimeOptions?.tools).not.toContain('card.run_assistant_agent');
    expect(main?.runtimeOptions?.modelKey).toBe('gpt-5.6-sol');
    expect(main?.runtimeOptions?.providerModelId).toBe('gpt-5.6-sol');
    expect(main?.runtimeOptions?.toolsets ?? []).toEqual([]);
    expect(main?.prompt).toContain('persistent user-facing front door and system orchestrator');
    expect(main?.prompt).toContain('only through Bot Mode and the exact permitted profile roster');
    expect(main?.prompt).toContain('a wire grants outbound authority but never starts work');
    expect(main?.prompt).toContain('Do not copy the conversation or Main memory into another Card');
    expect(main?.prompt).toContain('Invoke run_mag_one only once for the exact approved mission');
    expect(main?.prompt).toContain('Use only the granted bounded CBM search and trace capabilities');
    expect(main?.prompt).toContain('do not use terminal, files, browser, code execution, or Kanban');

    expect(agentBuilder).toMatchObject({
      title: 'Builder',
      runtime: { kind: 'hermes', mode: 'delegate', profile: 'builder' },
      runtimeOptions: {
        accessMode: 'chatgpt-account',
        skills: ['agent-builder-inspection'],
        toolsets: ['web', 'terminal', 'file', 'browser', 'vision', 'code_execution'],
        tools: [
          'canvas.inspect', 'card.create', 'card.update_configuration', 'canvas.upsert_wire',
          'cbm.search_graph', 'cbm.search_code', 'cbm.trace_path', 'cbm.get_code_snippet',
          'cbm.check_index_coverage', 'engraphis_recall_context', 'graphiti.search_memory_facts',
          'graphiti.search_nodes', 'graphiti.get_episodes',
          'thinkgraph.reason', 'knowgraph.research',
        ],
      },
    });
    expect(agentBuilder?.runtimeOptions).toMatchObject({
      modelKey: 'gpt-5.6-sol',
      providerModelId: 'gpt-5.6-sol',
    });
    expect(agentBuilder?.prompt).toContain('Build prompts, saved Cards, agent applications');
    expect(agentBuilder?.prompt).toContain('card.create or card.update_configuration with explicit arguments');
    expect(agentBuilder?.prompt).toContain('Saving a Card and running a Card are separate actions');
    expect(agentBuilder?.prompt).toContain('Do not inherit Graphiti or Magnetic orchestration authority');
    expect(agentBuilder?.prompt).not.toMatch(/agentBuilderOperation|agentBuilderGuidance|PLAN\.md|edit mode|create mode/);

    expect(thinkgraph).toMatchObject({
      title: 'ThinkGraph',
      templateId: 'template_thinkgraph',
      runtime: { kind: 'hermes', mode: 'delegate', profile: 'thinkgraph' },
      runtimeOptions: {
        subagentType: 'none',
        modelKey: 'gpt-5.6-luna',
        providerModelId: 'gpt-5.6-luna',
        tools: [
          'engraphis_recall_context', 'engraphis_get_memory', 'engraphis_remember',
          'engraphis_discover_actions', 'engraphis_execute_read',
        ],
      },
    });
    expect(thinkgraph?.runtimeOptions?.skills ?? []).toEqual([]);
    expect(thinkgraph?.runtimeOptions?.toolsets ?? []).toEqual([]);
    expect(thinkgraph?.prompt).toContain(
      'Maintain Engraphis project reasoning and answer focused historical-reasoning requests from Main',
    );
    expect(thinkgraph?.prompt).toContain('Do not browse the web, write KnowGraph');
    expect(thinkgraph?.prompt).toContain('Keep ThinkGraph and KnowGraph separate');
    expect(thinkgraph?.prompt).not.toMatch(/delegate_task|Graph Agent|Steward|Stuart|Team/);

    expect(team).toMatchObject({
      title: 'Team',
      templateId: 'template_team',
      runtime: { kind: 'hermes', mode: 'delegate', profile: 'team' },
      runtimeOptions: {
        accessMode: 'chatgpt-account',
        modelKey: 'gpt-5.6-terra',
        providerModelId: 'gpt-5.6-terra',
        subagentModel: {
          modelKey: 'gpt-5.6-luna',
          providerModelId: 'gpt-5.6-luna',
        },
        skills: ['grounded-citations'],
        toolsets: ['web', 'terminal', 'file', 'browser', 'vision', 'code_execution'],
      },
    });
    expect(team?.runtimeOptions).not.toHaveProperty('subagentType');
    expect(team?.runtimeOptions?.tools).toEqual(expect.arrayContaining([
      'canvas.inspect',
      'engraphis_get_memory',
      'graphiti.search_nodes',
      'graphiti.search_memory_facts',
      'graphiti.get_episodes',
    ]));
    expect(team?.runtimeOptions?.tools?.every((tool) => !tool.startsWith('cbm.'))).toBe(true);
    expect(team?.runtimeOptions?.tools).not.toEqual(expect.arrayContaining([
      'card.create', 'card.update_configuration', 'canvas.upsert_wire',
    ]));
    expect(team?.prompt).toContain('Complete only the bounded assignment Magnetic gives this saved Card');
    expect(team?.prompt).toContain('runtime owns decomposition, temporary workers, review, synthesis');
    expect(team?.prompt).toContain('structured Agent candidate packet');
    expect(team?.prompt).toContain('Do not emit one for a one-off gap');

    expect(knowgraph?.runtimeOptions?.tools).not.toContain('run_mag_one');
    expect(knowgraph?.runtimeOptions?.tools).not.toContain('card.run_assistant_agent');
    expect(knowgraph?.runtimeOptions?.tools).toEqual([
      'engraphis_get_memory',
      'graphiti.search_memory_facts',
      'graphiti.search_nodes',
      'graphiti.get_episodes',
      'graphiti.get_episode_entities',
      'graphiti.add_memory',
    ]);
    expect(knowgraph?.runtimeOptions?.skills).toEqual(['grounded-citations']);
    expect(knowgraph?.runtimeOptions?.toolsets ?? []).toEqual(['web']);
    expect(knowgraph?.runtimeOptions?.subagentType).toBe('none');
    expect(knowgraph?.prompt).toContain('Do not use CBM or become a coding worker');
    expect(knowgraph?.prompt).toContain('Do not initiate another saved Card');
    expect(knowgraph?.prompt).toContain('Inspect supplied graph data before researching');
    expect(knowgraph?.prompt).toContain('do not search ThinkGraph');
    expect(knowgraph?.prompt).toContain('Preserve sources, URLs, dates, entities, relationships, contradictions, Graphiti record IDs, and uncertainty');
    expect(knowgraph?.prompt).toContain('create recursive workers, or execute Magnetic');

    expect(magOne).toMatchObject({
      runtime: { kind: 'hermes', mode: 'magentic_one', profile: 'card_magentic' },
    });
    expect(JSON.stringify(INITIAL_DECK.nodes)).not.toContain('"mode":"kanban"');
  });

});
