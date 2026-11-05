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
  tools: ['engraphis_get_memory'], toolsets: ['web'], skills: ['research'] };

const cardSkill = `---
name: card-skill
description: Procedures this saved Hermes Card follows for every run.
---

# Trader skill

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
      { name: 'card-skill', enabled: true },
    ],
    autoLoadSkills: ['research', 'card-skill'],
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
  hermes.loadSkill.mockResolvedValue({ name: 'card-skill', content: cardSkill });
  hermes.createSkill.mockResolvedValue(undefined);
  hermes.saveSkill.mockResolvedValue(undefined);
  hermes.configureProfile.mockImplementation(async (input: Record<string, any>) => profileView({
    soul: input.soul ?? config.prompt_template,
    autoLoadSkills: input.autoLoadSkills ?? ['research', 'card-skill'],
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

  it('edits the Card-owned SKILL.md and binds it to Hermes auto-load', async () => {
    const save = vi.fn();
    render(<CardEditor cardId="trader" cardName="Trader" projectId="project" deckId="deck" activeTab="Skills" localConfig={config} onSaveLocalConfig={save} />);
    const editor = await screen.findByLabelText('Skill content');
    fireEvent.change(editor, { target: { value: cardSkill.replace('Verify market evidence.', 'Verify exact market evidence.') } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Card Skill' }));
    await waitFor(() => expect(hermes.saveSkill).toHaveBeenCalledWith(
      'trading',
      'card-skill',
      expect.stringContaining('Verify exact market evidence.'),
    ));
    await waitFor(() => expect(hermes.configureProfile).toHaveBeenCalledWith(expect.objectContaining({
      profile: 'trading',
      description: 'Category: specialist. Trader.',
      model: 'gpt-5.6-sol',
      provider: 'openai-codex',
      taskMode: '',
      enabledSkills: ['card-skill'],
      autoLoadSkills: ['card-skill'],
    })));
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({
      skills: ['card-skill'],
    })));
    expect(screen.queryByLabelText('Skill graph')).toBeNull();
    expect(screen.queryByLabelText('Learning')).toBeNull();
    expect(screen.queryByLabelText('Card skill grants')).toBeNull();
  });

  it('creates the profile-scoped Card skill when Hermes does not have one yet', async () => {
    hermes.loadProfile.mockResolvedValue(profileView({
      skills: [{ name: 'research', enabled: true }],
      autoLoadSkills: ['research'],
    }));
    render(<CardEditor cardId="trader" cardName="Trader" projectId="project" deckId="deck" activeTab="Skills" localConfig={config} onSaveLocalConfig={vi.fn()} />);
    const editor = await screen.findByLabelText('Skill content');
    expect((editor as HTMLTextAreaElement).value).toContain('name: card-skill');
    fireEvent.click(screen.getByRole('button', { name: 'Save Card Skill' }));
    await waitFor(() => expect(hermes.createSkill).toHaveBeenCalledWith(
      'trading',
      'card-skill',
      expect.stringContaining('# Trader skill'),
    ));
  });
});
