import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DeckCard, DeckDocument } from '../types';

vi.mock('../services/mcp/internalMcpAuth', () => ({
  resolveInternalMcpUrl: () => 'http://127.0.0.1:8765/mcp',
}));

import {
  ensureSavedCardProfile,
  hermesProfileModelSelection,
  materializeSavedCardProfile,
  savedCardBotRoster,
  type HermesProfileState,
} from './profileMaterialization';

function card(id: string, title: string, mode: 'main' | 'delegate' | 'magentic_one'): DeckCard {
  return {
    id,
    kind: 'agent',
    templateId: 'template_assist',
    title,
    subtitle: `${title} specialty`,
    prompt: `[ORCHESTRATOR SKILL]\nUse @${title} for its saved specialty.`,
    runtime: { kind: 'hermes', mode, profile: id },
    runtimeOptions: {
      provider: 'openai',
      accessMode: 'chatgpt-account',
      modelKey: 'gpt-6.1-sol',
      providerModelId: 'gpt-6.1-sol',
      skills: [],
      toolsets: [],
      tools: [],
      mcpConnectionIds: [],
    },
    position: { x: 0, y: 0 },
  } as DeckCard;
}

function deck(): DeckDocument {
  const main = card('main', 'Main', 'main');
  const know = card('knowgraph', 'KnowGraph', 'delegate');
  const builder = card('builder', 'Builder', 'delegate');
  const magnetic = card('magnetic', 'Magnetic', 'magentic_one');
  const analyst = card('analyst', 'Analyst', 'delegate');
  const unwired = card('unwired', 'Unwired', 'delegate');
  return {
    id: 'deck-one',
    nodes: [main, know, builder, magnetic, analyst, unwired],
    edges: [
      { id: 'one', source: 'knowgraph', target: 'main', edgeType: 'flow' },
      { id: 'two', source: 'main', target: 'builder', edgeType: 'flow' },
      { id: 'three', source: 'analyst', target: 'magnetic', edgeType: 'magentic_option' },
    ],
  } as DeckDocument;
}

describe('saved Card profile projection', () => {
  beforeEach(() => vi.clearAllMocks());

  it('makes every wired Card a Main Bot and gives another Card only its connected Bots', () => {
    const value = deck();
    const byId = new Map(value.nodes.map((item) => [item.id, item]));
    expect(savedCardBotRoster(value, byId.get('main')!)).toEqual([
      'knowgraph', 'builder', 'magnetic', 'analyst',
    ]);
    expect(savedCardBotRoster(value, byId.get('knowgraph')!)).toEqual(['main']);
    expect(savedCardBotRoster(value, byId.get('analyst')!)).toEqual(['magnetic']);
    expect(savedCardBotRoster(value, byId.get('unwired')!)).toEqual([]);
  });

  it('maps the saved provider choice without a fallback', () => {
    expect(hermesProfileModelSelection({
      provider: 'openai',
      accessMode: 'chatgpt-account',
      providerModelId: 'gpt-6.1-sol',
    })).toEqual({ provider: 'openai-codex', model: 'gpt-6.1-sol' });
    expect(() => hermesProfileModelSelection({
      provider: 'openrouter',
      accessMode: 'chatgpt-account',
      providerModelId: 'model',
    })).toThrow('hermes_saved_provider_access_mode_mismatch');
  });

  it('creates a missing profile through the standard create and describe methods', async () => {
    const main = deck().nodes[0];
    let exists = false;
    const requestMock = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === 'profiles.describe') {
        if (!exists) throw Object.assign(new Error('missing'), { code: 4064 });
        return { name: 'main' };
      }
      if (method === 'profiles.create') {
        exists = true;
        expect(params).toMatchObject({
          name: 'main',
          mirror_credentials: false,
        });
        expect(String(params?.soul || '')).toContain('[BOT @KnowGraph]');
        expect(String(params?.soul || '')).not.toContain('Use @Main for its saved specialty.');
        return { ok: true, name: 'main' };
      }
      throw new Error(`unexpected:${method}`);
    });
    const request = requestMock as unknown as <T>(
      method: string, params?: Record<string, unknown>
    ) => Promise<T>;
    await expect(ensureSavedCardProfile(request, deck(), main, 'owner-one')).resolves.toMatchObject({
      name: 'main',
    });
  });

  it('configures only standard profile fields plus the exact Bot roster', async () => {
    const main = deck().nodes[0];
    let current: HermesProfileState = {
      name: 'main',
      description: 'old',
      soul: 'old',
      model: { provider: 'openai-codex', default: 'old-model' },
      skills: [{ name: 'hermes-agent', enabled: true }],
      toolsets: [],
      toolsets_pinned: true,
      mcp_servers: [],
      bot_mode_roster: [],
    };
    let profileRow: Record<string, unknown> = {
      name: 'main', ui_meta: {}, ui_meta_revisions: {},
    };
    const configured: Record<string, unknown>[] = [];
    const requestMock = vi.fn(async (method: string, params: Record<string, unknown> = {}) => {
      if (method === 'mcp.servers.list') return { servers: [] };
      if (method === 'profiles.list') return { profiles: [profileRow] };
      if (method === 'profiles.describe') return current;
      if (method === 'profiles.configure') {
        configured.push(params);
        current = {
          ...current,
          description: String(params.description ?? current.description),
          soul: String(params.soul ?? current.soul),
          model: {
            provider: String(params.provider ?? current.model?.provider),
            default: String(params.model ?? current.model?.default),
          },
          bot_mode_roster: Array.isArray(params.bot_mode_roster)
            ? params.bot_mode_roster.map(String)
            : current.bot_mode_roster,
        };
        if (params.ui_meta && typeof params.ui_meta === 'object') {
          profileRow = {
            ...profileRow,
            ui_meta: params.ui_meta,
            ui_meta_revisions: { 'hermes-bots': 1 },
          };
        }
        return { ok: true, applied: {} };
      }
      throw new Error(`unexpected:${method}`);
    });
    const request = requestMock as unknown as <T>(
      method: string, params?: Record<string, unknown>
    ) => Promise<T>;
    const result = await materializeSavedCardProfile(
      request,
      deck(),
      main,
      'owner-one',
      current,
      [],
      [],
      ['knowgraph', 'builder', 'magnetic', 'analyst'],
    );
    expect(result.bot_mode_roster).toEqual(['knowgraph', 'builder', 'magnetic', 'analyst']);
    expect(configured).toHaveLength(1);
    expect(configured[0]).toMatchObject({
      name: 'main',
      description: 'Use @Main for its saved specialty.',
      provider: 'openai-codex',
      model: 'gpt-6.1-sol',
      bot_mode_roster: ['knowgraph', 'builder', 'magnetic', 'analyst'],
    });
    expect(String(configured[0].soul || '')).toContain('[BOT @KnowGraph]');
    expect(String(configured[0].soul || '')).toContain(
      'Use this Bot only through message_agent with target "@KnowGraph".',
    );
    expect(String(configured[0].soul || '')).not.toContain('Use @Main for its saved specialty.');
    expect(configured[0]).not.toHaveProperty('task_mode');
    expect(configured[0]).not.toHaveProperty('delegation');
    expect(configured[0]).not.toHaveProperty('bot_mode_sessions');
    expect(configured[0]).not.toHaveProperty('bot_mode_card_contexts');
    expect(configured[0].ui_meta).toEqual({ 'hermes-bots': { title: 'Main' } });
  });
});
