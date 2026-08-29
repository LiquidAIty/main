// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import HarnessChatPanel, { type MainDriverSource } from './HarnessChatPanel';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
afterEach(() => {
  container?.remove();
  container = null;
});

async function render(activeDriver: MainDriverSource | null = null) {
  container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <HarnessChatPanel
        activeDriver={activeDriver === 'native_cli' ? null : activeDriver}
        chat={<div data-testid="main-chat">Main Chat</div>}
        terminal={<div data-testid="main-cli-instance">Main CLI</div>}
      />,
    );
  });
  return container;
}

describe('Main Chat and CLI work surface', () => {
  it('starts split with a useful CLI strip and keeps the CLI mounted', async () => {
    const host = await render();
    expect(host.querySelector('[data-testid="main-chat"]')).not.toBeNull();
    const handle = host.querySelector('[data-testid="main-chat-cli-divider"]') as HTMLButtonElement;
    expect(handle.getAttribute('aria-expanded')).toBe('false');
    const region = host.querySelector('[data-testid="main-cli-region"]') as HTMLDivElement;
    expect(region.style.height).toBe('240px');
    expect(region.getAttribute('aria-hidden')).toBe('false');
    expect(host.querySelector('[data-testid="main-cli-instance"]')).not.toBeNull();
  });

  it('toggles full CLI and restores the split without remounting the CLI', async () => {
    const host = await render();
    const handle = host.querySelector('[data-testid="main-chat-cli-divider"]') as HTMLButtonElement;
    const terminal = host.querySelector('[data-testid="main-cli-instance"]');
    await act(async () => {
      handle.click();
    });
    expect(handle.getAttribute('aria-expanded')).toBe('true');
    expect(host.querySelector('[data-testid="main-work-surface"]')?.getAttribute('data-terminal-mode'))
      .toBe('expanded');
    expect(host.querySelector('[data-testid="main-chat"]')).toBeNull();
    await act(async () => {
      handle.click();
    });
    expect(handle.getAttribute('aria-expanded')).toBe('false');
    expect(host.querySelector('[data-testid="main-chat"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="main-cli-instance"]')).toBe(terminal);
  });

  it('can be pulled from collapsed through peek to fully expanded and back', async () => {
    const host = await render();
    const panel = host.querySelector('[data-testid="main-work-surface"]') as HTMLDivElement;
    panel.getBoundingClientRect = () => ({
      x: 0, y: 0, top: 0, left: 0, right: 800, bottom: 600,
      width: 800, height: 600, toJSON: () => ({}),
    });
    const handle = host.querySelector('[data-testid="main-chat-cli-divider"]') as HTMLButtonElement;
    const terminal = host.querySelector('[data-testid="main-cli-instance"]');

    await act(async () => {
      handle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientY: 590 }));
      window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientY: 0 }));
      window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    expect(panel.getAttribute('data-main-driver')).toBe('native_cli');
    expect(panel.getAttribute('data-terminal-mode')).toBe('expanded');
    expect((host.querySelector('[data-testid="main-cli-region"]') as HTMLDivElement).style.height)
      .toBe('auto');
    expect(host.querySelector('[data-testid="main-chat"]')).toBeNull();
    expect(host.querySelector('[data-testid="main-cli-instance"]')).toBe(terminal);

    await act(async () => {
      handle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientY: 0 }));
      window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientY: 595 }));
      window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    expect(panel.getAttribute('data-main-driver')).toBe('internal_chat');
    expect(panel.getAttribute('data-terminal-mode')).toBe('split');
    expect(host.querySelector('[data-testid="main-chat"]')).not.toBeNull();
    expect((host.querySelector('[data-testid="main-cli-region"]') as HTMLDivElement).style.height)
      .toBe('160px');
    expect(host.querySelector('[data-testid="main-cli-instance"]')).toBe(terminal);
  });

  it('forces full CLI for an external driver and shows only truthful provenance', async () => {
    const host = await render('external_plugin');
    expect(host.querySelector('[data-testid="main-chat"]')).toBeNull();
    expect(host.querySelector('[data-testid="main-work-surface"]')?.getAttribute('data-main-driver'))
      .toBe('external_plugin');
    expect(host.querySelector('[data-testid="main-driver-indicator"]')?.textContent)
      .toBe('External Chat driving Main');
    expect(host.querySelector('[data-testid="main-cli-instance"]')).not.toBeNull();
  });
});
