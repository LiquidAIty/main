import type { Request, Response } from 'express';
import { getProject } from '../services/projectStore';

export function authenticatedUserId(req: Request): string | null {
  const userId = String((req as Request & { userId?: string }).userId || '').trim();
  return userId || null;
}

export async function requireOwnedProject(
  req: Request,
  res: Response,
  projectId: string,
): Promise<{ ownerUserId: string } | null> {
  const ownerUserId = authenticatedUserId(req);
  if (!ownerUserId) {
    res.status(401).json({ ok: false, error: 'project_owner_session_required' });
    return null;
  }
  const project = await getProject(projectId, ownerUserId);
  if (!project) {
    res.status(404).json({ ok: false, error: 'project_not_found' });
    return null;
  }
  return { ownerUserId };
}
