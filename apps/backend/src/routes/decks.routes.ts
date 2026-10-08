import { Router } from 'express';
import {
  deleteCardFromDeck,
  getDeckDocument,
  getV3ProjectBlob,
  saveDeckDocument,
} from '../decks/store';
import type { DeckDocument } from '../types';
import {
  attachSavedCardToProject,
  discardFreshMembership,
  listSavedCardsForProject,
} from '../services/agentBuilderStore';
import { requireOwnedProject } from './projectAccess';

const router = Router();

router.get('/:projectId/decks', async (req, res) => {
  try {
    const access = await requireOwnedProject(req, res, req.params.projectId);
    if (!access) return;
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
    const access = await requireOwnedProject(req, res, req.params.projectId);
    if (!access) return;
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
    const access = await requireOwnedProject(req, res, req.params.projectId);
    if (!access) return;
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
    const access = await requireOwnedProject(req, res, req.params.projectId);
    if (!access) return;
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
    const message = String(err?.message || 'deck_save_failed');
    const status =
      message === 'project_not_found'
        ? 404
        : message === 'deck_conflict'
          || message === 'card_revision_stale'
          || message === 'card_runtime_profile_immutable'
          ? 409
          : message.startsWith('deck_integrity_')
            ? 409
          : 500;
    return res.status(status).json({ ok: false, error: message });
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
    const access = await requireOwnedProject(req, res, req.params.projectId);
    if (!access) return;
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

router.get('/:projectId/decks/:deckId/saved-cards', async (req, res) => {
  try {
    const access = await requireOwnedProject(req, res, req.params.projectId);
    if (!access) return;
    const cards = await listSavedCardsForProject(
      req.params.projectId,
      req.params.deckId,
      access.ownerUserId,
    );
    return res.json({ ok: true, cards });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || 'saved_card_list_failed' });
  }
});

router.post('/:projectId/decks/:deckId/memberships', async (req, res) => {
  const cardId = typeof req.body?.cardId === 'string' ? req.body.cardId.trim() : '';
  const cardRevisionId = typeof req.body?.cardRevisionId === 'string'
    ? req.body.cardRevisionId.trim()
    : '';
  const expectedDeckRevision = typeof req.body?.expectedDeckRevision === 'string'
    ? req.body.expectedDeckRevision.trim()
    : '';
  const rawPosition = req.body?.position;
  const x = Number(rawPosition?.x);
  const y = Number(rawPosition?.y);
  if (!cardId || !cardRevisionId || !expectedDeckRevision || !Number.isFinite(x) || !Number.isFinite(y)) {
    return res.status(400).json({ ok: false, error: 'saved_card_membership_invalid' });
  }

  let access: { ownerUserId: string } | null = null;
  let attachment: Awaited<ReturnType<typeof attachSavedCardToProject>> | null = null;
  try {
    access = await requireOwnedProject(req, res, req.params.projectId);
    if (!access) return;
    attachment = await attachSavedCardToProject(
      req.params.projectId,
      req.params.deckId,
      access.ownerUserId,
      {
        cardId,
        cardRevisionId,
        expectedDeckRevision,
        position: { x, y },
      },
    );
    const loaded = await getDeckDocument(req.params.projectId, req.params.deckId);
    if (!loaded.deck || !loaded.meta.deckRevision) throw new Error('deck_not_found');
    const result = await saveDeckDocument(
      req.params.projectId,
      req.params.deckId,
      loaded.deck,
      { expectedRevision: loaded.meta.deckRevision },
    );
    return res.json({ ok: true, deck: result.deck, meta: result.meta });
  } catch (err: any) {
    if (attachment && access) {
      // A transport failure can happen after Python committed. Read back the
      // canonical deck before compensating; a changed revision containing the
      // exact Card proves that the attachment is already durable.
      const recovered = await getDeckDocument(
        req.params.projectId,
        req.params.deckId,
      ).catch(() => null);
      const recoveredCard = recovered?.deck?.nodes.find((card) => (
        card.id === cardId && String(card._cardRevisionId || '') === cardRevisionId
      ));
      if (recovered?.deck && recovered.meta.deckRevision
        && recovered.meta.deckRevision !== expectedDeckRevision
        && recoveredCard) {
        return res.json({ ok: true, deck: recovered.deck, meta: recovered.meta });
      }
      try {
        await discardFreshMembership(
          req.params.projectId,
          req.params.deckId,
          cardId,
          cardRevisionId,
          access.ownerUserId,
          attachment.cardPresenceCreated,
          expectedDeckRevision,
        );
      } catch {
        return res.status(409).json({
          ok: false,
          error: 'saved_card_attach_state_changed',
          cause: String(err?.message || 'saved_card_attach_failed'),
        });
      }
    }
    const message = String(err?.message || 'saved_card_attach_failed');
    const status = message === 'project_not_found' || message === 'deck_not_found'
      ? 404
      : message === 'deck_conflict' || message === 'saved_card_not_available'
        ? 409
        : 500;
    return res.status(status).json({ ok: false, error: message });
  }
});

export default router;
