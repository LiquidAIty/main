// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import RightGlassDrawer from './RightGlassDrawer';

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

const parentRect = {
  x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 600,
  width: 800, height: 600, toJSON: () => ({}),
};
const panelRect = {
  x: 400, y: 48, left: 400, top: 48, right: 800, bottom: 588,
  width: 400, height: 540, toJSON: () => ({}),
};

function Harness({
  title = 'WorldView',
  onCloseObserved,
  storageKey,
  movable = true,
  resetWidthOnOpen = false,
}: {
  title?: string;
  onCloseObserved?: () => void;
  storageKey?: string;
  movable?: boolean;
  resetWidthOnOpen?: boolean;
}) {
  const [open, setOpen] = useState(true);
  const [count, setCount] = useState(0);
  return (
    <div data-testid="drawer-parent" style={{ position: 'relative', width: 800, height: 600 }}>
      <button type="button" onClick={() => setOpen(false)}>External collapse</button>
      <RightGlassDrawer
        isOpen={open}
        title={title}
        onClose={() => {
          onCloseObserved?.();
          setOpen(false);
        }}
        onOpen={() => setOpen(true)}
        dataTestId="drawer"
        defaultWidth={400}
        storageKey={storageKey}
        movable={movable}
        resetWidthOnOpen={resetWidthOnOpen}
      >
        <button type="button" onClick={() => setCount((value) => value + 1)}>Child {count}</button>
        <div style={{ height: 1200 }}>Long content</div>
      </RightGlassDrawer>
    </div>
  );
}

function installRects() {
  const parent = screen.getByTestId('drawer-parent');
  const drawer = screen.getByTestId('drawer');
  vi.spyOn(parent, 'getBoundingClientRect').mockReturnValue(parentRect);
  vi.spyOn(drawer, 'getBoundingClientRect').mockReturnValue(panelRect);
  return { drawer };
}

function detach() {
  const header = screen.getByLabelText('Move panel');
  fireEvent.mouseDown(header, { clientX: 720, clientY: 68 });
  fireEvent.mouseMove(window, { clientX: 560, clientY: 120 });
  fireEvent.mouseUp(window, { clientX: 560, clientY: 120 });
}

describe('RightGlassDrawer calm-tech movement', () => {
  it('opens docked flush to the right wall with one close control', () => {
    render(<Harness />);
    const { drawer } = installRects();

    expect(drawer.dataset.layout).toBe('docked');
    expect(drawer.style.right).toBe('0px');
    expect(drawer.style.left).toBe('');
    expect(drawer.style.width).toBe('400px');
    expect(screen.getByRole('separator', { name: 'Resize drawer' }).getAttribute('aria-valuemin')).toBe('400');
    expect(screen.getByRole('button', { name: 'Close drawer' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /dock|undock|detach/i })).toBeNull();
    expect(drawer.className).not.toContain('transition-all');
  });

  it('expands from the left edge but never shrinks a docked movable drawer below its default width', () => {
    render(<Harness />);
    const { drawer } = installRects();
    const resize = screen.getByRole('separator', { name: 'Resize drawer' });

    fireEvent.mouseDown(resize, { clientX: 400 });
    fireEvent.mouseMove(window, { clientX: 340 });
    fireEvent.mouseUp(window, { clientX: 340 });
    expect(drawer.style.width).toBe('460px');

    fireEvent.mouseDown(resize, { clientX: 340 });
    fireEvent.mouseMove(window, { clientX: 700 });
    fireEvent.mouseUp(window, { clientX: 700 });
    expect(drawer.style.width).toBe('400px');
  });

  it('detaches only after the docked header is dragged and exposes compact resize', () => {
    render(<Harness />);
    const { drawer } = installRects();

    fireEvent.mouseDown(screen.getByLabelText('Move panel'), { clientX: 720, clientY: 68 });
    fireEvent.mouseMove(window, { clientX: 718, clientY: 69 });
    expect(drawer.dataset.layout).toBe('docked');

    fireEvent.mouseMove(window, { clientX: 560, clientY: 120 });
    fireEvent.mouseUp(window, { clientX: 560, clientY: 120 });

    expect(drawer.dataset.layout).toBe('floating');
    expect(drawer.style.width).toBe('380px');
    expect(drawer.style.height).toBe('420px');
    expect(screen.getByLabelText('Resize floating panel')).toBeTruthy();
    expect(screen.queryByLabelText('Resize drawer')).toBeNull();
  });

  it('snaps a floating panel back to the right wall', () => {
    render(<Harness />);
    const { drawer } = installRects();
    const resize = screen.getByRole('separator', { name: 'Resize drawer' });
    fireEvent.mouseDown(resize, { clientX: 400 });
    fireEvent.mouseMove(window, { clientX: 340 });
    fireEvent.mouseUp(window, { clientX: 340 });
    expect(drawer.style.width).toBe('460px');
    detach();

    fireEvent.mouseDown(screen.getByLabelText('Move panel'), { clientX: 560, clientY: 120 });
    fireEvent.mouseMove(window, { clientX: 792, clientY: 120 });
    fireEvent.mouseUp(window, { clientX: 792, clientY: 120 });

    expect(drawer.dataset.layout).toBe('docked');
    expect(drawer.style.right).toBe('0px');
    expect(drawer.style.width).toBe('400px');
  });

  it('X collapses into the edge affordance and reopening starts docked without remounting children', async () => {
    const onClose = vi.fn();
    render(<Harness onCloseObserved={onClose} />);
    const { drawer } = installRects();
    fireEvent.click(screen.getByRole('button', { name: 'Child 0' }));
    fireEvent.keyDown(screen.getByRole('separator', { name: 'Resize drawer' }), { key: 'ArrowLeft' });
    expect(drawer.style.width).toBe('416px');
    detach();

    fireEvent.click(screen.getByRole('button', { name: 'Close drawer' }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(drawer.dataset.open).toBe('false');
    expect(drawer.dataset.layout).toBe('docked');
    expect(drawer.getAttribute('aria-hidden')).toBe('true');
    expect(drawer.style.visibility).toBe('hidden');
    expect(screen.queryByRole('button', { name: 'Child 1' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Open WorldView' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Open WorldView' }));
    await waitFor(() => expect(drawer.dataset.open).toBe('true'));
    expect(drawer.dataset.layout).toBe('docked');
    expect(drawer.style.width).toBe('400px');
    expect(screen.getByRole('button', { name: 'Child 1' })).toBeTruthy();
  });

  it('does not restore or persist an expanded width for a movable drawer', () => {
    window.localStorage.setItem('drawer-width', '440');
    render(<Harness storageKey="drawer-width" />);
    const { drawer } = installRects();

    expect(drawer.style.width).toBe('400px');
    fireEvent.keyDown(screen.getByRole('separator', { name: 'Resize drawer' }), { key: 'ArrowLeft' });
    expect(drawer.style.width).toBe('416px');
    expect(window.localStorage.getItem('drawer-width')).toBe('440');
    fireEvent.click(screen.getByRole('button', { name: 'Close drawer' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open WorldView' }));
    expect(drawer.style.width).toBe('400px');
  });

  it('preserves non-movable storage and resetWidthOnOpen behavior', () => {
    window.localStorage.setItem('drawer-width', '440');
    const view = render(<Harness movable={false} storageKey="drawer-width" />);
    const { drawer } = installRects();

    expect(drawer.style.width).toBe('440px');
    fireEvent.click(screen.getByRole('button', { name: 'Close drawer' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open WorldView' }));
    expect(drawer.style.width).toBe('440px');

    view.unmount();
    render(<Harness movable={false} storageKey="drawer-width" resetWidthOnOpen />);
    expect(screen.getByTestId('drawer').style.width).toBe('400px');
  });

  it('offers keyboard equivalents for pulling, moving, snapping, and resizing', () => {
    render(<Harness />);
    const { drawer } = installRects();
    const dockedResize = screen.getByRole('separator', { name: 'Resize drawer' });

    fireEvent.keyDown(dockedResize, { key: 'ArrowLeft' });
    expect(drawer.style.width).toBe('416px');

    const header = screen.getByRole('button', { name: 'Move panel' });
    fireEvent.keyDown(header, { key: 'ArrowLeft' });
    expect(drawer.dataset.layout).toBe('floating');
    const floatingResize = screen.getByRole('button', { name: 'Resize floating panel' });
    fireEvent.keyDown(floatingResize, { key: 'ArrowDown' });
    expect(drawer.style.height).toBe('436px');

    fireEvent.keyDown(header, { key: 'ArrowRight', shiftKey: true });
    expect(drawer.dataset.layout).toBe('docked');
    expect(drawer.style.right).toBe('0px');
    expect(drawer.style.width).toBe('400px');
  });

  it('cancels an active gesture when the parent collapses the drawer', () => {
    render(<Harness />);
    const { drawer } = installRects();

    fireEvent.mouseDown(screen.getByRole('button', { name: 'Move panel' }), { clientX: 720, clientY: 68 });
    fireEvent.click(screen.getByRole('button', { name: 'External collapse' }));
    fireEvent.mouseMove(window, { clientX: 500, clientY: 120 });
    fireEvent.mouseUp(window, { clientX: 500, clientY: 120 });

    expect(drawer.dataset.open).toBe('false');
    expect(drawer.dataset.layout).toBe('docked');
    fireEvent.click(screen.getByRole('button', { name: 'Open WorldView' }));
    expect(drawer.style.width).toBe('400px');
  });

  it('resizes a detached surface and resets body scroll when its context title changes', () => {
    const view = render(<Harness />);
    const { drawer } = installRects();
    detach();

    fireEvent.mouseDown(screen.getByLabelText('Resize floating panel'), { clientX: 600, clientY: 400 });
    fireEvent.mouseMove(window, { clientX: 650, clientY: 450 });
    fireEvent.mouseUp(window, { clientX: 650, clientY: 450 });
    expect(drawer.style.width).toBe('430px');
    expect(drawer.style.height).toBe('470px');

    const body = screen.getByText('Long content').parentElement as HTMLDivElement;
    body.scrollTop = 180;
    view.rerender(<Harness title="Rocket Lab" />);
    expect(body.scrollTop).toBe(0);
  });
});
