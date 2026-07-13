import { useEffect, useState } from 'react';

import type { HermesReportView } from '../../../components/knowledge/hermesReportView';

export type HermesReportState = {
  report: HermesReportView | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
};

/** Reads the one current durable Hermes report for the active conversation.
 * The artifact remains the authority; this hook is only its Inspector transport. */
export default function useAgentBuilderHermesReport({
  projectId,
  conversationId,
  workspaceView,
}: {
  projectId: string;
  conversationId: string;
  workspaceView: string;
}): HermesReportState {
  const [state, setState] = useState<HermesReportState>({ report: null, status: 'idle', error: null });
  const [refreshNonce, setRefreshNonce] = useState(0);

  useEffect(() => {
    const refresh = () => setRefreshNonce((value) => value + 1);
    window.addEventListener('knowledge:refresh', refresh);
    return () => window.removeEventListener('knowledge:refresh', refresh);
  }, []);

  useEffect(() => {
    if (workspaceView !== 'knowledge' || !projectId) {
      setState({ report: null, status: 'idle', error: null });
      return;
    }
    const controller = new AbortController();
    setState((previous) => ({ ...previous, status: previous.report ? 'ready' : 'loading', error: null }));
    void (async () => {
      try {
        const params = new URLSearchParams({ projectId, conversationId });
        const response = await fetch(`/api/coder/hermes/report?${params.toString()}`, { signal: controller.signal });
        const payload = await response.json().catch(() => null) as { report?: HermesReportView | null; error?: string } | null;
        if (controller.signal.aborted) return;
        if (!response.ok || !payload) {
          setState({ report: null, status: 'error', error: payload?.error || `HTTP ${response.status}` });
          return;
        }
        setState({ report: payload.report ?? null, status: 'ready', error: null });
      } catch (error) {
        if (controller.signal.aborted) return;
        setState({ report: null, status: 'error', error: error instanceof Error ? error.message : 'hermes_report_read_failed' });
      }
    })();
    return () => controller.abort();
  }, [conversationId, projectId, refreshNonce, workspaceView]);

  return state;
}
