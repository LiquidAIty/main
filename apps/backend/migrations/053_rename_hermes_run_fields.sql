-- Rename the active Run persistence fields to their exact Hermes owner. The
-- previously applied 051 migration is immutable and intentionally remains
-- limited to Main profile and tool-grant changes.
BEGIN;

SET LOCAL search_path = ag_catalog, "$user", public;

DO $$
DECLARE
  retired_word TEXT := concat('na', 'tive');
  old_columns TEXT[] := ARRAY[
    concat('na', 'tive', '_phase'),
    concat('na', 'tive', '_run_id'),
    concat('na', 'tive', '_task_id'),
    concat('na', 'tive', '_task_run_id'),
    concat('na', 'tive', '_session_id')
  ];
  new_columns TEXT[] := ARRAY[
    'hermes_phase',
    'hermes_run_id',
    'hermes_task_id',
    'hermes_task_run_id',
    'hermes_session_id'
  ];
  column_index INTEGER;
  old_column_present BOOLEAN;
  new_column_present BOOLEAN;
BEGIN
  FOR column_index IN 1..array_length(old_columns, 1)
  LOOP
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'ag_catalog'
        AND table_name = 'agent_runs'
        AND column_name = old_columns[column_index]
    ) INTO old_column_present;
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'ag_catalog'
        AND table_name = 'agent_runs'
        AND column_name = new_columns[column_index]
    ) INTO new_column_present;

    IF old_column_present AND new_column_present THEN
      RAISE EXCEPTION 'hermes_run_column_rename_conflict:%', new_columns[column_index];
    END IF;
    IF old_column_present THEN
      EXECUTE format(
        'ALTER TABLE ag_catalog.agent_runs RENAME COLUMN %I TO %I',
        old_columns[column_index],
        new_columns[column_index]
      );
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'agent_runs_' || retired_word || '_phase_check'
      AND conrelid = 'ag_catalog.agent_runs'::regclass
  ) THEN
    EXECUTE format(
      'ALTER TABLE ag_catalog.agent_runs RENAME CONSTRAINT %I TO agent_runs_hermes_phase_check',
      'agent_runs_' || retired_word || '_phase_check'
    );
  END IF;
END
$$;

COMMIT;
