// @vitest-environment jsdom
/**
 * Graph + less = more: less code that does the same work as more code is more useful.
 * Entity names the feature; Relationship explains why this file belongs and what it contributes.
 * Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
 * Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
 * Entity: Project Knowledge Graph
 * Relationship: This file verifies the shared Project graph-paper substrate and compact zoom, fit, and navigation controls.
 * Entity: Card Topology
 * Relationship: This file verifies the same canvas controls remain reusable by the saved Card topology workspace.
 */

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
