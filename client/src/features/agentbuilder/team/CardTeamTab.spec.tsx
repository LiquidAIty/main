// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import CardSubagentsTab, { type SavedTeamConfig } from './CardTeamTab';

afterEach(cleanup);

const model = (id: string) => ({
  provider: 'openai', accessMode: 'chatgpt-account' as const,
  modelKey: id, providerModelId: id,
});
const team: SavedTeamConfig = {
  mode: 'auto', maxWorkers: 3, retryLimit: 1,
  workerModel: model('gpt-5.6-luna'), leadModel: model('gpt-5.6-terra'),
};
const options = [
  { provider: 'openai', key: 'gpt-5.6-luna', label: 'Luna', providerModelId: 'gpt-5.6-luna' },
  { provider: 'openai', key: 'gpt-5.6-terra', label: 'Terra', providerModelId: 'gpt-5.6-terra' },
];

describe('Card Subagents tab', () => {
  it('edits only proven Card-owned Team fields', () => {
    const onChange = vi.fn();
    render(<CardSubagentsTab runtime={{ kind: 'hermes', mode: 'delegate', profile: 'research' }}
      team={team} modelOptions={options} onChange={onChange} />);
    expect(screen.getByText(/does not start Team with every Run/)).toBeTruthy();
    expect(screen.getByText(/only configured subagent strategy today/)).toBeTruthy();
    expect(screen.getByLabelText('Team lead model')).toBeTruthy();
    expect(screen.queryByText(/planner|reviewer|saved profile|concurrency|steer|stop/i)).toBeNull();
    fireEvent.change(screen.getByLabelText('Team availability'), { target: { value: 'off' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ mode: 'off' }));
  });

  it('renders compact native status and applied policy telemetry without task tiles', () => {
    render(<CardSubagentsTab runtime={{ kind: 'hermes', mode: 'main', profile: 'main' }}
      team={team} modelOptions={options} onChange={() => undefined}
      currentRun={{ runId: 'run-1', state: 'running', nativeRootId: 't_root', nativeRunId: 12,
        activeWorkers: 2, teamReceipt: { source: 'host_session', maxWorkers: 3, retryLimit: 1,
          workerProvider: 'openai-codex', workerModel: 'gpt-5.6-luna',
          leadProvider: 'openai-codex', leadModel: 'gpt-5.6-terra', maxDepth: 1 } }} />);
    expect(screen.getByTestId('card-subagents-status').textContent).toContain('2 running workers');
    expect(screen.getByTestId('card-subagents-telemetry').textContent).toContain('lead openai-codex/gpt-5.6-terra');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('does not claim native Team for non-Hermes runtimes', () => {
    render(<CardSubagentsTab runtime={{ kind: 'autogen', mode: 'assistant' }}
      team={team} modelOptions={options} onChange={() => undefined} />);
    expect(screen.getByText(/Native Hermes subagents are not claimed/)).toBeTruthy();
  });

  it('keeps the last completed Card Run context and failure visible when workers stop', () => {
    const { rerender } = render(<CardSubagentsTab
      runtime={{ kind: 'hermes', mode: 'delegate', profile: 'research' }}
      team={team} modelOptions={options} onChange={() => undefined}
      currentRun={{ runId: 'run-last', state: 'completed', nativeRootId: 't_last', activeWorkers: 0 }}
    />);
    expect(screen.getByTestId('card-subagents-status').textContent).toContain('completed');
    expect(screen.getByText(/Card Run run-last · root t_last/)).toBeTruthy();

    rerender(<CardSubagentsTab
      runtime={{ kind: 'hermes', mode: 'delegate', profile: 'research' }}
      team={team} modelOptions={options} onChange={() => undefined}
      currentRun={{ runId: 'run-last', state: 'failed', nativeRootId: 't_last', activeWorkers: 0,
        error: 'native worker failed' }}
    />);
    expect(screen.getByRole('alert').textContent).toContain('native worker failed');
  });
});
