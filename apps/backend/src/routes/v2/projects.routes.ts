import { Router } from 'express';
import {
  createAnonymousSession,
  getUserBySessionId,
  setSessionCookie,
} from '../../auth/sessionStore';
import { pool } from '../../db/pool';
import { canIssueBootstrapSession } from '../../security/requestAccess';
import {
  createProject,
  getProjectStateSnapshot,
  listAgentCards,
  saveProjectState,
} from '../../services/agentBuilderStore';
import { getLastTrace } from '../../services/ingestTrace';
import { ensureSystemAgentConfigs } from '../../services/v2/agentConfigStore';

const router = Router();

function logV2ProjectRoute(req: any) {
  console.log('[V2][projects] %s %s', req.method, req.originalUrl);
}

async function resolveProjectOwnerUserId(req: any, res: any): Promise<string | null> {
  const sessionId = typeof req.cookies?.sid === 'string' ? req.cookies.sid.trim() : '';
  if (sessionId) {
    const user = await getUserBySessionId(sessionId);
    if (user?.id) {
      return user.id;
    }
  }

  if (!canIssueBootstrapSession(req)) {
    return null;
  }

  const { user, session } = await createAnonymousSession();
  setSessionCookie(res, session.id, req);
  return user.id;
}

router.get('/', async (req, res) => {
  logV2ProjectRoute(req);
  try {
    const rawType = req.query.project_type;
    const projectType = rawType === 'assist' || rawType === 'agent' ? rawType : undefined;
    const cards = await listAgentCards(null, projectType);
    return res.json({ ok: true, projects: cards });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || 'failed to list projects' });
  }
});

router.post('/', async (req, res) => {
  logV2ProjectRoute(req);
  const { name, code, project_type } = req.body || {};
  if (!name || typeof name !== 'string') {
    return res.status(400).json({ ok: false, error: 'name is required' });
  }
  const projectType = project_type === 'assist' || project_type === 'agent' ? project_type : 'agent';
  try {
    const ownerUserId = await resolveProjectOwnerUserId(req, res);
    if (!ownerUserId) {
      return res.status(401).json({ ok: false, error: 'project owner session required' });
    }
    const project = await createProject(
      name,
      typeof code === 'string' ? code : null,
      projectType,
      ownerUserId,
    );
    try {
      await ensureSystemAgentConfigs(project.id);
    } catch (ensureErr: any) {
      console.warn('[V2][projects] ensureSystemAgentConfigs failed', {
        projectId: project.id,
        error: ensureErr?.message || String(ensureErr),
      });
    }
    return res.json(project);
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || 'failed to create project' });
  }
});

router.delete('/:projectId', async (req, res) => {
  logV2ProjectRoute(req);
  const projectId = req.params.projectId;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM ag_catalog.project_agents WHERE project_id = $1', [projectId]);
    const result = await client.query('DELETE FROM ag_catalog.projects WHERE id = $1 RETURNING id', [projectId]);

    if (result.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ ok: false, error: 'Project not found' });
    }

    await client.query('COMMIT');
    return res.json({ ok: true, deleted: projectId });
  } catch (err: any) {
    await client.query('ROLLBACK');
    return res.status(500).json({ ok: false, error: err?.message || 'Failed to delete project' });
  } finally {
    client.release();
  }
});

router.get('/:projectId/state', async (req, res) => {
  logV2ProjectRoute(req);
  try {
    const snapshot = await getProjectStateSnapshot(req.params.projectId);
    return res.json({ ...snapshot.state, meta: snapshot.meta });
  } catch (err: any) {
    const status = (err?.message || '').includes('not found') ? 404 : 500;
    return res.status(status).json({ ok: false, error: err?.message || 'failed to load state' });
  }
});

router.put('/:projectId/state', async (req, res) => {
  logV2ProjectRoute(req);
  const projectId = req.params.projectId;
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const expectedRevision =
      typeof (body as any).expectedRevision === 'string'
        ? String((body as any).expectedRevision)
        : typeof (body as any).meta?.revision === 'string'
          ? String((body as any).meta.revision)
          : null;
    const stateInput =
      (body as any).state && typeof (body as any).state === 'object'
        ? (body as any).state
        : body;
    const result = await saveProjectState(projectId, stateInput, { expectedRevision });
    return res.json({ ...result.state, meta: result.meta, applied: result.applied });
  } catch (err: any) {
    const status =
      err?.message === 'builder_state_conflict'
        ? 409
        : (err?.message || '').includes('not found')
          ? 404
          : 500;
    return res.status(status).json({ ok: false, error: err?.message || 'failed to save state' });
  }
});

router.get('/:projectId/kg/last-trace', async (req, res) => {
  logV2ProjectRoute(req);
  try {
    const trace = getLastTrace(req.params.projectId);
    return res.json({ ok: true, trace });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || 'failed to get last trace' });
  }
});

export default router;
