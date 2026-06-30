import { Router } from 'express';
import {
  createAnonymousSession,
  getUserBySessionId,
  setSessionCookie,
} from '../auth/sessionStore';
import { pool } from '../db/pool';
import { canIssueBootstrapSession } from '../security/requestAccess';
import {
  createProject,
  getProjectCard,
  getProjectStateSnapshot,
  listAgentCards,
  saveProjectState,
} from '../services/agentBuilderStore';
import { getLastTrace } from '../services/ingestTrace';
import { ensureSystemAgentConfigs } from '../services/agentConfigStore';

const router = Router();
const PROJECTS_TABLE = 'ag_catalog.projects';
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function logProjectRoute(req: any) {
  console.log('[projects] %s %s', req.method, req.originalUrl);
}

function projectLookup(projectId: string): { clause: string; params: any[] } {
  if (UUID_REGEX.test(projectId)) {
    return { clause: 'id = $1', params: [projectId] };
  }
  return { clause: 'code = $1', params: [projectId] };
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

async function getProjectColumns(): Promise<Set<string>> {
  const { rows } = await pool.query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'ag_catalog' AND table_name = 'projects'`,
  );
  return new Set(rows.map((row) => String(row.column_name || '').trim()).filter(Boolean));
}

router.get('/', async (req, res) => {
  logProjectRoute(req);
  try {
    const rawType = req.query.project_type;
    const projectType = rawType === 'assist' || rawType === 'agent' ? rawType : undefined;
    const cards = await listAgentCards(null, projectType);
    return res.json({ ok: true, projects: cards });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || 'failed to list projects' });
  }
});

router.get('/:projectId', async (req, res) => {
  logProjectRoute(req);
  try {
    const card = await getProjectCard(req.params.projectId);
    if (!card) {
      return res.status(404).json({ ok: false, error: 'project_not_found' });
    }
    return res.json({ ok: true, project: card });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || 'failed to load project' });
  }
});

router.post('/', async (req, res) => {
  logProjectRoute(req);
  const { name, code, project_type } = req.body || {};
  if (!name || typeof name !== 'string') {
    return res.status(400).json({ ok: false, error: 'name is required' });
  }
  const projectType = project_type === 'assist' || project_type === 'agent' ? project_type : 'assist';
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
      console.warn('[projects] ensureSystemAgentConfigs failed', {
        projectId: project.id,
        error: ensureErr?.message || String(ensureErr),
      });
    }
    return res.json({ ok: true, project });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || 'failed to create project' });
  }
});

router.patch('/:projectId', async (req, res) => {
  logProjectRoute(req);
  const projectId = String(req.params.projectId || '').trim();
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';
  const projectType =
    req.body?.project_type === 'assist' || req.body?.project_type === 'agent'
      ? req.body.project_type
      : null;
  if (!projectId) {
    return res.status(400).json({ ok: false, error: 'project_id_required' });
  }
  if (!name && !code && !projectType) {
    return res.status(400).json({ ok: false, error: 'patch_fields_required' });
  }

  try {
    const columns = await getProjectColumns();
    const { clause, params } = projectLookup(projectId);
    const assignments: string[] = [];
    const values = [...params];

    if (name) {
      assignments.push(`name = $${values.length + 1}`);
      values.push(name);
    }
    if (code || req.body?.code === null) {
      assignments.push(`code = $${values.length + 1}`);
      values.push(code || null);
    }
    if (projectType && columns.has('project_type')) {
      assignments.push(`project_type = $${values.length + 1}`);
      values.push(projectType);
    }
    assignments.push('updated_at = NOW()');

    const { rows } = await pool.query(
      `UPDATE ${PROJECTS_TABLE}
       SET ${assignments.join(', ')}
       WHERE ${clause}
       RETURNING id`,
      values,
    );
    if (!rows.length) {
      return res.status(404).json({ ok: false, error: 'project_not_found' });
    }
    const project = await getProjectCard(projectId);
    return res.json({ ok: true, project });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || 'failed to update project' });
  }
});

router.delete('/:projectId', async (req, res) => {
  logProjectRoute(req);
  const projectId = req.params.projectId;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM ag_catalog.project_agents WHERE project_id = $1', [projectId]);
    const result = await client.query('DELETE FROM ag_catalog.projects WHERE id = $1 RETURNING id', [projectId]);

    if (result.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ ok: false, error: 'project_not_found' });
    }

    await client.query('COMMIT');
    return res.json({ ok: true, deleted: projectId });
  } catch (err: any) {
    await client.query('ROLLBACK');
    return res.status(500).json({ ok: false, error: err?.message || 'failed to delete project' });
  } finally {
    client.release();
  }
});

router.get('/:projectId/state', async (req, res) => {
  logProjectRoute(req);
  try {
    const snapshot = await getProjectStateSnapshot(req.params.projectId);
    return res.json({ ok: true, ...snapshot.state, meta: snapshot.meta });
  } catch (err: any) {
    const status = (err?.message || '').includes('not found') ? 404 : 500;
    return res.status(status).json({ ok: false, error: err?.message || 'failed to load state' });
  }
});

router.put('/:projectId/state', async (req, res) => {
  logProjectRoute(req);
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
    const result = await saveProjectState(req.params.projectId, stateInput, { expectedRevision });
    return res.json({ ok: true, ...result.state, meta: result.meta, applied: result.applied });
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
  logProjectRoute(req);
  try {
    const trace = getLastTrace(req.params.projectId);
    return res.json({ ok: true, trace });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || 'failed to get last trace' });
  }
});

export default router;
