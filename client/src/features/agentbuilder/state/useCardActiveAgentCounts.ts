// Entity: Run Ledger
// Relationship: This file refreshes inspect-only status for each saved Card on the Hermes Bot roster cadence and counts only actual active Runs.
// Entity: Card Topology
// Relationship: This file projects truthful active Card identities used by the topology canvas without inferring worker activity.
// Entity: Main Chat
// Relationship: The same roster refresh carries Main's canonical-session activity watermark for exact transcript rehydration.

import { useEffect, useMemo, useState } from 'react';

import type { DeckDocument } from '../../../types/agentgraph';

type CardRunActivity = {
  cardId: string;
  state: string;
};

export type MainCanonicalSessionActivity = {
  id: string;
  resolvedId: string;
  lastActive: number;
};

const ACTIVE_RUN_STATES = new Set(['pending', 'running']);
const ROSTER_REFRESH_MS = 5_000;

export default function useCardActiveAgentCounts({
  projectId,
  deck,
}: {
  projectId: string;
  deck: DeckDocument;
}): {
  activeAgentCounts: Record<string, number>;
  activeCardIds: string[];
  mainCanonicalSession: MainCanonicalSessionActivity | null;
} {
  const cardIdsKey = JSON.stringify(deck.nodes.map((card) => card.id));
  const cardIds = useMemo(() => JSON.parse(cardIdsKey) as string[], [cardIdsKey]);
  const [activeAgentCounts, setActiveAgentCounts] = useState<Record<string, number>>({});
  const [mainCanonicalSession, setMainCanonicalSession] = useState<MainCanonicalSessionActivity | null>(null);

  useEffect(() => {
    if (!projectId || cardIds.length === 0) {
      setActiveAgentCounts({});
      setMainCanonicalSession(null);
      return undefined;
    }

    const controller = new AbortController();
    let disposed = false;
    let timer: number | null = null;

    const schedule = (delayMs: number): void => {
      if (!disposed) timer = window.setTimeout(() => { void refresh(); }, delayMs);
    };
    const refresh = async (): Promise<void> => {
      let statuses: CardRunActivity[] = [];
      try {
        const response = await fetch('/api/cards/runs/latest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          signal: controller.signal,
          body: JSON.stringify({
            inspectOnly: true,
            projectId,
            deckId: deck.id,
            cardIds,
          }),
        });
        const payload = await response.json().catch(() => null) as {
          ok?: boolean;
          results?: CardRunActivity[];
          failedCardIds?: string[];
          mainCanonicalSession?: MainCanonicalSessionActivity | null;
        } | null;
        if (
          !response.ok
          || payload?.ok !== true
          || !Array.isArray(payload.results)
          || !Array.isArray(payload.failedCardIds)
        ) {
          throw new Error(`card_activity_http_${response.status}`);
        }
        statuses = payload.results;
        setMainCanonicalSession(payload.mainCanonicalSession || null);
      } catch {
        if (disposed || controller.signal.aborted) return;
        setMainCanonicalSession(null);
      }
      if (disposed || controller.signal.aborted) return;
      const nextCounts: Record<string, number> = {};
      const requested = new Set(cardIds);
      const observed = new Set<string>();
      for (const status of statuses) {
        if (
          !status
          || !requested.has(status.cardId)
          || observed.has(status.cardId)
          || typeof status.state !== 'string'
        ) {
          continue;
        }
        observed.add(status.cardId);
        if (!ACTIVE_RUN_STATES.has(String(status.state || ''))) continue;
        nextCounts[status.cardId] = 1;
      }
      setActiveAgentCounts((current) => (
        Object.keys(current).length === Object.keys(nextCounts).length
        && Object.entries(nextCounts).every(([cardId, count]) => current[cardId] === count)
          ? current
          : nextCounts
      ));
      schedule(ROSTER_REFRESH_MS);
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
    mainCanonicalSession,
  };
}
