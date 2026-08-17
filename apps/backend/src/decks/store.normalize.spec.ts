import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { BUILDER_DECK_ID, deleteDeckDocument } from './store';

describe('thin Deck transport boundary', () => {
  it('keeps the existing Agent Builder Deck identity', () => {
    expect(BUILDER_DECK_ID).toBe('deck_builder');
  });

  it('fails closed instead of inventing generic Deck deletion semantics', async () => {
    await expect(deleteDeckDocument('project-one', 'deck_builder')).rejects.toThrow(
      'canonical_deck_deletion_not_supported',
    );
  });

  it('contains no TypeScript database or legacy JSONB authority', () => {
    const source = readFileSync(new URL('./store.ts', import.meta.url), 'utf8');
    expect(source).toContain('requestPythonRailsJson');
    expect(source).toContain('/domain/decks/');
    expect(source).not.toContain("../db/pool");
    expect(source).not.toContain('pool.query');
    expect(source).not.toContain('agent_io_schema');
    expect(source).not.toContain('v3_state');
  });
});
