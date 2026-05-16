import { EventEmitter } from 'events';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const routeHarness = vi.hoisted(() => ({
  safeFetch: vi.fn(),
  spawn: vi.fn(),
  mkdir: vi.fn(),
}));

vi.mock('../../security/safeFetch', () => ({
  safeFetch: routeHarness.safeFetch,
}));

vi.mock('child_process', () => ({
  spawn: routeHarness.spawn,
}));

vi.mock('fs/promises', () => ({
  mkdir: routeHarness.mkdir,
}));

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function makeSpawnSuccess(payload: unknown) {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();

  process.nextTick(() => {
    child.stdout.emit('data', Buffer.from(JSON.stringify(payload)));
    child.emit('close', 0);
  });

  return child;
}

async function createApiServer(): Promise<{
  server: Server;
  baseUrl: string;
}> {
  const express = (await import('express')).default;
  const router = (await import('./mediaVideo.routes')).default;

  const app = express();
  app.use(express.json());
  app.use('/api/v3/projects', router);

  const server = await new Promise<Server>((resolve) => {
    const nextServer = app.listen(0, '127.0.0.1', () => resolve(nextServer));
  });
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}/api/v3/projects`;
  return { server, baseUrl };
}

async function closeServer(server: Server): Promise<void> {
  const closable = server as Server & { closeAllConnections?: () => void };
  closable.closeAllConnections?.();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

describe('mediaVideo.routes', () => {
  beforeEach(() => {
    vi.resetModules();
    routeHarness.safeFetch.mockReset();
    routeHarness.spawn.mockReset();
    routeHarness.mkdir.mockReset();
    routeHarness.mkdir.mockResolvedValue(undefined);
    process.env.OPENROUTER_API_KEY = 'test_key';
    process.env.OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
    process.env.ALLOW_HOSTS_OPENROUTER = 'api.openrouter.ai,openrouter.ai';
    process.env.REQUEST_TIMEOUT_MS = '10000';
  });

  afterEach(() => {
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_BASE_URL;
    delete process.env.ALLOW_HOSTS_OPENROUTER;
    delete process.env.REQUEST_TIMEOUT_MS;
  });

  it('submit maps provider response into local job state', async () => {
    routeHarness.safeFetch.mockResolvedValueOnce(
      jsonResponse({
        id: 'provider_job_1',
        status: 'pending',
        data: { outputs: [{ url: 'https://cdn.example.com/video_a.mp4' }] },
      }),
    );

    const { server, baseUrl } = await createApiServer();
    try {
      const response = await fetch(`${baseUrl}/project_a/media/video/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: 'SceneGraph compiled prompt',
          model: 'google/veo-3',
          aspectRatio: '16:9',
          durationSec: 8,
        }),
      });
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload.ok).toBe(true);
      expect(payload.job.providerJobId).toBe('provider_job_1');
      expect(payload.job.status).toBe('queued');
      expect(payload.job.resultUrls).toEqual(['https://cdn.example.com/video_a.mp4']);

      const safeFetchCall = routeHarness.safeFetch.mock.calls[0];
      expect(safeFetchCall?.[0]).toContain('/videos');
      const submitBody = JSON.parse(String(safeFetchCall?.[1]?.body));
      expect(submitBody.model).toBe('google/veo-3');
      expect(submitBody.prompt).toContain('SceneGraph compiled prompt');
    } finally {
      await closeServer(server);
    }
  });

  it('poll updates status and result payload correctly', async () => {
    routeHarness.safeFetch
      .mockResolvedValueOnce(
        jsonResponse({
          id: 'provider_job_2',
          status: 'running',
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          status: 'completed',
          data: {
            outputs: [{ url: 'https://cdn.example.com/video_b.mp4' }],
            result: { providerTag: 'final' },
          },
        }),
      );

    const { server, baseUrl } = await createApiServer();
    try {
      const submit = await fetch(`${baseUrl}/project_a/media/video/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: 'another prompt',
          model: 'google/veo-3',
        }),
      });
      const submitPayload = await submit.json();
      const localJobId = submitPayload.job.id as string;

      const poll = await fetch(
        `${baseUrl}/project_a/media/video/jobs/${encodeURIComponent(localJobId)}`,
      );
      const pollPayload = await poll.json();

      expect(poll.status).toBe(200);
      expect(pollPayload.ok).toBe(true);
      expect(pollPayload.job.status).toBe('succeeded');
      expect(pollPayload.job.resultUrls).toEqual(['https://cdn.example.com/video_b.mp4']);
      expect(pollPayload.job.resultPayload).toEqual({ providerTag: 'final' });
    } finally {
      await closeServer(server);
    }
  });

  it('peepshow rejects a job with no result url', async () => {
    routeHarness.safeFetch.mockResolvedValueOnce(
      jsonResponse({
        id: 'provider_job_3',
        status: 'running',
      }),
    );

    const { server, baseUrl } = await createApiServer();
    try {
      const submit = await fetch(`${baseUrl}/project_a/media/video/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: 'missing url job',
          model: 'google/veo-3',
        }),
      });
      const submitPayload = await submit.json();
      const localJobId = submitPayload.job.id as string;

      const peepshow = await fetch(
        `${baseUrl}/project_a/media/video/jobs/${encodeURIComponent(localJobId)}/peepshow`,
        { method: 'POST' },
      );
      const peepshowPayload = await peepshow.json();

      expect(peepshow.status).toBe(400);
      expect(peepshowPayload.ok).toBe(false);
      expect(peepshowPayload.error).toBe('media_video_job_result_url_required');
    } finally {
      await closeServer(server);
    }
  });

  it('peepshow accepts only known job HTTP(S) result url', async () => {
    routeHarness.safeFetch.mockResolvedValueOnce(
      jsonResponse({
        id: 'provider_job_4',
        status: 'completed',
        data: {
          outputs: [{ url: 'https://cdn.example.com/video_c.mp4' }],
        },
      }),
    );
    routeHarness.spawn.mockImplementation(() =>
      makeSpawnSuccess({
        outputDir: '/tmp/peepshow',
        reportPath: '/tmp/peepshow/report.html',
        frames: [{}, {}, {}],
        audio: {
          transcript: {
            text: 'concept visual transcript',
            segments: [{}, {}],
          },
        },
      }),
    );

    const { server, baseUrl } = await createApiServer();
    try {
      const submit = await fetch(`${baseUrl}/project_a/media/video/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: 'job with http result',
          model: 'google/veo-3',
        }),
      });
      const submitPayload = await submit.json();
      const localJobId = submitPayload.job.id as string;

      const peepshow = await fetch(
        `${baseUrl}/project_a/media/video/jobs/${encodeURIComponent(localJobId)}/peepshow`,
        { method: 'POST' },
      );
      const peepshowPayload = await peepshow.json();

      expect(peepshow.status).toBe(200);
      expect(peepshowPayload.ok).toBe(true);
      expect(peepshowPayload.sourceUrl).toBe('https://cdn.example.com/video_c.mp4');
      expect(peepshowPayload.analysis.frameCount).toBe(3);
      expect(peepshowPayload.analysis.transcriptSegmentCount).toBe(2);
      expect(routeHarness.spawn).toHaveBeenCalledTimes(1);
      const spawnArgs = routeHarness.spawn.mock.calls[0];
      expect(spawnArgs?.[0]).toBe(process.execPath);
      expect(spawnArgs?.[1]).toEqual(
        expect.arrayContaining([
          expect.stringContaining('node_modules'),
          'https://cdn.example.com/video_c.mp4',
          '--emit',
          'json',
        ]),
      );
    } finally {
      await closeServer(server);
    }
  });
});
