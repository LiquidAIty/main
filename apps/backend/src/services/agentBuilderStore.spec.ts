import { beforeEach, describe, expect, it, vi } from 'vitest';

const poolHarness = vi.hoisted(() => ({
  query: vi.fn(),
  connect: vi.fn(),
  end: vi.fn(),
}));

vi.mock('../db/pool', () => ({
  pool: poolHarness,
}));

type AgentBuilderStoreModule = typeof import('./agentBuilderStore.js');

describe('listAgentCards', () => {
  let listAgentCards: AgentBuilderStoreModule['listAgentCards'];

  beforeEach(async () => {
    vi.resetModules();
    poolHarness.query.mockReset();
    poolHarness.connect.mockReset();
    poolHarness.end.mockReset();
    ({ listAgentCards } = await import('./agentBuilderStore.js'));
  });

  it('returns a stable list when optional project columns are missing', async () => {
    poolHarness.query
      .mockResolvedValueOnce({
        rows: [
          { column_name: 'id', is_nullable: 'NO' },
          { column_name: 'name', is_nullable: 'NO' },
          { column_name: 'updated_at', is_nullable: 'YES' },
          { column_name: 'project_type', is_nullable: 'YES' },
          { column_name: 'agent_model', is_nullable: 'YES' },
          { column_name: 'agent_prompt_template', is_nullable: 'YES' },
          { column_name: 'agent_tools', is_nullable: 'YES' },
          { column_name: 'agent_io_schema', is_nullable: 'YES' },
          { column_name: 'agent_temperature', is_nullable: 'YES' },
          { column_name: 'agent_max_tokens', is_nullable: 'YES' },
          { column_name: 'agent_permissions', is_nullable: 'YES' },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'project-1',
            name: 'Project One',
            code: null,
            status: null,
            project_type: 'assist',
            agent_model: null,
            agent_prompt_template: null,
            agent_tools: [],
            agent_io_schema: {},
            agent_temperature: null,
            agent_max_tokens: null,
            agent_permissions: {},
          },
        ],
      });

    await expect(listAgentCards()).resolves.toEqual([
      {
        id: 'project-1',
        name: 'Project One',
        code: null,
        status: null,
        hasAgentConfig: false,
        project_type: 'assist',
      },
    ]);

    expect(String(poolHarness.query.mock.calls[1]?.[0] || '')).toContain('NULL as code');
    expect(String(poolHarness.query.mock.calls[1]?.[0] || '')).toContain('NULL as status');
  });

  it('returns an empty list after a stale column failure persists through one schema refresh', async () => {
    poolHarness.query
      .mockResolvedValueOnce({
        rows: [
          { column_name: 'id', is_nullable: 'NO' },
          { column_name: 'name', is_nullable: 'NO' },
          { column_name: 'code', is_nullable: 'YES' },
          { column_name: 'status', is_nullable: 'YES' },
          { column_name: 'updated_at', is_nullable: 'YES' },
        ],
      })
      .mockRejectedValueOnce({
        code: '42703',
        message: 'column "status" does not exist',
      })
      .mockResolvedValueOnce({
        rows: [
          { column_name: 'id', is_nullable: 'NO' },
          { column_name: 'name', is_nullable: 'NO' },
          { column_name: 'updated_at', is_nullable: 'YES' },
        ],
      })
      .mockRejectedValueOnce({
        code: '42703',
        message: 'column "id" does not exist',
      });

    await expect(listAgentCards()).resolves.toEqual([]);
    expect(poolHarness.query).toHaveBeenCalledTimes(4);
  });
});
