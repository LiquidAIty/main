import { useCallback, useEffect, useState } from 'react';

/**
 * Hermes console — the under-chat review/memory surface.
 *
 * Renders the REAL Hermes activity feed from the backend buffer
 * (`GET /api/coder/hermes/activity`): review verdicts, planned ThinkGraph
 * writes, detected patterns, and honest blocked markers. It never invents
 * activity and never fakes graph writes — an empty feed says so plainly.
 *
 * This is NOT the Code Console and NOT the Local Coder terminal: those stay
 * on their own surfaces (rail Terminal icon / chat shell pull-up). Collapsed
 * by default to a single latest-activity line; click to expand the feed.
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
  runId?: string | null;
  featureId?: string | null;
};

export type HermesActivityFetchResult =
  | { ok: true; activity: HermesActivityEntry[] }
  | { ok: false; error: string };

async function fetchHermesActivityFromBackend(): Promise<HermesActivityFetchResult> {
  try {
    const response = await fetch('/api/coder/hermes/activity?limit=100');
    const payload = await response.json();
    if (!response.ok || payload?.ok !== true || !Array.isArray(payload.activity)) {
      return { ok: false, error: String(payload?.error || `http_${response.status}`) };
    }
    return { ok: true, activity: payload.activity as HermesActivityEntry[] };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'hermes_activity_unreachable' };
  }
}

const EMPTY_STATE_TEXT = 'Hermes has not reviewed a run yet.';

function entryTimeLabel(entry: HermesActivityEntry): string {
  const match = /T(\d{2}:\d{2})/.exec(entry.timestamp || '');
  return match ? match[1] : '';
}

export type HermesConsoleProps = {
  /** Injectable for tests; defaults to the real backend activity endpoint. */
  fetchActivity?: () => Promise<HermesActivityFetchResult>;
};

export default function HermesConsole({
  fetchActivity = fetchHermesActivityFromBackend,
}: HermesConsoleProps) {
  const [entries, setEntries] = useState<HermesActivityEntry[]>([]);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const refresh = useCallback(async () => {
    const result = await fetchActivity();
    if (result.ok) {
      setEntries(result.activity);
      setFetchError(null);
    } else {
      setFetchError(result.error);
    }
  }, [fetchActivity]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const latest = entries.length ? entries[entries.length - 1] : null;
  const collapsedLine = fetchError
    ? `Hermes activity unavailable: ${fetchError}`
    : latest
      ? `[${entryTimeLabel(latest)}] ${latest.summary}`
      : EMPTY_STATE_TEXT;

  return (
    <div
      data-testid="hermes-console"
      style={{
        flex: '0 0 auto',
        borderTop: '1px solid rgba(255,255,255,0.06)',
        background: 'linear-gradient(180deg, rgba(24,26,32,0.55) 0%, rgba(18,20,26,0.72) 100%)',
        fontSize: 12,
        color: 'rgba(214,222,235,0.82)',
      }}
    >
      <button
        type="button"
        data-testid="hermes-console-toggle"
        aria-expanded={expanded}
        onClick={() => {
          const next = !expanded;
          setExpanded(next);
          if (next) void refresh();
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          width: '100%',
          padding: '6px 14px',
          background: 'transparent',
          border: 'none',
          color: 'inherit',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <span style={{ opacity: 0.65, fontWeight: 600, letterSpacing: 0.4 }}>Hermes</span>
        {!expanded ? (
          <span
            data-testid="hermes-console-latest"
            style={{
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              opacity: latest || fetchError ? 0.9 : 0.55,
            }}
          >
            {collapsedLine}
          </span>
        ) : null}
        <span style={{ marginLeft: 'auto', opacity: 0.5 }}>{expanded ? '▾' : '▴'}</span>
      </button>

      {expanded ? (
        <div
          data-testid="hermes-console-feed"
          style={{ maxHeight: 220, overflowY: 'auto', padding: '0 14px 10px' }}
        >
          {fetchError ? (
            <div data-testid="hermes-console-error" style={{ opacity: 0.8 }}>
              Hermes activity unavailable: {fetchError}
            </div>
          ) : entries.length === 0 ? (
            <div data-testid="hermes-console-empty" style={{ opacity: 0.6 }}>
              {EMPTY_STATE_TEXT}
            </div>
          ) : (
            entries.map((entry) => (
              <div
                key={entry.id}
                data-testid="hermes-console-row"
                data-entry-type={entry.type}
                style={{
                  padding: '3px 0',
                  borderBottom: '1px solid rgba(255,255,255,0.04)',
                  opacity: entry.type === 'blocked' ? 1 : 0.85,
                  color: entry.type === 'blocked' ? 'rgba(255,176,158,0.95)' : 'inherit',
                }}
              >
                <span style={{ opacity: 0.5, marginRight: 8 }}>[{entryTimeLabel(entry)}]</span>
                {entry.summary}
                {entry.detail ? (
                  <div style={{ opacity: 0.55, paddingLeft: 44 }}>{entry.detail}</div>
                ) : null}
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
