import { useEffect, useMemo, useState } from 'react';

import type { DeckDocument } from '../../../types/agentgraph';

type CardRunActivity = {
  cardId: string;
  state: string;
  activeWorkers: number;
};

const ACTIVE_RUN_STATES = new Set(['pending', 'running']);
const ACTIVE_REFRESH_MS = 2_000;
const QUIET_REFRESH_MS = 10_000;
const MAX_ERROR_REFRESH_MS = 60_000;

export default function useCardActiveAgentCounts({
  projectId,
  deck,
}: {
  projectId: string;
  deck: DeckDocument;
}): {
  activeAgentCounts: Record<string, number>;
  activeCardIds: string[];
} {
  const cardIdsKey = JSON.stringify(deck.nodes.map((card) => card.id));
  const cardIds = useMemo(() => JSON.parse(cardIdsKey) as string[], [cardIdsKey]);
  const [activeAgentCounts, setActiveAgentCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!projectId || cardIds.length === 0) {
      setActiveAgentCounts({});
      return undefined;
    }

    const controller = new AbortController();
    let disposed = false;
    let timer: number | null = null;
    let consecutiveErrorRefreshes = 0;

    const schedule = (delayMs: number): void => {
      if (!disposed) timer = window.setTimeout(() => { void refresh(); }, delayMs);
    };
    const refresh = async (): Promise<void> => {
      const observations = await Promise.allSettled(cardIds.map(
        async (cardId): Promise<CardRunActivity | null> => {
          const response = await fetch('/api/cards/runs/read', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            signal: controller.signal,
            body: JSON.stringify({
              action: 'status',
              inspectOnly: true,
              projectId,
              deckId: deck.id,
              cardId,
            }),
          });
          const payload = await response.json().catch(() => null) as {
            ok?: boolean;
            result?: CardRunActivity | null;
          } | null;
          if (!response.ok || payload?.ok !== true) {
            throw new Error(`card_activity_http_${response.status}`);
          }
          const status = payload.result ?? null;
          if (status && (
            status.cardId !== cardId
            || typeof status.state !== 'string'
            || !Number.isSafeInteger(status.activeWorkers)
            || status.activeWorkers < 0
          )) {
            throw new Error('card_activity_response_invalid');
          }
          return status;
        },
      ));
      if (disposed || controller.signal.aborted) return;
      const nextCounts: Record<string, number> = {};
      let failureCount = 0;
      for (const observation of observations) {
        if (observation.status === 'rejected') {
          failureCount += 1;
          continue;
        }
        const status = observation.value;
        if (!status || !ACTIVE_RUN_STATES.has(String(status.state || ''))) continue;
        const childWorkers = Number.isSafeInteger(status.activeWorkers) && status.activeWorkers > 0
          ? status.activeWorkers
          : 0;
        nextCounts[status.cardId] = 1 + childWorkers;
      }
      setActiveAgentCounts((current) => (
        Object.keys(current).length === Object.keys(nextCounts).length
        && Object.entries(nextCounts).every(([cardId, count]) => current[cardId] === count)
          ? current
          : nextCounts
      ));
      consecutiveErrorRefreshes = failureCount > 0
        ? consecutiveErrorRefreshes + 1
        : 0;
      const errorDelay = Math.min(
        QUIET_REFRESH_MS * (2 ** Math.max(consecutiveErrorRefreshes - 1, 0)),
        MAX_ERROR_REFRESH_MS,
      );
      schedule(
        failureCount > 0
          ? errorDelay
          : Object.keys(nextCounts).length > 0
            ? ACTIVE_REFRESH_MS
            : QUIET_REFRESH_MS,
      );
    };

    void refresh();
    return () => {
      disposed = true;
      controller.abort();
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [cardIds, deck.id, projectId]);

  return {
    activeAgentCounts,
    activeCardIds: Object.keys(activeAgentCounts),
  };
}
