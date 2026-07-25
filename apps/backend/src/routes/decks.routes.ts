import { Router } from 'express';
import {
  deleteDeckDocument,
  getDeckDocument,
  getV3ProjectBlob,
  saveDeckDocument,
} from '../decks/store';
import type { DeckDocument } from '../types';

const router = Router();

router.get('/:projectId/decks', async (req, res) => {
  try {
    const blob = await getV3ProjectBlob(req.params.projectId);
    const decks = Object.keys(blob.decks).map((deckId) => ({
      id: deckId,
      name: blob.decks[deckId]?.name || deckId,
      meta: blob.meta.decks[deckId] || null,
    }));
    return res.json({ ok: true, decks });
  } catch (err: any) {
    const status = err?.message === 'project_not_found' ? 404 : 500;
    return res.status(status).json({ ok: false, error: err?.message || 'deck_list_failed' });
  }
});

router.post('/:projectId/decks', async (req, res) => {
  const document = req.body?.document;
  const requestedDeckId = String(req.body?.deckId || document?.id || '').trim();
  if (!document || typeof document !== 'object') {
    return res.status(400).json({ ok: false, error: 'document_required' });
  }
  if (!requestedDeckId) {
    return res.status(400).json({ ok: false, error: 'deck_id_required' });
  }

  try {
    const result = await saveDeckDocument(
      req.params.projectId,
      requestedDeckId,
      document as DeckDocument,
      { expectedRevision: typeof req.body?.expectedRevision === 'string' ? req.body.expectedRevision : null },
    );
    return res.json({ ok: true, deck: result.deck, meta: result.meta });
  } catch (err: any) {
    const status =
      err?.message === 'project_not_found'
        ? 404
        : err?.message === 'deck_conflict'
          ? 409
          : 500;
    return res.status(status).json({ ok: false, error: err?.message || 'deck_create_failed' });
  }
});

router.get('/:projectId/decks/:deckId', async (req, res) => {
  try {
    const result = await getDeckDocument(req.params.projectId, req.params.deckId);
    return res.json({ ok: true, ...result });
  } catch (err: any) {
    const status = err?.message === 'project_not_found' ? 404 : 500;
    return res.status(status).json({ ok: false, error: err?.message || 'deck_load_failed' });
  }
});

router.put('/:projectId/decks/:deckId', async (req, res) => {
  const { document, expectedRevision } = req.body || {};
  if (!document || typeof document !== 'object') {
    return res.status(400).json({ ok: false, error: 'document_required' });
  }

  try {
    const result = await saveDeckDocument(
      req.params.projectId,
      req.params.deckId,
      document as DeckDocument,
      {
        expectedRevision: typeof expectedRevision === 'string' ? expectedRevision : null,
      },
    );
    return res.json({ ok: true, deck: result.deck, meta: result.meta });
  } catch (err: any) {
    const status =
      err?.message === 'project_not_found'
        ? 404
        : err?.message === 'deck_conflict'
          ? 409
          : String(err?.message || '').startsWith('deck_integrity_')
            ? 409
          : 500;
    return res.status(status).json({ ok: false, error: err?.message || 'deck_save_failed' });
  }
});

router.delete('/:projectId/decks/:deckId', async (req, res) => {
  try {
    const result = await deleteDeckDocument(req.params.projectId, req.params.deckId);
    if (!result.deleted) {
      return res.status(404).json({ ok: false, error: 'deck_not_found' });
    }
    return res.json({ ok: true, deleted: req.params.deckId });
  } catch (err: any) {
    const status = err?.message === 'project_not_found' ? 404 : 500;
    return res.status(status).json({ ok: false, error: err?.message || 'deck_delete_failed' });
  }
});

export default router;
