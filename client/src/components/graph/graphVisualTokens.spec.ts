/**
 * Graph + less = more: less code that does the same work as more code is more useful.
 * Entity names the feature; Relationship explains why this file belongs and what it contributes.
 * Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
 * Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
 * Entity: Project Knowledge Graph
 * Relationship: This file verifies the shared Solarpunk palette preserves its knowledge-surface and relationship-color roles.
 * Entity: Card Topology
 * Relationship: This file verifies the same palette preserves its saved Card workflow and topology accent roles.
 */

import { describe, expect, it } from 'vitest';
import { GRAPH_THEME, SOLARPUNK_PALETTE } from './graphVisualTokens';

describe('Solarpunk graph palette contract', () => {
  it('provides the exact shared sea and sun aliases without changing their semantic roles', () => {
    expect(Object.isFrozen(SOLARPUNK_PALETTE)).toBe(true);
    expect(SOLARPUNK_PALETTE).toEqual({
      sea: '#4FA2AD',
      sun: '#F2A64A',
    });
    expect(GRAPH_THEME.accent.primary).toBe(SOLARPUNK_PALETTE.sea);
    expect(GRAPH_THEME.accent.think).toBe(SOLARPUNK_PALETTE.sea);
    expect(GRAPH_THEME.edge.selected).toBe(SOLARPUNK_PALETTE.sea);
    expect(GRAPH_THEME.accent.solar).toBe(SOLARPUNK_PALETTE.sun);
    expect(GRAPH_THEME.accent.workflow).toBe(SOLARPUNK_PALETTE.sun);
  });
});
