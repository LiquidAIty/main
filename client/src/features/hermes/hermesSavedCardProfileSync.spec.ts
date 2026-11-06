// Entity: Card Profiles
// Relationship: Verifies saved Card authority projects a custom profile skill first, optional Hermes skills, exact tools/toolsets, models, and task modes without source-default replacement.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const profile = vi.hoisted(() => ({
  configure: vi.fn(),
  create: vi.fn(),
  createSkill: vi.fn(),
  load: vi.fn(),
  loadSkill: vi.fn(),
}));

vi.mock('./hermesProfileClient', () => ({
  configureHermesProfile: profile.configure,
  createHermesProfile: profile.create,
  createHermesSkill: profile.createSkill,
  loadHermesProfile: profile.load,
  loadHermesSkill: profile.loadSkill,
}));

vi.mock('../../lib/applicationApi', () => ({ applicationFetch: vi.fn() }));

import { synchronizeHermesSavedCardProfiles } from './hermesSavedCardProfileSync';
import type { DeckDocument } from '../../types/agentgraph';

function deck(): DeckDocument {
  return {
    id: 'deck_builder',
    name: 'Trading',
    version: 1,
    promptTemplates: [],
    edges: [],
    nodes: [{
      id: 'card_main_chat',
      kind: 'agent',
      templateId: 'template_assist',
      title: 'Main',
      prompt: '[ROLE]\nBoss.\n\n[ORCHESTRATOR SKILL]\nDelegate deliberately.',
      runtime: { kind: 'hermes', mode: 'main', profile: 'main' },
      runtimeOptions: {
        provider: 'openai', accessMode: 'chatgpt-account', modelKey: 'gpt-5.6-sol',
        providerModelId: 'gpt-5.6-sol', skills: ['hermes-agent'], tools: ['canvas.inspect'],
        toolsets: [], subagentType: 'none',
      },
      position: { x: 0, y: 0 },
    }, {
      id: 'card_knowgraph',
      kind: 'agent',
      templateId: 'template_assist',
      title: 'KnowGraph',
      prompt: '[ROLE]\nResearch.',
      runtime: { kind: 'hermes', mode: 'delegate', profile: 'knowgraph' },
      runtimeOptions: {
        provider: 'openai', accessMode: 'chatgpt-account', modelKey: 'gpt-5.6-luna',
        providerModelId: 'gpt-5.6-luna', skills: ['grounded-citations'],
        tools: ['graphiti.search_knows', 'graphiti.add_know'],
        toolsets: ['web', 'terminal', 'code_execution'], subagentType: 'none',
      },
      position: { x: 0, y: 0 },
    }, {
      id: 'card_magentic',
      kind: 'agent',
      templateId: 'template_assist',
      title: 'Magnetic',
      prompt: '[ROLE]\nCoordinate.',
      runtime: { kind: 'hermes', mode: 'magentic_one', profile: 'card_magentic' },
      runtimeOptions: {
        provider: 'openai', accessMode: 'chatgpt-account', modelKey: 'gpt-5.6-sol',
        skills: ['hermes-agent'], tools: [], toolsets: [], subagentType: 'none',
      },
      position: { x: 0, y: 0 },
    }],
  };
}

describe('saved Card profile publication', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    profile.load.mockRejectedValue(new Error('missing profile'));
    profile.create.mockResolvedValue({});
    profile.loadSkill.mockRejectedValue(new Error('missing custom skill'));
    profile.createSkill.mockResolvedValue(undefined);
    profile.configure.mockResolvedValue({});
  });

  it('publishes custom skills first and preserves optional library skills and grants', async () => {
    await expect(synchronizeHermesSavedCardProfiles(deck(), 'trading-project')).resolves.toEqual([
      'main', 'knowgraph', 'card_magentic',
    ]);

    expect(profile.createSkill).toHaveBeenCalledWith(
      'knowgraph',
      'knowgraph',
      expect.stringMatching(/name: knowgraph[\s\S]*grounded-citations[\s\S]*exact Graphiti readback/),
    );
    expect(profile.configure).toHaveBeenCalledWith(expect.objectContaining({
      profile: 'main',
      model: 'gpt-5.6-sol',
      provider: 'openai-codex',
      enabledSkills: ['main', 'hermes-agent'],
      autoLoadSkills: ['main', 'hermes-agent'],
      applicationTools: ['canvas.inspect'],
      enabledMcpServers: ['liquidaity'],
    }));
    expect(profile.configure).toHaveBeenCalledWith(expect.objectContaining({
      profile: 'knowgraph',
      enabledSkills: ['knowgraph', 'grounded-citations'],
      autoLoadSkills: ['knowgraph', 'grounded-citations'],
      enabledToolsets: ['web', 'terminal', 'code_execution'],
      applicationTools: ['graphiti.search_knows', 'graphiti.add_know'],
      enabledMcpServers: ['liquidaity'],
    }));
    expect(profile.configure).toHaveBeenCalledWith(expect.objectContaining({
      profile: 'card_magentic',
      enabledSkills: ['card_magentic', 'hermes-agent'],
      enabledToolsets: ['liquidaity'],
      taskMode: 'magnetic',
    }));
  });
});
