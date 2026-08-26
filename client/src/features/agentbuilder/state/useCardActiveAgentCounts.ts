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
const MAX_CONSECUTIVE_ERROR_RETRIES = 1;

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
  const cardIds = useMemo(() => deck.nodes.map((card) => card.id), [deck.nodes]);
  const [activeAgentCounts, setActiveAgentCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!projectId || cardIds.length === 0) {
      setActiveAgentCounts({});
      return undefined;
    }

    const controller = new AbortController();
    let disposed = false;
    let timer: number | null = null;
    let consecutiveErrorRetries = 0;

    const schedule = (delayMs: number): void => {
      if (!disposed) timer = window.setTimeout(() => { void refresh(); }, delayMs);
    };
    const refresh = async (): Promise<void> => {
      try {
        const statuses = await Promise.all(cardIds.map(async (cardId): Promise<CardRunActivity | null> => {
          const response = await fetch('/api/coder/mcp-bridge/run_configured_card', {
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
          return payload.result ?? null;
        }));
        if (disposed) return;
        const nextCounts: Record<string, number> = {};
        for (const status of statuses) {
          if (!status || !ACTIVE_RUN_STATES.has(String(status.state || ''))) continue;
          const childWorkers = Number.isSafeInteger(status.activeWorkers) && status.activeWorkers > 0
            ? status.activeWorkers
            : 0;
          nextCounts[status.cardId] = 1 + childWorkers;
        }
        setActiveAgentCounts(nextCounts);
        consecutiveErrorRetries = 0;
        schedule(Object.keys(nextCounts).length > 0 ? ACTIVE_REFRESH_MS : QUIET_REFRESH_MS);
      } catch (error) {
        if (disposed || controller.signal.aborted) return;
        setActiveAgentCounts({});
        if (consecutiveErrorRetries < MAX_CONSECUTIVE_ERROR_RETRIES) {
          consecutiveErrorRetries += 1;
          schedule(QUIET_REFRESH_MS);
        }
      }
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
