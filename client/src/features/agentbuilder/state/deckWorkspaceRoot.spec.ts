import { describe, expect, it } from 'vitest';
import { resolveDeckWorkspaceRoot } from './deckWorkspaceRoot';

const deck = {
  id: 'deck_builder',
  name: 'Agent Card Deck',
  workspaceRoot: 'C:\\Projects\\main',
  promptTemplates: [],
  nodes: [],
  edges: [],
  version: 3,
};

describe('resolveDeckWorkspaceRoot', () => {
  it('uses the persisted deck root for the normal canvas surface', () => {
    expect(resolveDeckWorkspaceRoot(deck)).toBe('C:\\Projects\\main');
  });

  it('uses the active workbench root when one is explicitly present', () => {
    expect(resolveDeckWorkspaceRoot(deck, 'C:\\Projects\\other')).toBe('C:\\Projects\\other');
  });

  it('does not silently invent a missing root', () => {
    expect(resolveDeckWorkspaceRoot({ ...deck, workspaceRoot: null })).toBeNull();
  });
});
