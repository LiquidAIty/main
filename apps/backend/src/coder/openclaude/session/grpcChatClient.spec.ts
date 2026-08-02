import { beforeEach, describe, expect, it, vi } from 'vitest';

const deckMocks = vi.hoisted(() => ({ getDeckDocument: vi.fn() }));
const mcpMocks = vi.hoisted(() => ({ listPythonAgentMcpTools: vi.fn() }));
vi.mock('../../../decks/store', () => ({
  BUILDER_DECK_ID: 'deck_builder',
  getDeckDocument: deckMocks.getDeckDocument,
}));
vi.mock('../../../services/mcp/pythonAgentMcpClient', () => ({
  listPythonAgentMcpTools: mcpMocks.listPythonAgentMcpTools,
}));

import {
  buildHarnessAgentDefinition,
  decodeGrpcProgressEvent,
  deriveSessionId,
  resolveMainChatRuntimeConfig,
  selectDoorwayCards,
} from './grpcChatClient';

const main = {
  id: 'card_main_chat', kind: 'agent', runtimeBinding: 'main_chat', runtimeType: 'assistant_agent',
  prompt: 'Main prompt', runtimeOptions: { provider: 'openrouter', modelKey: 'z-ai/glm-5.2', tools: ['engraphis.recall'], nativeTools: ['Agent'] },
};
const hermes = {
  id: 'card_hermes_steward', kind: 'agent', runtimeBinding: 'hermes_steward', runtimeType: 'assistant_agent',
  prompt: 'Hermes prompt', runtimeOptions: { provider: 'openrouter', modelKey: 'z-ai/glm-5.2', tools: ['graphiti.search_nodes', 'graphiti.add_memory', 'graphiti.add_triplet', 'hermes.memory.write', 'write_mag_one_instructions', 'card.run_assistant_agent'] },
};
const search = {
  id: 'card_research_agent', kind: 'agent', runtimeBinding: 'research_agent', runtimeType: 'assistant_agent',
  prompt: 'Search prompt', runtimeOptions: { provider: 'openrouter', modelKey: 'openai/gpt-5.1-chat', tools: ['web_search'] },
};
const coder = {
  id: 'card_local_coder', kind: 'agent', runtimeBinding: 'local_coder', runtimeType: 'local_coder',
  prompt: 'Coder prompt', runtimeOptions: { provider: 'openrouter', modelKey: 'z-ai/glm-5.2', tools: ['run_local_coder'] },
};
const flow = (source: string, target: string) => ({ id: `${source}:${target}`, source, target, edgeType: 'flow' });
const doc = (nodes: any[], edges: any[]) => ({ deck: { id: 'deck_builder', nodes, edges }, meta: { deckRevision: 'r1' } });

describe('native Main / Hermes / Search doorways', () => {
  beforeEach(() => {
    deckMocks.getDeckDocument.mockReset();
    mcpMocks.listPythonAgentMcpTools.mockReset();
    mcpMocks.listPythonAgentMcpTools.mockResolvedValue([
      'cbm.search_graph', 'cbm.index_status',
      'engraphis.recall', 'graphiti.search_nodes',
      'graphiti.add_memory', 'graphiti.add_triplet', 'hermes.memory.write',
      'write_mag_one_instructions', 'card.run_assistant_agent', 'web_search',
    ]);
  });

  it('uses the directed flow edge as the only Hermes authority', () => {
    expect(selectDoorwayCards([main, hermes, search], [flow(main.id, hermes.id)], 'chat')).toEqual([hermes]);
    expect(selectDoorwayCards([main, hermes], [], 'chat')).toEqual([]);
    expect(selectDoorwayCards([main, hermes], [flow(hermes.id, main.id)], 'chat')).toEqual([]);
    expect(selectDoorwayCards(
      [main, hermes],
      [{ id: 'invalid', source: main.id, target: hermes.id, edgeType: 'invalid' }],
      'chat',
    )).toEqual([]);
    expect(selectDoorwayCards([main, hermes], [], 'canvas')).toEqual([hermes]);
  });

  it('deduplicates Hermes and resolves authority by persisted flow, not a hard-coded card id', () => {
    const customHermes = { ...hermes, id: 'card_custom_hermes' };
    expect(selectDoorwayCards(
      [main, customHermes],
      [
        { ...flow(main.id, customHermes.id), id: 'flow-1' },
        { ...flow(main.id, customHermes.id), id: 'flow-2' },
      ],
      'chat',
    )).toEqual([customHermes]);
  });

  it('decodes opaque gRPC Agent text progress with its exact parent linkage', () => {
    expect(decodeGrpcProgressEvent({
      tool_use_id: 'child-delta-1',
      parent_tool_use_id: 'hermes-agent-call',
      data_json: JSON.stringify({
        type: 'agent_text_delta', agentId: 'agent-42', agentType: 'card_hermes_steward', text: 'live prose',
      }),
    })).toEqual({
      kind: 'progress', toolUseId: 'child-delta-1', parentToolUseId: 'hermes-agent-call',
      data: { type: 'agent_text_delta', agentId: 'agent-42', agentType: 'card_hermes_steward', text: 'live prose' },
    });
  });

  it('registers Hermes as a native inherited-context agent with exact MCP grants', () => {
    const definition = buildHarnessAgentDefinition(hermes, {
      allowedCardRunIds: [search.id],
      availableMcpTools: [
        'graphiti.search_nodes',
        'graphiti.add_memory', 'graphiti.add_triplet',
        'hermes.memory.write', 'write_mag_one_instructions',
        'card.run_assistant_agent',
      ],
    }) as any;
    expect(definition.system_prompt).toBe('Hermes prompt');
    expect(definition.context_mode_inherit_parent).toBe(true);
    expect(definition.allowed_tools).toContain('mcp__liquidaity__graphiti_search_nodes');
    expect(definition.allowed_tools).toContain('mcp__liquidaity__graphiti_add_memory');
    expect(definition.allowed_tools).toContain('mcp__liquidaity__graphiti_add_triplet');
    expect(definition.allowed_tools).toContain('mcp__liquidaity__write_mag_one_instructions');
    expect(definition.allowed_card_run_ids).toEqual([search.id]);
  });

  it('registers Search as a native inherited-context agent with web_search only', () => {
    const definition = buildHarnessAgentDefinition(search, {
      availableMcpTools: ['web_search'],
    }) as any;
    expect(definition.system_prompt).toBe('Search prompt');
    expect(definition.allowed_tools).toEqual(['mcp__liquidaity__web_search']);
    expect(definition.when_to_use).toContain('saved "card_research_agent" agent');
  });

  it('keeps Coder on the bounded saved-card control doorway', () => {
    const definition = buildHarnessAgentDefinition(coder) as any;
    expect(definition.allowed_tools).toEqual(['mcp__liquidaity__card_run_assistant_agent']);
    expect(definition.system_prompt).toContain('card_local_coder');
  });

  it('resolves Main plus Hermes only when Hermes has direct flow authority', async () => {
    deckMocks.getDeckDocument.mockResolvedValue(doc([main, hermes, search], [flow(main.id, hermes.id), flow(hermes.id, search.id)]));
    const config = await resolveMainChatRuntimeConfig(deriveSessionId('p1', 'c1'), 'chat');
    expect(config?.cardId).toBe(main.id);
    expect(config?.parentAllowedMcpTools).toEqual([
      'mcp__liquidaity__engraphis_recall',
    ]);
    // The card's assigned native tools travel verbatim — the engine filters
    // the parent's native schemas before serialization.
    expect(config?.parentAllowedNativeTools).toEqual(['Agent']);
    expect(config?.doorwayDefinitions.map((entry: any) => entry.card_id)).toEqual([hermes.id]);
  });

  it('accepts native CBM grants as part of the live Main MCP catalog', async () => {
    deckMocks.getDeckDocument.mockResolvedValue(doc(
      [{
        ...main,
        runtimeOptions: {
          ...main.runtimeOptions,
          tools: ['cbm.index_status'],
        },
      }],
      [],
    ));
    const config = await resolveMainChatRuntimeConfig(deriveSessionId('p1', 'c1'), 'chat');
    expect(config?.parentAllowedMcpTools).toEqual([
      'mcp__liquidaity__cbm_index_status',
    ]);
  });

  it('keeps Hermes system prompt exactly equal to its saved card prompt', async () => {
    deckMocks.getDeckDocument.mockResolvedValue(doc([main, hermes, search], [flow(main.id, hermes.id), flow(hermes.id, search.id)]));
    const config = await resolveMainChatRuntimeConfig(deriveSessionId('p1', 'c1'), 'chat', 'req_1234abcd');
    const [definition] = config!.doorwayDefinitions as any[];
    expect(definition.system_prompt).toBe('Hermes prompt');
  });

  it('does not inject the obsolete active-report channel into Main or Hermes', async () => {
    deckMocks.getDeckDocument.mockResolvedValue(doc([main, hermes, search], [flow(main.id, hermes.id), flow(hermes.id, search.id)]));
    const config = await resolveMainChatRuntimeConfig(deriveSessionId('p1', 'c1'), 'chat', 'req_new');
    const hermesDefinition = config!.doorwayDefinitions[0] as any;
    expect(hermesDefinition.system_prompt).not.toContain('[LIQUIDAITY_HERMES_ACTIVE_REPORT]');
  });

});
