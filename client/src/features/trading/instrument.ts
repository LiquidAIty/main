/**
 * Graph + less = more: less code that does the same work as more code is more useful.
 * Entity names the feature; Relationship explains why this file belongs and what it contributes.
 * Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
 * Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
 * Entity: Trading
 * Relationship: Trading resolves only explicitly configured symbols into structured market and chart identities, returning no default or inferred exchange for unknown instruments.
 */

type InstrumentRef = {
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
