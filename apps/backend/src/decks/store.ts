// @graph entity: DeckStore
// @graph role: deck-persistence
// @graph relates_to: AgentBuilderWorkspace
// @graph depends_on: Postgres
import { randomUUID } from 'crypto';
import { pool } from '../db/pool';
import type {
  DeckDocument,
  V3ProjectBlob,
  V3RevisionMeta,
} from '../types';

/** The app's one canonical Agent Canvas deck id. The deck store is the deck
 * authority, so this is THE definition — route/session modules import it
 * instead of keeping their own string copies. */
export const BUILDER_DECK_ID = 'deck_builder';

const PROJECTS_TABLE = 'ag_catalog.projects';
const V3_STATE_KEY = 'v3_state';
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const V3_SCHEMA_CAS_RETRIES = 3;
function projectLookup(projectId: string): { clause: string; params: any[] } {
  if (UUID_REGEX.test(projectId)) {
    return { clause: 'id = $1', params: [projectId] };
  }
  return { clause: 'code = $1', params: [projectId] };
}

function parseJsonObject(value: unknown, errorCode: string): Record<string, unknown> {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      throw new Error(errorCode);
    }
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  throw new Error(errorCode);
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function parseDeckDocument(value: unknown, expectedId: string): DeckDocument {
  const raw = parseJsonObject(value, 'invalid_deck_document');
  if (raw.id !== expectedId) throw new Error('deck_id_mismatch');
  if (typeof raw.name !== 'string' || !raw.name) throw new Error('deck_name_invalid');
  if (!Number.isFinite(raw.version)) throw new Error('deck_version_invalid');
  if (!Array.isArray(raw.nodes)) throw new Error('deck_nodes_invalid');
  if (!Array.isArray(raw.edges)) throw new Error('deck_edges_invalid');
  if (!Array.isArray(raw.promptTemplates)) throw new Error('deck_prompt_templates_invalid');
  for (const node of raw.nodes) {
    const card = parseJsonObject(node, 'deck_card_invalid');
    if (typeof card.id !== 'string' || !card.id) throw new Error('deck_card_id_invalid');
  }
  for (const edge of raw.edges) {
    const wire = parseJsonObject(edge, 'deck_edge_invalid');
    if (typeof wire.id !== 'string' || !wire.id) throw new Error('deck_edge_id_invalid');
    if (typeof wire.source !== 'string' || !wire.source) throw new Error('deck_edge_source_invalid');
    if (typeof wire.target !== 'string' || !wire.target) throw new Error('deck_edge_target_invalid');
  }
  return cloneJson(raw) as DeckDocument;
}

function normalizeRevisionMeta(value: unknown): V3RevisionMeta | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const revision = String(raw.revision || '').trim();
  if (!revision) return null;
  return {
    revision,
    savedAt: typeof raw.savedAt === 'string' && raw.savedAt.trim() ? raw.savedAt.trim() : null,
  };
}

function cloneBlobMeta(meta: V3ProjectBlob['meta']): V3ProjectBlob['meta'] {
  return {
    decks: { ...meta.decks },
  };
}

function parseProjectBlob(value: unknown): V3ProjectBlob {
  if (value === undefined || value === null) {
    return { decks: {}, meta: { decks: {} } };
  }
  const raw = parseJsonObject(value, 'v3_state_invalid');
  const decksInput =
    raw.decks && typeof raw.decks === 'object' ? (raw.decks as Record<string, unknown>) : {};
  const decks: Record<string, DeckDocument> = {};
  Object.entries(decksInput).forEach(([deckId, deckValue]) => {
    decks[deckId] = parseDeckDocument(deckValue, deckId);
  });

  const rawMeta = raw.meta && typeof raw.meta === 'object' ? (raw.meta as Record<string, unknown>) : {};
  const rawDeckMeta =
    rawMeta.decks && typeof rawMeta.decks === 'object'
      ? (rawMeta.decks as Record<string, unknown>)
      : {};

  return {
    decks,
    meta: {
      decks: Object.fromEntries(Object.keys(decks).flatMap((deckId) => {
        const meta = normalizeRevisionMeta(rawDeckMeta[deckId]);
        return meta ? [[deckId, meta]] : [];
      })),
    },
  };
}

async function loadProjectSchema(projectId: string): Promise<{
  clause: string;
  params: any[];
  ioSchema: Record<string, unknown>;
}> {
  const { clause, params } = projectLookup(projectId);
  const { rows } = await pool.query(
    `SELECT agent_io_schema FROM ${PROJECTS_TABLE} WHERE ${clause} LIMIT 1`,
    params,
  );
  if (!rows.length) {
    throw new Error('project_not_found');
  }
  return {
    clause,
    params,
    ioSchema: parseJsonObject(rows[0].agent_io_schema, 'agent_io_schema_invalid'),
  };
}

export async function getV3ProjectBlob(projectId: string): Promise<V3ProjectBlob> {
  const { ioSchema } = await loadProjectSchema(projectId);
  return parseProjectBlob((ioSchema as any)[V3_STATE_KEY]);
}

async function writeV3ProjectBlobCas(
  projectId: string,
  updater: (blob: V3ProjectBlob) => V3ProjectBlob,
): Promise<V3ProjectBlob> {
  for (let attempt = 0; attempt < V3_SCHEMA_CAS_RETRIES; attempt += 1) {
    const { clause, params, ioSchema } = await loadProjectSchema(projectId);
    const currentBlob = parseProjectBlob((ioSchema as any)[V3_STATE_KEY]);
    const nextBlob = updater(currentBlob);
    const nextSchema = { ...ioSchema, [V3_STATE_KEY]: nextBlob };
    const result = await pool.query(
      `UPDATE ${PROJECTS_TABLE}
       SET agent_io_schema = $${params.length + 1}::jsonb, updated_at = NOW()
       WHERE ${clause}
         AND COALESCE(agent_io_schema, '{}'::jsonb) = $${params.length + 2}::jsonb
       RETURNING agent_io_schema`,
      [...params, JSON.stringify(nextSchema), JSON.stringify(ioSchema)],
    );
    if (result.rows.length > 0) {
      const savedSchema = parseJsonObject(result.rows[0].agent_io_schema, 'agent_io_schema_invalid');
      return parseProjectBlob((savedSchema as any)[V3_STATE_KEY]);
    }
  }
  throw new Error('v3_state_conflict');
}

function buildDeckResponseMeta(blob: V3ProjectBlob, deckId: string): {
  deckRevision: string | null;
  deckSavedAt: string | null;
} {
  const deckMeta = blob.meta.decks[deckId] || null;
  return {
    deckRevision: deckMeta?.revision || null,
    deckSavedAt: deckMeta?.savedAt || null,
  };
}

export async function getDeckDocument(projectId: string, deckId: string): Promise<{
  deck: DeckDocument | null;
  meta: {
    deckRevision: string | null;
    deckSavedAt: string | null;
  };
}> {
  const blob = await getV3ProjectBlob(projectId);
  return {
    deck: blob.decks[deckId] || null,
    meta: buildDeckResponseMeta(blob, deckId),
  };
}

export async function saveDeckDocument(
  projectId: string,
  deckId: string,
  document: DeckDocument,
  options?: {
    expectedRevision?: string | null;
  },
): Promise<{
  deck: DeckDocument;
  meta: {
    deckRevision: string | null;
    deckSavedAt: string | null;
  };
}> {
  const nextDeck = parseDeckDocument(document, deckId);
  const expectedRevision = String(options?.expectedRevision || '').trim() || null;
  const nextBlob = await writeV3ProjectBlobCas(projectId, (blob) => {
    const currentDeck = blob.decks[deckId] || null;
    const currentDeckMeta = currentDeck ? blob.meta.decks[deckId] || null : null;
    if (currentDeck && !currentDeckMeta) {
      throw new Error('deck_revision_missing');
    }
    if (expectedRevision && currentDeckMeta?.revision !== expectedRevision) {
      throw new Error('deck_conflict');
    }
    return {
      ...blob,
      decks: {
        ...blob.decks,
        [deckId]: nextDeck,
      },
      meta: {
        ...cloneBlobMeta(blob.meta),
        decks: {
          ...blob.meta.decks,
          [deckId]: {
            revision: randomUUID(),
            savedAt: new Date().toISOString(),
          },
        },
      },
    };
  });
  return {
    deck: nextBlob.decks[deckId],
    meta: buildDeckResponseMeta(nextBlob, deckId),
  };
}

export async function deleteDeckDocument(
  projectId: string,
  deckId: string,
): Promise<{
  deleted: boolean;
}> {
  const nextBlob = await writeV3ProjectBlobCas(projectId, (blob) => {
    if (!blob.decks[deckId]) {
      return blob;
    }
    const nextDecks = { ...blob.decks };
    const nextDeckMeta = { ...blob.meta.decks };
    delete nextDecks[deckId];
    delete nextDeckMeta[deckId];
    return {
      ...blob,
      decks: nextDecks,
      meta: {
        ...cloneBlobMeta(blob.meta),
        decks: nextDeckMeta,
      },
    };
  });

  return {
    deleted: !(deckId in nextBlob.decks),
  };
}
