/**
 * Entity: Hermes Card Sessions
 * Relationship: This file verifies the shared Hermes session-gateway connection closes failed attempts and preserves a newer replacement client against stale finalizers.
 * Entity: Credentials
 * Relationship: This file verifies that plaintext Hermes gateway credentials are accepted only for loopback origins and are rejected when embedded in configured URLs.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  constructors: [] as Array<() => unknown>,
  constructorOptions: [] as Array<Record<string, unknown>>,
  tsImport: vi.fn(),
}));

vi.mock('tsx/esm/api', () => ({ tsImport: mocks.tsImport }));
vi.mock('./workingDirectories', () => ({
  resolveRepoRoot: () => process.cwd(),
}));

import {
  closeHermesGateway,
  hermesGateway,
  resolveHermesGatewayUrl,
  type HermesGatewayClient,
  type HermesGatewayEvent,
} from './hermesGateway';

function client(connect: () => Promise<void>): HermesGatewayClient & {
  closed: number;
  emitEvent(event: HermesGatewayEvent): void;
} {
  const eventHandlers = new Set<(event: HermesGatewayEvent) => void>();
  const stateHandlers = new Set<(state: string) => void>();
  return {
    connectionState: 'connecting',
    closed: 0,
    connect,
    close() {
      this.closed += 1;
      stateHandlers.forEach(handler => handler('closed'));
    },
    request: vi.fn(),
    onEvent(handler) {
      eventHandlers.add(handler);
      return () => eventHandlers.delete(handler);
    },
    onState(handler) {
      stateHandlers.add(handler);
      return () => stateHandlers.delete(handler);
    },
    onRequest() {
      return () => undefined;
    },
    emitEvent(event) {
      eventHandlers.forEach(handler => handler(event));
    },
  };
}

beforeEach(() => {
  process.env.HERMES_GATEWAY_URL = 'ws://127.0.0.1:9119/api/ws';
  process.env.HERMES_DASHBOARD_SESSION_TOKEN = 'a'.repeat(64);
  mocks.constructors = [];
  mocks.constructorOptions = [];
  mocks.tsImport.mockImplementation(async () => ({
    JsonRpcGatewayClient: function GatewayClient(options: Record<string, unknown>) {
      mocks.constructorOptions.push(options);
      const next = mocks.constructors.shift();
      if (!next) throw new Error('unexpected_gateway_client');
      return next();
    },
  }));
});

afterEach(() => {
  closeHermesGateway();
  vi.resetAllMocks();
});

describe('Hermes Gateway lifecycle', () => {
  it('allows plaintext only on loopback and rejects URL-carried credentials', () => {
    expect(resolveHermesGatewayUrl({
      HERMES_GATEWAY_URL: 'ws://127.0.0.1:9119/api/ws',
      HERMES_DASHBOARD_SESSION_TOKEN: 'b'.repeat(64),
    })).toBe(`ws://127.0.0.1:9119/api/ws?token=${'b'.repeat(64)}`);
    expect(() => resolveHermesGatewayUrl({
      HERMES_GATEWAY_URL: 'ws://gateway.example/api/ws',
      HERMES_DASHBOARD_SESSION_TOKEN: 'b'.repeat(64),
    })).toThrow('hermes_gateway_url_invalid');
    expect(() => resolveHermesGatewayUrl({
      HERMES_GATEWAY_URL: `wss://gateway.example/api/ws?token=${'c'.repeat(64)}`,
      HERMES_DASHBOARD_SESSION_TOKEN: 'b'.repeat(64),
    })).toThrow('hermes_gateway_url_invalid');
  });

  it('closes a failed client before allowing a clean retry', async () => {
    const failed = client(async () => { throw new Error('connect_failed'); });
    let ready!: ReturnType<typeof client>;
    ready = client(async () => {
      ready.emitEvent({ type: 'gateway.ready' });
      Object.defineProperty(ready, 'connectionState', { value: 'open' });
    });
    mocks.constructors.push(() => failed, () => ready);

    await expect(hermesGateway()).rejects.toThrow('connect_failed');
    expect(failed.closed).toBe(1);
    await expect(hermesGateway()).resolves.toBe(ready);
    await expect(hermesGateway()).resolves.toBe(ready);
    expect(mocks.tsImport).toHaveBeenCalledTimes(2);
    expect(mocks.constructorOptions).toEqual([
      expect.objectContaining({
        requestIdPrefix: 'app',
        requestTimeoutMs: 30 * 60_000,
        heartbeatDeadlineMs: 5 * 60_000,
      }),
      expect.objectContaining({
        requestIdPrefix: 'app',
        requestTimeoutMs: 30 * 60_000,
        heartbeatDeadlineMs: 5 * 60_000,
      }),
    ]);
  });

  it('does not let an older finalizer clear a replacement attempt', async () => {
    let rejectFirst: ((error: Error) => void) | undefined;
    const first = client(() => new Promise<void>((_resolve, reject) => {
      rejectFirst = reject;
    }));
    let second!: ReturnType<typeof client>;
    second = client(async () => {
      second.emitEvent({ type: 'gateway.ready' });
      Object.defineProperty(second, 'connectionState', { value: 'open' });
    });
    mocks.constructors.push(() => first, () => second);

    const originalAttempt = hermesGateway();
    const originalOutcome = originalAttempt.catch(error => error as Error);
    await vi.waitFor(() => expect(rejectFirst).toBeTypeOf('function'));
    closeHermesGateway();
    const replacement = hermesGateway();
    rejectFirst!(new Error('old_attempt_finished'));

    expect(await originalOutcome).toBeInstanceOf(Error);
    await expect(replacement).resolves.toBe(second);
    await expect(hermesGateway()).resolves.toBe(second);
    expect(mocks.tsImport).toHaveBeenCalledTimes(2);
  });
});
