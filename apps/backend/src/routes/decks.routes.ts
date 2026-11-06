/**
 * Entity: Saved Cards
 * Relationship: This file exposes owner-scoped deck load, save, reusable Card listing, and exact saved Card attachment with canonical revision readback.
 * Entity: Card Topology
 * Relationship: This file accepts one exact Card placement membership and preserves the Python-owned deck topology through compare-and-set persistence.
 * Entity: Projects
 * Relationship: This file resolves every deck operation against the canonical owner-scoped Project identity rather than a caller-supplied alias.
 * Entity: Authentication
 * Relationship: This file requires authenticated Project ownership before any deck, Card, membership, or topology read or write.
 */
import { Router } from 'express';
import {
  getDeckDocument,
  saveDeckDocument,
} from '../decks/deckDomainClient';
import type { DeckDocument } from '../types';
import {
  assertCardProfileOwner,
  attachSavedCardToProject,
  discardFreshMembership,
  listSavedCardsForProject,
} from '../services/projectStore';
import { createInternalMcpBearer } from '../services/mcp/internalMcpAuth';
import { requireOwnedProject } from './projectAccess';

const router = Router();

router.get('/:projectId/decks/:deckId', async (req, res) => {
  try {
    const access = await requireOwnedProject(req, res, req.params.projectId);
    if (!access) return;
    const result = await getDeckDocument(access.projectId, req.params.deckId);
    return res.json({ ok: true, projectId: access.projectId, ...result });
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
      access.projectId,
      req.params.deckId,
      document as DeckDocument,
      {
        expectedRevision: typeof expectedRevision === 'string' ? expectedRevision : null,
      },
    );
    return res.json({
      ok: true,
      projectId: access.projectId,
      deck: result.deck,
      meta: result.meta,
    });
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

router.get('/:projectId/decks/:deckId/saved-cards', async (req, res) => {
  try {
    const access = await requireOwnedProject(req, res, req.params.projectId);
    if (!access) return;
    const cards = await listSavedCardsForProject(
      access.projectId,
      req.params.deckId,
      access.ownerUserId,
    );
    return res.json({ ok: true, cards });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || 'saved_card_list_failed' });
  }
});

router.post('/:projectId/decks/:deckId/profile-credentials', async (req, res) => {
  try {
    const access = await requireOwnedProject(req, res, req.params.projectId);
    if (!access) return;
    const loaded = await getDeckDocument(access.projectId, req.params.deckId);
    const deckId = String(loaded.deck?.id || '').trim();
    const profileCounts = new Map<string, number>();
    for (const card of loaded.deck?.nodes || []) {
      if (card.enabled === false || card.runtime?.kind !== 'hermes') continue;
      const profile = String(card.runtime.profile || '').trim().toLowerCase();
      if (!profile) throw new Error('persisted_card_profile_unavailable');
      profileCounts.set(profile, (profileCounts.get(profile) || 0) + 1);
    }
    if (!deckId || profileCounts.size === 0 || [...profileCounts.values()].some(count => count !== 1)) {
      throw new Error('persisted_card_profile_unavailable');
    }
    const profiles = [...profileCounts.keys()].sort();
    await Promise.all(profiles.map(profile => assertCardProfileOwner(profile, access.ownerUserId)));
    res.setHeader('Cache-Control', 'no-store');
    return res.json({
      ok: true,
      projectId: access.projectId,
      deckId,
      credentials: profiles.map(profile => ({
        profile,
        bearer: createInternalMcpBearer({
          kind: 'card-runtime',
          ownerUserId: access.ownerUserId,
          projectId: access.projectId,
          deckId,
          profile,
        }),
      })),
    });
  } catch (err: any) {
    const message = String(err?.message || 'profile_credentials_unavailable');
    const status = message === 'deck_not_found'
      ? 404
      : message === 'persisted_card_profile_unavailable'
        || message === 'card_profile_owner_conflict'
        ? 409
        : message === 'internal_mcp_secret_missing'
          ? 503
          : 500;
    return res.status(status).json({ ok: false, error: message });
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

  let access: { ownerUserId: string; projectId: string } | null = null;
  let attachment: Awaited<ReturnType<typeof attachSavedCardToProject>> | null = null;
  try {
    access = await requireOwnedProject(req, res, req.params.projectId);
    if (!access) return;
    attachment = await attachSavedCardToProject(
      access.projectId,
      req.params.deckId,
      access.ownerUserId,
      {
        cardId,
        cardRevisionId,
        expectedDeckRevision,
        position: { x, y },
      },
    );
    const loaded = await getDeckDocument(access.projectId, req.params.deckId);
    if (!loaded.deck || !loaded.meta.deckRevision) throw new Error('deck_not_found');
    const result = await saveDeckDocument(
      access.projectId,
      req.params.deckId,
      loaded.deck,
      { expectedRevision: loaded.meta.deckRevision },
    );
    return res.json({
      ok: true,
      projectId: access.projectId,
      deck: result.deck,
      meta: result.meta,
    });
  } catch (err: any) {
    if (attachment && access) {
      // A transport failure can happen after Python committed. Read back the
      // canonical deck before compensating; a changed revision containing the
      // exact Card proves that the attachment is already durable.
      const recovered = await getDeckDocument(
        access.projectId,
        req.params.deckId,
      ).catch(() => null);
      const recoveredCard = recovered?.deck?.nodes.find((card) => (
        card.id === cardId && String(card._cardRevisionId || '') === cardRevisionId
      ));
      if (recovered?.deck && recovered.meta.deckRevision
        && recovered.meta.deckRevision !== expectedDeckRevision
        && recoveredCard) {
        return res.json({
          ok: true,
          projectId: access.projectId,
          deck: recovered.deck,
          meta: recovered.meta,
        });
      }
      try {
        await discardFreshMembership(
          access.projectId,
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
