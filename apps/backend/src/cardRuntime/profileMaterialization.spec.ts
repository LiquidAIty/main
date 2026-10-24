import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DeckCard, DeckDocument } from '../types';
import { CARD_RUNTIME_CONTRACT } from '../services/cardRuntimeGateway';

vi.mock('../services/mcp/internalMcpAuth', () => ({
  resolveInternalMcpUrl: () => 'http://127.0.0.1:8765/mcp',
}));

import {
  ensureSavedCardProfile,
  cardModelSelection,
  materializedCardPrompt,
  materializeSavedCardProfile,
  savedCardAgentRoster,
  type CardProfileState,
} from './profileMaterialization';

function card(id: string, title: string, mode: 'main' | 'delegate' | 'magentic_one'): DeckCard {
  return {
    id,
    kind: 'agent',
    templateId: 'template_assist',
    title,
    subtitle: `${title} specialty`,
    prompt: `[ROLE]\nPrivate ${title} instructions.\n\n[ORCHESTRATOR SKILL]\nUse @${title} for its saved specialty.`,
    runtime: { kind: CARD_RUNTIME_CONTRACT.kind, mode, profile: id },
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

  it('derives agent reachability from every enabled wire and leaves an unwired Card empty', () => {
    const value = deck();
    value.edges.push({ id: 'duplicate', source: 'main', target: 'builder', edgeType: 'flow' });
    const byId = new Map(value.nodes.map((item) => [item.id, item]));
    expect(savedCardAgentRoster(value, byId.get('main')!)).toEqual([
      'knowgraph', 'builder', 'magnetic', 'analyst',
    ]);
    expect(savedCardAgentRoster(value, byId.get('knowgraph')!)).toEqual(['main']);
    expect(savedCardAgentRoster(value, byId.get('analyst')!)).toEqual(['magnetic']);
    expect(savedCardAgentRoster(value, byId.get('unwired')!)).toEqual([]);
  });

  it('uses the same exact agent set for introductions without copying target prompts', () => {
    const value = deck();
    const prompt = materializedCardPrompt(value, value.nodes[0]);
    for (const title of ['KnowGraph', 'Builder', 'Magnetic', 'Analyst']) {
      expect(prompt).toContain(`[AGENT @${title}]`);
    }
    expect(prompt).not.toContain('[AGENT @Unwired]');
    expect(prompt).not.toContain('Private KnowGraph instructions.');
  });

  it('rejects a connected agent whose visible Card name is not an exact handle', () => {
    const value = deck();
    value.nodes[1].title = 'Know Graph';
    expect(() => materializedCardPrompt(value, value.nodes[0])).toThrow(
      'card_agent_address_invalid:knowgraph',
    );
  });

  it('fails closed on an enabled wire without two valid saved runtime Cards', () => {
    const value = deck();
    value.edges.push({ id: 'broken', source: 'main', target: 'missing', edgeType: 'flow' });
    expect(() => savedCardAgentRoster(value, value.nodes[0])).toThrow(
      'card_agent_roster_wire_invalid:broken',
    );
    value.edges[value.edges.length - 1].enabled = false;
    expect(savedCardAgentRoster(value, value.nodes[0])).toEqual([
      'knowgraph', 'builder', 'magnetic', 'analyst',
    ]);
  });

  it('maps the saved provider choice without a fallback', () => {
    expect(cardModelSelection({
      provider: 'openai',
      accessMode: 'chatgpt-account',
      providerModelId: 'gpt-6.1-sol',
    })).toEqual({ provider: 'openai-codex', model: 'gpt-6.1-sol' });
    expect(() => cardModelSelection({
      provider: 'openrouter',
      accessMode: 'chatgpt-account',
      providerModelId: 'model',
    })).toThrow('card_provider_access_mode_mismatch');
  });

  it('creates a missing profile with only connected agent introductions', async () => {
    const main = deck().nodes[0];
    let exists = false;
    const requestMock = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === 'profiles.describe') {
        if (!exists) throw Object.assign(new Error('missing'), { code: 4064 });
        return { name: 'main' };
      }
      if (method === 'profiles.create') {
        exists = true;
        expect(params).toMatchObject({ name: 'main', mirror_credentials: false });
        expect(String(params?.soul || '')).toContain('[AGENT @KnowGraph]');
        expect(String(params?.soul || '')).not.toContain('Private KnowGraph instructions.');
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

  it('writes and reads back the exact ordered upstream roster field', async () => {
    const main = deck().nodes[0];
    let current: CardProfileState = {
      name: 'main',
      description: 'old',
      soul: 'old',
      model: { provider: 'openai-codex', default: 'old-model' },
      skills: [{ name: CARD_RUNTIME_CONTRACT.essentialSkill, enabled: true }],
      toolsets: [],
      toolsets_pinned: true,
      mcp_servers: [],
      [CARD_RUNTIME_CONTRACT.profileRosterField]: [],
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
          [CARD_RUNTIME_CONTRACT.profileRosterField]: Array.isArray(
            params[CARD_RUNTIME_CONTRACT.profileRosterField],
          )
            ? (params[CARD_RUNTIME_CONTRACT.profileRosterField] as unknown[]).map(String)
            : current[CARD_RUNTIME_CONTRACT.profileRosterField],
        };
        if (params.ui_meta && typeof params.ui_meta === 'object') {
          profileRow = {
            ...profileRow,
            ui_meta: params.ui_meta,
            ui_meta_revisions: { [CARD_RUNTIME_CONTRACT.profileMarkerKey]: 1 },
          };
        }
        return { ok: true, applied: {} };
      }
      throw new Error(`unexpected:${method}`);
    });
    const request = requestMock as unknown as <T>(
      method: string, params?: Record<string, unknown>
    ) => Promise<T>;
    const roster = ['knowgraph', 'builder', 'magnetic', 'analyst'];
    const result = await materializeSavedCardProfile(
      request,
      deck(),
      main,
      'owner-one',
      current,
      [],
      [],
      roster,
    );
    expect(result[CARD_RUNTIME_CONTRACT.profileRosterField]).toEqual(roster);
    expect(configured).toHaveLength(1);
    expect(configured[0]).toMatchObject({
      name: 'main',
      description: 'Use @Main for its saved specialty.',
      provider: 'openai-codex',
      model: 'gpt-6.1-sol',
      [CARD_RUNTIME_CONTRACT.profileRosterField]: roster,
    });
    expect(String(configured[0].soul || '')).toContain('[AGENT @KnowGraph]');
    expect(String(configured[0].soul || '')).toContain(
      'This agent lives in the connected saved Card. Address it only through message_agent with target "@KnowGraph".',
    );
    expect(String(configured[0].soul || '')).not.toContain('Use @Main for its saved specialty.');
    expect(configured[0].ui_meta).toEqual({
      [CARD_RUNTIME_CONTRACT.profileMarkerKey]: { title: 'Main' },
    });
  });
});
