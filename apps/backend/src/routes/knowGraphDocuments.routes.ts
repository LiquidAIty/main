// @graph entity: KnowGraphDocumentsRoute
// @graph role: knowgraph-document-gateway
// @graph relates_to: KnowGraph API, KnowGraph
// @graph depends_on: Express, Multer, KnowGraph API
// @graph feeds_to: KnowGraph API
import { Router } from 'express';
import multer from 'multer';
import { getOwnedProjectByReference } from '../services/projectStore';
import { isDevelopmentEnvironment } from '../services/requestPayloadLimits';

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

async function resolveAuthenticatedKnowGraphProjectId(
  userId: string,
  requestedProjectId: string,
): Promise<string | null> {
  const project = await getOwnedProjectByReference(requestedProjectId, userId);
  return project?.id ?? null;
}

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
): FormData {
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

function normalizeKnowgraphIngestError(message: string): string {
  const raw = String(message || '').trim();
  const lower = raw.toLowerCase();
  if (
    lower.includes('ratelimiterror') ||
    lower.includes('rate limit') ||
    lower.includes('insufficient_quota') ||
    lower.includes('quota')
  ) {
    return 'KnowGraph ingest failed: rate limit or quota exceeded.';
  }
  if (!raw) {
    return 'KnowGraph ingest failed.';
  }
  return `KnowGraph ingest failed. ${raw}`;
}

async function proxyKnowgraphPdfIngest(input: {
  projectId: string;
  documentId: string;
  file?: UploadedFile | null;
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

  const form = buildMultipartForm(projectId, documentId, file);
  const response = await fetch(`${knowgraphBaseUrl()}/ingest`, {
    method: 'POST',
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
        message: normalizeKnowgraphIngestError(upstreamMessage),
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

router.post('/delete-fact', async (req, res) => {
  try {
    const userId = String((req as any).userId || '').trim();
    if (!userId) {
      return res.status(401).json({
        ok: false,
        error: { message: 'Authentication required for KnowGraph deletion.' },
      });
    }
    const requestedProjectId = String(req.body?.project_id || '').trim();
    const graphitiFactUuid = String(req.body?.graphiti_fact_uuid || '').trim();
    const kind = req.body?.kind === 'fact' ? 'fact' : '';
    if (!requestedProjectId || !graphitiFactUuid || !kind) {
      return res.status(400).json({
        ok: false,
        error: { message: 'project_id, graphiti_fact_uuid, and kind are required.' },
      });
    }
    const projectId = await resolveAuthenticatedKnowGraphProjectId(userId, requestedProjectId);
    if (!projectId) {
      return res.status(404).json({
        ok: false,
        error: { message: 'KnowGraph project not found for the authenticated user.' },
      });
    }
    const response = await fetch(`${knowgraphBaseUrl()}/delete_fact`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ project_id: projectId, graphiti_fact_uuid: graphitiFactUuid, kind }),
      signal: AbortSignal.timeout(30_000),
    });
    return res.status(response.status).json(await readResponseDataSafe(response));
  } catch (error: any) {
    return res.status(502).json({
      ok: false,
      error: { message: error?.message || 'KnowGraph deletion proxy failed' },
    });
  }
});

export default router;
