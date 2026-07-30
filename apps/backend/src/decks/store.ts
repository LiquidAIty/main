// @graph entity: DeckStore
// @graph role: deck-persistence
// @graph relates_to: AgentBuilderWorkspace
// @graph depends_on: Postgres
import { createHash, randomUUID } from 'crypto';
import { pool } from '../db/pool';
import { normalizeLocalCoderControllerCard } from '../cards/localCoderController';
import { resolveRuntimeBinding } from '../contracts/runtimeBinding';
import {
  buildMainChatControlEdge,
  buildMainChatControllerCard,
  MAIN_CHAT_CARD_ID,
  MAIN_CHAT_MODEL_KEY,
  MAIN_CHAT_PROMPT_ID,
  MAIN_CHAT_PROMPT_TEMPLATE,
  MAIN_CHAT_PROVIDER,
} from './mainChatControllerCard';
import type {
  AgentCardInstance,
  AgentCardRuntimeOptions,
  AgentCardRuntimeType,
  DeckDocument,
  DeckEdge,
  DeckEdgeExecutionMode,
  DeckEdgeMergeIntent,
  DeckEdgeMetadata,
  DeckEdgeRole,
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
const OBSOLETE_GRAPH_TOOL_GRANTS = new Set([
  'codegraph.status',
  'codegraph.search',
]);
const MAIN_BLOCKED_TOOL_GRANTS = new Set([
  'engraphis.engraphis_stats',
]);
const MAIN_NATIVE_GRAPH_TOOL_GRANTS = [
  'engraphis.engraphis_recall',
  'engraphis.engraphis_recall_grounded',
  'engraphis.engraphis_answer',
  'engraphis.engraphis_why',
  'engraphis.engraphis_timeline',
] as const;
const HERMES_NATIVE_GRAPH_TOOL_GRANTS = [
  'graphiti.search_nodes',
  'graphiti.search_memory_facts',
  'graphiti.get_entity_edge',
  'graphiti.get_episodes',
  'graphiti.get_episode_entities',
  'graphiti.get_status',
  'graphiti.add_memory',
  'graphiti.add_triplet',
] as const;
const CODER_NATIVE_CBM_TOOL_GRANTS = [
  'cbm.index_repository',
  'cbm.search_graph',
  'cbm.query_graph',
  'cbm.trace_path',
  'cbm.get_code_snippet',
  'cbm.get_graph_schema',
  'cbm.get_architecture',
  'cbm.search_code',
  'cbm.list_projects',
  'cbm.index_status',
  'cbm.detect_changes',
] as const;

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
  if (type === 'hermes_observe') return 'hermes_observe';
  return 'invalid';
}

const EDGE_ROLE_VALUES = new Set<DeckEdgeRole>([
  'graph_execution',
  'callable_route',
  'reconcile_input',
  'compatibility_legacy',
]);

const EDGE_EXECUTION_MODE_VALUES = new Set<DeckEdgeExecutionMode>([
  'required',
  'optional',
  'conditional',
]);

const EDGE_MERGE_INTENT_VALUES = new Set<DeckEdgeMergeIntent>([
  'all_inputs',
  'any_input',
  'first_success',
  'summarize_all',
  'select_best',
  'manual_review',
]);

function cleanOptionalText(value: unknown): string | null {
  const text = String(value || '').trim();
  return text || null;
}

function cleanOptionalNumber(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : null;
}

function cleanOptionalBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
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

function normalizeDeckEdgeMetadata(value: unknown): DeckEdgeMetadata | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const normalized: DeckEdgeMetadata = {
    role: EDGE_ROLE_VALUES.has(raw.role as DeckEdgeRole) ? (raw.role as DeckEdgeRole) : null,
    executionMode: EDGE_EXECUTION_MODE_VALUES.has(raw.executionMode as DeckEdgeExecutionMode)
      ? (raw.executionMode as DeckEdgeExecutionMode)
      : null,
    conditionType: cleanOptionalText(raw.conditionType),
    conditionExpression: cleanOptionalText(raw.conditionExpression),
    conditionLabel: cleanOptionalText(raw.conditionLabel),
    priority: cleanOptionalNumber(raw.priority),
    order: cleanOptionalNumber(raw.order),
    weight: cleanOptionalNumber(raw.weight),
    mergeIntent: EDGE_MERGE_INTENT_VALUES.has(raw.mergeIntent as DeckEdgeMergeIntent)
      ? (raw.mergeIntent as DeckEdgeMergeIntent)
      : null,
    legacyCompatibility: cleanOptionalBoolean(raw.legacyCompatibility),
    loopMaxIterations: cleanOptionalNumber(raw.loopMaxIterations),
    loopExitText: cleanOptionalText(raw.loopExitText),
  };
  return Object.values(normalized).some((entry) => entry !== null) ? normalized : null;
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
  const allowRepeatedSpeaker =
    typeof raw.allowRepeatedSpeaker === 'boolean'
      ? raw.allowRepeatedSpeaker
      : raw.repeatedSpeakerBehavior === 'allow'
        ? true
        : raw.repeatedSpeakerBehavior === 'prevent' || raw.repeatedSpeakerBehavior === 'avoid'
          ? false
          : null;
  const normalized: AgentCardRuntimeOptions = {
    provider,
    executionBackend: raw.executionBackend === 'python_autogen' ? 'python_autogen' : null,
    modelKey: typeof raw.modelKey === 'string' ? raw.modelKey.trim() || null : null,
    temperature: Number.isFinite(Number(raw.temperature)) ? Number(raw.temperature) : null,
    maxTokens: Number.isFinite(Number(raw.maxTokens)) ? Number(raw.maxTokens) : null,
    streaming: raw.streaming === true ? true : null,
    emitTeamEvents: raw.emitTeamEvents === true ? true : null,
    executionMode:
      raw.executionMode === 'swarm'
        ? 'swarm'
        : raw.executionMode === 'single'
          ? 'single'
          : null,
    swarmMaxWorkers: Number.isFinite(Number(raw.swarmMaxWorkers))
      ? Number(raw.swarmMaxWorkers)
      : null,
    swarmWorkerPromptTemplate:
      typeof raw.swarmWorkerPromptTemplate === 'string'
        ? raw.swarmWorkerPromptTemplate.trim() || null
        : null,
    useSocietyOfMindConsolidation:
      raw.useSocietyOfMindConsolidation === true ? true : null,
    maxTurns: Number.isFinite(Number(raw.maxTurns)) ? Number(raw.maxTurns) : null,
    maxStalls: Number.isFinite(Number(raw.maxStalls)) ? Number(raw.maxStalls) : null,
    finalAnswerPrompt:
      typeof raw.finalAnswerPrompt === 'string' ? raw.finalAnswerPrompt.trim() || null : null,
    selectorPrompt:
      typeof raw.selectorPrompt === 'string' ? raw.selectorPrompt.trim() || null : null,
    allowRepeatedSpeaker,
    localCoderMode:
      raw.localCoderMode === 'terminal'
        ? 'terminal'
        : raw.localCoderMode === 'headless'
          ? 'headless'
          : null,
    localCoderAccess:
      raw.localCoderAccess === 'patch'
        ? 'patch'
        : raw.localCoderAccess === 'test'
          ? 'test'
          : raw.localCoderAccess === 'read'
            ? 'read'
            : null,
    role: cleanOptionalText(raw.role),
    tools: cleanToolNames(raw.tools),
    nativeTools: cleanToolNames(raw.nativeTools),
  };
  return normalized;
}

function normalizeDeckNode(value: unknown): AgentCardInstance | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (String(raw.kind || '').trim().toLowerCase() === 'blackboard') {
    return null;
  }
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
  return normalizeLocalCoderControllerCard({
    id: String(raw.id || '').trim(),
    kind: 'agent',
    templateId: String(raw.templateId || '').trim(),
    prompt,
    runtimeBinding: resolveRuntimeBinding(raw.runtimeBinding, raw.id),
    runtimeType: normalizeRuntimeType(raw.runtimeType) || 'assistant_agent',
    runtimeOptions: normalizeRuntimeOptions(raw.runtimeOptions),
    parentGraphId: typeof raw.parentGraphId === 'string' ? raw.parentGraphId.trim() || null : null,
    tools: cleanToolNames(raw.tools) || undefined,
    title: title || String(raw.id || '').trim(),
    subtitle,
    position,
    overrides: overrides as AgentCardInstance['overrides'],
    status,
    cloneConfig: cloneConfig as AgentCardInstance['cloneConfig'],
  } as AgentCardInstance);
}

function normalizeDeckEdge(value: unknown): DeckEdge | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const metadata = normalizeDeckEdgeMetadata(raw.metadata);
  const sourceHandle = cleanOptionalText(raw.sourceHandle);
  const targetHandle = cleanOptionalText(raw.targetHandle);
  return {
    id: String(raw.id || '').trim(),
    source: String(raw.source || '').trim(),
    sourceHandle,
    target: String(raw.target || '').trim(),
    targetHandle,
    edgeType: normalizeEdgeType(raw.edgeType),
    ...(metadata ? { metadata } : {}),
  };
}

function ensureMainChatControllerCard(deck: DeckDocument): DeckDocument {
  if (deck.id !== BUILDER_DECK_ID) return deck;
  const promptTemplateExists = deck.promptTemplates.some((template) => template.id === MAIN_CHAT_PROMPT_ID);
  const promptTemplates = promptTemplateExists
    ? deck.promptTemplates
    : [MAIN_CHAT_PROMPT_TEMPLATE, ...deck.promptTemplates];
  const mainChatMatches = deck.nodes.filter(
    (node) =>
      resolveRuntimeBinding((node.runtimeOptions as any)?.binding ?? node.runtimeBinding, node.id) ===
      'main_chat',
  );
  const prompt =
    mainChatMatches[0]?.prompt?.trim() ||
    promptTemplates.find((template) => template.id === MAIN_CHAT_PROMPT_ID)?.content ||
    MAIN_CHAT_PROMPT_TEMPLATE.content;
  const nodes =
    mainChatMatches.length === 0
      ? [buildMainChatControllerCard(prompt), ...deck.nodes]
      : deck.nodes.map((node) => {
          if (node.id !== mainChatMatches[0].id) return node;
          return normalizeDeckNode({
            ...node,
            id: MAIN_CHAT_CARD_ID,
            title: node.title?.trim() || 'Main Chat / Harness',
            subtitle: node.subtitle?.trim() || 'Native Harness front door',
            templateId: node.templateId?.trim() || 'template_main_chat',
            prompt,
            runtimeBinding: 'main_chat',
            runtimeType: 'assistant_agent',
            runtimeOptions: {
              ...(node.runtimeOptions || {}),
              provider: node.runtimeOptions?.provider || MAIN_CHAT_PROVIDER,
              modelKey: node.runtimeOptions?.modelKey || MAIN_CHAT_MODEL_KEY,
            },
            parentGraphId: null,
          }) || node;
        });
  // Main Chat's bus relationship is CONTROL-only (dedicated top input). A
  // legacy worker-slot edge (magentic_option into a bus-in-* handle) is
  // retired stale wiring: drop it so Main Chat can never resolve as a worker,
  // and ensure exactly one control edge exists.
  const edges = deck.edges.filter(
    (edge) =>
      !(
        edge.edgeType === 'magentic_option' &&
        ((edge.source === MAIN_CHAT_CARD_ID && edge.target === 'card_magentic') ||
          (edge.target === MAIN_CHAT_CARD_ID && edge.source === 'card_magentic'))
      ),
  );
  const hasControlEdge = edges.some(
    (edge) =>
      edge.edgeType === 'magentic_control' &&
      ((edge.source === MAIN_CHAT_CARD_ID && edge.target === 'card_magentic') ||
        (edge.target === MAIN_CHAT_CARD_ID && edge.source === 'card_magentic')),
  );
  const finalEdges = hasControlEdge ? edges : [buildMainChatControlEdge(), ...edges];
  return { ...deck, promptTemplates, nodes, edges: finalEdges };
}

/**
 * Replace obsolete graph-wrapper grants with role-appropriate native MCP tools.
 * This changes saved authorization only; upstream MCP catalogs remain the tool
 * schema and behavior authorities.
 */
export function repairNativeGraphToolGrants(deck: DeckDocument): DeckDocument {
  if (deck.id !== BUILDER_DECK_ID) return deck;
  let changed = false;
  const nodes = deck.nodes.map((node) => {
    const binding = resolveRuntimeBinding(
      (node.runtimeOptions as any)?.binding ?? node.runtimeBinding,
      node.id,
    );
    const required =
      binding === 'main_chat'
        ? MAIN_NATIVE_GRAPH_TOOL_GRANTS
        : binding === 'hermes_steward'
          ? HERMES_NATIVE_GRAPH_TOOL_GRANTS
          : binding === 'local_coder'
            ? CODER_NATIVE_CBM_TOOL_GRANTS
            : [];
    const selected = Array.isArray(node.runtimeOptions?.tools)
      ? node.runtimeOptions.tools
          .map((tool) => String(tool || '').trim())
          .filter(Boolean)
          .filter(
            (tool) =>
              !OBSOLETE_GRAPH_TOOL_GRANTS.has(tool) &&
              !(binding === 'main_chat' && MAIN_BLOCKED_TOOL_GRANTS.has(tool)) &&
              !tool.startsWith('knowgraph.'),
          )
          .map((tool) =>
            tool.startsWith('engraphis_') ? `engraphis.${tool}` : tool,
          )
      : [];
    const repaired = Array.from(new Set([...selected, ...required]));
    const current = Array.isArray(node.runtimeOptions?.tools)
      ? node.runtimeOptions.tools
      : [];
    if (
      repaired.length === current.length &&
      repaired.every((tool, index) => tool === current[index])
    ) {
      return node;
    }

    changed = true;
    return {
      ...node,
      runtimeOptions: {
        ...node.runtimeOptions,
        tools: repaired,
      },
    };
  });
  return changed ? { ...deck, nodes } : deck;
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
  return repairNativeGraphToolGrants(ensureMainChatControllerCard(deck));
}

function hashRevision(value: unknown): string {
  return createHash('sha1').update(JSON.stringify(value ?? null), 'utf8').digest('hex');
}

function normalizeRevisionMeta(value: unknown, fallbackValue: unknown): V3RevisionMeta {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  return {
    revision: String(raw.revision || '').trim() || `legacy:${hashRevision(fallbackValue)}`,
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
  const deckRunsInput =
    raw.deckRuns && typeof raw.deckRuns === 'object'
      ? (raw.deckRuns as Record<string, unknown>)
      : {};

  const decks: Record<string, DeckDocument> = {};
  Object.entries(decksInput).forEach(([deckId, deckValue]) => {
    const deck = normalizeDeckDocument(deckValue, deckId);
    if (deck) decks[deckId] = deck;
  });

  const deckRuns: Record<string, unknown[]> = {};
  Object.entries(deckRunsInput).forEach(([deckId, runsValue]) => {
    // Historical run JSON is preserved byte-for-structure during ordinary
    // deck saves, but it is no longer interpreted or exposed as live runtime.
    deckRuns[deckId] = Array.isArray(runsValue) ? runsValue : [];
  });

  const rawMeta = raw.meta && typeof raw.meta === 'object' ? (raw.meta as Record<string, unknown>) : {};
  const rawDeckMeta =
    rawMeta.decks && typeof rawMeta.decks === 'object'
      ? (rawMeta.decks as Record<string, unknown>)
      : {};

  return {
    decks,
    deckRuns,
    hiddenTelemetry:
      raw.hiddenTelemetry && typeof raw.hiddenTelemetry === 'object'
        ? (raw.hiddenTelemetry as Record<string, unknown>)
        : {},
    meta: {
      decks: Object.fromEntries(
        Object.entries(decks).map(([deckId, deck]) => [
          deckId,
          normalizeRevisionMeta(rawDeckMeta[deckId], deck),
        ]),
      ),
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
    const currentDeckMeta = currentDeck
      ? blob.meta.decks[deckId] || normalizeRevisionMeta(null, currentDeck)
      : null;
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
    const nextDeckRuns = { ...blob.deckRuns };
    const nextDeckMeta = { ...blob.meta.decks };
    delete nextDecks[deckId];
    delete nextDeckRuns[deckId];
    delete nextDeckMeta[deckId];
    return {
      ...blob,
      decks: nextDecks,
      deckRuns: nextDeckRuns,
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
