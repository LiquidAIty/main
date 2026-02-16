import { Router } from 'express';
import { pool } from '../../db/pool';
import { createProject, getProjectState, listAgentCards, saveProjectState } from '../../services/agentBuilderStore';
import { getLastTrace } from '../../services/ingestTrace';

const router = Router();

function logV2ProjectRoute(req: any) {
  console.log('[V2][projects] %s %s', req.method, req.originalUrl);
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
    const project = await createProject(name, typeof code === 'string' ? code : null, projectType);
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
    const state = await getProjectState(req.params.projectId);
    return res.json(state);
  } catch (err: any) {
    const status = (err?.message || '').includes('not found') ? 404 : 500;
    return res.status(status).json({ ok: false, error: err?.message || 'failed to load state' });
  }
});

router.put('/:projectId/state', async (req, res) => {
  logV2ProjectRoute(req);
  const projectId = req.params.projectId;
  try {
    const state = await saveProjectState(projectId, req.body || {});
    return res.json(state);
  } catch (err: any) {
    const status = (err?.message || '').includes('not found') ? 404 : 500;
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
