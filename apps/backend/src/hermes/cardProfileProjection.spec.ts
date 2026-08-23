import { describe, expect, it, vi } from 'vitest';

import type { AgentCardInstance, DeckDocument } from '../types';
import {
  filterEffectiveHermesTools,
  HERMES_CARD_FIELD_MAP,
  applyHermesNativeOperation,
  hydrateHermesCardProfile,
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
    profile: {
      name: 'liquidaity-main',
      description: 'Native profile description',
      soul: 'Native SOUL instructions',
      model: { provider: 'openai-codex', default: 'gpt-native' },
      skills: [{ name: 'native-research', enabled: true }],
      toolsets: [{ name: 'native-web', enabled: true }],
      toolsetsPinned: true,
      mcpServers: [{
        name: 'liquidaity',
        transport: 'http',
        enabled: true,
        auth: 'header',
        credentialStatus: 'configured',
        toolFilter: [],
      }],
      learning: { count: 1, summary: '1 learned item', buckets: [] },
    },
  };
}

describe('Hermes Card native profile binding', () => {
  it('classifies Card-owned and native-owned fields without synchronization', () => {
    expect(HERMES_CARD_FIELD_MAP.find((row) => row.field === 'runtime.profile')).toMatchObject({
      classification: 'binding',
      nativeTarget: 'existing profile name',
    });
    for (const field of ['Card Prompt', 'skills', 'toolsets', 'mcpConnectionIds']) {
      expect(HERMES_CARD_FIELD_MAP.find((row) => row.field === field)).toMatchObject({
        classification: 'liquidaity-owned',
        nativeTarget: null,
      });
    }
    for (const field of ['profile Role/description', 'Soul', 'profile provider/model']) {
      expect(HERMES_CARD_FIELD_MAP.find((row) => row.field === field)).toMatchObject({
        classification: 'native-editable',
        owner: 'native-hermes-profile',
      });
    }
  });

  it('projects only the existing profile binding and Card grant ceiling', () => {
    const binding = projectHermesCardBinding(card, deck);
    expect(binding).toEqual({
      profile: 'liquidaity-main',
      mode: 'main',
      cardGrants: ['knowgraph.search', 'main.context'],
      nativeTools: ['Agent'],
      workspace: 'C:/Projects/LiquidAIty/main',
    });
    expect(JSON.stringify(binding)).not.toMatch(/prompt|role|soul|description|model|skills|toolsets|mcpConnectionIds/i);
  });

  it('reads native state once without comparing or synchronizing Card fields', async () => {
    const request = vi.fn(async () => native());
    const result = await hydrateHermesCardProfile(card, deck, request as never);

    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith('_profile/read', { name: 'liquidaity-main' });
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
    const request = vi.fn(async () => native());
    const result = await applyHermesNativeOperation(
      card,
      deck,
      { operation: 'profile.soul.set', value: 'New native Soul' },
      request as never,
    );

    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith('_native/apply', {
      profile: 'liquidaity-main',
      operation: 'profile.soul.set',
      value: 'New native Soul',
    });
    expect(result.binding.profile).toBe('liquidaity-main');
    expect(result.cardSaveMutatesNative).toBe(false);
    expect(card.prompt).toBe('Card-to-Card contract only');
  });

  it('Card Prompt and role changes cannot alter the native read request or readback', async () => {
    const request = vi.fn(async () => native());
    const changed = {
      ...card,
      role: 'Changed Card role',
      prompt: 'Changed Card contract',
    };
    const result = await hydrateHermesCardProfile(changed, deck, request as never);

    expect(request).toHaveBeenCalledWith('_profile/read', { name: 'liquidaity-main' });
    expect(result.native.description).toBe('Native profile description');
    expect(result.native.soul).toBe('Native SOUL instructions');
  });

  it('lets native discovery and the Card grant ceiling only reduce effective tools', () => {
    expect(filterEffectiveHermesTools(
      ['main.context', 'knowgraph.search', 'dangerous.write'],
      ['main.context', 'not.discovered'],
    )).toEqual(['main.context']);
  });
});
