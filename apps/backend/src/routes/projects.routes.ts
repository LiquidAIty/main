/**
 * Graph + less = more: less code that does the same work as more code is more useful.
 * Entity names the feature; Relationship explains why this file belongs and what it contributes.
 * Use codebase-memory-mcp cli to search tags, trace structure both ways, check coverage, then read source.
 * Change the smallest existing path; remove what it replaces, never duplicate, and update tags when meaning changes.
 * Entity: Projects
 * Relationship: This file exposes Project list, create, and delete routes while preserving exact owner scope and explicit partial-state failures.
 *
 * Entity: Saved Cards
 * Relationship: This file persists the source-default saved Card roster through the deck authority during Project creation and returns its exact revision readback.
 * Entity: Card Topology
 * Relationship: This file persists the source-default Card positions and wires as part of the newly created Project deck.
 * Entity: Authentication
 * Relationship: This file requires an authenticated owner for Project listing, creation, and deletion and scopes each operation to that owner.
 */

import { Router } from 'express';
import { pool } from '../db/pool';
import { getDeckDocument, saveDeckDocument } from '../decks/deckDomainClient';
import {
  createDefaultProjectDeck,
  DEFAULT_PROJECT_DECK_ID,
  isDefaultProjectDeckReadback,
} from '../decks/defaultProjectDeck';
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
    const projects = await listOwnedProjects(ownerUserId);
    return res.json({ ok: true, projects });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || 'failed to list projects' });
  }
});

router.post('/', async (req, res) => {
  const { name, code } = req.body || {};
  if (!name || typeof name !== 'string') {
    return res.status(400).json({ ok: false, error: 'name is required' });
  }
  try {
    const ownerUserId = authenticatedUserId(req);
    if (!ownerUserId) {
      return res.status(401).json({ ok: false, error: 'project owner session required' });
    }
    const project = await createProject(
      name,
      typeof code === 'string' ? code : null,
      ownerUserId,
    );
    let initialized: Awaited<ReturnType<typeof saveDeckDocument>>;
    try {
      initialized = await saveDeckDocument(
        project.id,
        DEFAULT_PROJECT_DECK_ID,
        createDefaultProjectDeck(),
        { expectedRevision: null },
      );
      if (!initialized.meta.deckRevision
        || !isDefaultProjectDeckReadback(initialized.deck)) {
        throw new Error('default_project_deck_readback_invalid');
      }
    } catch (error) {
      let recovered: Awaited<ReturnType<typeof getDeckDocument>>;
      try {
        recovered = await getDeckDocument(project.id, DEFAULT_PROJECT_DECK_ID);
      } catch (readbackError) {
        throw new Error('project_initialization_outcome_unknown', {
          cause: readbackError,
        });
      }
      if (recovered.deck) {
        if (!recovered.meta.deckRevision
          || !isDefaultProjectDeckReadback(recovered.deck)) {
          throw new Error('default_project_deck_readback_invalid', {
            cause: error,
          });
        }
        initialized = {
          deck: recovered.deck,
          meta: recovered.meta,
        };
      } else {
        try {
          await discardFreshProject(project.id, ownerUserId);
        } catch (compensationError) {
          console.error('[PROJECT_CREATE] compensation failed', {
            projectId: project.id,
            errorClass: compensationError instanceof Error
              ? compensationError.constructor.name
              : 'UnknownError',
          });
          throw new Error('project_initialization_compensation_failed', {
            cause: error,
          });
        }
        throw error;
      }
    }
    return res.json({
      ok: true,
      project,
      projectId: project.id,
      deck: initialized.deck,
      meta: initialized.meta,
    });
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
      [access.projectId, access.ownerUserId],
    );

    if (result.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ ok: false, error: 'project_not_found' });
    }

    await client.query('COMMIT');
    return res.json({ ok: true, deleted: access.projectId });
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
