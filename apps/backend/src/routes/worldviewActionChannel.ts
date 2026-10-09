import type { Response } from 'express';
import { randomUUID } from 'node:crypto';

const ACTION_TIMEOUT_MS = 30_000;

export type WorldviewAction = {
  projectId: string;
  deckId: string;
  cardId: string;
  parentRunId: string;
  name: string;
  arguments: Record<string, unknown>;
};

type ActionListener = {
  cardId: string;
  response: Response;
  pending: Set<string>;
};

type PendingAction = {
  projectId: string;
  cardId: string;
  name: string;
  listener: ActionListener;
  finish: (result: Record<string, unknown>) => void;
  timer: ReturnType<typeof setTimeout>;
};

/** One short-lived command lane to the existing direct mount, not a second globe. */
export function createWorldviewActionChannel() {
  const listeners = new Map<string, ActionListener>();
  const pending = new Map<string, PendingAction>();
  return {
    listen(projectId: string, cardId: string, response: Response): boolean {
      if (listeners.has(projectId)) return false;
      const listener: ActionListener = { cardId, response, pending: new Set() };
      listeners.set(projectId, listener);
      response.status(200).set({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
      });
      response.flushHeaders();
      response.write(': WorldView connected\n\n');
      response.on('close', () => {
        if (listeners.get(projectId) !== listener) return;
        listeners.delete(projectId);
        for (const requestId of listener.pending) {
          pending.get(requestId)?.finish({ ok: false, error: 'worldview_mount_disconnected' });
        }
      });
      return true;
    },
    async dispatch(
      action: WorldviewAction,
      disabledLayerIds: string[],
    ): Promise<Record<string, unknown>> {
      const listener = listeners.get(action.projectId);
      if (!listener || listener.cardId !== action.cardId || listener.response.destroyed) {
        return { ok: false, error: 'worldview_mount_unavailable' };
      }
      if (listener.pending.size > 0) return { ok: false, error: 'worldview_action_busy' };
      const requestId = randomUUID();
      const result = new Promise<Record<string, unknown>>((resolve) => {
        const finish = (value: Record<string, unknown>) => {
          const current = pending.get(requestId);
          if (!current) return;
          clearTimeout(current.timer);
          pending.delete(requestId);
          current.listener.pending.delete(requestId);
          resolve(value);
        };
        const timer = setTimeout(
          () => finish({ ok: false, error: 'worldview_action_timeout' }),
          ACTION_TIMEOUT_MS,
        );
        pending.set(requestId, {
          projectId: action.projectId, cardId: action.cardId,
          name: action.name, listener, finish, timer,
        });
        listener.pending.add(requestId);
      });
      try {
        listener.response.write(`event: action\ndata: ${JSON.stringify({
          requestId,
          name: action.name,
          arguments: action.arguments,
          disabledLayerIds,
        })}\n\n`);
      } catch {
        pending.get(requestId)?.finish({ ok: false, error: 'worldview_mount_disconnected' });
      }
      return result;
    },
    pendingAction(projectId: string, cardId: string, requestId: string): PendingAction | null {
      const command = pending.get(requestId);
      return command && command.projectId === projectId && command.cardId === cardId
        && listeners.get(projectId) === command.listener ? command : null;
    },
    settle(projectId: string, cardId: string, requestId: string, result: Record<string, unknown>): boolean {
      const command = pending.get(requestId);
      if (!command || command.projectId !== projectId || command.cardId !== cardId
        || listeners.get(projectId) !== command.listener) return false;
      command.finish(result);
      return true;
    },
  };
}

export type WorldviewActionChannel = ReturnType<typeof createWorldviewActionChannel>;
