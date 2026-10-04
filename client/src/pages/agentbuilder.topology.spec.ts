import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import { INITIAL_DECK } from '../features/agentbuilder/deck/newProjectDeck';
import {
  deriveVisibleRailItems,
  hasDirectedCardConnection,
} from '../features/agentbuilder/rail/railVisibility';

const mainToKnowGraphConnected = (nodes: typeof INITIAL_DECK.nodes, edges: typeof INITIAL_DECK.edges) =>
  hasDirectedCardConnection(
    nodes,
    edges,
    (card) => card.runtime.kind === 'hermes' && card.runtime.mode === 'main',
    (card) => card.id === 'card_knowgraph'
      && card.runtime.kind === 'hermes'
      && card.runtime.mode === 'delegate',
  );

describe('Main / Hermes / graph authority topology', () => {
  it('keeps saved reuse and new Card creation inside one Add Agent chooser', () => {
    const source = readFileSync(new URL('./agentbuilder.tsx', import.meta.url), 'utf8');
    expect(source).toContain('data-testid="saved-card-chooser"');
    expect(source).toContain('data-testid="add-agent-new-card"');
    expect(source).toContain('/saved-cards`');
    expect(source).toContain('/memberships`');
    expect(source).toContain('buildQuickAddAssistCard(currentDeckRef.current, binding)');
    expect(source).toContain('Reuse a saved Card unchanged, or create and save one new Card.');
  });

  it('keeps five general Card tabs, ordinary Card CLI, and the permanent Builder CLI', () => {
    const source = readFileSync(new URL('./agentbuilder.tsx', import.meta.url), 'utf8');
    expect(source).not.toContain('main-card-cli-location');
    expect(source).not.toContain('onOpenMainChat');
    expect(source).toContain(
      "const BUILDER_NODE_TABS = ['Prompt', 'Runtime', 'Memory', 'Skills', 'Tools'] as const;",
    );
    expect(source).not.toContain("'Results'");
    expect(source).not.toContain('Dynamic context / input');
    expect(source).toContain('selectedCard.id !== mainCardId');
    expect(source).toContain('selectedCard.id !== builderCard?.id');
    const tabProjection = source.slice(
      source.indexOf('const builderTabs = useMemo'),
      source.indexOf('const selectedCardSubsystem = useMemo'),
    );
    expect(tabProjection).toContain('!hasTaskLedger(selectedCard)');
    const tabRenderer = source.slice(
      source.indexOf('const renderEditorContent = () =>'),
      source.indexOf('const cardWorkSurface = () =>'),
    );
    expect(tabRenderer).toContain('!hasTaskLedger(selectedCard)');
    expect(source).toContain("setTab('Prompt')");
    expect(source).toContain('data-testid="under-chat-card-work-surface"');
    const underChat = source.slice(source.indexOf('const cardWorkSurface ='), source.indexOf('terminal={cardWorkSurface()}'));
    expect(underChat).toContain('<AgentTerminalPanel');
    expect(underChat).toContain('cardId: builderCard.id');
    expect(source).not.toContain('agentBuilderCard');
    expect(source).not.toContain('sharedWorkSurfaceCard');
    expect(source).not.toContain('workSurfaceCardId');
    expect(underChat).not.toContain('workspaceView');
    expect(underChat).not.toContain('data-testid="agent-builder-output"');
    expect(underChat).not.toContain('builderResult');
    expect(underChat).not.toContain('directInput');
    expect(source).not.toContain('<CardRunResults');
    expect(underChat).not.toContain('Run Agent Builder');
    expect(source).not.toContain('title="Main CLI Terminal"');
    expect(source).not.toContain('data-testid="builder-card-terminal"');
  });

  it('keeps Main, Builder, and Magnetic out of the ordinary Card CLI projection', () => {
    const source = readFileSync(new URL('./agentbuilder.tsx', import.meta.url), 'utf8');
    const tabProjection = source.slice(
      source.indexOf('const builderTabs = useMemo'),
      source.indexOf('const selectedCardSubsystem = useMemo'),
    );
    expect(tabProjection).toContain('!hasTaskLedger(selectedCard)');
    expect(tabProjection).toContain('selectedCard.id !== mainCardId');
    expect(tabProjection).toContain('selectedCard.id !== builderCard?.id');
  });

  it('gives Magnetic and Team a native Tasks inspector without adding a Kanban board or settings tab', () => {
    const source = readFileSync(new URL('./agentbuilder.tsx', import.meta.url), 'utf8');
    const tabProjection = source.slice(
      source.indexOf('const builderTabs = useMemo'),
      source.indexOf('const selectedCardSubsystem = useMemo'),
    );
    expect(source).toContain("return card?.id === 'card_magentic'");
    expect(source).toContain("card?.id === 'card_magentic' || card?.id === 'card_team'");
    const magneticGate = source.slice(
      source.indexOf('function isMagneticCard'),
      source.indexOf('// The launch surface renders one mixed human graph'),
    );
    expect(magneticGate).not.toContain('runtime.mode');
    expect(tabProjection).toContain("hasTaskLedger(selectedCard) ? ['Tasks'] : []");
    expect(source).toContain("tab === 'Tasks'");
    expect(tabProjection).not.toContain("['Kanban']");
    expect(tabProjection).not.toContain("['Results']");
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

  it('keeps the graph workspace owner-visible regardless of KnowGraph topology', () => {
    expect(mainToKnowGraphConnected(INITIAL_DECK.nodes, INITIAL_DECK.edges)).toBe(true);
    expect(deriveVisibleRailItems({ deck: INITIAL_DECK, workspaceView: 'chat' }).showKnowledge).toBe(true);
    const disconnected = { ...INITIAL_DECK, edges: INITIAL_DECK.edges.filter((edge) => edge.target !== 'card_knowgraph') };
    expect(mainToKnowGraphConnected(disconnected.nodes, disconnected.edges)).toBe(false);
    expect(deriveVisibleRailItems({ deck: disconnected, workspaceView: 'chat' }).showKnowledge).toBe(true);
  });

  it('routes assistant subject labels through ephemeral page state into the existing graph inspector', () => {
    const page = readFileSync(new URL('./agentbuilder.tsx', import.meta.url), 'utf8');
    const chat = readFileSync(
      new URL('../components/builder/BuilderChat.tsx', import.meta.url),
      'utf8',
    );
    const graph = readFileSync(
      new URL('../components/knowledge/NativeAuthorityGraphSurface.tsx', import.meta.url),
      'utf8',
    );
    const handler = page.slice(
      page.indexOf('const handleCanonicalSubjectFocus'),
      page.indexOf('useEffect(() => {', page.indexOf('const handleCanonicalSubjectFocus')),
    );
    expect(page).toContain('createCanonicalSubjectMatcher({');
    expect(page).toContain('subjectMatcher={canonicalSubjectMatcher}');
    expect(page).toContain('subjectFocusRequest={subjectFocusRequest}');
    expect(handler).toContain("setWorkspaceView('knowledge')");
    expect(handler).not.toContain('setKnowledgeGraphKind');
    expect(handler).not.toContain('fetch(');
    expect(handler).not.toContain('localStorage');
    expect(chat).toContain('subjectMatcher?.segmentMessage(message.role, text)');
    expect(chat).toContain('aria-label={`Open ${segment.text} in graph`}');
    expect(graph).toContain('resolveCanonicalSubjectFocusVisualId({');
    expect(graph).toContain('inspectNodeRef.current(visualNodeId)');
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

  it('keeps internal Hermes roles off the Magnetic worker bus', () => {
    expect(INITIAL_DECK.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'card_main_chat', target: 'card_knowgraph', edgeType: 'flow' }),
      expect.objectContaining({ source: 'card_worldsignals_agent', target: 'card_magentic', edgeType: 'magentic_option' }),
      expect.objectContaining({ source: 'card_team', target: 'card_magentic', edgeType: 'magentic_option' }),
    ]));
    for (const internalCardId of ['card_main_chat', 'builder', 'card_thinkgraph', 'card_knowgraph']) {
      expect(INITIAL_DECK.edges).not.toContainEqual(expect.objectContaining({
        source: internalCardId,
        target: 'card_magentic',
        edgeType: 'magentic_option',
      }));
    }
  });

  it('connects Main to Builder, ThinkGraph, KnowGraph, and Magnetic by orange flow, with blue workers separate', () => {
    expect(INITIAL_DECK.edges.filter((edge) => edge.edgeType === 'flow')).toEqual([
      expect.objectContaining({ source: 'card_main_chat', target: 'card_knowgraph', edgeType: 'flow' }),
      expect.objectContaining({ source: 'card_main_chat', target: 'builder', edgeType: 'flow' }),
      expect.objectContaining({ source: 'card_main_chat', target: 'card_thinkgraph', edgeType: 'flow' }),
      expect.objectContaining({ source: 'card_main_chat', target: 'card_magentic', edgeType: 'flow' }),
    ]);
    expect(INITIAL_DECK.edges).toHaveLength(7);
    const workerEdges = INITIAL_DECK.edges.filter((edge) => edge.edgeType === 'magentic_option');
    expect(workerEdges.map((edge) => edge.source === 'card_magentic' ? edge.target : edge.source).sort())
      .toEqual(['card_team', 'card_trading_workbench', 'card_worldsignals_agent']);
    expect(workerEdges.every((edge) => edge.source === 'card_magentic' || edge.target === 'card_magentic')).toBe(true);
    expect(INITIAL_DECK.edges).not.toContainEqual(expect.objectContaining({
      source: 'builder', target: 'card_magentic', edgeType: 'magentic_option',
    }));
    expect(JSON.stringify(INITIAL_DECK.edges)).not.toContain('autoRun');
  });

  it('collapses and reopens the mounted WorldSignals inspector without clearing its section', () => {
    const source = readFileSync(new URL('./agentbuilder.tsx', import.meta.url), 'utf8');
    const stateOwner = source.slice(
      source.indexOf('const [worldSignalInspectorSection'),
      source.indexOf('const worldSignalsCardId = useMemo'),
    );
    const visibilityOwner = source.slice(
      source.indexOf('const inspectorDrawerRole = useMemo'),
      source.indexOf('const getSurfaceShellStyle'),
    );
    const drawerStart = source.indexOf('const workspaceDrawer =');
    const drawerOwner = source.slice(drawerStart, source.indexOf('<FrontendCrashBoundary', drawerStart));

    expect(stateOwner).toContain('const [worldSignalInspectorOpen, setWorldSignalInspectorOpen] = useState(false);');
    expect(stateOwner).toContain('setWorldSignalInspectorSection(section);');
    expect(stateOwner).toContain('setWorldSignalInspectorOpen(true);');
    expect(visibilityOwner).toContain("if (workspaceView === 'worldsignal' && worldSignalInspectorSection) return 'worldsignal';");
    expect(visibilityOwner).toContain("inspectorDrawerRole === 'worldsignal'");
    expect(visibilityOwner).toContain('? worldSignalInspectorOpen');
    expect(visibilityOwner).toContain('const closeWorldSignalInspector = useCallback(() => {\n    setWorldSignalInspectorOpen(false);');
    expect(visibilityOwner).not.toContain('setWorldSignalInspectorSection(null);');
    expect(drawerOwner).toContain("onOpen={inspectorDrawerRole === 'worldsignal'");
    expect(drawerOwner).toContain('setWorldSignalInspectorOpen(true)');
    expect(drawerOwner).toContain("inspectorDrawerRole === 'worldsignal' && worldSignalInspectorSection");
    expect(drawerOwner).toContain('<WorldSignalsInspectorPanel');
    expect(drawerOwner).toContain('section={worldSignalInspectorSection}');
    expect(drawerOwner).toContain("'Open WorldSignals Inspector'");
  });

  it('selects direct chat responders from exact Card-owned companion surfaces without topology mutation', () => {
    const source = readFileSync(new URL('./agentbuilder.tsx', import.meta.url), 'utf8');
    expect(source).toContain('projectCardChatTargets(deck.nodes)');
    expect(source).toContain('const owners = deck.nodes.filter((node) => isWorldViewCard(node));');
    expect(source).toContain('directChatTargets.some((target) => target.cardId === owners[0].id)');
    expect(source).toContain('!worldSignalsCardId || !setCurrentResponderCardId(worldSignalsCardId)');
    expect(source).toContain('!worldViewCard?.id || !setCurrentResponderCardId(worldViewCard.id)');
    expect(source).toContain('!tradingCard?.id || !setCurrentResponderCardId(tradingCard.id)');
    expect(source).toContain('saved Card is unavailable for direct chat.');
    expect(source).toContain("setWorkspaceView(canvasProjectId ? 'canvas' : 'chat')");
    expect(source).toContain('setCurrentResponderCardId(null)');
    expect(source).toContain('directChatTargets={directChatTargets}');
    expect(source).not.toContain('currentResponder={currentResponder}');
    expect(INITIAL_DECK.edges).not.toContainEqual(expect.objectContaining({
      source: 'card_main_chat', target: 'card_worldsignals_agent', edgeType: 'flow',
    }));
  });

  it('stores bounded write authority without the retired public Card-run model tool', () => {
    const byId = new Map(INITIAL_DECK.nodes.map((node) => [node.id, node]));
    const mainTools = byId.get('card_main_chat')?.runtimeOptions?.tools ?? [];
    const knowgraphTools = byId.get('card_knowgraph')?.runtimeOptions?.tools ?? [];
    expect(mainTools).toEqual(expect.arrayContaining([
      'engraphis_remember',
      'run_mag_one',
      'worldview.set_capability',
    ]));
    expect(mainTools).not.toEqual(expect.arrayContaining([
      'engraphis_recall_context',
      'canvas.inspect',
      'agentgraph.inspect',
      'mag_one.describe_connected_agents',
    ]));
    expect(mainTools).not.toContain('card.run_assistant_agent');
    expect(mainTools).not.toContain('web_search');
    expect(knowgraphTools).toEqual([
      'canvas.inspect',
      'engraphis_get_memory',
      'graphiti.get_entity_edge',
      'graphiti.get_episode_entities',
      'graphiti.get_episodes',
      'graphiti.get_status',
      'graphiti.search_memory_facts',
      'graphiti.search_nodes',
      'graphiti.add_memory',
      'graphiti.add_triplet',
      'write_mag_one_instructions',
      'card.load_graph_references',
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
    expect(byId.get('card_trading_workbench')?.prompt).not.toContain('optional native Team');
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
      targetHandle: 'card-control',
      edgeType: 'flow',
    }));
  });

  it('seeds each System Card from one concise canonical five-block prompt', () => {
    const systemCards = new Map([
      ['card_main_chat', 'prompt_main_chat'],
      ['builder', 'prompt_builder'],
      ['card_thinkgraph', 'prompt_thinkgraph'],
      ['card_knowgraph', 'prompt_knowgraph'],
    ]);
    const expectedHeadings = ['ROLE', 'GOAL', 'CONSTRAINTS', 'IO_SCHEMA', 'MEMORY_POLICY'];
    for (const [cardId, promptTemplateId] of systemCards) {
      const card = INITIAL_DECK.nodes.find((node) => node.id === cardId)!;
      const prompt = card.prompt ?? '';
      const headings = [...prompt.matchAll(/^\[([A-Z_]+)\]$/gm)].map((match) => match[1]);
      expect(headings, cardId).toEqual(expectedHeadings);
      expect(prompt.match(/# LIQUIDAITY_PROMPT_V1/g), cardId).toHaveLength(1);
      const template = INITIAL_DECK.promptTemplates.find((entry) => entry.id === promptTemplateId);
      expect(template?.content, cardId).toBe(prompt);
    }
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
    expect(main?.prompt).toContain('through message_agent by its exact saved visible name');
    expect(main?.prompt).toContain('a wire grants outbound authority but never starts work');
    expect(main?.prompt).toContain('Do not copy the conversation or Main memory into another Card');
    expect(main?.prompt).toContain('Invoke run_mag_one only once for the exact approved mission');
    expect(main?.prompt).toContain('Do not use CBM, the full Graphiti catalog, terminal, files, browser, or Kanban');

    expect(agentBuilder).toMatchObject({
      title: 'Builder',
      runtime: { kind: 'hermes', mode: 'delegate', profile: 'builder' },
      runtimeOptions: {
        accessMode: 'chatgpt-account',
        nativeTools: ['memory'],
        skills: ['agent-builder-inspection'],
        toolsets: ['web', 'terminal', 'file', 'browser', 'vision', 'code_execution'],
        tools: [
          'canvas.inspect', 'card.create', 'card.update_configuration',
          'cbm.search_graph', 'cbm.trace_path', 'cbm.get_code_snippet',
          'cbm.check_index_coverage', 'cbm.detect_changes', 'cbm.search_code', 'cbm.query_graph',
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
          'engraphis_update_memory', 'engraphis_correct', 'engraphis_link', 'engraphis_ingest',
        ],
      },
    });
    expect(thinkgraph?.runtimeOptions?.nativeTools ?? []).toEqual([]);
    expect(thinkgraph?.runtimeOptions?.skills ?? []).toEqual([]);
    expect(thinkgraph?.runtimeOptions?.toolsets ?? []).toEqual([]);
    expect(thinkgraph?.prompt).toContain('Maintain Engraphis project reasoning for focused material from Main');
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
        nativeTools: ['memory'],
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
    expect(knowgraph?.runtimeOptions?.tools).toEqual(expect.arrayContaining([
      'canvas.inspect',
      'engraphis_get_memory',
      'graphiti.search_nodes',
      'graphiti.search_memory_facts',
      'graphiti.get_episodes',
      'graphiti.add_memory',
      'graphiti.add_triplet',
    ]));
    expect(knowgraph?.runtimeOptions?.tools).toContain('write_mag_one_instructions');
    expect(knowgraph?.runtimeOptions?.nativeTools).toEqual(['memory']);
    expect(knowgraph?.runtimeOptions?.skills).toEqual(['grounded-citations']);
    expect(knowgraph?.runtimeOptions?.toolsets ?? []).toEqual(['web']);
    expect(knowgraph?.runtimeOptions?.subagentType).toBe('none');
    expect(knowgraph?.prompt).toContain('Do not use CBM or become a coding worker');
    expect(knowgraph?.prompt).toContain('Do not initiate another saved Card');
    expect(knowgraph?.prompt).toContain('Use card.load_graph_references and write_mag_one_instructions only to stage');
    expect(knowgraph?.prompt).toContain('Inspect supplied graph data before researching');
    expect(knowgraph?.prompt).toContain('do not search ThinkGraph');
    expect(knowgraph?.prompt).toContain('Preserve sources, URLs, dates, entities, relationships, contradictions, native IDs, and uncertainty');
    expect(knowgraph?.prompt).toContain('create recursive workers, or execute Magnetic');

    expect(magOne).toMatchObject({
      runtime: { kind: 'hermes', mode: 'magentic_one', profile: 'card_magentic' },
    });
    expect(JSON.stringify(INITIAL_DECK.nodes)).not.toContain('"mode":"kanban"');
  });

  it('keeps one All graph surface and removes the deferred CodeGraph tab scaffolding', () => {
    const source = readFileSync(new URL('./agentbuilder.tsx', import.meta.url), 'utf8');
    const framework = readFileSync(
      new URL('../components/knowledge/KnowledgeGraphFramework.tsx', import.meta.url),
      'utf8',
    );
    const nativeSurface = readFileSync(
      new URL('../components/knowledge/NativeAuthorityGraphSurface.tsx', import.meta.url),
      'utf8',
    );
    expect(source).not.toContain('resolveCbmProjectName');
    expect(source).not.toContain('knowledgeGraphKind');
    expect(framework).toContain('<NativeJoinedGraphSurface');
    expect(framework).not.toContain('Knowledge graph view');
    expect(framework).not.toContain('graph-kind-codegraph');
    expect(framework).not.toContain('onReadContextualNode');
    expect(framework).not.toContain('onUseContextualNodeRead');
    expect(source).not.toContain('handleUseContextualNodeRead');
    expect(source).not.toContain('handleUseAttentionNode');
    for (const forbiddenForeground of [
      'Reread contents',
      '<strong>For:</strong>',
      'Use selected in chat',
    ]) {
      expect(nativeSurface).not.toContain(forbiddenForeground);
    }
  });

});
