import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// Mock the native child_process execFile so the Hermes proxy router is tested
// with deterministic fixtures and NEVER shells out to the real CLI.
const execMocks = vi.hoisted(() => ({
  execFile: vi.fn(),
}));
vi.mock('node:child_process', () => ({
  execFile: execMocks.execFile,
  spawn: vi.fn(),
}));

import router from './hermesKanban.routes';
import {
  parseHermesJson,
  parseYamlishConfig,
  parseProfileTable,
  hermesGatewayPids,
  isHermesGatewayRunning,
  deriveHermesKanbanProgress,
  readHermesKanbanSessionUsage,
  startNativeHermesKanbanTurn,
  waitForHermesKanbanCardTask,
} from './hermesKanban.routes';

function echo(fixture: unknown, exitCode = 0, stderr = '') {
  return vi.fn((_bin: string, _args: string[], _opts: unknown, cb: (err: Error | null, stdout: string, stderr: string) => void) => {
    cb(
      exitCode === 0 ? null : new Error(`exit ${exitCode}`),
      typeof fixture === 'string'
        ? fixture
        : JSON.stringify(fixture, null, 2),
      stderr,
    );
  });
}

function listen(app: express.Express): Promise<{ server: Server; baseUrl: string }> {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

const BOARDS = [
  {
    slug: 'default',
    name: 'Default',
    is_current: true,
    counts: { blocked: 1, done: 1, todo: 2 },
    total: 4,
  },
];

const TASKS = [
  {
    id: 't_abc',
    title: 'Sample task',
    body: 'Body text',
    assignee: 'default',
    status: 'todo',
    priority: 0,
    created_at: 1785914094,
  },
];

describe('hermesKanban helpers', () => {
  it('derives aggregate retained-root progress without creating worker identities', () => {
    const root = {
      task: { id: 't_625de6e8', status: 'running' },
      parents: ['t_child_done', 't_child_working'],
      children: [],
      events: [{ kind: 'decomposed' }],
      runs: [{ id: 4, ended_at: null, metadata: { worker_session_id: 'terra-root' } }],
    };
    const childDone = {
      task: { id: 't_child_done', status: 'done' },
      parents: [], children: [], events: [],
      runs: [{ id: 5, ended_at: 'finished', metadata: { worker_session_id: 'luna-one' } }],
    };
    const childWorking = {
      task: { id: 't_child_working', status: 'running' },
      parents: [], children: [], events: [],
      runs: [{ id: 6, ended_at: null, metadata: { worker_session_id: 'luna-two' } }],
    };
    expect(deriveHermesKanbanProgress('t_625de6e8', [root, childDone, childWorking])).toEqual({
      nativeRootId: 't_625de6e8',
      nativeRunId: 4,
      phase: 'working',
      tasksCompleted: 1,
      tasksTotal: 3,
      activeWorkers: 2,
      workerSessionIds: ['terra-root', 'luna-one', 'luna-two'],
    });
  });

  it('sums official redacted Hermes session usage provider-free', async () => {
    const runner = vi.fn(async (args: readonly string[]) => ({
      exitCode: 0,
      stderr: '',
      stdout: JSON.stringify({
        id: args[args.indexOf('--session-id') + 1],
        tool_call_count: 2,
        input_tokens: 10,
        output_tokens: 4,
        cache_read_tokens: 5,
        cache_write_tokens: 1,
        reasoning_tokens: 3,
        estimated_cost_usd: 0,
      }),
    }));
    await expect(readHermesKanbanSessionUsage(
      'liquidaity-hermes-steward',
      ['luna-one', 'terra-root'],
      runner as any,
    )).resolves.toEqual({
      toolCallCount: 4,
      providerInputTokens: 20,
      providerOutputTokens: 8,
      providerCachedTokens: 12,
      providerReasoningTokens: 6,
      totalCostUsd: 0,
    });
  });

  it('accepts both current and historical native gateway status wording', () => {
    expect(isHermesGatewayRunning('Gateway is running (PID: 42)')).toBe(true);
    expect(isHermesGatewayRunning('Gateway process running (PID: 42)')).toBe(true);
    expect(isHermesGatewayRunning('Gateway is not running')).toBe(false);
    expect(hermesGatewayPids('Gateway process running (PID: 42, 84)')).toEqual([42, 84]);
    expect(hermesGatewayPids('Gateway is not running')).toEqual([]);
  });

  it('parseHermesJson strips a warning/prefix line and parses the leading JSON', () => {
    expect(
      parseHermesJson(`warning: legacy flags\ndeprecated\n{"ok": true}`),
    ).toEqual({ ok: true });
    expect(parseHermesJson(`[{"id":"t"}]`)).toEqual([{ id: 't' }]);
    expect(() => parseHermesJson('not json at all')).toThrow(/json_not_found/);
  });

  it('parseYamlishConfig decodes scalars without logic', () => {
    expect(
      parseYamlishConfig(
        [
          'dispatch_in_gateway: true',
          'failure_limit: 2',
          'dispatch_interval_seconds: 60',
          'orchestrator_profile: \'\'',
          'default_assignee: \'\'',
          'max_in_progress_per_profile: null',
          'auto_subscribe_on_create: true',
        ].join('\n'),
      ),
    ).toEqual({
      dispatch_in_gateway: true,
      failure_limit: 2,
      dispatch_interval_seconds: 60,
      orchestrator_profile: '',
      default_assignee: '',
      max_in_progress_per_profile: null,
      auto_subscribe_on_create: true,
    });
  });

  it('parseProfileTable slices the plain table by header columns and flags active', () => {
    const table = [
      '',
      ' Profile          Model                        Gateway      Alias        Distribution',
      ' ───────────────    ───────────────────────────    ───────────    ───────────    ────────────────────',
      ' ◆default         deepseek/deepseek-v4-flash   running      —            —',
      '   research        z-ai/glm-5.2                stopped      —            —',
    ].join('\n');
    const rows = parseProfileTable(table);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      name: 'default',
      active: true,
      model: 'deepseek/deepseek-v4-flash',
      gateway: 'running',
    });
    expect(rows[1]).toMatchObject({ name: 'research', active: false, model: 'z-ai/glm-5.2', gateway: 'stopped' });
  });

  it('joins the native root result through ACP show without executing a prompt', async () => {
    const show = vi.fn()
      .mockResolvedValueOnce({
        task: { id: 't_root', status: 'triage' },
        latest_summary: null,
        parents: [],
        children: [],
        events: [],
        runs: [],
      })
      .mockResolvedValueOnce({
        task: { id: 't_root', status: 'done', result: 'Native root result' },
        latest_summary: 'Native root result',
        parents: ['t_child'],
        children: [],
        events: [{ kind: 'completed' }],
        runs: [{ id: 17, status: 'done', summary: 'Native root result' }],
      });

    const result = await waitForHermesKanbanCardTask('orchestrator', 't_root', {
      show,
      pause: async () => undefined,
      timeoutMs: 1_000,
    });

    expect(show).toHaveBeenCalledTimes(2);
    expect(result.taskId).toBe('t_root');
    expect(result.runId).toBe(17);
    expect(result.snapshot.latest_summary).toBe('Native root result');
  });

  it('uses ACP exact lookup to rejoin and join one native Triage root', async () => {
    const runner = vi.fn(async (
      args: readonly string[],
      _bin?: string,
      _timeoutMs?: number,
      _envOverrides?: NodeJS.ProcessEnv,
    ) => {
      if (args.join(' ') === 'gateway stop') {
        return { exitCode: 0, stdout: 'Gateway stopped', stderr: '' };
      }
      if (args.join(' ') === 'gateway status') {
        return { exitCode: 0, stdout: 'Gateway process running (PID: 42)', stderr: '' };
      }
      if (args.join(' ') === 'config get kanban') {
        return {
          exitCode: 0,
          stdout: 'dispatch_in_gateway: true\nauto_decompose: true\n',
          stderr: '',
        };
      }
      throw new Error(`unexpected command: ${args.join(' ')}`);
    });
    const requestExtension = vi.fn(async (method: string) => {
      if (method === '_kanban/find') return { id: 't_root', duplicateIds: [] };
      if (method === '_kanban/create') throw new Error('must not duplicate the retained root');
      if (method === '_kanban/show') {
        return {
          task: { id: 't_root', status: 'done', result: 'Native root synthesis' },
          latest_summary: 'Native root synthesis',
          parents: ['t_worker_a', 't_worker_b'],
          children: [],
          events: [{ kind: 'decomposed' }, { kind: 'completed' }],
          runs: [{ id: 23, profile: 'orchestrator', status: 'done' }],
        };
      }
      throw new Error(`unexpected ACP method: ${method}`);
    });
    const events: any[] = [];
    const configureCardMcpProfile = vi.fn(() => 'profile-home');
    // Windows hermes.exe is a launcher; native readiness reports the handed-off
    // long-running Python gateway PID rather than this launcher PID.
    const spawnGateway = vi.fn(async () => 41);
    const handle = await startNativeHermesKanbanTurn({
      sessionKey: 'unused-for-native-kanban',
      projectId: 'project-1',
      deckId: 'deck_builder',
      conversationId: 'conversation-1',
      parentRunId: 'run-native-kanban-1',
      cardId: 'card_kanban',
      title: 'Saved Kanban Card',
      runtime: { kind: 'hermes', mode: 'kanban', profile: 'orchestrator' },
      prompt: 'Saved Card instructions',
      provider: 'openai',
      modelKey: 'saved-model-key',
      providerModelId: 'saved-model-id',
      accessMode: 'chatgpt-account',
      tools: ['knowgraph.search'],
      nativeTools: ['delegate_task'],
      skills: ['research'],
      toolsets: ['memory'],
      mcpConnectionIds: [],
      message: 'The dynamic input',
      nativeMission: 'Saved instructions\n\nMission\n\nThinkGraph:root-1',
    }, (event) => events.push(event), {
      runner,
      requestExtension,
      configureCardMcpProfile,
      spawnGateway,
      cardMcpServer: {
        type: 'http',
        url: 'http://127.0.0.1:8765/mcp',
        headers: [{ name: 'Authorization', value: 'Bearer signed-test-token' }],
      },
    });

    const completed = await handle.done;
    expect(completed.finalText).toBe('Native root synthesis');
    expect(completed.transport).toMatchObject({
      planType: 'hermes-native-kanban',
      nativeTaskId: 't_root',
      nativeRunId: 23,
      nativeStatus: 'done',
    });
    expect(runner.mock.calls.find(([args]) => args.join(' ') === 'gateway status')?.[2]).toBe(60_000);
    expect(runner.mock.calls.find(([args]) => args.join(' ') === 'gateway stop')?.[2]).toBe(60_000);
    expect(runner.mock.calls.find(([args]) => args.join(' ') === 'gateway stop')?.[3]).toMatchObject({
      LIQUIDAITY_KANBAN_CARD_MCP_BEARER: 'signed-test-token',
      OPENAI_API_KEY: '',
      OPENROUTER_API_KEY: '',
      OPENROUTER_BASE_URL: '',
    });
    expect(spawnGateway).toHaveBeenCalledWith(expect.objectContaining({
      LIQUIDAITY_KANBAN_CARD_MCP_BEARER: 'signed-test-token',
      OPENROUTER_API_KEY: '',
    }));
    expect(configureCardMcpProfile).toHaveBeenCalledWith(expect.objectContaining({
      profile: 'orchestrator',
      mcpUrl: 'http://127.0.0.1:8765/mcp',
      mcpTokenEnv: 'LIQUIDAITY_KANBAN_CARD_MCP_BEARER',
    }));
    expect(JSON.stringify(configureCardMcpProfile.mock.calls)).not.toContain('signed-test-token');
    expect(requestExtension).toHaveBeenCalledTimes(2);
    expect(requestExtension.mock.calls[0]).toEqual([
      '_kanban/find',
      {
        title: 'Saved Kanban Card',
        body: 'Saved instructions\n\nMission\n\nThinkGraph:root-1',
        createdBy: 'card_kanban',
      },
    ]);
    expect(requestExtension.mock.calls[1]).toEqual(['_kanban/show', { taskId: 't_root' }]);
    expect(requestExtension.mock.calls.some(([method]) => String(method).includes('bind-card-runtime'))).toBe(false);
    expect(requestExtension.mock.calls.some(([method]) => method === 'session/prompt')).toBe(false);
    expect(events).toEqual(expect.arrayContaining([
      { kind: 'text', text: 'Native root synthesis' },
      expect.objectContaining({ kind: 'done', fullText: 'Native root synthesis' }),
    ]));
  });
});

describe('hermesKanban read routes', () => {
  let app: express.Express;
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    execMocks.execFile.mockReset();
    app = express();
    app.use(express.json());
    app.use('/hermes-kanban', router);
    const bound = await listen(app);
    server = bound.server;
    baseUrl = bound.baseUrl;
  });

  afterEach(() => {
    server?.close();
  });

  it('GET /boards returns the native boards JSON envelope', async () => {
    execMocks.execFile.mockImplementation(
      echo(BOARDS),
    );
    const response = await fetch(`${baseUrl}/hermes-kanban/boards`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.data).toEqual(BOARDS);
    expect(execMocks.execFile).toHaveBeenCalledWith(
      expect.stringMatching(/[\\/]Hermes[\\/]venv[\\/]Scripts[\\/]hermes\.exe$/i),
      ['kanban', 'boards', 'list', '--json'],
      expect.objectContaining({
        shell: false,
        env: expect.objectContaining({
          HERMES_HOME: expect.stringMatching(/[\\/]Hermes[\\/]\.hermes$/i),
        }),
      }),
      expect.any(Function),
    );
  });

  it('GET /tasks passes board / archived / tenant / assignee flags', async () => {
    execMocks.execFile.mockImplementation(echo(TASKS));
    const response = await fetch(
      `${baseUrl}/hermes-kanban/tasks?board=ops&includeArchived=true&tenant=acme&assignee=research`,
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.data).toEqual(TASKS);
    const [bin, args] = execMocks.execFile.mock.calls[0];
    expect(bin).toMatch(/[\\/]Hermes[\\/]venv[\\/]Scripts[\\/]hermes\.exe$/i);
    expect(args).toEqual([
      'kanban',
      '--board',
      'ops',
      'list',
      '--json',
      '--archived',
      '--tenant',
      'acme',
      '--assignee',
      'research',
    ]);
  });

  it('GET /tasks without board keeps the command default-board', async () => {
    execMocks.execFile.mockImplementation(echo(TASKS));
    const response = await fetch(`${baseUrl}/hermes-kanban/tasks`);
    expect((await response.json()).ok).toBe(true);
    const [bin, args] = execMocks.execFile.mock.calls[0];
    expect(bin).toMatch(/[\\/]Hermes[\\/]venv[\\/]Scripts[\\/]hermes\.exe$/i);
    expect(args).toEqual(['kanban', 'list', '--json']);
  });

  it('GET /tasks/:id returns the show envelope (task + deps + events)', async () => {
    const shown = {
      task: TASKS[0],
      latest_summary: null,
      parents: ['t_parent'],
      children: [],
      comments: [],
      events: [],
      runs: [],
    };
    execMocks.execFile.mockImplementation(echo(shown));
    const response = await fetch(`${baseUrl}/hermes-kanban/tasks/t_abc`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.data.parents).toEqual(['t_parent']);
    const [, args] = execMocks.execFile.mock.calls[0];
    expect(args).toEqual(['kanban', 'show', 't_abc', '--json']);
  });

  it('GET /stats and GET /system parse gateway status text', async () => {
    execMocks.execFile.mockImplementation((_bin, args, _opts, cb) => {
      const joined = args.join(' ');
      if (joined.includes('gateway status')) {
        cb(null, '✓ Gateway process running (PID: 44948)\n', '');
      } else if (joined.includes('config get kanban')) {
        cb(null, 'dispatch_in_gateway: true\ndispatch_interval_seconds: 60\n', '');
      } else if (joined.includes('kanban stats')) {
        cb(null, JSON.stringify({ by_status: { todo: 2 }, by_assignee: {}, oldest_ready_age_seconds: null, now: 1785 }));
      } else if (joined.includes('kanban diagnostics')) {
        cb(null, '[]');
      } else if (joined.includes('profile list')) {
        cb(null, ' Profile   Model   Gateway   Alias   Distribution\n ◆default   deepseek   running   —   —\n');
      } else {
        cb(new Error('unexpected ' + joined), '', 'nope');
      }
    });
    const response = await fetch(`${baseUrl}/hermes-kanban/system`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.data.gateway).toEqual({ running: true, pid: 44948, raw: expect.stringContaining('Gateway process running') });
    expect(body.data.dispatcher.running).toBe(true);
    expect(body.data.dispatcher.intervalSeconds).toBe(60);
    expect(
      execMocks.execFile.mock.calls.filter((call) => call[1].join(' ') === 'gateway status'),
    ).toHaveLength(1);
  });

  it('GET /config returns kanban + delegation blocks', async () => {
    execMocks.execFile.mockImplementation((_bin, args, _opts, cb) => {
      const joined = args.join(' ');
      if (joined.includes('config get kanban')) {
        cb(null, 'auto_decompose: true\nfailure_limit: 2\n', '');
      } else if (joined.includes('config get delegation')) {
        cb(null, 'max_concurrent_children: 3\nmax_spawn_depth: 1\n', '');
      } else {
        cb(new Error('unexpected'), '', 'no');
      }
    });
    const response = await fetch(`${baseUrl}/hermes-kanban/config`);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.data).toEqual({
      kanban: { auto_decompose: true, failure_limit: 2 },
      delegation: { max_concurrent_children: 3, max_spawn_depth: 1 },
    });
  });

  it('reads never mutate: no route calls dispatch/promote/complete', async () => {
    execMocks.execFile.mockImplementation(echo(TASKS));
    await fetch(`${baseUrl}/hermes-kanban/boards`);
    await fetch(`${baseUrl}/hermes-kanban/tasks`);
    await fetch(`${baseUrl}/hermes-kanban/stats`);
    const calls = execMocks.execFile.mock.calls.map((c) => c[1].join(' '));
    for (const call of calls) {
      expect(call).not.toMatch(/dispatch|promote|complete|archive|block|create/);
    }
  });
});

describe('hermesKanban mutation routes (explicit user action only)', () => {
  let app: express.Express;
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    execMocks.execFile.mockReset();
    app = express();
    app.use(express.json());
    app.use('/hermes-kanban', router);
    const bound = await listen(app);
    server = bound.server;
    baseUrl = bound.baseUrl;
  });

  afterEach(() => {
    server?.close();
  });

  it('POST /tasks/:id/comment builds the native comment command', async () => {
    execMocks.execFile.mockImplementation(echo('Comment appended.'));
    const response = await fetch(`${baseUrl}/hermes-kanban/tasks/t_abc/comment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'please look', author: 'operator' }),
    });
    const body = await response.json();
    expect(body.ok).toBe(true);
    const [bin, args] = execMocks.execFile.mock.calls[0];
    expect(bin).toMatch(/[\\/]Hermes[\\/]venv[\\/]Scripts[\\/]hermes\.exe$/i);
    expect(args).toEqual(['kanban', 'comment', 't_abc', 'please look', '--author', 'operator']);
  });

  it('POST /tasks/:id/block requires no body and defaults kind', async () => {
    execMocks.execFile.mockImplementation(echo('blocked'));
    const response = await fetch(`${baseUrl}/hermes-kanban/tasks/t_abc/block`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'waiting on op' }),
    });
    expect((await response.json()).ok).toBe(true);
    const [, args] = execMocks.execFile.mock.calls[0];
    expect(args).toEqual(['kanban', 'block', 't_abc', '--kind', 'needs_input', 'waiting on op']);
  });

  it('POST /dispatch runs one dispatcher pass', async () => {
    execMocks.execFile.mockImplementation(echo({ reclaimed: [], promoted: [], spawned: [] }));
    const response = await fetch(`${baseUrl}/hermes-kanban/dispatch`, { method: 'POST' });
    const body = await response.json();
    expect(body.ok).toBe(true);
    const [, args] = execMocks.execFile.mock.calls[0];
    expect(args).toEqual(['kanban', 'dispatch', '--json']);
  });

  it.each([
    {
      path: '/create',
      body: { board: 'ops', title: 'Fix wiring', body: 'Bounded work', assignee: 'default', priority: 2, parent: 't_parent' },
      expected: ['kanban', '--board', 'ops', 'create', 'Fix wiring', '--body', 'Bounded work', '--assignee', 'default', '--priority', '2', '--parent', 't_parent', '--json'],
    },
    {
      path: '/tasks/t_abc/unblock',
      body: { reason: 'input received' },
      expected: ['kanban', 'unblock', '--reason', 'input received', 't_abc'],
    },
    { path: '/tasks/t_abc/archive', body: {}, expected: ['kanban', 'archive', 't_abc'] },
    { path: '/tasks/t_abc/promote', body: {}, expected: ['kanban', 'promote', 't_abc'] },
    {
      path: '/tasks/t_abc/complete',
      body: { result: 'done' },
      expected: ['kanban', 'complete', 't_abc', '--result', 'done'],
    },
    {
      path: '/tasks/t_abc/edit',
      body: { result: 'backfilled', summary: 'handoff', metadata: '{"tests":1}' },
      expected: ['kanban', 'edit', 't_abc', '--result', 'backfilled', '--summary', 'handoff', '--metadata', '{"tests":1}'],
    },
    {
      path: '/tasks/t_abc/assign',
      body: { assignee: 'research' },
      expected: ['kanban', 'assign', 't_abc', 'research'],
    },
    {
      path: '/tasks/t_abc/link',
      body: { parent: 't_parent' },
      expected: ['kanban', 'link', 't_parent', 't_abc'],
    },
    {
      path: '/tasks/t_abc/unlink',
      body: { parent: 't_parent' },
      expected: ['kanban', 'unlink', 't_parent', 't_abc'],
    },
    { path: '/gateway/restart', body: {}, expected: ['gateway', 'restart'] },
  ])('POST $path matches the installed native CLI contract', async ({ path, body, expected }) => {
    execMocks.execFile.mockImplementation(echo(path === '/create' ? { id: 't_new' } : 'ok'));
    const response = await fetch(`${baseUrl}/hermes-kanban${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    expect(response.status).toBe(200);
    expect(execMocks.execFile.mock.calls[0][1]).toEqual(expected);
  });

  it('POST validation rejects missing comment text', async () => {
    execMocks.execFile.mockClear();
    const response = await fetch(`${baseUrl}/hermes-kanban/tasks/t_abc/comment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(400);
    expect(execMocks.execFile).not.toHaveBeenCalled();
  });
});
