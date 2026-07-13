import { beforeEach, describe, expect, it, vi } from 'vitest';

const deckMocks = vi.hoisted(() => ({ getDeckDocument: vi.fn() }));
const reportMocks = vi.hoisted(() => ({ readLatestHermesReport: vi.fn(() => null) }));
vi.mock('../../../decks/store', () => ({
  BUILDER_DECK_ID: 'deck_builder',
  getDeckDocument: deckMocks.getDeckDocument,
}));
vi.mock('../../hermes/hermesReportArtifact', () => ({
  readLatestHermesReport: reportMocks.readLatestHermesReport,
}));

import {
  buildHarnessAgentDefinition,
  buildHarnessRuntimeContext,
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
  prompt: 'Hermes prompt', runtimeOptions: { provider: 'openrouter', modelKey: 'z-ai/glm-5.2', tools: ['thinkgraph.get_graph_slice', 'knowgraph.query', 'knowgraph.ingest', 'codegraph.search', 'hermes.memory_write', 'hermes.read_report', 'hermes.write_report', 'write_mag_one_instructions', 'card.run_assistant_agent'] },
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
    reportMocks.readLatestHermesReport.mockReset();
    reportMocks.readLatestHermesReport.mockReturnValue(null);
  });

  it('uses the orange network as the only Main child authority', () => {
    expect(selectDoorwayCards([main, hermes, search], [flow(main.id, hermes.id)], 'chat')).toEqual([hermes]);
  });

  it('post-report completion grace extends an expiring turn but never shortens its parent deadline', () => {
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
    expect(definition.allowed_tools).toContain('mcp__liquidaity__hermes_read_report');
    expect(definition.allowed_tools).toContain('mcp__liquidaity__hermes_write_report');
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

  it('injects the bounded active report context into both Main and Hermes without copying its body', async () => {
    deckMocks.getDeckDocument.mockResolvedValue(doc([main, hermes, search], [flow(main.id, hermes.id), flow(hermes.id, search.id)]));
    reportMocks.readLatestHermesReport.mockReturnValue({
      reportId: 'hermes:req_old', status: 'updated', summary: 'Identity question remains open.',
      projectId: 'p1', conversationId: 'c1', parentRunId: 'req_old', artifactRunId: 'req_old',
      focusNodeIds: [], requestedOutcome: null, createdAt: '2026-07-13T00:00:00.000Z',
      updatedAt: '2026-07-13T00:01:00.000Z', revision: 2, reportMarkdown: '# Long body',
      linkedThinkGraphNodeIds: ['question:identity'], linkedKnowGraphRefs: [], linkedCodeGraphRefs: ['apps/backend/src/routes/coder.routes.ts'],
    });
    const config = await resolveMainChatRuntimeConfig(deriveSessionId('p1', 'c1'), 'chat', 'req_new', {
      projectId: 'p1', conversationId: 'c1', focusNodeIds: [], requestedOutcome: null,
    });
    const hermesDefinition = config!.doorwayDefinitions[0] as any;
    expect(hermesDefinition.system_prompt).toContain('[LIQUIDAITY_HERMES_ACTIVE_REPORT]');
    expect(hermesDefinition.system_prompt).not.toContain('# Long body');
    const mainContext = buildHarnessRuntimeContext(deriveSessionId('p1', 'c1'), 'req_new', {
      activeHermesReport: config!.activeHermesReport,
    });
    expect(mainContext).toContain('[LIQUIDAITY_HERMES_ACTIVE_REPORT]');
    expect(mainContext).toContain('question:identity');
    expect(mainContext).not.toContain('# Long body');
  });

  it('resolves Hermes to Search through the persisted second orange edge', async () => {
    deckMocks.getDeckDocument.mockResolvedValue(doc([main, hermes, search], [flow(main.id, hermes.id), flow(hermes.id, search.id)]));
    const [definition] = await resolveCardDoorwayDefinitions(deriveSessionId('p1', 'c1'), 'chat') as any[];
    expect(definition.card_id).toBe(hermes.id);
    expect(definition.allowed_card_run_ids).toEqual([search.id]);
  });
});
