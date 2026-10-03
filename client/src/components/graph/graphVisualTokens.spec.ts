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
