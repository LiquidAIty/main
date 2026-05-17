// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { KoolSkoolsCurrentCoolerSceneGraph } from './sceneGraphSource';

vi.mock('@react-three/fiber', () => ({
  Canvas: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="mock-canvas">{children}</div>
  ),
}));

vi.mock('@react-three/drei', () => ({
  Line: () => <div data-testid="mock-line" />,
  OrbitControls: () => null,
}));

async function loadBlockoutWithResolverMock(throwResolverError: boolean) {
  vi.resetModules();
  vi.doMock('./sceneAssetRegistry', async () => {
    const actual = await vi.importActual<typeof import('./sceneAssetRegistry')>(
      './sceneAssetRegistry',
    );
    return {
      ...actual,
      resolveSceneAssetsForSceneGraph: throwResolverError
        ? () => {
            throw new Error('resolver_crash');
          }
        : actual.resolveSceneAssetsForSceneGraph,
    };
  });
  return import('./SceneGraphThreeBlockout');
}

describe('SceneGraphThreeBlockout safety', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('shows a contained warning and stays mounted when asset resolver throws', async () => {
    const { default: SceneGraphThreeBlockout } = await loadBlockoutWithResolverMock(true);
    render(<SceneGraphThreeBlockout scene={KoolSkoolsCurrentCoolerSceneGraph} />);

    expect(screen.getByText(/Asset resolver failed:/i)).toBeTruthy();
    expect(screen.getByTestId('mock-canvas')).toBeTruthy();
  });
});
