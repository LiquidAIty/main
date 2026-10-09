import { Router } from 'express';
import { pool } from '../db/pool';
import { getDeckDocument, saveDeckDocument } from '../decks/deckDomainClient';
import { DEFAULT_PROJECT_EDGES } from '../decks/defaultProjectDeck';
import {
  createProject,
  discardFreshProject,
  listOwnedProjects,
} from '../services/projectStore';
import { authenticatedUserId, requireOwnedProject } from './projectAccess';

const router = Router();
router.get('/', async (req, res) => {
  try {
    const ownerUserId = authenticatedUserId(req);
    if (!ownerUserId) {
      return res.status(401).json({ ok: false, error: 'project owner session required' });
    }
    const rawType = req.query.project_type;
    const projectType = rawType === 'assist' || rawType === 'agent' ? rawType : undefined;
    const projects = await listOwnedProjects(ownerUserId, projectType);
    return res.json({ ok: true, projects });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || 'failed to list projects' });
  }
});

router.post('/', async (req, res) => {
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

router.delete('/:projectId', async (req, res) => {
  const projectId = req.params.projectId;
  let client: Awaited<ReturnType<typeof pool.connect>> | null = null;
  try {
    const access = await requireOwnedProject(req, res, projectId);
    if (!access) return;
    client = await pool.connect();
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
    await client?.query('ROLLBACK').catch(() => undefined);
    if (String(err?.code || '') === '23503') {
      return res.status(409).json({ ok: false, error: 'project_contains_retained_data' });
    }
    return res.status(500).json({ ok: false, error: err?.message || 'failed to delete project' });
  } finally {
    client?.release();
  }
});

export default router;
