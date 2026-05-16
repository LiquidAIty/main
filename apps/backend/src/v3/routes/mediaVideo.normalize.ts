export type LocalJobStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export type OpenRouterVideoNormalization = {
  providerJobId: string | null;
  status: LocalJobStatus;
  resultUrls: string[];
  resultPayload: unknown | null;
  errorMessage: string | null;
  pollingUrl: string | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function collectDeepUrls(value: unknown, acc: string[]): void {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^https?:\/\//i.test(trimmed)) acc.push(trimmed);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectDeepUrls(item, acc);
    return;
  }
  const record = asRecord(value);
  if (!record) return;
  for (const item of Object.values(record)) collectDeepUrls(item, acc);
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

export function resolveOpenRouterBaseUrl(baseUrlEnv: unknown): string {
  const configured = String(baseUrlEnv || 'https://openrouter.ai/api/v1')
    .trim()
    .replace(/\/+$/, '');
  if (/\/api\/v\d+$/i.test(configured)) return configured;
  return `${configured}/api/v1`;
}

export function resolveOpenRouterAllowHosts(allowHostsEnv: unknown): string[] {
  return String(allowHostsEnv || 'api.openrouter.ai,openrouter.ai')
    .split(',')
    .map((host) => host.trim())
    .filter(Boolean);
}

export function normalizeOpenRouterVideoResponse(
  payload: unknown,
  fallbackStatus: LocalJobStatus = 'running',
): OpenRouterVideoNormalization {
  const body = asRecord(payload) || {};
  const data = asRecord(body.data) || {};
  const video = asRecord(body.video) || {};
  const result = asRecord(body.result) || {};

  const pollingUrl =
    normalizeString(body.polling_url) ||
    normalizeString(data.polling_url) ||
    normalizeString(video.polling_url) ||
    null;

  const providerJobIdCandidates = [
    normalizeString(body.id),
    normalizeString(body.job_id),
    normalizeString(data.id),
    normalizeString(data.job_id),
    normalizeString(video.id),
    normalizeString(result.id),
  ].filter((value): value is string => Boolean(value));

  if (providerJobIdCandidates.length === 0 && pollingUrl) {
    const segments = pollingUrl.split('/').filter(Boolean);
    const tail = segments[segments.length - 1];
    if (tail) providerJobIdCandidates.push(tail);
  }

  const statusCandidates = [
    normalizeString(body.status),
    normalizeString(data.status),
    normalizeString(video.status),
    normalizeString(result.status),
  ].filter((value): value is string => Boolean(value));
  const normalizedStatus = (statusCandidates[0] || '').toLowerCase();

  let status: LocalJobStatus = fallbackStatus;
  if (['queued', 'pending', 'created'].includes(normalizedStatus)) status = 'queued';
  else if (['running', 'processing', 'in_progress'].includes(normalizedStatus))
    status = 'running';
  else if (['succeeded', 'completed', 'done', 'success'].includes(normalizedStatus))
    status = 'succeeded';
  else if (['failed', 'error', 'cancelled', 'canceled'].includes(normalizedStatus))
    status = 'failed';

  const urlCandidates: string[] = [];
  collectDeepUrls(body.output, urlCandidates);
  collectDeepUrls(body.outputs, urlCandidates);
  collectDeepUrls(body.result, urlCandidates);
  collectDeepUrls(body.results, urlCandidates);
  collectDeepUrls(data.output, urlCandidates);
  collectDeepUrls(data.outputs, urlCandidates);
  collectDeepUrls(data.unsigned_urls, urlCandidates);
  collectDeepUrls(data.signed_urls, urlCandidates);
  collectDeepUrls(video.output, urlCandidates);
  collectDeepUrls(video.outputs, urlCandidates);
  collectDeepUrls(video.url, urlCandidates);

  const resultUrls = unique(urlCandidates);
  if (!statusCandidates.length && resultUrls.length > 0) {
    status = 'succeeded';
  }

  const errorMessage =
    normalizeString(asRecord(body.error)?.message) ||
    normalizeString(asRecord(data.error)?.message) ||
    normalizeString(asRecord(video.error)?.message) ||
    normalizeString(body.message) ||
    normalizeString(body.error) ||
    normalizeString(data.message) ||
    normalizeString(data.error) ||
    normalizeString(video.message) ||
    normalizeString(video.error) ||
    null;

  const resultPayload =
    body.result ??
    body.results ??
    data.result ??
    data.results ??
    data.output ??
    data.outputs ??
    video.output ??
    video.outputs ??
    null;

  return {
    providerJobId: providerJobIdCandidates[0] || null,
    status,
    resultUrls,
    resultPayload,
    errorMessage,
    pollingUrl,
  };
}

export type OpenRouterVideoSubmitInput = {
  model: string;
  prompt: string;
  aspectRatio: string | null;
  durationSec: number | null;
  referenceImageUrls: string[];
};

export function buildOpenRouterVideoSubmitPayload(
  input: OpenRouterVideoSubmitInput,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    model: input.model,
    prompt: input.prompt,
  };
  if (input.aspectRatio) payload.aspect_ratio = input.aspectRatio;
  if (input.durationSec) payload.duration = input.durationSec;
  if (input.referenceImageUrls.length > 0) {
    payload.reference_images = input.referenceImageUrls;
  }
  return payload;
}
