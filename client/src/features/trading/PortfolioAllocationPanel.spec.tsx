// @vitest-environment jsdom
// Entity: Trading
// Relationship: Tests deliberate allocation edits, honest unknown holdings and preservation of saved risk settings without broker execution.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PortfolioAllocationPanel from './PortfolioAllocationPanel';
import { readTradingConfiguration, type PortfolioAllocation } from './tradingState';

const categories = [
  ['options', 'Options', 25], ['day_trading', 'Day Trading', 0], ['swing_trading', 'Swing Trading', 10],
  ['microcaps', 'Microcaps', 5], ['core', 'Core Investments', 35], ['defensive', 'Bonds / Defensive Investments', 10],
  ['crypto', 'Crypto', 0], ['prediction_markets', 'Prediction Markets', 0], ['cash', 'Cash / Liquid Reserves', 15],
] as const;
const policy = {
  schemaVersion: 'portfolio.policy.v1' as const, preset: 'High Options' as const,
  categories: categories.map(([id, , targetPercent]) => ({ id, targetPercent, minimumPercent: 0, maximumPercent: 100, maximumRiskPercent: null })),
  positionCategories: {}, permittedInstrumentTypes: ['equity', 'etf', 'option'], minimumLiquidReservePercent: 0,
  maximumPositionLossPercent: null, maximumPositionWeightPercent: null,
};
export const allocation: PortfolioAllocation = {
  policy, policyHash: 'initial', policySaved: false,
  categories: categories.map(([id, name, targetPercent]) => ({ id, name, targetPercent, minimumPercent: 0, maximumPercent: 100, maximumRiskPercent: null,
    currentValueUsd: null, currentPercent: null, targetValueUsd: null, maximumHeadroomUsd: null, targetHeadroomUsd: null })),
  portfolioValueUsd: null, reportedCashUsd: null, settledCashUsd: null, brokerBuyingPowerUsd: null, reservedCapitalUsd: 0,
  expectedExitProceedsUsd: null, minimumLiquidReserveUsd: null, availableUnreservedCashUsd: null,
  unassignedValueUsd: null, unassignedPositions: [], positionsWithMissingValue: [], shortPositions: [],
  allocationComplete: false, executionAuthorized: false, limitations: [],
};

afterEach(cleanup);
describe('Portfolio allocation controls', () => {
  it('does not save on open and applies only a complete valid edit without changing input data', () => {
    const save = vi.fn();
    const before = JSON.stringify(allocation);
    render(<PortfolioAllocationPanel allocation={allocation} positions={[]} onSave={save} />);
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByRole('img', { name: 'Observed unavailable' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Edit allocation' }));
    fireEvent.change(screen.getByLabelText('Options target percent'), { target: { value: '30' } });
    expect((screen.getByRole('button', { name: 'Apply allocation' }) as HTMLButtonElement).disabled).toBe(true);
    expect(save).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Core Investments target percent'), { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply allocation' }));
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0].preset).toBe('Custom');
    expect(save.mock.calls[0][0].categories[0].targetPercent).toBe(30);
    expect(screen.queryByText(/Waiting for saved policy readback/)).toBeNull();
    expect((screen.getByRole('button', { name: 'Edit allocation' }) as HTMLButtonElement).disabled).toBe(false);
    expect(JSON.stringify(allocation)).toBe(before);
  });

  it('keeps cancellation local and validates target/min/max limits', () => {
    const save = vi.fn();
    render(<PortfolioAllocationPanel allocation={allocation} positions={[]} onSave={save} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit allocation' }));
    fireEvent.change(screen.getByLabelText('Options maximumPercent'), { target: { value: '20' } });
    expect((screen.getByRole('button', { name: 'Apply allocation' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(save).not.toHaveBeenCalled();
    expect(screen.getAllByText('25.0%')).toHaveLength(1);
  });

  it('assigns the exact option contract rather than guessing from the underlying ticker', () => {
    const save = vi.fn();
    const symbol = 'RDW270115C00015000';
    render(<PortfolioAllocationPanel allocation={allocation} positions={[{ symbol, instrumentId: symbol, side: 'long',
      quantity: 1, averageEntryPrice: 1, currentPrice: null, marketValueUsd: null, unrealizedPnlUsd: null, strategy: null }]} onSave={save} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit allocation' }));
    fireEvent.change(screen.getByLabelText(`${symbol} Investment Category`), { target: { value: 'options' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply allocation' }));
    expect(save.mock.calls[0][0].positionCategories).toEqual({ [symbol]: 'options' });
    expect(save.mock.calls[0][0]).not.toHaveProperty('executionApproved');
  });

  it('retains the complete policy when the existing settings reader handles an unrelated risk edit', () => {
    const config = readTradingConfiguration({ trading: { paperBudgetUsd: 12345, allocationPolicy: policy } });
    expect(config.trading.allocationPolicy).toEqual(policy);
    expect(config.trading.paperBudgetUsd).toBe(12345);
    expect(config.trading.executionApproved).toBe(false);
  });
});
