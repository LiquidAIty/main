// ============================================================================
// receipts.routes.ts
// API endpoints for LLM receipt rating and queries
// ============================================================================

import { Router } from 'express';
import { Pool } from 'pg';

const router = Router();

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5433', 10),
  database: process.env.DB_NAME || 'liquidaity',
  user: process.env.DB_USER || 'liquidaity-user',
  password: process.env.DB_PASSWORD || 'liquidaity-pass',
  max: 5,
});

/**
 * POST /api/probability/:run_id/rate
 * Rate a probability after outcome is known
 */
router.post('/:run_id/rate', async (req, res) => {
  const { run_id } = req.params;
  const { rated_probability } = req.body;

  if (typeof rated_probability !== 'number') {
    return res.status(400).json({ ok: false, error: 'rated_probability must be a number' });
  }

  // Clamp to valid range
  let clamped = rated_probability;
  if (clamped < -0.10) clamped = -0.10;
  if (clamped > 1.00) clamped = 1.00;

  try {
    // Update probability row
    const result = await pool.query(
      `UPDATE ag_catalog.llm_probability 
       SET rated_probability = $1
       WHERE run_id = $2
       RETURNING run_id, project_id, predicted_probability, rated_probability, created_at`,
      [clamped, run_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'run_not_found' });
    }

    return res.json({ ok: true, row: result.rows[0] });
  } catch (err: any) {
    console.error('[probability] Rate failed:', err);
    return res.status(500).json({ ok: false, error: err?.message || 'Failed to rate probability' });
  }
});

/**
 * GET /api/probability/latest
 * Get recent probability records for a project
 */
router.get('/latest', async (req, res) => {
  const { project_id, limit } = req.query;

  if (!project_id) {
    return res.status(400).json({ ok: false, error: 'project_id required' });
  }

  const limitNum = parseInt(limit as string || '20', 10);

  try {
    const result = await pool.query(
      `SELECT id, run_id, created_at, 
              predicted_probability, rated_probability, raw_line
       FROM ag_catalog.llm_probability
       WHERE project_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [project_id, limitNum]
    );

    return res.json({ ok: true, probabilities: result.rows });
  } catch (err: any) {
    console.error('[probability] Query failed:', err);
    return res.status(500).json({ ok: false, error: err?.message || 'Failed to query probabilities' });
  }
});

export default router;
