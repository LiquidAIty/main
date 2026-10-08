import { randomUUID } from 'crypto';
import { pool } from '../db/pool';
import {
  DEFAULT_PROJECT_CARDS,
  DEFAULT_PROJECT_DECK_ID,
} from '../decks/defaultProjectDeck';
import type { ProjectSummary } from '../types/project';

export type OwnedProject = ProjectSummary & {
  ownerUserId: string;
};

export type SavedCardChoice = {
  cardId: string;
  cardRevisionId: string;
  title: string;
  subtitle: string | null;
  runtimeProfile: string;
};


type TransactionClient = {
  query: (statement: string, values?: unknown[]) => Promise<{
    rows: any[];
    rowCount?: number | null;
  }>;
};

async function lockCardProfiles(
  client: TransactionClient,
  profiles: readonly string[],
): Promise<void> {
  const keys = [...new Set(
    profiles.map((profile) => profile.trim().toLowerCase()).filter(Boolean),
  )]
    .sort((left, right) => left.localeCompare(right));
  for (const profile of keys) {
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [`card-profile:${profile}`],
    );
  }
}

// Projects table lives in ag_catalog schema in your DB
const PROJECTS_TABLE = 'ag_catalog.projects';
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function projectLookup(projectId: string): { clause: string; params: any[] } {
  if (UUID_REGEX.test(projectId)) {
    return { clause: 'id = $1', params: [projectId] };
  }
  // Fall back to slug/code lookup when a non-UUID id (e.g., "default") is provided
  return { clause: 'code = $1', params: [projectId] };
}

export async function createProject(
  name: string,
  code?: string | null,
  projectType: 'assist' | 'agent' = 'agent',
  ownerUserId?: string | null,
): Promise<ProjectSummary> {
  const ownerId = typeof ownerUserId === 'string' ? ownerUserId.trim() : '';
  // Prisma User ids are CUID strings; only project ids use UUIDs. The route
  // resolves this value from the authenticated session before it reaches the
  // store, so requiring UUID syntax here rejects every normal signed-in user.
  if (!ownerId) throw new Error('project_owner_required');
  const projectId = randomUUID();
  const projectCode = code?.trim() || null;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let systemCards: Array<{ card_id: string; current_revision_id: string }> = [];
    if (projectType === 'agent') {
      // Card revision propagation and Project membership creation take the same
      // transaction-scoped profile locks.  Whichever operation starts second
      // therefore reads after the first has committed and cannot reintroduce a
      // superseded Card revision into a new Project.
      await lockCardProfiles(client, DEFAULT_PROJECT_CARDS.map((card) => card.profile));
      const identityParams = DEFAULT_PROJECT_CARDS.flatMap((card) => [card.cardId, card.profile]);
      const values = DEFAULT_PROJECT_CARDS.map((_, index) => (
        `($${index * 2 + 1}::text,$${index * 2 + 2}::text)`
      )).join(',');
      const result = await client.query(
        `WITH expected(card_id, runtime_profile) AS (VALUES ${values}),
         ranked AS (
           SELECT expected.card_id, card.current_revision_id,
                  row_number() OVER (
                    PARTITION BY expected.card_id
                    ORDER BY revision.created_at DESC,
                             revision.revision_number DESC,
                             revision.revision_id DESC
                  ) AS rank
           FROM expected
           JOIN ag_catalog.agent_cards AS card
             ON card.card_id=expected.card_id
           JOIN ag_catalog.agent_card_revisions AS revision
             ON revision.revision_id=card.current_revision_id
            AND revision.runtime_profile=expected.runtime_profile
         )
         SELECT card_id, current_revision_id::text
         FROM ranked WHERE rank=1
         ORDER BY card_id`,
        identityParams,
      );
      systemCards = result.rows.map((row) => ({
        card_id: String(row.card_id),
        current_revision_id: String(row.current_revision_id),
      }));
      const resolved = new Map(systemCards.map((row) => [row.card_id, row.current_revision_id]));
      const missing = DEFAULT_PROJECT_CARDS.find((card) => !resolved.get(card.cardId));
      if (missing) throw new Error(`default_project_card_unavailable:${missing.cardId}`);
    }

    const { rows } = await client.query(
      `INSERT INTO ${PROJECTS_TABLE}
         (id, name, code, status, agent_tools, agent_io_schema, agent_permissions, owner_user_id, project_type)
       VALUES ($1, $2, $3, 'active', '[]'::jsonb, '{}'::jsonb, '{}'::jsonb, $4, $5)
       RETURNING id, name, code, status, project_type`,
      [projectId, name, projectCode, ownerId, projectType],
    );
    const row = rows[0];
    if (!row) throw new Error('project_create_failed');

    if (projectType === 'agent') {
      const deckRevision = randomUUID();
      await client.query(
        `INSERT INTO ag_catalog.agent_decks
           (project_id, deck_id, name, project_code_folder, document_version, revision, saved_at, updated_at)
         VALUES ($1,$2,'Agent Card Deck',NULL,10,$3,NOW(),NOW())`,
        [projectId, DEFAULT_PROJECT_DECK_ID, deckRevision],
      );
      const revisionByCard = new Map(systemCards.map((entry) => [entry.card_id, entry.current_revision_id]));
      for (const [ordinal, card] of DEFAULT_PROJECT_CARDS.entries()) {
        const revisionId = revisionByCard.get(card.cardId);
        if (!revisionId) throw new Error(`default_project_card_unavailable:${card.cardId}`);
        await client.query(
          `INSERT INTO ag_catalog.agent_cards
             (project_id, deck_id, card_id, current_revision_id)
           VALUES ($1,$2,$3,$4)`,
          [projectId, DEFAULT_PROJECT_DECK_ID, card.cardId, revisionId],
        );
        await client.query(
          `INSERT INTO ag_catalog.deck_card_memberships
             (project_id, deck_id, card_id, ordinal, position_x, position_y,
              parent_graph_id, display_status, presentation_config)
           VALUES ($1,$2,$3,$4,$5,$6,NULL,'ready','{}'::jsonb)`,
          [projectId, DEFAULT_PROJECT_DECK_ID, card.cardId, ordinal, card.x, card.y],
        );
      }
    }
    await client.query('COMMIT');
    return {
      id: row.id,
      name: row.name,
      code: row.code ?? null,
      status: row.status ?? null,
      project_type: row.project_type,
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function discardFreshProject(projectId: string, ownerUserId: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `DELETE FROM ag_catalog.deck_card_memberships WHERE project_id=$1`,
      [projectId],
    );
    await client.query(`DELETE FROM ag_catalog.agent_cards WHERE project_id=$1`, [projectId]);
    await client.query(`DELETE FROM ag_catalog.agent_decks WHERE project_id=$1`, [projectId]);
    await client.query(
      `DELETE FROM ${PROJECTS_TABLE} WHERE id=$1 AND owner_user_id=$2`,
      [projectId, ownerUserId],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function listOwnedProjects(
  ownerUserId: string,
  projectType?: 'assist' | 'agent' | null,
): Promise<ProjectSummary[]> {
  const owner = ownerUserId.trim();
  if (!owner) throw new Error('project_owner_required');
  const params: string[] = [];
  const clauses: string[] = [];
  params.push(owner);
  clauses.push(`owner_user_id = $${params.length}`);
  if (projectType) {
    params.push(projectType);
    clauses.push(`project_type = $${params.length}`);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const { rows } = await pool.query(
    `SELECT id, name, code, status, project_type
     FROM ${PROJECTS_TABLE}
     ${where}
     ORDER BY updated_at DESC`,
    params,
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    code: row.code ?? null,
    status: row.status ?? null,
    project_type: row.project_type,
  }));
}

export async function getOwnedProjectByReference(
  projectReference: string,
  ownerUserId: string,
): Promise<OwnedProject | null> {
  const reference = String(projectReference || '').trim();
  const owner = String(ownerUserId || '').trim();
  if (!reference || !owner) return null;
  const { clause, params } = projectLookup(reference);
  params.push(owner);
  const { rows } = await pool.query(
    `SELECT id, name, code, status, project_type, owner_user_id
     FROM ${PROJECTS_TABLE}
     WHERE ${clause} AND owner_user_id = $2
     LIMIT 1`,
    params,
  );
  if (!rows.length) return null;

  const row = rows[0];
  return {
    id: row.id,
    name: row.name,
    code: row.code ?? null,
    status: row.status ?? null,
    project_type: row.project_type,
    ownerUserId: String(row.owner_user_id || ''),
  };
}

export async function getInternalProjectById(projectId: string): Promise<OwnedProject | null> {
  const id = String(projectId || '').trim();
  if (!UUID_REGEX.test(id)) return null;
  const { rows } = await pool.query(
    `SELECT id, name, code, status, project_type, owner_user_id
     FROM ${PROJECTS_TABLE}
     WHERE id = $1
     LIMIT 1`,
    [id],
  );
  if (!rows.length) return null;
  const row = rows[0];
  return {
    id: row.id,
    name: row.name,
    code: row.code ?? null,
    status: row.status ?? null,
    project_type: row.project_type,
    ownerUserId: String(row.owner_user_id || ''),
  };
}

export async function listSavedCardsForProject(
  projectId: string,
  deckId: string,
  ownerUserId: string,
): Promise<SavedCardChoice[]> {
  const systemIds = DEFAULT_PROJECT_CARDS.map((card) => card.cardId);
  const { rows } = await pool.query(
    `WITH candidates AS (
       SELECT source_card.card_id, source_card.current_revision_id,
              revision.title, revision.subtitle, revision.runtime_profile,
              row_number() OVER (
                PARTITION BY revision.runtime_profile
                ORDER BY revision.created_at DESC,
                         revision.revision_number DESC,
                         revision.revision_id DESC
              ) AS rank
       FROM ag_catalog.agent_cards AS source_card
       JOIN ag_catalog.agent_card_revisions AS revision
         ON revision.revision_id=source_card.current_revision_id
       JOIN ag_catalog.projects AS source_project
         ON source_project.id=source_card.project_id
       WHERE source_project.owner_user_id=$3
          OR source_card.card_id=ANY($4::text[])
     )
     SELECT candidate.card_id, candidate.current_revision_id::text,
            candidate.title, candidate.subtitle, candidate.runtime_profile
     FROM candidates AS candidate
     WHERE candidate.rank=1
       AND NOT EXISTS (
         SELECT 1
         FROM ag_catalog.deck_card_memberships AS attached
         JOIN ag_catalog.agent_cards AS attached_card
           ON attached_card.project_id=attached.project_id
          AND attached_card.deck_id=attached.deck_id
          AND attached_card.card_id=attached.card_id
         JOIN ag_catalog.agent_card_revisions AS attached_revision
           ON attached_revision.revision_id=attached_card.current_revision_id
         WHERE attached.project_id=$1 AND attached.deck_id=$2
           AND (
             attached.card_id=candidate.card_id
             OR attached_revision.runtime_profile=candidate.runtime_profile
           )
       )
     ORDER BY candidate.title, candidate.card_id`,
    [projectId, deckId, ownerUserId, systemIds],
  );
  return rows.map((row) => ({
    cardId: String(row.card_id),
    cardRevisionId: String(row.current_revision_id),
    title: String(row.title),
    subtitle: row.subtitle == null ? null : String(row.subtitle),
    runtimeProfile: String(row.runtime_profile),
  }));
}

export async function attachSavedCardToProject(
  projectId: string,
  deckId: string,
  ownerUserId: string,
  input: {
    cardId: string;
    cardRevisionId: string;
    expectedDeckRevision: string;
    position: { x: number; y: number };
  },
): Promise<{ cardPresenceCreated: boolean; runtimeProfile: string }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const requestedRevision = await client.query(
      `SELECT runtime_profile
       FROM ag_catalog.agent_card_revisions
       WHERE revision_id=$1 AND card_id=$2
         AND runtime_kind='hermes'
         AND NULLIF(BTRIM(runtime_profile), '') IS NOT NULL`,
      [input.cardRevisionId, input.cardId],
    );
    if (!requestedRevision.rows.length) throw new Error('saved_card_not_available');
    const runtimeProfile = String(requestedRevision.rows[0].runtime_profile);
    await lockCardProfiles(client, [runtimeProfile]);

    // Card Save and membership creation share this profile lock. The current
    // binding is re-read after the lock so an attachment cannot reintroduce a
    // revision that a concurrent Save has already superseded.
    const systemIds = DEFAULT_PROJECT_CARDS.map((card) => card.cardId);
    const candidates = await client.query(
      `SELECT source_card.card_id, source_card.current_revision_id,
              revision.runtime_profile
       FROM ag_catalog.agent_cards AS source_card
       JOIN ag_catalog.agent_card_revisions AS revision
         ON revision.revision_id=source_card.current_revision_id
       JOIN ag_catalog.projects AS source_project
         ON source_project.id=source_card.project_id
       WHERE (source_project.owner_user_id=$1
              OR source_card.card_id=ANY($2::text[]))
         AND revision.runtime_profile=$3
       ORDER BY revision.created_at DESC,
                revision.revision_number DESC,
                revision.revision_id DESC
       FOR SHARE OF source_card`,
      [ownerUserId, systemIds, runtimeProfile],
    );
    const canonical = candidates.rows[0];
    if (!canonical
      || String(canonical.card_id) !== input.cardId
      || String(canonical.current_revision_id) !== input.cardRevisionId) {
      throw new Error('saved_card_not_available');
    }

    const deck = await client.query(
      `SELECT deck.revision
       FROM ag_catalog.agent_decks AS deck
       JOIN ag_catalog.projects AS project ON project.id=deck.project_id
       WHERE deck.project_id=$1 AND deck.deck_id=$2 AND project.owner_user_id=$3
       FOR UPDATE`,
      [projectId, deckId, ownerUserId],
    );
    if (!deck.rows.length) throw new Error('deck_not_found');
    if (String(deck.rows[0].revision) !== input.expectedDeckRevision) {
      throw new Error('deck_conflict');
    }
    const attached = await client.query(
      `SELECT 1
       FROM ag_catalog.deck_card_memberships AS membership
       JOIN ag_catalog.agent_cards AS attached_card
         ON attached_card.project_id=membership.project_id
        AND attached_card.deck_id=membership.deck_id
        AND attached_card.card_id=membership.card_id
       JOIN ag_catalog.agent_card_revisions AS attached_revision
         ON attached_revision.revision_id=attached_card.current_revision_id
       WHERE membership.project_id=$1 AND membership.deck_id=$2
         AND (
           membership.card_id=$3
           OR attached_revision.runtime_profile=$4
         )
       LIMIT 1`,
      [projectId, deckId, input.cardId, runtimeProfile],
    );
    if (attached.rows.length) throw new Error('saved_card_not_available');
    const existingPresence = await client.query(
      `SELECT current_revision_id
       FROM ag_catalog.agent_cards
       WHERE project_id=$1 AND deck_id=$2 AND card_id=$3
       FOR UPDATE`,
      [projectId, deckId, input.cardId],
    );
    const cardPresenceCreated = existingPresence.rows.length === 0;
    const ordinalResult = await client.query(
      `SELECT COALESCE(MAX(ordinal), -1) + 1 AS ordinal
       FROM ag_catalog.deck_card_memberships
       WHERE project_id=$1 AND deck_id=$2`,
      [projectId, deckId],
    );
    const ordinal = Number(ordinalResult.rows[0]?.ordinal ?? 0);
    await client.query(
      `INSERT INTO ag_catalog.agent_cards
         (project_id, deck_id, card_id, current_revision_id)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (project_id, deck_id, card_id) DO UPDATE
       SET current_revision_id=EXCLUDED.current_revision_id`,
      [projectId, deckId, input.cardId, input.cardRevisionId],
    );
    await client.query(
      `INSERT INTO ag_catalog.deck_card_memberships
         (project_id, deck_id, card_id, ordinal, position_x, position_y,
          parent_graph_id, display_status, presentation_config)
       VALUES ($1,$2,$3,$4,$5,$6,NULL,'ready','{}'::jsonb)`,
      [projectId, deckId, input.cardId, ordinal, input.position.x, input.position.y],
    );
    await client.query('COMMIT');
    return { cardPresenceCreated, runtimeProfile };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function discardFreshMembership(
  projectId: string,
  deckId: string,
  cardId: string,
  cardRevisionId: string,
  ownerUserId: string,
  cardPresenceCreated: boolean,
  expectedDeckRevision: string,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const deck = await client.query(
      `SELECT deck.revision
       FROM ag_catalog.agent_decks AS deck
       JOIN ${PROJECTS_TABLE} AS project ON project.id=deck.project_id
       WHERE deck.project_id=$1 AND deck.deck_id=$2 AND project.owner_user_id=$3
       FOR UPDATE`,
      [projectId, deckId, ownerUserId],
    );
    if (!deck.rows.length) throw new Error('deck_not_found');
    if (String(deck.rows[0].revision) !== expectedDeckRevision) {
      throw new Error('deck_conflict');
    }
    await client.query(
      `DELETE FROM ag_catalog.deck_card_memberships
       WHERE project_id=$1 AND deck_id=$2 AND card_id=$3`,
      [projectId, deckId, cardId],
    );
    if (cardPresenceCreated) {
      await client.query(
        `DELETE FROM ag_catalog.agent_cards AS card
         WHERE card.project_id=$1 AND card.deck_id=$2 AND card.card_id=$3
           AND card.current_revision_id=$4
           AND NOT EXISTS (
             SELECT 1 FROM ag_catalog.deck_card_memberships AS membership
             WHERE membership.project_id=card.project_id
               AND membership.deck_id=card.deck_id
               AND membership.card_id=card.card_id
           )`,
        [projectId, deckId, cardId, cardRevisionId],
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
