import { useEffect, useState } from 'react';

import type { CodeGraphViewContract } from '../../../components/codegraph/types';

export type CoderAuditView = {
  projectId: string;
  conversationId: string;
  childRunId: string;
  correlationId: string;
  conclusion: string;
  repositoryIdentity: string;
  revision: string;
  freshness: string;
  codeGraphQuery: string;
  codeGraphNodeRefs: string[];
  viewContract: CodeGraphViewContract;
  transcriptArtifact: string | null;
  updatedAt: string;
};

export type CoderAuditViewState = {
  view: CoderAuditView | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
};

/** Reads the latest filtered CodeGraph view a direct_main_audit run published for
 * the active conversation. The backend keeps the authority; this hook is only its
 * transport. Refreshes on the shared `knowledge:refresh` signal (same as the
 * Hermes report), so a completed audit turn brings the focused branch into view. */
export default function useAgentBuilderCoderAuditView({
  projectId,
  conversationId,
}: {
  projectId: string;
  conversationId: string;
}): CoderAuditViewState {
  const [state, setState] = useState<CoderAuditViewState>({ view: null, status: 'idle', error: null });
  const [refreshNonce, setRefreshNonce] = useState(0);

  useEffect(() => {
    const refresh = () => setRefreshNonce((value) => value + 1);
    window.addEventListener('knowledge:refresh', refresh);
    return () => window.removeEventListener('knowledge:refresh', refresh);
  }, []);

  useEffect(() => {
    if (!projectId) {
      setState({ view: null, status: 'idle', error: null });
      return;
    }
    const controller = new AbortController();
    void (async () => {
      try {
        const params = new URLSearchParams({ projectId, conversationId });
        const response = await fetch(`/api/coder/coder-audit-view?${params.toString()}`, { signal: controller.signal });
        const payload = (await response.json().catch(() => null)) as { view?: CoderAuditView | null; error?: string } | null;
        if (controller.signal.aborted) return;
        if (!response.ok || !payload) {
          setState({ view: null, status: 'error', error: payload?.error || `HTTP ${response.status}` });
          return;
        }
        // Never trust a stale/wrong-project view (backend keys by project; verify anyway).
        const view = payload.view && payload.view.projectId === projectId ? payload.view : null;
        setState({ view, status: 'ready', error: null });
      } catch (error) {
        if (controller.signal.aborted) return;
        setState({ view: null, status: 'error', error: error instanceof Error ? error.message : 'coder_audit_view_read_failed' });
      }
    })();
    return () => controller.abort();
  }, [conversationId, projectId, refreshNonce]);

  return state;
}
