import { pool } from '../../db/pool';
import {
  createEmptyV3Blackboard,
  normalizeV3Blackboard,
  resolveRuntimeBinding,
} from '../blackboard';
import type {
  AgentCardInstance,
  DeckDocument,
  DeckEdge,
  DeckRun,
  PromptTemplate,
  V3ProjectBlob,
} from '../types';

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

function normalizeDeckNode(value: unknown): AgentCardInstance | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const kind = String(raw.kind || '').trim() === 'blackboard' ? 'blackboard' : 'agent';
  const prompt = typeof raw.prompt === 'string' ? raw.prompt : '';
  const title = String(raw.title || '').trim();
  const subtitle = typeof raw.subtitle === 'string' ? raw.subtitle : undefined;
  const status =
    raw.status === 'idle' || raw.status === 'ready' || raw.status === 'running' || raw.status === 'error'
      ? raw.status
      : undefined;
  const cloneConfig =
    raw.cloneConfig && typeof raw.cloneConfig === 'object' ? raw.cloneConfig : undefined;
  const overrides =
    raw.overrides && typeof raw.overrides === 'object' ? raw.overrides : undefined;
  const position =
    raw.position && typeof raw.position === 'object'
      ? {
          x: Number((raw.position as Record<string, unknown>).x) || 0,
          y: Number((raw.position as Record<string, unknown>).y) || 0,
        }
      : { x: 0, y: 0 };
  return {
    id: String(raw.id || '').trim(),
    kind,
    templateId: String(raw.templateId || '').trim(),
    prompt,
    runtimeBinding: resolveRuntimeBinding(raw.runtimeBinding, raw.id),
    title: title || String(raw.id || '').trim(),
    subtitle,
    position,
    overrides: overrides as AgentCardInstance['overrides'],
    status,
    cloneConfig: cloneConfig as AgentCardInstance['cloneConfig'],
  };
}

function normalizeDeckEdge(value: unknown): DeckEdge | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  return {
    id: String(raw.id || '').trim(),
    source: String(raw.source || '').trim(),
    target: String(raw.target || '').trim(),
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
          .filter((node: AgentCardInstance | null): node is AgentCardInstance => Boolean(node))
      : [],
    edges: Array.isArray(raw.edges)
      ? raw.edges
          .map((edge: unknown) => normalizeDeckEdge(edge))
          .filter((edge: DeckEdge | null): edge is DeckEdge => Boolean(edge))
      : [],
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
    blackboard: normalizeV3Blackboard(raw.blackboard),
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
  blackboard: V3ProjectBlob['blackboard'];
}> {
  const blob = await getV3ProjectBlob(projectId);
  const runs = blob.deckRuns[deckId] || [];
  return {
    deck: blob.decks[deckId] || null,
    latestRun: runs[0] || null,
    runs,
    blackboard: blob.blackboard || createEmptyV3Blackboard(),
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
  blob.blackboard = normalizeV3Blackboard(run.blackboard);
  await writeV3ProjectBlob(projectId, blob);
}

export async function saveProjectBlackboard(
  projectId: string,
  blackboard: V3ProjectBlob['blackboard'],
): Promise<V3ProjectBlob['blackboard']> {
  const blob = await getV3ProjectBlob(projectId);
  blob.blackboard = normalizeV3Blackboard(blackboard);
  await writeV3ProjectBlob(projectId, blob);
  return blob.blackboard;
}
