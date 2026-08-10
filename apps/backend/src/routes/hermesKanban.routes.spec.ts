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
}));

import router from './hermesKanban.routes';
import {
  parseHermesJson,
  parseYamlishConfig,
  parseProfileTable,
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
