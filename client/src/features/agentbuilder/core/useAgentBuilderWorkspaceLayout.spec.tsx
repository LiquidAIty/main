// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { describe, expect, it, vi } from 'vitest';
import useAgentBuilderWorkspaceLayout, {
  KNOWLEDGE_TAB_STRIP_SAFE_WIDTH,
  companionMinimumWidth,
  resolveHybridWorkspaceGeometry,
  shouldCloseCanvasInspector,
  workspaceCollisionWidth,
} from './useAgentBuilderWorkspaceLayout';

function attachShell(
  layout: ReturnType<typeof useAgentBuilderWorkspaceLayout<string>>,
  width: number,
) {
  const shell = document.createElement('div');
  Object.defineProperty(shell, 'clientWidth', { configurable: true, value: width });
  layout.workspaceShellRef.current = shell;
  window.dispatchEvent(new Event('resize'));
  return shell;
}

function pointerEvent(type: string, clientX: number, pointerId = 7) {
  const event = new MouseEvent(type, { bubbles: true, clientX });
  Object.defineProperty(event, 'pointerId', { configurable: true, value: pointerId });
  return event;
}

function beginDrag(
  layout: ReturnType<typeof useAgentBuilderWorkspaceLayout<string>>,
  clientX: number,
) {
  const target = document.createElement('div');
  target.setPointerCapture = vi.fn();
  target.hasPointerCapture = vi.fn(() => true);
  target.releasePointerCapture = vi.fn();
  layout.handleSplitterPointerDown({
    button: 0,
    clientX,
    pointerId: 7,
    currentTarget: target,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  } as unknown as ReactPointerEvent<HTMLDivElement>);
  return target;
}

describe('useAgentBuilderWorkspaceLayout shared hybrid geometry', () => {
  it('resizes the companion until its minimum and then converts the remainder to overlap', () => {
    expect(resolveHybridWorkspaceGeometry({
      workspaceWidth: 1200,
      mainWidth: 420,
      companionMinWidth: 520,
    })).toEqual({
      companionVisibleWidth: 770,
      companionViewportWidth: 770,
      companionOverlayWidth: 0,
      companionContentMinWidth: 520,
    });
    expect(resolveHybridWorkspaceGeometry({
      workspaceWidth: 1000,
      mainWidth: 600,
      companionMinWidth: 520,
    })).toEqual({
      companionVisibleWidth: 390,
      companionViewportWidth: 520,
      companionOverlayWidth: 130,
      companionContentMinWidth: 520,
    });
  });

  it('keeps the graph adjacent through the CodeGraph edge and overlaps immediately after it', () => {
    expect(resolveHybridWorkspaceGeometry({
      workspaceWidth: 1000,
      mainWidth: 588,
      companionMinWidth: 520,
      collisionWidth: KNOWLEDGE_TAB_STRIP_SAFE_WIDTH,
    })).toEqual({
      companionVisibleWidth: 402,
      companionViewportWidth: 520,
      companionOverlayWidth: 0,
      companionContentMinWidth: 520,
    });
    expect(resolveHybridWorkspaceGeometry({
      workspaceWidth: 1000,
      mainWidth: 589,
      companionMinWidth: 520,
      collisionWidth: KNOWLEDGE_TAB_STRIP_SAFE_WIDTH,
    })).toEqual({
      companionVisibleWidth: 401,
      companionViewportWidth: 520,
      companionOverlayWidth: 0,
      companionContentMinWidth: 520,
    });
    expect(resolveHybridWorkspaceGeometry({
      workspaceWidth: 1000,
      mainWidth: 590,
      companionMinWidth: 520,
      collisionWidth: KNOWLEDGE_TAB_STRIP_SAFE_WIDTH,
    })).toEqual({
      companionVisibleWidth: 400,
      companionViewportWidth: 520,
      companionOverlayWidth: 1,
      companionContentMinWidth: 520,
    });
  });

  it('closes the open Canvas inspector before the chat reaches the overlap threshold', () => {
    expect(shouldCloseCanvasInspector({
      workspaceView: 'canvas', inspectorOpen: true, companionVisibleWidth: 865,
    })).toBe(false);
    expect(shouldCloseCanvasInspector({
      workspaceView: 'canvas', inspectorOpen: true, companionVisibleWidth: 864,
    })).toBe(true);
    expect(shouldCloseCanvasInspector({
      workspaceView: 'worldview', inspectorOpen: true, companionVisibleWidth: 0,
    })).toBe(false);
  });

  it('uses source-backed surface-specific minimums', () => {
    expect(companionMinimumWidth('canvas')).toBe(520);
    expect(companionMinimumWidth('knowledge')).toBe(520);
    expect(companionMinimumWidth('trading')).toBe(520);
    expect(companionMinimumWidth('worldsignal')).toBe(360);
    expect(companionMinimumWidth('worldview')).toBe(720);
  });

  it('applies the tab-strip threshold only to the knowledge graph workspace', () => {
    expect(workspaceCollisionWidth('knowledge', 520)).toBe(401);
    expect(workspaceCollisionWidth('canvas', 520)).toBe(520);
    expect(workspaceCollisionWidth('worldsignal', 360)).toBe(360);
    expect(workspaceCollisionWidth('worldview', 720)).toBe(720);
  });

  it('tracks exact continuous drag widths without switching workspace or snapping', () => {
    const { result } = renderHook(() => useAgentBuilderWorkspaceLayout({
      workspaceView: 'canvas',
    }));
    act(() => {
      attachShell(result.current, 1000);
      beginDrag(result.current, 420);
    });
    act(() => {
      window.dispatchEvent(pointerEvent('pointermove', 600));
      window.dispatchEvent(pointerEvent('pointerup', 600));
    });

    expect(result.current.chatPanelWidth).toBe(600);
    expect(result.current.companionVisibleWidth).toBe(390);
    expect(result.current.companionViewportWidth).toBe(520);
    expect(result.current.companionOverlayWidth).toBe(130);
    expect(result.current.companionContentMinWidth).toBe(520);
  });

  it('allows Main to cover WorldView while its 720px viewport stays mounted', () => {
    const { result } = renderHook(() => useAgentBuilderWorkspaceLayout({
      workspaceView: 'worldview',
    }));
    act(() => {
      attachShell(result.current, 1000);
      beginDrag(result.current, 420);
    });
    act(() => {
      window.dispatchEvent(pointerEvent('pointermove', 1400));
      window.dispatchEvent(pointerEvent('pointerup', 1400));
    });

    expect(result.current.chatPanelWidth).toBe(990);
    expect(result.current.companionVisibleWidth).toBe(0);
    expect(result.current.companionViewportWidth).toBe(720);
    expect(result.current.companionOverlayWidth).toBe(720);
    expect(result.current.companionContentMinWidth).toBe(720);
  });

  it('captures and releases the pointer, commits on blur, and cancels on Escape', () => {
    const { result } = renderHook(() => useAgentBuilderWorkspaceLayout({
      workspaceView: 'knowledge',
    }));
    let target: HTMLDivElement;
    act(() => {
      attachShell(result.current, 1100);
      target = beginDrag(result.current, 420);
    });
    expect(target!.setPointerCapture).toHaveBeenCalledWith(7);
    act(() => {
      window.dispatchEvent(pointerEvent('pointermove', 500));
      window.dispatchEvent(new Event('blur'));
    });
    expect(result.current.chatPanelWidth).toBe(500);
    expect(target!.releasePointerCapture).toHaveBeenCalledWith(7);

    act(() => { target = beginDrag(result.current, 500); });
    act(() => {
      window.dispatchEvent(pointerEvent('pointermove', 760));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(result.current.chatPanelWidth).toBe(500);
    expect(target!.releasePointerCapture).toHaveBeenCalledWith(7);
  });

  it('preserves intentional standard and WorldView widths independently', () => {
    const { result, rerender } = renderHook<
      ReturnType<typeof useAgentBuilderWorkspaceLayout<string>>,
      { workspaceView: 'canvas' | 'worldview' }
    >(
      ({ workspaceView }: { workspaceView: 'canvas' | 'worldview' }) => (
        useAgentBuilderWorkspaceLayout<string>({ workspaceView })
      ),
      { initialProps: { workspaceView: 'worldview' } },
    );
    act(() => {
      attachShell(result.current, 1200);
      beginDrag(result.current, 420);
    });
    act(() => {
      window.dispatchEvent(pointerEvent('pointermove', 700));
      window.dispatchEvent(pointerEvent('pointerup', 700));
    });
    expect(result.current.chatPanelWidth).toBe(700);

    rerender({ workspaceView: 'canvas' });
    expect(result.current.chatPanelWidth).toBe(420);
    rerender({ workspaceView: 'worldview' });
    expect(result.current.chatPanelWidth).toBe(700);
  });
});
