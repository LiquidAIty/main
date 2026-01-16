import { Router } from 'express';
import { Pool } from 'pg';

const router = Router();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://liquidaity-user:LiquidAIty@localhost:5433/liquidaity',
  max: 5,
});

router.get('/schema-check', async (_req, res) => {
  try {
    const dbUrl = process.env.DATABASE_URL || 'postgresql://liquidaity-user:LiquidAIty@localhost:5433/liquidaity';
    const urlParts = new URL(dbUrl);
    
    const dbInfo = {
      host: urlParts.hostname,
      port: urlParts.port,
      database: urlParts.pathname.slice(1),
      user: urlParts.username,
    };

    // Check if ag_catalog.projects table exists
    const tableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'ag_catalog' 
        AND table_name = 'projects'
      ) AS table_exists
    `);

    // Get all columns in ag_catalog.projects if it exists
    let columns: string[] = [];
    if (tableCheck.rows[0]?.table_exists) {
      const colsResult = await pool.query(`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'ag_catalog' AND table_name = 'projects'
        ORDER BY ordinal_position
      `);
      columns = colsResult.rows.map(r => `${r.column_name} (${r.data_type}, nullable=${r.is_nullable})`);
    }

    // Check for required tables
    const requiredTables = [
      'ag_catalog.projects',
      'ag_catalog.rag_chunks',
      'ag_catalog.rag_embeddings',
      'ag_catalog.project_agents',
    ];

    const tableStatuses = await Promise.all(
      requiredTables.map(async (fullTableName) => {
        const [schema, table] = fullTableName.split('.');
        const result = await pool.query(
          `SELECT EXISTS (
            SELECT FROM information_schema.tables 
            WHERE table_schema = $1 AND table_name = $2
          ) AS exists`,
          [schema, table]
        );
        return { table: fullTableName, exists: result.rows[0]?.exists || false };
      })
    );

    // Check for specific columns in projects table
    const requiredColumns = ['assist_main_agent_id', 'assist_kg_ingest_agent_id'];
    const columnStatuses = await Promise.all(
      requiredColumns.map(async (colName) => {
        const result = await pool.query(
          `SELECT EXISTS (
            SELECT FROM information_schema.columns
            WHERE table_schema = 'ag_catalog' 
            AND table_name = 'projects'
            AND column_name = $1
          ) AS exists`,
          [colName]
        );
        return { column: colName, exists: result.rows[0]?.exists || false };
      })
    );

    return res.json({
      ok: true,
      db_connection: dbInfo,
      tables: tableStatuses,
      projects_columns: columnStatuses,
      all_projects_columns: columns,
      diagnosis: columnStatuses.every(c => c.exists) 
        ? 'SCHEMA_OK' 
        : 'SCHEMA_MISMATCH: missing columns in ag_catalog.projects',
    });
  } catch (error: any) {
    return res.status(500).json({
      ok: false,
      error: 'diagnostic_failed',
      message: error?.message || String(error),
      diagnosis: 'DB_CONNECTION_FAILED',
    });
  }
});

export const diagnosticRoutes = router;
