import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  query: vi.fn(),
  connect: vi.fn(),
}));

vi.mock('../db/pool', () => ({ pool: db }));

import {
  attachSavedCardToProject,
  createProject,
  listCanonicalSavedCardBindings,
  SYSTEM6_PROJECT_CARDS,
  SYSTEM6_PROJECT_EDGES,
} from './agentBuilderStore';

describe('agentBuilderStore Project Card membership', () => {
  beforeEach(() => {
    db.query.mockReset();
    db.connect.mockReset();
  });

  it('creates a Project by reusing the exact existing System6 revisions', async () => {
    const statements: Array<{ sql: string; params: unknown[] | undefined }> = [];
    const client = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        statements.push({ sql, params });
        if (sql.includes('WITH expected(card_id, runtime_profile)')) {
          return {
            rows: SYSTEM6_PROJECT_CARDS.map((card) => ({
              card_id: card.cardId,
              current_revision_id: `revision-${card.cardId}`,
            })),
          };
        }
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

    await createProject('New Project', 'new-project', 'agent', 'owner-one');

    expect(statements.some(({ sql }) => sql.includes('agent_card_revisions'))).toBe(true);
    expect(statements.some(({ sql }) => sql.includes('INSERT INTO ag_catalog.agent_card_revisions'))).toBe(false);
    const cardWrites = statements.filter(({ sql }) => sql.includes('INSERT INTO ag_catalog.agent_cards'));
    expect(cardWrites).toHaveLength(SYSTEM6_PROJECT_CARDS.length);
    expect(cardWrites.map(({ params }) => params?.[3])).toEqual(
      SYSTEM6_PROJECT_CARDS.map((card) => `revision-${card.cardId}`),
    );
    const firstSourceRead = statements.findIndex(({ sql }) => (
      sql.includes('WITH expected(card_id, runtime_profile)')
    ));
    const profileLocks = statements
      .map(({ sql, params }, index) => ({ sql, params, index }))
      .filter(({ sql }) => sql.includes('pg_advisory_xact_lock'));
    expect(profileLocks).toHaveLength(SYSTEM6_PROJECT_CARDS.length);
    expect(profileLocks.every(({ index }) => index < firstSourceRead)).toBe(true);
    expect(statements.some(({ sql }) => /agent-[a-f0-9-]+/i.test(sql))).toBe(false);
    expect(client.query).toHaveBeenCalledWith('COMMIT');
  });

  it('keeps Main and Builder identities separate with one Builder authorization flow', () => {
    expect(SYSTEM6_PROJECT_CARDS.find((card) => card.cardId === 'card_main_chat')?.profile)
      .toBe('main');
    expect(SYSTEM6_PROJECT_CARDS.find((card) => card.cardId === 'builder')?.profile)
      .toBe('builder');
    expect(SYSTEM6_PROJECT_EDGES.filter((edge) => edge.edgeType === 'flow')).toEqual([
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
    expect(client.query).toHaveBeenCalledWith('COMMIT');
  });

  it('selects one deterministic current saved identity per Hermes profile', async () => {
    db.query.mockResolvedValue({
      rows: [{
        runtime_profile: 'team',
        card_id: 'card_team',
        current_revision_id: 'revision-team-newest',
        revision_sha256: 'a'.repeat(64),
      }],
    });

    await expect(listCanonicalSavedCardBindings()).resolves.toEqual([{
      runtimeProfile: 'team',
      cardId: 'card_team',
      cardRevisionId: 'revision-team-newest',
      revisionSha256: 'a'.repeat(64),
    }]);
    const sql = String(db.query.mock.calls[0]?.[0]);
    expect(sql).toContain('PARTITION BY revision.runtime_profile');
    expect(sql).toContain('revision.created_at DESC');
    expect(sql).toContain('revision.revision_number DESC');
    expect(sql).toContain('revision.revision_id DESC');
  });
});
