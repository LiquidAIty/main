import { Router } from 'express';
import {
  deleteCardFromDeck,
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

router.delete('/:projectId/decks/:deckId/cards/:cardId', async (req, res) => {
  const { expectedDeckRevision, expectedCardRevisionId, deletionIntent } = req.body || {};
  if (
    typeof expectedDeckRevision !== 'string'
    || typeof expectedCardRevisionId !== 'string'
    || deletionIntent !== 'delete-card'
  ) {
    return res.status(400).json({ ok: false, error: 'card_deletion_confirmation_required' });
  }

  try {
    const result = await deleteCardFromDeck(
      req.params.projectId,
      req.params.deckId,
      req.params.cardId,
      { expectedDeckRevision, expectedCardRevisionId, deletionIntent },
    );
    return res.json({ ok: true, deck: result.deck, meta: result.meta });
  } catch (err: any) {
    const message = String(err?.message || 'card_delete_failed');
    const status = message === 'project_not_found' || message === 'deck_not_found' || message === 'card_not_found'
      ? 404
      : message.startsWith('card_deletion_protected:')
        ? 403
        : message === 'deck_conflict' || message === 'card_revision_conflict'
          || message.startsWith('card_deletion_references_present:')
          ? 409
          : 500;
    return res.status(status).json({ ok: false, error: message });
  }
});

export default router;
