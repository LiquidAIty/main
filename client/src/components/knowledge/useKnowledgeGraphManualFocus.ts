import { useEffect, useMemo, useRef, useState } from 'react';

import { applyJevGraphPhysics, type JevGraphPhysicsProfile } from './jevGraphPhysics';
import {
  FOCUS_RELEASE_MILLISECONDS,
  MAX_JEV_FOCUS_CANDIDATES,
  buildJevFocusCandidates,
  composeExpandedFocusPresentation,
  composeFocusNeighborhoodPresentation,
  composeFocusReleasePresentation,
  composeManualFocusPresentation,
  focusCenterMembers,
  type FocusReleaseView,
  type JevFocusDecisionView,
  type ManualFocusEntry,
  type ReadProviderFocusNeighborhood,
} from './knowledgeGraphFocusPresentation';
import { knowledgeGraphFocusProjectionIdentity } from './knowledgeGraphFocusProjectionIdentity';
import { requestJevFocus } from './knowledgeGraphJevFocusClient';
import type {
  GraphAuthority,
  GraphProjectionV1,
  JoinedGraphPresentation,
} from './joinedKnowledgeGraphProjection';

export function useKnowledgeGraphManualFocus({
  projection,
  joinedPresentation,
  physicsProfile,
  onReadProviderFocusNeighborhood,
}: {
  projection: GraphProjectionV1;
  joinedPresentation: JoinedGraphPresentation;
  physicsProfile: JevGraphPhysicsProfile;
  onReadProviderFocusNeighborhood?: ReadProviderFocusNeighborhood;
}) {
  const [focusTrail, setFocusTrail] = useState<ManualFocusEntry[]>([]);
  const [expandedFocusResult, setExpandedFocusResult] = useState<ManualFocusEntry | null>(null);
  const [focusRelease, setFocusRelease] = useState<FocusReleaseView | null>(null);
  const focusRequestControllersRef = useRef(new Map<number, AbortController>());
  const focusRequestIdentityRef = useRef(0);
  const focusProjectionKeyRef = useRef('');
  const focusReleaseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const focusedEntry = focusTrail.length ? focusTrail[focusTrail.length - 1] : null;
  const successfulFocusedEntry = focusedEntry?.status === 'success'
    && focusedEntry.decision?.status === 'success'
    ? focusedEntry
    : null;
  const focusRequestPending = focusedEntry?.status === 'reading' || focusedEntry?.status === 'loading';
  const activeJoinedPresentation = successfulFocusedEntry?.presentation
    || expandedFocusResult?.presentation
    || joinedPresentation;
  const localDisplayProjection = useMemo(
    () => applyJevGraphPhysics(projection, physicsProfile),
    [physicsProfile, projection],
  );
  const manualProjectionSource = useMemo(
    () => applyJevGraphPhysics(activeJoinedPresentation.projection, physicsProfile),
    [activeJoinedPresentation, physicsProfile],
  );
  const focusProjectionKey = useMemo(
    () => knowledgeGraphFocusProjectionIdentity(joinedPresentation),
    [joinedPresentation],
  );
  focusProjectionKeyRef.current = focusProjectionKey;
  const manualNavigationActive = focusedEntry !== null || expandedFocusResult !== null;
  const blackholePresentationActive = successfulFocusedEntry !== null;
  const manualFocusPresentation = useMemo(
    () => manualProjectionSource && successfulFocusedEntry
      ? composeManualFocusPresentation(manualProjectionSource, successfulFocusedEntry)
      : null,
    [manualProjectionSource, successfulFocusedEntry],
  );
  const expandedFocusPresentation = useMemo(
    () => manualProjectionSource
      ? composeExpandedFocusPresentation(manualProjectionSource, expandedFocusResult)
      : null,
    [expandedFocusResult, manualProjectionSource],
  );
  const displayProjection = useMemo(
    () => manualFocusPresentation?.projection
      || (expandedFocusPresentation || localDisplayProjection
        ? composeFocusReleasePresentation(
          expandedFocusPresentation || localDisplayProjection!,
          focusRelease,
        )
        : null),
    [expandedFocusPresentation, focusRelease, localDisplayProjection, manualFocusPresentation],
  );

  const beginFocusRelease = (entry: ManualFocusEntry | null) => {
    if (!entry || !manualProjectionSource) {
      setFocusRelease(null);
      return;
    }
    const focused = composeManualFocusPresentation(manualProjectionSource, entry);
    setFocusRelease({
      centerId: entry.centerId,
      nodeIds: focused.nodeIds,
      edgeIds: focused.edgeIds,
    });
    if (focusReleaseTimeoutRef.current) clearTimeout(focusReleaseTimeoutRef.current);
    const reducedMotion = typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reducedMotion) {
      setFocusRelease(null);
      return;
    }
    focusReleaseTimeoutRef.current = setTimeout(() => {
      focusReleaseTimeoutRef.current = null;
      setFocusRelease(null);
    }, FOCUS_RELEASE_MILLISECONDS);
  };

  const exitManualFocus = () => {
    const current = focusTrail.length ? focusTrail[focusTrail.length - 1] : null;
    if (!current && !focusRelease) return;
    for (const controller of focusRequestControllersRef.current.values()) controller.abort();
    focusRequestControllersRef.current.clear();
    focusRequestIdentityRef.current += 1;
    if (current?.status === 'success' && current.decision?.status === 'success') {
      setExpandedFocusResult(current);
      beginFocusRelease(current);
    } else {
      setFocusRelease(null);
    }
    setFocusTrail([]);
  };

  const enterManualFocus = (centerId: string) => {
    if (!manualProjectionSource) return;
    const center = manualProjectionSource.nodes.find(node => node.id === centerId);
    if (!center || (focusedEntry?.centerId === centerId
      && ['reading', 'loading', 'success'].includes(focusedEntry.status))) return;
    const sourcePresentation = activeJoinedPresentation;
    const centerProviderMembers = focusCenterMembers(sourcePresentation, centerId);
    if (!centerProviderMembers.length) return;
    if (focusReleaseTimeoutRef.current) {
      clearTimeout(focusReleaseTimeoutRef.current);
      focusReleaseTimeoutRef.current = null;
    }
    for (const pending of focusRequestControllersRef.current.values()) pending.abort();
    focusRequestControllersRef.current.clear();
    setFocusRelease(null);
    const requestIdentity = focusRequestIdentityRef.current + 1;
    focusRequestIdentityRef.current = requestIdentity;
    const entry: ManualFocusEntry = {
      centerId,
      centerTitle: center.label || center.title || center.id,
      candidates: [],
      status: 'reading',
      decision: null,
      requestIdentity,
      projectionKey: focusProjectionKey,
      presentation: sourcePresentation,
      readWarning: null,
    };
    setFocusTrail([entry]);
    const controller = new AbortController();
    focusRequestControllersRef.current.set(requestIdentity, controller);
    const stale = () => controller.signal.aborted
      || focusProjectionKeyRef.current !== entry.projectionKey;
    const failedDecision = (
      status: Exclude<JevFocusDecisionView['status'], 'success'>,
      errorCode: string,
    ): JevFocusDecisionView => ({
      schemaVersion: 'jev-focus.v1', sourceRevision: entry.projectionKey,
      status, decisionId: null, errorCode, distribution: {}, candidates: [],
    });
    void (async () => {
      if (!onReadProviderFocusNeighborhood) {
        if (stale()) return;
        const decision = failedDecision('unavailable', 'jev_focus_provider_reader_unavailable');
        setFocusTrail(history => history.map(item => item.requestIdentity === requestIdentity
          ? { ...item, status: decision.status, decision }
          : item));
        return;
      }
      const settled = await Promise.allSettled(centerProviderMembers.map(async member => ({
        authority: member.authority === 'ThinkGraph' ? 'thinkgraph' as const : 'knowgraph' as const,
        projection: await onReadProviderFocusNeighborhood(
          member.authority === 'ThinkGraph' ? 'thinkgraph' : 'knowgraph',
          member.entityId,
          controller.signal,
        ),
      })));
      if (stale()) return;
      const reads: Partial<Record<GraphAuthority, GraphProjectionV1[]>> = {};
      const failures: string[] = [];
      for (let index = 0; index < settled.length; index += 1) {
        const result = settled[index];
        if (result.status === 'fulfilled') {
          const list = reads[result.value.authority] || [];
          list.push(result.value.projection);
          reads[result.value.authority] = list;
        } else {
          const member = centerProviderMembers[index];
          failures.push(`${member.authority} ${member.entityId}`);
        }
      }
      if (!Object.values(reads).some(values => values?.length)) {
        const decision = failedDecision('unavailable', 'jev_focus_provider_read_unavailable');
        setFocusTrail(history => history.map(item => item.requestIdentity === requestIdentity
          ? { ...item, status: decision.status, decision, readWarning: failures.join(' · ') }
          : item));
        return;
      }
      const focusPresentation = composeFocusNeighborhoodPresentation(
        sourcePresentation,
        centerId,
        reads,
      );
      const candidates = buildJevFocusCandidates(
        focusPresentation.projection,
        focusPresentation,
        centerId,
      );
      const readWarning = failures.length
        ? `Provider neighborhood partial: ${failures.join(' · ')}`
        : null;
      if (failures.length || candidates.length > MAX_JEV_FOCUS_CANDIDATES) {
        const decision = failedDecision(
          'unavailable',
          failures.length
            ? 'jev_focus_provider_read_partial'
            : 'jev_focus_candidate_limit',
        );
        setFocusTrail(history => history.map(item => item.requestIdentity === requestIdentity
          ? {
            ...item,
            presentation: focusPresentation,
            candidates,
            status: decision.status,
            decision,
            readWarning: readWarning || (
              `Provider neighborhood has ${candidates.length} subjects; `
              + `JevFocus accepts at most ${MAX_JEV_FOCUS_CANDIDATES}.`
            ),
          }
          : item));
        return;
      }
      setFocusTrail(history => history.map(item => item.requestIdentity === requestIdentity
        ? { ...item, presentation: focusPresentation, candidates, status: 'loading', readWarning }
        : item));
      const decision = await requestJevFocus({
        projectId: focusPresentation.projection.projectId,
        centerId,
        centerTitle: entry.centerTitle,
        centerProviderMembers: focusCenterMembers(focusPresentation, centerId),
        sourceRevision: entry.projectionKey,
        candidates,
        signal: controller.signal,
      });
      if (stale()) return;
      setFocusTrail(history => history.map(item => item.requestIdentity === requestIdentity
        ? { ...item, status: decision.status, decision }
        : item));
    })().catch((failure: unknown) => {
      if (stale()) return;
      const decision = failedDecision(
        'error',
        failure instanceof Error ? failure.message : 'jev_focus_request_failed',
      );
      setFocusTrail(history => history.map(item => item.requestIdentity === requestIdentity
        ? { ...item, status: 'error', decision }
        : item));
    }).finally(() => {
      focusRequestControllersRef.current.delete(requestIdentity);
    });
  };

  useEffect(() => () => {
    for (const controller of focusRequestControllersRef.current.values()) controller.abort();
    focusRequestControllersRef.current.clear();
    if (focusReleaseTimeoutRef.current) clearTimeout(focusReleaseTimeoutRef.current);
  }, []);

  useEffect(() => {
    for (const controller of focusRequestControllersRef.current.values()) controller.abort();
    focusRequestControllersRef.current.clear();
    focusRequestIdentityRef.current += 1;
    if (focusReleaseTimeoutRef.current) {
      clearTimeout(focusReleaseTimeoutRef.current);
      focusReleaseTimeoutRef.current = null;
    }
    setFocusRelease(null);
    setExpandedFocusResult(null);
    setFocusTrail(history => history.length ? [] : history);
  }, [focusProjectionKey]);

  return {
    activeJoinedPresentation,
    blackholePresentationActive,
    displayProjection,
    enterManualFocus,
    exitManualFocus,
    focusRelease,
    focusedEntry,
    focusRequestPending,
    manualNavigationActive,
    successfulFocusedEntry,
  };
}
