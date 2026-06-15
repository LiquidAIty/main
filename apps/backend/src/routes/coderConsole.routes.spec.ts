import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { describe, expect, it, vi } from 'vitest';

const consoleMocks = vi.hoisted(() => {
  const runningInfo = {
    id: 'occ_1',
    targetRoot: 'C:/Projects/main',
    mode: 'interactive',
    state: 'running',
    commandPath: 'node localcoder/bin/openclaude',
    runtimeSource: 'vendored_built',
    transportMode: 'pty',
    provider: null,
    model: 'gpt-5.3-codex',
    interactiveSupported: true,
    pid: 4321,
    startedAt: '2026-06-13T00:00:00.000Z',
    exitedAt: null,
    exitCode: null,
    exitSignal: null,
    warnings: [],
    error: null,
  };
  const session = {
    info: runningInfo,
    transcript: () => [{ seq: 1, stream: 'stdout', data: 'help output', at: '2026-06-13T00:00:00.000Z' }],
    write: vi.fn(() => true),
    resize: vi.fn(() => true),
    stop: vi.fn(() => true),
    subscribe: vi.fn(() => () => undefined),
  };
  const manager = {
    start: vi.fn(() => ({ ok: true as const, session })),
    get: vi.fn((id: string) => (id === 'occ_1' ? session : undefined)),
    list: vi.fn(() => [runningInfo]),
  };
  return { runningInfo, session, manager };
});

vi.mock('../coder/openclaude/console/consoleSession', () => ({
  openClaudeConsoleSessionManager: consoleMocks.manager,
}));

const routerMocks = vi.hoisted(() => ({
  routeCodingTaskToConsole: vi.fn(async (input: {
    localCoderBusConnected: boolean;
    codeGraphBusConnected: boolean;
  }) => ({
    routed: input.localCoderBusConnected && input.codeGraphBusConnected,
    blocked: input.localCoderBusConnected
      ? input.codeGraphBusConnected
        ? null
        : 'MAGONE_CODER_CONSOLE_BLOCKED_PARTICIPANT_GATE: codegraph_not_bus_connected'
      : 'MAGONE_CODER_CONSOLE_BLOCKED_PARTICIPANT_GATE: local_coder_not_bus_connected',
    targetRoot: 'C:/Projects/main',
    cbmScopeGate: null,
    reusedSession: false,
    session: input.localCoderBusConnected && input.codeGraphBusConnected ? { id: 'occ_task' } : null,
    inputDelivered: input.localCoderBusConnected && input.codeGraphBusConnected,
  })),
}));

vi.mock('../coder/openclaude/console/consoleTaskRouter', () => ({
  routeCodingTaskToConsole: routerMocks.routeCodingTaskToConsole,
}));

vi.mock('../services/coderPlanning/coderPlanningService', () => ({
  persistCoderRunOutcome: vi.fn(),
  prepareActiveCoderPacket: vi.fn(),
}));

async function createApiServer(): Promise<{ server: Server; baseUrl: string }> {
  const express = (await import('express')).default;
  const router = (await import('./coder.routes')).default;
  const app = express();
  app.use(express.json());
  app.use('/api/coder', router);
  const server = await new Promise<Server>((resolve) => {
    const next = app.listen(0, '127.0.0.1', () => resolve(next));
  });
  const address = server.address() as AddressInfo;
  return { server, baseUrl: `http://127.0.0.1:${address.port}/api/coder` };
}

const close = (server: Server) =>
  new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));

describe('OpenClaude console bridge routes', () => {
  it('creates a console session object and returns its running info', async () => {
    const { server, baseUrl } = await createApiServer();
    try {
      const response = await fetch(`${baseUrl}/openclaude/console/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetRoot: 'C:/Projects/main', mode: 'interactive' }),
      });
      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload.ok).toBe(true);
      expect(payload.session.targetRoot).toBe('C:/Projects/main');
      expect(payload.session.commandPath).toContain('openclaude');
    } finally {
      await close(server);
    }
  });

  it('returns 424 with missing reasons when the runtime cannot start', async () => {
    consoleMocks.manager.start.mockReturnValueOnce({
      ok: false,
      error: 'console_runtime_unavailable',
      missing: ['localcoder_entrypoint_missing'],
    } as any);
    const { server, baseUrl } = await createApiServer();
    try {
      const response = await fetch(`${baseUrl}/openclaude/console/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'interactive' }),
      });
      expect(response.status).toBe(424);
      const payload = await response.json();
      expect(payload.ok).toBe(false);
      expect(payload.missing).toContain('localcoder_entrypoint_missing');
    } finally {
      await close(server);
    }
  });

  it('returns a bounded transcript for a known session', async () => {
    const { server, baseUrl } = await createApiServer();
    try {
      const response = await fetch(`${baseUrl}/openclaude/console/sessions/occ_1`);
      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload.session.id).toBe('occ_1');
      expect(payload.transcript[0].data).toBe('help output');
    } finally {
      await close(server);
    }
  });

  it('404s an unknown session', async () => {
    const { server, baseUrl } = await createApiServer();
    try {
      const response = await fetch(`${baseUrl}/openclaude/console/sessions/missing`);
      expect(response.status).toBe(404);
    } finally {
      await close(server);
    }
  });

  it('forwards input to the session stdin', async () => {
    const { server, baseUrl } = await createApiServer();
    try {
      const response = await fetch(`${baseUrl}/openclaude/console/sessions/occ_1/input`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: '/help\n' }),
      });
      expect(response.status).toBe(200);
      expect((await response.json()).delivered).toBe(true);
      expect(consoleMocks.session.write).toHaveBeenCalledWith('/help\n');
    } finally {
      await close(server);
    }
  });

  it('resizes a PTY-backed session', async () => {
    const { server, baseUrl } = await createApiServer();
    try {
      const response = await fetch(`${baseUrl}/openclaude/console/sessions/occ_1/resize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cols: 100, rows: 40 }),
      });
      expect(response.status).toBe(200);
      expect((await response.json()).resized).toBe(true);
      expect(consoleMocks.session.resize).toHaveBeenCalledWith(100, 40);
    } finally {
      await close(server);
    }
  });

  it('rejects an invalid resize', async () => {
    const { server, baseUrl } = await createApiServer();
    try {
      const response = await fetch(`${baseUrl}/openclaude/console/sessions/occ_1/resize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cols: 0, rows: -5 }),
      });
      expect(response.status).toBe(400);
    } finally {
      await close(server);
    }
  });

  it('stops a session', async () => {
    const { server, baseUrl } = await createApiServer();
    try {
      const response = await fetch(`${baseUrl}/openclaude/console/sessions/occ_1/stop`, {
        method: 'POST',
      });
      expect(response.status).toBe(200);
      expect((await response.json()).stopped).toBe(true);
      expect(consoleMocks.session.stop).toHaveBeenCalled();
    } finally {
      await close(server);
    }
  });

  it('routes a coding task to a bus-connected Local Coder', async () => {
    const { server, baseUrl } = await createApiServer();
    try {
      const response = await fetch(`${baseUrl}/openclaude/console/task`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: 'project-1',
          repoPath: 'C:/Projects/main',
          task: 'fix the failing code test',
          userGoal: 'fix the failing code test',
          generatedSpec: 'Compact SPEC for the fix.',
          explicitApproval: true,
          cards: [
            { id: 'mag', kind: 'agent', runtimeType: 'magentic_one' },
            { id: 'lc', kind: 'agent', runtimeType: 'local_coder', title: 'Local Coder' },
            { id: 'cg', kind: 'agent', runtimeType: 'assistant_agent', title: 'CodeGraph Agent' },
          ],
          edges: [
            { id: 'e1', source: 'mag', target: 'lc', edgeType: 'magentic_option' },
            { id: 'e2', source: 'mag', target: 'cg', edgeType: 'magentic_option' },
          ],
        }),
      });
      expect(response.status).toBe(200);
      const payload = await response.json();
      expect(payload.ok).toBe(true);
      expect(payload.routed).toBe(true);
      expect(routerMocks.routeCodingTaskToConsole).toHaveBeenCalledWith(
        expect.objectContaining({ localCoderBusConnected: true, codeGraphBusConnected: true }),
      );
    } finally {
      await close(server);
    }
  });

  it('blocks routing when Local Coder is disconnected from the bus', async () => {
    const { server, baseUrl } = await createApiServer();
    try {
      const response = await fetch(`${baseUrl}/openclaude/console/task`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: 'project-1',
          repoPath: 'C:/Projects/main',
          task: 'fix the failing code test',
          userGoal: 'fix the failing code test',
          generatedSpec: 'Compact SPEC for the fix.',
          explicitApproval: true,
          cards: [
            { id: 'mag', kind: 'agent', runtimeType: 'magentic_one' },
            { id: 'lc', kind: 'agent', runtimeType: 'local_coder', title: 'Local Coder' },
          ],
          edges: [],
        }),
      });
      expect(response.status).toBe(424);
      const payload = await response.json();
      expect(payload.ok).toBe(false);
      expect(payload.blocked).toContain('local_coder_not_bus_connected');
    } finally {
      await close(server);
    }
  });

  it('blocks routing when CodeGraph is disconnected from the bus', async () => {
    const { server, baseUrl } = await createApiServer();
    try {
      const response = await fetch(`${baseUrl}/openclaude/console/task`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: 'project-1',
          repoPath: 'C:/Projects/main',
          task: 'fix the failing code test',
          userGoal: 'fix the failing code test',
          generatedSpec: 'Compact SPEC for the fix.',
          explicitApproval: true,
          cards: [
            { id: 'mag', kind: 'agent', runtimeType: 'magentic_one' },
            { id: 'lc', kind: 'agent', runtimeType: 'local_coder', title: 'Local Coder' },
            { id: 'cg', kind: 'agent', runtimeType: 'assistant_agent', title: 'CodeGraph Agent' },
          ],
          edges: [{ id: 'e1', source: 'mag', target: 'lc', edgeType: 'magentic_option' }],
        }),
      });
      expect(response.status).toBe(424);
      expect((await response.json()).blocked).toContain('codegraph_not_bus_connected');
    } finally {
      await close(server);
    }
  });

  it('rejects a task with no Magentic card on the canvas', async () => {
    const { server, baseUrl } = await createApiServer();
    try {
      const response = await fetch(`${baseUrl}/openclaude/console/task`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: 'project-1',
          repoPath: 'C:/Projects/main',
          task: 'fix code',
          userGoal: 'fix code',
          generatedSpec: 'Compact SPEC.',
          explicitApproval: true,
          cards: [],
          edges: [],
        }),
      });
      expect(response.status).toBe(400);
      expect((await response.json()).error).toBe('console_task_magentic_card_missing');
    } finally {
      await close(server);
    }
  });

  it('blocks request with magone_workflow_option_missing if workflowOption is absent', async () => {
    const { server, baseUrl } = await createApiServer();
    try {
      routerMocks.routeCodingTaskToConsole.mockClear();
      const response = await fetch(`${baseUrl}/openclaude/console/task`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: 'project-1',
          repoPath: 'C:/Projects/main',
          task: 'refactor the auth module',
          userGoal: 'refactor the auth module',
          generatedSpec: 'Refactor SPEC.',
          explicitApproval: false,
          cards: [],
          edges: [],
        }),
      });
      const payload = await response.json();
      expect(response.status).toBe(400);
      expect(payload.error).toBe('magone_workflow_option_missing');
      expect(routerMocks.routeCodingTaskToConsole).not.toHaveBeenCalled();
    } finally {
      await close(server);
    }
  });

  it('does not dispatch coder for non-dispatch options like plan_only', async () => {
    const { server, baseUrl } = await createApiServer();
    try {
      routerMocks.routeCodingTaskToConsole.mockClear();
      const response = await fetch(`${baseUrl}/openclaude/console/task`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: 'project-1',
          repoPath: 'C:/Projects/main',
          task: 'just plan something',
          workflowOption: 'plan_only',
        }),
      });
      const payload = await response.json();
      expect(response.status).toBe(200);
      expect(payload.ok).toBe(true);
      expect(payload.dispatched).toBe(false);
      expect(payload.workflowOption).toBe('plan_only');
      expect(routerMocks.routeCodingTaskToConsole).not.toHaveBeenCalled();
    } finally {
      await close(server);
    }
  });

  it('dispatches run_read_only_coder_task when structural gates pass', async () => {
    const { server, baseUrl } = await createApiServer();
    try {
      routerMocks.routeCodingTaskToConsole.mockClear();
      const response = await fetch(`${baseUrl}/openclaude/console/task`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: 'project-1',
          repoPath: 'C:/Projects/main',
          task: 'can you do a quick audit of code',
          workflowOption: 'run_read_only_coder_task',
          editMode: 'read_only',
          explicitApproval: false,
          cards: [
            { id: 'mag', kind: 'agent', runtimeType: 'magentic_one' },
            { id: 'lc', kind: 'agent', runtimeType: 'local_coder', title: 'Local Coder' },
            { id: 'cg', kind: 'agent', runtimeType: 'assistant_agent', runtimeBinding: 'codegraph_agent', title: 'CodeGraph Agent' },
          ],
          edges: [
            { id: 'e1', source: 'mag', target: 'lc', edgeType: 'magentic_option' },
            { id: 'e2', source: 'mag', target: 'cg', edgeType: 'magentic_option' },
          ],
        }),
      });
      const payload = await response.json();
      expect(response.status).toBe(200);
      expect(payload.ok).toBe(true);
      expect(payload.autoDispatchedReadOnly).toBe(true);
      expect(routerMocks.routeCodingTaskToConsole).toHaveBeenCalled();
    } finally {
      await close(server);
    }
  });
});
