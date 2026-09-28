import {
  createLocalSession,
  getUserBySessionId,
  setSessionCookie,
} from '../auth/sessionStore';
import { canIssueBootstrapSession } from '../security/requestAccess';
import { getProjectCard } from '../services/agentBuilderStore';

export async function resolveProjectOwnerUserId(req: any, res: any): Promise<string | null> {
  const sessionId = typeof req.cookies?.sid === 'string' ? req.cookies.sid.trim() : '';
  if (sessionId) {
    const user = await getUserBySessionId(sessionId);
    if (user?.id) return user.id;
  }
  if (!canIssueBootstrapSession(req)) return null;
  const { user, session } = await createLocalSession();
  setSessionCookie(res, session.id, req);
  return user.id;
}

export async function requireOwnedProject(
  req: any,
  res: any,
  projectId: string,
): Promise<{ ownerUserId: string } | null> {
  const ownerUserId = await resolveProjectOwnerUserId(req, res);
  if (!ownerUserId) {
    res.status(401).json({ ok: false, error: 'project_owner_session_required' });
    return null;
  }
  const project = await getProjectCard(projectId, ownerUserId);
  if (!project) {
    res.status(404).json({ ok: false, error: 'project_not_found' });
    return null;
  }
  return { ownerUserId };
}
