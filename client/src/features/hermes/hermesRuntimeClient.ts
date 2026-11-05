/**
 * Entity: Saved Cards
 * Relationship: Reads profile-scoped active sessions, live subagents, and session statistics from Hermes and refreshes that snapshot only when Hermes emits a relevant event.
 */

import type { SessionActiveItem } from '../../../../HermesLatest/apps/shared/src/gateway-contract.generated';
import { hermesRequest, onHermesEvent } from './hermesHost';

export type HermesRuntimeSnapshot = {
  available: boolean;
  sessionId: string | null;
  running: boolean;
  activeModelCount: number;
  model: string | null;
  totalTokens: number | null;
  averageLatencyMs: number | null;
  lastActiveAt: number | null;
};

const RUNNING_STATUSES = new Set(['starting', 'working', 'streaming', 'resuming']);
const RUNTIME_EVENTS = [
  'session.info',
  'session.usage',
  'message.start',
  'message.complete',
  'subagent.start',
  'subagent.complete',
  'subagent.progress',
  'sessions.changed',
] as const;

function unavailableSnapshot(): HermesRuntimeSnapshot {
  return {
    available: false,
    sessionId: null,
    running: false,
    activeModelCount: 0,
    model: null,
    totalTokens: null,
    averageLatencyMs: null,
    lastActiveAt: null,
  };
}

function newestSession(sessions: SessionActiveItem[]): SessionActiveItem | null {
  return [...sessions].sort((left, right) => right.last_active - left.last_active)[0] || null;
}

export async function readHermesRuntimeSnapshot(profile: string): Promise<HermesRuntimeSnapshot> {
  const active = await hermesRequest(profile, 'session.active_list', { profile });
  const sessions = Array.isArray(active.sessions) ? active.sessions : [];
  const roster = await hermesRequest(profile, 'subagent.roster', { profile })
    .catch(() => ({ sessions: [] }));
  const liveSubagents = (roster.sessions || []).reduce(
    (count, entry) => count + (Number.isSafeInteger(entry.subagents) ? Number(entry.subagents) : 0),
    0,
  );
  const runningRoots = sessions.filter((session) => RUNNING_STATUSES.has(session.status)).length;
  const latest = newestSession(sessions);
  if (!latest) {
    return {
      ...unavailableSnapshot(),
      available: true,
      running: liveSubagents > 0,
      activeModelCount: liveSubagents,
    };
  }

  const usage = await hermesRequest(profile, 'session.usage', {
    profile,
    session_id: latest.id,
  })
    .catch(() => null);
  const averageLatencySeconds = usage?.avg_latency_s;
  return {
    available: true,
    sessionId: latest.id,
    running: runningRoots + liveSubagents > 0,
    activeModelCount: runningRoots + liveSubagents,
    model: String(usage?.model || latest.model || '').trim() || null,
    totalTokens: typeof usage?.total === 'number' ? usage.total : null,
    averageLatencyMs: typeof averageLatencySeconds === 'number'
      ? averageLatencySeconds * 1_000
      : null,
    lastActiveAt: Number.isFinite(latest.last_active) ? latest.last_active : null,
  };
}

export async function subscribeHermesRuntime(
  profile: string,
  onSnapshot: (snapshot: HermesRuntimeSnapshot) => void,
): Promise<() => void> {
  let disposed = false;
  let refreshInFlight = false;
  let refreshAgain = false;
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;

  const refresh = async () => {
    if (disposed) return;
    if (refreshInFlight) {
      refreshAgain = true;
      return;
    }
    refreshInFlight = true;
    try {
      const snapshot = await readHermesRuntimeSnapshot(profile);
      if (!disposed) onSnapshot(snapshot);
    } catch {
      if (!disposed) onSnapshot(unavailableSnapshot());
    } finally {
      refreshInFlight = false;
      if (refreshAgain && !disposed) {
        refreshAgain = false;
        void refresh();
      }
    }
  };
  const scheduleRefresh = () => {
    if (disposed || refreshTimer !== null) return;
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      void refresh();
    }, 25);
  };

  const removeListeners = await Promise.all(
    RUNTIME_EVENTS.map((eventName) => onHermesEvent(profile, eventName, scheduleRefresh)),
  );
  void refresh();

  return () => {
    disposed = true;
    if (refreshTimer !== null) clearTimeout(refreshTimer);
    for (const remove of removeListeners) remove();
  };
}
