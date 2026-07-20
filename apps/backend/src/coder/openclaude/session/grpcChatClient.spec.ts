import { beforeEach, describe, expect, it, vi } from 'vitest';

const deckMocks = vi.hoisted(() => ({ getDeckDocument: vi.fn() }));
vi.mock('../../../decks/store', () => ({
  BUILDER_DECK_ID: 'deck_builder',
  getDeckDocument: deckMocks.getDeckDocument,
}));

import {
  buildHarnessAgentDefinition,
  buildHarnessRuntimeContext,
  decodeGrpcProgressEvent,
  deriveSessionId,
  resolveCardDoorwayDefinitions,
  resolveHarnessTimeoutDeadline,
  resolveMainChatRuntimeConfig,
  selectDoorwayCards,
} from './grpcChatClient';

const main = {
  id: 'card_main_chat',
  kind: 'agent',
  runtimeBinding: 'main_chat',
  runtimeType: 'assistant_agent',
  prompt: 'Main prompt',
  runtimeOptions: {
    provider: 'openrouter',
    modelKey: 'z-ai/glm-5.2',
    tools: [
      'thinkgraph.get_graph_slice',
      'thinkgraph.submit_update',
      'knowgraph.query',
      'codegraph.search',
    ],
    nativeTools: ['Agent'],
  },
};
const search = {
  id: 'card_research_agent',
  kind: 'agent',
  runtimeBinding: 'research_agent',
  runtimeType: 'assistant_agent',
  prompt: 'Search prompt',
  runtimeOptions: {
    provider: 'openrouter',
    modelKey: 'openai/gpt-5.1-chat',
    tools: ['web_search'],
  },
};
const coder = {
  id: 'card_local_coder',
  kind: 'agent',
  runtimeBinding: 'local_coder',
  runtimeType: 'local_coder',
  prompt: 'Coder prompt',
  runtimeOptions: {
    provider: 'openrouter',
    modelKey: 'z-ai/glm-5.2',
    tools: ['run_local_coder'],
  },
};
const flow = (source: string, target: string) => ({
  id: `${source}:${target}`,
  source,
  target,
  edgeType: 'flow',
});
const doc = (nodes: any[], edges: any[]) => ({
  deck: { id: 'deck_builder', nodes, edges },
  meta: { deckRevision: 'r1' },
});

describe('native saved-card doorways', () => {
  beforeEach(() => {
    deckMocks.getDeckDocument.mockReset();
  });

  it('uses only directed flow edges from Main in chat mode', () => {
    expect(selectDoorwayCards([main, search], [flow(main.id, search.id)], 'chat')).toEqual([search]);
    expect(selectDoorwayCards([main, search], [], 'chat')).toEqual([]);
    expect(selectDoorwayCards([main, search], [flow(search.id, main.id)], 'chat')).toEqual([]);
    expect(
      selectDoorwayCards(
        [main, search],
        [{ id: 'invalid', source: main.id, target: search.id, edgeType: 'invalid' }],
        'chat',
      ),
    ).toEqual([]);
  });

  it('exposes configured cards, but never Main, for direct canvas testing', () => {
    expect(selectDoorwayCards([main, search, coder], [], 'canvas')).toEqual([search, coder]);
  });

  it('decodes opaque gRPC Agent text progress with its exact parent linkage', () => {
    expect(
      decodeGrpcProgressEvent({
        tool_use_id: 'child-delta-1',
        parent_tool_use_id: 'search-agent-call',
        data_json: JSON.stringify({
          type: 'agent_text_delta',
          agentId: 'agent-42',
          agentType: 'card_research_agent',
          text: 'live prose',
        }),
      }),
    ).toEqual({
      kind: 'progress',
      toolUseId: 'child-delta-1',
      parentToolUseId: 'search-agent-call',
      data: {
        type: 'agent_text_delta',
        agentId: 'agent-42',
        agentType: 'card_research_agent',
        text: 'live prose',
      },
    });
  });

  it('an extend-only bounded deadline never shortens its parent deadline', () => {
    expect(resolveHarnessTimeoutDeadline(120_000, 50_000, 30_000, true)).toBe(120_000);
    expect(resolveHarnessTimeoutDeadline(120_000, 110_000, 30_000, true)).toBe(140_000);
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

  it('resolves Main plus its persisted direct doorway', async () => {
    deckMocks.getDeckDocument.mockResolvedValue(
      doc([main, search], [flow(main.id, search.id)]),
    );
    const config = await resolveMainChatRuntimeConfig(deriveSessionId('p1', 'c1'), 'chat');
    expect(config?.cardId).toBe(main.id);
    expect(config?.parentAllowedMcpTools).toEqual([
      'mcp__liquidaity__thinkgraph_get_graph_slice',
      'mcp__liquidaity__thinkgraph_submit_update',
      'mcp__liquidaity__knowgraph_query',
      'mcp__liquidaity__codegraph_search',
    ]);
    expect(config?.parentAllowedNativeTools).toEqual(['Agent']);
    expect(config?.doorwayDefinitions.map((entry: any) => entry.card_id)).toEqual([search.id]);
  });

  it('renders compact server graph context into Main context, never view JSON', () => {
    const compact = [
      '[LIQUIDAITY_GRAPH_CONTEXT]',
      'projection: unified:abc123 | project: p1 | conversation: c1 | role: main_chat',
      'SELECTED RECORDS:',
      'CodeGraph (1):',
      '- [Function] one — one.ts (symbol:one)',
    ].join('\n');
    const context = buildHarnessRuntimeContext(deriveSessionId('p1', 'c1'), 'req_handback', {
      graphContext: compact,
    });
    expect(context).toContain('[LIQUIDAITY_GRAPH_CONTEXT]');
    expect(context).toContain('symbol:one');
    expect(context).toContain('does not transfer graph authority');
    expect(context).not.toContain('[LIQUIDAITY_GRAPH_VIEWS]');
    expect(context).not.toContain('"records"');
    expect(buildHarnessRuntimeContext(deriveSessionId('p1', 'c1'), 'req_handback')).not.toContain(
      '[LIQUIDAITY_GRAPH_CONTEXT]',
    );
  });

  it('resolves Search with no fabricated child-card authority', async () => {
    deckMocks.getDeckDocument.mockResolvedValue(
      doc([main, search], [flow(main.id, search.id)]),
    );
    const [definition] = (await resolveCardDoorwayDefinitions(
      deriveSessionId('p1', 'c1'),
      'chat',
    )) as any[];
    expect(definition.card_id).toBe(search.id);
    expect(definition.allowed_card_run_ids).toBeUndefined();
  });
});
