/**
 * Graph + less = more: less code that does the same work as more code is more useful.
 * Entity names the feature; Relationship explains why this file belongs and what it contributes.
 * Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
 * Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
 * Entity: KnowGraph
 * Relationship: Transports authenticated bounded PDF passage indexing and exact Know edits/removal to the existing Project-scoped KnowGraph owners.
 * Entity: Authentication
 * Relationship: This file requires an authenticated Project owner before forwarding KnowGraph writes.
 */

import { Router } from 'express';
import multer from 'multer';
import { getOwnedProjectByReference } from '../services/projectStore';
import { isDevelopmentEnvironment } from '../services/requestPayloadLimits';
import { notifyThinkGraphChanged } from './thinkGraph.routes';

const router = Router();

// Local development accepts large real-document fixtures; production keeps a bounded default.
const KNOWGRAPH_UPLOAD_MAX_FILE_SIZE_BYTES = Math.max(
  1_000_000,
  Number(
    process.env.KNOWGRAPH_UPLOAD_MAX_FILE_SIZE_BYTES ||
      (isDevelopmentEnvironment() ? 512 * 1024 * 1024 : 25 * 1024 * 1024),
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

function trimBaseUrl(value: string): string {
  return value.replace(/\/+$/, '');
}

function knowgraphBaseUrl(): string {
  const configured = (process.env.KNOWGRAPH_URL || '').trim();
  return trimBaseUrl(configured || 'http://localhost:8001');
}

function buildMultipartForm(
  projectId: string,
  documentId: string,
  file: UploadedFile,
  sourceUrl?: string,
  publicationDate?: string,
): FormData {
  const form = new FormData();
  form.append('project_id', projectId);
  form.append('document_id', documentId);
  if (sourceUrl) form.append('source_url', sourceUrl);
  if (publicationDate) form.append('publication_date', publicationDate);
  form.append(
    'file',
    new Blob([Uint8Array.from(file.buffer)], {
      type: file.mimetype || 'application/pdf',
    }),
    file.originalname || `${documentId}.pdf`,
  );
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

function knowgraphUpstreamFailure(
  operation: 'ingest' | 'delete',
  status: number,
): { ok: false; error: { code: string; message: string } } {
  const operationLabel = operation === 'ingest' ? 'ingest' : 'deletion';
  if (status === 401 || status === 403) {
    return {
      ok: false,
      error: {
        code: `knowgraph_${operation}_provider_authorization_failed`,
        message: `KnowGraph ${operationLabel} was refused by the configured provider.`,
      },
    };
  }
  if (status === 408 || status === 504) {
    return {
      ok: false,
      error: {
        code: `knowgraph_${operation}_provider_timeout`,
        message: `KnowGraph ${operationLabel} timed out at the configured provider.`,
      },
    };
  }
  if (status === 429) {
    return {
      ok: false,
      error: {
        code: `knowgraph_${operation}_rate_limited`,
        message: `KnowGraph ${operationLabel} is temporarily rate limited.`,
      },
    };
  }
  return {
    ok: false,
    error: {
      code: `knowgraph_${operation}_upstream_${status}`,
      message: `KnowGraph ${operationLabel} failed at the configured provider.`,
    },
  };
}

async function proxyKnowgraphPdfIngest(input: {
  projectId: string;
  documentId: string;
  file?: UploadedFile | null;
  sourceUrl?: string;
  publicationDate?: string;
}): Promise<{ status: number; data: any }> {
  const projectId = String(input.projectId || '').trim();
  const documentId = String(input.documentId || '').trim();
  const file = input.file || undefined;

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

  const form = buildMultipartForm(projectId, documentId, file, input.sourceUrl, input.publicationDate);
  const secret = String(process.env.LIQUIDAITY_INTERNAL_MCP_SECRET || '').trim();
  if (secret.length < 32) throw new Error('internal_process_authorization_missing');
  const response = await fetch(`${knowgraphBaseUrl()}/ingest`, {
    method: 'POST',
    headers: { 'X-LiquidAIty-Internal-MCP-Secret': secret },
    body: form,
    redirect: 'error',
    signal: AbortSignal.timeout(270_000),
  });
  const data = await readResponseDataSafe(response);
  if (response.ok) {
    return { status: response.status, data };
  }

  return {
    status: response.status,
    data: knowgraphUpstreamFailure('ingest', response.status),
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
    const projectId = (await getOwnedProjectByReference(requestedProjectId, userId))?.id ?? null;
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
      sourceUrl: typeof req.body?.source_url === 'string' ? req.body.source_url : undefined,
      publicationDate: typeof req.body?.publication_date === 'string' ? req.body.publication_date : undefined,
    });
    return res.status(upstream.status).json(upstream.data);
  } catch {
    return res.status(502).json({
      ok: false,
      error: {
        code: 'knowgraph_ingest_unavailable',
        message: 'KnowGraph ingest service is unavailable.',
      },
    });
  }
});

router.post('/edit-know', async (req, res) => {
  const userId = String((req as any).userId || '').trim();
  if (!userId) return res.status(401).json({ error: 'Authentication required.' });
  const projectId = (await getOwnedProjectByReference(String(req.body?.project_id || ''), userId))?.id;
  if (!projectId) return res.status(404).json({ error: 'KnowGraph project not found.' });
  if (typeof req.body?.uuid !== 'string' || !req.body.uuid.trim()) {
    return res.status(400).json({ error: 'Exact Know UUID required.' });
  }
  try {
    const { uuid, name, observation, interpretation, citation } = req.body;
    const response = await fetch(`${knowgraphBaseUrl()}/edit_know`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ project_id: projectId, uuid, name, observation, interpretation, citation }),
      signal: AbortSignal.timeout(30_000),
    });
    const result = await readResponseDataSafe(response);
    if (response.ok) notifyThinkGraphChanged(projectId, 'knowgraph');
    return res.status(response.status).json(result);
  } catch {
    return res.status(502).json({ error: 'KnowGraph edit service is unavailable.' });
  }
});

router.post('/delete-episode', async (req, res) => {
  try {
    const userId = String((req as any).userId || '').trim();
    if (!userId) {
      return res.status(401).json({
        ok: false,
        error: { message: 'Authentication required for KnowGraph deletion.' },
      });
    }
    const requestedProjectId = String(req.body?.project_id || '').trim();
    const graphitiEpisodeUuid = String(req.body?.graphiti_episode_uuid || '').trim();
    if (!requestedProjectId || !graphitiEpisodeUuid) {
      return res.status(400).json({
        ok: false,
        error: { message: 'project_id and graphiti_episode_uuid are required.' },
      });
    }
    const projectId = (await getOwnedProjectByReference(requestedProjectId, userId))?.id ?? null;
    if (!projectId) {
      return res.status(404).json({
        ok: false,
        error: { message: 'KnowGraph project not found for the authenticated user.' },
      });
    }
    const response = await fetch(`${knowgraphBaseUrl()}/delete_episode`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        project_id: projectId,
        graphiti_episode_uuid: graphitiEpisodeUuid,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      return res.status(response.status).json(knowgraphUpstreamFailure('delete', response.status));
    }
    return res.status(response.status).json(await readResponseDataSafe(response));
  } catch {
    return res.status(502).json({
      ok: false,
      error: {
        code: 'knowgraph_delete_unavailable',
        message: 'KnowGraph deletion service is unavailable.',
      },
    });
  }
});

export default router;
