// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OpenClaudeConsoleClient } from '../../features/agentbuilder/console/openClaudeConsoleClient';

import HermesConsole from './HermesConsole';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const containers: HTMLElement[] = [];

async function render(node: React.ReactElement): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  containers.push(container);
  const root = createRoot(container);
  await act(async () => root.render(node));
  return container;
}

afterEach(() => {
  for (const container of containers.splice(0)) container.remove();
});

describe('Hermes native child terminal', () => {
  it('owns the separate Hermes session route and reports unavailable runtime honestly', async () => {
    const client: OpenClaudeConsoleClient = {
      startSession: vi.fn(async () => ({
        ok: false as const,
        error: 'hermes_runtime_unavailable',
        missing: ['hermes_cli_entrypoint_missing'],
      })),
      listSessions: vi.fn(async () => []),
      getSession: vi.fn(async () => null),
      sendInput: vi.fn(async () => true),
      resizeSession: vi.fn(async () => true),
      stopSession: vi.fn(async () => true),
      streamUrl: (id) => `/api/coder/hermes/console/sessions/${id}/stream`,
    };
    const host = await render(
      <HermesConsole open targetRoot="C:/Projects/main" projectId="project-1" client={client} />,
    );
    expect(host.textContent).toContain('Hermes Terminal');
    expect(host.textContent).not.toContain('Hermes is ready beneath Main Chat.');
    const start = host.querySelector('[data-testid="hermes-console-start"]') as HTMLButtonElement;
    await act(async () => start.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(client.startSession).toHaveBeenCalledWith(
      expect.objectContaining({ targetRoot: 'C:/Projects/main', mode: 'interactive' }),
    );
    expect(host.querySelector('[data-testid="hermes-console-error"]')?.textContent).toContain(
      'hermes_cli_entrypoint_missing',
    );
    expect(host.querySelector('[data-testid="hermes-console-session-id"]')?.textContent).toContain('—');
  });

  it('shows a configured Hermes runtime with no live session as stopped', async () => {
    const client: OpenClaudeConsoleClient = {
      startSession: vi.fn(),
      listSessions: vi.fn(async () => []),
      getSession: vi.fn(async () => null),
      sendInput: vi.fn(async () => true),
      resizeSession: vi.fn(async () => true),
      stopSession: vi.fn(async () => true),
      streamUrl: (id) => `/api/coder/hermes/console/sessions/${id}/stream`,
    };
    const host = await render(
      <HermesConsole open targetRoot="C:/Projects/main" projectId="project-1" client={client} />,
    );
    await act(async () => Promise.resolve());
    expect(host.querySelector('[data-testid="hermes-console-status"]')?.textContent).toBe('Stopped');
    expect(client.startSession).not.toHaveBeenCalled();
  });

  it('attaches the newest live hms session without starting another runtime', async () => {
    const session = {
      id: 'hms_live_1',
      targetRoot: 'C:/Projects/main',
      mode: 'interactive' as const,
      state: 'running' as const,
      commandPath: 'hermes.exe chat --cli',
      runtimeSource: 'hermes_installed',
      transportMode: 'pty' as const,
      provider: null,
      model: null,
      interactiveSupported: true,
      pid: 4321,
      startedAt: '2026-07-21T12:00:00.000Z',
      exitedAt: null,
      exitCode: null,
      exitSignal: null,
      warnings: [],
      error: null,
    };
    const client: OpenClaudeConsoleClient = {
      startSession: vi.fn(),
      listSessions: vi.fn(async () => [session]),
      getSession: vi.fn(async () => ({
        session,
        transcript: [{ seq: 1, stream: 'stdout' as const, data: 'Hermes ready', at: 'now' }],
      })),
      sendInput: vi.fn(async () => true),
      resizeSession: vi.fn(async () => true),
      stopSession: vi.fn(async () => true),
      streamUrl: (id) => `/api/coder/hermes/console/sessions/${id}/stream`,
    };
    const host = await render(
      <HermesConsole open targetRoot="C:/Projects/main" projectId="project-1" client={client} />,
    );
    await act(async () => Promise.resolve());
    expect(host.querySelector('[data-testid="hermes-console-session-id"]')?.textContent).toContain(
      'hms_live_1',
    );
    expect(host.querySelector('[data-testid="hermes-console-status"]')?.textContent).toBe('Running');
    expect(host.querySelector('[data-testid="hermes-console-transcript"]')?.textContent).toContain(
      'Hermes ready',
    );
    expect(client.startSession).not.toHaveBeenCalled();
  });

  it('reports a failed Hermes session-status boundary as disconnected', async () => {
    const client: OpenClaudeConsoleClient = {
      startSession: vi.fn(),
      listSessions: vi.fn(async () => { throw new Error('offline'); }),
      getSession: vi.fn(async () => null),
      sendInput: vi.fn(async () => true),
      resizeSession: vi.fn(async () => true),
      stopSession: vi.fn(async () => true),
      streamUrl: (id) => `/api/coder/hermes/console/sessions/${id}/stream`,
    };
    const host = await render(
      <HermesConsole open targetRoot="C:/Projects/main" projectId="project-1" client={client} />,
    );
    await act(async () => Promise.resolve());
    expect(host.querySelector('[data-testid="hermes-console-status"]')?.textContent).toBe(
      'Disconnected',
    );
  });
});
