// @vitest-environment jsdom
// Entity: Building Viewport Verification
// Relationship: These tests verify shared canvas controls and prevent selection or render updates from repeatedly resetting the camera.
import React, { act, forwardRef, useImperativeHandle } from 'react';
import { createRoot } from 'react-dom/client';
import { BoxGeometry, Mesh, MeshBasicMaterial, type Object3D } from 'three';
import { expect, it, vi } from 'vitest';
import ModelViewport from '../ui/ModelViewport';
import { GraphPaperBackground } from '../../../client/src/components/graph/GraphCanvasChrome';

const mocks = vi.hoisted(() => ({
  controls: {
    camera: { zoom: 20 }, setLookAt: vi.fn(), fitToBox: vi.fn(), zoom: vi.fn(), truck: vi.fn(),
  },
  state: { setSelection: vi.fn(), resetSelection: vi.fn(), setHoveredId: vi.fn() },
  bind: null as null | ((objects: ReadonlyMap<string, Object3D>) => void),
  transparent: false,
}));
vi.mock('@pascal-app/viewer', () => ({
  Viewer: ({ children, transparent }: { children: React.ReactNode; transparent: boolean }) => {
    mocks.transparent = transparent;
    return <div>{children}</div>;
  },
  GlbScene: ({ onObjectsChange }: { onObjectsChange: typeof mocks.bind }) => {
    mocks.bind = onObjectsChange;
    return null;
  },
  useViewer: { getState: () => mocks.state },
}));
vi.mock('@react-three/drei', () => ({
  CameraControls: forwardRef((_props, ref) => {
    useImperativeHandle(ref, () => mocks.controls);
    return null;
  }),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it('shares graph-paper navigation and fits only once across selection and property refreshes', () => {
  const host = document.createElement('div');
  const root = createRoot(host);
  const geometry = new BoxGeometry(10, 4, 10);
  const material = new MeshBasicMaterial();
  const mesh = new Mesh(geometry, material);
  try {
    act(() => root.render(<ModelViewport url="/display?revision=1" selection={null}
      handles={['wall']} onSelect={() => undefined} />));
    act(() => mocks.bind!(new Map([['wall', mesh]])));
    expect(mocks.controls.fitToBox).toHaveBeenCalledTimes(1);
    act(() => root.render(<ModelViewport url="/display?revision=1" selection="wall"
      handles={['wall']} onSelect={() => undefined} />));
    act(() => mocks.bind!(new Map([['wall', mesh]])));
    expect(mocks.controls.fitToBox).toHaveBeenCalledTimes(1);
    expect(mocks.state.resetSelection).not.toHaveBeenCalled();
    expect(mocks.transparent).toBe(true);
    // jsdom drops multi-layer gradients; compare the retained grid sizing to
    // the shared component. The actual gradient is also checked in the browser.
    const paper = host.querySelector('[aria-hidden="true"]') as HTMLDivElement;
    expect(paper.style.backgroundSize).toBe(GraphPaperBackground({}).props.style.backgroundSize);
    expect(paper.style.backgroundColor).toBe('rgb(11, 14, 18)');
    expect(host.querySelector('[data-testid="graph-navigation-controls"]')).not.toBeNull();
    for (const label of ['Fit building', 'Roof cutaway', 'OPENSTUDIO', 'Plan']) {
      expect(host.textContent).not.toContain(label);
    }
    act(() => (host.querySelector('[aria-label="Zoom in"]') as HTMLButtonElement).click());
    expect(mocks.controls.zoom).toHaveBeenCalledWith(4, true);
    act(() => (host.querySelector('[aria-label="Pan left"]') as HTMLButtonElement).click());
    expect(mocks.controls.truck).toHaveBeenCalled();
    act(() => (host.querySelector('[aria-label="Fit view"]') as HTMLButtonElement).click());
    expect(mocks.controls.fitToBox).toHaveBeenCalledTimes(2);
  } finally {
    act(() => root.unmount());
    geometry.dispose();
    material.dispose();
  }
  expect(mocks.state.resetSelection).toHaveBeenCalledTimes(1);
});
