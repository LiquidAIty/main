import {
  parseJevFocusDecision,
  type JevFocusCandidateView,
  type JevFocusCenterMemberView,
  type JevFocusDecisionView,
} from './knowledgeGraphFocusPresentation';

export type JevFocusRequest = {
  projectId: string;
  centerId: string;
  centerTitle: string;
  centerProviderMembers: JevFocusCenterMemberView[];
  sourceRevision: string;
  candidates: JevFocusCandidateView[];
  signal: AbortSignal;
};

export async function requestJevFocus({
  projectId,
  centerId,
  centerTitle,
  centerProviderMembers,
  sourceRevision,
  candidates,
  signal,
}: JevFocusRequest): Promise<JevFocusDecisionView> {
  if (!candidates.length) {
    return {
      schemaVersion: 'jev-focus.v1', status: 'unavailable', decisionId: null,
      sourceRevision,
      errorCode: 'jev_focus_no_connected_candidates', distribution: {}, candidates: [],
    };
  }
  const response = await fetch('/api/graph/jev-focus', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      schemaVersion: 'jev-focus.request.v1',
      projectId,
      sourceRevision,
      center: { visualId: centerId, title: centerTitle, providerMembers: centerProviderMembers },
      candidates,
    }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(String(payload?.error || 'jev_focus_request_failed'));
  return parseJevFocusDecision(payload, candidates, sourceRevision);
}
