/**
 * Entity: Main Chat
 * Relationship: Submits one Main prompt and projects correlated runtime events into the application stream.
 * Entity: Card Sessions
 * Relationship: Observes the exact saved Main Card session without selecting or executing another agent.
 */

import type { CardRuntimeClient, CardRuntimeEvent } from '../services/cardRuntimeGateway';
import { objectRecord } from '../services/projectCardAuthority';
import type { CardSessionBinding } from './cardSessions';

export type MainTurnResult = {
  text: string;
  event: CardRuntimeEvent;
  toolCalls: number;
  providerTurnRef: string;
};

function completionError(payloadValue: unknown): Error | null {
  const payload = objectRecord(payloadValue);
  const status = String(payload.status || 'complete').trim().toLowerCase();
  if (status === 'interrupted' || status === 'cancelled') return new Error('card_turn_cancelled');
  if (status === 'error' || status === 'failed') {
    return new Error(String(payload.error || payload.failure_reason || payload.text || 'card_turn_failed'));
  }
  return null;
}

function completionText(payload: Record<string, any>, streamed: string): string {
  return typeof payload.text === 'string' ? payload.text : streamed;
}

function providerTurnRef(event: CardRuntimeEvent, fallback: string): string {
  const persisted = objectRecord(event.payload?.persisted_turn);
  return String(persisted.submission_id || fallback).trim() || fallback;
}

export async function executeMainTurn(args: {
  client: CardRuntimeClient;
  binding: CardSessionBinding;
  profile: string;
  text: string;
  runId: string;
  stopSignal?: AbortSignal;
  onAdmitted(): Promise<void>;
  onEvent(event: CardRuntimeEvent): void;
}): Promise<MainTurnResult> {
  const status = objectRecord(await args.client.request('session.status', {
    session_id: args.binding.liveHandle,
  }));
  if (status.running === true) throw new Error('card_session_active');
  let started = false;
  let streamedText = '';
  let toolCalls = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let detachEvent: () => void = () => undefined;
  let detachState: () => void = () => undefined;
  let settle!: (value: MainTurnResult) => void;
  let fail!: (error: Error) => void;
  let settled = false;
  const done = new Promise<MainTurnResult>((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });
  const cleanup = () => {
    if (timer) clearTimeout(timer);
    detachEvent();
    detachState();
    args.stopSignal?.removeEventListener('abort', stop);
  };
  const finish = (error?: Error, result?: MainTurnResult) => {
    if (settled) return;
    settled = true;
    cleanup();
    if (error) fail(error);
    else settle(result!);
  };
  const stop = () => finish(new Error('card_turn_cancelled'));
  if (args.stopSignal?.aborted) throw new Error('card_turn_cancelled');
  args.stopSignal?.addEventListener('abort', stop, { once: true });
  detachState = args.client.onState((state) => {
    if (state === 'closed' || state === 'error') {
      finish(new Error(`card_runtime_${state}_during_turn`));
    }
  });
  detachEvent = args.client.onEvent((event) => {
    if (event.session_id !== args.binding.liveHandle || settled) return;
    const payload = objectRecord(event.payload);
    if (event.type === 'message.start') {
      started = true;
      args.onEvent(event);
      return;
    }
    if (!started) return;
    if (event.type === 'message.delta') {
      const text = typeof payload.text === 'string' ? payload.text : '';
      streamedText += text;
      args.onEvent(event);
      return;
    }
    if (event.type === 'tool.start') toolCalls += 1;
    if (event.type.includes('reasoning') || event.type === 'tool.start' || event.type === 'tool.complete') {
      args.onEvent(event);
    }
    if (event.type === 'error') {
      finish(new Error(String(payload.message || 'card_turn_failed')));
      return;
    }
    if (event.type !== 'message.complete') return;
    const error = completionError(payload);
    if (error) {
      finish(error);
      return;
    }
    finish(undefined, {
      text: completionText(payload, streamedText),
      event,
      toolCalls,
      providerTurnRef: providerTurnRef(event, args.runId),
    });
  });
  timer = setTimeout(() => finish(new Error('card_turn_timeout')), 30 * 60_000);
  timer.unref?.();
  try {
    const submitted = objectRecord(await args.client.request('prompt.submit', {
      session_id: args.binding.liveHandle,
      profile: args.profile,
      text: args.text,
    }));
    if (String(submitted.status || '') !== 'streaming') {
      throw new Error(`card_submission_not_started:${String(submitted.status || 'unknown')}`);
    }
    await args.onAdmitted();
  } catch (error) {
    finish(error instanceof Error ? error : new Error(String(error)));
  }
  return done;
}

export async function attachMainImages(
  client: CardRuntimeClient,
  binding: CardSessionBinding,
  profile: string,
  images: unknown,
): Promise<void> {
  if (!Array.isArray(images)) return;
  const allowedHeaders = new Set([
    'data:image/png;base64',
    'data:image/jpeg;base64',
    'data:image/webp;base64',
    'data:image/gif;base64',
  ]);
  for (const [index, raw] of images.entries()) {
    const image = objectRecord(raw);
    const dataUrl = String(image.dataUrl || '').trim();
    if (!dataUrl) continue;
    const comma = dataUrl.indexOf(',');
    const header = comma < 0 ? '' : dataUrl.slice(0, comma).toLowerCase();
    const content = comma < 0 ? '' : dataUrl.slice(comma + 1);
    const validContent = Boolean(content) && [...content].every((character) => (
      (character >= 'A' && character <= 'Z')
      || (character >= 'a' && character <= 'z')
      || (character >= '0' && character <= '9')
      || character === '+'
      || character === '/'
      || character === '='
    ));
    if (!allowedHeaders.has(header) || !validContent) throw new Error('attachment_image_invalid');
    await client.request('image.attach_bytes', {
      session_id: binding.liveHandle,
      profile,
      content_base64: content,
      filename: String(image.name || `attachment-${index + 1}.png`),
    });
  }
}
