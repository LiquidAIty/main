import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClaudeCodeAdapter, createApprovedCoderRun, hashPrompt } from './coderExecution';

const roots: string[] = [];

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'claude-adapter-'));
  roots.push(root);
  mkdirSync(path.join(root, '.git'));
  mkdirSync(path.join(root, 'coder-workspace', 'runs'), { recursive: true });
  vi.stubEnv('LIQUIDAITY_GRPC_CWD', root);
  return root;
}

function packet(root: string, overrides: Record<string, unknown> = {}) {
  return createApprovedCoderRun({
    projectId: 'project_1',
    deckId: 'deck_builder',
    cardId: 'card_local_coder',
    invocationMode: 'individual',
    repositoryRoot: root,
    allowedPaths: ['apps/backend/src'],
    deniedPaths: ['.env'],
    rawRequest: 'Inspect the adapter.',
    approvedPrompt: 'Exact approved bytes.\n',
    promptVersion: 1,
    workspaceGranted: true,
    liveRunApproved: true,
    proofRequirements: ['backend TypeScript compile'],
    ...overrides,
  } as Parameters<typeof createApprovedCoderRun>[0]);
}

afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('ClaudeCodeAdapter', () => {
  it('binds the exact UTF-8 approved prompt bytes to SHA-256', () => {
    expect(hashPrompt('a\r\nb')).not.toBe(hashPrompt('a\nb'));
    expect(packet(fixture()).promptHash).toBe(hashPrompt('Exact approved bytes.\n'));
  });

  it('prepares one strict run-scoped session and rejects duplicate preparation', () => {
    const adapter = new ClaudeCodeAdapter(process.execPath);
    const approved = packet(fixture(), { runId: 'coder_one' });
    expect(adapter.prepare(approved)).toMatchObject({ status: 'prepared', packet: { runId: 'coder_one' } });
    expect(() => adapter.prepare(approved)).toThrow('coder_run_already_exists');
    adapter.dispose('coder_one');
    expect(adapter.inspect('coder_one')).toBeNull();
  });

  it.each([
    [{ workspaceGranted: false }, 'coder_run_not_approved'],
    [{ liveRunApproved: false }, 'coder_run_not_approved'],
    [{ approvedPrompt: '' }, 'approved_prompt_size_invalid'],
    [{ allowedPaths: ['../secret'] }, 'allowed_path_invalid'],
  ])('fails closed for invalid configuration %#', (overrides, error) => {
    const adapter = new ClaudeCodeAdapter(process.execPath);
    expect(() => adapter.prepare(packet(fixture(), overrides))).toThrow(error);
  });

  it('reports availability without a model call', () => {
    const result = new ClaudeCodeAdapter(process.execPath).availability();
    expect(result.available).toBe(true);
    expect(result.version).toBeTruthy();
  });
});
