import { randomUUID } from 'crypto';
import { Router } from 'express';
import { z } from 'zod';
import { safeFetch } from '../../security/safeFetch';

type LocalJobStatus = 'queued' | 'running' | 'succeeded' | 'failed';

type LocalMediaVideoJob = {
  id: string;
  projectId: string;
  provider: 'openrouter';
  providerJobId: string | null;
  status: LocalJobStatus;
  prompt: string;
  model: string;
  aspectRatio: string | null;
  durationSec: number | null;
  sourceSceneId: string | null;
  sourceVideoGraphId: string | null;
  referenceImageUrls: string[];
  submittedAt: string;
  updatedAt: string;
  resultUrls: string[];
  errorMessage: string | null;
};

const router = Router();

const submitSchema = z.object({
  prompt: z.string().trim().min(1),
  model: z.string().trim().min(1),
  aspectRatio: z.string().trim().min(1).max(20).optional(),
  durationSec: z.number().int().positive().max(120).optional(),
  sourceSceneId: z.string().trim().min(1).max(200).optional(),
  sourceVideoGraphId: z.string().trim().min(1).max(200).optional(),
  referenceImageUrls: z.array(z.string().url()).max(8).optional(),
});

const TERMINAL_STATUSES = new Set<LocalJobStatus>(['succeeded', 'failed']);

// Non-production in-memory store for local route job tracking.
// This is intentionally temporary and will be replaced by persisted job storage.
const MEDIA_VIDEO_JOBS = new Map<string, LocalMediaVideoJob>();

function nowIso(): string {
  return new Date().toISOString();
}

function resolveOpenRouterBaseUrl(): string {
  const configured = String(
    process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
  )
    .trim()
    .replace(/\/+$/, '');
  if (/\/api\/v\d+$/i.test(configured)) return configured;
  return `${configured}/api/v1`;
}

function resolveAllowHosts(): string[] {
  return String(process.env.ALLOW_HOSTS_OPENROUTER || 'api.openrouter.ai,openrouter.ai')
    .split(',')
    .map((host) => host.trim())
    .filter(Boolean);
}

function extractProviderJobId(payload: unknown): string | null {
  const body = payload as Record<string, unknown> | null;
  const candidates = [
    body?.id,
    body?.job_id,
    (body?.data as Record<string, unknown> | undefined)?.id,
    (body?.data as Record<string, unknown> | undefined)?.job_id,
    (body?.video as Record<string, unknown> | undefined)?.id,
  ];
  for (const value of candidates) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function extractProviderStatus(payload: unknown): LocalJobStatus {
  const body = payload as Record<string, unknown> | null;
  const rawCandidates = [
    body?.status,
    (body?.data as Record<string, unknown> | undefined)?.status,
    (body?.video as Record<string, unknown> | undefined)?.status,
  ];
  const normalized = rawCandidates
    .map((value) => (typeof value === 'string' ? value.trim().toLowerCase() : ''))
    .find(Boolean);
  if (!normalized) return 'running';
  if (['queued', 'pending', 'created'].includes(normalized)) return 'queued';
  if (['running', 'processing', 'in_progress'].includes(normalized)) return 'running';
  if (['succeeded', 'completed', 'done', 'success'].includes(normalized)) return 'succeeded';
  if (['failed', 'error', 'cancelled', 'canceled'].includes(normalized)) return 'failed';
  return 'running';
}

function extractResultUrls(payload: unknown): string[] {
  const body = payload as Record<string, unknown> | null;
  const candidates = [
    body?.output,
    body?.outputs,
    body?.result,
    body?.results,
    (body?.data as Record<string, unknown> | undefined)?.output,
    (body?.data as Record<string, unknown> | undefined)?.outputs,
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (Array.isArray(candidate)) {
      const urls = candidate
        .map((value) => {
          if (typeof value === 'string') return value;
          if (
            value &&
            typeof value === 'object' &&
            typeof (value as Record<string, unknown>).url === 'string'
          ) {
            return (value as Record<string, unknown>).url as string;
          }
          return '';
        })
        .map((value) => value.trim())
        .filter(Boolean);
      if (urls.length > 0) return urls;
    }
  }
  return [];
}

function pickProviderError(payload: unknown): string | null {
  const body = payload as Record<string, unknown> | null;
  const errorMessage =
    (body?.error as Record<string, unknown> | undefined)?.message ??
    body?.message ??
    body?.error;
  if (typeof errorMessage === 'string' && errorMessage.trim()) {
    return errorMessage.trim();
  }
  return null;
}

router.post('/:projectId/media/video/jobs', async (req, res) => {
  const parsed = submitSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({
      ok: false,
      error: 'invalid_media_video_submit_payload',
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }

  const apiKey = String(process.env.OPENROUTER_API_KEY || '').trim();
  if (!apiKey) {
    return res.status(500).json({
      ok: false,
      error: 'provider_key_missing',
      provider: 'openrouter',
    });
  }

  const payload = parsed.data;
  const model =
    payload.model ||
    String(process.env.OPENROUTER_DEFAULT_VIDEO_MODEL || process.env.OPENROUTER_DEFAULT_MODEL || '')
      .trim();
  const localJobId = `media_video_${randomUUID()}`;
  const submittedAt = nowIso();

  const localJob: LocalMediaVideoJob = {
    id: localJobId,
    projectId: req.params.projectId,
    provider: 'openrouter',
    providerJobId: null,
    status: 'queued',
    prompt: payload.prompt,
    model,
    aspectRatio: payload.aspectRatio ?? null,
    durationSec: payload.durationSec ?? null,
    sourceSceneId: payload.sourceSceneId ?? null,
    sourceVideoGraphId: payload.sourceVideoGraphId ?? null,
    referenceImageUrls: payload.referenceImageUrls ?? [],
    submittedAt,
    updatedAt: submittedAt,
    resultUrls: [],
    errorMessage: null,
  };
  MEDIA_VIDEO_JOBS.set(localJob.id, localJob);

  try {
    const requestPayload: Record<string, unknown> = {
      model: localJob.model,
      prompt: localJob.prompt,
    };
    if (localJob.aspectRatio) requestPayload.aspect_ratio = localJob.aspectRatio;
    if (localJob.durationSec) requestPayload.duration = localJob.durationSec;
    if (localJob.referenceImageUrls.length > 0) {
      requestPayload.reference_images = localJob.referenceImageUrls;
    }

    const response = await safeFetch(`${resolveOpenRouterBaseUrl()}/videos`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestPayload),
      allowHosts: resolveAllowHosts(),
      timeoutMs: Number(process.env.REQUEST_TIMEOUT_MS ?? 20000),
      maxBytes: 2_000_000,
    });
    const providerPayload = (await response.json().catch(() => null)) as unknown;

    if (!response.ok) {
      localJob.status = 'failed';
      localJob.errorMessage =
        pickProviderError(providerPayload) ||
        `openrouter_video_submit_failed_http_${response.status}`;
      localJob.updatedAt = nowIso();
      MEDIA_VIDEO_JOBS.set(localJob.id, localJob);
      return res.status(502).json({
        ok: false,
        error: 'openrouter_video_submit_failed',
        status: response.status,
        providerMessage: localJob.errorMessage,
        job: localJob,
      });
    }

    localJob.providerJobId = extractProviderJobId(providerPayload);
    localJob.status = extractProviderStatus(providerPayload);
    localJob.resultUrls = extractResultUrls(providerPayload);
    localJob.errorMessage = pickProviderError(providerPayload);
    localJob.updatedAt = nowIso();
    MEDIA_VIDEO_JOBS.set(localJob.id, localJob);

    return res.json({
      ok: true,
      job: localJob,
      provider: {
        name: 'openrouter',
        acknowledged: true,
      },
      storage: {
        temporary: true,
        note: 'In-memory job map is non-production and will reset on process restart.',
      },
    });
  } catch (error: unknown) {
    localJob.status = 'failed';
    localJob.errorMessage =
      error instanceof Error && error.message
        ? error.message
        : 'openrouter_video_submit_failed';
    localJob.updatedAt = nowIso();
    MEDIA_VIDEO_JOBS.set(localJob.id, localJob);
    return res.status(502).json({
      ok: false,
      error: 'openrouter_video_submit_failed',
      message: localJob.errorMessage,
      job: localJob,
    });
  }
});

router.get('/:projectId/media/video/jobs/:jobId', async (req, res) => {
  const localJob = MEDIA_VIDEO_JOBS.get(req.params.jobId);
  if (!localJob || localJob.projectId !== req.params.projectId) {
    return res.status(404).json({ ok: false, error: 'media_video_job_not_found' });
  }

  if (TERMINAL_STATUSES.has(localJob.status) || !localJob.providerJobId) {
    return res.json({
      ok: true,
      job: localJob,
      storage: {
        temporary: true,
        note: 'In-memory job map is non-production and will reset on process restart.',
      },
    });
  }

  const apiKey = String(process.env.OPENROUTER_API_KEY || '').trim();
  if (!apiKey) {
    localJob.status = 'failed';
    localJob.errorMessage = 'provider_key_missing';
    localJob.updatedAt = nowIso();
    MEDIA_VIDEO_JOBS.set(localJob.id, localJob);
    return res.status(500).json({
      ok: false,
      error: 'provider_key_missing',
      provider: 'openrouter',
      job: localJob,
    });
  }

  try {
    const response = await safeFetch(
      `${resolveOpenRouterBaseUrl()}/videos/${encodeURIComponent(localJob.providerJobId)}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        allowHosts: resolveAllowHosts(),
        timeoutMs: Number(process.env.REQUEST_TIMEOUT_MS ?? 20000),
        maxBytes: 2_000_000,
      },
    );
    const providerPayload = (await response.json().catch(() => null)) as unknown;

    if (!response.ok) {
      localJob.status = 'failed';
      localJob.errorMessage =
        pickProviderError(providerPayload) ||
        `openrouter_video_status_failed_http_${response.status}`;
      localJob.updatedAt = nowIso();
      MEDIA_VIDEO_JOBS.set(localJob.id, localJob);
      return res.status(502).json({
        ok: false,
        error: 'openrouter_video_status_failed',
        status: response.status,
        providerMessage: localJob.errorMessage,
        job: localJob,
      });
    }

    localJob.status = extractProviderStatus(providerPayload);
    localJob.resultUrls = extractResultUrls(providerPayload);
    localJob.errorMessage = pickProviderError(providerPayload);
    localJob.updatedAt = nowIso();
    MEDIA_VIDEO_JOBS.set(localJob.id, localJob);

    return res.json({
      ok: true,
      job: localJob,
      storage: {
        temporary: true,
        note: 'In-memory job map is non-production and will reset on process restart.',
      },
    });
  } catch (error: unknown) {
    localJob.status = 'failed';
    localJob.errorMessage =
      error instanceof Error && error.message
        ? error.message
        : 'openrouter_video_status_failed';
    localJob.updatedAt = nowIso();
    MEDIA_VIDEO_JOBS.set(localJob.id, localJob);
    return res.status(502).json({
      ok: false,
      error: 'openrouter_video_status_failed',
      message: localJob.errorMessage,
      job: localJob,
    });
  }
});

export default router;
