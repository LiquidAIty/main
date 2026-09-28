// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { describe, expect, it, vi } from 'vitest';
import useAgentBuilderWorkspaceLayout from './useAgentBuilderWorkspaceLayout';

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

function beginDrag(
  layout: ReturnType<typeof useAgentBuilderWorkspaceLayout<string>>,
  clientX: number,
) {
  layout.handleSplitterMouseDown({
    clientX,
    preventDefault: vi.fn(),
  } as unknown as ReactMouseEvent<HTMLDivElement>);
}

describe('useAgentBuilderWorkspaceLayout WorldView coverage', () => {
  it('keeps the historical 420px opening width with no snap-state API', () => {
    const setWorkspaceView = vi.fn();
    const { result } = renderHook(() => useAgentBuilderWorkspaceLayout({
      setWorkspaceView,
      workspaceView: 'worldview',
    }));

    act(() => {
      attachShell(result.current, 1000);
    });

    expect(result.current.chatPanelWidth).toBe(420);
    expect(result.current).not.toHaveProperty('worldviewMainSize');
    expect(result.current).not.toHaveProperty('handleSplitterClick');
    expect(setWorkspaceView).not.toHaveBeenCalled();
  });

  it('tracks an exact intermediate drag width instead of snapping', () => {
    const setWorkspaceView = vi.fn();
    const { result } = renderHook(() => useAgentBuilderWorkspaceLayout({
      setWorkspaceView,
      workspaceView: 'worldview',
    }));
    act(() => {
      attachShell(result.current, 1000);
      beginDrag(result.current, 420);
    });
    act(() => {
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 735 }));
      window.dispatchEvent(new MouseEvent('mouseup'));
    });

    expect(result.current.chatPanelWidth).toBe(735);
    expect(setWorkspaceView).not.toHaveBeenCalled();
  });

  it('allows full Main coverage without unmounting the WorldView workspace', () => {
    const setWorkspaceView = vi.fn();
    const { result } = renderHook(() => useAgentBuilderWorkspaceLayout({
      setWorkspaceView,
      workspaceView: 'worldview',
    }));
    act(() => {
      attachShell(result.current, 1000);
      beginDrag(result.current, 420);
    });
    act(() => {
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 1400 }));
      window.dispatchEvent(new MouseEvent('mouseup'));
    });

    expect(result.current.chatPanelWidth).toBe(990);
    expect(setWorkspaceView).not.toHaveBeenCalled();
  });

  it('commits a small drag exactly and restores the start width on Escape', () => {
    const { result } = renderHook(() => useAgentBuilderWorkspaceLayout({
      setWorkspaceView: vi.fn(),
      workspaceView: 'worldview',
    }));
    act(() => {
      attachShell(result.current, 1000);
      beginDrag(result.current, 420);
    });
    act(() => {
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 424 }));
      window.dispatchEvent(new MouseEvent('mouseup'));
    });
    expect(result.current.chatPanelWidth).toBe(424);

    act(() => beginDrag(result.current, 424));
    act(() => {
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 800 }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(result.current.chatPanelWidth).toBe(424);
  });
});
