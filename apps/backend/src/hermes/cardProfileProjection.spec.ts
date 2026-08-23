import { describe, expect, it, vi } from 'vitest';

import type { AgentCardInstance, DeckDocument } from '../types';
import {
  hydrateHermesCardProfile,
  invokeHermesNativeOperation,
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
    reasoningEffort: 'high',
    temperature: 0.3,
    maxTokens: 4000,
    maxTurns: 20,
    skills: ['research'],
    toolsets: ['web'],
    nativeTools: ['Agent'],
    mcpConnectionIds: ['liquidaity'],
    tools: ['main.context', 'knowgraph.search'],
  },
  parentGraphId: 'thinkgraph-1',
  position: { x: 0, y: 0 },
};

const deck: Pick<DeckDocument, 'workspaceRoot'> = { workspaceRoot: 'C:/Projects/LiquidAIty/main' };

function native() {
  return {
    name: 'liquidaity-main',
    description: 'Native profile description',
    soul: 'Native SOUL instructions',
    model: { provider: 'openai-codex', default: 'gpt-native' },
    skills: [{ name: 'native-research', enabled: true }],
    toolsets: [{ name: 'native-web', enabled: true }],
    toolsets_pinned: true,
    mcp_servers: [{ name: 'liquidaity', enabled: true }],
  };
}

function nativeRequest() {
  return vi.fn(async (method: string) => {
    if (method === 'profiles.configure') return { ok: true, applied: { soul: true } };
    if (method === 'profiles.describe') return native();
    if (method === 'mcp.servers.list') return { servers: [{ name: 'liquidaity', transport: 'http', auth: 'header' }] };
    if (method === 'learning.frames') return { count: 1, summary: '1 learned item', buckets: [] };
    throw new Error(`unexpected_native_method:${method}`);
  });
}

describe('Hermes Card native profile binding', () => {
  it('projects only the existing profile binding', () => {
    const binding = projectHermesCardBinding(card, deck);
    expect(binding).toEqual({
      profile: 'liquidaity-main',
      mode: 'main',
    });
    expect(JSON.stringify(binding)).not.toMatch(/prompt|role|soul|description|model|skills|toolsets|mcpConnectionIds/i);
  });

  it('reads the native owners without comparing or synchronizing Card fields', async () => {
    const request = nativeRequest();
    const result = await hydrateHermesCardProfile(card, deck, request as never);

    expect(request).toHaveBeenCalledTimes(3);
    expect(request).toHaveBeenNthCalledWith(1, 'profiles.describe', { name: 'liquidaity-main' });
    expect(request).toHaveBeenNthCalledWith(2, 'mcp.servers.list', { profile: 'liquidaity-main' });
    expect(request).toHaveBeenNthCalledWith(3, 'learning.frames', { cols: 60, rows: 18, frames: 2 }, 'liquidaity-main');
    expect(result.nativeApply).toBe('explicit');
    expect(result.cardSaveMutatesNative).toBe(false);
    expect(result.native).toMatchObject({
      description: 'Native profile description',
      soul: 'Native SOUL instructions',
      model: { provider: 'openai-codex', default: 'gpt-native' },
    });
    expect(result).not.toHaveProperty('drift');
    expect(result).not.toHaveProperty('fingerprint');
    expect(result.native.mcpServers[0]).not.toHaveProperty('headers');
    expect(result.native.mcpServers[0]).not.toHaveProperty('env');
  });

  it('delegates exactly one native operation and then returns its exact readback', async () => {
    const request = nativeRequest();
    const result = await invokeHermesNativeOperation(
      card,
      deck,
      { method: 'profiles.configure', params: { soul: 'New native Soul' } },
      request as never,
    );

    expect(request).toHaveBeenCalledTimes(4);
    expect(request).toHaveBeenNthCalledWith(1, 'profiles.configure', {
      name: 'liquidaity-main',
      soul: 'New native Soul',
    });
    expect(result.readback.binding.profile).toBe('liquidaity-main');
    expect(result.readback.cardSaveMutatesNative).toBe(false);
    expect(card.prompt).toBe('Card-to-Card contract only');
  });

  it('Card Prompt and role changes cannot alter the native read request or readback', async () => {
    const request = nativeRequest();
    const changed = {
      ...card,
      role: 'Changed Card role',
      prompt: 'Changed Card contract',
    };
    const result = await hydrateHermesCardProfile(changed, deck, request as never);

    expect(request).toHaveBeenCalledWith('profiles.describe', { name: 'liquidaity-main' });
    expect(result.native.description).toBe('Native profile description');
    expect(result.native.soul).toBe('Native SOUL instructions');
  });

});
