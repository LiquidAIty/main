import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { cancelCoderRun, describeCoderAdapters, runCoderSubagent, type RunCoderSubagentResult } from '../coder/execution/coderRouter';
import { claudeCodeAdapter, type CoderAdapterId } from '../coder/execution/coderExecution';
import { resolveCoderWorkspaceRoot, resolveRepoRoot } from '../coder/workspaceRoot';
import { isDevTestModeEnabled } from './devTest';
import { recordAgentEvent } from './agentTelemetry';

export type RuntimeTestStage = 'requested' | 'starting' | 'running' | 'completed' | 'failed' | 'cancelled';
export type RuntimeTestInput = {
  mode: 'single_coder' | 'mag_one_team';
  projectId: string;
  deckId: string;
  parentRunId: string;
  correlationId: string;
  adapter: string;
  repositoryWorkspaceRef: 'repo_root';
  cardId: string;
  objective: string;
  permissionGrant: 'workspace_write';
  expectedOutput: { path: string; marker: string };
  timeoutMs: number;
  developerTest: true;
};

export type RuntimeTestRecord = {
  runtimeTestId: string;
  intendedPrincipal: 'sol';
  actualDriver: 'gpt_sol_standin';
  projectId: string;
  deckId: string;
  parentRunId: string;
  childRunId: string | null;
  correlationId: string;
  adapter: string;
  stage: RuntimeTestStage;
  promptHash: string | null;
  resultLocation: string | null;
  evidenceLocation: string;
  createdAt: string;
  updatedAt: string;
  events: Array<{ stage: string; timestamp: string; detail: Record<string, unknown> }>;
  result: RunCoderSubagentResult | null;
  manifest: { beforeCount: number; afterCount: number | null; created: string[]; changed: string[]; deleted: string[] };
  failure: string | null;
};

const tests = new Map<string, RuntimeTestRecord>();
const activeKeys = new Set<string>();
const controllers = new Map<string, { timeout: NodeJS.Timeout; activeKey: string }>();
const EXCLUDED_DIRS = new Set(['.git', 'coder-workspace', 'node_modules', 'dist', 'build', '.next', '.nx', 'coverage', 'tmp', 'temp', '.cache', '.claude', 'localcoder', 'worldsignal', 'Kronos-main', 'vendor', '.venv', 'autogen-main', '__pycache__', '.pytest_cache', '.codex-temp', 'test-results']);
const MAX_MANIFEST_FILES = 25_000;

type Manifest = Map<string, string>;
type RuntimeRealityDeps = {
  runCoder: typeof runCoderSubagent;
  cancelCoder: typeof cancelCoderRun;
  capture: (root: string) => Manifest;
};

export function describeRuntimeTestCapabilities() {
  return {
    enabled: isDevTestModeEnabled(),
    intendedPrincipal: 'sol',
    actualDriver: 'gpt_sol_standin',
    supportedModes: ['single_coder'],
    unavailableModes: [{ mode: 'mag_one_team', error: 'runtime_test_mode_unavailable' }],
    repositoryGrant: { ref: 'repo_root', root: resolveRepoRoot(), permissionGrants: ['workspace_write'] },
    adapters: describeCoderAdapters(),
    claudeAuthentication: claudeCodeAdapter.authentication(),
  };
}

function hashFile(file: string): string { return createHash('sha256').update(readFileSync(file)).digest('hex'); }

function captureManifest(root: string): Manifest {
  const manifest = new Map<string, string>();
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name);
      const relative = path.relative(root, absolute).replace(/\\/g, '/');
      if (entry.isDirectory()) {
        if (EXCLUDED_DIRS.has(entry.name) || relative === 'client/src/vendor/codebase-memory-ui') continue;
        walk(absolute);
      } else if (entry.isFile()) {
        manifest.set(relative, hashFile(absolute));
        if (manifest.size > MAX_MANIFEST_FILES) throw new Error('runtime_test_manifest_too_large');
      }
    }
  };
  walk(root);
  return manifest;
}

function delta(before: Manifest, after: Manifest) {
  const created = [...after.keys()].filter((key) => !before.has(key)).sort();
  const deleted = [...before.keys()].filter((key) => !after.has(key)).sort();
  const changed = [...after.keys()].filter((key) => before.has(key) && before.get(key) !== after.get(key)).sort();
  return { created, changed, deleted };
}

function validate(input: RuntimeTestInput): void {
  if (!isDevTestModeEnabled()) throw new Error('runtime_test_disabled_in_production');
  if (input.developerTest !== true) throw new Error('runtime_test_marker_required');
  if (input.mode !== 'single_coder') throw new Error(input.mode === 'mag_one_team' ? 'runtime_test_mode_unavailable' : 'runtime_test_mode_unknown');
  if (!input.projectId || !input.deckId || !input.parentRunId || !input.correlationId || !input.cardId) throw new Error('runtime_test_identity_incomplete');
  if (!['claude_code', 'codex'].includes(input.adapter)) throw new Error('runtime_test_adapter_unsupported');
  if (input.repositoryWorkspaceRef !== 'repo_root') throw new Error('runtime_test_repository_grant_invalid');
  if (input.permissionGrant !== 'workspace_write') throw new Error('runtime_test_permission_grant_invalid');
  if (!input.objective || Buffer.byteLength(input.objective, 'utf8') > 100_000) throw new Error('runtime_test_objective_invalid');
  if (!/^[A-Za-z0-9_.-]{1,120}$/.test(input.expectedOutput?.path || '')) throw new Error('runtime_test_expected_path_invalid');
  if (!input.expectedOutput?.marker || input.expectedOutput.marker.length > 500) throw new Error('runtime_test_expected_marker_invalid');
  if (!Number.isFinite(input.timeoutMs) || input.timeoutMs < 10_000 || input.timeoutMs > 600_000) throw new Error('runtime_test_timeout_invalid');
}

function persist(record: RuntimeTestRecord): void {
  const dir = path.join(resolveCoderWorkspaceRoot(), 'runtime-tests', record.runtimeTestId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'evidence.json'), JSON.stringify(record, null, 2), 'utf8');
}

function observe(record: RuntimeTestRecord, stage: string, detail: Record<string, unknown>): void {
  record.updatedAt = new Date().toISOString();
  record.events.push({ stage, timestamp: record.updatedAt, detail });
  if (typeof detail.childRunId === 'string') record.childRunId = detail.childRunId;
  if (typeof detail.promptHash === 'string') record.promptHash = detail.promptHash;
  if (record.childRunId) record.resultLocation = `coder-workspace/runs/${record.childRunId}`;
  recordAgentEvent({ stage: 'dev_probe', status: stage.includes('failed') ? 'failed' : stage.includes('completed') ? 'completed' : 'started', mode: 'real_model_call', caller: 'gpt_sol_standin', projectId: record.projectId, deckId: record.deckId, correlationId: record.correlationId, inputSummary: stage, metadata: { runtimeTestId: record.runtimeTestId, parentRunId: record.parentRunId, childRunId: record.childRunId, adapter: record.adapter, intendedPrincipal: 'sol', actualDriver: 'gpt_sol_standin', ...detail } });
  persist(record);
}

export function startAgentRuntimeTest(
  input: RuntimeTestInput,
  deps: RuntimeRealityDeps = { runCoder: runCoderSubagent, cancelCoder: cancelCoderRun, capture: captureManifest },
): RuntimeTestRecord {
  validate(input);
  const activeKey = `${input.parentRunId}:${input.adapter}`;
  if (activeKeys.has(activeKey)) throw new Error('runtime_test_duplicate_start');
  const root = resolveRepoRoot();
  const target = path.join(root, input.expectedOutput.path);
  if (existsSync(target)) throw new Error('runtime_test_target_already_exists');
  const before = deps.capture(root);
  const runtimeTestId = `rtest_${randomUUID()}`;
  const now = new Date().toISOString();
  const record: RuntimeTestRecord = { runtimeTestId, intendedPrincipal: 'sol', actualDriver: 'gpt_sol_standin', projectId: input.projectId, deckId: input.deckId, parentRunId: input.parentRunId, childRunId: null, correlationId: input.correlationId, adapter: input.adapter, stage: 'requested', promptHash: null, resultLocation: null, evidenceLocation: `coder-workspace/runtime-tests/${runtimeTestId}/evidence.json`, createdAt: now, updatedAt: now, events: [], result: null, manifest: { beforeCount: before.size, afterCount: null, created: [], changed: [], deleted: [] }, failure: null };
  tests.set(runtimeTestId, record);
  activeKeys.add(activeKey);
  observe(record, 'stand_in_test_requested', { expectedPath: input.expectedOutput.path });
  record.stage = 'starting';
  const run = deps.runCoder({ parentRunId: input.parentRunId, projectId: input.projectId, deckId: input.deckId, conversationId: `runtime-test:${runtimeTestId}`, cardId: input.cardId, adapter: input.adapter, approvedPrompt: input.objective }, undefined, (stage, detail) => observe(record, stage, detail));
  const timeoutState: { handle?: NodeJS.Timeout } = {};
  const timeout = new Promise<never>((_, reject) => { timeoutState.handle = setTimeout(() => reject(new Error('runtime_test_timeout')), input.timeoutMs); });
  const timeoutHandle = timeoutState.handle;
  if (!timeoutHandle) throw new Error('runtime_test_timeout_setup_failed');
  controllers.set(runtimeTestId, { timeout: timeoutHandle, activeKey });
  record.stage = 'running';
  observe(record, 'stand_in_test_started', {});
  void Promise.race([run, timeout]).then((result) => {
    if (record.stage === 'cancelled') return;
    record.result = result;
    const after = deps.capture(root);
    const changes = delta(before, after);
    record.manifest = { beforeCount: before.size, afterCount: after.size, ...changes };
    const expectedOnly = changes.created.length === 1 && changes.created[0] === input.expectedOutput.path && changes.changed.length === 0 && changes.deleted.length === 0;
    const content = existsSync(target) ? readFileSync(target, 'utf8') : '';
    record.stage = result.ok && expectedOnly && content.includes(input.expectedOutput.marker) ? 'completed' : 'failed';
    record.failure = record.stage === 'completed' ? null : !result.ok ? result.error : !expectedOnly ? 'runtime_test_unexpected_file_delta' : 'runtime_test_expected_marker_missing';
    observe(record, record.stage === 'completed' ? 'result_returned_to_standin' : 'runtime_test_failed', { created: changes.created, changed: changes.changed, deleted: changes.deleted, markerPresent: content.includes(input.expectedOutput.marker) });
  }).catch((error) => {
    if (record.stage === 'cancelled') return;
    record.stage = 'failed';
    record.failure = error instanceof Error ? error.message : 'runtime_test_failed';
    if (record.failure === 'runtime_test_timeout' && record.childRunId) { try { deps.cancelCoder(input.adapter as CoderAdapterId, record.childRunId); } catch { /* process may already have exited */ } }
    observe(record, 'runtime_test_failed', { error: record.failure });
  }).finally(() => { clearTimeout(timeoutHandle); activeKeys.delete(activeKey); controllers.delete(runtimeTestId); });
  return structuredClone(record);
}

export function getAgentRuntimeTest(id: string): RuntimeTestRecord | null { const record = tests.get(id); return record ? structuredClone(record) : null; }

export function cancelAgentRuntimeTest(id: string, cancel: typeof cancelCoderRun = cancelCoderRun): RuntimeTestRecord {
  const record = tests.get(id);
  if (!record) throw new Error('runtime_test_not_found');
  if (record.stage !== 'running' || !record.childRunId) throw new Error('runtime_test_not_running');
  cancel(record.adapter as CoderAdapterId, record.childRunId);
  const controller = controllers.get(id);
  if (controller) { clearTimeout(controller.timeout); activeKeys.delete(controller.activeKey); controllers.delete(id); }
  record.stage = 'cancelled';
  record.failure = 'cancelled_by_standin';
  observe(record, 'runtime_test_cancelled', {});
  return structuredClone(record);
}

export function resetAgentRuntimeTestsForTest(): void { for (const value of controllers.values()) clearTimeout(value.timeout); controllers.clear(); tests.clear(); activeKeys.clear(); }
