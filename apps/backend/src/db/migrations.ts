import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { PoolClient } from 'pg';
import { pool } from './pool';

const REQUIRED_MIGRATIONS = [
  '025_async_kanban_card_runs.sql',
  '026_explicit_card_deletion.sql',
  '027_verify_explicit_card_deletion_grants.sql',
  '028_agentgraph_materialized_read.sql',
  '029_child_model_receipt.sql',
  '030_card_script_run_receipt.sql',
  '031_graph_agent_continuity.sql',
  '032_paper_trade_jobs.sql',
  '033_trading_lifecycle_runs.sql',
] as const;
const MIGRATION_LOCK = 'liquidaity-backend-migrations';
const POSTGRES_RECOVERY_RETRY_DELAY_MS = 5_000;
const POSTGRES_RECOVERY_RETRY_LIMIT = 18;

type MigrationClient = Pick<PoolClient, 'query' | 'release'>;

export type AppliedBackendMigration = {
  filename: string;
  checksum: string;
  applied: boolean;
};

export type BackendMigrationOptions = {
  client?: MigrationClient;
  migrationsDirectory?: string;
  readMigration?: (filename: string) => Promise<string>;
};

function migrationDirectory(): string {
  return path.resolve(process.cwd(), 'migrations');
}

function migrationBody(filename: string, source: string): string {
  const trimmed = source.trim();
  const leadingEnvelope = /^\s*(?:(?:--[^\r\n]*)(?:\r?\n|$)\s*)*BEGIN;\s*/i;
  if (!leadingEnvelope.test(trimmed) || !/\s*COMMIT;$/i.test(trimmed)) {
    throw new Error(`backend_migration_transaction_envelope_invalid:${filename}`);
  }
  return trimmed.replace(leadingEnvelope, '').replace(/\s*COMMIT;$/i, '');
}

function migrationChecksum(source: string): string {
  return createHash('sha256').update(source, 'utf8').digest('hex');
}

export async function applyBackendMigrations(
  options: BackendMigrationOptions = {},
): Promise<AppliedBackendMigration[]> {
  const ownedClient = options.client ? null : await pool.connect();
  const client = options.client ?? ownedClient!;
  const directory = options.migrationsDirectory ?? migrationDirectory();
  const readMigration = options.readMigration
    ?? ((filename: string) => readFile(path.join(directory, filename), 'utf8'));
  const applied: AppliedBackendMigration[] = [];
  let locked = false;

  try {
    await client.query('SELECT pg_advisory_lock(hashtext($1))', [MIGRATION_LOCK]);
    locked = true;
    await client.query(`
      CREATE TABLE IF NOT EXISTS ag_catalog.backend_schema_migrations (
        filename TEXT PRIMARY KEY,
        checksum_sha256 TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    for (const filename of REQUIRED_MIGRATIONS) {
      const source = await readMigration(filename);
      const checksum = migrationChecksum(source);
      const existing = await client.query(
        'SELECT checksum_sha256 FROM ag_catalog.backend_schema_migrations WHERE filename=$1',
        [filename],
      );
      if (existing.rows.length > 0) {
        if (String(existing.rows[0]?.checksum_sha256 || '') !== checksum) {
          throw new Error(`backend_migration_checksum_mismatch:${filename}`);
        }
        applied.push({ filename, checksum, applied: false });
        continue;
      }

      await client.query('BEGIN');
      try {
        await client.query(migrationBody(filename, source));
        await client.query(
          'INSERT INTO ag_catalog.backend_schema_migrations (filename, checksum_sha256) VALUES ($1,$2)',
          [filename, checksum],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`backend_migration_failed:${filename}:${message}`, { cause: error });
      }
      applied.push({ filename, checksum, applied: true });
    }
    return applied;
  } finally {
    if (locked) {
      await client.query('SELECT pg_advisory_unlock(hashtext($1))', [MIGRATION_LOCK])
        .catch(() => undefined);
    }
    ownedClient?.release();
  }
}

export async function listenAfterRequiredMigrations<T>(
  listen: () => Promise<T>,
  migrate: () => Promise<unknown> = applyBackendMigrations,
  wait: (milliseconds: number) => Promise<void> = (milliseconds) => new Promise(
    (resolve) => setTimeout(resolve, milliseconds),
  ),
): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await migrate();
      break;
    } catch (error) {
      const code = String((error as { code?: unknown } | null)?.code || '');
      if (code !== '57P03' || attempt >= POSTGRES_RECOVERY_RETRY_LIMIT) {
        throw error;
      }
      console.warn(
        `[BOOT] PostgreSQL recovery in progress; migration retry ${attempt + 1}/${POSTGRES_RECOVERY_RETRY_LIMIT}`,
      );
      await wait(POSTGRES_RECOVERY_RETRY_DELAY_MS);
    }
  }
  return listen();
}
