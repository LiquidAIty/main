import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const deckMocks = vi.hoisted(() => ({
  getDeckDocument: vi.fn(),
}));

vi.mock('../../../decks/store', () => ({
  getDeckDocument: deckMocks.getDeckDocument,
}));

import {
  deriveSessionId,
  resolveCardDoorwayDefinitions,
  resolveMainChatSystemPrompt,
  selectDoorwayCards,
} from './grpcChatClient';

const CARD_RUN_CONTROL_TOOL = 'mcp__liquidaity__card_run_assistant_agent';

function deckWith(nodes: any[]) {
  return { deck: { id: 'deck_builder', name: 'Deck', nodes, edges: [] }, latestRun: null, runs: [], meta: { deckRevision: null, deckSavedAt: null } };
}

const TG_CARD = { id: 'card_thinkgraph_agent', title: 'ThinkGraph Agent', prompt: 'Saved ThinkGraph prompt.', runtimeOptions: { tools: ['read_thinkgraph_scope', 'apply_thinkgraph_patch'] } };
const RESEARCH_CARD = { id: 'card_research_agent', title: 'Research Agent', prompt: 'Saved research prompt.', runtimeOptions: { tools: ['retrieve_knowgraph_context'] } };
const MAIN_CHAT_CARD = { id: 'card_main_chat', title: 'OpenClaude Chat', prompt: 'parent prompt' };

describe('resolveCardDoorwayDefinitions — thin card-bound doorways, one per saved card', () => {
  beforeEach(() => {
    deckMocks.getDeckDocument.mockClear();
  });

  it('chat mode exposes exactly the one ThinkGraph doorway with ONLY the generic control tool', async () => {
    deckMocks.getDeckDocument.mockResolvedValueOnce(deckWith([MAIN_CHAT_CARD, TG_CARD, RESEARCH_CARD]));
    const defs = await resolveCardDoorwayDefinitions(deriveSessionId('project-1', 'main'), 'chat');
    expect(defs).toHaveLength(1);
    const def = defs[0] as any;
    expect(def.agent_type).toBe('card_thinkgraph_agent');
    expect(def.card_id).toBe('card_thinkgraph_agent');
    expect(def.runtime_binding).toBe('thinkgraph_agent');
    expect(def.allowed_tools).toEqual([CARD_RUN_CONTROL_TOOL]);
    expect(def.context_mode_inherit_parent).toBe(true);
  });

  it('the doorway never duplicates card configuration — no card prompt, no card tool grants', async () => {
    deckMocks.getDeckDocument.mockResolvedValueOnce(deckWith([TG_CARD]));
    const [def] = (await resolveCardDoorwayDefinitions(deriveSessionId('project-1', 'main'), 'chat')) as any[];
    expect(def.system_prompt).not.toContain('Saved ThinkGraph prompt.');
    expect(def.allowed_tools).not.toContain('read_thinkgraph_scope');
    expect(def.allowed_tools).not.toContain('apply_thinkgraph_patch');
    // The doorway relays through the one control tool it is bound to.
    expect(def.system_prompt).toContain(CARD_RUN_CONTROL_TOOL);
    expect(def.system_prompt).toContain('card_thinkgraph_agent');
  });

  it('canvas mode exposes every eligible card as a doorway — never main_chat, never subgraph children, never disabled', async () => {
    deckMocks.getDeckDocument.mockResolvedValueOnce(
      deckWith([
        MAIN_CHAT_CARD,
        TG_CARD,
        RESEARCH_CARD,
        { ...RESEARCH_CARD, id: 'card_child', parentGraphId: 'card_research_agent' },
        { ...RESEARCH_CARD, id: 'card_disabled', enabled: false },
        { ...RESEARCH_CARD, id: 'card_bus', runtimeType: 'magentic_one' },
      ]),
    );
    const defs = await resolveCardDoorwayDefinitions(deriveSessionId('project-1', 'main'), 'canvas');
    expect(defs.map((d: any) => d.agent_type).sort()).toEqual(['card_research_agent', 'card_thinkgraph_agent']);
  });

  it('chat mode yields no doorways when zero ThinkGraph cards exist (honest, no guess)', async () => {
    deckMocks.getDeckDocument.mockResolvedValueOnce(deckWith([MAIN_CHAT_CARD, RESEARCH_CARD]));
    const defs = await resolveCardDoorwayDefinitions(deriveSessionId('project-1', 'main'), 'chat');
    expect(defs).toEqual([]);
  });

  it('chat mode yields no doorways when multiple ThinkGraph cards are ambiguous (honest, no guess)', async () => {
    deckMocks.getDeckDocument.mockResolvedValueOnce(
      deckWith([TG_CARD, { ...TG_CARD, id: 'card_tg_2', runtimeOptions: { binding: 'thinkgraph_agent' } }]),
    );
    const defs = await resolveCardDoorwayDefinitions(deriveSessionId('project-1', 'main'), 'chat');
    expect(defs).toEqual([]);
  });

  it('degrades honestly to no doorways on a deck/DB lookup failure — never throws into the chat turn', async () => {
    deckMocks.getDeckDocument.mockRejectedValueOnce(new Error('project_not_found'));
    const defs = await resolveCardDoorwayDefinitions(deriveSessionId('missing-project', 'main'), 'chat');
    expect(defs).toEqual([]);
  });

  it('returns no doorways for a malformed session id without a deck lookup', async () => {
    const defs = await resolveCardDoorwayDefinitions('not-a-real-session-id', 'chat');
    expect(defs).toEqual([]);
    expect(deckMocks.getDeckDocument).not.toHaveBeenCalled();
  });
});

describe('selectDoorwayCards — structural mode filters only', () => {
  it('chat mode selects only the single thinkgraph-bound card', () => {
    expect(selectDoorwayCards([MAIN_CHAT_CARD, TG_CARD, RESEARCH_CARD], 'chat').map((c) => c.id)).toEqual([
      'card_thinkgraph_agent',
    ]);
  });

  it('canvas mode excludes the main_chat parent card', () => {
    const ids = selectDoorwayCards([MAIN_CHAT_CARD, TG_CARD, RESEARCH_CARD], 'canvas').map((c) => c.id);
    expect(ids).not.toContain('card_main_chat');
    expect(ids).toEqual(['card_thinkgraph_agent', 'card_research_agent']);
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
