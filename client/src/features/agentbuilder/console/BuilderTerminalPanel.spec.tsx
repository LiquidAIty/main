// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import BuilderTerminalPanel from './BuilderTerminalPanel';
import HarnessChatPanel from './HarnessChatPanel';
import type {
  BuilderTerminalClient,
  ConsoleSessionInfo,
} from './builderTerminalClient';

const xtermProps = vi.hoisted(() => ({
  current: null as Record<string, any> | null,
  fail: false,
}));

vi.mock('./XtermView', async () => {
  const react = await import('react');
  return {
    default: (props: Record<string, any>) => {
      if (xtermProps.fail) throw new Error('xterm_render_failed');
      xtermProps.current = props;
      return react.createElement(
        'div',
        { 'data-testid': 'builder-terminal-xterm' },
        props.launchError || '',
      );
    },
  };
});

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function session(state: ConsoleSessionInfo['state'] = 'running'): ConsoleSessionInfo {
  return {
    id: 'builder-terminal-1',
    ownerCardId: 'builder',
    projectId: 'project-1',
    deckId: 'deck_builder',
    conversationId: 'main',
    targetRoot: 'C:/Projects/LiquidAIty/main',
    mode: 'interactive',
    state,
    runtimeSource: 'repository_hermes_cli',
    transportMode: 'pty',
    profile: 'builder',
    executable: 'C:/Projects/LiquidAIty/main/Hermes/venv/Scripts/hermes.exe',
    hermesHome: 'C:/Projects/LiquidAIty/main/Hermes/.hermes',
    interactiveSupported: true,
    pid: 42,
    startedAt: 'now',
    updatedAt: 'now',
    stoppedAt: null,
    warnings: [],
    error: null,
  };
}

function client(overrides: Partial<BuilderTerminalClient> = {}): BuilderTerminalClient {
  return {
    listSessions: vi.fn(async () => []),
    getSession: vi.fn(async () => null),
    streamOutput: vi.fn(async () => undefined),
    sendInput: vi.fn(async () => true),
    resize: vi.fn(async () => true),
    ...overrides,
  };
}

let host: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  xtermProps.current = null;
  xtermProps.fail = false;
});

async function render(element: React.ReactNode) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root?.render(element));
}

describe('BuilderTerminalPanel', () => {
  it('reattaches a stopped pane only to an already-running session with the same saved identity', async () => {
    const stopped = { ...session(), state: 'stopped' as const, pid: null };
    const replacement = { ...session(), id: 'replacement-session' };
    const terminalClient = client({
      getSession: vi.fn(async () => stopped),
      listSessions: vi.fn(async () => [
        { ...replacement, id: 'wrong-profile', profile: 'different-profile' },
        { ...replacement, id: 'wrong-card', ownerCardId: 'different-card' },
        { ...replacement, id: 'wrong-project', projectId: 'different-project' },
        replacement,
      ]),
      ensureSession: vi.fn(),
    });
    await render(<BuilderTerminalPanel open client={terminalClient} initialSession={stopped} />);
    expect(host!.querySelector('[data-testid="builder-terminal-panel"]')?.getAttribute('data-session-id'))
      .toBe(replacement.id);
    expect(xtermProps.current?.interactive).toBe(true);
    await act(async () => { await xtermProps.current?.onData('input'); });
    expect(terminalClient.sendInput).toHaveBeenCalledExactlyOnceWith(replacement.id, 'input');
    expect(terminalClient.ensureSession).not.toHaveBeenCalled();
  });

  it('keeps the saved Builder session through pull-up and gives input only to direct mode', async () => {
    const savedCard = { projectId: 'project-1', deckId: 'deck_builder', cardId: 'saved-builder',
      profile: 'builder' };
    const nativeSession = { ...session(), ownerCardId: savedCard.cardId, profile: savedCard.profile };
    const terminalClient = client({ ensureSession: vi.fn(async () => nativeSession) });
    await render(<HarnessChatPanel chat={<div data-testid="main-input">Main</div>}
      terminal={({ directInput }) => <BuilderTerminalPanel open ownerCardId={savedCard.cardId}
        savedCard={savedCard} client={terminalClient} readOnly={!directInput} />} />);
    expect(terminalClient.ensureSession).toHaveBeenCalledOnce();
    expect(terminalClient.listSessions).not.toHaveBeenCalled();
    expect(xtermProps.current?.interactive).toBe(false);
    await act(async () => { await xtermProps.current?.onData('blocked'); });
    expect(terminalClient.sendInput).not.toHaveBeenCalled();
    const panel = host!.querySelector('[data-testid="builder-terminal-panel"]');
    expect(panel?.getAttribute('data-session-id')).toBe(nativeSession.id);
    const divider = host!.querySelector('[data-testid="main-chat-agent-builder-divider"]') as HTMLButtonElement;
    const surface = host!.querySelector('[data-testid="main-work-surface"]') as HTMLDivElement;
    surface.getBoundingClientRect = () => ({ height: 600 } as DOMRect);
    await act(async () => divider.click());
    expect(host!.querySelector('[data-testid="main-input"]')).toBeNull();
    expect(xtermProps.current?.interactive).toBe(true);
    await act(async () => { await xtermProps.current?.onData('native input'); });
    expect(terminalClient.sendInput).toHaveBeenCalledExactlyOnceWith(nativeSession.id, 'native input');
    await act(async () => divider.click());
    expect(host!.querySelector('[data-testid="main-input"]')).not.toBeNull();
    expect(host!.querySelector('[data-testid="builder-terminal-panel"]')).toBe(panel);
    expect(xtermProps.current?.interactive).toBe(false);
    expect(terminalClient.ensureSession).toHaveBeenCalledOnce();
  });

  it('shows an error when the acquired terminal belongs to another profile', async () => {
    const savedCard = { projectId: 'project-1', deckId: 'deck_builder', cardId: 'saved-builder',
      profile: 'builder' };
    await render(<BuilderTerminalPanel open ownerCardId={savedCard.cardId} savedCard={savedCard}
      client={client({ ensureSession: vi.fn(async () => ({ ...session(), ownerCardId: savedCard.cardId, profile: 'foreign' })) })} />);
    expect(host!.querySelector('[role="alert"]')?.textContent).toBe('Terminal connection failed.');
    expect(xtermProps.current).toBeNull();
  });

  it('attaches only to the startup-owned terminal without lifecycle controls', async () => {
    const terminalClient = client({ listSessions: vi.fn(async () => [session()]) });
    await render(
      <BuilderTerminalPanel
        open
        client={terminalClient}
      />,
    );
    await act(async () => Promise.resolve());
    expect(terminalClient.listSessions).toHaveBeenCalledOnce();
    expect(host?.querySelector('[data-testid="builder-terminal-status"]')).toBeNull();
    expect(host?.querySelector('[data-testid="builder-terminal-xterm"]')).not.toBeNull();
    expect(host?.querySelector('[data-testid="builder-terminal-start"]')).toBeNull();
    expect(host?.querySelector('[data-testid="builder-terminal-stop"]')).toBeNull();
  });

  it('reports a missing startup-owned terminal without trying to create one from the UI', async () => {
    const terminalClient = client();
    await render(<BuilderTerminalPanel open client={terminalClient} />);
    await act(async () => Promise.resolve());
    expect(terminalClient.listSessions).toHaveBeenCalledOnce();
    expect(host!.querySelector('[role="alert"]')?.textContent).toBe('Terminal connection failed.');
    expect(host?.querySelector('[data-testid="builder-terminal-start"]')).toBeNull();
    expect(host?.querySelector('[data-testid="builder-terminal-stop"]')).toBeNull();
  });

  it('reattaches to the same already-live repository Hermes process without replay', async () => {
    const live = session();
    const terminalClient = client({ listSessions: vi.fn(async () => [live]) });
    await render(
      <BuilderTerminalPanel
        open
        client={terminalClient}
      />,
    );
    await act(async () => Promise.resolve());
    expect(terminalClient.listSessions).toHaveBeenCalledOnce();
    expect(host?.querySelector('[data-testid="builder-terminal-process"]')).toBeNull();
    expect(host?.querySelector('[data-testid="builder-terminal-stop"]')).toBeNull();
  });

  it('does not expose the removed shell, root, transport, or transcript controls', async () => {
    await render(
      <BuilderTerminalPanel
        open
        client={client()}
        initialSession={session()}
      />,
    );
    expect(host?.textContent).not.toContain('Ready');
    expect(host?.textContent).not.toContain('Local process');
    expect(host?.textContent).not.toContain('transport:');
    expect(host?.textContent).not.toContain('root:');
    expect(host?.querySelector('[data-testid="builder-terminal-start"]')).toBeNull();
    expect(host?.querySelector('[data-testid="builder-terminal-transcript"]')).toBeNull();
    expect(host?.querySelector('[data-testid="builder-terminal-input"]')).toBeNull();
    expect(host?.textContent).not.toContain('Hermes/venv/Scripts/hermes.exe');
    expect(host?.textContent).not.toContain('PID 42');
  });

  it('never exposes Start or Stop while the real Hermes process is active', async () => {
    await render(
      <BuilderTerminalPanel open client={client()} initialSession={session('running')} />,
    );
    expect(host?.querySelector('[data-testid="builder-terminal-stop"]')).toBeNull();
    expect(host?.querySelector('[data-testid="builder-terminal-start"]')).toBeNull();
  });

  it('coalesces valid live resizes and never resizes a stopped session', async () => {
    const resize = vi.fn(async () => true);
    const terminalClient = client({ resize });
    await render(
      <BuilderTerminalPanel open client={terminalClient} initialSession={session('running')} />,
    );
    await act(async () => {
      await xtermProps.current?.onResize?.(120, 30);
      await xtermProps.current?.onResize?.(120, 30);
    });
    expect(resize).toHaveBeenCalledOnce();
    expect(resize).toHaveBeenCalledWith('builder-terminal-1', 120, 30);

    await act(async () => root?.render(
      <BuilderTerminalPanel key="stopped" open client={terminalClient} initialSession={session('stopped')} />,
    ));
    expect(xtermProps.current?.onResize).toBeUndefined();
  });

  it('does not turn a stopped or failed native session into a user lifecycle control', async () => {
    await render(
      <BuilderTerminalPanel open client={client()} initialSession={session('stopped')} />,
    );
    expect(host?.querySelector('[data-testid="builder-terminal-start"]')).toBeNull();
    expect(host?.querySelector('[data-testid="builder-terminal-stop"]')).toBeNull();
  });

  it('renders the exact native failure in xterm without lifecycle controls', async () => {
    const failed = session('failed');
    failed.error = 'hermes_acp_rpc_error:native_startup_failed';
    await render(
      <BuilderTerminalPanel
        open
        client={client()}
        initialSession={failed}
      />,
    );
    await act(async () => Promise.resolve());
    expect(host?.querySelector('[data-testid="builder-terminal-xterm"]')?.textContent).toBe(
      'hermes_acp_rpc_error:native_startup_failed',
    );
    expect(host?.textContent).not.toContain('console_start_failed_502');
    expect(host?.querySelector('[data-testid="builder-terminal-error"]')).toBeNull();
    expect(host?.querySelector('[data-testid="builder-terminal-start"]')).toBeNull();
    expect(host?.querySelector('[data-testid="builder-terminal-stop"]')).toBeNull();
  });

  it('shows a truthful unavailable state when the terminal surface itself fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    xtermProps.fail = true;
    await render(<BuilderTerminalPanel open client={client()} initialSession={session()} />);
    expect(host?.querySelector('[data-testid="builder-terminal-unavailable"]')?.textContent).toBe(
      'builder_terminal_surface_unavailable',
    );
    consoleError.mockRestore();
  });
});
