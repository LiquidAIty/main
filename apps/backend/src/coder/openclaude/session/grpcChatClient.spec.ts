import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const deckMocks = vi.hoisted(() => ({
  getDeckDocument: vi.fn(),
}));

vi.mock('../../../decks/store', () => ({
  getDeckDocument: deckMocks.getDeckDocument,
}));

import { deriveSessionId, resolveMainChatSystemPrompt, resolveThinkGraphAgentDefinition } from './grpcChatClient';

const THINKGRAPH_TOOLS = ['mcp__liquidaity__thinkgraph_get_graph_slice', 'mcp__liquidaity__thinkgraph_apply_live_patch'];

function deckWith(nodes: any[]) {
  return { deck: { id: 'deck_builder', name: 'Deck', nodes, edges: [] }, latestRun: null, runs: [], meta: { deckRevision: null, deckSavedAt: null } };
}

describe('resolveThinkGraphAgentDefinition', () => {
  beforeEach(() => {
    deckMocks.getDeckDocument.mockClear();
  });

  it('returns the saved card prompt and exact tool grants as structural config, with inherited context on', async () => {
    deckMocks.getDeckDocument.mockResolvedValueOnce(
      deckWith([{ id: 'card_thinkgraph_agent', prompt: 'Saved ThinkGraph prompt.', runtimeOptions: { tools: THINKGRAPH_TOOLS } }]),
    );
    const sessionId = deriveSessionId('project-1', 'main');
    const result = await resolveThinkGraphAgentDefinition(sessionId);
    expect(result).toEqual({
      agent_type: 'card_thinkgraph_agent',
      card_id: 'card_thinkgraph_agent',
      runtime_binding: 'thinkgraph_agent',
      system_prompt: 'Saved ThinkGraph prompt.',
      allowed_tools: THINKGRAPH_TOOLS,
      context_mode_inherit_parent: true,
    });
  });

  it('never carries graph rows, graph text, or conversation content — only card id/prompt/tools', async () => {
    deckMocks.getDeckDocument.mockResolvedValueOnce(
      deckWith([{ id: 'card_thinkgraph_agent', prompt: 'Saved ThinkGraph prompt.', runtimeOptions: { tools: THINKGRAPH_TOOLS } }]),
    );
    const result = await resolveThinkGraphAgentDefinition(deriveSessionId('project-1', 'main'));
    expect(Object.keys(result || {}).sort()).toEqual(
      ['agent_type', 'allowed_tools', 'card_id', 'context_mode_inherit_parent', 'runtime_binding', 'system_prompt'].sort(),
    );
  });

  it('returns null when zero ThinkGraph cards are configured (honest, no guess)', async () => {
    deckMocks.getDeckDocument.mockResolvedValueOnce(deckWith([{ id: 'card_main_chat', prompt: 'chat' }]));
    const result = await resolveThinkGraphAgentDefinition(deriveSessionId('project-1', 'main'));
    expect(result).toBeNull();
  });

  it('returns null when multiple ThinkGraph cards are ambiguous (honest, no guess)', async () => {
    deckMocks.getDeckDocument.mockResolvedValueOnce(
      deckWith([
        { id: 'card_thinkgraph_agent', prompt: 'a', runtimeOptions: { tools: THINKGRAPH_TOOLS } },
        { id: 'card_thinkgraph_agent_2', prompt: 'b', runtimeOptions: { binding: 'thinkgraph_agent', tools: THINKGRAPH_TOOLS } },
      ]),
    );
    const result = await resolveThinkGraphAgentDefinition(deriveSessionId('project-1', 'main'));
    expect(result).toBeNull();
  });

  it('returns null when the resolved card does not have exactly the two scoped graph tools', async () => {
    deckMocks.getDeckDocument.mockResolvedValueOnce(
      deckWith([{ id: 'card_thinkgraph_agent', prompt: 'Saved prompt.', runtimeOptions: { tools: ['read_thinkgraph_scope'] } }]),
    );
    const result = await resolveThinkGraphAgentDefinition(deriveSessionId('project-1', 'main'));
    expect(result).toBeNull();
  });

  it('degrades honestly to null on a deck/DB lookup failure — never throws into the chat turn', async () => {
    deckMocks.getDeckDocument.mockRejectedValueOnce(new Error('project_not_found'));
    const result = await resolveThinkGraphAgentDefinition(deriveSessionId('missing-project', 'main'));
    expect(result).toBeNull();
  });

  it('returns null for a malformed session id it cannot resolve a projectId from', async () => {
    const result = await resolveThinkGraphAgentDefinition('not-a-real-session-id');
    expect(result).toBeNull();
    expect(deckMocks.getDeckDocument).not.toHaveBeenCalled();
  });
});

describe('resolveMainChatSystemPrompt', () => {
  beforeEach(() => {
    deckMocks.getDeckDocument.mockClear();
  });

  it('resolves exactly one runtimeBinding=main_chat card structurally and returns its saved prompt verbatim', async () => {
    deckMocks.getDeckDocument.mockResolvedValueOnce(
      deckWith([{ id: 'card_openclaude_chat', runtimeBinding: 'main_chat', prompt: 'Saved parent prompt.' }]),
    );
    const result = await resolveMainChatSystemPrompt(deriveSessionId('project-1', 'main'));
    expect(result).toBe('Saved parent prompt.');
  });

  it('returns null when zero main_chat cards exist (honest, no guess)', async () => {
    deckMocks.getDeckDocument.mockResolvedValueOnce(deckWith([{ id: 'card_thinkgraph_agent', prompt: 'x' }]));
    const result = await resolveMainChatSystemPrompt(deriveSessionId('project-1', 'main'));
    expect(result).toBeNull();
  });

  it('returns null when multiple main_chat cards are ambiguous (honest, no guess)', async () => {
    deckMocks.getDeckDocument.mockResolvedValueOnce(
      deckWith([
        { id: 'card_openclaude_chat', runtimeBinding: 'main_chat', prompt: 'a' },
        { id: 'card_openclaude_chat_2', runtimeBinding: 'main_chat', prompt: 'b' },
      ]),
    );
    const result = await resolveMainChatSystemPrompt(deriveSessionId('project-1', 'main'));
    expect(result).toBeNull();
  });

  it('degrades honestly to null on a deck/DB lookup failure', async () => {
    deckMocks.getDeckDocument.mockRejectedValueOnce(new Error('project_not_found'));
    const result = await resolveMainChatSystemPrompt(deriveSessionId('missing-project', 'main'));
    expect(result).toBeNull();
  });
});

describe('startGrpcTurn request wiring — append, never replace, the vendored base prompt', () => {
  const SOURCE = readFileSync(join(__dirname, 'grpcChatClient.ts'), 'utf8');
  const GRPC_SERVER_SOURCE = readFileSync(
    join(__dirname, '../../../../../../localcoder/src/grpc/server.ts'),
    'utf8',
  );

  it('sends the saved main_chat prompt as append_system_prompt, never as custom_system_prompt', () => {
    expect(SOURCE).toContain('append_system_prompt: appendSystemPrompt');
    expect(SOURCE).not.toContain('custom_system_prompt');
    expect(SOURCE).not.toMatch(/\bcustomSystemPrompt\b/);
  });

  it('grpc/server.ts passes the saved prompt to QueryEngine as appendSystemPrompt, never customSystemPrompt', () => {
    expect(GRPC_SERVER_SOURCE).toContain('req.append_system_prompt');
    expect(GRPC_SERVER_SOURCE).toContain('appendSystemPrompt: req.append_system_prompt');
    expect(GRPC_SERVER_SOURCE).not.toContain('custom_system_prompt');
    expect(GRPC_SERVER_SOURCE).not.toMatch(/\bcustomSystemPrompt\b/);
  });
});
