import { pool } from '../../db/pool';
import type { DeckDocument, DeckRun, PromptTemplate, V3ProjectBlob } from '../types';

const PROJECTS_TABLE = 'ag_catalog.projects';
const V3_STATE_KEY = 'v3_state';
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function projectLookup(projectId: string): { clause: string; params: any[] } {
  if (UUID_REGEX.test(projectId)) {
    return { clause: 'id = $1', params: [projectId] };
  }
  return { clause: 'code = $1', params: [projectId] };
}

function normalizeJson<TDefault>(value: unknown, fallback: TDefault): TDefault {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object') {
        return parsed as TDefault;
      }
    } catch {
      return fallback;
    }
  }
  if (value && typeof value === 'object') {
    return value as TDefault;
  }
  return fallback;
}

function normalizeRuntimeBinding(value: unknown): 'main_chat' | null {
  return value === 'main_chat' ? 'main_chat' : null;
}

function normalizeDeckNode(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  return {
    ...raw,
    runtimeBinding: normalizeRuntimeBinding(raw.runtimeBinding),
  };
}

function normalizeDeckDocument(value: unknown, fallbackId: string): DeckDocument | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as any;
  return {
    id: String(raw.id || fallbackId).trim() || fallbackId,
    name: String(raw.name || 'Deck').trim() || 'Deck',
    promptTemplates: Array.isArray(raw.promptTemplates)
      ? (raw.promptTemplates as PromptTemplate[]).filter(
          (template) =>
            template &&
            typeof template === 'object' &&
            typeof template.id === 'string' &&
            typeof template.content === 'string',
        )
      : [],
    version: Number.isFinite(Number(raw.version)) ? Number(raw.version) : 1,
    nodes: Array.isArray(raw.nodes)
      ? raw.nodes
          .map((node: unknown) => normalizeDeckNode(node))
          .filter((node: Record<string, unknown> | null): node is Record<string, unknown> => Boolean(node))
      : [],
    edges: Array.isArray(raw.edges) ? raw.edges : [],
  };
}

function normalizeDeckRuns(value: unknown): DeckRun[] {
  return Array.isArray(value) ? (value as DeckRun[]) : [];
}

function normalizeProjectBlob(value: unknown): V3ProjectBlob {
  const raw = normalizeJson(value, {} as Record<string, unknown>);
  const decksInput =
    raw.decks && typeof raw.decks === 'object' ? (raw.decks as Record<string, unknown>) : {};
  const deckRunsInput =
    raw.deckRuns && typeof raw.deckRuns === 'object'
      ? (raw.deckRuns as Record<string, unknown>)
      : {};

  const decks: Record<string, DeckDocument> = {};
  Object.entries(decksInput).forEach(([deckId, deckValue]) => {
    const deck = normalizeDeckDocument(deckValue, deckId);
    if (deck) decks[deckId] = deck;
  });

  const deckRuns: Record<string, DeckRun[]> = {};
  Object.entries(deckRunsInput).forEach(([deckId, runsValue]) => {
    deckRuns[deckId] = normalizeDeckRuns(runsValue);
  });

  return {
    decks,
    deckRuns,
    hiddenTelemetry:
      raw.hiddenTelemetry && typeof raw.hiddenTelemetry === 'object'
        ? (raw.hiddenTelemetry as Record<string, unknown>)
        : {},
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
    ioSchema: normalizeJson(rows[0].agent_io_schema, {} as Record<string, unknown>),
  };
}

export async function getV3ProjectBlob(projectId: string): Promise<V3ProjectBlob> {
  const { ioSchema } = await loadProjectSchema(projectId);
  return normalizeProjectBlob((ioSchema as any)[V3_STATE_KEY]);
}

async function writeV3ProjectBlob(projectId: string, blob: V3ProjectBlob): Promise<void> {
  const { clause, params, ioSchema } = await loadProjectSchema(projectId);
  const nextSchema = { ...ioSchema, [V3_STATE_KEY]: blob };
  await pool.query(
    `UPDATE ${PROJECTS_TABLE} SET agent_io_schema = $2, updated_at = NOW() WHERE ${clause}`,
    [...params, JSON.stringify(nextSchema)],
  );
}

export async function getDeckDocument(projectId: string, deckId: string): Promise<{
  deck: DeckDocument | null;
  latestRun: DeckRun | null;
  runs: DeckRun[];
}> {
  const blob = await getV3ProjectBlob(projectId);
  const runs = blob.deckRuns[deckId] || [];
  return {
    deck: blob.decks[deckId] || null,
    latestRun: runs[0] || null,
    runs,
  };
}

export async function saveDeckDocument(
  projectId: string,
  deckId: string,
  document: DeckDocument,
): Promise<DeckDocument> {
  const blob = await getV3ProjectBlob(projectId);
  const nextDeck = normalizeDeckDocument({ ...document, id: deckId }, deckId);
  if (!nextDeck) {
    throw new Error('invalid_deck_document');
  }
  blob.decks[deckId] = nextDeck;
  await writeV3ProjectBlob(projectId, blob);
  return nextDeck;
}

export async function saveDeckRun(projectId: string, deckId: string, run: DeckRun): Promise<void> {
  const blob = await getV3ProjectBlob(projectId);
  const currentRuns = blob.deckRuns[deckId] || [];
  blob.deckRuns[deckId] = [run, ...currentRuns].slice(0, 12);
  await writeV3ProjectBlob(projectId, blob);
}
