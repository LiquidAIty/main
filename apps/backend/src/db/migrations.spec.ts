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
  it('applies migration 025 transactionally and records its checksum once', async () => {
    const client = fakeClient();
    const result = await applyBackendMigrations({
      client: client as any,
      readMigration: async (filename) => {
        expect(filename).toBe('025_async_kanban_card_runs.sql');
        return migration;
      },
    });

    expect(result).toEqual([
      expect.objectContaining({ filename: '025_async_kanban_card_runs.sql', applied: true }),
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

    expect(second).toEqual([{ ...first[0], applied: false }]);
    const statements = client.query.mock.calls.map(([sql]) => String(sql).trim());
    expect(statements).not.toContain('BEGIN');
    expect(statements.some((sql) => sql.includes('ALTER TABLE ag_catalog.agent_runs'))).toBe(false);
  });
});
