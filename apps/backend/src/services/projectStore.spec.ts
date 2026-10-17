/**
 * Entity: Projects
 * Relationship: Verifies owner-scoped Project identity creation and compensation never derive fresh state from another Project's Card revisions.
 *
 * Entity: Saved Cards
 * Relationship: Verifies exact owner-scoped Card listing and attachment preserve profile uniqueness and Project-local membership authority.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  query: vi.fn(),
  connect: vi.fn(),
}));

vi.mock('../db/pool', () => ({ pool: db }));

import {
  assertHermesProfileOwner,
  attachSavedCardToProject,
  createProject,
  discardFreshProject,
  listSavedCardsForProject,
} from './projectStore';
import { DEFAULT_PROJECT_DECK } from '../decks/defaultProjectDeck';

describe('projectStore saved Card membership', () => {
  beforeEach(() => {
    db.query.mockReset();
    db.connect.mockReset();
  });

  it('creates only the owner-scoped Project identity without scanning or copying another Project', async () => {
    const statements: Array<{ sql: string; params: unknown[] | undefined }> = [];
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        statements.push({ sql, params });
        if (sql.includes('INSERT INTO ag_catalog.projects')) {
          return {
            rows: [{
              id: 'project-new',
              name: 'New Project',
              code: 'new-project',
              status: 'active',
              project_type: 'agent',
            }],
          };
        }
        return { rows: [], rowCount: 1 };
      }),
      release: vi.fn(),
    };
    db.connect.mockResolvedValue(client);

    await createProject('New Project', 'new-project', 'owner-one');

    expect(statements).toHaveLength(3);
    expect(statements.map(({ sql }) => sql)).toEqual([
      'BEGIN',
      expect.stringContaining('INSERT INTO ag_catalog.projects'),
      'COMMIT',
    ]);
    expect(statements.some(({ sql }) => sql.includes('agent_cards'))).toBe(false);
    expect(statements.some(({ sql }) => sql.includes('agent_card_revisions'))).toBe(false);
    expect(statements.some(({ sql }) => sql.includes('agent_decks'))).toBe(false);
    expect(statements.some(({ sql }) => sql.includes('deck_card_memberships'))).toBe(false);
    expect(statements.some(({ sql }) => sql.includes('pg_advisory_xact_lock'))).toBe(false);
    expect(client.query).toHaveBeenCalledWith('COMMIT');
  });

  it('keeps Main and Builder identities separate with one Builder authorization flow', () => {
    expect(DEFAULT_PROJECT_DECK.nodes.find((card) => card.id === 'card_main_chat')?.runtime.profile)
      .toBe('main');
    expect(DEFAULT_PROJECT_DECK.nodes.find((card) => card.id === 'builder')?.runtime.profile)
      .toBe('builder');
    expect(DEFAULT_PROJECT_DECK.edges.filter((edge) => edge.edgeType === 'flow')).toEqual([
      { id: 'edge_main_chat_agent_builder', source: 'card_main_chat', target: 'builder', edgeType: 'flow' },
    ]);
  });

  it('attaches one saved Card by exact revision without creating a Card revision', async () => {
    const statements: Array<{ sql: string; params: unknown[] | undefined }> = [];
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        statements.push({ sql, params });
        if (sql.includes('FROM ag_catalog.agent_card_revisions')
          && sql.includes('revision_id=$1')) {
          return { rows: [{ runtime_profile: 'research' }] };
        }
        if (sql.includes('FOR SHARE OF source_card')) {
          return {
            rows: [{
              card_id: 'card-research',
              current_revision_id: 'revision-existing',
              runtime_profile: 'research',
            }],
          };
        }
        if (sql.includes('SELECT deck.revision')) return { rows: [{ revision: 'deck-before' }] };
        if (sql.includes('FROM ag_catalog.deck_card_memberships AS membership')) {
          return { rows: [] };
        }
        if (sql.includes('SELECT current_revision_id')
          && sql.includes('FROM ag_catalog.agent_cards')) {
          return { rows: [] };
        }
        if (sql.includes('COALESCE(MAX(ordinal)')) return { rows: [{ ordinal: 6 }] };
        return { rows: [], rowCount: 1 };
      }),
      release: vi.fn(),
    };
    db.connect.mockResolvedValue(client);

    await attachSavedCardToProject('project-one', 'deck_builder', 'owner-one', {
      cardId: 'card-research',
      cardRevisionId: 'revision-existing',
      expectedDeckRevision: 'deck-before',
      position: { x: 700, y: 40 },
    });

    const cardWrite = statements.find(({ sql }) => sql.includes('INSERT INTO ag_catalog.agent_cards'));
    expect(cardWrite?.params).toEqual([
      'project-one',
      'deck_builder',
      'card-research',
      'revision-existing',
    ]);
    expect(cardWrite?.sql).toContain('ON CONFLICT (project_id, deck_id, card_id) DO UPDATE');
    expect(statements.some(({ sql }) => sql.includes('INSERT INTO ag_catalog.agent_card_revisions'))).toBe(false);
    expect(statements.some(({ sql }) => sql.includes('INSERT INTO ag_catalog.deck_card_memberships'))).toBe(true);
    expect(statements.some(({ sql }) => sql.includes('UPDATE ag_catalog.agent_decks'))).toBe(false);
    const lockIndex = statements.findIndex(({ sql }) => sql.includes('pg_advisory_xact_lock'));
    const sourceReadIndex = statements.findIndex(({ sql }) => sql.includes('FOR SHARE OF source_card'));
    expect(lockIndex).toBeGreaterThan(-1);
    expect(lockIndex).toBeLessThan(sourceReadIndex);
    expect(statements[lockIndex]?.params).toEqual(['card-profile:research']);
    const requestedRevisionRead = statements.find(({ sql }) => (
      sql.includes('revision.revision_id=$1') && sql.includes('source_project.owner_user_id=$3')
    ));
    expect(requestedRevisionRead?.params).toEqual([
      'revision-existing',
      'card-research',
      'owner-one',
    ]);
    const canonicalRead = statements.find(({ sql }) => sql.includes('FOR SHARE OF source_card'));
    expect(canonicalRead?.sql).not.toContain('ANY(');
    expect(canonicalRead?.params).toEqual(['owner-one', 'research']);
    expect(client.query).toHaveBeenCalledWith('COMMIT');
  });

  it('lists only saved Cards currently owned by the authenticated user', async () => {
    db.query.mockResolvedValue({ rows: [] });

    await listSavedCardsForProject('project-one', 'deck_builder', 'owner-one');

    expect(db.query).toHaveBeenCalledTimes(1);
    const [sql, params] = db.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('source_project.owner_user_id=$3');
    expect(sql).not.toContain('ANY(');
    expect(params).toEqual(['project-one', 'deck_builder', 'owner-one']);
  });

  it('accepts a stable Hermes profile only when exactly one saved owner matches', async () => {
    db.query.mockResolvedValue({ rows: [{ owner_user_id: 'owner-one' }] });

    await expect(assertHermesProfileOwner('Builder', 'owner-one')).resolves.toBeUndefined();

    const [sql, params] = db.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('SELECT DISTINCT project.owner_user_id');
    expect(sql).toContain("revision.runtime_kind='hermes'");
    expect(params).toEqual(['builder']);
  });

  it('fails closed when one stable Hermes profile is referenced by multiple owners', async () => {
    db.query.mockResolvedValue({
      rows: [{ owner_user_id: 'owner-one' }, { owner_user_id: 'owner-two' }],
    });

    await expect(assertHermesProfileOwner('builder', 'owner-one'))
      .rejects.toThrow('hermes_profile_owner_conflict');
  });

  it('verifies Project ownership before compensating child rows', async () => {
    const statements: Array<{ sql: string; params: unknown[] | undefined }> = [];
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        statements.push({ sql, params });
        if (sql.includes('FROM ag_catalog.projects') && sql.includes('FOR UPDATE')) {
          return { rows: [] };
        }
        return { rows: [], rowCount: 1 };
      }),
      release: vi.fn(),
    };
    db.connect.mockResolvedValue(client);

    await expect(discardFreshProject('project-other', 'owner-one'))
      .rejects.toThrow('project_not_found');

    expect(statements.some(({ sql }) => sql.includes('deck_card_memberships'))).toBe(false);
    expect(statements.some(({ sql }) => sql.includes('DELETE FROM ag_catalog.agent_cards'))).toBe(false);
    expect(statements.some(({ sql }) => sql === 'ROLLBACK')).toBe(true);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

});
