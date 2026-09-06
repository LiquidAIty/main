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
const fields = [
  { name: 'teamMaxWorkers', label: 'Maximum workers', path: 'team.maxWorkers', control: 'select' as const,
    options: [2, 3, 4].map((value) => ({ value: String(value), label: String(value) })) },
  { name: 'teamRetryLimit', label: 'Retry limit', path: 'team.retryLimit', control: 'integer' as const,
    minimum: 0, maximum: 4, step: 1 },
];

describe('Card delegation Team settings', () => {
  it('shows Team fields only when selected and preserves their values while off', () => {
    const onChange = vi.fn();
    const props = { runtime: { kind: 'hermes' as const, mode: 'delegate' as const, profile: 'research' },
      team, modelOptions: options, fields, onChange };
    const { rerender } = render(<CardSubagentsTab {...props} team={{ ...team, mode: 'off' }} />);
    expect(screen.queryByLabelText('Maximum workers')).toBeNull();
    expect(screen.queryByLabelText('Worker model')).toBeNull();
    expect(screen.queryByRole('checkbox', { name: 'Team' })).toBeNull();
    rerender(<CardSubagentsTab {...props} />);
    expect((screen.getByLabelText('Maximum workers') as HTMLSelectElement).value).toBe('3');
    expect((screen.getByLabelText('Retry limit') as HTMLSelectElement).value).toBe('1');
    expect(screen.getByLabelText('Team lead model')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Retry limit'), { target: { value: '2' } });
    expect(onChange).toHaveBeenLastCalledWith({ ...team, retryLimit: 2 });
    expect(screen.queryByText('Bounds')).toBeNull();
    expect(screen.queryByText('Status')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('does not place Run receipts in settings or present a non-Hermes overlay', () => {
    const { rerender, container } = render(<CardSubagentsTab
      runtime={{ kind: 'hermes', mode: 'main', profile: 'main' }}
      team={team} modelOptions={options} fields={fields} onChange={() => undefined} />);
    expect(screen.queryByTestId('card-subagents-status')).toBeNull();
    expect(screen.queryByText(/run-1|t_root/)).toBeNull();
    rerender(<CardSubagentsTab runtime={{ kind: 'autogen', mode: 'magentic_one' }}
      team={team} modelOptions={options} fields={fields} onChange={() => undefined} />);
    expect(container.textContent).toBe('');
  });
});
