import axios from 'axios';
import { Router } from 'express';
import multer from 'multer';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

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
           OR (coalesce(a.project_id, '') = $projectId AND coalesce(b.project_id, '') = $projectId)
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
          AND (coalesce(r.project_id, '') = $projectId OR coalesce(r.project_id, '') = '')
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

function buildMultipartForm(projectId: string, documentId: string, file: UploadedFile): FormData {
  const form = new FormData();
  form.append('project_id', projectId);
  form.append('document_id', documentId);
  form.append(
    'file',
    new Blob([file.buffer], { type: file.mimetype || 'application/pdf' }),
    file.originalname || `${documentId}.pdf`,
  );
  return form;
}

router.post('/ingest', upload.single('file') as any, async (req, res) => {
  try {
    const projectId = typeof req.body?.project_id === 'string' ? req.body.project_id.trim() : '';
    const documentId = typeof req.body?.document_id === 'string' ? req.body.document_id.trim() : '';
    const file = (req as any).file as UploadedFile | undefined;

    if (!projectId || !documentId || !file) {
      return res.status(400).json({
        ok: false,
        error: { message: 'project_id, document_id, and file are required' },
      });
    }

    const baseUrls = buildKnowgraphBaseUrls();
    let lastError: any;

    for (const baseUrl of baseUrls) {
      try {
        const form = buildMultipartForm(projectId, documentId, file);
        const response = await axios.post(`${baseUrl}/ingest`, form, {
          headers:
            typeof (form as any).getHeaders === 'function'
              ? (form as any).getHeaders()
              : undefined,
          maxBodyLength: Infinity,
          maxContentLength: Infinity,
          validateStatus: () => true,
        });

        return res.status(response.status).json(response.data);
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
  } catch (error: any) {
    const status = Number(error?.response?.status) || 502;
    const message =
      error?.response?.data?.error?.message ||
      error?.cause?.message ||
      (typeof error?.toString === 'function' ? error.toString() : undefined) ||
      error?.message ||
      'KnowGraph proxy request failed';
    return res.status(status).json({ ok: false, error: { message } });
  }
});

export default router;
