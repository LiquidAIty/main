// @vitest-environment jsdom
// Entity: Card Profiles
// Relationship: Checks Card UI bindings to the settings API; simulated responses do not prove live Hermes settings.
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const hermes = vi.hoisted(() => ({
  configureProfile: vi.fn(),
  createProfile: vi.fn(),
  createSkill: vi.fn(),
  loadProfile: vi.fn(),
  loadSkill: vi.fn(),
  saveSkill: vi.fn(),
}));
vi.mock('../features/agentbuilder/CardScriptEditor', () => ({ CardScriptEditor: ({ cardId }: any) => <div data-testid="python-ide">{cardId}</div> }));
vi.mock('../features/hermes/hermesProfileClient', () => ({
  configureHermesProfile: hermes.configureProfile,
  createHermesProfile: hermes.createProfile,
  createHermesSkill: hermes.createSkill,
  loadHermesProfile: hermes.loadProfile,
  loadHermesSkill: hermes.loadSkill,
  saveHermesSkill: hermes.saveSkill,
}));
import { CardEditor } from './CardEditor';
const config = { runtime: { kind: 'hermes' as const, mode: 'delegate' as const, profile: 'trading' },
  provider: 'openai' as const, access_mode: 'chatgpt-account' as const, model_key: 'gpt-5.6-sol',
  prompt_template: '# CARD_PROMPT_V1\n[ROLE]\nResearch carefully.\n\n[GOAL]\nReturn evidence.',
  tools: ['engraphis_get_memory'], toolsets: ['web'], skills: ['trading', 'research'] };

const cardSkill = `---
name: trading
description: Procedures Trader follows for every run.
---

# Trader

Verify market evidence.
`;

function profileView(overrides: Record<string, unknown> = {}) {
  return {
    name: 'trading',
    description: 'Category: specialist. Trading.',
    soul: config.prompt_template,
    model: { provider: 'openai-codex', default: 'gpt-5.6-sol' },
    skills: [
      { name: 'research', enabled: true },
      { name: 'hermes-agent', enabled: false },
      { name: 'trading', enabled: true },
    ],
    autoLoadSkills: ['trading', 'research'],
    toolsets: [{ name: 'web', label: 'Web', enabled: true, toolCount: 2 }],
    enabledMcpServers: ['liquidaity'],
    botModeRoster: [],
    applicationTools: ['engraphis_get_memory'],
    cardScript: null,
    webSearchBackend: '',
    taskMode: '',
    pluginTaskMode: '',
    ...overrides,
  };
}

beforeEach(() => {
  hermes.loadProfile.mockResolvedValue(profileView());
  hermes.loadSkill.mockResolvedValue({ name: 'trading', content: cardSkill });
  hermes.createSkill.mockResolvedValue(undefined);
  hermes.saveSkill.mockResolvedValue(undefined);
  hermes.configureProfile.mockImplementation(async (input: Record<string, any>) => profileView({
    soul: input.soul ?? config.prompt_template,
    autoLoadSkills: input.autoLoadSkills ?? ['trading', 'research'],
    cardScript: input.cardScript ?? null,
    toolsets: [{
      name: 'web', label: 'Web', toolCount: 2,
      enabled: (input.enabledToolsets ?? ['web']).includes('web'),
    }],
  }));
  hermes.createProfile.mockResolvedValue(profileView());
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({
    ok: true, fields: [], catalogs: {},
    references: [
      { canonicalId: 'engraphis_get_memory', displayName: 'Get memory', available: true, grantEligible: true, grantProfiles: [] },
      { canonicalId: 'canvas.inspect', displayName: 'Inspect canvas', available: true, grantEligible: true, grantProfiles: [] },
    ],
    selectedKnownReferences: [
      { canonicalId: 'engraphis_get_memory', displayName: 'Get memory', available: true, grantEligible: true, grantProfiles: [] },
    ], unresolvedSelectedIds: [], namespaces: ['canvas', 'engraphis'],
  }) })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('restored Card settings surfaces', () => {
  it('lets a new Card author its missing job introduction without rewriting existing prompt blocks', async () => {
    const save = vi.fn();
    render(<CardEditor cardId="research" cardName="Research" projectId="project" deckId="deck"
      activeTab="Prompt" localConfig={config} onSaveLocalConfig={save} />);
    fireEvent.change(screen.getByLabelText('ORCHESTRATOR SKILL'), {
      target: { value: 'Research checks documentary evidence and returns exact passages.' },
    });
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls.at(-1)?.[0].prompt_template).toBe(config.prompt_template
      + '\n\n[ORCHESTRATOR SKILL]\nResearch checks documentary evidence and returns exact passages.');
    await waitFor(() => expect(hermes.configureProfile).toHaveBeenCalledWith(expect.objectContaining({
      description: 'Category: specialist. Research.\nResearch checks documentary evidence and returns exact passages.',
    })));
  });
  it('forwards saved parent effort and Leaf configuration to the bound profile', async () => {
    const save = vi.fn();
    render(<CardEditor cardId="trader" projectId="project" deckId="deck" activeTab="Prompt" localConfig={{
      ...config, model_key: 'gpt-6.1-terra', reasoning_effort: 'low',
      runtime_options: {
        providerModelId: 'gpt-6.1-terra', subagentType: 'leaf',
        subagentModel: { provider: 'openai', accessMode: 'chatgpt-account', modelKey: 'gpt-6.1-terra', providerModelId: 'gpt-6.1-terra' },
      },
    }} onSaveLocalConfig={save} />);
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'Verify a bounded finding.' } });
    await waitFor(() => expect(hermes.configureProfile).toHaveBeenCalledWith(expect.objectContaining({
      profile: 'trading', model: 'gpt-6.1-terra', provider: 'openai-codex',
      reasoningEffort: 'low', subagentType: 'leaf',
      subagentModel: { provider: 'openai-codex', model: 'gpt-6.1-terra', reasoningEffort: 'low' },
    })));
    expect(save.mock.calls.at(-1)?.[0]).toMatchObject({ reasoning_effort: 'low', runtime_options: { subagentType: 'leaf' } });
  });

  it('keeps Hermes toolset switches separate and mirrors confirmed selection without changing custom grants', async () => {
    const save = vi.fn();
    render(<CardEditor cardId="trader" projectId="project" deckId="deck" activeTab="Tools" localConfig={config} onSaveLocalConfig={save} />);
    const control = await screen.findByLabelText('Enable Hermes web');
    expect(screen.getByRole('region', { name: 'Hermes tools' })).toBeTruthy();
    expect(screen.getByTestId('python-ide').textContent).toBe('trader');
    fireEvent.click(control);
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls.at(-1)?.[0]).toMatchObject({ tools: ['engraphis_get_memory'], toolsets: [] });
  });

  it('adds an available application capability and publishes the saved selection', async () => {
    const save = vi.fn();
    render(<CardEditor cardId="trader" projectId="project" deckId="deck" activeTab="Tools" localConfig={config} onSaveLocalConfig={save} />);
    await screen.findByLabelText('Enable Hermes web');
    fireEvent.click(screen.getByLabelText('Selected only'));
    fireEvent.click(await screen.findByLabelText('Include canvas.inspect'));
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls.at(-1)?.[0]).toMatchObject({
      tools: ['engraphis_get_memory', 'canvas.inspect'],
    });
  });

  it('saves compiled PromptBlocks without a second profile publication path', async () => {
    const save = vi.fn();
    render(<CardEditor cardId="trader" projectId="project" deckId="deck" activeTab="Prompt" localConfig={config} onSaveLocalConfig={save} />);
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'Research with exact citations.' } });
    await waitFor(() => expect(save).toHaveBeenCalled());
    const compiled = String(save.mock.calls.at(-1)?.[0].prompt_template || '');
    expect(compiled).toContain('[ROLE]\nResearch with exact citations.');
    expect(compiled).toContain('[GOAL]\nReturn evidence.');
    expect(compiled.indexOf('[ROLE]')).toBeLessThan(compiled.indexOf('[GOAL]'));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows Hermes runtime usage without calling the removed Card Run metrics route', async () => {
    render(<CardEditor
      cardId="trader"
      projectId="project"
      deckId="deck"
      activeTab="Runtime"
      localConfig={config}
      onSaveLocalConfig={vi.fn()}
      runtimeSnapshot={{
        available: true,
        sessionId: 'session-trader',
        running: true,
        activeModelCount: 2,
        model: 'gpt-6.1-sol',
        totalTokens: 321,
        averageLatencyMs: 1_250,
        lastActiveAt: 200,
      }}
    />);
    expect(screen.getByText('Avg runtime: 0:01')).toBeTruthy();
    expect(screen.getByText('Tokens: 321')).toBeTruthy();
    expect(vi.mocked(fetch).mock.calls.some(([path]) => path === '/api/cards/runs/read')).toBe(false);
  });

  it('edits the logically named custom skill and keeps optional Hermes skills separate', async () => {
    const save = vi.fn();
    render(<CardEditor cardId="trader" cardName="Trader" projectId="project" deckId="deck" activeTab="Skills" localConfig={config} onSaveLocalConfig={save} />);
    const editor = await screen.findByLabelText('Skill content');
    fireEvent.change(editor, { target: { value: cardSkill.replace('Verify market evidence.', 'Verify exact market evidence.') } });
    expect(screen.queryByText(/SKILL\.md/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Save Skill' }));
    await waitFor(() => expect(hermes.saveSkill).toHaveBeenCalledWith(
      'trading',
      'trading',
      expect.stringContaining('Verify exact market evidence.'),
    ));
    await waitFor(() => expect(hermes.configureProfile).toHaveBeenCalledWith(expect.objectContaining({
      profile: 'trading',
      description: 'Category: specialist. Trader.',
      model: 'gpt-5.6-sol',
      provider: 'openai-codex',
      taskMode: '',
      enabledSkills: ['trading', 'research'],
      autoLoadSkills: ['trading', 'research'],
    })));
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({
      skills: ['trading', 'research'],
    })));
    expect(screen.queryByLabelText('Skill graph')).toBeNull();
    expect(screen.queryByLabelText('Learning')).toBeNull();
    expect(screen.queryByLabelText('Custom skill grants')).toBeNull();
  });

  it('creates the profile-scoped custom skill when Hermes does not have one yet', async () => {
    hermes.loadProfile.mockResolvedValue(profileView({
      skills: [{ name: 'research', enabled: true }],
      autoLoadSkills: ['research'],
    }));
    render(<CardEditor cardId="trader" cardName="Trader" projectId="project" deckId="deck" activeTab="Skills" localConfig={config} onSaveLocalConfig={vi.fn()} />);
    const editor = await screen.findByLabelText('Skill content');
    expect((editor as HTMLTextAreaElement).value).toContain('name: trading');
    fireEvent.click(screen.getByRole('button', { name: 'Save Skill' }));
    await waitFor(() => expect(hermes.createSkill).toHaveBeenCalledWith(
      'trading',
      'trading',
      expect.stringContaining('# Trader'),
    ));
  });

  it('allows multiple optional Hermes library skills without replacing the custom skill', async () => {
    const save = vi.fn();
    render(<CardEditor cardId="trader" cardName="Trader" projectId="project" deckId="deck" activeTab="Skills" localConfig={config} onSaveLocalConfig={save} />);
    const optional = await screen.findByLabelText('hermes-agent');
    fireEvent.click(optional);
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({
      skills: ['trading', 'research', 'hermes-agent'],
    })));
    expect(screen.getByText('Edit trading')).toBeTruthy();
  });
});
