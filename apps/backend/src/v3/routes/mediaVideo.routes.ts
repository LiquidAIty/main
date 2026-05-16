import { randomUUID } from 'crypto';
import { spawn } from 'child_process';
import { mkdir } from 'fs/promises';
import os from 'os';
import path from 'path';
import { Router } from 'express';
import { z } from 'zod';
import { safeFetch } from '../../security/safeFetch';
import {
  buildOpenRouterVideoSubmitPayload,
  normalizeOpenRouterVideoResponse,
  resolveOpenRouterAllowHosts,
  resolveOpenRouterBaseUrl,
  type LocalJobStatus,
} from './mediaVideo.normalize';

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
  resultPayload: unknown | null;
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

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}

function findPeepshowCliPath(): string {
  return path.resolve(process.cwd(), 'node_modules', 'peepshow', 'dist', 'cli.js');
}

type PeepshowJson = {
  outputDir?: string;
  reportPath?: string;
  frames?: Array<unknown>;
  audio?: {
    transcript?: {
      text?: string;
      segments?: Array<unknown>;
    };
  };
};

async function runPeepshowAnalysisForUrl(inputUrl: string, runId: string) {
  const outputDir = path.join(os.tmpdir(), 'liquidaity-peepshow', runId);
  await mkdir(outputDir, { recursive: true });

  const cliPath = findPeepshowCliPath();
  const child = spawn(
    process.execPath,
    [cliPath, inputUrl, '--emit', 'json', '--output', outputDir, '--stats', 'off'],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
  );

  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];

  child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
  child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

  const exitCode = await new Promise<number>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) => resolve(code ?? 1));
  });

  const stdout = Buffer.concat(stdoutChunks).toString('utf8').trim();
  const stderr = Buffer.concat(stderrChunks).toString('utf8').trim();

  if (exitCode !== 0) {
    throw new Error(`peepshow_failed_exit_${exitCode}: ${stderr || 'unknown_error'}`);
  }
  if (!stdout) {
    throw new Error('peepshow_failed_empty_stdout');
  }

  let payload: PeepshowJson;
  try {
    payload = JSON.parse(stdout) as PeepshowJson;
  } catch {
    throw new Error('peepshow_failed_invalid_json');
  }

  return {
    outputDir: payload.outputDir || outputDir,
    reportPath: payload.reportPath || null,
    frameCount: Array.isArray(payload.frames) ? payload.frames.length : 0,
    transcriptSegmentCount: Array.isArray(payload.audio?.transcript?.segments)
      ? payload.audio?.transcript?.segments.length
      : 0,
    transcriptTextPreview: payload.audio?.transcript?.text
      ? payload.audio.transcript.text.slice(0, 400)
      : null,
    raw: payload,
  };
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
    resultPayload: null,
    errorMessage: null,
  };
  MEDIA_VIDEO_JOBS.set(localJob.id, localJob);

  try {
    const requestPayload = buildOpenRouterVideoSubmitPayload({
      model: localJob.model,
      prompt: localJob.prompt,
      aspectRatio: localJob.aspectRatio,
      durationSec: localJob.durationSec,
      referenceImageUrls: localJob.referenceImageUrls,
    });

    const response = await safeFetch(
      `${resolveOpenRouterBaseUrl(process.env.OPENROUTER_BASE_URL)}/videos`,
      {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestPayload),
      allowHosts: resolveOpenRouterAllowHosts(process.env.ALLOW_HOSTS_OPENROUTER),
      timeoutMs: Number(process.env.REQUEST_TIMEOUT_MS ?? 20000),
      maxBytes: 2_000_000,
      },
    );
    const providerPayload = (await response.json().catch(() => null)) as unknown;
    const normalized = normalizeOpenRouterVideoResponse(providerPayload, 'running');

    if (!response.ok) {
      localJob.status = 'failed';
      localJob.errorMessage =
        normalized.errorMessage ||
        `openrouter_video_submit_failed_http_${response.status}`;
      localJob.resultPayload = normalized.resultPayload;
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

    localJob.providerJobId = normalized.providerJobId;
    localJob.status = normalized.status;
    localJob.resultUrls = normalized.resultUrls;
    localJob.resultPayload = normalized.resultPayload;
    localJob.errorMessage = normalized.errorMessage;
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
      `${resolveOpenRouterBaseUrl(process.env.OPENROUTER_BASE_URL)}/videos/${encodeURIComponent(localJob.providerJobId)}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        allowHosts: resolveOpenRouterAllowHosts(process.env.ALLOW_HOSTS_OPENROUTER),
        timeoutMs: Number(process.env.REQUEST_TIMEOUT_MS ?? 20000),
        maxBytes: 2_000_000,
      },
    );
    const providerPayload = (await response.json().catch(() => null)) as unknown;
    const normalized = normalizeOpenRouterVideoResponse(
      providerPayload,
      localJob.status,
    );

    if (!response.ok) {
      localJob.status = 'failed';
      localJob.errorMessage =
        normalized.errorMessage ||
        `openrouter_video_status_failed_http_${response.status}`;
      localJob.resultPayload = normalized.resultPayload;
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

    localJob.status = normalized.status;
    localJob.resultUrls = normalized.resultUrls;
    localJob.resultPayload = normalized.resultPayload;
    localJob.errorMessage = normalized.errorMessage;
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

router.post('/:projectId/media/video/jobs/:jobId/peepshow', async (req, res) => {
  const localJob = MEDIA_VIDEO_JOBS.get(req.params.jobId);
  if (!localJob || localJob.projectId !== req.params.projectId) {
    return res.status(404).json({ ok: false, error: 'media_video_job_not_found' });
  }
  const inputUrl = localJob.resultUrls.find((candidate) => isHttpUrl(candidate));
  if (!inputUrl) {
    return res.status(400).json({
      ok: false,
      error: 'media_video_job_result_url_required',
      message:
        'Peepshow analysis only runs against known generated HTTP(S) result URLs from this job.',
    });
  }
  try {
    const runId = `peepshow_${localJob.id}_${Date.now()}`;
    const analysis = await runPeepshowAnalysisForUrl(inputUrl, runId);
    return res.json({
      ok: true,
      provider: 'peepshow',
      jobId: localJob.id,
      sourceUrl: inputUrl,
      analysis: {
        outputDir: analysis.outputDir,
        reportPath: analysis.reportPath,
        frameCount: analysis.frameCount,
        transcriptSegmentCount: analysis.transcriptSegmentCount,
        transcriptTextPreview: analysis.transcriptTextPreview,
      },
      raw: analysis.raw,
    });
  } catch (error: unknown) {
    return res.status(502).json({
      ok: false,
      error: 'peepshow_analysis_failed',
      message:
        error instanceof Error ? error.message : 'peepshow_analysis_failed',
    });
  }
});

export default router;
