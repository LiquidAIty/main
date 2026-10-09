import type { Request, Response } from 'express';

import { getOwnedProjectByReference } from '../services/projectStore';

export async function authorizeSharedChatProject(
  req: Request,
  res: Response,
  projectId: string,
): Promise<string | null> {
  const userId = String((req as Request & { userId?: string }).userId || '').trim();
  if (!userId) {
    res.status(401).json({ ok: false, error: 'shared_chat_user_authentication_required' });
    return null;
  }
  const project = await getOwnedProjectByReference(projectId, userId);
  if (!project || project.ownerUserId !== userId) {
    res.status(403).json({ ok: false, error: 'shared_chat_project_access_denied' });
    return null;
  }
  return userId;
}
