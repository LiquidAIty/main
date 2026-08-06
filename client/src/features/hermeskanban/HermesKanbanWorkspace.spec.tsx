// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import HermesKanbanWorkspace from './HermesKanbanWorkspace';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const BOARDS = [
  { slug: 'default', name: 'Default', is_current: true, counts: { todo: 2, blocked: 1, done: 1 }, total: 4 },
];

const TASKS = [
  { id: 't_one', title: 'Alpha task', body: 'body A', assignee: 'default', status: 'todo', priority: 2, created_at: 1785914094 },
  { id: 't_two', title: 'Beta task', body: 'body B', assignee: 'research', status: 'running', priority: 0, created_at: 1785914095 },
  { id: 't_three', title: 'Gamma task', body: 'body C', assignee: 'default', status: 'blocked', priority: 0, created_at: 1785914096 },
];

const STATS = {
  by_status: { todo: 1, running: 1, blocked: 1 },
  by_assignee: { default: { todo: 1, blocked: 1 }, research: { running: 1 } },
  oldest_ready_age_seconds: null,
  now: 1785988028,
};

const SYSTEM = {
  gateway: { running: true, pid: 44948, raw: 'Gateway process running (PID: 44948)' },
  dispatcher: { running: true, dispatchInGateway: true, intervalSeconds: 60, staleTimeoutSeconds: 14400 },
  stats: STATS,
  diagnostics: [],
  profiles: [
    { name: 'default', active: true, model: 'deepseek/deepseek-v4-flash', gateway: 'running', alias: '—', distribution: '—' },
  ],
  now: 1785988028,
};

const CONFIG = {
  kanban: {
    dispatch_in_gateway: true,
    dispatch_interval_seconds: 60,
    failure_limit: 2,
    orchestrator_profile: '',
    default_assignee: '',
    max_in_progress_per_profile: null,
    auto_decompose: true,
  },
  delegation: { max_concurrent_children: 3, max_spawn_depth: 1 },
};

const PROFILES = [
  { name: 'default', active: true, model: 'deepseek/deepseek-v4-flash', gateway: 'running', alias: '—', distribution: '—', description: 'Default profile' },
];

const SHOW = {
  task: TASKS[0],
  latest_summary: null,
  parents: ['t_parent'],
  children: [],
  comments: [{ author: 'default', body: 'please look', created_at: 1785915819 }],
  events: [{ kind: 'created', payload: { status: 'todo' }, created_at: 1785914094, run_id: null }],
  runs: [],
};

type FetchCall = { url: string; init?: RequestInit };

let fetchMock: ReturnType<typeof vi.fn>;
let calls: FetchCall[] = [];

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function installFetch() {
  calls = [];
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const method = (init?.method || 'GET').toUpperCase();
    if (url.startsWith('/api/hermes-kanban/boards')) return jsonResponse({ ok: true, data: BOARDS });
    if (url.startsWith('/api/hermes-kanban/tasks/')) {
      return jsonResponse({ ok: true, data: SHOW });
    }
    if (url.startsWith('/api/hermes-kanban/tasks')) {
      return jsonResponse({ ok: true, data: TASKS });
    }
    if (url.startsWith('/api/hermes-kanban/stats')) return jsonResponse({ ok: true, data: STATS });
    if (url.startsWith('/api/hermes-kanban/system')) return jsonResponse({ ok: true, data: SYSTEM });
    if (url.startsWith('/api/hermes-kanban/config')) return jsonResponse({ ok: true, data: CONFIG });
    if (url.startsWith('/api/hermes-kanban/profiles')) return jsonResponse({ ok: true, data: PROFILES });
    if (url.startsWith('/api/hermes-kanban/create')) return jsonResponse({ ok: true, data: { id: 't_new' } });
    if (url.startsWith('/api/hermes-kanban/dispatch')) return jsonResponse({ ok: true, data: { reclaimed: [], promoted: [], spawned: [] } });
    if (method === 'POST') return jsonResponse({ ok: true, data: { stdout: 'ok' } });
    return jsonResponse({ ok: false, error: 'hermes_kanban_mock_unhandled_' + url });
  });
  vi.stubGlobal('fetch', fetchMock);
}

let container: HTMLDivElement | null = null;

beforeEach(() => {
  installFetch();
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  vi.unstubAllGlobals();
  act(() => {
    if (container) {
      // unmount to flush effects
      container.remove();
      container = null;
    }
  });
});

function renderWorkspace() {
  const root = createRoot(container as HTMLDivElement);
  act(() => {
    root.render(<HermesKanbanWorkspace onClose={() => undefined} />);
  });
  return root;
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

function click(host: Element | null, testid: string) {
  const el = host?.querySelector(`[data-testid="${testid}"]`) as HTMLButtonElement | null;
  expect(el, `missing [data-testid="${testid}"]`).not.toBeNull();
  act(() => {
    (el as HTMLButtonElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  return el;
}

const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
  window.HTMLInputElement.prototype,
  'value',
)?.set;

function setInputValue(host: Element | null, testid: string, value: string) {
  const el = host?.querySelector(`[data-testid="${testid}"]`) as HTMLInputElement | null;
  expect(el, `missing input [data-testid="${testid}"]`).not.toBeNull();
  act(() => {
    nativeInputValueSetter?.call(el, value);
    el?.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('HermesKanbanWorkspace — boards and lanes', () => {
  it('loads boards + tasks through the /api/hermes-kanban bridge and groups into lanes', async () => {
    const root = renderWorkspace();
    await flush();

    expect(fetchMock).toHaveBeenCalledWith('/api/hermes-kanban/boards', expect.anything());
    expect(fetchMock).toHaveBeenCalledWith('/api/hermes-kanban/tasks?board=default', expect.anything());

    const host = container as HTMLDivElement;
    expect(host.querySelector('[data-testid="hermes-kanban-workspace"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="kanban-lane-todo"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="kanban-lane-running"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="kanban-lane-blocked"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="hermes-kanban-task-card-t_one"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="hermes-kanban-task-card-t_two"]')).not.toBeNull();
    const count = host.querySelector('[data-testid="kanban-lane-count-todo"]');
    expect(count?.textContent).toBe('1');
    act(() => root.unmount());
  });

  it('renders a minimal header: board selector, search, gateway health, add task, inspector toggle — without branding', async () => {
    renderWorkspace();
    await flush();
    const host = container as HTMLDivElement;
    const header = host.querySelector('[data-testid="hermes-kanban-header"]');
    expect(header).not.toBeNull();
    expect(header?.textContent).not.toContain('Hermes');
    expect(host.querySelector('[data-testid="hermes-kanban-board-select"]')).not.toBeNull();
    const gw = host.querySelector('[data-testid="hermes-kanban-gateway-status"]');
    expect(gw).not.toBeNull();
    expect(gw?.getAttribute('aria-label')).toContain('Gateway');
    const add = host.querySelector('[data-testid="hermes-kanban-add-task"]') as HTMLButtonElement;
    expect(add).not.toBeNull();
    expect(add.getAttribute('aria-label')).toBe('Add task');
    const toggle = host.querySelector('[data-testid="hermes-kanban-inspector-toggle"]') as HTMLButtonElement;
    expect(toggle).not.toBeNull();
    expect(toggle.getAttribute('aria-label')).toContain('inspector');
  });
});

describe('HermesKanbanWorkspace — search, inspector, task selection', () => {
  it('filters task cards by the search box', async () => {
    const root = renderWorkspace();
    await flush();
    const host = container as HTMLDivElement;
    setInputValue(host, 'hermes-kanban-search', 'alpha');
    await flush();
    expect(host.querySelector('[data-testid="hermes-kanban-task-card-t_one"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="hermes-kanban-task-card-t_two"]')).toBeNull();
  });

  it('keeps the pull-out inspector closed by default and opens on the toggle', async () => {
    renderWorkspace();
    await flush();
    const host = container as HTMLDivElement;
    const inspector = host.querySelector('[data-testid="hermes-kanban-inspector"]') as HTMLElement;
    expect(inspector.getAttribute('data-open')).toBe('false');
    click(host, 'hermes-kanban-inspector-toggle');
    await flush();
    expect(
      host.querySelector('[data-testid="hermes-kanban-inspector"]')?.getAttribute('data-open'),
    ).toBe('true');
  });

  it('selecting a task opens the inspector in Task mode with real detail from the task endpoint', async () => {
    const root = renderWorkspace();
    await flush();
    const host = container as HTMLDivElement;
    click(host, 'hermes-kanban-task-card-t_one');
    await flush();

    expect(
      fetchMock.mock.calls.some(([input]) => String(input) === '/api/hermes-kanban/tasks/t_one'),
    ).toBe(true);
    expect(
      host.querySelector('[data-testid="hermes-kanban-inspector"]')?.getAttribute('data-open'),
    ).toBe('true');
    // Task mode tabs exist
    expect(host.querySelector('[data-testid="hermes-kanban-task-inspector-tab-task"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="hermes-kanban-task-inspector-tab-dependencies"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="hermes-kanban-task-inspector-tab-activity"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="hermes-kanban-task-inspector-tab-result"]')).not.toBeNull();
    // Real task detail from the show envelope
    expect(host.querySelector('[data-testid="hermes-kanban-task-title"]')?.textContent).toContain('Alpha task');
    expect(host.querySelector('[data-testid="hermes-kanban-task-body"]')?.textContent).toContain('body A');
    // Task-specific controls are present only in the task inspector
    expect(host.querySelector('[data-testid="hermes-kanban-task-comment"]')).not.toBeNull();
    // Board-only controls are NOT rendered in task mode
    expect(host.querySelector('[data-testid="hermes-kanban-inspector-tab-board"]')).toBeNull();
    act(() => root.unmount());
  });

  it('closing the inspector hides the drawer (board returns to full width)', async () => {
    renderWorkspace();
    await flush();
    const host = container as HTMLDivElement;
    click(host, 'hermes-kanban-inspector-toggle');
    await flush();
    expect(host.querySelector('[data-testid="hermes-kanban-inspector"]')?.getAttribute('data-open')).toBe('true');
    // header toggle again closes it
    click(host, 'hermes-kanban-inspector-toggle');
    await flush();
    expect(host.querySelector('[data-testid="hermes-kanban-inspector"]')?.getAttribute('data-open')).toBe('false');
  });
});

describe('HermesKanbanWorkspace — mutations through the bridge', () => {
  it('Add Task posts to /api/hermes-kanban/create', async () => {
    const root = renderWorkspace();
    await flush();
    const host = container as HTMLDivElement;
    click(host, 'hermes-kanban-add-task');
    await flush();
    setInputValue(host, 'hermes-kanban-new-task-title', 'A tiny harmless task');
    click(host, 'hermes-kanban-new-task-submit');
    await flush();

    const createCall = calls.find((c) => c.url === '/api/hermes-kanban/create');
    expect(createCall).toBeTruthy();
    expect(createCall?.init?.method).toBe('POST');
    const body = JSON.parse(String(createCall?.init?.body || '{}'));
    expect(body.board).toBe('default');
    expect(body.title).toBe('A tiny harmless task');
  });

  it('Refresh re-requests the board data', async () => {
    const root = renderWorkspace();
    await flush();
    const host = container as HTMLDivElement;
    click(host, 'hermes-kanban-inspector-toggle');
    await flush();
    const before = calls.filter((c) => c.url === '/api/hermes-kanban/boards').length;
    click(host, 'hermes-kanban-refresh');
    await flush();
    const after = calls.filter((c) => c.url === '/api/hermes-kanban/boards').length;
    expect(after).toBeGreaterThan(before);
  });

  it('Nudge calls the native dispatch bridge route', async () => {
    const root = renderWorkspace();
    await flush();
    const host = container as HTMLDivElement;
    click(host, 'hermes-kanban-inspector-toggle');
    await flush();
    click(host, 'hermes-kanban-nudge');
    await flush();
    const dispatchCall = calls.find((c) => c.url === '/api/hermes-kanban/dispatch');
    expect(dispatchCall).toBeTruthy();
    expect(dispatchCall?.init?.method).toBe('POST');
  });

  it('wires task mutations: comment, block/unblock, promote', async () => {
    const root = renderWorkspace();
    await flush();
    const host = container as HTMLDivElement;
    click(host, 'hermes-kanban-task-card-t_one');
    await flush();

    expect(host.querySelector('[data-testid="hermes-kanban-task-comment"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="hermes-kanban-task-block"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="hermes-kanban-task-promote"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="hermes-kanban-task-complete"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="hermes-kanban-task-archive"]')).not.toBeNull();

    const input = host.querySelector('[data-testid="hermes-kanban-task-comment-input"]') as HTMLInputElement;
    expect(input).not.toBeNull();
    setInputValue(host, 'hermes-kanban-task-comment-input', 'a comment');
    click(host, 'hermes-kanban-task-comment');
    await flush();
    const commentCall = calls.find((c) => c.url === '/api/hermes-kanban/tasks/t_one/comment');
    expect(commentCall).toBeTruthy();
    expect(JSON.parse(String(commentCall?.init?.body || '{}')).text).toBe('a comment');
  });

  it('board-mode tabs (Board/Orchestration/Profiles/System) exist without a task selected', async () => {
    const root = renderWorkspace();
    await flush();
    const host = container as HTMLDivElement;
    click(host, 'hermes-kanban-inspector-toggle');
    await flush();
    expect(host.querySelector('[data-testid="hermes-kanban-inspector-tab-board"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="hermes-kanban-inspector-tab-orchestration"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="hermes-kanban-inspector-tab-profiles"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="hermes-kanban-inspector-tab-system"]')).not.toBeNull();
    // No kanban lanes are rendered inside the inspector
    const inspector = host.querySelector('[data-testid="hermes-kanban-inspector"]');
    expect(inspector?.querySelector('[data-testid="kanban-lane-todo"]')).toBeNull();
  });
});
