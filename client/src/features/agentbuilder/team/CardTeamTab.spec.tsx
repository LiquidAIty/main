// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, act } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentManager } from '../../../components/AgentManager';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('Team Card recovery', () => {
  it('selects Team without creating limits or overwriting existing saved settings', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: unknown) => ({
      ok: String(input) === '/api/cards/options',
      json: async () => ({ ok: true, catalogs: {}, fields: [
        { name: 'delegationRole', label: 'Delegate task', path: 'delegationRole', control: 'select',
          options: ['off', 'profile', 'team'].map(value => ({ value, label: value })) },
      ] }),
    })));
    const legacy = { mode: 'auto', maxWorkers: 3, retryLimit: 1 };
    const onSave = vi.fn();
    let leave: (() => Promise<boolean>) | null = null;
    render(<AgentManager agentType="agent_builder" activeTab="Runtime" cardId="one" projectId="p" deckId="d"
      localConfig={{ runtime: { kind: 'hermes', mode: 'delegate', profile: 'research' },
        provider: 'openai', access_mode: 'chatgpt-account', model_key: 'parent',
        prompt_template: 'Keep these instructions', tools: ['read_file'], skills: [], toolsets: [],
        mcp_connection_ids: [], runtime_options: { team: legacy } }}
      onSaveLocalConfig={onSave} registerCardLeave={save => { leave = save; }} />);
    const selector = await screen.findByLabelText('Delegate task');
    await waitFor(() => expect((selector as HTMLSelectElement).disabled).toBe(false));
    fireEvent.change(selector, { target: { value: 'team' } });
    for (const label of ['Maximum workers', 'Retry limit', 'Worker model', 'Team lead model']) {
      expect(screen.queryByLabelText(label)).toBeNull();
    }
    await act(async () => { await leave?.(); });
    expect(onSave).toHaveBeenCalledOnce();
    expect(onSave.mock.calls[0][0].runtime_options).toEqual(expect.objectContaining({ delegationRole: 'team', team: legacy }));
    expect(onSave.mock.calls[0][0].prompt_template).toBe('Keep these instructions');
    expect(onSave.mock.calls[0][0].tools).toEqual(['read_file']);
  });
});
