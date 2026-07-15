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
  id: 'card_main_chat', kind: 'agent', runtimeBinding: 'main_chat', runtimeType: 'assistant_agent',
  prompt: 'Main prompt', runtimeOptions: { provider: 'openrouter', modelKey: 'z-ai/glm-5.2', tools: ['thinkgraph.get_graph_slice', 'thinkgraph.submit_update', 'knowgraph.query', 'codegraph.search'] },
};
const hermes = {
  id: 'card_hermes_steward', kind: 'agent', runtimeBinding: 'hermes_steward', runtimeType: 'assistant_agent',
  prompt: 'Hermes prompt', runtimeOptions: { provider: 'openrouter', modelKey: 'z-ai/glm-5.2', tools: ['thinkgraph.get_graph_slice', 'knowgraph.query', 'knowgraph.ingest', 'codegraph.search', 'hermes.memory_write', 'write_mag_one_instructions', 'card.run_assistant_agent'] },
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
  });

  it('uses the orange network as the only Main child authority', () => {
    expect(selectDoorwayCards([main, hermes, search], [flow(main.id, hermes.id)], 'chat')).toEqual([hermes]);
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

  it('an extend-only bounded deadline never shortens its parent deadline', () => {
    expect(resolveHarnessTimeoutDeadline(120_000, 50_000, 30_000, true)).toBe(120_000);
    expect(resolveHarnessTimeoutDeadline(120_000, 110_000, 30_000, true)).toBe(140_000);
  });

  it('registers Hermes as a native inherited-context agent with exact MCP grants', () => {
    const definition = buildHarnessAgentDefinition(hermes, null, { allowedCardRunIds: [search.id] }) as any;
    expect(definition.system_prompt).toBe('Hermes prompt');
    expect(definition.context_mode_inherit_parent).toBe(true);
    expect(definition.allowed_tools).not.toContain('mcp__liquidaity__thinkgraph_submit_update');
    expect(definition.allowed_tools).toContain('mcp__liquidaity__knowgraph_ingest');
    expect(definition.allowed_tools).toContain('mcp__liquidaity__hermes_memory_write');
    expect(definition.allowed_tools).not.toContain('mcp__liquidaity__hermes_read_report');
    expect(definition.allowed_tools).not.toContain('mcp__liquidaity__hermes_write_report');
    expect(definition.allowed_tools).toContain('mcp__liquidaity__write_mag_one_instructions');
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

  it('adds server-minted project context to Hermes without requiring selected nodes', async () => {
    deckMocks.getDeckDocument.mockResolvedValue(doc([main, hermes, search], [flow(main.id, hermes.id), flow(hermes.id, search.id)]));
    const context = {
      projectId: 'p1',
      conversationId: 'c1',
      focusNodeIds: [],
      requestedOutcome: null,
    };
    const config = await resolveMainChatRuntimeConfig(deriveSessionId('p1', 'c1'), 'chat', 'req_1234abcd', context);
    const [definition] = config!.doorwayDefinitions as any[];
    expect(definition.system_prompt).toContain('[LIQUIDAITY_INVESTIGATION_CONTEXT]');
    expect(definition.system_prompt).toContain(JSON.stringify(context));
    expect(buildHarnessRuntimeContext(deriveSessionId('p1', 'c1'), 'req_1234abcd')).not.toContain(
      '[LIQUIDAITY_INVESTIGATION_CONTEXT]',
    );
  });

  it('does not inject the obsolete active-report channel into Main or Hermes', async () => {
    deckMocks.getDeckDocument.mockResolvedValue(doc([main, hermes, search], [flow(main.id, hermes.id), flow(hermes.id, search.id)]));
    const config = await resolveMainChatRuntimeConfig(deriveSessionId('p1', 'c1'), 'chat', 'req_new', {
      projectId: 'p1', conversationId: 'c1', focusNodeIds: [], requestedOutcome: null,
    });
    const hermesDefinition = config!.doorwayDefinitions[0] as any;
    expect(hermesDefinition.system_prompt).not.toContain('[LIQUIDAITY_HERMES_ACTIVE_REPORT]');
    const mainContext = buildHarnessRuntimeContext(deriveSessionId('p1', 'c1'), 'req_new');
    expect(mainContext).not.toContain('[LIQUIDAITY_HERMES_ACTIVE_REPORT]');
  });

  it('renders only runtime-stamped canonical Graph Views into Main context', () => {
    const context = buildHarnessRuntimeContext(deriveSessionId('p1', 'c1'), 'req_handback', {
      graphViews: [{
        schemaVersion: 'graph-view.v1', viewId: 'view-1:active:req_handback', authority: 'codegraph', status: 'active', projectId: 'p1', conversationId: 'c1',
        producingRole: 'user', receivingRole: 'main_chat', rootCanonicalNodeIds: ['symbol:one'], includedCanonicalNodeIds: ['symbol:one'], includedRelationships: [], query: 'selected code', filter: { nodeTypes: [], trustStates: [] }, hopDepth: 0, provenanceRefs: ['one.ts'], parentViewId: 'view-1',
        records: [{ canonicalId: 'symbol:one', summary: 'Selected symbol', selectionReason: 'Matched query', provenanceRefs: ['one.ts'], estimatedCharacters: 15, estimatedTokens: 4 }],
        omittedNeighborCount: 2, createdAt: '2026-07-15T00:00:00Z', updatedAt: '2026-07-15T01:00:00Z', invocationId: 'req_handback',
        runtime: { provider: 'openai', model: 'gpt-5.3', role: 'main_chat', invocationId: 'req_handback', attachedAt: '2026-07-15T01:00:00Z', includedRecords: 1, excludedRecords: 2, contextCharacters: 500, estimatedTokens: 125 },
      }],
    });
    expect(context).toContain('[LIQUIDAITY_GRAPH_VIEWS]');
    expect(context).toContain('symbol:one');
    expect(context).toContain('do not contain complete source records');
  });

  it('resolves Hermes to Search through the persisted second orange edge', async () => {
    deckMocks.getDeckDocument.mockResolvedValue(doc([main, hermes, search], [flow(main.id, hermes.id), flow(hermes.id, search.id)]));
    const [definition] = await resolveCardDoorwayDefinitions(deriveSessionId('p1', 'c1'), 'chat') as any[];
    expect(definition.card_id).toBe(hermes.id);
    expect(definition.allowed_card_run_ids).toEqual([search.id]);
  });
});
