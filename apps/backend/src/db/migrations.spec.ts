import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { applyBackendMigrations, listenAfterRequiredMigrations } from './migrations';

function migrationPath(filename: string): string {
  return resolve(__dirname, '../../migrations', filename);
}

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
      expect.objectContaining({ filename: '030_card_script_run_receipt.sql', applied: true }),
      expect.objectContaining({ filename: '031_graph_agent_continuity.sql', applied: true }),
      expect.objectContaining({ filename: '032_paper_trade_jobs.sql', applied: true }),
      expect.objectContaining({ filename: '033_trading_lifecycle_runs.sql', applied: true }),
      expect.objectContaining({ filename: '034_hermes_native_session_authority.sql', applied: true }),
      expect.objectContaining({ filename: '035_remove_provider_api_mode_constraint.sql', applied: true }),
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

  it('migrates Graph Agent through a new current revision without rewriting history', async () => {
    const source = await readFile(
      migrationPath('031_graph_agent_continuity.sql'),
      'utf8',
    );

    expect(source).toContain("card.card_id = 'card_hermes_steward'");
    expect(source).toContain("revision.title <> 'Graph Agent'");
    expect(source).toContain("revision.runtime_mode <> 'delegate'");
    expect(source).toContain('INSERT INTO ag_catalog.agent_card_revisions');
    expect(source).toContain('INSERT INTO ag_catalog.card_capability_grants');
    expect(source).toContain('SET current_revision_id = next_revision_id');
    expect(source).not.toMatch(/\bLOAD\s+'age'/i);
    expect(source).not.toContain('UPDATE ag_catalog.agent_card_revisions');
    expect(source).not.toMatch(/\bDELETE\s+FROM\b/i);
  });

  it('keeps the paper Trade Job schema structurally unable to request orders', async () => {
    const source = await readFile(
      migrationPath('032_paper_trade_jobs.sql'),
      'utf8',
    );

    expect(source).toContain("execution_state = 'blocked_pending_separate_approval'");
    expect(source).toContain('execution_requested BOOLEAN NOT NULL DEFAULT FALSE');
    expect(source).toContain('CHECK (execution_requested = FALSE)');
    expect(source).not.toContain('REFERENCES ag_catalog.agent_card_revisions');
    expect(source).not.toContain('REFERENCES ag_catalog.agent_cards');
    expect(source).not.toMatch(/CREATE TABLE(?: IF NOT EXISTS)?\s+\S*orders\b/i);
  });

  it('keeps bounded lifecycle proof structurally local, paper-only, and provider-free', async () => {
    const source = await readFile(
      migrationPath('033_trading_lifecycle_runs.sql'),
      'utf8',
    );

    expect(source).toContain("mode TEXT NOT NULL CHECK (mode = 'local_backtest')");
    expect(source).toContain('paper_only BOOLEAN NOT NULL DEFAULT TRUE CHECK (paper_only = TRUE)');
    expect(source).toContain('live_orders BOOLEAN NOT NULL DEFAULT FALSE CHECK (live_orders = FALSE)');
    expect(source).toContain('model_provider_calls BOOLEAN NOT NULL DEFAULT FALSE');
    expect(source).not.toContain('REFERENCES ag_catalog.agent_card_revisions');
    expect(source).not.toContain('REFERENCES ag_catalog.agent_cards');
    expect(source).not.toMatch(/CREATE TABLE(?: IF NOT EXISTS)?\s+\S*orders\b/i);
  });

  it('preserves the exact applied Hermes native-session authority migration', async () => {
    const source = await readFile(
      migrationPath('034_hermes_native_session_authority.sql'),
      'utf8',
    );

    expect(createHash('sha256').update(source, 'utf8').digest('hex')).toBe(
      'df92116d36942d1afdaee8dcdac96924fcb131b8ba342f71eb7cee420f7bd680',
    );
    expect(source).toContain('ADD COLUMN IF NOT EXISTS hermes_session_ref TEXT');
    expect(source).toContain('ADD COLUMN IF NOT EXISTS effective_provider TEXT');
    expect(source).toContain('ADD COLUMN IF NOT EXISTS provider_api_mode TEXT');
    expect(source).toContain('Identifier shape cannot prove');
    expect(source).not.toMatch(/\bUPDATE\s+ag_catalog\.agent_runs\b/i);
    expect(source).toContain('ADD CONSTRAINT agent_runs_provider_api_mode_check');
    expect(source).toContain("provider_api_mode = 'codex_app_server'");
    expect(source).not.toContain('SET hermes_session_ref = provider_thread_ref');
    expect(source).not.toContain('provider_turn_ref = NULL');
    expect(source).not.toMatch(/\bDELETE\s+FROM\b/i);
  });

  it('removes the obsolete provider API mode constraint in the next migration', async () => {
    const source = await readFile(
      migrationPath('035_remove_provider_api_mode_constraint.sql'),
      'utf8',
    );

    expect(source).toContain('DROP CONSTRAINT IF EXISTS agent_runs_provider_api_mode_check');
    expect(source).not.toMatch(/\bUPDATE\s+ag_catalog\.agent_runs\b/i);
    expect(source).not.toMatch(/\bDELETE\s+FROM\b/i);
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
