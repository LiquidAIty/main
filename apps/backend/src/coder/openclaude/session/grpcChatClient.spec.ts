import { beforeEach, describe, expect, it, vi } from 'vitest';

const deckMocks = vi.hoisted(() => ({ getDeckDocument: vi.fn() }));
vi.mock('../../../decks/store', () => ({
  BUILDER_DECK_ID: 'deck_builder',
  getDeckDocument: deckMocks.getDeckDocument,
}));

import {
  buildHarnessAgentDefinition,
  buildHarnessRuntimeContext,
  deriveSessionId,
  resolveCardDoorwayDefinitions,
  resolveMainChatRuntimeConfig,
  selectDoorwayCards,
} from './grpcChatClient';

const main = {
  id: 'card_main_chat', kind: 'agent', runtimeBinding: 'main_chat', runtimeType: 'assistant_agent',
  prompt: 'Main prompt', runtimeOptions: { provider: 'openrouter', modelKey: 'z-ai/glm-5.2', tools: ['thinkgraph.get_graph_slice', 'thinkgraph.submit_update', 'knowgraph.query', 'codegraph.search'] },
};
const hermes = {
  id: 'card_hermes_steward', kind: 'agent', runtimeBinding: 'hermes_steward', runtimeType: 'assistant_agent',
  prompt: 'Hermes prompt', runtimeOptions: { provider: 'openrouter', modelKey: 'z-ai/glm-5.2', tools: ['thinkgraph.get_graph_slice', 'knowgraph.query', 'knowgraph.ingest', 'codegraph.search', 'hermes.memory_write', 'hermes.write_report', 'card.run_assistant_agent'] },
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
  beforeEach(() => deckMocks.getDeckDocument.mockReset());

  it('uses the orange network as the only Main child authority', () => {
    expect(selectDoorwayCards([main, hermes, search], [flow(main.id, hermes.id)], 'chat')).toEqual([hermes]);
  });

  it('registers Hermes as a native inherited-context agent with exact MCP grants', () => {
    const definition = buildHarnessAgentDefinition(hermes, null, { allowedCardRunIds: [search.id] }) as any;
    expect(definition.system_prompt).toBe('Hermes prompt');
    expect(definition.context_mode_inherit_parent).toBe(true);
    expect(definition.allowed_tools).not.toContain('mcp__liquidaity__thinkgraph_submit_update');
    expect(definition.allowed_tools).toContain('mcp__liquidaity__knowgraph_ingest');
    expect(definition.allowed_tools).toContain('mcp__liquidaity__hermes_memory_write');
    expect(definition.allowed_tools).toContain('mcp__liquidaity__hermes_write_report');
    expect(definition.allowed_card_run_ids).toEqual([search.id]);
  });

  it('registers Search as a native inherited-context agent with web_search only', () => {
    const definition = buildHarnessAgentDefinition(search) as any;
    expect(definition.system_prompt).toBe('Search prompt');
    expect(definition.allowed_tools).toEqual(['mcp__liquidaity__web_search']);
    expect(definition.when_to_use).toMatch(/URLs.*titles.*domains/i);
  });

  it('keeps Coder on the bounded saved-card control doorway', () => {
    const definition = buildHarnessAgentDefinition(coder) as any;
    expect(definition.allowed_tools).toEqual(['mcp__liquidaity__card_run_assistant_agent']);
    expect(definition.system_prompt).toContain('card_local_coder');
  });

  it('resolves Main plus Hermes only when only Hermes is orange-connected', async () => {
    deckMocks.getDeckDocument.mockResolvedValue(doc([main, hermes, search], [flow(main.id, hermes.id), flow(hermes.id, search.id)]));
    const config = await resolveMainChatRuntimeConfig(deriveSessionId('p1', 'c1'), 'chat');
    expect(config?.cardId).toBe(main.id);
    expect(config?.parentAllowedMcpTools).toEqual([
      'mcp__liquidaity__thinkgraph_get_graph_slice',
      'mcp__liquidaity__thinkgraph_submit_update',
      'mcp__liquidaity__knowgraph_query',
      'mcp__liquidaity__codegraph_search',
    ]);
    expect(config?.doorwayDefinitions.map((entry: any) => entry.card_id)).toEqual([hermes.id]);
  });

  it('adds the compact server-minted investigation context to Hermes only', async () => {
    deckMocks.getDeckDocument.mockResolvedValue(doc([main, hermes, search], [flow(main.id, hermes.id), flow(hermes.id, search.id)]));
    const context = {
      projectId: 'p1',
      conversationId: 'c1',
      anchorNodeIds: ['run:42'],
      requestedOutcome: 'Inspect the selected run.',
    };
    const config = await resolveMainChatRuntimeConfig(deriveSessionId('p1', 'c1'), 'chat', 'req_1234abcd', context);
    const [definition] = config!.doorwayDefinitions as any[];
    expect(definition.system_prompt).toContain('[LIQUIDAITY_INVESTIGATION_CONTEXT]');
    expect(definition.system_prompt).toContain(JSON.stringify(context));
    expect(buildHarnessRuntimeContext(deriveSessionId('p1', 'c1'), 'req_1234abcd')).not.toContain(
      '[LIQUIDAITY_INVESTIGATION_CONTEXT]',
    );
  });

  it('resolves Hermes to Search through the persisted second orange edge', async () => {
    deckMocks.getDeckDocument.mockResolvedValue(doc([main, hermes, search], [flow(main.id, hermes.id), flow(hermes.id, search.id)]));
    const [definition] = await resolveCardDoorwayDefinitions(deriveSessionId('p1', 'c1'), 'chat') as any[];
    expect(definition.card_id).toBe(hermes.id);
    expect(definition.allowed_card_run_ids).toEqual([search.id]);
  });
});
