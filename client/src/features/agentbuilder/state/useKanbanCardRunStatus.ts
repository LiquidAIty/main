import { useEffect, useMemo, useState } from 'react';

import type { DeckDocument, KanbanCardRunStatus } from '../../../types/agentgraph';

const ACTIVE_KANBAN_PHASES = new Set(['queued', 'decomposing', 'working', 'synthesizing']);
const ACTIVE_REFRESH_MS = 2_000;
const QUIET_REFRESH_MS = 10_000;

export default function useKanbanCardRunStatus({
  projectId,
  deck,
}: {
  projectId: string;
  deck: DeckDocument;
}): {
  statuses: Record<string, KanbanCardRunStatus>;
  activeCardIds: string[];
} {
  const kanbanCardIds = useMemo(
    () => deck.nodes
      .filter((card) => card.runtime.kind === 'hermes' && card.runtime.mode === 'kanban')
      .map((card) => card.id),
    [deck.nodes],
  );
  const [statuses, setStatuses] = useState<Record<string, KanbanCardRunStatus>>({});

  useEffect(() => {
    if (!projectId || kanbanCardIds.length === 0) {
      setStatuses({});
      return undefined;
    }

    const controller = new AbortController();
    let disposed = false;
    let timer: number | null = null;

    const schedule = (delayMs: number): void => {
      if (!disposed) timer = window.setTimeout(() => { void refresh(); }, delayMs);
    };
    const refresh = async (): Promise<void> => {
      try {
        const entries = await Promise.all(kanbanCardIds.map(async (cardId) => {
          const response = await fetch('/api/coder/mcp-bridge/run_configured_card', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            signal: controller.signal,
            body: JSON.stringify({
              action: 'status',
              projectId,
              deckId: deck.id,
              cardId,
            }),
          });
          if (!response.ok) throw new Error(`kanban_card_status_http_${response.status}`);
          const payload = await response.json() as { ok?: boolean; result?: KanbanCardRunStatus | null };
          if (payload.ok !== true) throw new Error('kanban_card_status_failed');
          return [cardId, payload.result ?? null] as const;
        }));
        if (disposed) return;
        const nextStatuses = Object.fromEntries(
          entries.filter((entry): entry is readonly [string, KanbanCardRunStatus] => entry[1] !== null),
        );
        setStatuses(nextStatuses);
        const hasActiveRun = Object.values(nextStatuses)
          .some((status) => ACTIVE_KANBAN_PHASES.has(status.status));
        schedule(hasActiveRun ? ACTIVE_REFRESH_MS : QUIET_REFRESH_MS);
      } catch (error) {
        if (disposed || controller.signal.aborted) return;
        schedule(QUIET_REFRESH_MS);
      }
    };

    void refresh();
    return () => {
      disposed = true;
      controller.abort();
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [deck.id, kanbanCardIds, projectId]);

  const activeCardIds = useMemo(
    () => Object.values(statuses)
      .filter((status) => ACTIVE_KANBAN_PHASES.has(status.status))
      .map((status) => status.cardId),
    [statuses],
  );
  return { statuses, activeCardIds };
}
