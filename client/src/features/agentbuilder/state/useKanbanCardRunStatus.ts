import { useEffect, useMemo, useState } from 'react';

import type {
  DeckDocument,
  KanbanCardRunReadState,
  KanbanCardRunStatus,
} from '../../../types/agentgraph';

const ACTIVE_KANBAN_PHASES = new Set(['queued', 'decomposing', 'working', 'synthesizing']);
const ACTIVE_REFRESH_MS = 2_000;
const QUIET_REFRESH_MS = 10_000;
const MAX_CONSECUTIVE_ERROR_RETRIES = 1;

export default function useKanbanCardRunStatus({
  projectId,
  deck,
}: {
  projectId: string;
  deck: DeckDocument;
}): {
  statuses: Record<string, KanbanCardRunStatus>;
  readStates: Record<string, KanbanCardRunReadState>;
  activeCardIds: string[];
} {
  const kanbanCardIds = useMemo(
    () => deck.nodes
      .filter((card) => card.runtime.kind === 'hermes' && card.runtime.mode === 'kanban')
      .map((card) => card.id),
    [deck.nodes],
  );
  const [readStates, setReadStates] = useState<Record<string, KanbanCardRunReadState>>({});

  useEffect(() => {
    if (!projectId || kanbanCardIds.length === 0) {
      setReadStates({});
      return undefined;
    }

    const controller = new AbortController();
    let disposed = false;
    let timer: number | null = null;
    let consecutiveErrorRetries = 0;

    setReadStates(Object.fromEntries(
      kanbanCardIds.map((cardId) => [cardId, { kind: 'loading' } satisfies KanbanCardRunReadState]),
    ));

    const schedule = (delayMs: number): void => {
      if (!disposed) timer = window.setTimeout(() => { void refresh(); }, delayMs);
    };
    const refresh = async (): Promise<void> => {
      try {
        const entries = await Promise.all(kanbanCardIds.map(async (cardId) => {
          try {
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
              result?: KanbanCardRunStatus | null;
              error?: string;
            } | null;
            if (!response.ok || payload?.ok !== true) {
              throw new Error(String(payload?.error || `kanban_card_status_http_${response.status}`));
            }
            const state: KanbanCardRunReadState = payload.result
              ? { kind: 'ready', status: payload.result }
              : { kind: 'empty' };
            return [cardId, state] as const;
          } catch (error) {
            if (controller.signal.aborted) throw error;
            return [cardId, {
              kind: 'error',
              error: error instanceof Error ? error.message : 'kanban_card_status_failed',
            } satisfies KanbanCardRunReadState] as const;
          }
        }));
        if (disposed) return;
        const nextReadStates = Object.fromEntries(entries);
        setReadStates(nextReadStates);
        const hasError = Object.values(nextReadStates).some((state) => state.kind === 'error');
        if (hasError) {
          if (consecutiveErrorRetries < MAX_CONSECUTIVE_ERROR_RETRIES) {
            consecutiveErrorRetries += 1;
            schedule(QUIET_REFRESH_MS);
          }
          return;
        }
        consecutiveErrorRetries = 0;
        const hasActiveRun = Object.values(nextReadStates)
          .some((state) => state.kind === 'ready' && ACTIVE_KANBAN_PHASES.has(state.status.status));
        schedule(hasActiveRun ? ACTIVE_REFRESH_MS : QUIET_REFRESH_MS);
      } catch (error) {
        if (disposed || controller.signal.aborted) return;
      }
    };

    void refresh();
    return () => {
      disposed = true;
      controller.abort();
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [deck.id, kanbanCardIds, projectId]);

  const statuses = useMemo(
    () => Object.fromEntries(Object.entries(readStates)
      .filter((entry): entry is [string, { kind: 'ready'; status: KanbanCardRunStatus }] => entry[1].kind === 'ready')
      .map(([cardId, state]) => [cardId, state.status])),
    [readStates],
  );
  const activeCardIds = useMemo(
    () => Object.values(statuses)
      .filter((status) => ACTIVE_KANBAN_PHASES.has(status.status))
      .map((status) => status.cardId),
    [statuses],
  );
  return { statuses, readStates, activeCardIds };
}
