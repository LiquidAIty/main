/**
 * Hermes activity buffer — transient UI state for the Hermes console.
 *
 * A bounded in-memory list of real HermesActivityEntry records (produced by
 * the Python review or an honest blocked marker). Durable memory belongs in
 * ThinkGraph through the card's scoped authority — never here. No DB, no
 * persistence, no invented entries: everything appended comes from a real
 * review result or a real failure.
 */

export type HermesActivityEntry = {
  id: string;
  timestamp: string;
  type:
    | 'review_started'
    | 'review_complete'
    | 'thinkgraph_write_planned'
    | 'thinkgraph_write_complete'
    | 'pattern_detected'
    | 'context_query'
    | 'blocked'
    | 'idle';
  summary: string;
  detail?: string | null;
  thinkgraphNodeId?: string | null;
  runId?: string | null;
  featureId?: string | null;
};

// ponytail: fixed-size ring in module memory; move to a store if history must
// survive a backend restart.
const MAX_ENTRIES = 200;
const entries: HermesActivityEntry[] = [];

function isActivityType(value: unknown): value is HermesActivityEntry['type'] {
  return [
    'review_started',
    'review_complete',
    'thinkgraph_write_planned',
    'thinkgraph_write_complete',
    'pattern_detected',
    'context_query',
    'blocked',
    'idle',
  ].includes(String(value));
}

/** Normalize one entry from the Python review's activityEvents. Unknown or
 * malformed rows are dropped (never invented/repaired into fake activity). */
export function normalizeHermesActivityEntry(value: unknown): HermesActivityEntry | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const id = String(raw.id || '').trim();
  const summary = String(raw.summary || '').trim();
  if (!id || !summary || !isActivityType(raw.type)) return null;
  return {
    id,
    timestamp: String(raw.timestamp || '').trim(),
    type: raw.type,
    summary,
    detail: raw.detail ? String(raw.detail) : null,
    thinkgraphNodeId: raw.thinkgraphNodeId ? String(raw.thinkgraphNodeId) : null,
    runId: raw.runId ? String(raw.runId) : null,
    featureId: raw.featureId ? String(raw.featureId) : null,
  };
}

export function appendHermesActivity(newEntries: HermesActivityEntry[]): void {
  for (const entry of newEntries) {
    entries.push(entry);
  }
  if (entries.length > MAX_ENTRIES) {
    entries.splice(0, entries.length - MAX_ENTRIES);
  }
}

/** Append an honest blocked marker (e.g. rails unreachable, review threw). */
export function appendHermesBlocked(reason: string, runId?: string | null): void {
  appendHermesActivity([
    {
      id: `hermes:blocked:${Date.now()}:${entries.length}`,
      timestamp: new Date().toISOString(),
      type: 'blocked',
      summary: `Hermes review blocked: ${reason}`,
      runId: runId || null,
    },
  ]);
}

/** Newest-last slice for the console. */
export function listHermesActivity(limit = 50): HermesActivityEntry[] {
  const bounded = Math.max(1, Math.min(MAX_ENTRIES, Math.floor(limit) || 50));
  return entries.slice(-bounded);
}

/** Test-only reset. */
export function clearHermesActivityForTest(): void {
  entries.length = 0;
}
