// @vitest-environment jsdom
import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import TradingUiInspectorPanel from './TradingUiInspectorPanel';
import { DEFAULT_TRADING_CONFIGURATION, type TradingConfiguration } from './tradingState';

afterEach(cleanup);

it('persists setting edits without Save and preserves invalid strategy text until corrected', () => {
  const changed = vi.fn();
  function Settings() {
    const [configuration, setConfiguration] = useState<TradingConfiguration>({
      ...DEFAULT_TRADING_CONFIGURATION,
      trading: { ...DEFAULT_TRADING_CONFIGURATION.trading, strategyParameters: { period: 20 } },
    });
    return <TradingUiInspectorPanel configuration={configuration} onSave={next => { changed(next); setConfiguration(next); }} />;
  }
  render(<Settings />);
  expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'charts' })).toBeNull();
  fireEvent.change(screen.getByRole('combobox', { name: 'Default timeframe' }), { target: { value: '15Min' } });
  fireEvent.change(screen.getByRole('slider', { name: 'Budget' }), { target: { value: '10000' } });
  expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({ trading: expect.objectContaining({
    defaultTimeframe: '15Min', strategyParameters: { period: 20 }, paperBudgetUsd: 10000,
  }) }));
  fireEvent.click(screen.getByRole('button', { name: 'lifecycle' }));
  const strategy = screen.getByRole('textbox', { name: 'Strategy parameters' });
  expect((strategy as HTMLTextAreaElement).value).toContain('20');
  changed.mockClear();
  fireEvent.change(strategy, { target: { value: '{' } });
  fireEvent.blur(strategy);
  expect(changed).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole('slider', { name: 'Heartbeat' }), { target: { value: '120' } });
  expect((strategy as HTMLTextAreaElement).value).toBe('{');
  fireEvent.change(strategy, { target: { value: '{"period":30}' } });
  fireEvent.blur(strategy);
  expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({ trading: expect.objectContaining({
    paperBudgetUsd: 10000, heartbeatSeconds: 120, strategyParameters: { period: 30 },
  }) }));
});
