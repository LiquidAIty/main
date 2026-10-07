import { describe, expect, it, vi } from 'vitest';

import type { AgentCardInstance, DeckDocument } from '../types';
import {
  hydrateHermesCardProfile,
  invokeHermesCardOperation,
  projectHermesCardBinding,
} from './cardProfileProjection';

const card: AgentCardInstance = {
  id: 'card_main',
  templateId: 'main',
  title: 'Main Chat',
  subtitle: 'Presentation only',
  role: 'Front-door planner',
  prompt: 'Card-to-Card contract only',
  outputContract: { type: 'markdown' },
  runtime: { kind: 'hermes', mode: 'main', profile: 'liquidaity-main' },
  runtimeOptions: {
    provider: 'openai',
    accessMode: 'chatgpt-account',
    modelKey: 'gpt-5.6-luna',
    subagentModel: {
      provider: 'openai',
      accessMode: 'chatgpt-account',
      modelKey: 'gpt-5.6-luna',
      providerModelId: 'gpt-5.6-luna',
    },
    reasoningEffort: 'high',
    temperature: 0.3,
    maxTokens: 4000,
    maxTurns: 20,
    skills: ['research'],
    toolsets: ['web'],
    mcpConnectionIds: ['liquidaity'],
    tools: ['main.context', 'knowgraph.search', 'hermes:tool:Agent'],
  },
  parentGraphId: 'thinkgraph-1',
  position: { x: 0, y: 0 },
};

const deck: Pick<DeckDocument, 'workspaceRoot'> = { workspaceRoot: 'C:/Projects/LiquidAIty/main' };

function profileState() {
  return {
    name: 'liquidaity-main',
    description: 'Hermes profile description',
    soul: 'Hermes SOUL instructions',
    model: { provider: 'openai-codex', default: 'gpt-hermes' },
    skills: [{ name: 'hermes-research', enabled: true }],
    toolsets: [{ name: 'hermes-web', enabled: true }],
    toolsets_pinned: true,
    mcp_servers: [{ name: 'liquidaity', enabled: true }],
  };
}

function hermesRequest() {
  return vi.fn(async (method: string) => {
    if (method === 'profiles.configure') return { ok: true, applied: { description: true } };
    if (method === 'profiles.describe') return profileState();
    if (method === 'mcp.servers.list') return { servers: [{ name: 'liquidaity', transport: 'http', auth: 'header' }] };
    if (method === 'learning.frames') return {
      count: 1,
      summary: ['1 learned item', '1 skill'],
      buckets: [{
        index: 0,
        label: 'Today',
        date: '2026-09-21',
        skills: 1,
        memories: 0,
        total: 1,
        category: 'skill',
        color: '#123456',
        nodes: [{
          id: 'skill:hermes-research',
          glyph: 'S',
          label: 'hermes-research',
          fullLabel: 'Hermes Research',
          meta: 'skill',
          body: 'Research procedure',
          style: 'green',
        }],
      }],
    };
    throw new Error(`unexpected_hermes_method:${method}`);
  });
}

describe('Hermes Card profile binding', () => {
  it('projects only the existing profile binding', () => {
    const binding = projectHermesCardBinding(card, deck);
    expect(binding).toEqual({
      profile: 'liquidaity-main',
      mode: 'main',
    });
    expect(JSON.stringify(binding)).not.toMatch(/prompt|role|soul|description|model|skills|toolsets|mcpConnectionIds/i);
  });

  it('reads the Hermes owners without comparing or synchronizing Card fields', async () => {
    const request = hermesRequest();
    const result = await hydrateHermesCardProfile(card, deck, request as never);

    expect(request).toHaveBeenCalledTimes(3);
    expect(request).toHaveBeenNthCalledWith(1, 'profiles.describe', { name: 'liquidaity-main' });
    expect(request).toHaveBeenNthCalledWith(2, 'mcp.servers.list', { profile: 'liquidaity-main' });
    expect(request).toHaveBeenNthCalledWith(3, 'learning.frames', { cols: 60, rows: 18, frames: 2 }, 'liquidaity-main');
    expect(result.profileApply).toBe('run_start');
    expect(result.cardSaveMutatesProfile).toBe(false);
    expect(result.desired.subagentModel?.providerModelId).toBe('gpt-5.6-luna');
    expect(result.profile).toMatchObject({
      description: 'Hermes profile description',
      soul: 'Hermes SOUL instructions',
      model: { provider: 'openai-codex', default: 'gpt-hermes' },
      learning: {
        count: 1,
        summary: ['1 learned item', '1 skill'],
        buckets: [{
          index: 0,
          label: 'Today',
          skills: 1,
          memories: 0,
          total: 1,
          nodes: [{
            id: 'skill:hermes-research',
            body: 'Research procedure',
            style: 'green',
          }],
        }],
      },
    });
    expect(result.profile).not.toHaveProperty('backgroundReview');
    expect(result.profile).not.toHaveProperty('subagentModel');
    expect(result.profile).not.toHaveProperty('memory');
    expect(result.profile).not.toHaveProperty('honcho');
    expect(result.profile.learning).not.toHaveProperty('graph');
    expect(result).not.toHaveProperty('subagentModelMaterialization');
    expect(result).not.toHaveProperty('drift');
    expect(result).not.toHaveProperty('fingerprint');
    expect(result.profile.mcpServers[0]).not.toHaveProperty('headers');
    expect(result.profile.mcpServers[0]).not.toHaveProperty('env');
  });

  it('delegates exactly one Hermes operation and then returns its exact readback', async () => {
    const request = hermesRequest();
    const result = await invokeHermesCardOperation(
      card,
      deck,
      { method: 'profiles.configure', params: { description: 'New Hermes description' } },
      request as never,
    );

    expect(request).toHaveBeenCalledTimes(4);
    expect(request).toHaveBeenNthCalledWith(1, 'profiles.configure', {
      name: 'liquidaity-main',
      description: 'New Hermes description',
    });
    expect(result.readback.binding.profile).toBe('liquidaity-main');
    expect(result.readback.cardSaveMutatesProfile).toBe(false);
    expect(card.prompt).toBe('Card-to-Card contract only');
  });

  it('Card Prompt and role changes cannot alter the Hermes read request or readback', async () => {
    const request = hermesRequest();
    const changed = {
      ...card,
      role: 'Changed Card role',
      prompt: 'Changed Card contract',
    };
    const result = await hydrateHermesCardProfile(changed, deck, request as never);

    expect(request).toHaveBeenCalledWith('profiles.describe', { name: 'liquidaity-main' });
    expect(result.profile.description).toBe('Hermes profile description');
    expect(result.profile.soul).toBe('Hermes SOUL instructions');
  });

});
