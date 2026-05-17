// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

async function loadMediaStudioCanvasWithBlockoutMock(
  blockoutImpl: React.ComponentType<{ scene: { name?: string } }>,
) {
  vi.resetModules();
  vi.doMock('./SceneGraphThreeBlockout', () => ({
    default: blockoutImpl,
  }));
  return import('./MediaStudioCanvas');
}

describe('MediaStudioCanvas crash guards', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('renders with default scene data when backend project is unavailable', async () => {
    const { default: MediaStudioCanvas } = await loadMediaStudioCanvasWithBlockoutMock(
      ({ scene }) => <div data-testid="mock-blockout">{scene?.name || 'unknown-scene'}</div>,
    );

    render(<MediaStudioCanvas projectId={null} />);

    expect(screen.getByText(/Active scene:/i).textContent).toContain(
      'Kool Skools Classroom Concept',
    );
    expect(screen.getByTestId('mock-blockout').textContent).toContain(
      'Kool Skools Classroom Concept',
    );
    expect(
      screen.getByText(/No active project selected\./i),
    ).toBeTruthy();
  });

  it('keeps MediaStudioCanvas alive when 3D blockout throws', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { default: MediaStudioCanvas } = await loadMediaStudioCanvasWithBlockoutMock(
      () => {
        throw new Error('blockout_crash');
      },
    );

    render(<MediaStudioCanvas projectId={null} />);

    expect(screen.getByText(/3D preview unavailable: blockout_crash/i)).toBeTruthy();
    expect(screen.getAllByText(/SceneGraph Source/i).length).toBeGreaterThan(0);
    consoleErrorSpy.mockRestore();
  });
});
