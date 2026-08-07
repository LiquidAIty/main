import { describe, expect, it } from 'vitest';
import path from 'node:path';

import { INITIAL_DECK } from '../features/agentbuilder/deck/newProjectDeck';
import {
  deriveVisibleRailItems,
  hasDirectedRuntimeBindingConnection,
} from '../features/agentbuilder/rail/railVisibility';

const mainToHermesConnected = (nodes: typeof INITIAL_DECK.nodes, edges: typeof INITIAL_DECK.edges) =>
  hasDirectedRuntimeBindingConnection(nodes, edges, 'main_chat', 'hermes_steward');

describe('Main / Hermes / graph authority topology', () => {
  it('defines no graph-agent card, template, prompt, or runtime binding', () => {
    const serialized = JSON.stringify(INITIAL_DECK);
    expect(serialized).not.toMatch(/thinkgraph_agent|codegraph_agent|knowgraph_agent/);
    expect(INITIAL_DECK.nodes.map((node) => node.id)).toEqual(expect.arrayContaining([
      'card_main_chat',
      'card_hermes_steward',
      'card_research_agent',
      'card_magentic',
      'card_local_coder',
    ]));
  });

  it('keeps the graph workspace owner-visible regardless of Hermes topology', () => {
    expect(mainToHermesConnected(INITIAL_DECK.nodes, INITIAL_DECK.edges)).toBe(true);
    expect(deriveVisibleRailItems({ deck: INITIAL_DECK, workspaceView: 'chat' }).showKnowledge).toBe(true);
    const disconnected = { ...INITIAL_DECK, edges: INITIAL_DECK.edges.filter((edge) => edge.target !== 'card_hermes_steward') };
    expect(mainToHermesConnected(disconnected.nodes, disconnected.edges)).toBe(false);
    expect(deriveVisibleRailItems({ deck: disconnected, workspaceView: 'chat' }).showKnowledge).toBe(true);
  });

  it('shows the Hermes rail destination only for a typed, connected runtime card', () => {
    const visible = deriveVisibleRailItems({ deck: INITIAL_DECK, workspaceView: 'chat' });
    expect(visible.showHermesKanban).toBe(true);

    const withoutHermes = {
      ...INITIAL_DECK,
      nodes: INITIAL_DECK.nodes.filter((node) => node.id !== 'card_hermes_steward'),
    };
    expect(
      deriveVisibleRailItems({ deck: withoutHermes, workspaceView: 'chat' }).showHermesKanban,
    ).toBe(false);
    const disconnected = {
      ...INITIAL_DECK,
      edges: INITIAL_DECK.edges.filter((edge) => edge.id !== 'edge_main_chat_hermes'),
    };
    expect(deriveVisibleRailItems({ deck: disconnected, workspaceView: 'chat' }).showHermesKanban).toBe(false);
    const renamed = {
      ...INITIAL_DECK,
      nodes: INITIAL_DECK.nodes.map((node) =>
        node.id === 'card_hermes_steward' ? { ...node, title: 'Operations' } : node
      ),
    };
    expect(deriveVisibleRailItems({ deck: renamed, workspaceView: 'chat' }).showHermesKanban).toBe(true);
  });

  it('requires the directed Main to Hermes flow edge', () => {
    const withoutHermesFlow = INITIAL_DECK.edges.filter((edge) => edge.id !== 'edge_main_chat_hermes');
    const replacement = (edgeType: string, source = 'card_main_chat', target = 'card_hermes_steward') => ({
      id: `test:${edgeType}:${source}:${target}`,
      source,
      target,
      edgeType,
    });
    expect(mainToHermesConnected(INITIAL_DECK.nodes, [
      ...withoutHermesFlow,
      replacement('flow', 'card_hermes_steward', 'card_main_chat'),
    ] as any)).toBe(false);
    expect(mainToHermesConnected(INITIAL_DECK.nodes, [
      ...withoutHermesFlow,
      replacement('invalid'),
    ] as any)).toBe(false);
  });

  it('defines Main→Hermes invocation and only the intended workers on the blue bus', () => {
    expect(INITIAL_DECK.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'card_main_chat', target: 'card_hermes_steward', edgeType: 'flow' }),
      expect.objectContaining({ source: 'card_hermes_steward', target: 'card_research_agent', edgeType: 'flow' }),
      expect.objectContaining({ source: 'card_research_agent', target: 'card_magentic', edgeType: 'magentic_option' }),
      expect.objectContaining({ source: 'card_worldsignals_agent', target: 'card_magentic', edgeType: 'magentic_option' }),
    ]));
  });

  it('grants Main native Engraphis tools, Hermes native Graphiti tools, and Search web only', () => {
    const byId = new Map(INITIAL_DECK.nodes.map((node) => [node.id, node]));
    const mainTools = byId.get('card_main_chat')?.runtimeOptions?.tools ?? [];
    const hermesTools = byId.get('card_hermes_steward')?.runtimeOptions?.tools ?? [];
    const searchTools = byId.get('card_research_agent')?.runtimeOptions?.tools ?? [];
    expect(mainTools).toEqual(expect.arrayContaining([
      'engraphis.recall',
      'canvas.inspect',
    ]));
    expect(mainTools).not.toEqual(expect.arrayContaining(['knowgraph.ingest', 'web_search']));
    expect(hermesTools).toEqual(expect.arrayContaining([
      'graphiti.search_nodes',
      'graphiti.add_memory',
      'graphiti.add_triplet',
      'write_mag_one_instructions',
      'card.run_assistant_agent',
    ]));
    expect(hermesTools).not.toEqual(
      expect.arrayContaining(['web_search', 'run_mag_one', 'run_coder_subagent']),
    );
    expect(searchTools).toEqual(['web_search']);
    const hermesPrompt = byId.get('card_hermes_steward')?.prompt ?? '';
    expect(hermesPrompt).toContain('Do not claim that the external Hermes agent runtime executed');
    expect(hermesPrompt).not.toContain('native Hermes runtime is already active');
  });

  it('assigns Main and Hermes only tools exposed by the real Harness MCP catalog', async () => {
    process.env.LIQUIDAITY_PY_MCP_PYTHON = path.resolve(
      process.cwd(),
      '../apps/python-models/.venv/Scripts/python.exe',
    );
    process.env.LIQUIDAITY_PY_MCP_HOST = path.resolve(
      process.cwd(),
      '../apps/python-models/app/mcp_host.py',
    );
    const { listPythonAgentMcpTools } = await import(
      '../../../apps/backend/src/services/mcp/pythonAgentMcpClient'
    );
    const catalog = new Set(await listPythonAgentMcpTools());
    const cards = INITIAL_DECK.nodes.filter((node) =>
      node.runtimeBinding === 'main_chat' || node.runtimeBinding === 'hermes_steward'
    );
    const missing = cards.flatMap((card) =>
      (card.runtimeOptions?.tools ?? [])
        .filter((tool) => !catalog.has(tool))
        .map((tool) => `${card.runtimeBinding}:${tool}`)
    );
    expect(missing).toEqual([]);
  }, 30_000);
});
