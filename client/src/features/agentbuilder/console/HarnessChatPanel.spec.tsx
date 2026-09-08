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
  window.localStorage.clear();
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
        terminal={<div data-testid="agent-builder-instance">Agent Builder</div>}
      />,
    );
  });
  const panel = container.querySelector('[data-testid="main-work-surface"]') as HTMLDivElement;
  panel.getBoundingClientRect = () => ({
    x: 0, y: 0, top: 0, left: 0, right: 800, bottom: 600,
    width: 800, height: 600, toJSON: () => ({}),
  });
  return container;
}

describe('Main Chat and Agent Builder work surface', () => {
  it('starts collapsed and keeps Agent Builder mounted until pulled open', async () => {
    const host = await render();
    expect(host.querySelector('[data-testid="main-chat"]')).not.toBeNull();
    const handle = host.querySelector('[data-testid="main-chat-agent-builder-divider"]') as HTMLButtonElement;
    expect(handle.getAttribute('aria-expanded')).toBe('false');
    const region = host.querySelector('[data-testid="agent-builder-region"]') as HTMLDivElement;
    expect(region.style.height).toBe('0px');
    expect(region.getAttribute('aria-hidden')).toBe('true');
    expect(host.querySelector('[data-testid="agent-builder-instance"]')).not.toBeNull();
  });

  it('opens and closes the split without remounting Main or Agent Builder', async () => {
    const host = await render();
    const handle = host.querySelector('[data-testid="main-chat-agent-builder-divider"]') as HTMLButtonElement;
    const terminal = host.querySelector('[data-testid="agent-builder-instance"]');
    const chat = host.querySelector('[data-testid="main-chat"]');
    await act(async () => {
      handle.click();
    });
    expect(handle.getAttribute('aria-expanded')).toBe('true');
    expect(host.querySelector('[data-testid="main-work-surface"]')?.getAttribute('data-terminal-mode'))
      .toBe('split');
    expect(host.querySelector('[data-testid="main-chat"]')).toBe(chat);
    await act(async () => {
      handle.click();
    });
    expect(handle.getAttribute('aria-expanded')).toBe('false');
    expect(host.querySelector('[data-testid="main-chat"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="agent-builder-instance"]')).toBe(terminal);
  });

  it('reserves room for Main even when the divider is pulled to the top', async () => {
    const host = await render();
    const panel = host.querySelector('[data-testid="main-work-surface"]') as HTMLDivElement;
    panel.getBoundingClientRect = () => ({
      x: 0, y: 0, top: 0, left: 0, right: 800, bottom: 600,
      width: 800, height: 600, toJSON: () => ({}),
    });
    const handle = host.querySelector('[data-testid="main-chat-agent-builder-divider"]') as HTMLButtonElement;
    const terminal = host.querySelector('[data-testid="agent-builder-instance"]');

    await act(async () => {
      handle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientY: 590 }));
      window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, buttons: 1, clientY: 0 }));
      window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    expect(panel.getAttribute('data-main-driver')).toBe('internal_chat');
    expect(panel.getAttribute('data-terminal-mode')).toBe('split');
    expect((host.querySelector('[data-testid="agent-builder-region"]') as HTMLDivElement).style.height)
      .toBe('408px');
    expect(host.querySelector('[data-testid="main-chat"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="agent-builder-instance"]')).toBe(terminal);

    await act(async () => {
      handle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientY: 0 }));
      window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, buttons: 1, clientY: 595 }));
      window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    expect(panel.getAttribute('data-main-driver')).toBe('internal_chat');
    expect(panel.getAttribute('data-terminal-mode')).toBe('collapsed');
    expect(host.querySelector('[data-testid="main-chat"]')).not.toBeNull();
    expect((host.querySelector('[data-testid="agent-builder-region"]') as HTMLDivElement).style.height)
      .toBe('0px');
    expect(host.querySelector('[data-testid="agent-builder-instance"]')).toBe(terminal);
  });

  it('never switches the lower reader into direct input when opened', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const modes: boolean[] = [];
    await act(async () => root.render(<HarnessChatPanel chat={<div>Main</div>}
      terminal={({ directInput }) => { modes.push(directInput); return <div>Output</div>; }} />));
    const panel = container.querySelector('[data-testid="main-work-surface"]') as HTMLDivElement;
    panel.getBoundingClientRect = () => ({ height: 600 } as DOMRect);
    await act(async () => (container!.querySelector('button') as HTMLButtonElement).click());
    expect(modes.length).toBeGreaterThan(1);
    expect(modes.every((mode) => mode === false)).toBe(true);
  });

  it('keeps Main visible for an external driver and shows truthful provenance', async () => {
    const host = await render('external_plugin');
    expect(host.querySelector('[data-testid="main-chat"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="main-work-surface"]')?.getAttribute('data-main-driver'))
      .toBe('external_plugin');
    expect(host.querySelector('[data-testid="main-driver-indicator"]')?.textContent)
      .toBe('External Chat driving Main');
    expect(host.querySelector('[data-testid="agent-builder-instance"]')).not.toBeNull();
  });
});
