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
  let props: React.ComponentProps<typeof AgentBuilderWorkspace> = {
    rail: <div data-testid="rail" />,
    workspaceShellRef: { current: null },
    workspaceView: 'worldview',
    surfaceName: 'WorldView',
    chatPanelWidth: 420,
    chatMinWidth: 280,
    chat: <div data-testid="main-chat" />,
    splitterActive: false,
    onSplitterPointerEnter: vi.fn(),
    onSplitterPointerLeave: vi.fn(),
    onSplitterPointerDown: vi.fn(),
    companionMinWidth: 720,
    companionContentMinWidth: 720,
    companionOverlayWidth: 150,
    companionViewportWidth: 720,
    companionVisibleWidth: 570,
    canvas: <div data-testid="canvas" />,
    companion: <div data-testid="worldview" />,
    drawer: <div data-testid="drawer" />,
    ...overrides,
  };
  const commit = () => act(() => root?.render(<AgentBuilderWorkspace {...props} />));
  commit();
  return {
    host: container,
    get props() { return props; },
    rerender(next: Partial<React.ComponentProps<typeof AgentBuilderWorkspace>>) {
      props = { ...props, ...next };
      commit();
    },
  };
}

describe('AgentBuilderWorkspace shared hybrid companion layout', () => {
  it('keeps WorldView mounted at its minimum while continuously sized Main covers it', () => {
    const { host } = renderWorkspace({
      chatPanelWidth: 990,
      companionVisibleWidth: 0,
      companionViewportWidth: 720,
      companionOverlayWidth: 720,
    });
    const main = host.querySelector('[data-testid="workspace-large-region"]') as HTMLElement;
    const worldview = host.querySelector('[data-testid="worldview"]');
    const clip = host.querySelector('[data-testid="workspace-companion-clip"]') as HTMLElement;
    const content = host.querySelector('[data-testid="workspace-companion-content"]') as HTMLElement;

    expect(worldview).not.toBeNull();
    expect(main.dataset.mainOverCompanion).toBe('true');
    expect(main.style.width).toBe('990px');
    expect(main.style.zIndex).toBe('2');
    expect(clip.dataset.companionVisibleViewport).toBe('true');
    expect(clip.dataset.companionVisibleWidth).toBe('0');
    expect(content.style.width).toBe('720px');
  });

  it('uses only the existing unlabeled pointer-captured drag boundary', () => {
    const onPointerDown = vi.fn();
    const { host } = renderWorkspace({ onSplitterPointerDown: onPointerDown });
    const handle = host.querySelector('[data-testid="workspace-chat-resize-handle"]') as HTMLDivElement;

    expect(handle.textContent).toBe('');
    expect(handle.style.touchAction).toBe('none');
    act(() => handle.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })));
    expect(onPointerDown).toHaveBeenCalledOnce();
  });

  it('keeps one Canvas instance mounted while its true adjacent pane shrinks', () => {
    let mounts = 0;
    let unmounts = 0;
    function CanvasProbe() {
      React.useEffect(() => {
        mounts += 1;
        return () => { unmounts += 1; };
      }, []);
      return <div data-testid="canvas-probe" />;
    }
    const view = renderWorkspace({
      workspaceView: 'canvas',
      companion: null,
      canvas: <CanvasProbe />,
      companionMinWidth: 520,
      companionContentMinWidth: 520,
      companionVisibleWidth: 770,
      companionViewportWidth: 770,
      companionOverlayWidth: 0,
    });
    const initialContent = view.host.querySelector(
      '[data-testid="workspace-companion-content"]',
    ) as HTMLElement;
    expect(initialContent.style.width).toBe('770px');
    expect(mounts).toBe(1);

    view.rerender({
      chatPanelWidth: 800,
      companionVisibleWidth: 390,
      companionViewportWidth: 520,
      companionOverlayWidth: 0,
    });
    const content = view.host.querySelector(
      '[data-testid="workspace-companion-content"]',
    ) as HTMLElement;
    expect(content.style.width).toBe('520px');
    expect(content.style.minWidth).toBe('520px');
    expect(view.host.querySelector('[data-testid="canvas-probe"]')).not.toBeNull();
    expect(mounts).toBe(1);
    expect(unmounts).toBe(0);
  });

  it('allows Canvas underplane overlap only at the extreme collision floor', () => {
    const { host } = renderWorkspace({
      workspaceView: 'canvas',
      companionMinWidth: 520,
      companionContentMinWidth: 520,
      companionVisibleWidth: 50,
      companionViewportWidth: 520,
      companionOverlayWidth: 46,
    });
    const main = host.querySelector('[data-testid="workspace-large-region"]') as HTMLElement;
    const content = host.querySelector('[data-testid="workspace-companion-content"]') as HTMLElement;
    expect(main.dataset.mainOverCompanion).toBe('true');
    expect(content.style.width).toBe('520px');
    expect(content.style.minWidth).toBe('520px');
  });

  it.each([
    ['canvas', 520],
    ['knowledge', 520],
    ['trading', 520],
    ['worldview', 720],
  ])('renders the %s companion with its surface-specific floor', (workspaceView, minimum) => {
    const { host } = renderWorkspace({
      workspaceView,
      companionMinWidth: minimum,
      companionContentMinWidth: minimum,
      companionViewportWidth: minimum,
      companionVisibleWidth: 300,
      companionOverlayWidth: minimum - 300,
    });
    const clip = host.querySelector('[data-testid="workspace-companion-clip"]') as HTMLElement;
    const content = host.querySelector('[data-testid="workspace-companion-content"]') as HTMLElement;
    expect(clip.dataset.companionMinWidth).toBe(String(minimum));
    expect(content.style.minWidth).toBe(`${minimum}px`);
  });
});
