import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { DEFAULT_PROJECT_DECK_ID } from './defaultProjectDeck';

describe('thin Deck transport boundary', () => {
  it('keeps the existing Agent Builder Deck identity', () => {
    expect(DEFAULT_PROJECT_DECK_ID).toBe('deck_builder');
  });

  it('contains no TypeScript database or legacy JSONB authority', () => {
    const workspacePath = resolve(process.cwd(), 'src/decks/deckDomainClient.ts');
    const repositoryPath = resolve(process.cwd(), 'apps/backend/src/decks/deckDomainClient.ts');
    const source = readFileSync(existsSync(workspacePath) ? workspacePath : repositoryPath, 'utf8');
    expect(source).toContain('requestPythonRailsJson');
    expect(source).toContain('/domain/decks/');
    expect(source).not.toContain("../db/pool");
    expect(source).not.toContain('pool.query');
    expect(source).not.toContain('agent_io_schema');
    expect(source).not.toContain('v3_state');
  });
});
