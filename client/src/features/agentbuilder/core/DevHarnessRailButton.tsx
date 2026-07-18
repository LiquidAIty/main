import { useEffect, useState } from 'react';
import { waitForBackendReady } from '../../../components/builder/backendReadiness';

/**
 * Dev-only rail icon for the agent test harness (/dev/agent-runs).
 *
 * Shows whether an external coding agent (Codex/Fable/Terra/… via the
 * dev_agent_harness MCP server or the /api/dev/agent-harness routes) is
 * actually plugged into the system: the icon lights up when a REAL dev_probe
 * telemetry event happened recently, and stays dim otherwise. Presence is
 * read from the same telemetry ring buffer the dashboard renders — never
 * invented. Clicking opens the full dashboard in a new tab.
 *
 * Deliberately NOT an agent card: a canvas card means "a real model-run
 * agent"; this is an inspection surface over real telemetry, so it lives on
 * the rail with the other surfaces. Renders nothing in production builds.
 */

const POLL_MS = 30_000;
const PRESENCE_WINDOW_MS = 10 * 60_000;

type ProbeEvent = { stage: string; timestamp: string };

/** Milliseconds since the most recent dev_probe event, or null when none (pure). */
export function latestProbeAgeMs(events: ProbeEvent[], nowMs: number): number | null {
  const timestamps = events
    .filter((event) => event.stage === 'dev_probe')
    .map((event) => Date.parse(event.timestamp))
    .filter((ms) => Number.isFinite(ms));
  if (timestamps.length === 0) return null;
  return nowMs - Math.max(...timestamps);
}

async function fetchProbeEventsFromBackend(signal?: AbortSignal): Promise<ProbeEvent[] | null> {
  try {
    const ready = await waitForBackendReady({ signal });
    if (!ready || signal?.aborted) return null;
    const response = await fetch('/api/dev/agent-harness/events?limit=100', { signal });
    const payload = await response.json();
    if (!response.ok || payload?.ok !== true || !Array.isArray(payload.events)) return null;
    return payload.events as ProbeEvent[];
  } catch {
    return null; // backend down or prod: the icon just stays dim
  }
}

export type DevHarnessRailButtonProps = {
  dimColor: string;
  activeColor: string;
  /** Injectable for tests; defaults to the real telemetry endpoint. */
  fetchProbeEvents?: (signal?: AbortSignal) => Promise<ProbeEvent[] | null>;
  openDashboard?: () => void;
};

export default function DevHarnessRailButton({
  dimColor,
  activeColor,
  fetchProbeEvents = fetchProbeEventsFromBackend,
  openDashboard = () => window.open('/dev/agent-runs', '_blank'),
}: DevHarnessRailButtonProps) {
  const [probeAgeMs, setProbeAgeMs] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const poll = async () => {
      const events = await fetchProbeEvents(controller.signal);
      if (cancelled || events === null) return;
      setProbeAgeMs(latestProbeAgeMs(events, Date.now()));
    };
    void poll();
    const timer = setInterval(() => void poll(), POLL_MS);
    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(timer);
    };
  }, [fetchProbeEvents]);

  const pluggedIn = probeAgeMs !== null && probeAgeMs < PRESENCE_WINDOW_MS;
  const title = pluggedIn
    ? `Agent Harness — coding agent active ${Math.max(1, Math.round((probeAgeMs as number) / 60_000))}m ago`
    : 'Agent Harness — no recent coding-agent activity';

  return (
    <button
      type="button"
      title={title}
      aria-label="Agent Harness"
      data-testid="rail-dev-harness-button"
      data-plugged-in={pluggedIn}
      onClick={openDashboard}
      className="p-2 rounded"
      style={{ color: pluggedIn ? activeColor : dimColor, opacity: pluggedIn ? 1 : 0.55 }}
    >
      {/* plug/socket glyph */}
      <svg
        width={22}
        height={22}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M9 7v4M15 7v4M7 11h10v3a5 5 0 0 1-10 0v-3zM12 19v3" />
      </svg>
    </button>
  );
}
