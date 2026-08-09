import { useEffect, useRef, useState } from 'react';

import type { GraphProjectionV1 } from '../../../components/knowledge/NativeAuthorityGraphSurface';

export type ThinkGraphProjectionState = {
  status: 'idle' | 'loading' | 'ready' | 'error';
  projection: GraphProjectionV1 | null;
  error: string | null;
};

// ── thinkgraph.projection.v1 (Python-owned) for the ThinkGraph graph tab ────
// The browser only requests the projection through the narrow backend transport
// and passes the RAW response into the native ForceGraph surface. No mapping, no
// classification, no fallback data — an error or empty projection is honest.
export default function useAgentBuilderThinkGraphProjection({
  activeProject,
  knowledgeGraphKind,
  workspaceView,
}: {
  activeProject: string;
  knowledgeGraphKind: string;
  workspaceView: string;
}): ThinkGraphProjectionState {
  const [thinkGraphProjection, setThinkGraphProjection] = useState<ThinkGraphProjectionState>({
    status: 'idle',
    projection: null,
    error: null,
  });
  // Explicit projection refresh only. Ordinary Main completion does not imply
  // a durable ThinkGraph write and therefore emits no refresh event.
  const [thinkGraphRefreshNonce, setThinkGraphRefreshNonce] = useState(0);
  useEffect(() => {
    const refresh = () => setThinkGraphRefreshNonce((n) => n + 1);
    window.addEventListener('thinkgraph:refresh', refresh);
    return () => window.removeEventListener('thinkgraph:refresh', refresh);
  }, []);
  // Last applied projection payload — an unchanged refetch is a no-op so the
  // rendered graph never re-lays-out ("dances") on identical data.
  const thinkGraphProjectionJsonRef = useRef<string | null>(null);
  useEffect(() => {
    if (workspaceView !== 'knowledge' || knowledgeGraphKind !== 'thinkgraph') return;
    const projectId = activeProject;
    if (!projectId) {
      thinkGraphProjectionJsonRef.current = null;
      setThinkGraphProjection({ status: 'idle', projection: null, error: null });
      return;
    }
    const controller = new AbortController();
    setThinkGraphProjection((prev) => ({
      ...prev,
      status: prev.projection ? prev.status : 'loading',
      error: null,
    }));
    void (async () => {
      try {
        const res = await fetch(
          `/api/thinkgraph/projection?projectId=${encodeURIComponent(projectId)}`,
          { signal: controller.signal },
        );
        const data = await res.json().catch(() => null);
        if (controller.signal.aborted) return;
        if (!res.ok || !data || typeof data !== 'object') {
          thinkGraphProjectionJsonRef.current = null;
          setThinkGraphProjection({
            status: 'error',
            projection: null,
            error: String((data as any)?.error || `HTTP ${res.status}`),
          });
          return;
        }
        const json = JSON.stringify(data);
        if (json === thinkGraphProjectionJsonRef.current) return; // unchanged — no re-render
        thinkGraphProjectionJsonRef.current = json;
        setThinkGraphProjection({
          status: 'ready',
          projection: data as GraphProjectionV1,
          error: null,
        });
      } catch (err: any) {
        if (controller.signal.aborted) return;
        thinkGraphProjectionJsonRef.current = null;
        setThinkGraphProjection({
          status: 'error',
          projection: null,
          error: String(err?.message || err),
        });
      }
    })();
    return () => controller.abort();
  }, [activeProject, knowledgeGraphKind, workspaceView, thinkGraphRefreshNonce]);

  return thinkGraphProjection;
}
