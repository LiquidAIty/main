import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const deckMocks = vi.hoisted(() => ({
  getDeckDocument: vi.fn(),
}));

vi.mock('../../../decks/store', () => ({
  BUILDER_DECK_ID: 'deck_builder',
  getDeckDocument: deckMocks.getDeckDocument,
}));

import {
  buildHarnessRuntimeContext,
  buildHarnessAgentDefinition,
  deriveSessionId,
  doorwayWhenToUse,
  resolveCardDoorwayDefinitions,
  resolveInvokingCardId,
  resolveMainChatRuntimeConfig,
  resolveMainChatSystemPrompt,
  selectDoorwayCards,
} from './grpcChatClient';

const CARD_RUN_CONTROL_TOOL = 'mcp__liquidaity__card_run_assistant_agent';

describe('resolveInvokingCardId — durable caller identity, never inferred', () => {
  const doorways = ['card_hermes_steward', 'card_local_coder'];

  it('attributes an empty agent_type to the parent main_chat card', () => {
    expect(resolveInvokingCardId('', doorways, 'card_main_chat')).toBe('card_main_chat');
    expect(resolveInvokingCardId('   ', doorways, 'card_main_chat')).toBe('card_main_chat');
  });

  it('attributes a known doorway agent_type to that child card (parent/child distinguishable)', () => {
    expect(resolveInvokingCardId('card_hermes_steward', doorways, 'card_main_chat')).toBe('card_hermes_steward');
    expect(resolveInvokingCardId('card_local_coder', doorways, 'card_main_chat')).toBe('card_local_coder');
  });

  it('reports an unknown agent_type explicitly — never silently attributed to a card', () => {
    expect(resolveInvokingCardId('card_never_configured', doorways, 'card_main_chat')).toBe(
      'unknown:card_never_configured',
    );
  });

  it('does not misattribute when the doorway list is empty', () => {
    expect(resolveInvokingCardId('card_hermes_steward', [], 'card_main_chat')).toBe(
      'unknown:card_hermes_steward',
    );
    expect(resolveInvokingCardId('', [], 'card_main_chat')).toBe('card_main_chat');
  });
});

// Chat-mode doorways resolve from the persisted ORANGE network (flow edges
// FROM the main_chat card) — deckWith takes the edges that ARE that authority.
function deckWith(nodes: any[], edges: any[] = []) {
  return { deck: { id: 'deck_builder', name: 'Deck', nodes, edges }, latestRun: null, runs: [], meta: { deckRevision: null, deckSavedAt: null } };
}

function flow(source: string, target: string) {
  return { id: `edge_${source}_${target}`, source, target, edgeType: 'flow' };
}

const TG_CARD = { id: 'card_thinkgraph_agent', kind: 'agent', title: 'ThinkGraph Agent', prompt: 'Saved ThinkGraph prompt.', runtimeOptions: { tools: ['read_thinkgraph_scope', 'apply_thinkgraph_patch'] } };
const RESEARCH_CARD = { id: 'card_research_agent', kind: 'agent', title: 'Research Agent', prompt: 'Saved research prompt.', runtimeOptions: { tools: ['retrieve_knowgraph_context'] } };
const LOCAL_CODER_CARD = { id: 'card_local_coder', kind: 'agent', title: 'Local Coder', runtimeType: 'local_coder', runtimeBinding: 'local_coder', prompt: 'Saved coder prompt.', runtimeOptions: { tools: ['run_local_coder'], provider: 'openai', modelKey: 'gpt-5.1-chat-latest' } };
const HERMES_CARD = { id: 'card_hermes_steward', kind: 'agent', title: 'Hermes', runtimeBinding: 'hermes_steward', prompt: 'Saved Hermes prompt — verbatim.', runtimeOptions: { provider: 'openrouter', modelKey: 'z-ai/glm-5.2', tools: ['hermes.memory_read', 'read_model_results'] } };
const MAIN_CHAT_CARD = { id: 'card_main_chat', kind: 'agent', title: 'OpenClaude Chat', runtimeBinding: 'main_chat', prompt: 'parent prompt' };

describe('resolveCardDoorwayDefinitions — thin card-bound doorways, one per saved card', () => {
  beforeEach(() => {
    deckMocks.getDeckDocument.mockClear();
  });

  it('chat mode exposes exactly the orange-connected children with ONLY the generic control tool', async () => {
    deckMocks.getDeckDocument.mockResolvedValueOnce(
      deckWith(
        [MAIN_CHAT_CARD, TG_CARD, LOCAL_CODER_CARD, RESEARCH_CARD],
        [flow('card_main_chat', 'card_thinkgraph_agent'), flow('card_main_chat', 'card_local_coder')],
      ),
    );
    const defs = await resolveCardDoorwayDefinitions(deriveSessionId('project-1', 'main'), 'chat');
    expect(defs).toHaveLength(2);
    const byCard = new Map(defs.map((def: any) => [def.card_id, def]));
    const thinkgraph = byCard.get('card_thinkgraph_agent') as any;
    const localCoder = byCard.get('card_local_coder') as any;
    expect(thinkgraph.agent_type).toBe('card_thinkgraph_agent');
    expect(thinkgraph.runtime_binding).toBe('thinkgraph_agent');
    expect(localCoder.agent_type).toBe('card_local_coder');
    expect(localCoder.runtime_binding).toBe('local_coder');
    expect(thinkgraph.allowed_tools).toEqual([CARD_RUN_CONTROL_TOOL]);
    expect(localCoder.allowed_tools).toEqual([CARD_RUN_CONTROL_TOOL]);
    expect(localCoder.context_mode_inherit_parent).toBe(true);
  });

  it('the doorway never duplicates card configuration — no card prompt, no card tool grants', async () => {
    deckMocks.getDeckDocument.mockResolvedValueOnce(
      deckWith([MAIN_CHAT_CARD, TG_CARD], [flow('card_main_chat', 'card_thinkgraph_agent')]),
    );
    const [def] = (await resolveCardDoorwayDefinitions(deriveSessionId('project-1', 'main'), 'chat')) as any[];
    expect(def.system_prompt).not.toContain('Saved ThinkGraph prompt.');
    expect(def.allowed_tools).not.toContain('read_thinkgraph_scope');
    expect(def.allowed_tools).not.toContain('apply_thinkgraph_patch');
    // The doorway relays through the one control tool it is bound to.
    expect(def.system_prompt).toContain(CARD_RUN_CONTROL_TOOL);
    expect(def.system_prompt).toContain('card_thinkgraph_agent');
  });

  it('registers Hermes directly as the native inherited-context saved-card agent with no wrapper', () => {
    const definition = buildHarnessAgentDefinition(HERMES_CARD) as any;
    expect(definition.system_prompt).toBe(HERMES_CARD.prompt);
    expect(definition.system_prompt).not.toContain(CARD_RUN_CONTROL_TOOL);
    // The card's Tools selection IS the MCP grant, mapped to harness names.
    expect(definition.allowed_tools).toEqual([
      'mcp__liquidaity__hermes_memory_read',
      'mcp__liquidaity__read_model_results',
    ]);
    expect(definition.context_mode_inherit_parent).toBe(true);
    expect(definition.model).toBe('z-ai/glm-5.2');
  });

  it('the ThinkGraph doorway tells the model it can WRITE the real graph (so it delegates, not conceptualizes)', async () => {
    deckMocks.getDeckDocument.mockResolvedValueOnce(
      deckWith([MAIN_CHAT_CARD, TG_CARD], [flow('card_main_chat', 'card_thinkgraph_agent')]),
    );
    const [def] = (await resolveCardDoorwayDefinitions(deriveSessionId('project-1', 'main'), 'chat')) as any[];
    const wtu = String(def.when_to_use || '');
    expect(wtu).toMatch(/write/i);
    expect(wtu).toMatch(/ThinkGraph/);
    expect(wtu).toMatch(/conceptual|text-only/i); // explicitly forbids the conceptual substitute
    // The raw write tool is still NEVER exposed to the Harness model directly.
    expect(def.allowed_tools).toEqual([CARD_RUN_CONTROL_TOOL]);
  });

  it('doorwayWhenToUse states real capability per binding, generic otherwise', () => {
    expect(doorwayWhenToUse('thinkgraph_agent', 'ThinkGraph Agent')).toMatch(/READ and WRITE/);
    expect(doorwayWhenToUse('local_coder', 'Local Coder')).toMatch(/coding/i);
    expect(doorwayWhenToUse('local_coder', 'Local Coder')).toMatch(/read-only source audits/i);
    expect(doorwayWhenToUse('local_coder', 'Local Coder')).toMatch(/own file tools/i);
    // Hermes scoped preparation is FOREGROUND with a bounded assignment (not a
    // background/async steward), invocation is model judgment, and the steward
    // NEVER owns prompt.md or launches Mag One.
    expect(doorwayWhenToUse('hermes_steward', 'Hermes Steward')).toMatch(/FOREGROUND/);
    expect(doorwayWhenToUse('hermes_steward', 'Hermes Steward')).toMatch(/bounded scoped assignment/);
    expect(doorwayWhenToUse('hermes_steward', 'Hermes Steward')).toMatch(/Model judgment decides/);
    expect(doorwayWhenToUse('hermes_steward', 'Hermes Steward')).toMatch(/complete live parent/);
    expect(doorwayWhenToUse('hermes_steward', 'Hermes Steward')).toMatch(/never writes the approved\s+prompt\.md/);
    // The overloaded "background" framing for scoped prep is gone.
    expect(doorwayWhenToUse('hermes_steward', 'Hermes Steward')).not.toMatch(/background/i);
    expect(doorwayWhenToUse('', 'Some Card')).toContain('Some Card');
  });

  it('canvas mode exposes every eligible card as a doorway — never main_chat, never subgraph children, never disabled', async () => {
    deckMocks.getDeckDocument.mockResolvedValueOnce(
      deckWith([
        MAIN_CHAT_CARD,
        TG_CARD,
        LOCAL_CODER_CARD,
        RESEARCH_CARD,
        { ...RESEARCH_CARD, id: 'card_child', parentGraphId: 'card_research_agent' },
        { ...RESEARCH_CARD, id: 'card_disabled', enabled: false },
        { ...RESEARCH_CARD, id: 'card_bus', runtimeType: 'magentic_one' },
      ]),
    );
    const defs = await resolveCardDoorwayDefinitions(deriveSessionId('project-1', 'main'), 'canvas');
    expect(defs.map((d: any) => d.agent_type).sort()).toEqual(['card_local_coder', 'card_research_agent', 'card_thinkgraph_agent']);
  });

  it('chat mode exposes only orange-connected children — an unconnected card is never a doorway', async () => {
    deckMocks.getDeckDocument.mockResolvedValueOnce(
      deckWith([MAIN_CHAT_CARD, LOCAL_CODER_CARD, RESEARCH_CARD], [flow('card_main_chat', 'card_local_coder')]),
    );
    const defs = await resolveCardDoorwayDefinitions(deriveSessionId('project-1', 'main'), 'chat');
    expect(defs.map((d: any) => d.agent_type)).toEqual(['card_local_coder']);
  });

  it('chat mode yields no doorways when the main_chat card has no orange edges (honest, no guess)', async () => {
    deckMocks.getDeckDocument.mockResolvedValueOnce(deckWith([MAIN_CHAT_CARD, RESEARCH_CARD], []));
    const defs = await resolveCardDoorwayDefinitions(deriveSessionId('project-1', 'main'), 'chat');
    expect(defs).toEqual([]);
  });

  it('chat mode never invents a doorway from an orange edge whose target card is missing, and never duplicates one from duplicate edges', async () => {
    deckMocks.getDeckDocument.mockResolvedValueOnce(
      deckWith(
        [MAIN_CHAT_CARD, LOCAL_CODER_CARD],
        [
          flow('card_main_chat', 'card_local_coder'),
          flow('card_main_chat', 'card_local_coder'),
          flow('card_main_chat', 'card_ghost'),
        ],
      ),
    );
    const defs = await resolveCardDoorwayDefinitions(deriveSessionId('project-1', 'main'), 'chat');
    expect(defs.map((d: any) => d.agent_type)).toEqual(['card_local_coder']);
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

describe('selectDoorwayCards — orange network is the only chat-mode authority', () => {
  it('chat mode selects exactly the cards orange-connected FROM the main_chat card, in edge order', () => {
    expect(
      selectDoorwayCards(
        [MAIN_CHAT_CARD, TG_CARD, LOCAL_CODER_CARD, RESEARCH_CARD],
        [flow('card_main_chat', 'card_thinkgraph_agent'), flow('card_main_chat', 'card_local_coder')],
        'chat',
      ).map((c) => c.id),
    ).toEqual(['card_thinkgraph_agent', 'card_local_coder']);
  });

  it('chat mode selects an orange-connected Hermes; a reverse-direction edge grants nothing', () => {
    expect(
      selectDoorwayCards(
        [MAIN_CHAT_CARD, HERMES_CARD, LOCAL_CODER_CARD],
        [flow('card_main_chat', 'card_hermes_steward'), flow('card_local_coder', 'card_main_chat')],
        'chat',
      ).map((c) => c.id),
    ).toEqual(['card_hermes_steward']);
  });

  it('canvas mode excludes the main_chat parent card and needs no edges', () => {
    const ids = selectDoorwayCards([MAIN_CHAT_CARD, TG_CARD, LOCAL_CODER_CARD, RESEARCH_CARD], [], 'canvas').map((c) => c.id);
    expect(ids).not.toContain('card_main_chat');
    expect(ids).toEqual(['card_thinkgraph_agent', 'card_local_coder', 'card_research_agent']);
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

describe('buildHarnessRuntimeContext', () => {
  it('exposes the exact server-owned project, deck, and conversation identities to the Harness', () => {
    expect(
      buildHarnessRuntimeContext(deriveSessionId('project-123', 'conversation-456')),
    ).toContain('active projectId: project-123');
    expect(
      buildHarnessRuntimeContext(deriveSessionId('project-123', 'conversation-456')),
    ).toContain('active deckId: deck_builder');
    expect(
      buildHarnessRuntimeContext(deriveSessionId('project-123', 'conversation-456')),
    ).toContain('active conversationId: conversation-456');
  });

  it('does not invent context for a malformed session id', () => {
    expect(buildHarnessRuntimeContext('not-a-real-session-id')).toBeNull();
  });
});

describe('resolveMainChatRuntimeConfig', () => {
  beforeEach(() => {
    deckMocks.getDeckDocument.mockClear();
  });

  it('resolves saved main_chat prompt/model plus real doorways from the persisted deck', async () => {
    deckMocks.getDeckDocument.mockResolvedValueOnce({
      ...deckWith(
        [
          {
            id: 'card_main_chat',
            kind: 'agent',
            runtimeBinding: 'main_chat',
            prompt: 'Saved parent prompt.',
            title: 'Main Chat / Harness',
            runtimeOptions: { provider: 'openai', modelKey: 'gpt-5.1-chat-latest' },
          },
          TG_CARD,
          LOCAL_CODER_CARD,
        ],
        [flow('card_main_chat', 'card_thinkgraph_agent'), flow('card_main_chat', 'card_local_coder')],
      ),
      meta: { deckRevision: 'rev-1', deckSavedAt: null },
    });

    const config = await resolveMainChatRuntimeConfig(deriveSessionId('project-1', 'main'), 'chat');
    expect(config).toMatchObject({
      cardId: 'card_main_chat',
      provider: 'openai',
      modelKey: 'gpt-5.1-chat-latest',
      providerModelId: 'gpt-5.1-chat-latest',
      prompt: 'Saved parent prompt.',
      deckRevision: 'rev-1',
    });
    expect(config?.doorwayDefinitions.map((def: any) => def.card_id)).toEqual([
      'card_thinkgraph_agent',
      'card_local_coder',
    ]);
  });

  it('returns null when the saved main_chat model is missing instead of using a hidden default', async () => {
    deckMocks.getDeckDocument.mockResolvedValueOnce(
      deckWith([{ id: 'card_main_chat', runtimeBinding: 'main_chat', prompt: 'Saved parent prompt.' }]),
    );
    await expect(resolveMainChatRuntimeConfig(deriveSessionId('project-1', 'main'), 'chat')).resolves.toBeNull();
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
