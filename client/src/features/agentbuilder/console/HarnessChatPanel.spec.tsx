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
});
