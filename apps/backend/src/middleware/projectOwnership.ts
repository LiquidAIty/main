import type { Request, Response, NextFunction } from 'express';
import { pool } from '../db/pool';

const PROJECTS_TABLE = 'ag_catalog.projects';

export async function getProjectOwner(projectId: string): Promise<string | null> {
  try {
    const { rows } = await pool.query(
      `SELECT owner_user_id FROM ${PROJECTS_TABLE} WHERE id = $1 LIMIT 1`,
      [projectId]
    );
    if (rows.length === 0) {
      return null;
    }
    return rows[0].owner_user_id || null;
  } catch (error) {
    console.error('[projectOwnership] Failed to get project owner:', error);
    throw error;
  }
}

export async function ensureProjectOwnership(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const projectId = req.params.projectId || req.body.projectId || req.query.projectId;
  const userId = (req as any).userId;

  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  if (!projectId) {
    res.status(400).json({ error: 'Project ID required' });
    return;
  }

  try {
    const owner = await getProjectOwner(projectId);
    
    if (!owner) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    if (owner !== userId) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    next();
  } catch (error) {
    console.error('[projectOwnership] Ownership check failed:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
