import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { applyBackendMigrations, listenAfterRequiredMigrations } from './migrations';

function migrationPath(filename: string): string {
  return resolve(__dirname, '../../migrations', filename);
}

// Applied migration filenames and the retired schema identifiers asserted
// inside them are immutable migration-ledger evidence, not current terminology.
const sessionAuthorityMigration = '034_hermes_native_session_authority.sql';
const cancelledRunPhaseMigration = '038_allow_cancelled_native_run_phase.sql';
const taskStatusMigration = '041_native_hermes_task_status.sql';
const retiredRunPhaseConstraint = 'agent_runs_native_phase_check';

const migration = `
-- Existing numbered migrations may document their purpose before the
-- transaction envelope.
BEGIN;
ALTER TABLE ag_catalog.agent_runs ADD COLUMN IF NOT EXISTS hermes_phase TEXT;
COMMIT;
`;

function fakeClient(existingChecksum?: string | Record<string, string>) {
  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    if (sql.includes('SELECT checksum_sha256')) {
      const checksum = typeof existingChecksum === 'string'
        ? existingChecksum
        : existingChecksum?.[String(params?.[0] || '')];
      return { rows: checksum ? [{ checksum_sha256: checksum }] : [] };
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
      expect.objectContaining({ filename: sessionAuthorityMigration, applied: true }),
      expect.objectContaining({ filename: '035_remove_provider_api_mode_constraint.sql', applied: true }),
      expect.objectContaining({ filename: '036_remove_obsolete_card_tool_policy.sql', applied: true }),
      expect.objectContaining({ filename: '037_magentic_hermes_execution.sql', applied: true }),
      expect.objectContaining({ filename: cancelledRunPhaseMigration, applied: true }),
      expect.objectContaining({ filename: '039_remove_assistant_agent_capability.sql', applied: true }),
      expect.objectContaining({ filename: '040_remove_main_script_experiment.sql', applied: true }),
      expect.objectContaining({ filename: taskStatusMigration, applied: true }),
      expect.objectContaining({ filename: '047_retire_saved_card_kanban_mode.sql', applied: true }),
      expect.objectContaining({ filename: '048_project_worldview_capabilities.sql', applied: true }),
      expect.objectContaining({ filename: '049_grant_main_project_worldview_control.sql', applied: true }),
      expect.objectContaining({ filename: '050_worldview_layer_origin.sql', applied: true }),
      expect.objectContaining({ filename: '051_main_profile_and_hermes_terms.sql', applied: true }),
      expect.objectContaining({ filename: '052_grant_main_message_agent.sql', applied: true }),
      expect.objectContaining({ filename: '053_rename_hermes_run_fields.sql', applied: true }),
      expect.objectContaining({ filename: '054_rename_remaining_hermes_run_aggregates.sql', applied: true }),
      expect.objectContaining({ filename: '055_remove_bot_mode_card_tool_grant.sql', applied: true }),
      expect.objectContaining({ filename: '056_rename_project_code_folder.sql', applied: true }),
      expect.objectContaining({ filename: '057_card_run_selection_and_usage.sql', applied: true }),
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

  it('preserves the exact applied Hermes session-authority migration', async () => {
    const source = await readFile(
      migrationPath(sessionAuthorityMigration),
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

  it('removes obsolete Card tool policy only through new current revisions', async () => {
    const source = await readFile(
      migrationPath('036_remove_obsolete_card_tool_policy.sql'),
      'utf8',
    );

    expect(source).toContain("runtime_extension_config ? 'toolCatalogPolicy'");
    expect(source).toContain("runtime_extension_config ? 'disabledTools'");
    expect(source).toContain("source.runtime_extension_config\n      - 'toolCatalogPolicy'\n      - 'disabledTools'");
    expect(source).toContain('INSERT INTO ag_catalog.agent_card_revisions');
    expect(source).toContain('INSERT INTO ag_catalog.card_capability_grants');
    expect(source).toContain('SET current_revision_id = next_revision_id');
    expect(source).not.toContain('UPDATE ag_catalog.agent_card_revisions');
    expect(source).not.toMatch(/\bDELETE\s+FROM\b/i);
  });

  it('moves current Mag One identities to Hermes and rejects new legacy runtime rows', async () => {
    const source = await readFile(
      migrationPath('037_magentic_hermes_execution.sql'),
      'utf8',
    );

    expect(source).toContain("card.card_id = 'card_magentic'");
    expect(source).toContain("next_runtime_profile := CASE source.card_id");
    expect(source).toContain("WHEN 'card_magentic' THEN 'card_magentic'");
    expect(source).toContain("'mode', next_runtime_mode");
    expect(source).toContain("'profile', next_runtime_profile");
    expect(source).toContain("runtime_mode IN ('main', 'delegate', 'kanban', 'magentic_one')");
    expect(source.match(/\) NOT VALID;/g)).toHaveLength(2);
    expect(source).toContain('INSERT INTO ag_catalog.agent_card_revisions');
    expect(source).toContain('SET current_revision_id = next_revision_id');
    expect(source).not.toContain('UPDATE ag_catalog.agent_card_revisions');
    expect(source).not.toMatch(/\bDELETE\s+FROM\b/i);
  });

  it('retires only the saved-Card kanban runtime mode without rewriting history', async () => {
    const source = await readFile(
      migrationPath('047_retire_saved_card_kanban_mode.sql'),
      'utf8',
    );

    expect(source).toContain("revision.runtime_mode = 'kanban'");
    expect(source).toContain('retired_kanban_card_mode_current_state_present');
    expect(source).toContain("run.runtime_mode = 'kanban'");
    expect(source).toContain("run.state IN ('pending', 'running')");
    expect(source).toContain('retired_kanban_card_mode_active_run_present');
    expect(source.match(/runtime_mode IN \('main', 'delegate', 'magentic_one'\)/g)).toHaveLength(2);
    expect(source.match(/\) NOT VALID;/g)).toHaveLength(2);
    expect(source).not.toContain("runtime_mode IN ('main', 'delegate', 'kanban'");
    expect(source).not.toMatch(/\bUPDATE\s+ag_catalog\./i);
    expect(source).not.toMatch(/\bDELETE\s+FROM\b/i);
  });

  it('grants Project WorldView control to current Main through new revisions', async () => {
    const source = await readFile(
      migrationPath('049_grant_main_project_worldview_control.sql'),
      'utf8',
    );

    expect(source).toContain("revision.runtime_kind = 'hermes'");
    expect(source).toContain("revision.runtime_mode = 'main'");
    expect(source).toContain("capability.grant_id = 'worldview.set_capability'");
    expect(source).toContain('INSERT INTO ag_catalog.agent_card_revisions');
    expect(source).toContain('INSERT INTO ag_catalog.card_capability_grants');
    expect(source).toContain('SET current_revision_id = next_revision_id');
    expect(source).toContain('UPDATE ag_catalog.agent_decks');
    expect(source).not.toContain('UPDATE ag_catalog.agent_card_revisions');
    expect(source).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(source).not.toContain('UPDATE ag_catalog.agent_runs');
  });

  it('accepts truthful Hermes cancellation without rewriting retained Runs', async () => {
    const source = await readFile(
      migrationPath(cancelledRunPhaseMigration),
      'utf8',
    );

    expect(source).toContain("'cancelled'");
    expect(source).toContain(`DROP CONSTRAINT IF EXISTS ${retiredRunPhaseConstraint}`);
    expect(source).toContain(`ADD CONSTRAINT ${retiredRunPhaseConstraint}`);
    expect(source).not.toMatch(/\bUPDATE\s+ag_catalog\.agent_runs\b/i);
    expect(source).not.toMatch(/\bDELETE\s+FROM\b/i);
  });

  it('accepts exact Hermes task statuses without rewriting legacy Run rows', async () => {
    const source = await readFile(
      migrationPath(taskStatusMigration),
      'utf8',
    );

    for (const status of [
      'triage', 'todo', 'scheduled', 'ready', 'running',
      'blocked', 'review', 'done', 'archived',
    ]) {
      expect(source).toContain(`'${status}'`);
    }
    expect(source).toContain(`DROP CONSTRAINT IF EXISTS ${retiredRunPhaseConstraint}`);
    expect(source).toContain(`ADD CONSTRAINT ${retiredRunPhaseConstraint}`);
    expect(source).not.toMatch(/\bUPDATE\s+ag_catalog\.agent_runs\b/i);
    expect(source).not.toMatch(/\bDELETE\s+FROM\b/i);
  });

  it('preserves the exact applied Main-profile and grant-kind migration bytes', async () => {
    const source = await readFile(
      migrationPath('051_main_profile_and_hermes_terms.sql'),
      'utf8',
    );

    expect(source).toContain("'profile', 'main'");
    expect(source).toContain("'main', source.provider");
    expect(source).toContain("'hermesTools'");
    expect(source).toContain("grant_kind = 'hermes_tool'");
    expect(source).toContain('INSERT INTO ag_catalog.agent_card_revisions');
    expect(source).toContain('SET current_revision_id = next_revision_id');
    expect(source).not.toContain('UPDATE ag_catalog.agent_card_revisions');
    expect(source).not.toMatch(/\bCREATE\s+(?:OR\s+REPLACE\s+)?VIEW\b/i);
    expect(createHash('sha256').update(source).digest('hex')).toBe(
      '57d488974601cba22016ff46621a9a193135b867bc677994ea4d8c22498ca51f',
    );
  });

  it('preserves the exact applied historical Main grant migration', async () => {
    const source = await readFile(
      migrationPath('052_grant_main_message_agent.sql'),
      'utf8',
    );

    expect(source).toContain("revision.runtime_mode = 'main'");
    expect(source).toContain("capability.grant_kind = 'hermes_tool'");
    expect(source).toContain("capability.grant_id = 'hermes:tool:message_agent'");
    expect(source).toContain('INSERT INTO ag_catalog.agent_card_revisions');
    expect(source).toContain('INSERT INTO ag_catalog.card_capability_grants');
    expect(source).toContain('SET current_revision_id = next_revision_id');
    expect(source).not.toContain('UPDATE ag_catalog.agent_card_revisions');
    expect(source).not.toContain('UPDATE ag_catalog.agent_runs');
    expect(createHash('sha256').update(source).digest('hex')).toBe(
      'ff932e12b198a126a2e2067d61c0cb0c9481204c04aa010e3d5188965fb47ea4',
    );
  });

  it('renames the active Hermes Run fields in one forward migration', async () => {
    const source = await readFile(
      migrationPath('053_rename_hermes_run_fields.sql'),
      'utf8',
    );

    for (const field of [
      'hermes_phase',
      'hermes_run_id',
      'hermes_task_id',
      'hermes_task_run_id',
      'hermes_session_id',
    ]) {
      expect(source).toContain(field);
    }
    expect(source).toContain('TO agent_runs_hermes_phase_check');
    expect(source).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(source).not.toContain('UPDATE ag_catalog.agent_runs');
    expect(createHash('sha256').update(source).digest('hex')).toBe(
      '73fe0e0341998252c60e1356d36d40c6f9e81922a40010e5319faa83ad39ae26',
    );
  });

  it('renames the three omitted Hermes Run aggregates without duplicate columns', async () => {
    const source = await readFile(
      migrationPath('054_rename_remaining_hermes_run_aggregates.sql'),
      'utf8',
    );

    for (const field of [
      'hermes_task_completed_count',
      'hermes_task_total_count',
      'hermes_active_worker_count',
    ]) {
      expect(source).toContain(field);
    }
    expect(source).toContain("concat('na', 'tive', '_task_completed_count')");
    expect(source).toContain("concat('na', 'tive', '_task_total_count')");
    expect(source).toContain("concat('na', 'tive', '_active_worker_count')");
    expect(source).toContain('hermes_run_column_rename_conflict');
    expect(source).not.toMatch(/\bADD\s+COLUMN\b/i);
    expect(source).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(source).not.toContain('UPDATE ag_catalog.agent_runs');
  });

  it('removes the false Bot Mode Card-tool grant only through new current revisions', async () => {
    const source = await readFile(
      migrationPath('055_remove_bot_mode_card_tool_grant.sql'),
      'utf8',
    );

    expect(source).toContain("grant_kind = 'hermes_tool'");
    expect(source).toContain("grant_id = 'hermes:tool:message_agent'");
    expect(source).toContain('INSERT INTO ag_catalog.agent_card_revisions');
    expect(source).toContain('INSERT INTO ag_catalog.card_capability_grants');
    expect(source).toContain('SET current_revision_id = next_revision_id');
    expect(source).not.toContain('UPDATE ag_catalog.agent_card_revisions');
    expect(source).not.toContain('UPDATE ag_catalog.agent_runs');
    expect(source).not.toMatch(/\bDELETE\s+FROM\b/i);
  });

  it('accepts an applied 053 ledger and schedules only the four forward corrections', async () => {
    const migrationsDirectory = resolve(__dirname, '../../migrations');
    const fresh = await applyBackendMigrations({
      client: fakeClient() as any,
      migrationsDirectory,
    });
    const existingThrough053 = Object.fromEntries(
      fresh
        .filter((entry) => Number(entry.filename.slice(0, 3)) <= 53)
        .map((entry) => [entry.filename, entry.checksum]),
    );
    const upgraded = await applyBackendMigrations({
      client: fakeClient(existingThrough053) as any,
      migrationsDirectory,
    });

    expect(upgraded.filter((entry) => entry.applied).map((entry) => entry.filename)).toEqual([
      '054_rename_remaining_hermes_run_aggregates.sql',
      '055_remove_bot_mode_card_tool_grant.sql',
      '056_rename_project_code_folder.sql',
      '057_card_run_selection_and_usage.sql',
    ]);
    expect(upgraded.filter((entry) => !entry.applied)).toHaveLength(fresh.length - 4);
  });

  it('adds Card Run selection and usage fields without another metrics store', async () => {
    const source = await readFile(
      migrationPath('057_card_run_selection_and_usage.sql'),
      'utf8',
    );

    expect(source).toContain('ADD COLUMN auto_tools_decision JSONB');
    expect(source).toContain('ADD COLUMN auto_model_decision JSONB');
    expect(source).toContain('ADD COLUMN provider_total_tokens BIGINT');
    expect(source).toContain('ADD COLUMN cost_status TEXT');
    expect(source).not.toContain('CREATE TABLE');
  });

  it('retires the obsolete Card-as-assistant capability through new current revisions', async () => {
    const source = await readFile(
      migrationPath('039_remove_assistant_agent_capability.sql'),
      'utf8',
    );

    expect(source).toContain('card.current_revision_id');
    expect(source).toContain("position('card.run_assistant_agent' IN revision.base_prompt) > 0");
    expect(source).toContain("capability.grant_id = 'card.run_assistant_agent'");
    expect(source).toContain("replace(\n      source.base_prompt,\n      'card.run_assistant_agent',\n      'message_agent'");
    expect(source).toContain('next_base_prompt_sha256 := encode(');
    expect(source).toContain("'basePrompt', cleaned_base_prompt");
    expect(source).toContain("'grants', copied_grants");
    expect(source).toContain('next_revision_sha256 := encode(');
    expect(source).toContain('INSERT INTO ag_catalog.agent_card_revisions');
    expect(source).toContain('INSERT INTO ag_catalog.card_capability_grants');
    expect(source).toContain("grant_id <> 'card.run_assistant_agent'");
    expect(source).toContain('SET current_revision_id = next_revision_id');
    expect(source).toContain('UPDATE ag_catalog.agent_decks');
    expect(source).not.toContain('UPDATE ag_catalog.agent_card_revisions');
    expect(source).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(source).not.toContain('UPDATE ag_catalog.agent_runs');
  });

  it('removes only the saved Main Script experiment through a new current revision', async () => {
    const source = await readFile(
      migrationPath('040_remove_main_script_experiment.sql'),
      'utf8',
    );

    expect(source).toContain("card.card_id = 'card_main_chat'");
    expect(source).toContain("revision.runtime_extension_config ? 'script'");
    expect(source).toContain("source.runtime_extension_config - 'script'");
    expect(source).toContain('INSERT INTO ag_catalog.agent_card_revisions');
    expect(source).toContain('INSERT INTO ag_catalog.card_capability_grants');
    expect(source).toContain('SET current_revision_id = next_revision_id');
    expect(source).toContain('UPDATE ag_catalog.agent_decks');
    expect(source).not.toContain('UPDATE ag_catalog.agent_card_revisions');
    expect(source).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(source).not.toContain('UPDATE ag_catalog.agent_runs');
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
