import { Router } from 'express';
import { pool } from '../db/pool';
import { getDeckDocument, saveDeckDocument } from '../decks/store';
import { DEFAULT_PROJECT_EDGES } from '../decks/defaultProjectDeck';
import {
  createProject,
  discardFreshProject,
  getProject,
  listProjects,
} from '../services/projectStore';
import { authenticatedUserId, requireOwnedProject } from './projectAccess';

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
    const ownerUserId = authenticatedUserId(req);
    if (!ownerUserId) {
      return res.status(401).json({ ok: false, error: 'project owner session required' });
    }
    const rawType = req.query.project_type;
    const projectType = rawType === 'assist' || rawType === 'agent' ? rawType : undefined;
    const projects = await listProjects(ownerUserId, projectType);
    return res.json({ ok: true, projects });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || 'failed to list projects' });
  }
});

router.get('/:projectId', async (req, res) => {
  logProjectRoute(req);
  try {
    const ownerUserId = authenticatedUserId(req);
    if (!ownerUserId) {
      return res.status(401).json({ ok: false, error: 'project owner session required' });
    }
    const project = await getProject(req.params.projectId, ownerUserId);
    if (!project) {
      return res.status(404).json({ ok: false, error: 'project_not_found' });
    }
    return res.json({ ok: true, project });
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
  const projectType = project_type === 'assist' || project_type === 'agent' ? project_type : 'agent';
  try {
    const ownerUserId = authenticatedUserId(req);
    if (!ownerUserId) {
      return res.status(401).json({ ok: false, error: 'project owner session required' });
    }
    const project = await createProject(
      name,
      typeof code === 'string' ? code : null,
      projectType,
      ownerUserId,
    );
    if (projectType === 'agent') {
      try {
        const loaded = await getDeckDocument(project.id, 'deck_builder');
        if (!loaded.deck || !loaded.meta.deckRevision) {
          throw new Error('default_project_deck_missing');
        }
        await saveDeckDocument(
          project.id,
          'deck_builder',
          {
            ...loaded.deck,
            edges: DEFAULT_PROJECT_EDGES.map((edge) => ({ ...edge })),
          },
          { expectedRevision: loaded.meta.deckRevision },
        );
      } catch (error) {
        await discardFreshProject(project.id, ownerUserId).catch(() => undefined);
        throw error;
      }
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
    const access = await requireOwnedProject(req, res, projectId);
    if (!access) return;
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

    values.push(access.ownerUserId);
    const ownerParameter = `$${values.length}`;
    const { rows } = await pool.query(
      `UPDATE ${PROJECTS_TABLE}
       SET ${assignments.join(', ')}
       WHERE ${clause} AND owner_user_id = ${ownerParameter}
       RETURNING id`,
      values,
    );
    if (!rows.length) {
      return res.status(404).json({ ok: false, error: 'project_not_found' });
    }
    const project = await getProject(projectId, access.ownerUserId);
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
    const access = await requireOwnedProject(req, res, projectId);
    if (!access) return;
    await client.query('BEGIN');
    const result = await client.query(
      'DELETE FROM ag_catalog.projects WHERE id = $1 AND owner_user_id = $2 RETURNING id',
      [projectId, access.ownerUserId],
    );

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

export default router;
