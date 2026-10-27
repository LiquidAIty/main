/**
 * Graph + less = more: less code that does the same work as more code is more useful.
 * Entity names the feature; Relationship explains why this file belongs and what it contributes.
 * Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
 * Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
 * Entity: KnowGraph
 * Relationship: This file serves bounded KnowGraph Entity projections and focused neighborhoods from Python rails.
 * Entity: Authentication
 * Relationship: This file requires an authenticated owner before reading a Project's KnowGraph data.
 * Entity: Project Knowledge Graph
 * Relationship: This file provides the KnowGraph projection and expansion routes consumed by the shared graph surface.
 */

import { Router, type Request, type Response } from 'express';
import {
  fetchKnowGraphNeighborhood,
  fetchKnowGraphProjection,
} from '../services/pythonRailsClient';
import { getOwnedProjectByReference } from '../services/projectStore';

const router = Router();

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function queryText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

async function resolveOwnedProjectId(
  req: Request,
  res: Response,
  requestedProjectId: string,
): Promise<string | null> {
  const userId = String((req as Request & { userId?: string }).userId || '').trim();
  const projectId = userId
    ? (await getOwnedProjectByReference(requestedProjectId, userId))?.id ?? null
    : null;
  if (projectId) return projectId;
  res.status(userId ? 404 : 401).json({
    ok: false,
    error: { message: userId ? 'KnowGraph project not found.' : 'Authentication required.' },
  });
  return null;
}

router.get('/graph', async (req, res) => {
  try {
    const requestedProjectId = queryText(req.query?.projectId);

    if (!requestedProjectId) {
      return res.status(400).json({
        ok: false,
        error: { message: 'projectId is required' },
      });
    }
    const projectId = await resolveOwnedProjectId(req, res, requestedProjectId);
    if (!projectId) return undefined;

    const limit = clampInt(req.query?.limit, 1, 500, 200);
    return res.json(await fetchKnowGraphProjection(projectId, limit));
  } catch (error: any) {
    const message = error?.message || 'Failed to fetch KnowGraph graph';
    return res.status(502).json({ ok: false, error: { message } });
  }
});

router.get('/expand', async (req, res) => {
  try {
    const requestedProjectId = queryText(req.query?.projectId);
    const nodeId = queryText(req.query?.nodeId);

    if (!requestedProjectId || !nodeId) {
      return res.status(400).json({
        ok: false,
        error: { message: 'projectId and nodeId are required' },
      });
    }
    const projectId = await resolveOwnedProjectId(req, res, requestedProjectId);
    if (!projectId) return undefined;

    const limit = clampInt(req.query?.limit, 1, 200, 50);
    return res.json(await fetchKnowGraphNeighborhood(projectId, nodeId, limit));
  } catch (error: any) {
    const message = error?.message || 'Failed to expand KnowGraph graph';
    return res.status(502).json({ ok: false, error: { message } });
  }
});

export default router;
