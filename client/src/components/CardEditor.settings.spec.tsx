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
  toolsets: [{ name: 'web', label: 'Web Search & Scraping', platform: 'cli', enabled: true, tools: ['web_search', 'web_extract'] }],
  learning: { graph: { nodes: [{ id: 'skill:research', label: 'Research skill' }], edges: [], memory: [], clusters: [], stats: {} } },
} });
const config = { runtime: { kind: 'hermes' as const, mode: 'delegate' as const, profile: 'trading' },
  tools: ['project_graph.list_entities'], toolsets: ['web'], skills: ['research'] };

beforeEach(() => {
  vi.mocked(loadCardProfile).mockResolvedValue(view() as any);
  vi.mocked(applyCardProfileOperation).mockImplementation(async () => {
    const state = view(); state.profile.toolsets[0].enabled = false; return state as any;
  });
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({
    ok: true, fields: [], catalogs: {}, references: [], selectedKnownReferences: [], unresolvedSelectedIds: [],
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
    expect(save.mock.calls.at(-1)?.[0]).toMatchObject({ tools: ['project_graph.list_entities'], toolsets: [] });
  });

  it('renders provider graph data, not an editable skill-ID textbox', async () => {
    render(<CardEditor cardId="trader" projectId="project" deckId="deck" activeTab="Skills" localConfig={config} onSaveLocalConfig={vi.fn()} />);
    expect((await screen.findByTestId('hermes-graph')).textContent).toBe('Research skill');
    expect(screen.queryByLabelText('Card skill grants')).toBeNull();
    expect(loadCardProfile).toHaveBeenCalledWith(expect.objectContaining({ cardId: 'trader', projectId: 'project', deckId: 'deck' }));
  });
});
