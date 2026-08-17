// @graph entity: KnowGraphRoute
// @graph role: knowgraph-gateway
// @graph relates_to: AgentBuilderWorkspace, KnowGraph API, KnowGraph
// @graph depends_on: Express, Neo4j, KnowGraph API
// @graph feeds_to: KnowGraph API, KnowGraph
import axios from 'axios';
import { Router } from 'express';
import multer from 'multer';
import { pool } from '../db/pool';
import { resolveCardModelStrict } from '../cards/runtime';
import { BUILDER_DECK_ID, getDeckDocument } from '../decks/store';
import { isDevTestModeEnabled } from '../services/devTest';

const router = Router();
// DEV TEST LIMIT RAISED: allow large real-document uploads during development and loop testing.
const KNOWGRAPH_UPLOAD_MAX_FILE_SIZE_BYTES = Math.max(
  1_000_000,
  Number(
    process.env.KNOWGRAPH_UPLOAD_MAX_FILE_SIZE_BYTES ||
      (isDevTestModeEnabled() ? 512 * 1024 * 1024 : 25 * 1024 * 1024),
  ),
);
function looksLikePdfUpload(file: { mimetype?: string; originalname?: string } | null | undefined): boolean {
  if (!file) return false;
  const fileName = String(file.originalname || '').toLowerCase();
  const fileType = String(file.mimetype || '').toLowerCase();
  return fileName.endsWith('.pdf') || fileType === 'application/pdf' || fileType.includes('/pdf');
}
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: KNOWGRAPH_UPLOAD_MAX_FILE_SIZE_BYTES,
    files: 1,
    parts: 12,
    fields: 10,
  },
  fileFilter: (_req, file, cb) => {
    if (!looksLikePdfUpload(file)) {
      cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'file'));
      return;
    }
    cb(null, true);
  },
});
const knowgraphUploadSingle = (req: any, res: any, next: any) => {
  upload.single('file')(req, res, (err: any) => {
    if (!err) {
      next();
      return;
    }
    if (err instanceof multer.MulterError) {
      const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      const message =
        err.code === 'LIMIT_FILE_SIZE'
          ? 'Attached PDF exceeds the current upload size limit.'
          : 'Only a single PDF file is accepted for KnowGraph ingest.';
      res.status(status).json({ ok: false, error: { message } });
      return;
    }
    next(err);
  });
};

type UploadedFile = {
  buffer: Buffer;
  mimetype?: string;
  originalname?: string;
};

type KnowGraphNodeDto = {
  id: string;
  label: string;
  type: string;
  source: 'know';
  properties: Record<string, unknown>;
};

type KnowGraphRelationshipDto = {
  id: string;
  from: string;
  to: string;
  type: string;
  source: 'know';
  properties: Record<string, unknown>;
};

async function resolveAuthenticatedKnowGraphProjectId(
  userId: string,
  requestedProjectId: string,
): Promise<string | null> {
  const ownerUserId = String(userId || '').trim();
  const selector = String(requestedProjectId || '').trim();
  if (!ownerUserId || !selector) return null;

  const result = await pool.query(
    `
      SELECT id::text AS id
      FROM ag_catalog.projects
      WHERE owner_user_id::text = $1
        AND (
          id::text = $2
          OR lower(coalesce(name, '')) = lower($2)
          OR lower(coalesce(code, '')) = lower($2)
        )
      LIMIT 1
    `,
    [ownerUserId, selector],
  );
  const canonicalProjectId = String(result?.rows?.[0]?.id || '').trim();
  return canonicalProjectId || null;
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function trimBaseUrl(value: string): string {
  return value.replace(/\/+$/, '');
}

function toNeoJsonValue(value: any): any {
  if (value == null) return value;
  if (Array.isArray(value)) return value.map((v) => toNeoJsonValue(v));
  if (typeof value !== 'object') return value;

  if (typeof value.toNumber === 'function') {
    try {
      return value.toNumber();
    } catch {
      // fall through to recursive object copy
    }
  }

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = toNeoJsonValue(v);
  }
  return out;
}

function neoNodeLabel(id: string, props: Record<string, unknown>): string {
  const candidates = [props.name, props.title, props.label, props.id, props.document_id, props.chunk_id];
  for (const candidate of candidates) {
    const text = String(candidate ?? '').trim();
    if (text) return text;
  }
  return id;
}

async function resolveKnowGraphProjectScopeIds(projectId: string): Promise<string[]> {
  const scopeProjectId = String(projectId || '').trim();
  if (!scopeProjectId) return [];

  const scopeIds = new Set<string>();
  const addScopeId = (rawValue: unknown) => {
    const value = String(rawValue || '').trim();
    if (!value) return;
    scopeIds.add(value);

    // Graphiti namespaces project data with the canonical prefix defined by
    // services/knowgraph/graphiti_identity.py. Keep aliases for legacy data,
    // but always include the namespace used by the live native importer.
    if (/^[A-Za-z0-9_-]+$/.test(value) && !value.startsWith('liquidaity-')) {
      scopeIds.add(`liquidaity-${value}`);
    }
  };
  addScopeId(scopeProjectId);
  try {
    const result = await pool.query(
      `
        SELECT
          id::text AS id,
          coalesce(name, '') AS name,
          coalesce(code, '') AS code
        FROM ag_catalog.projects
        WHERE id::text = $1
           OR lower(coalesce(name, '')) = lower($1)
           OR lower(coalesce(code, '')) = lower($1)
        LIMIT 1
      `,
      [scopeProjectId],
    );
    const row = result?.rows?.[0] as { id?: string; name?: string; code?: string } | undefined;
    if (row) {
      for (const rawValue of [row.id, row.name, row.code]) {
        addScopeId(rawValue);
      }
    }
  } catch (error: any) {
    console.warn('[KNOWGRAPH][SCOPE] project alias resolution failed:', error?.message || error);
  }

  return Array.from(scopeIds);
}

// SkillGraph (services/knowgraph/skill_ingest.py) shares this Neo4j database but uses its OWN node
// labels. The KnowGraph reads below scope by Graphiti group_id but are otherwise label-blind, so :Skill*
// nodes would leak into the KnowGraph canvas. Exclude the skill-graph labels from every KnowGraph
// read. KnowGraph itself never writes these labels (it writes :SemanticRecord / :SourceBackedAssertion
// / :Entity / :Source / :Observation / ...), so this can only remove skill nodes, never hide evidence.
const SKILL_GRAPH_LABELS = ['Skill', 'SkillAttempt', 'FailedAttempt', 'Decision', 'Guardrail', 'QueryPattern', 'SkillSection'] as const;
function notSkillNode(varName: string): string {
  return `NOT (${SKILL_GRAPH_LABELS.map((label) => `${varName}:${label}`).join(' OR ')})`;
}

function _neoInt(v: any): number {
  return Number(v?.toNumber?.() ?? v ?? 0);
}

// List the distinct Graphiti group scopes present in Neo4j, with a
// human label + counts, so the UI can open ANY real KnowGraph scope directly — e.g.
// an imported book under its own canonical scope — without moving or re-keying data.
async function listKnowGraphScopes(): Promise<
  Array<{ scope: string; label: string; nodes: number; concepts: number; documents: number }>
> {
  const uri = String(process.env.NEO4J_URI || '').trim();
  const user = String(process.env.NEO4J_USER || '').trim();
  const password = String(process.env.NEO4J_PASSWORD || '').trim();
  if (!uri || !user || !password) throw new Error('NEO4J_URI, NEO4J_USER, and NEO4J_PASSWORD are required');
  const neo4jModule: any = await import('neo4j-driver');
  const neo4j: any = neo4jModule?.default ?? neo4jModule;
  const driver = neo4j.driver(uri, neo4j.auth.basic(user, password));
  const database = String(process.env.NEO4J_DATABASE || '').trim();
  const session = driver.session(database ? { database } : undefined);
  try {
    const r = await session.run(
      `
        MATCH (n) WHERE n.group_id IS NOT NULL AND ${notSkillNode('n')}
        WITH toString(n.group_id) AS scope, collect(n) AS ns
        RETURN scope,
          size(ns) AS nodes,
          size([x IN ns WHERE 'Entity' IN labels(x)]) AS concepts,
          size([x IN ns WHERE 'Episodic' IN labels(x)]) AS documents,
          head([x IN ns WHERE 'Episodic' IN labels(x) | coalesce(x.source_name, x.name, x.document_id)]) AS label
        ORDER BY nodes DESC
      `,
    );
    return r.records.map((rec: any) => ({
      scope: String(rec.get('scope')),
      label: String(rec.get('label') || rec.get('scope')),
      nodes: _neoInt(rec.get('nodes')),
      concepts: _neoInt(rec.get('concepts')),
      documents: _neoInt(rec.get('documents')),
    }));
  } finally {
    await session.close();
    await driver.close();
  }
}

async function queryKnowGraphProject(projectId: string): Promise<{
  nodes: KnowGraphNodeDto[];
  relationships: KnowGraphRelationshipDto[];
}> {
  const uri = String(process.env.NEO4J_URI || '').trim();
  const user = String(process.env.NEO4J_USER || '').trim();
  const password = String(process.env.NEO4J_PASSWORD || '').trim();

  if (!uri || !user || !password) {
    throw new Error('NEO4J_URI, NEO4J_USER, and NEO4J_PASSWORD are required');
  }

  const neo4jModule: any = await import('neo4j-driver');
  const neo4j: any = neo4jModule?.default ?? neo4jModule;
  const driver = neo4j.driver(uri, neo4j.auth.basic(user, password));
  const database = String(process.env.NEO4J_DATABASE || '').trim();
  const session = driver.session(database ? { database } : undefined);
  const projectScopeIds = await resolveKnowGraphProjectScopeIds(projectId);

  try {
    const nodeMap = new Map<string, KnowGraphNodeDto>();

    const upsertNode = (idRaw: unknown, labelsRaw: unknown, propsRaw: unknown) => {
      const rawId = String(idRaw ?? '').trim();
      if (!rawId) return;

      const labels = Array.isArray(labelsRaw) ? labelsRaw.map((x) => String(x)) : [];
      const props = toNeoJsonValue(propsRaw || {}) as Record<string, unknown>;

      if (!nodeMap.has(rawId)) {
        nodeMap.set(rawId, {
          id: rawId,
          label: neoNodeLabel(rawId, props),
          // Prefer the persisted owlClass property (records written via the
          // :SemanticRecord MERGE share that label); fall back to the node label
          // for legacy records whose label already encodes the owlClass.
          type: String((props as any).owlClass || labels[0] || 'NeoEntity'),
          source: 'know',
          properties: props,
        });
      }
    };

    const relResult = await session.run(
      `
        MATCH (a)-[r]->(b)
        WHERE toString(a.group_id) IN $projectScopeIds
          AND toString(b.group_id) IN $projectScopeIds
          AND toString(r.group_id) IN $projectScopeIds
          AND ${notSkillNode('a')} AND ${notSkillNode('b')}
        RETURN DISTINCT
          elementId(r) AS rel_id,
          type(r) AS rel_type,
          properties(r) AS rel_props,
          elementId(a) AS from_id,
          labels(a) AS from_labels,
          properties(a) AS from_props,
          elementId(b) AS to_id,
          labels(b) AS to_labels,
          properties(b) AS to_props
      `,
      { projectScopeIds },
    );

    const relationships: KnowGraphRelationshipDto[] = [];

    relResult.records.forEach((record: any) => {
      const relId = String(record.get('rel_id') ?? '').trim();
      const fromId = String(record.get('from_id') ?? '').trim();
      const toId = String(record.get('to_id') ?? '').trim();
      if (!relId || !fromId || !toId) return;

      upsertNode(record.get('from_id'), record.get('from_labels'), record.get('from_props'));
      upsertNode(record.get('to_id'), record.get('to_labels'), record.get('to_props'));

      relationships.push({
        id: relId,
        from: fromId,
        to: toId,
        type: String(record.get('rel_type') || 'RELATED_TO'),
        source: 'know',
        properties: (toNeoJsonValue(record.get('rel_props') || {}) || {}) as Record<string, unknown>,
      });
    });

    const nodeResult = await session.run(
      `
        MATCH (n)
        WHERE toString(n.group_id) IN $projectScopeIds
          AND ${notSkillNode('n')}
        RETURN DISTINCT elementId(n) AS node_id, labels(n) AS node_labels, properties(n) AS node_props
      `,
      { projectScopeIds },
    );

    nodeResult.records.forEach((record: any) => {
      upsertNode(record.get('node_id'), record.get('node_labels'), record.get('node_props'));
    });

    return {
      nodes: Array.from(nodeMap.values()),
      relationships,
    };
  } finally {
    await session.close();
    await driver.close();
  }
}

function stripKnowgraphNodeIdPrefix(nodeId: string): string {
  return String(nodeId || '')
    .trim()
    .replace(/^(kg:|know:)/i, '');
}

async function queryKnowGraphExpand(
  projectId: string,
  nodeId: string,
  limit: number,
): Promise<{
  nodes: KnowGraphNodeDto[];
  relationships: KnowGraphRelationshipDto[];
}> {
  const rawNodeId = stripKnowgraphNodeIdPrefix(nodeId);
  if (!rawNodeId) {
    throw new Error('nodeId is required');
  }

  const uri = String(process.env.NEO4J_URI || '').trim();
  const user = String(process.env.NEO4J_USER || '').trim();
  const password = String(process.env.NEO4J_PASSWORD || '').trim();
  if (!uri || !user || !password) {
    throw new Error('NEO4J_URI, NEO4J_USER, and NEO4J_PASSWORD are required');
  }

  const neo4jModule: any = await import('neo4j-driver');
  const neo4j: any = neo4jModule?.default ?? neo4jModule;
  const driver = neo4j.driver(uri, neo4j.auth.basic(user, password));
  const database = String(process.env.NEO4J_DATABASE || '').trim();
  const session = driver.session(database ? { database } : undefined);
  const projectScopeIds = await resolveKnowGraphProjectScopeIds(projectId);

  try {
    const nodeMap = new Map<string, KnowGraphNodeDto>();
    const upsertNode = (idRaw: unknown, labelsRaw: unknown, propsRaw: unknown) => {
      const rawId = String(idRaw ?? '').trim();
      if (!rawId) return;
      const labels = Array.isArray(labelsRaw) ? labelsRaw.map((x) => String(x)) : [];
      const props = toNeoJsonValue(propsRaw || {}) as Record<string, unknown>;
      if (!nodeMap.has(rawId)) {
        nodeMap.set(rawId, {
          id: rawId,
          label: neoNodeLabel(rawId, props),
          // Prefer the persisted owlClass property (records written via the
          // :SemanticRecord MERGE share that label); fall back to the node label
          // for legacy records whose label already encodes the owlClass.
          type: String((props as any).owlClass || labels[0] || 'NeoEntity'),
          source: 'know',
          properties: props,
        });
      }
    };

    const centerResult = await session.run(
      `
        MATCH (n)
        WHERE (elementId(n) = $nodeId OR toString(n.uuid) = $nodeId)
          AND toString(n.group_id) IN $projectScopeIds
        RETURN coalesce(toString(n.uuid), elementId(n)) AS node_id,
          labels(n) AS node_labels, properties(n) AS node_props
        LIMIT 1
      `,
      { nodeId: rawNodeId, projectScopeIds },
    );

    if (centerResult.records.length === 0) {
      return { nodes: [], relationships: [] };
    }

    centerResult.records.forEach((record: any) => {
      upsertNode(record.get('node_id'), record.get('node_labels'), record.get('node_props'));
    });

    const relResult = await session.run(
      `
        MATCH (center)
        WHERE (elementId(center) = $nodeId OR toString(center.uuid) = $nodeId)
          AND toString(center.group_id) IN $projectScopeIds
        MATCH (a)-[r]-(b)
        WHERE (a = center OR b = center)
          AND toString(a.group_id) IN $projectScopeIds
          AND toString(b.group_id) IN $projectScopeIds
          AND toString(r.group_id) IN $projectScopeIds
          AND ${notSkillNode('a')} AND ${notSkillNode('b')}
        RETURN DISTINCT
          coalesce(toString(r.uuid), elementId(r)) AS rel_id,
          type(r) AS rel_type,
          properties(r) AS rel_props,
          coalesce(toString(a.uuid), elementId(a)) AS from_id,
          labels(a) AS from_labels,
          properties(a) AS from_props,
          coalesce(toString(b.uuid), elementId(b)) AS to_id,
          labels(b) AS to_labels,
          properties(b) AS to_props
        LIMIT toInteger($limit)
      `,
      { nodeId: rawNodeId, projectScopeIds, limit },
    );

    const relationships: KnowGraphRelationshipDto[] = [];
    relResult.records.forEach((record: any) => {
      const relId = String(record.get('rel_id') ?? '').trim();
      const fromId = String(record.get('from_id') ?? '').trim();
      const toId = String(record.get('to_id') ?? '').trim();
      if (!relId || !fromId || !toId) return;

      upsertNode(record.get('from_id'), record.get('from_labels'), record.get('from_props'));
      upsertNode(record.get('to_id'), record.get('to_labels'), record.get('to_props'));

      relationships.push({
        id: relId,
        from: fromId,
        to: toId,
        type: String(record.get('rel_type') || 'RELATED_TO'),
        source: 'know',
        properties: (toNeoJsonValue(record.get('rel_props') || {}) || {}) as Record<string, unknown>,
      });
    });

    return {
      nodes: Array.from(nodeMap.values()),
      relationships,
    };
  } finally {
    await session.close();
    await driver.close();
  }
}

function knowgraphBaseUrl(): string {
  const configured = (process.env.KNOWGRAPH_URL || '').trim();
  return trimBaseUrl(configured || 'http://localhost:8001');
}

async function proxyKnowgraphGetJson(pathname: string, query?: Record<string, string | string[]>): Promise<{
  status: number;
  data: any;
}> {
  const search = new URLSearchParams();
  Object.entries(query || {}).forEach(([key, value]) => {
    (Array.isArray(value) ? value : [value]).forEach((item) => search.append(key, item));
  });
  const url = `${knowgraphBaseUrl()}${pathname}${search.toString() ? `?${search.toString()}` : ''}`;
  const response = await axios.get(url, {
    timeout: 8000,
    validateStatus: () => true,
  });
  return { status: response.status, data: response.data };
}

router.get('/health', async (_req, res) => {
  try {
    const response = await proxyKnowgraphGetJson('/health');
    return res.status(response.status).json(response.data);
  } catch (error: any) {
    const status = Number(error?.response?.status) || 502;
    const message =
      error?.response?.data?.error?.message ||
      error?.response?.data?.message ||
      error?.message ||
      'KnowGraph health proxy request failed';
    return res.status(status).json({ ok: false, error: { message } });
  }
});

router.get('/graph', async (req, res) => {
  try {
    const projectId =
      (typeof req.query?.projectId === 'string' && req.query.projectId.trim()) ||
      (typeof req.query?.project_id === 'string' && req.query.project_id.trim()) ||
      '';

    if (!projectId) {
      return res.status(400).json({
        ok: false,
        error: { message: 'projectId is required' },
      });
    }

    const graph = await queryKnowGraphProject(projectId);
    return res.json(graph);
  } catch (error: any) {
    const message = error?.message || 'Failed to fetch KnowGraph graph';
    return res.status(500).json({ ok: false, error: { message } });
  }
});

// List available KnowGraph scopes so the UI can open any real scope directly
// (the book graph keeps its canonical scope; nothing is moved or re-keyed).
router.get('/scopes', async (_req, res) => {
  try {
    return res.json({ ok: true, scopes: await listKnowGraphScopes() });
  } catch (error: any) {
    return res.status(500).json({ ok: false, error: { message: error?.message || 'Failed to list KnowGraph scopes' } });
  }
});

router.get('/expand', async (req, res) => {
  try {
    const projectId =
      (typeof req.query?.projectId === 'string' && req.query.projectId.trim()) ||
      (typeof req.query?.project_id === 'string' && req.query.project_id.trim()) ||
      '';
    const nodeId =
      (typeof req.query?.nodeId === 'string' && req.query.nodeId.trim()) ||
      (typeof req.query?.node_id === 'string' && req.query.node_id.trim()) ||
      '';

    if (!projectId || !nodeId) {
      return res.status(400).json({
        ok: false,
        error: { message: 'projectId and nodeId are required' },
      });
    }

    const limit = clampInt(req.query?.limit, 1, 200, 50);
    // Current endpoint supports 1-hop expansion for interactive use. Depth is accepted but clamped.
    const _depth = clampInt(req.query?.depth, 1, 1, 1);
    void _depth;

    const graph = await queryKnowGraphExpand(projectId, nodeId, limit);
    return res.json(graph);
  } catch (error: any) {
    const message = error?.message || 'Failed to expand KnowGraph graph';
    return res.status(500).json({ ok: false, error: { message } });
  }
});

function buildMultipartForm(
  projectId: string,
  documentId: string,
  file: UploadedFile,
  promptTemplate?: string | null,
): FormData {
  const form = new FormData();
  form.append('project_id', projectId);
  form.append('document_id', documentId);
  form.append(
    'file',
    new Blob([file.buffer], { type: file.mimetype || 'application/pdf' }),
    file.originalname || `${documentId}.pdf`,
  );
  if (promptTemplate) {
    form.append('prompt_template', promptTemplate);
  }
  return form;
}

async function resolveKnowgraphCardConfig(projectId: string): Promise<{
  agentId: string;
  provider: string;
  modelKey: string;
  providerModelId: string;
  systemPrompt: string;
}> {
  const { deck } = await getDeckDocument(projectId, BUILDER_DECK_ID);
  if (!deck) {
    throw new Error('knowgraph_builder_deck_missing');
  }
  const card = deck.nodes.find((node) => node.id === 'card_hermes_steward');
  if (!card) {
    throw new Error('knowgraph_hermes_card_missing');
  }
  const model = resolveCardModelStrict(card);
  const modelKey = String(card.runtimeOptions?.modelKey || '').trim();
  const systemPrompt = String(card.prompt || '').trim();
  if (!systemPrompt) {
    throw new Error('knowgraph_hermes_card_prompt_missing');
  }
  return {
    agentId: card.id,
    provider: model.provider,
    modelKey,
    providerModelId: model.providerModelId,
    systemPrompt,
  };
}

async function readResponseDataSafe(response: Response): Promise<any> {
  const text = await response.text().catch(() => '');
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { ok: response.ok, message: text };
  }
}

function pickErrorMessage(payload: any): string {
  const candidate =
    payload?.error?.message ??
    payload?.message ??
    payload?.error ??
    '';
  return String(candidate || '').trim();
}

function normalizeKnowgraphIngestError(message: string, provider: string, providerModelId: string): string {
  const raw = String(message || '').trim();
  const providerLabel = provider || 'unknown';
  const modelLabel = providerModelId || 'unknown';
  const lower = raw.toLowerCase();
  if (
    lower.includes('ratelimiterror') ||
    lower.includes('rate limit') ||
    lower.includes('insufficient_quota') ||
    lower.includes('quota')
  ) {
    return `KnowGraph ingest failed for configured provider/model (${providerLabel} / ${modelLabel}): rate limit or quota exceeded. No provider fallback was used.`;
  }
  if (!raw) {
    return `KnowGraph ingest failed for configured provider/model (${providerLabel} / ${modelLabel}). No provider fallback was used.`;
  }
  return `KnowGraph ingest failed for configured provider/model (${providerLabel} / ${modelLabel}). ${raw}`;
}

async function proxyKnowgraphPdfIngest(input: {
  projectId: string;
  documentId: string;
  file?: UploadedFile | null;
  route?: string;
}): Promise<{ status: number; data: any }> {
  const projectId = String(input.projectId || '').trim();
  const documentId = String(input.documentId || '').trim();
  const file = input.file || undefined;
  const route = String(input.route || '/api/knowgraph/ingest').trim() || '/api/knowgraph/ingest';

  if (!projectId || !documentId || !file) {
    return {
      status: 400,
      data: {
        ok: false,
        error: { message: 'project_id, document_id, and file are required' },
      },
    };
  }

  const fileName = String(file.originalname || '').toLowerCase();
  const fileType = String(file.mimetype || '').toLowerCase();
  const isPdf = fileName.endsWith('.pdf') || fileType.includes('pdf');
  if (!isPdf) {
    return {
      status: 400,
      data: {
        ok: false,
        error: { message: 'Only PDF attachments are supported by the KnowGraph ingest pipeline.' },
      },
    };
  }

  const resolved = await resolveKnowgraphCardConfig(projectId);
  console.log(
    '[RUNTIME_MODEL] route=%s projectId=%s agentType=%s agent_id=%s provider=%s model_key=%s provider_model_id=%s',
    route,
    projectId,
    'knowgraph',
    resolved.agentId,
    resolved.provider,
    resolved.modelKey,
    resolved.providerModelId,
  );
  console.log(
    '[KNOWGRAPH_INGEST] route=%s projectId=%s documentId=%s agentType=knowgraph agentId=%s provider=%s model=%s',
    route,
    projectId,
    documentId,
    resolved.agentId,
    resolved.provider,
    resolved.providerModelId,
  );

  const form = buildMultipartForm(projectId, documentId, file, resolved.systemPrompt);
  const response = await fetch(`${knowgraphBaseUrl()}/ingest`, {
    method: 'POST',
    headers: {
      'x-agent-id': resolved.agentId,
      'x-agent-provider': resolved.provider,
      'x-agent-model-key': resolved.modelKey,
      'x-agent-model-id': resolved.providerModelId,
    },
    body: form,
  });
  const data = await readResponseDataSafe(response);
  if (response.ok) {
    return { status: response.status, data };
  }

  const upstreamMessage = pickErrorMessage(data);
  return {
    status: response.status,
    data: {
      ok: false,
      error: {
        code: `knowgraph_ingest_upstream_${response.status}`,
        message: normalizeKnowgraphIngestError(
          upstreamMessage,
          resolved.provider,
          resolved.providerModelId,
        ),
        provider: resolved.provider,
        model_key: resolved.modelKey,
        provider_model_id: resolved.providerModelId,
      },
      upstream: data,
    },
  };
}

router.post('/ingest', knowgraphUploadSingle as any, async (req, res) => {
  try {
    const requestedProjectId =
      typeof req.body?.project_id === 'string' ? req.body.project_id.trim() : '';
    const documentId = typeof req.body?.document_id === 'string' ? req.body.document_id.trim() : '';
    const file = (req as any).file as UploadedFile | undefined;
    const userId = String((req as any).userId || '').trim();
    if (!userId) {
      return res.status(401).json({
        ok: false,
        error: { message: 'Authentication required for KnowGraph ingest.' },
      });
    }
    if (!requestedProjectId) {
      return res.status(400).json({
        ok: false,
        error: { message: 'project_id, document_id, and file are required' },
      });
    }
    const projectId = await resolveAuthenticatedKnowGraphProjectId(userId, requestedProjectId);
    if (!projectId) {
      return res.status(404).json({
        ok: false,
        error: { message: 'KnowGraph project not found for the authenticated user.' },
      });
    }
    const upstream = await proxyKnowgraphPdfIngest({
      projectId,
      documentId,
      file,
      route: '/api/knowgraph/ingest',
    });
    return res.status(upstream.status).json(upstream.data);
  } catch (error: any) {
    const message =
      error?.cause?.message ||
      (typeof error?.toString === 'function' ? error.toString() : undefined) ||
      error?.message ||
      'KnowGraph proxy request failed';
    return res.status(502).json({ ok: false, error: { message } });
  }
});

// Real-source web/document ingestion passthrough to the KnowGraph API's
// existing Neo/Python pipeline (/ingest_web_results): document loading,
// chunking, extraction prompts, entity/relationship extraction, provenance,
// Neo4j writes all stay in the pipeline. Source-vs-interpretation provenance is
// carried by each document's own typed source field and enforced through the
// ingest prompt/tool contract — this proxy forwards inputs, it does NOT classify
// content or gate on text length.
router.post('/ingest_web', async (req, res) => {
  try {
    const projectId = typeof req.body?.project_id === 'string' ? req.body.project_id.trim() : '';
    const documents = Array.isArray(req.body?.documents) ? req.body.documents : [];
    if (!projectId || documents.length === 0) {
      return res.status(400).json({
        ok: false,
        error: { message: 'project_id and at least one document are required' },
      });
    }
    const response = await axios.post(
      `${knowgraphBaseUrl()}/ingest_web_results`,
      {
        project_id: projectId,
        documents,
        ...(req.body?.prompt_template ? { prompt_template: req.body.prompt_template } : {}),
        ...(req.body?.organizing_principle ? { organizing_principle: req.body.organizing_principle } : {}),
        ...(req.body?.research_focus ? { research_focus: req.body.research_focus } : {}),
      },
      { timeout: 300_000, validateStatus: () => true },
    );
    return res.status(response.status).json(response.data);
  } catch (error: any) {
    return res.status(502).json({
      ok: false,
      error: { message: error?.message || 'KnowGraph web ingestion proxy failed' },
    });
  }
});

export default router;
