import { describe, expect, it, vi } from 'vitest';

import type { AgentCardInstance, DeckDocument } from '../types';
import {
  applyHermesCardProfile,
  filterEffectiveHermesTools,
  HERMES_CARD_FIELD_MAP,
  HermesNativeProfileDriftError,
  hydrateHermesCardProfile,
  projectHermesCardIntent,
} from './cardProfileProjection';

const card: AgentCardInstance = {
  id: 'card_main',
  templateId: 'main',
  title: 'Main Chat',
  subtitle: 'Presentation only',
  role: 'Front-door planner',
  prompt: 'Persistent instructions only',
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

function native(overrides: Record<string, unknown> = {}) {
  return {
    profile: {
      name: 'liquidaity-main',
      description: 'Front-door planner',
      soul: 'Persistent instructions only',
      model: { provider: 'openai-codex', default: 'gpt-5.6-luna' },
      skills: [{ name: 'research', enabled: true }],
      toolsets: [{ name: 'web', enabled: true }],
      toolsetsPinned: true,
      mcpServers: [{
        name: 'liquidaity',
        transport: 'http',
        enabled: true,
        auth: 'header',
        credentialStatus: 'configured',
        toolFilter: [],
      }],
      ...overrides,
    },
  };
}

describe('Hermes Card compatibility projection', () => {
  it('classifies every approved field without making Card identity a profile identity', () => {
    expect(HERMES_CARD_FIELD_MAP.map((row) => row.field)).toEqual([
      'cardId/revision',
      'title/subtitle',
      'runtime.profile',
      'runtime.mode',
      'role',
      'prompt',
      'dynamicInput',
      'outputContract',
      'provider/model/accessMode',
      'reasoning/temperature/token/turn limits',
      'skills',
      'toolsets',
      'nativeTools',
      'mcpConnectionIds',
      'tools/Card grants',
      'knowledge/parentGraphId/data anchors',
      'Hermes memory',
      'workspace',
      'wires',
      'Card Run',
      'Kanban children/workers',
    ]);
    expect(HERMES_CARD_FIELD_MAP.find((row) => row.field === 'title/subtitle')).toMatchObject({
      classification: 'liquidaity-owned',
      nativeTarget: null,
    });
    expect(HERMES_CARD_FIELD_MAP.find((row) => row.field === 'dynamicInput')).toMatchObject({
      classification: 'run-only',
    });
  });

  it('maps only stable Card intent and leaves context, limits, and grants with LiquidAIty', () => {
    const projection = projectHermesCardIntent(card, deck);
    expect(projection).toMatchObject({
      profile: 'liquidaity-main',
      mode: 'main',
      description: 'Front-door planner',
      soul: 'Persistent instructions only',
      model: { provider: 'openai-codex', default: 'gpt-5.6-luna' },
      enabledSkills: ['research'],
      enabledToolsets: ['web'],
      enabledMcpServers: ['liquidaity'],
      cardGrants: ['knowgraph.search', 'main.context'],
      nativeTools: ['Agent'],
      workspace: 'C:/Projects/LiquidAIty/main',
    });
    const serialized = JSON.stringify(projection);
    expect(serialized).not.toContain('thinkgraph-1');
    expect(serialized).not.toContain('Presentation only');
    expect(serialized).not.toMatch(/outputContract|dynamicInput|temperature|maxTokens/i);
  });

  it('uses the existing structured Role section when an older Card lacks the additive role field', () => {
    const intent = projectHermesCardIntent({
      ...card,
      role: undefined,
      prompt: '# LIQUIDAITY_PROMPT_V1\n[ROLE]\nExisting role\n\n[GOAL]\nDo work',
    }, deck);
    expect(intent.description).toBe('Existing role');
  });

  it('hydrates an in-sync native profile and exposes nativeTools as an honest Run-only limitation', async () => {
    const request = vi.fn(async () => native());
    const result = await hydrateHermesCardProfile(card, deck, request as never);
    expect(result.drift).toEqual({ status: 'in_sync', fields: [] });
    expect(result.unsupported).toEqual([
      expect.objectContaining({ field: 'nativeTools', values: ['Agent'] }),
    ]);
    expect(result.native.mcpServers[0]).not.toHaveProperty('headers');
    expect(result.native.mcpServers[0]).not.toHaveProperty('env');
  });

  it('makes no native mutation for an identical no-op apply', async () => {
    const request = vi.fn(async () => native());
    const hydrated = await hydrateHermesCardProfile(card, deck, request as never);
    request.mockClear();
    const applied = await applyHermesCardProfile(card, deck, hydrated.fingerprint, request as never);
    expect(applied.mutated).toBe(false);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith('_profile/read', { name: 'liquidaity-main' });
  });

  it('applies the smallest changed sections and requires identical native readback', async () => {
    const before = native({
      description: 'Old role',
      soul: 'Old instructions',
      skills: [{ name: 'research', enabled: false }],
    });
    const request = vi.fn()
      .mockResolvedValueOnce(before)
      .mockResolvedValueOnce(before);
    const initial = await hydrateHermesCardProfile(card, deck, request as never);
    request.mockReset()
      .mockResolvedValueOnce(before)
      .mockResolvedValueOnce({ ok: true, applied: { description: true, soul: true, skills: true } })
      .mockResolvedValueOnce(native());

    const result = await applyHermesCardProfile(card, deck, initial.fingerprint, request as never);
    expect(result.mutated).toBe(true);
    expect(request.mock.calls[1]).toEqual([
      '_profile/apply',
      {
        name: 'liquidaity-main',
        description: 'Front-door planner',
        soul: 'Persistent instructions only',
        disabledSkills: [],
      },
    ]);
    expect(result.drift.status).toBe('in_sync');
  });

  it('refuses stale native fingerprints and unknown native selections before mutation', async () => {
    const request = vi.fn(async () => native());
    await expect(applyHermesCardProfile(card, deck, 'stale', request as never))
      .rejects.toBeInstanceOf(HermesNativeProfileDriftError);
    expect(request).toHaveBeenCalledTimes(1);

    const unknownSkill = {
      ...card,
      runtimeOptions: { ...card.runtimeOptions, skills: ['missing-skill'] },
    };
    request.mockClear();
    const hydrated = await hydrateHermesCardProfile(unknownSkill, deck, request as never);
    request.mockClear();
    await expect(applyHermesCardProfile(unknownSkill, deck, hydrated.fingerprint, request as never))
      .rejects.toThrow('hermes_native_selection_unsupported:skills');
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('lets live discovery and the Card grant ceiling only reduce effective tools', () => {
    expect(filterEffectiveHermesTools(
      ['main.context', 'knowgraph.search', 'dangerous.write'],
      ['main.context', 'not.discovered'],
    )).toEqual(['main.context']);
  });
});
