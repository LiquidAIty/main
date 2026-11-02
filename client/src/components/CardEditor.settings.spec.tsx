// @vitest-environment jsdom
// Entity: Card Profiles
// Relationship: Checks Card UI bindings to the settings API; simulated responses do not prove live Hermes settings.
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../features/agentbuilder/HermesSkillGraph', () => ({ default: ({ graph }: any) => <div data-testid="hermes-graph">{graph.nodes[0]?.label}</div> }));
vi.mock('../features/agentbuilder/CardScriptEditor', () => ({ CardScriptEditor: ({ cardId }: any) => <div data-testid="python-ide">{cardId}</div> }));
vi.mock('../features/agentbuilder/cardProfileClient', () => ({
  loadCardProfile: vi.fn(), applyCardProfileOperation: vi.fn(), loadCardLearningDetail: vi.fn(),
}));
import { CardEditor } from './CardEditor';
import { loadCardProfile, applyCardProfileOperation } from '../features/agentbuilder/cardProfileClient';

const view = () => ({ binding: { profile: 'trading', mode: 'delegate' }, profile: {
  name: 'trading', skills: [{ name: 'research', enabled: true }],
  soul: { content: '# CARD_PROMPT_V1', exists: true, matchesSavedPrompt: true },
  toolsets: [{ name: 'web', label: 'Web Search & Scraping', platform: 'cli', enabled: true, tools: ['web_search', 'web_extract'] }],
  applicationTools: { server: 'liquidaity', configured: true, enabled: true,
    selected: ['engraphis_get_memory'], include: ['engraphis_get_memory'], matchesSavedSelection: true },
  learning: { graph: { nodes: [{ id: 'skill:research', label: 'Research skill' }], edges: [], memory: [], clusters: [], stats: {} } },
} });
const config = { runtime: { kind: 'hermes' as const, mode: 'delegate' as const, profile: 'trading' },
  prompt_template: '# CARD_PROMPT_V1\n[ROLE]\nResearch carefully.\n\n[GOAL]\nReturn evidence.',
  tools: ['engraphis_get_memory'], toolsets: ['web'], skills: ['research'] };

beforeEach(() => {
  vi.mocked(loadCardProfile).mockResolvedValue(view() as any);
  vi.mocked(applyCardProfileOperation).mockImplementation(async () => {
    const state = view(); state.profile.toolsets[0].enabled = false; return state as any;
  });
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
    await waitFor(() => expect(applyCardProfileOperation).toHaveBeenCalledWith({ projectId: 'project', deckId: 'deck', cardId: 'trader',
      change: { method: 'toolset.toggle', params: { name: 'web', enabled: false } } }));
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls.at(-1)?.[0]).toMatchObject({ tools: ['engraphis_get_memory'], toolsets: [] });
    await waitFor(() => expect(applyCardProfileOperation).toHaveBeenCalledWith({
      projectId: 'project', deckId: 'deck', cardId: 'trader',
      change: { method: 'configuration.publish', params: {} },
    }));
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
    await waitFor(() => expect(applyCardProfileOperation).toHaveBeenCalledWith(expect.objectContaining({
      change: { method: 'configuration.publish', params: {} },
    })));
  });

  it('publishes compiled PromptBlocks and keeps a publication failure visible', async () => {
    const save = vi.fn();
    vi.mocked(applyCardProfileOperation).mockImplementation(async (input: any) => {
      if (input.change.method === 'configuration.publish') throw new Error('SOUL publication failed');
      return view() as any;
    });
    render(<CardEditor cardId="trader" projectId="project" deckId="deck" activeTab="Prompt" localConfig={config} onSaveLocalConfig={save} />);
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'Research with exact citations.' } });
    await waitFor(() => expect(save).toHaveBeenCalled());
    const compiled = String(save.mock.calls.at(-1)?.[0].prompt_template || '');
    expect(compiled).toContain('[ROLE]\nResearch with exact citations.');
    expect(compiled).toContain('[GOAL]\nReturn evidence.');
    expect(compiled.indexOf('[ROLE]')).toBeLessThan(compiled.indexOf('[GOAL]'));
    expect((await screen.findByRole('alert')).textContent).toContain('SOUL publication failed');
  });

  it('renders provider graph data, not an editable skill-ID textbox', async () => {
    render(<CardEditor cardId="trader" projectId="project" deckId="deck" activeTab="Skills" localConfig={config} onSaveLocalConfig={vi.fn()} />);
    expect((await screen.findByTestId('hermes-graph')).textContent).toBe('Research skill');
    expect(screen.queryByLabelText('Card skill grants')).toBeNull();
    expect(loadCardProfile).toHaveBeenCalledWith(expect.objectContaining({ cardId: 'trader', projectId: 'project', deckId: 'deck' }));
  });
});
