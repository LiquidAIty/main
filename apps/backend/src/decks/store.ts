// @graph entity: DeckStore
// @graph role: deck-persistence
// @graph relates_to: AgentBuilderWorkspace
// @graph depends_on: Postgres
import { randomUUID } from 'crypto';
import { pool } from '../db/pool';
import { resolveRuntimeBinding } from '../contracts/runtimeBinding';
import type {
  AgentCardInstance,
  AgentCardRuntimeOptions,
  AgentCardRuntimeType,
  DeckDocument,
  DeckEdge,
  DeckEdgeType,
  PromptTemplate,
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

function normalizeRuntimeType(value: unknown): AgentCardRuntimeType | null {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'assistant_agent') return 'assistant_agent';
  if (normalized === 'magentic_one') return 'magentic_one';
  if (normalized === 'local_coder') return 'local_coder';
  if (normalized === 'codex_app_server') return 'codex_app_server';
  return null;
}

/** Recognise only real edge types. Anything else is classified
 * 'invalid' and persisted as such: it stays on the deck (we never silently drop
 * a user's edge) but no resolver will honour it. The previous default returned
 * 'flow' — invocation authority — for typos, legacy rows and corrupt data. */
function normalizeEdgeType(value: unknown): DeckEdgeType {
  const type = String(value || '').trim().toLowerCase();
  if (type === 'magentic_option') return 'magentic_option';
  if (type === 'magentic_control') return 'magentic_control';
  if (type === 'flow') return 'flow';
  return 'invalid';
}

function cleanOptionalText(value: unknown): string | null {
  const text = String(value || '').trim();
  return text || null;
}

function validateDeckIntegrityTransition(
  currentDeck: DeckDocument | null,
  nextDeck: DeckDocument,
) {
  if (!currentDeck || currentDeck.nodes.length === 0) return;
  if (nextDeck.nodes.length === 0) {
    throw new Error('deck_integrity_empty_nodes_blocked');
  }
  const nextNodeIds = new Set(nextDeck.nodes.map((node) => node.id));
  const removedNodeIds = currentDeck.nodes
    .map((node) => node.id)
    .filter((nodeId) => !nextNodeIds.has(nodeId));
  if (removedNodeIds.length <= 1) return;
  throw new Error('deck_integrity_multi_node_reduction_blocked');
}

function cleanToolNames(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const tools = value
    .map((tool) => (typeof tool === 'string' ? tool.trim() : ''))
    .filter(Boolean);
  return tools.length > 0 ? tools : null;
}

export function normalizeRuntimeOptions(value: unknown): AgentCardRuntimeOptions | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const provider =
    raw.provider === 'openai' ||
    raw.provider === 'openrouter' ||
    raw.provider === 'local_openai_compatible'
      ? raw.provider
      : null;
  const normalized: AgentCardRuntimeOptions = {
    provider,
    modelKey: typeof raw.modelKey === 'string' ? raw.modelKey.trim() || null : null,
    temperature: Number.isFinite(Number(raw.temperature)) ? Number(raw.temperature) : null,
    maxTokens: Number.isFinite(Number(raw.maxTokens)) ? Number(raw.maxTokens) : null,
    maxTurns: Number.isFinite(Number(raw.maxTurns)) ? Number(raw.maxTurns) : null,
    tools: cleanToolNames(raw.tools),
    nativeTools: cleanToolNames(raw.nativeTools),
  };
  return normalized;
}

function normalizeDeckNode(value: unknown): AgentCardInstance | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const kind = String(raw.kind || '').trim().toLowerCase();
  if (kind && kind !== 'agent') {
    return null;
  }
  const prompt = typeof raw.prompt === 'string' ? raw.prompt : '';
  const title = String(raw.title || '').trim();
  const subtitle = typeof raw.subtitle === 'string' ? raw.subtitle : undefined;
  const status =
    raw.status === 'idle' || raw.status === 'ready' || raw.status === 'running' || raw.status === 'error'
      ? raw.status
      : undefined;
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
    kind: 'agent',
    templateId: String(raw.templateId || '').trim(),
    prompt,
    runtimeBinding: resolveRuntimeBinding(raw.runtimeBinding),
    runtimeType: normalizeRuntimeType(raw.runtimeType),
    runtimeOptions: normalizeRuntimeOptions(raw.runtimeOptions),
    parentGraphId: typeof raw.parentGraphId === 'string' ? raw.parentGraphId.trim() || null : null,
    tools: cleanToolNames(raw.tools) || undefined,
    title: title || String(raw.id || '').trim(),
    subtitle,
    position,
    overrides: overrides as AgentCardInstance['overrides'],
    status,
  } as AgentCardInstance;
}

function normalizeDeckEdge(value: unknown): DeckEdge | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const sourceHandle = cleanOptionalText(raw.sourceHandle);
  const targetHandle = cleanOptionalText(raw.targetHandle);
  return {
    id: String(raw.id || '').trim(),
    source: String(raw.source || '').trim(),
    sourceHandle,
    target: String(raw.target || '').trim(),
    targetHandle,
    edgeType: normalizeEdgeType(raw.edgeType),
  };
}

function normalizeDeckDocument(value: unknown, fallbackId: string): DeckDocument | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as any;
  const deck = {
    id: String(raw.id || fallbackId).trim() || fallbackId,
    name: String(raw.name || 'Deck').trim() || 'Deck',
    workspaceRoot: cleanOptionalText(raw.workspaceRoot),
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
  return deck;
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

function normalizeProjectBlob(value: unknown): V3ProjectBlob {
  const raw = normalizeJson(value, {} as Record<string, unknown>);
  const decksInput =
    raw.decks && typeof raw.decks === 'object' ? (raw.decks as Record<string, unknown>) : {};
  const decks: Record<string, DeckDocument> = {};
  Object.entries(decksInput).forEach(([deckId, deckValue]) => {
    const deck = normalizeDeckDocument(deckValue, deckId);
    if (deck) decks[deckId] = deck;
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
    ioSchema: normalizeJson(rows[0].agent_io_schema, {} as Record<string, unknown>),
  };
}

export async function getV3ProjectBlob(projectId: string): Promise<V3ProjectBlob> {
  const { ioSchema } = await loadProjectSchema(projectId);
  return normalizeProjectBlob((ioSchema as any)[V3_STATE_KEY]);
}

async function writeV3ProjectBlobCas(
  projectId: string,
  updater: (blob: V3ProjectBlob) => V3ProjectBlob,
): Promise<V3ProjectBlob> {
  for (let attempt = 0; attempt < V3_SCHEMA_CAS_RETRIES; attempt += 1) {
    const { clause, params, ioSchema } = await loadProjectSchema(projectId);
    const currentBlob = normalizeProjectBlob((ioSchema as any)[V3_STATE_KEY]);
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
      const savedSchema = normalizeJson(result.rows[0].agent_io_schema, {} as Record<string, unknown>);
      return normalizeProjectBlob((savedSchema as any)[V3_STATE_KEY]);
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
  const nextDeck = normalizeDeckDocument({ ...document, id: deckId }, deckId);
  if (!nextDeck) {
    throw new Error('invalid_deck_document');
  }
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
    validateDeckIntegrityTransition(currentDeck, nextDeck);
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
