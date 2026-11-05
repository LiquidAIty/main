/**
 * Entity: Project Knowledge Graph
 * Relationship: Publishes only completed changes to the visible graph/navigation projection and reports exact Hermes cache synchronization to the graph settings UI.
 */

import { useEffect, useMemo, useState } from 'react';

import type { JoinedGraphPresentation } from '../../components/knowledge/knowledgeGraphProjection';
import {
  buildHermesNavigationMap,
  clearHermesNavigationMap,
  publishHermesNavigationMap,
  type HermesNavigationMapSync,
} from './hermesNavigationMapClient';

export type HermesNavigationMapState =
  | { status: 'idle' | 'publishing' }
  | HermesNavigationMapSync
  | { status: 'error'; error: string };

export default function useHermesNavigationMap(
  presentation: JoinedGraphPresentation,
  focusedVisualNodeId: string | null,
): HermesNavigationMapState {
  const map = useMemo(
    () => buildHermesNavigationMap(presentation, focusedVisualNodeId),
    [focusedVisualNodeId, presentation],
  );
  const fingerprint = JSON.stringify(map);
  const [state, setState] = useState<HermesNavigationMapState>({ status: 'idle' });
  useEffect(() => {
    if (!map.projectId) {
      let cancelled = false;
      setState({ status: 'publishing' });
      void clearHermesNavigationMap().then(() => {
        if (!cancelled) setState({ status: 'idle' });
      }).catch((error) => {
        if (!cancelled) setState({
          status: 'error',
          error: error instanceof Error ? error.message : String(error),
        });
      });
      return () => { cancelled = true; };
    }
    let cancelled = false;
    setState({ status: 'publishing' });
    void publishHermesNavigationMap(map).then((result) => {
      if (!cancelled) setState(result);
    }).catch((error) => {
      if (!cancelled) setState({
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      });
    });
    return () => { cancelled = true; };
  }, [fingerprint]);
  return state;
}
