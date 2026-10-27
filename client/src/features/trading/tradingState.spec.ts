/**
 * Graph + less = more: less code that does the same work as more code is more useful.
 * Entity names the feature; Relationship explains why this file belongs and what it contributes.
 * Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
 * Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
 * Entity: Trading
 * Relationship: Verifies the Trading Card exposes only typed decisions and reads saved parameters under immutable paper-only, execution-disabled safety defaults.
 */

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_TRADING_CONFIGURATION,
  readTradingConfiguration,
  TRADE_ACTIONS,
} from './tradingState';

describe('Trading Card state contracts', () => {
  it('exposes only the seven typed decision outcomes', () => {
    expect(TRADE_ACTIONS).toEqual([
      'WAIT', 'ENTER', 'HOLD', 'REDUCE', 'EXIT', 'PAUSE', 'FAIL_SAFE',
    ]);
  });

  it('keeps paper-only and execution-off flags immutable while reading saved sliders', () => {
    expect(readTradingConfiguration({
      schemaVersion: 'wrong',
      trading: {
        paperOnly: false,
        executionApproved: true,
        paperBudgetUsd: 125_000,
        minimumRiskReward: 3.5,
      },
    })).toEqual({
      ...DEFAULT_TRADING_CONFIGURATION,
      trading: {
        ...DEFAULT_TRADING_CONFIGURATION.trading,
        paperBudgetUsd: 125_000,
        minimumRiskReward: 3.5,
      },
    });
  });

  it('uses fail-closed zero allocation defaults for missing saved configuration', () => {
    const configuration = readTradingConfiguration(null);
    expect(configuration.trading.paperBudgetUsd).toBe(0);
    expect(configuration.trading.maxOpenPositions).toBe(0);
    expect(configuration.trading.maxPlanLossPercent).toBe(0);
    expect(configuration.trading.maxDailyLossPercent).toBe(0);
  });
});
