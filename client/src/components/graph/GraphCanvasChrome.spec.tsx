// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { GraphNavigationControls, GraphPaperBackground } from './GraphCanvasChrome';

describe('shared graph canvas chrome', () => {
  it('provides the same compact navigation controls and graph paper substrate', () => {
    const onZoomIn = vi.fn();
    const onZoomOut = vi.fn();
    const onFit = vi.fn();
    const { container } = render(<div style={{ position: 'relative' }}><GraphPaperBackground /><GraphNavigationControls onZoomIn={onZoomIn} onZoomOut={onZoomOut} onFit={onFit} /></div>);

    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    fireEvent.click(screen.getByRole('button', { name: 'Fit view' }));

    expect(onZoomIn).toHaveBeenCalledOnce();
    expect(onZoomOut).toHaveBeenCalledOnce();
    expect(onFit).toHaveBeenCalledOnce();
    expect(container.querySelector('[aria-hidden="true"]')).toBeTruthy();
  });
});
