import { describe, expect, it } from 'vitest';

import {
  buildOpenRouterVideoSubmitPayload,
  normalizeOpenRouterVideoResponse,
  resolveOpenRouterAllowHosts,
  resolveOpenRouterBaseUrl,
} from './mediaVideo.normalize';

describe('mediaVideo.normalize', () => {
  it('normalizes provider job id from direct id', () => {
    const normalized = normalizeOpenRouterVideoResponse({
      id: 'job_123',
      status: 'pending',
    });
    expect(normalized.providerJobId).toBe('job_123');
    expect(normalized.status).toBe('queued');
  });

  it('normalizes provider job id from polling_url when id fields are missing', () => {
    const normalized = normalizeOpenRouterVideoResponse({
      polling_url: 'https://openrouter.ai/api/v1/videos/job_poll_77',
      status: 'processing',
    });
    expect(normalized.providerJobId).toBe('job_poll_77');
    expect(normalized.status).toBe('running');
  });

  it('extracts nested result urls and marks succeeded when status is omitted', () => {
    const normalized = normalizeOpenRouterVideoResponse({
      data: {
        outputs: [
          { url: 'https://cdn.example.com/out-1.mp4' },
          { url: 'https://cdn.example.com/out-2.mp4' },
        ],
      },
    });
    expect(normalized.status).toBe('succeeded');
    expect(normalized.resultUrls).toEqual([
      'https://cdn.example.com/out-1.mp4',
      'https://cdn.example.com/out-2.mp4',
    ]);
  });

  it('extracts provider error message variants', () => {
    const normalized = normalizeOpenRouterVideoResponse({
      error: { message: 'provider said no' },
      status: 'failed',
    });
    expect(normalized.status).toBe('failed');
    expect(normalized.errorMessage).toBe('provider said no');
  });

  it('builds submit payload with optional fields', () => {
    const payload = buildOpenRouterVideoSubmitPayload({
      model: 'google/veo-3.1',
      prompt: 'A clean airflow concept clip.',
      aspectRatio: '16:9',
      durationSec: 8,
      referenceImageUrls: ['https://example.com/ref.png'],
    });
    expect(payload).toEqual({
      model: 'google/veo-3.1',
      prompt: 'A clean airflow concept clip.',
      aspect_ratio: '16:9',
      duration: 8,
      reference_images: ['https://example.com/ref.png'],
    });
  });

  it('normalizes OpenRouter base and allow-host settings', () => {
    expect(resolveOpenRouterBaseUrl('https://openrouter.ai')).toBe(
      'https://openrouter.ai/api/v1',
    );
    expect(resolveOpenRouterBaseUrl('https://openrouter.ai/api/v1')).toBe(
      'https://openrouter.ai/api/v1',
    );
    expect(resolveOpenRouterAllowHosts('api.openrouter.ai, openrouter.ai')).toEqual([
      'api.openrouter.ai',
      'openrouter.ai',
    ]);
  });
});
