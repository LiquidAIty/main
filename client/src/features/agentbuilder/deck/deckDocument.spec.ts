// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { buildQuickAddAssistCard } from './deckDocument';
import { INITIAL_AGENT_TEMPLATES, INITIAL_DECK } from './newProjectDeck';

describe('requested initial Card topology', () => {
  it('keeps unique profiles, system names, orange peers, and Magnetic worker availability', () => {
    const main = INITIAL_DECK.nodes.find(card => card.id === 'card_main_chat')!;
    expect(main.runtimeOptions?.tools).toContain('canvas.inspect');
    expect(main.runtime).toMatchObject({ kind: 'hermes', mode: 'main' });
    expect(INITIAL_DECK.nodes.every(card => !('orchestrator' in (card.runtimeOptions || {}))))
      .toBe(true);
    expect(INITIAL_DECK.edges.filter(edge => edge.edgeType === 'flow')).toEqual([
      { id: 'edge_main_chat_hermes', source: main.id, target: 'card_knowgraph', edgeType: 'flow' },
      { id: 'edge_main_chat_agent_builder', source: main.id, target: 'builder', edgeType: 'flow' },
      { id: 'edge_main_chat_thinkgraph', source: main.id, target: 'card_thinkgraph', edgeType: 'flow' },
      {
        id: 'edge_main_chat_magnetic', source: main.id, target: 'card_magentic',
        sourceHandle: 'card-control', targetHandle: 'card-control', edgeType: 'flow',
      },
    ]);
    expect(INITIAL_DECK.edges.filter(edge => edge.edgeType === 'magentic_option').map(edge => edge.id))
      .toEqual([
        'edge_worldsignals_magentic_bus',
        'edge_trading_magentic_bus',
        'edge_team_magentic_bus',
      ]);
    for (const edge of INITIAL_DECK.edges.filter(edge => edge.edgeType === 'magentic_option')) {
      const busHandle = edge.source === 'card_magentic' ? edge.sourceHandle : edge.targetHandle;
      const cardHandle = edge.source === 'card_magentic' ? edge.targetHandle : edge.sourceHandle;
      expect(busHandle).toMatch(/^bus-(in|out)-\d+$/);
      expect(cardHandle).toBeUndefined();
    }
    const profiles = INITIAL_DECK.nodes.flatMap(card => card.runtime.kind === 'hermes' ? [card.runtime.profile] : []);
    expect(new Set(profiles).size).toBe(profiles.length);
    expect(profiles).not.toContain('liquidaity-agent-builder');
    expect(INITIAL_DECK.nodes.find(card => card.id === 'builder')).toMatchObject({ title: 'Builder', runtime: { kind: 'hermes', mode: 'delegate', profile: 'builder' } });
    expect(INITIAL_DECK.nodes.find(card => card.id === 'card_main_chat')?.title).toBe('Main');
    expect(INITIAL_DECK.nodes.find(card => card.id === 'card_knowgraph')?.title).toBe('KnowGraph');
    expect(INITIAL_DECK.nodes.find(card => card.id === 'card_thinkgraph')).toMatchObject({
      title: 'ThinkGraph',
      runtime: { kind: 'hermes', mode: 'delegate', profile: 'thinkgraph' },
      runtimeOptions: { subagentType: 'none' },
    });
    expect(INITIAL_DECK.nodes.find(card => card.id === 'card_magentic')?.title).toBe('Magnetic');
    expect(INITIAL_DECK.nodes.find(card => card.id === 'card_team')).toMatchObject({
      title: 'Team',
      templateId: 'template_team',
      runtime: { kind: 'hermes', mode: 'delegate', profile: 'team' },
      runtimeOptions: {
        modelKey: 'gpt-5.6-terra',
        providerModelId: 'gpt-5.6-terra',
        subagentModel: {
          modelKey: 'gpt-5.6-luna',
          providerModelId: 'gpt-5.6-luna',
        },
      },
    });
    expect(INITIAL_AGENT_TEMPLATES.find(template => template.id === 'template_team')?.model)
      .toBe('gpt-5.6-terra');
    expect(INITIAL_AGENT_TEMPLATES.filter(template => [
      'template_main_chat', 'template_thinkgraph', 'template_knowgraph', 'template_magentic', 'template_team',
    ].includes(template.id)).map(template => [template.id, template.name])).toEqual([
      ['template_magentic', 'Magnetic'],
      ['template_main_chat', 'Main'],
      ['template_team', 'Team'],
      ['template_thinkgraph', 'ThinkGraph'],
      ['template_knowgraph', 'KnowGraph'],
    ]);
    for (const edge of INITIAL_DECK.edges) {
      expect(INITIAL_DECK.nodes.some(card => card.id === edge.source)).toBe(true);
      expect(INITIAL_DECK.nodes.some(card => card.id === edge.target)).toBe(true);
    }
    for (const id of ['card_main_chat', 'builder', 'card_thinkgraph', 'card_knowgraph', 'card_team']) {
      expect(INITIAL_DECK.nodes.find(card => card.id === id)?.parentGraphId).toBeNull();
    }
    expect(INITIAL_DECK.version).toBe(10);
  });

  it('seeds Team as a bounded wildcard without saved-system mutation grants', () => {
    const team = INITIAL_DECK.nodes.find((card) => card.id === 'card_team');
    expect(team?.runtimeOptions).not.toHaveProperty('subagentType');
    expect(team?.runtimeOptions?.tools).toEqual([
      'canvas.inspect',
      'engraphis_recall_context',
      'engraphis_get_memory',
      'graphiti.search_nodes',
      'graphiti.search_memory_facts',
      'graphiti.get_episodes',
    ]);
    expect(team?.runtimeOptions?.tools?.every((tool) => !tool.startsWith('cbm.'))).toBe(true);
    expect(INITIAL_AGENT_TEMPLATES.find((template) => template.id === 'template_team')
      ?.tools.every((tool) => !tool.startsWith('cbm.'))).toBe(true);
    expect(team?.runtimeOptions?.tools).not.toEqual(expect.arrayContaining([
      'card.create', 'card.update_configuration', 'canvas.upsert_wire',
    ]));
    expect(team?.runtimeOptions?.toolsets).toEqual([
      'web', 'terminal', 'file', 'browser', 'vision', 'code_execution',
    ]);
    expect(team?.prompt).toContain('general-purpose wildcard and capacity fallback');
    expect(team?.prompt).toContain('runtime-owned automatic parallel worker, review, and synthesis');
    expect(team?.prompt).toContain('Optional Agent candidate:');
    expect(team?.prompt).toContain('repeatable missing specialty');
  });

  it('seeds KnowGraph to ingest verified research without requiring an existing graph target', () => {
    const knowGraph = INITIAL_DECK.nodes.find((card) => card.id === 'card_knowgraph');
    expect(knowGraph?.prompt).toContain(
      'persist the source material with graphiti.add_memory before answering',
    );
    expect(knowGraph?.prompt).toContain(
      'does not require a preexisting node, edge, native ID, target Card, or selected graph reference',
    );
    expect(knowGraph?.prompt).toContain(
      'Use graphiti.add_memory rather than graphiti.add_triplet for sourced research intake',
    );
  });
});

describe('buildQuickAddAssistCard (hex-plus add agent)', () => {
  it('creates exactly one new Hermes Card from the template binding', () => {
    const { nextDeck, nextNode } = buildQuickAddAssistCard(INITIAL_DECK, { kind: 'hermes', mode: 'delegate' });
    expect(nextDeck.nodes.length).toBe(INITIAL_DECK.nodes.length + 1);
    expect(nextNode).toBeDefined();
    expect(nextNode.runtime).toEqual({ kind: 'hermes', mode: 'delegate', profile: expect.stringMatching(/^agent-/) });
    expect(nextNode.kind).toBe('agent');
  });

  it('uses a unique stable card id in the canonical schema', () => {
    const { nextNode } = buildQuickAddAssistCard(INITIAL_DECK, { kind: 'hermes', mode: 'delegate' });
    expect(nextNode.id).toMatch(/^card_assist_[a-z0-9]+$/);
    expect(INITIAL_DECK.nodes.map((n) => n.id)).not.toContain(nextNode.id);
    // two successive calls yield different ids
    const { nextNode: second } = buildQuickAddAssistCard(INITIAL_DECK, { kind: 'hermes', mode: 'delegate' });
    expect(second.id).not.toBe(nextNode.id);
    expect(second.runtime).not.toEqual(nextNode.runtime);
  });

  it('carries valid template/model defaults (no hardcoded model)', () => {
    const { nextNode } = buildQuickAddAssistCard(INITIAL_DECK, { kind: 'hermes', mode: 'delegate' });
    expect(nextNode.templateId).toBe('template_assist');
    expect(nextNode.runtimeOptions?.provider).toBeTruthy();
    expect(nextNode.runtimeOptions?.modelKey).toBeTruthy();
    expect(nextNode.runtimeOptions?.subagentType).toBe('none');
    expect(Array.isArray(nextNode.runtimeOptions?.tools)).toBe(true);
    expect(nextNode.runtimeOptions?.skills).toEqual([]);
    expect(nextNode.runtimeOptions?.toolsets).toEqual([]);
    expect(nextNode.runtimeOptions?.mcpConnectionIds).toEqual([]);
    expect(nextNode.status).toBe('ready');
    expect(typeof nextNode.position.x).toBe('number');
    expect(typeof nextNode.position.y).toBe('number');
  });

  it('leaves existing nodes byte-equivalent and marks the deck dirty (version bump)', () => {
    const before = JSON.stringify(INITIAL_DECK.nodes);
    const { nextDeck } = buildQuickAddAssistCard(INITIAL_DECK, { kind: 'hermes', mode: 'delegate' });
    expect(JSON.stringify(nextDeck.nodes.slice(0, INITIAL_DECK.nodes.length))).toBe(before);
    expect(nextDeck.version).toBe(INITIAL_DECK.version + 1);
  });

  it('does not touch existing edges or create one', () => {
    const before = JSON.stringify(INITIAL_DECK.edges);
    const { nextDeck } = buildQuickAddAssistCard(INITIAL_DECK, { kind: 'hermes', mode: 'delegate' });
    expect(JSON.stringify(nextDeck.edges)).toBe(before);
    expect(nextDeck.edges).toHaveLength(INITIAL_DECK.edges.length);
  });

  it('places the new card in an open canvas position', () => {
    const { nextNode } = buildQuickAddAssistCard(INITIAL_DECK, { kind: 'hermes', mode: 'delegate' });
    const rightMost = INITIAL_DECK.nodes.reduce(
      (max, n) => Math.max(max, n.position.x || 0),
      -220,
    );
    expect(nextNode.position.x).toBeGreaterThan(rightMost);
  });

  it('does not emit runtime work or assignments (pure data mutation)', () => {
    // The factory only returns deck + node: no assignments, no runs, no processes.
    const result = buildQuickAddAssistCard(INITIAL_DECK, { kind: 'hermes', mode: 'delegate' });
    expect(Object.keys(result)).toEqual(['nextDeck', 'nextNode']);
  });
});

describe('initial Card subagents', () => {
  it('keeps explicit none selections and does not add subagentType to delegate Cards', () => {
    for (const id of ['card_main_chat', 'builder', 'card_thinkgraph', 'card_magentic', 'card_worldsignals_agent']) {
      expect(INITIAL_DECK.nodes.find((card) => card.id === id)?.runtimeOptions?.subagentType)
        .toBe('none');
    }
    expect(INITIAL_DECK.nodes.find((card) => card.id === 'card_knowgraph')?.runtimeOptions?.subagentType)
      .toBe('none');
    for (const id of ['card_trading_workbench', 'card_team']) {
      expect(INITIAL_DECK.nodes.find((card) => card.id === id)?.runtimeOptions)
        .not.toHaveProperty('subagentType');
    }
  });
});

describe('initial Magnetic account binding', () => {
  it('uses the official ChatGPT account model without changing other Cards', () => {
    const magentic = INITIAL_DECK.nodes.find((node) => node.id === 'card_magentic');
    expect(magentic?.runtime).toEqual({
      kind: 'hermes', mode: 'magentic_one', profile: 'card_magentic',
    });
    expect(magentic?.runtimeOptions?.provider).toBe('openai');
    expect(magentic?.runtimeOptions?.accessMode).toBe('chatgpt-account');
    expect(magentic?.runtimeOptions?.modelKey).toBe('gpt-5.6-sol');
  });
});
