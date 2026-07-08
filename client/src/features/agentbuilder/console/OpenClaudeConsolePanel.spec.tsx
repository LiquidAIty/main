// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import OpenClaudeConsolePanel from './OpenClaudeConsolePanel';
import type {
  ConsoleSessionInfo,
  OpenClaudeConsoleClient,
} from './openClaudeConsoleClient';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function runningSession(): ConsoleSessionInfo {
  return {
    id: 'occ_99',
    targetRoot: 'C:/Projects/main',
    mode: 'interactive',
    state: 'running',
    commandPath: 'node localcoder/bin/openclaude',
    runtimeSource: 'vendored_built',
    transportMode: 'pty',
    provider: 'openai',
    model: 'gpt-5.3-codex',
    interactiveSupported: true,
    pid: 4321,
    startedAt: '2026-06-13T00:00:00.000Z',
    exitedAt: null,
    exitCode: null,
    exitSignal: null,
    warnings: [],
    error: null,
  };
}

function fakeClient(overrides: Partial<OpenClaudeConsoleClient> = {}): OpenClaudeConsoleClient {
  return {
    startSession: vi.fn(async () => ({ ok: true, session: runningSession() })),
    getSession: vi.fn(async () => null),
    getCodingRun: vi.fn(async () => null),
    sendInput: vi.fn(async () => true),
    resizeSession: vi.fn(async () => true),
    stopSession: vi.fn(async () => true),
    streamUrl: (id: string) => `/api/coder/openclaude/console/sessions/${id}/stream`,
    ...overrides,
  };
}

let container: HTMLDivElement | null = null;
afterEach(() => {
  if (container) {
    container.remove();
    container = null;
  }
});

async function render(node: React.ReactElement) {
  container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(node);
  });
  return container;
}

describe('OpenClaudeConsolePanel', () => {
  it('renders nothing when closed', async () => {
    const host = await render(
      <OpenClaudeConsolePanel open={false} targetRoot="C:/Projects/main" client={fakeClient()} />,
    );
    expect(host.querySelector('[data-testid="openclaude-console-panel"]')).toBeNull();
  });

  it('opens without crashing and shows the target root and idle state', async () => {
    const host = await render(
      <OpenClaudeConsolePanel open targetRoot="C:/Projects/main" client={fakeClient()} />,
    );
    expect(host.querySelector('[data-testid="openclaude-console-panel"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="openclaude-console-target-root"]')?.textContent).toContain(
      'C:/Projects/main',
    );
    expect(host.querySelector('[data-testid="openclaude-console-status"]')?.textContent).toBe('Idle');
    expect(host.querySelector('[data-testid="openclaude-console-start"]')).not.toBeNull();
  });

  it('starts a session through the client and shows its id and running state', async () => {
    const client = fakeClient();
    const host = await render(
      <OpenClaudeConsolePanel open targetRoot="C:/Projects/main" client={client} />,
    );
    const start = host.querySelector('[data-testid="openclaude-console-start"]') as HTMLButtonElement;
    await act(async () => {
      start.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(client.startSession).toHaveBeenCalledWith(
      expect.objectContaining({ targetRoot: 'C:/Projects/main', mode: 'interactive' }),
    );
    expect(host.querySelector('[data-testid="openclaude-console-session-id"]')?.textContent).toContain(
      'occ_99',
    );
    expect(host.querySelector('[data-testid="openclaude-console-status"]')?.textContent).toBe('Running');
  });

  it('starts with the Local Coder controller provider and model when supplied', async () => {
    const client = fakeClient();
    const host = await render(
      <OpenClaudeConsolePanel
        open
        targetRoot="C:/Projects/main"
        provider="openai"
        model="gpt-5.1-chat-latest"
        client={client}
      />,
    );
    const start = host.querySelector('[data-testid="openclaude-console-start"]') as HTMLButtonElement;
    await act(async () => {
      start.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(client.startSession).toHaveBeenCalledWith(
      expect.objectContaining({
        targetRoot: 'C:/Projects/main',
        mode: 'interactive',
        provider: 'openai',
        model: 'gpt-5.1-chat-latest',
      }),
    );
  });

  it('shows an existing session transcript and running state', async () => {
    const host = await render(
      <OpenClaudeConsolePanel
        open
        targetRoot="C:/Projects/main"
        client={fakeClient()}
        initialSession={runningSession()}
        initialTranscript={[{ seq: 1, stream: 'stdout', data: 'openclaude help', at: 'x' }]}
      />,
    );
    expect(host.querySelector('[data-testid="openclaude-console-transcript"]')?.textContent).toContain(
      'openclaude help',
    );
    expect(host.querySelector('[data-testid="openclaude-console-input"]')).not.toBeNull();
  });

  it('shows the active transport mode and mounts the xterm terminal for a running session', async () => {
    const host = await render(
      <OpenClaudeConsolePanel
        open
        targetRoot="C:/Projects/main"
        client={fakeClient()}
        initialSession={runningSession()}
        initialTranscript={[{ seq: 1, stream: 'stdout', data: 'hello', at: 'x' }]}
      />,
    );
    expect(host.querySelector('[data-testid="openclaude-console-transport"]')?.textContent).toContain(
      'pty',
    );
    // XtermView container renders even though xterm itself no-ops in jsdom.
    expect(host.querySelector('[data-testid="openclaude-xterm"]')).not.toBeNull();
  });

  it('titles the panel "Code Console" with no internal branding in chrome', async () => {
    const host = await render(
      <OpenClaudeConsolePanel open targetRoot="C:/Projects/main" client={fakeClient()} />,
    );
    expect(host.textContent).toContain('Code Console');
    // Idle chrome (no raw terminal transcript) must be free of internal names.
    expect(/OpenClaude|LocalCoder|Local Coder|Claude/i.test(host.textContent || '')).toBe(false);
  });

  it('keeps the running-state chrome free of internal branding', async () => {
    const host = await render(
      <OpenClaudeConsolePanel
        open
        targetRoot="C:/Projects/main"
        client={fakeClient()}
        initialSession={runningSession()}
        initialTranscript={[{ seq: 1, stream: 'stdout', data: 'compiled ok', at: 'x' }]}
      />,
    );
    expect(/OpenClaude|LocalCoder|Local Coder|Claude/i.test(host.textContent || '')).toBe(false);
  });

  it('preserves raw CLI branding in the transcript by default (developer mode)', async () => {
    const host = await render(
      <OpenClaudeConsolePanel
        open
        targetRoot="C:/Projects/main"
        client={fakeClient()}
        initialSession={runningSession()}
        initialTranscript={[{ seq: 1, stream: 'stdout', data: 'Welcome to OpenClaude', at: 'x' }]}
      />,
    );
    const transcript = host.querySelector('[data-testid="openclaude-console-transcript"]');
    expect(transcript?.textContent).toContain('OpenClaude');
  });

  it('redacts CLI branding in the transcript when redactBranding is on, and marks it', async () => {
    const host = await render(
      <OpenClaudeConsolePanel
        open
        targetRoot="C:/Projects/main"
        client={fakeClient()}
        redactBranding
        initialSession={runningSession()}
        initialTranscript={[{ seq: 1, stream: 'stdout', data: 'Welcome to OpenClaude', at: 'x' }]}
      />,
    );
    const transcript = host.querySelector('[data-testid="openclaude-console-transcript"]');
    expect(transcript?.textContent).not.toContain('OpenClaude');
    // Runtime display name renamed 'Coder Engine' → 'Harness' in eb992070.
    expect(transcript?.textContent).toContain('Harness');
    expect(host.querySelector('[data-testid="openclaude-console-redacted-note"]')).not.toBeNull();
  });

  it('surfaces a blocked start without faking a session', async () => {
    const client = fakeClient({
      startSession: vi.fn(async () => ({
        ok: false,
        error: 'console_runtime_unavailable',
        missing: ['localcoder_entrypoint_missing'],
      })),
    });
    const host = await render(
      <OpenClaudeConsolePanel open targetRoot="C:/Projects/main" client={client} />,
    );
    const start = host.querySelector('[data-testid="openclaude-console-start"]') as HTMLButtonElement;
    await act(async () => {
      start.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(host.querySelector('[data-testid="openclaude-console-error"]')?.textContent).toContain(
      'localcoder_entrypoint_missing',
    );
    expect(host.querySelector('[data-testid="openclaude-console-session-id"]')?.textContent).toContain('—');
  });
});
