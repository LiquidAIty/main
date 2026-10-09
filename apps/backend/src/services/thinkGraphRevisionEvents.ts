export type ThinkGraphRevisionEvent = {
  projectId: string;
  deckId: string;
  conversationId: string;
  originatingRunId: string;
  stage: 'settled';
  revision: string;
  changedNodeIds: string[];
  changedEdgeIds: string[];
  affectedNodeIds: string[];
};

export type ThinkGraphCompletedPairFailure = {
  projectId: string;
  deckId: string;
  conversationId: string;
  originatingRunId: string;
  stage: 'prepare' | 'thinkgraph_card' | 'settle';
  error: string;
};

export type ThinkGraphRevisionEventName = 'thinkgraph_revision' | 'thinkgraph_error';
export type ThinkGraphRevisionPayload = ThinkGraphRevisionEvent | ThinkGraphCompletedPairFailure;

type ThinkGraphRevisionListener = (
  eventName: ThinkGraphRevisionEventName,
  payload: ThinkGraphRevisionPayload,
) => void;

const revisionListeners = new Map<string, Set<ThinkGraphRevisionListener>>();

function revisionScopeKey(
  projectId: string,
  deckId: string,
  conversationId: string,
): string {
  return JSON.stringify([projectId, deckId, conversationId]);
}

export function publishThinkGraphRevisionEvent(
  eventName: ThinkGraphRevisionEventName,
  payload: ThinkGraphRevisionPayload,
): void {
  const listeners = revisionListeners.get(revisionScopeKey(
    payload.projectId,
    payload.deckId,
    payload.conversationId,
  ));
  if (!listeners?.size) return;
  for (const listener of [...listeners]) listener(eventName, payload);
}

export function subscribeThinkGraphRevisionEvents(
  projectId: string,
  deckId: string,
  conversationId: string,
  listener: ThinkGraphRevisionListener,
): () => void {
  const key = revisionScopeKey(projectId, deckId, conversationId);
  const listeners = revisionListeners.get(key) || new Set<ThinkGraphRevisionListener>();
  listeners.add(listener);
  revisionListeners.set(key, listeners);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) revisionListeners.delete(key);
  };
}
