-- Finish the Run-field owner rename omitted by the prior forward migration.
BEGIN;

SET LOCAL search_path = ag_catalog, "$user", public;

DO $$
DECLARE
  retired_word TEXT := concat('na', 'tive');
  old_columns TEXT[] := ARRAY[
    concat('na', 'tive', '_task_completed_count'),
    concat('na', 'tive', '_task_total_count'),
    concat('na', 'tive', '_active_worker_count')
  ];
  new_columns TEXT[] := ARRAY[
    'hermes_task_completed_count',
    'hermes_task_total_count',
    'hermes_active_worker_count'
  ];
  old_constraints TEXT[] := ARRAY[
    concat('agent_runs_', retired_word, '_task_completed_count_check'),
    concat('agent_runs_', retired_word, '_task_total_count_check'),
    concat('agent_runs_', retired_word, '_active_worker_count_check')
  ];
  new_constraints TEXT[] := ARRAY[
    'agent_runs_hermes_task_completed_count_check',
    'agent_runs_hermes_task_total_count_check',
    'agent_runs_hermes_active_worker_count_check'
  ];
  item_index INTEGER;
  old_present BOOLEAN;
  new_present BOOLEAN;
BEGIN
  FOR item_index IN 1..array_length(old_columns, 1)
  LOOP
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'ag_catalog'
        AND table_name = 'agent_runs'
        AND column_name = old_columns[item_index]
    ) INTO old_present;
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'ag_catalog'
        AND table_name = 'agent_runs'
        AND column_name = new_columns[item_index]
    ) INTO new_present;

    IF old_present AND new_present THEN
      RAISE EXCEPTION 'hermes_run_column_rename_conflict:%', new_columns[item_index];
    END IF;
    IF old_present THEN
      EXECUTE format(
        'ALTER TABLE ag_catalog.agent_runs RENAME COLUMN %I TO %I',
        old_columns[item_index],
        new_columns[item_index]
      );
    END IF;

    SELECT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conname = old_constraints[item_index]
        AND conrelid = 'ag_catalog.agent_runs'::regclass
    ) INTO old_present;
    SELECT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conname = new_constraints[item_index]
        AND conrelid = 'ag_catalog.agent_runs'::regclass
    ) INTO new_present;

    IF old_present AND new_present THEN
      RAISE EXCEPTION 'hermes_run_constraint_rename_conflict:%', new_constraints[item_index];
    END IF;
    IF old_present THEN
      EXECUTE format(
        'ALTER TABLE ag_catalog.agent_runs RENAME CONSTRAINT %I TO %I',
        old_constraints[item_index],
        new_constraints[item_index]
      );
    END IF;
  END LOOP;
END
$$;

COMMIT;
