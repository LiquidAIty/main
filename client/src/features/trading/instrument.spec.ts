import { describe, expect, it } from 'vitest';

import { resolveInstrument } from './instrument';

describe('selected-instrument boundary (explicit, structured, no default)', () => {
  it('resolves RDW to the structured NYSE:RDW mapping', () => {
    expect(resolveInstrument('RDW')).toEqual({
      symbol: 'RDW',
      tradingViewSymbol: 'NYSE:RDW',
      label: 'Redwire · RDW',
    });
  });

  it('is case-insensitive on the explicit symbol', () => {
    expect(resolveInstrument('rdw')?.tradingViewSymbol).toBe('NYSE:RDW');
  });

  it('returns null for a missing symbol (no silent default)', () => {
    expect(resolveInstrument(null)).toBeNull();
    expect(resolveInstrument(undefined)).toBeNull();
    expect(resolveInstrument('')).toBeNull();
    expect(resolveInstrument('   ')).toBeNull();
  });

  it('returns null for an unconfigured symbol — no exchange string-guessing', () => {
    // A symbol absent from the structured map yields null, never "NYSE:"+symbol.
    expect(resolveInstrument('AAPL')).toBeNull();
    expect(resolveInstrument('TSLA')).toBeNull();
  });
});
