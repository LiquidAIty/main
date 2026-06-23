/**
 * Selected-instrument boundary for the read-only market vertical.
 *
 * The market view is driven by an EXPLICIT symbol (e.g. `/tradingui?symbol=RDW`).
 * There is no silent default, no ticker inference, and no KnowGraph auto-selection.
 * The TradingView symbol is resolved through a STRUCTURED, testable mapping — never by
 * string-concatenating an exchange prefix.
 */

export type InstrumentRef = {
  /** Canonical Alpaca symbol, e.g. "RDW". */
  symbol: string;
  /** TradingView chart symbol (exchange-qualified), e.g. "NYSE:RDW". */
  tradingViewSymbol: string;
  /** Human label for the visible instrument header. */
  label: string;
};

// Explicit configured mapping. Add instruments here deliberately — do not derive the
// exchange prefix from string heuristics.
const INSTRUMENT_MAP: Readonly<Record<string, InstrumentRef>> = {
  RDW: { symbol: 'RDW', tradingViewSymbol: 'NYSE:RDW', label: 'Redwire · RDW' },
};

/**
 * Resolve an explicit symbol to a structured {@link InstrumentRef}, or `null` when the
 * symbol is missing or not configured. Callers must treat `null` as "no instrument
 * selected" — never substitute a default.
 */
export function resolveInstrument(
  symbol: string | null | undefined,
): InstrumentRef | null {
  const key = String(symbol ?? '').trim().toUpperCase();
  if (!key) return null;
  return INSTRUMENT_MAP[key] ?? null;
}
