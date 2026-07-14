import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClaudeCodeAdapter, CodexAdapter, createApprovedCoderRun, hashPrompt, type CoderAdapterId } from './coderExecution';

const roots: string[] = [];

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'coder-adapter-'));
  roots.push(root);
  mkdirSync(path.join(root, '.git'));
  mkdirSync(path.join(root, 'coder-workspace', 'runs'), { recursive: true });
  vi.stubEnv('LIQUIDAITY_GRPC_CWD', root);
  return root;
}

function packet(root: string, overrides: Record<string, unknown> = {}) {
  return createApprovedCoderRun({
    projectId: 'project_1',
    parentRunId: 'parent_run_1',
    deckId: 'deck_builder',
    cardId: 'card_local_coder',
    adapter: 'claude_code' as CoderAdapterId,
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
    const adapter = new ClaudeCodeAdapter(process.execPath, false);
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
    const adapter = new ClaudeCodeAdapter(process.execPath, false);
    expect(() => adapter.prepare(packet(fixture(), overrides))).toThrow(error);
  });

  it('reports availability without a model call', () => {
    const result = new ClaudeCodeAdapter(process.execPath, false).availability();
    expect(result.available).toBe(true);
    expect(result.version).toBeTruthy();
  });

  it('uses the exact repository and prompt without bare mode or injected Claude credentials', () => {
    const root = fixture();
    vi.stubEnv('ANTHROPIC_API_KEY', 'must-not-pass');
    vi.stubEnv('CLAUDE_CODE_OAUTH_TOKEN', 'must-not-pass');
    const adapter = new ClaudeCodeAdapter(process.execPath, false);
    const approved = packet(root, { runId: 'claude_launch' });
    adapter.prepare(approved);
    const launch = adapter.inspectLaunch('claude_launch');
    expect(launch.cwd).toBe(root);
    expect(launch.args).not.toContain('--bare');
    expect(launch.args.at(-1)).toBe(approved.approvedPrompt);
    expect(launch.environmentKeys).not.toContain('ANTHROPIC_API_KEY');
    expect(launch.environmentKeys).not.toContain('CLAUDE_CODE_OAUTH_TOKEN');
    adapter.dispose('claude_launch');
  });
});

describe('CodexAdapter', () => {
  it('rejects a packet approved for a different adapter', () => {
    const adapter = new CodexAdapter(process.execPath);
    expect(() => adapter.prepare(packet(fixture()))).toThrow('coder_adapter_mismatch');
  });

  it('prepares a run-scoped session with the shared report schema on disk', () => {
    const root = fixture();
    const adapter = new CodexAdapter(process.execPath);
    const approved = packet(root, { adapter: 'codex', runId: 'coder_codex_one' });
    expect(adapter.prepare(approved)).toMatchObject({ status: 'prepared', packet: { runId: 'coder_codex_one', adapter: 'codex' } });
    expect(existsSync(path.join(root, 'coder-workspace', 'runs', 'coder_codex_one', 'report-schema.json'))).toBe(true);
    expect(existsSync(path.join(root, 'coder-workspace', 'runs', 'coder_codex_one', 'prompt.txt'))).toBe(true);
    adapter.dispose('coder_codex_one');
    expect(adapter.inspect('coder_codex_one')).toBeNull();
  });

  it('reports availability without a model call', () => {
    const result = new CodexAdapter(process.execPath).availability();
    expect(result.available).toBe(true);
    expect(result.version).toBeTruthy();
  });
});

describe('ClaudeCodeAdapter caller authority (dossier §3.3)', () => {
  function prepared(root: string, overrides: Record<string, unknown>, runId: string) {
    const adapter = new ClaudeCodeAdapter(process.execPath, false);
    adapter.prepare(packet(root, { ...overrides, runId }));
    return adapter;
  }

  function readMcp(root: string, runId: string) {
    return JSON.parse(readFileSync(path.join(root, 'coder-workspace', 'runs', runId, 'mcp.json'), 'utf8'));
  }

  it('with no authority set, produces the exact legacy args + dev-harness-only MCP (behavior-preserving)', () => {
    const root = fixture();
    const adapter = prepared(root, {}, 'coder_legacy');
    const args = adapter.inspectLaunch('coder_legacy').args;
    expect(args[args.indexOf('--allowedTools') + 1]).toBe('Bash,PowerShell');
    expect(args[args.indexOf('--disallowedTools') + 1]).toBe('WebFetch,WebSearch,Write,Edit,NotebookEdit');
    expect(args[args.indexOf('--permission-mode') + 1]).toBe('dontAsk');
    expect(Object.keys(readMcp(root, 'coder_legacy').mcpServers)).toEqual(['liquid_aity_coder']);
    adapter.dispose('coder_legacy');
  });

  it('with direct_main_audit, is read-only (Read/Grep/Glob, no shell, denies Edit) and composes the CodeGraph MCP host', () => {
    const root = fixture();
    const adapter = prepared(root, { authority: 'direct_main_audit' }, 'coder_audit');
    const args = adapter.inspectLaunch('coder_audit').args;
    const allowed = args[args.indexOf('--allowedTools') + 1];
    expect(allowed).toContain('Read');
    expect(allowed).toContain('Grep');
    expect(allowed).toContain('Glob');
    expect(allowed).not.toContain('Bash');
    expect(allowed).not.toContain('PowerShell');
    expect(args[args.indexOf('--disallowedTools') + 1]).toContain('Edit');
    const mcp = readMcp(root, 'coder_audit');
    expect(Object.keys(mcp.mcpServers).sort()).toEqual(['liquid_aity_codegraph', 'liquid_aity_coder'].sort());
    expect(String(mcp.mcpServers.liquid_aity_codegraph.args[0]).replace(/\\/g, '/')).toMatch(/codegraph_doorway_mcp\.py$/);
    adapter.dispose('coder_audit');
  });

  it('with mag_one_execution, grants Edit/Write/Bash and keeps dev-harness-only MCP', () => {
    const root = fixture();
    const adapter = prepared(root, { authority: 'mag_one_execution' }, 'coder_exec');
    const allowed = adapter.inspectLaunch('coder_exec').args[
      adapter.inspectLaunch('coder_exec').args.indexOf('--allowedTools') + 1
    ];
    expect(allowed).toContain('Edit');
    expect(allowed).toContain('Write');
    expect(allowed).toContain('Bash');
    expect(Object.keys(readMcp(root, 'coder_exec').mcpServers)).toEqual(['liquid_aity_coder']);
    adapter.dispose('coder_exec');
  });
});
