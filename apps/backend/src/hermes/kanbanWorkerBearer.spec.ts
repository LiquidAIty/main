import { describe, expect, it, vi } from 'vitest';

import {
  verifyInternalMcpBearerForTest,
  type InternalMcpPrincipal,
} from '../services/mcp/internalMcpAuth';
import {
  HermesKanbanWorkerNotCorrelatedError,
  issueHermesKanbanWorkerBearer,
} from './kanbanWorkerBearer';
import type { HermesKanbanTaskSnapshot } from '../routes/hermesKanban.routes';

const identity = {
  taskId: 't_worker',
  nativeRunId: '7',
  board: 'default',
  assignee: 'liquidaity-hermes-steward',
  profile: 'liquidaity-hermes-steward',
  workspace: 'C:\\Projects\\LiquidAIty\\main',
  claimLock: 'worker:claim-7',
};

function snapshots(): Record<string, HermesKanbanTaskSnapshot> {
  return {
    t_worker: {
      task: {
        id: 't_worker', status: 'running', assignee: identity.assignee,
        current_run_id: 7, claim_lock: identity.claimLock,
      },
      parents: [], children: ['t_root'], events: [],
      runs: [{
        id: 7, profile: identity.profile, claim_lock: identity.claimLock,
        ended_at: null,
      }],
    },
    t_root: {
      task: {
        id: 't_root', status: 'running', created_by: 'card_hermes_steward',
        project_id: 'project-one',
      },
      parents: ['t_worker'], children: [], events: [], runs: [],
    },
  };
}

function resolvedContext(runId = 'card-run-one') {
  return {
    ok: true,
    context: {
      projectId: 'project-one', deckId: 'deck_builder', conversationId: 'conversation-one',
      runId, rootRunId: runId, cardId: 'card_hermes_steward',
      cardRevisionId: 'revision-one', runtimeMode: 'kanban',
      runtimeProfile: identity.profile, nativeRootId: 't_root',
      grantedTools: ['graphiti.add_memory', 'cbm.search_graph'],
    },
  };
}

describe('native Kanban worker Card bearer', () => {
  it('mints from the existing root-to-Card Run correlation and exact grants', async () => {
    const graph = snapshots();
    const mint = vi.fn((_principal: InternalMcpPrincipal) => 'b'.repeat(96));
    const result = await issueHermesKanbanWorkerBearer({
      identity,
      show: async (taskId) => graph[taskId],
      resolveRun: vi.fn(async () => resolvedContext()),
      mint,
    });

    expect(result.bearer).toBe('b'.repeat(96));
    expect(result.context.runId).toBe('card-run-one');
    expect(mint).toHaveBeenCalledOnce();
    const principal = mint.mock.calls[0][0];
    expect(principal).toEqual({
      kind: 'card-runtime',
      projectId: 'project-one',
      deckId: 'deck_builder',
      conversationId: 'conversation-one',
      parentRunId: 'card-run-one',
      callerCardId: 'card_hermes_steward',
      callerRuntimeKind: 'hermes',
      callerRuntimeMode: 'kanban',
      grantedTools: ['cbm.search_graph', 'graphiti.add_memory'],
      requiresExecutionContext: false,
    });
    expect(principal).not.toHaveProperty('taskId');
    expect(principal).not.toHaveProperty('nativeRunId');
  });

  it('fails closed when the native claim does not match the running attempt', async () => {
    const graph = snapshots();
    graph.t_worker.task.claim_lock = 'worker:different';
    await expect(issueHermesKanbanWorkerBearer({
      identity,
      show: async (taskId) => graph[taskId],
      resolveRun: vi.fn(async () => resolvedContext()),
      mint: vi.fn(() => 'never'),
    })).rejects.toThrow('hermes_kanban_worker_native_claim_mismatch');
  });

  it('distinguishes absent correlation without minting', async () => {
    const graph = snapshots();
    const mint = vi.fn(() => 'never');
    await expect(issueHermesKanbanWorkerBearer({
      identity,
      show: async (taskId) => graph[taskId],
      resolveRun: vi.fn(async () => {
        throw new Error('hermes_kanban_card_run_not_found');
      }),
      mint,
    })).rejects.toBeInstanceOf(HermesKanbanWorkerNotCorrelatedError);
    expect(mint).not.toHaveBeenCalled();
  });

  it('keeps concurrent Card Runs isolated and retains the existing token expiry', async () => {
    const env = {
      LIQUIDAITY_INTERNAL_MCP_SECRET: '0123456789abcdef0123456789abcdef',
    };
    const firstGraph = snapshots();
    const secondGraph = snapshots();
    const [first, second] = await Promise.all([
      issueHermesKanbanWorkerBearer({
        identity,
        show: async (taskId) => firstGraph[taskId],
        resolveRun: vi.fn(async () => resolvedContext('card-run-one')),
        env,
      }),
      issueHermesKanbanWorkerBearer({
        identity,
        show: async (taskId) => secondGraph[taskId],
        resolveRun: vi.fn(async () => resolvedContext('card-run-two')),
        env,
      }),
    ]);

    expect(first.bearer).not.toBe(second.bearer);
    const firstClaims = verifyInternalMcpBearerForTest(first.bearer, env);
    const secondClaims = verifyInternalMcpBearerForTest(second.bearer, env);
    expect((firstClaims.principal as Record<string, unknown>).parentRunId).toBe('card-run-one');
    expect((secondClaims.principal as Record<string, unknown>).parentRunId).toBe('card-run-two');
    expect(Number(firstClaims.exp) - Number(firstClaims.iat)).toBe(12 * 60 * 60);
  });
});
