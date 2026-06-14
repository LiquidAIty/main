import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import { CodingRunLifecycleService } from './codingRunLifecycle';
import {
  OpenClaudeConsoleSessionManager,
  type ConsoleChild,
} from './consoleSession';

class FakeChild extends EventEmitter implements ConsoleChild {
  pid: number | null = 42;
  stdout = new PassThrough();
  stderr = new PassThrough();
  stdin = null;
  kill(): boolean {
    return true;
  }
}

function harness() {
  const child = new FakeChild();
  const manager = new OpenClaudeConsoleSessionManager({
    workspaceRoot: tmpdir(),
    env: { OPENAI_API_KEY: 'sk-x1234567890abcd', OPENAI_MODEL: 'test-model' },
    spawnProcess: () => child,
    resolveRuntime: () => ({
      ready: true,
      command: 'node',
      baseArgs: ['bin/openclaude'],
      describe: 'node bin/openclaude',
      shell: false,
      source: 'vendored_built',
      envMissing: [],
    }),
  });
  const recordMemory = vi.fn(async () => ({ id: 'event-1', ts: 'now' }));
  const service = new CodingRunLifecycleService({
    sessionManager: manager,
    idFactory: () => 'coding-run-1',
    recordMemory,
  });
  const run = service.request({
    projectId: 'project-1',
    targetRoot: tmpdir(),
    userGoal: 'Inspect the console bridge.',
    generatedSpec: 'Read-only inspection SPEC.',
  });
  service.approve(run.id);
  const started = manager.start({ targetRoot: tmpdir(), mode: 'task', prompt: 'inspect' });
  if (!started.ok) throw new Error(started.error);
  service.dispatched(run.id, started.session.info.id, 'openrouter', 'test-model');
  return { child, service, run, recordMemory };
}

describe('CodingRunLifecycleService', () => {
  it('creates a planned run that waits for explicit approval', () => {
    const service = new CodingRunLifecycleService({ idFactory: () => 'coding-run-plan' });
    const run = service.request({
      projectId: 'project-1',
      targetRoot: tmpdir(),
      userGoal: 'Inspect code.',
      generatedSpec: 'Compact plan/SPEC.',
    });
    expect(run.status).toBe('awaiting_approval');
    expect(run.generatedSpec).toBe('Compact plan/SPEC.');
    expect(run.sessionId).toBeNull();
  });

  it('collects transcript-only completion without claiming a validated CoderReport', async () => {
    const { child, service, run, recordMemory } = harness();
    child.stdout.write('Inspected apps/backend/src/routes/coder.routes.ts\n');
    child.emit('exit', 0, null);
    const result = await service.refresh(run.id);
    expect(result?.status).toBe('completed');
    expect(result?.validatedCoderReport).toBe(false);
    expect(result?.proofFiles).toContain('apps/backend/src/routes/coder.routes.ts');
    expect(recordMemory).toHaveBeenCalledOnce();
  });

  it('validates a strict structured CoderReport when one appears', async () => {
    const { child, service, run } = harness();
    child.stdout.write(JSON.stringify({
      coderPacketId: 'packet-1',
      status: 'succeeded',
      summary: 'Inspection complete.',
      specComparison: [],
      filesChanged: [],
      proofCommands: ['rg console'],
      proofResults: [],
      failedCommands: [],
      blockers: [],
      assumptions: [],
      outOfScopeFindings: [],
      nextRecommendedTask: '',
      rawOutput: '{}',
    }));
    child.emit('exit', 0, null);
    const result = await service.refresh(run.id);
    expect(result?.validatedCoderReport).toBe(true);
    expect(result?.resultSummary).toBe('Inspection complete.');
  });

  it('reports a failed session honestly', async () => {
    const { child, service, run } = harness();
    child.stderr.write('provider failed');
    child.emit('exit', 2, null);
    const result = await service.refresh(run.id);
    expect(result?.status).toBe('failed');
    expect(result?.blocker).toBe('console_session_exit_code_2');
  });
});
