// @vitest-environment jsdom

/**
 * Entity: Card Subsystems
 * Relationship: Verifies that subsystem readiness is scoped to the selected Card, superseded reads cannot leak across selections, and failures remain visible.
 */

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CardSubsystemAttachment } from '../../../types/agentgraph';
import CardSubsystemTab from './CardSubsystemTab';

function attachment(id: string): CardSubsystemAttachment {
  return {
    id,
    label: id,
    adapter: {
      kind: 'python',
      contractVersion: 'card-subsystem.v1',
      capabilities: ['readiness'],
    },
    cardTab: { enabled: true },
    configurationSchema: null,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => { resolve = settle; });
  return { promise, resolve };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('CardSubsystemTab readiness scope', () => {
  it('clears prior readiness when the selected Card has no endpoint', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      status: 'ready',
      version: 'one',
    }), { status: 200 })));
    const view = render(
      <CardSubsystemTab attachment={attachment('first')} readinessEndpoint="/first" />,
    );
    await screen.findByText('ready');

    view.rerender(
      <CardSubsystemTab attachment={attachment('second')} readinessEndpoint={null} />,
    );

    expect(screen.getByRole('status').textContent).toContain('not read');
    expect(screen.queryByText('ready')).toBeNull();
    expect(screen.getByText(/"version": null/)).toBeTruthy();
  });

  it('does not commit a superseded endpoint response', async () => {
    const first = deferred<Response>();
    const second = deferred<Response>();
    const fetcher = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    vi.stubGlobal('fetch', fetcher);
    const view = render(
      <CardSubsystemTab attachment={attachment('first')} readinessEndpoint="/first" />,
    );
    expect(screen.getByRole('status').textContent).toContain('loading');

    view.rerender(
      <CardSubsystemTab attachment={attachment('second')} readinessEndpoint="/second" />,
    );
    first.resolve(new Response(JSON.stringify({ status: 'wrong', version: 'old' }), {
      status: 200,
    }));
    second.resolve(new Response(JSON.stringify({ status: 'ready', version: 'new' }), {
      status: 200,
    }));

    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('ready'));
    expect(screen.queryByText('wrong')).toBeNull();
    expect(screen.getByText(/"version": "new"/)).toBeTruthy();
  });

  it('reports a scoped readiness failure accessibly', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      error: 'subsystem_offline',
    }), { status: 503 })));

    render(<CardSubsystemTab attachment={attachment('first')} readinessEndpoint="/first" />);

    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('unavailable'));
    expect(screen.getByRole('alert').textContent).toContain('subsystem_offline');
  });
});
