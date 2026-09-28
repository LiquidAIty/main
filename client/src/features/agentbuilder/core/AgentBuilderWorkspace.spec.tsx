// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AgentBuilderWorkspace from './AgentBuilderWorkspace';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(() => {
  if (root) {
    act(() => root?.unmount());
    root = null;
  }
  container?.remove();
  container = null;
});

function renderWorkspace(overrides: Partial<React.ComponentProps<typeof AgentBuilderWorkspace>> = {}) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  const props: React.ComponentProps<typeof AgentBuilderWorkspace> = {
    rail: <div data-testid="rail" />,
    workspaceShellRef: { current: null },
    workspaceView: 'worldview',
    surfaceName: 'WorldView',
    chatPanelWidth: 420,
    chatMinWidth: 280,
    chat: <div data-testid="main-chat" />,
    splitterActive: false,
    onSplitterMouseEnter: vi.fn(),
    onSplitterMouseLeave: vi.fn(),
    onSplitterMouseDown: vi.fn(),
    canvasMinWidth: 520,
    canvas: <div data-testid="canvas" />,
    companion: <div data-testid="worldview" />,
    drawer: <div data-testid="drawer" />,
    ...overrides,
  };
  act(() => root?.render(<AgentBuilderWorkspace {...props} />));
  return { host: container, props };
}

describe('AgentBuilderWorkspace WorldView underlay', () => {
  it('keeps WorldView mounted while continuously sized Main covers it', () => {
    const { host } = renderWorkspace({ chatPanelWidth: 990 });
    const main = host.querySelector('[data-testid="workspace-large-region"]') as HTMLElement;
    const worldview = host.querySelector('[data-testid="worldview"]');
    const handle = host.querySelector('[data-testid="workspace-chat-resize-handle"]');

    expect(worldview).not.toBeNull();
    expect(main.dataset.worldviewMainOverlay).toBe('true');
    expect(main.style.width).toBe('990px');
    expect(main.style.zIndex).toBe('2');
    expect(handle?.tagName).toBe('DIV');
    expect(handle?.getAttribute('aria-label')).toBe('Resize chat panel');
  });

  it('uses only the existing unlabeled drag boundary', () => {
    const onMouseDown = vi.fn();
    const { host } = renderWorkspace({ onSplitterMouseDown: onMouseDown });
    const handle = host.querySelector('[data-testid="workspace-chat-resize-handle"]') as HTMLDivElement;

    expect(handle.textContent).toBe('');
    act(() => handle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
    expect(onMouseDown).toHaveBeenCalledOnce();
  });

  it('leaves the existing Canvas splitter presentation unchanged', () => {
    const { host } = renderWorkspace({ workspaceView: 'canvas' });
    const main = host.querySelector('[data-testid="workspace-large-region"]') as HTMLElement;
    const handle = host.querySelector('[data-testid="workspace-chat-resize-handle"]');

    expect(main.dataset.worldviewMainOverlay).toBeUndefined();
    expect(main.style.minWidth).toBe('280px');
    expect(handle?.tagName).toBe('DIV');
    expect(host.querySelector('[data-testid="canvas"]')).not.toBeNull();
  });
});
