// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import HarnessChatPanel from './HarnessChatPanel';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
afterEach(() => {
  container?.remove();
  container = null;
});

async function render() {
  container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <HarnessChatPanel
        chat={<div data-testid="main-chat">Main Chat</div>}
        terminal={<div data-testid="openclaude-terminal-instance">OpenClaude Code</div>}
      />,
    );
  });
  return container;
}

describe('HarnessChatPanel OpenClaude dock', () => {
  it('keeps Main Chat usable while the terminal starts collapsed', async () => {
    const host = await render();
    expect(host.querySelector('[data-testid="main-chat"]')).not.toBeNull();
    const handle = host.querySelector('[data-testid="chat-openclaude-handle"]') as HTMLButtonElement;
    expect(handle.getAttribute('aria-expanded')).toBe('false');
    expect(host.querySelector('[data-testid="chat-hermes-region"]')).toBeNull();
  });

  it('slides up and down without unmounting the persistent terminal', async () => {
    const host = await render();
    const handle = host.querySelector('[data-testid="chat-openclaude-handle"]') as HTMLButtonElement;
    const terminal = host.querySelector('[data-testid="openclaude-terminal-instance"]');
    await act(async () => handle.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(handle.getAttribute('aria-expanded')).toBe('true');
    expect(host.querySelector('[data-testid="openclaude-terminal-instance"]')).toBe(terminal);
    await act(async () => handle.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(handle.getAttribute('aria-expanded')).toBe('false');
    expect(host.querySelector('[data-testid="openclaude-terminal-instance"]')).toBe(terminal);
  });

  it('makes ChatGPT the sole Main at full height and restores native Main when pulled down', async () => {
    const host = await render();
    const panel = host.querySelector('[data-testid="harness-chat-panel"]') as HTMLDivElement;
    panel.getBoundingClientRect = () => ({
      x: 0, y: 0, top: 0, left: 0, right: 800, bottom: 600,
      width: 800, height: 600, toJSON: () => ({}),
    });
    const handle = host.querySelector('[data-testid="chat-openclaude-handle"]') as HTMLButtonElement;
    const terminal = host.querySelector('[data-testid="openclaude-terminal-instance"]');

    await act(async () => {
      handle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientY: 590 }));
      window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientY: 0 }));
      window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    expect(panel.getAttribute('data-main-mode')).toBe('chatgpt');
    expect(host.querySelector('[data-testid="main-chat"]')).toBeNull();
    expect(host.querySelector('[data-testid="openclaude-terminal-instance"]')).toBe(terminal);

    await act(async () => {
      handle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientY: 0 }));
      window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientY: 595 }));
      window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    expect(panel.getAttribute('data-main-mode')).toBe('native');
    expect(host.querySelector('[data-testid="main-chat"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="openclaude-terminal-instance"]')).toBe(terminal);
  });
});
