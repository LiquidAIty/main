import { describe, expect, it, vi } from 'vitest';
import { applyBackendMigrations, listenAfterRequiredMigrations } from './migrations';

const migration = `
-- Existing numbered migrations may document their purpose before the
-- transaction envelope.
BEGIN;
ALTER TABLE ag_catalog.agent_runs ADD COLUMN IF NOT EXISTS native_phase TEXT;
COMMIT;
`;

function fakeClient(existingChecksum?: string) {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes('SELECT checksum_sha256')) {
      return { rows: existingChecksum ? [{ checksum_sha256: existingChecksum }] : [] };
    }
    return { rows: [] };
  });
  return { query, release: vi.fn() };
}

describe('canonical backend migrations', () => {
  it('applies every required migration transactionally and records its checksum once', async () => {
    const client = fakeClient();
    const result = await applyBackendMigrations({
      client: client as any,
      readMigration: async () => migration,
    });

    expect(result).toEqual([
      expect.objectContaining({ filename: '025_async_kanban_card_runs.sql', applied: true }),
      expect.objectContaining({ filename: '026_explicit_card_deletion.sql', applied: true }),
      expect.objectContaining({ filename: '027_verify_explicit_card_deletion_grants.sql', applied: true }),
      expect.objectContaining({ filename: '028_agentgraph_materialized_read.sql', applied: true }),
      expect.objectContaining({ filename: '029_child_model_receipt.sql', applied: true }),
    ]);
    const statements = client.query.mock.calls.map(([sql]) => String(sql).trim());
    expect(statements).toEqual(expect.arrayContaining([
      'BEGIN',
      expect.stringContaining('ALTER TABLE ag_catalog.agent_runs'),
      expect.stringContaining('INSERT INTO ag_catalog.backend_schema_migrations'),
      'COMMIT',
    ]));
    expect(statements).not.toContain(migration.trim());
  });

  it('does not open backend readiness when migration application fails', async () => {
    const listen = vi.fn(async () => 'listening');
    const migrate = vi.fn(async () => {
      throw new Error('backend_migration_failed:025_async_kanban_card_runs.sql:boom');
    });

    await expect(listenAfterRequiredMigrations(listen, migrate)).rejects.toThrow(
      'backend_migration_failed:025_async_kanban_card_runs.sql:boom',
    );
    expect(listen).not.toHaveBeenCalled();
  });

  it('waits through PostgreSQL crash recovery before opening backend readiness', async () => {
    const listen = vi.fn(async () => 'listening');
    const recoveryError = Object.assign(new Error('the database system is in recovery mode'), {
      code: '57P03',
    });
    const migrate = vi.fn()
      .mockRejectedValueOnce(recoveryError)
      .mockRejectedValueOnce(recoveryError)
      .mockResolvedValue(undefined);
    const wait = vi.fn(async () => undefined);

    await expect(listenAfterRequiredMigrations(listen, migrate, wait)).resolves.toBe('listening');
    expect(migrate).toHaveBeenCalledTimes(3);
    expect(wait).toHaveBeenNthCalledWith(1, 5_000);
    expect(wait).toHaveBeenNthCalledWith(2, 5_000);
    expect(listen).toHaveBeenCalledTimes(1);
  });

  it('treats an already recorded migration with the same checksum as idempotent', async () => {
    const first = await applyBackendMigrations({
      client: fakeClient() as any,
      readMigration: async () => migration,
    });
    const client = fakeClient(first[0].checksum);
    const second = await applyBackendMigrations({
      client: client as any,
      readMigration: async () => migration,
    });

    expect(second).toEqual(first.map((entry) => ({ ...entry, applied: false })));
    const statements = client.query.mock.calls.map(([sql]) => String(sql).trim());
    expect(statements).not.toContain('BEGIN');
    expect(statements.some((sql) => sql.includes('ALTER TABLE ag_catalog.agent_runs'))).toBe(false);
  });
});
