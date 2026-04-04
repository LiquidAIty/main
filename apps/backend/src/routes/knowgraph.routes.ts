import axios from 'axios';
import { Router } from 'express';
import multer from 'multer';
import { resolveKnowgraphAgent } from '../services/resolveAgents';
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
  const candidates = [props.name, props.title, props.id, props.document_id, props.chunk_id];
  for (const candidate of candidates) {
    const text = String(candidate ?? '').trim();
    if (text) return text;
  }
  return id;
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
          type: String(labels[0] || 'NeoEntity'),
          source: 'know',
          properties: props,
        });
      }
    };

    const relResult = await session.run(
      `
        MATCH (a)-[r]->(b)
        WHERE coalesce(r.project_id, '') = $projectId
          AND coalesce(a.project_id, '') = $projectId
          AND coalesce(b.project_id, '') = $projectId
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
      { projectId },
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
        WHERE coalesce(n.project_id, '') = $projectId
        RETURN DISTINCT elementId(n) AS node_id, labels(n) AS node_labels, properties(n) AS node_props
      `,
      { projectId },
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
          type: String(labels[0] || 'NeoEntity'),
          source: 'know',
          properties: props,
        });
      }
    };

    const centerResult = await session.run(
      `
        MATCH (n)
        WHERE elementId(n) = $nodeId
          AND coalesce(n.project_id, '') = $projectId
        RETURN elementId(n) AS node_id, labels(n) AS node_labels, properties(n) AS node_props
        LIMIT 1
      `,
      { nodeId: rawNodeId, projectId },
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
          AND coalesce(center.project_id, '') = $projectId
        MATCH (a)-[r]-(b)
        WHERE (a = center OR b = center)
          AND coalesce(a.project_id, '') = $projectId
          AND coalesce(b.project_id, '') = $projectId
          AND coalesce(r.project_id, '') = $projectId
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
      { nodeId: rawNodeId, projectId, limit },
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

async function proxyKnowgraphGetJson(pathname: string, query?: Record<string, string>): Promise<{
  status: number;
  data: any;
}> {
  const baseUrls = buildKnowgraphBaseUrls();
  let lastError: any;

  for (const baseUrl of baseUrls) {
    try {
      const search = new URLSearchParams(query || {});
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

  const resolved = await resolveKnowgraphAgent(projectId, route);
  if (!resolved) {
    return {
      status: 409,
      data: {
        ok: false,
        error: { message: 'knowgraph_agent_not_configured' },
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

export default router;
