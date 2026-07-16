// @graph entity: KnowGraphRoute
// @graph role: knowgraph-gateway
// @graph relates_to: AgentBuilderWorkspace, KnowGraph API, KnowGraph
// @graph depends_on: Express, Neo4j, KnowGraph API
// @graph feeds_to: KnowGraph API, KnowGraph
import axios from 'axios';
import { Router } from 'express';
import multer from 'multer';
import { pool } from '../db/pool';
import { resolveKnowgraphPipelineConfig } from '../services/resolveAgents';
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

export type UploadedFile = {
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
  const seed = String(projectId || '').trim();
  if (!seed) return [];

  const scopeIds = new Set<string>([seed]);
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
      [seed],
    );
    const row = result?.rows?.[0] as { id?: string; name?: string; code?: string } | undefined;
    if (row) {
      for (const rawValue of [row.id, row.name, row.code]) {
        const value = String(rawValue || '').trim();
        if (value) scopeIds.add(value);
      }
    }
  } catch (error: any) {
    console.warn('[KNOWGRAPH][SCOPE] project alias resolution failed:', error?.message || error);
  }

  // Attached knowledge scopes (project-context): a selected LiquidAIty project may ATTACH
  // additional KnowGraph scopes (e.g. an imported book kept under its own canonical scope)
  // WITHOUT moving or copying any records. This is the ATTACHES_KNOWLEDGE_SCOPE contract.
  try {
    await pool.query(
      `CREATE TABLE IF NOT EXISTS liq_core.knowgraph_scope_attachment (
         project_id text NOT NULL, scope text NOT NULL, label text,
         attached_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (project_id, scope))`,
    );
    const attach = await pool.query(
      `SELECT scope FROM liq_core.knowgraph_scope_attachment WHERE project_id = ANY($1::text[])`,
      [Array.from(scopeIds)],
    );
    for (const r of attach.rows as Array<{ scope?: string }>) {
      const v = String(r.scope || '').trim();
      if (v) scopeIds.add(v);
    }
  } catch (error: any) {
    console.warn('[KNOWGRAPH][SCOPE] attachment resolution failed:', error?.message || error);
  }

  return Array.from(scopeIds);
}

async function resolvePreferredKnowGraphScope(projectId: string): Promise<string> {
  const scopeIds = await resolveKnowGraphProjectScopeIds(projectId);
  const seed = String(projectId || '').trim();
  try {
    const attached = await pool.query(
      `SELECT scope FROM liq_core.knowgraph_scope_attachment
       WHERE project_id = ANY($1::text[]) ORDER BY attached_at DESC LIMIT 1`,
      [scopeIds],
    );
    const scope = String(attached.rows?.[0]?.scope || '').trim();
    if (scope) return scope;
  } catch (error: any) {
    console.warn('[KNOWGRAPH][SCOPE] preferred attachment resolution failed:', error?.message || error);
  }
  return seed;
}

// SkillGraph (services/knowgraph/skill_ingest.py) shares this Neo4j database but uses its OWN node
// labels. The KnowGraph reads below scope by project_id but are otherwise label-blind, so :Skill*
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

// List the distinct KnowGraph scopes (project_id values) present in Neo4j, with a
// human label + counts, so the UI can open ANY real KnowGraph scope directly — e.g.
// an imported book under its own canonical scope — without moving or re-keying data.
export async function listKnowGraphScopes(): Promise<
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
        MATCH (n) WHERE n.project_id IS NOT NULL AND ${notSkillNode('n')}
        WITH toString(n.project_id) AS scope, collect(n) AS ns
        RETURN scope,
          size(ns) AS nodes,
          size([x IN ns WHERE 'Concept' IN labels(x)]) AS concepts,
          size([x IN ns WHERE 'Document' IN labels(x)]) AS documents,
          head([x IN ns WHERE 'Document' IN labels(x) | coalesce(x.source_name, x.document_id)]) AS label
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

export async function queryKnowGraphProject(projectId: string): Promise<{
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
        WHERE toString(a.project_id) IN $projectScopeIds
          AND toString(b.project_id) IN $projectScopeIds
          AND (r.project_id IS NULL OR toString(r.project_id) IN $projectScopeIds)
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
        WHERE toString(n.project_id) IN $projectScopeIds
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
        WHERE elementId(n) = $nodeId
          AND toString(n.project_id) IN $projectScopeIds
        RETURN elementId(n) AS node_id, labels(n) AS node_labels, properties(n) AS node_props
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
        WHERE elementId(center) = $nodeId
          AND toString(center.project_id) IN $projectScopeIds
        MATCH (a)-[r]-(b)
        WHERE (a = center OR b = center)
          AND toString(a.project_id) IN $projectScopeIds
          AND toString(b.project_id) IN $projectScopeIds
          AND toString(r.project_id) IN $projectScopeIds
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

function buildKnowgraphBaseUrls(): string[] {
  const configured = (process.env.KNOWGRAPH_URL || '').trim();
  const localDefault = 'http://localhost:8001';

  if (!configured) {
    return [localDefault];
  }

  const primary = trimBaseUrl(configured);
  const urls = [primary];

  // If a local backend accidentally points at the Docker DNS name, retry localhost.
  if (/^https?:\/\/knowgraph(?::\d+)?(?:\/|$)/i.test(primary)) {
    urls.push(localDefault);
  }

  return Array.from(new Set(urls));
}

async function proxyKnowgraphGetJson(pathname: string, query?: Record<string, string | string[]>): Promise<{
  status: number;
  data: any;
}> {
  const baseUrls = buildKnowgraphBaseUrls();
  let lastError: any;

  for (const baseUrl of baseUrls) {
    try {
      const search = new URLSearchParams();
      Object.entries(query || {}).forEach(([key, value]) => {
        (Array.isArray(value) ? value : [value]).forEach((item) => search.append(key, item));
      });
      const url = `${baseUrl}${pathname}${search.toString() ? `?${search.toString()}` : ''}`;
      const response = await axios.get(url, {
        timeout: 8000,
        validateStatus: () => true,
      });
      return { status: response.status, data: response.data };
    } catch (error: any) {
      lastError = error;
      const code = String(error?.code || '');
      const canRetryNetworkLookup =
        !error?.response && (code === 'ENOTFOUND' || code === 'ECONNREFUSED' || code === 'EAI_AGAIN');
      if (!canRetryNetworkLookup) {
        break;
      }
    }
  }

  throw lastError;
}

async function proxyKnowgraphPostJson(pathname: string, body: unknown): Promise<{
  status: number;
  data: any;
}> {
  const baseUrls = buildKnowgraphBaseUrls();
  let lastError: any;

  for (const baseUrl of baseUrls) {
    try {
      const response = await axios.post(`${baseUrl}${pathname}`, body, {
        timeout: 300_000,
        validateStatus: () => true,
      });
      return { status: response.status, data: response.data };
    } catch (error: any) {
      lastError = error;
      const code = String(error?.code || '');
      const canRetryNetworkLookup =
        !error?.response && (code === 'ENOTFOUND' || code === 'ECONNREFUSED' || code === 'EAI_AGAIN');
      if (!canRetryNetworkLookup) break;
    }
  }

  throw lastError;
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

// Derived network analysis lives in the existing Python KnowGraph service and
// persists back into the same Neo4j. These routes are transport only.
router.get('/analysis/capabilities', async (_req, res) => {
  try {
    const response = await proxyKnowgraphGetJson('/analysis/capabilities');
    return res.status(response.status).json(response.data);
  } catch (error: any) {
    return res.status(502).json({ ok: false, error: { message: error?.message || 'analysis capabilities unavailable' } });
  }
});

router.get('/analysis/source-preview', async (req, res) => {
  try {
    const projectId = String(req.query?.projectId || req.query?.project_id || '').trim();
    if (!projectId) return res.status(400).json({ ok: false, error: { message: 'projectId is required' } });
    const resolvedProjectId = await resolvePreferredKnowGraphScope(projectId);
    const response = await proxyKnowgraphGetJson('/analysis/source-preview', { project_id: resolvedProjectId });
    return res.status(response.status).json({ ...response.data, resolved_project_id: resolvedProjectId });
  } catch (error: any) {
    return res.status(502).json({ ok: false, error: { message: error?.message || 'source preview unavailable' } });
  }
});

router.get('/analysis/context-projection', async (req, res) => {
  try {
    const projectId = String(req.query?.projectId || req.query?.project_id || '').trim();
    if (!projectId) return res.status(400).json({ ok: false, error: { message: 'projectId is required' } });
    const resolvedProjectId = await resolvePreferredKnowGraphScope(projectId);
    const refs = Array.isArray(req.query?.refs) ? req.query.refs : req.query?.refs ? [req.query.refs] : [];
    const response = await proxyKnowgraphGetJson('/analysis/context-projection', {
      project_id: resolvedProjectId,
      refs: refs.map((value) => String(value)),
      limit: String(clampInt(req.query?.limit, 1, 300, 120)),
      conversation_id: String(req.query?.conversationId || 'main'),
      role: String(req.query?.role || 'main_chat'),
    });
    return res.status(response.status).json({ ...response.data, resolved_project_id: resolvedProjectId });
  } catch (error: any) {
    return res.status(502).json({ ok: false, error: { message: error?.message || 'context projection unavailable' } });
  }
});

router.post('/analysis/analyze', async (req, res) => {
  try {
    const requestedProjectId = String(req.body?.project_id || '').trim();
    const resolvedProjectId = await resolvePreferredKnowGraphScope(requestedProjectId);
    const response = await proxyKnowgraphPostJson('/analysis/analyze', {
      ...req.body,
      project_id: resolvedProjectId,
      source_scope: { ...(req.body?.source_scope || {}), project_id: resolvedProjectId },
    });
    return res.status(response.status).json(response.data);
  } catch (error: any) {
    return res.status(502).json({ ok: false, error: { message: error?.message || 'analysis failed' } });
  }
});

router.post('/analysis/compare', async (req, res) => {
  try {
    const response = await proxyKnowgraphPostJson('/analysis/compare', req.body);
    return res.status(response.status).json(response.data);
  } catch (error: any) {
    return res.status(502).json({ ok: false, error: { message: error?.message || 'provider comparison failed' } });
  }
});

router.get('/analysis/latest', async (req, res) => {
  try {
    const projectId = String(req.query?.projectId || req.query?.project_id || '').trim();
    const provider = String(req.query?.provider || 'local_cleanroom').trim();
    if (!projectId) return res.status(400).json({ ok: false, error: { message: 'projectId is required' } });
    const resolvedProjectId = await resolvePreferredKnowGraphScope(projectId);
    const response = await proxyKnowgraphGetJson('/analysis/latest', { project_id: resolvedProjectId, provider });
    return res.status(response.status).json({ ...response.data, resolved_project_id: resolvedProjectId });
  } catch (error: any) {
    return res.status(502).json({ ok: false, error: { message: error?.message || 'analysis unavailable' } });
  }
});

router.get('/analysis/comparison/latest', async (req, res) => {
  try {
    const projectId = String(req.query?.projectId || req.query?.project_id || '').trim();
    if (!projectId) return res.status(400).json({ ok: false, error: { message: 'projectId is required' } });
    const response = await proxyKnowgraphGetJson('/analysis/comparison/latest', { project_id: projectId });
    return res.status(response.status).json(response.data);
  } catch (error: any) {
    return res.status(502).json({ ok: false, error: { message: error?.message || 'comparison unavailable' } });
  }
});

router.get('/analysis/:analysisId/evidence/:topicId', async (req, res) => {
  try {
    const response = await proxyKnowgraphGetJson(
      `/analysis/${encodeURIComponent(req.params.analysisId)}/evidence/${encodeURIComponent(req.params.topicId)}`,
    );
    return res.status(response.status).json(response.data);
  } catch (error: any) {
    return res.status(502).json({ ok: false, error: { message: error?.message || 'analysis evidence unavailable' } });
  }
});

for (const detail of ['topics', 'gateways', 'gaps'] as const) {
  router.get(`/analysis/:analysisId/${detail}`, async (req, res) => {
    try {
      const response = await proxyKnowgraphGetJson(
        `/analysis/${encodeURIComponent(req.params.analysisId)}/${detail}`,
      );
      return res.status(response.status).json(response.data);
    } catch (error: any) {
      return res.status(502).json({ ok: false, error: { message: error?.message || `analysis ${detail} unavailable` } });
    }
  });
}

router.get('/analysis/:analysisId', async (req, res) => {
  try {
    const response = await proxyKnowgraphGetJson(`/analysis/${encodeURIComponent(req.params.analysisId)}`);
    return res.status(response.status).json(response.data);
  } catch (error: any) {
    return res.status(502).json({ ok: false, error: { message: error?.message || 'analysis unavailable' } });
  }
});

router.post('/analysis-view', async (req, res) => {
  try {
    const resolvedProjectId = await resolvePreferredKnowGraphScope(String(req.body?.project_id || '').trim());
    const response = await proxyKnowgraphPostJson('/analysis-view', { ...req.body, project_id: resolvedProjectId });
    return res.status(response.status).json(response.data);
  } catch (error: any) {
    return res.status(502).json({ ok: false, error: { message: error?.message || 'analysis view creation failed' } });
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

// Project-context: attach / list KnowGraph scopes for a selected LiquidAIty project.
// No records are moved — the project simply references the scope so its KnowGraph view
// can include it. resolveKnowGraphProjectScopeIds reads these attachments.
router.get('/scope-attachment', async (req, res) => {
  try {
    const projectId = String(req.query?.projectId || '').trim();
    if (!projectId) return res.status(400).json({ ok: false, error: { message: 'projectId required' } });
    await pool.query(
      `CREATE TABLE IF NOT EXISTS liq_core.knowgraph_scope_attachment (
         project_id text NOT NULL, scope text NOT NULL, label text,
         attached_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (project_id, scope))`,
    );
    const r = await pool.query(
      `SELECT scope, label FROM liq_core.knowgraph_scope_attachment WHERE project_id = $1 ORDER BY attached_at`,
      [projectId],
    );
    return res.json({ ok: true, projectId, attachments: r.rows });
  } catch (error: any) {
    return res.status(500).json({ ok: false, error: { message: error?.message || 'scope attachment read failed' } });
  }
});

router.post('/scope-attachment', async (req, res) => {
  try {
    const projectId = String(req.body?.projectId || '').trim();
    const scope = String(req.body?.scope || '').trim();
    const label = String(req.body?.label || '').trim() || null;
    if (!projectId || !scope) return res.status(400).json({ ok: false, error: { message: 'projectId and scope required' } });
    await pool.query(
      `CREATE TABLE IF NOT EXISTS liq_core.knowgraph_scope_attachment (
         project_id text NOT NULL, scope text NOT NULL, label text,
         attached_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (project_id, scope))`,
    );
    await pool.query(
      `INSERT INTO liq_core.knowgraph_scope_attachment (project_id, scope, label) VALUES ($1, $2, $3)
       ON CONFLICT (project_id, scope) DO UPDATE SET label = EXCLUDED.label`,
      [projectId, scope, label],
    );
    return res.json({ ok: true, projectId, scope, label });
  } catch (error: any) {
    return res.status(500).json({ ok: false, error: { message: error?.message || 'scope attachment write failed' } });
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

/**
 * Persist the established KnowGraph example dataset (semantic seed) into project-scoped Neo4j
 * `:SemanticRecord` nodes/relationships. Shared by the dev-only /semantic-seed route AND the
 * seedKnowGraphExampleData script (which bypasses CORS/auth for local restoration). Returns an
 * HTTP-status + body so the route can relay it directly.
 */

function buildMultipartForm(
  projectId: string,
  documentId: string,
  file: UploadedFile,
  guidance?: {
    organizingPrinciple?: string | null;
    entityTaxonomy?: any | null;
    relationshipTaxonomy?: any | null;
    extractionPolicy?: any | null;
  },
): FormData {
  const form = new FormData();
  form.append('project_id', projectId);
  form.append('document_id', documentId);
  form.append(
    'file',
    new Blob([file.buffer], { type: file.mimetype || 'application/pdf' }),
    file.originalname || `${documentId}.pdf`,
  );
  if (guidance?.organizingPrinciple) {
    form.append('organizing_principle', guidance.organizingPrinciple);
  }
  if (guidance?.entityTaxonomy != null) {
    form.append('entity_taxonomy_json', JSON.stringify(guidance.entityTaxonomy));
  }
  if (guidance?.relationshipTaxonomy != null) {
    form.append('relationship_taxonomy_json', JSON.stringify(guidance.relationshipTaxonomy));
  }
  if (guidance?.extractionPolicy != null) {
    form.append('extraction_policy_json', JSON.stringify(guidance.extractionPolicy));
  }
  return form;
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

export async function proxyKnowgraphPdfIngest(input: {
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

  const resolved = await resolveKnowgraphPipelineConfig(projectId, route);
  if (!resolved) {
    return {
      status: 409,
      data: {
        ok: false,
        error: { message: 'knowgraph_pipeline_not_configured' },
      },
    };
  }
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

  const baseUrls = buildKnowgraphBaseUrls();
  let lastError: any;

  for (const baseUrl of baseUrls) {
    try {
      const form = buildMultipartForm(projectId, documentId, file, {
        organizingPrinciple: resolved.organizingPrinciple ?? null,
        entityTaxonomy: resolved.entityTaxonomy ?? null,
        relationshipTaxonomy: resolved.relationshipTaxonomy ?? null,
        extractionPolicy: resolved.extractionPolicy ?? null,
      });
      const response = await fetch(`${baseUrl}/ingest`, {
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
    } catch (error: any) {
      lastError = error;
      const code = String(error?.cause?.code || error?.code || '');
      const canRetryNetworkLookup =
        code === 'ENOTFOUND' || code === 'ECONNREFUSED' || code === 'EAI_AGAIN';
      if (!canRetryNetworkLookup) {
        break;
      }
    }
  }

  throw lastError;
}

router.post('/ingest', knowgraphUploadSingle as any, async (req, res) => {
  try {
    const projectId = typeof req.body?.project_id === 'string' ? req.body.project_id.trim() : '';
    const documentId = typeof req.body?.document_id === 'string' ? req.body.document_id.trim() : '';
    const file = (req as any).file as UploadedFile | undefined;
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
    const baseUrls = buildKnowgraphBaseUrls();
    let lastError: any;
    for (const baseUrl of baseUrls) {
      try {
        const response = await axios.post(
          `${baseUrl}/ingest_web_results`,
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
        lastError = error;
        const code = String(error?.code || '');
        if (!(!error?.response && (code === 'ENOTFOUND' || code === 'ECONNREFUSED' || code === 'EAI_AGAIN'))) {
          break;
        }
      }
    }
    const message = lastError?.message || 'knowgraph_api_unreachable';
    return res.status(502).json({ ok: false, error: { message } });
  } catch (error: any) {
    return res.status(502).json({
      ok: false,
      error: { message: error?.message || 'KnowGraph web ingestion proxy failed' },
    });
  }
});

router.post('/ingest_code', async (req, res) => {
  try {
    const projectId = typeof req.body?.project_id === 'string' ? req.body.project_id.trim() : '';
    const documentId = typeof req.body?.document_id === 'string' ? req.body.document_id.trim() : '';
    const codeText = typeof req.body?.code_text === 'string' ? req.body.code_text : '';
    const filePath = typeof req.body?.file_path === 'string' ? req.body.file_path.trim() : undefined;
    const language = typeof req.body?.language === 'string' ? req.body.language.trim() : undefined;

    if (!projectId || !documentId || !codeText) {
      return res.status(400).json({
        ok: false,
        error: { message: 'project_id, document_id, and code_text are required' },
      });
    }

    const resolved = await resolveKnowgraphPipelineConfig(projectId, '/api/knowgraph/ingest_code');
    if (!resolved) {
      return res.status(409).json({
        ok: false,
        error: { message: 'knowgraph_pipeline_not_configured' },
      });
    }

    const baseUrls = buildKnowgraphBaseUrls();
    let lastError: any;

    for (const baseUrl of baseUrls) {
      try {
        const form = new FormData();
        form.append('project_id', projectId);
        form.append('document_id', documentId);
        form.append('code_text', codeText);
        if (filePath) form.append('file_path', filePath);
        if (language) form.append('language', language);
        if (resolved.organizingPrinciple) form.append('organizing_principle', resolved.organizingPrinciple);
        if (resolved.entityTaxonomy) form.append('entity_taxonomy_json', JSON.stringify(resolved.entityTaxonomy));
        if (resolved.relationshipTaxonomy) form.append('relationship_taxonomy_json', JSON.stringify(resolved.relationshipTaxonomy));
        if (resolved.extractionPolicy) form.append('extraction_policy_json', JSON.stringify(resolved.extractionPolicy));

        const response = await fetch(`${baseUrl}/ingest_code`, {
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
        return res.status(response.status).json(data);
      } catch (error: any) {
        lastError = error;
        const code = String(error?.cause?.code || error?.code || '');
        const canRetryNetworkLookup = code === 'ENOTFOUND' || code === 'ECONNREFUSED' || code === 'EAI_AGAIN';
        if (!canRetryNetworkLookup) {
          break;
        }
      }
    }

    throw lastError;
  } catch (error: any) {
    const message = error?.message || 'KnowGraph code ingest proxy request failed';
    return res.status(502).json({ ok: false, error: { message } });
  }
});

export default router;
