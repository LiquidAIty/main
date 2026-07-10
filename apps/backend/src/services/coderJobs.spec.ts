// Coder job interface over the canonical job folder (handoff/<id>/prompt.md +
// returns/<id>/): list, get, claim with adapter identity. No second job store
// — everything reads the same folders runMagOne/write_mag_one_instructions use.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { claimCoderJob, getCoderJob, isValidJobId, listCoderJobs } from './coderJobs';

let ws: string;

beforeEach(() => {
  ws = mkdtempSync(path.join(tmpdir(), 'coder-jobs-'));
});

afterEach(() => {
  rmSync(ws, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

function seedJob(jobId: string, prompt = '# Job\ndo the thing'): void {
  mkdirSync(path.join(ws, 'handoff', jobId), { recursive: true });
  writeFileSync(path.join(ws, 'handoff', jobId, 'prompt.md'), prompt, 'utf8');
}

describe('listCoderJobs / getCoderJob', () => {
  it('lists only folders that actually contain a prompt.md (a job IS its prompt)', () => {
    seedJob('job_real');
    mkdirSync(path.join(ws, 'handoff', 'job_empty'), { recursive: true });
    const jobs = listCoderJobs(ws);
    expect(jobs.map((j) => j.jobId)).toEqual(['job_real']);
    expect(jobs[0].claim).toBeNull();
  });

  it('returns the prompt bytes and real returned files', () => {
    seedJob('job_a', '# exact contract bytes');
    mkdirSync(path.join(ws, 'returns', 'job_a', 'card_x'), { recursive: true });
    writeFileSync(path.join(ws, 'returns', 'job_a', 'card_x', 'report.md'), 'out', 'utf8');
    const job = getCoderJob('job_a', ws);
    if ('error' in job) throw new Error(job.error);
    expect(job.prompt).toBe('# exact contract bytes');
    expect(job.returnedFilePaths).toEqual(['returns/job_a/card_x/report.md']);
  });

  it('fails honestly on unknown or traversal-shaped ids', () => {
    expect(getCoderJob('job_missing', ws)).toMatchObject({ error: expect.stringContaining('coder_job_not_found') });
    expect(getCoderJob('../etc', ws)).toMatchObject({ error: expect.stringContaining('coder_job_id_invalid') });
    expect(isValidJobId('..')).toBe(false);
    expect(isValidJobId('job_ok-1')).toBe(true);
  });
});

describe('claimCoderJob — adapter identity on the shared job', () => {
  it('claims with a known execution mode and records the adapter', () => {
    seedJob('job_c');
    const result = claimCoderJob(
      { jobId: 'job_c', adapter: 'claude-code', executionMode: 'external_coder' },
      ws,
    );
    expect(result.ok).toBe(true);
    const stored = JSON.parse(readFileSync(path.join(ws, 'handoff', 'job_c', 'claimed.json'), 'utf8'));
    expect(stored.adapter).toBe('claude-code');
    expect(stored.executionMode).toBe('external_coder');
    expect(listCoderJobs(ws)[0].claim?.adapter).toBe('claude-code');
  });

  it('rejects unknown execution modes and double claims (force re-claims)', () => {
    seedJob('job_d');
    expect(
      claimCoderJob({ jobId: 'job_d', adapter: 'x', executionMode: 'yolo_mode' }, ws),
    ).toMatchObject({ ok: false, error: expect.stringContaining('coder_job_execution_mode_unknown') });
    expect(
      claimCoderJob({ jobId: 'job_d', adapter: 'codex', executionMode: 'mcp_coder' }, ws).ok,
    ).toBe(true);
    expect(
      claimCoderJob({ jobId: 'job_d', adapter: 'openclaude', executionMode: 'openclaude_api_coder' }, ws),
    ).toMatchObject({ ok: false, error: expect.stringContaining('coder_job_already_claimed') });
    const forced = claimCoderJob(
      { jobId: 'job_d', adapter: 'openclaude', executionMode: 'openclaude_api_coder', model: 'openai/gpt-5.1-chat', force: true },
      ws,
    );
    expect(forced.ok).toBe(true);
    if (forced.ok) expect(forced.claim.model).toBe('openai/gpt-5.1-chat');
  });
});
