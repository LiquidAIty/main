/**
 * Entity: Saved Cards
 * Relationship: This file exposes owner-scoped deck load, save, reusable Card listing, and exact saved Card attachment with canonical revision readback.
 * Entity: Card Topology
 * Relationship: This file accepts one exact Card placement membership and preserves the Python-owned deck topology through compare-and-set persistence.
 * Entity: Projects
 * Relationship: This file resolves every deck operation against the canonical owner-scoped Project identity rather than a caller-supplied alias.
 * Entity: Authentication
 * Relationship: Requires authenticated Project ownership for deck operations and explicit exact-revision app-tool credential setup for a saved Card.
 */
import { Router } from 'express';
import {
  getDeckDocument,
  saveDeckDocument,
} from '../decks/deckDomainClient';
import type { DeckDocument } from '../types';
import {
  attachSavedCardToProject,
  discardFreshMembership,
  listSavedCardsForProject,
} from '../services/projectStore';
import { requireOwnedProject } from './projectAccess';
import { createInternalMcpBearer, resolveInternalMcpUrl } from '../services/mcp/internalMcpAuth';

const router = Router();

router.post('/:projectId/decks/:deckId/cards/:cardId/app-tools', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const revision = req.body?.expectedCardRevisionId;
  if (!req.body || Object.keys(req.body).length !== 1
    || typeof revision !== 'string' || !revision.trim()) {
    return res.status(400).json({ ok: false, error: 'card_revision_required' });
  }
  try {
    const access = await requireOwnedProject(req, res, req.params.projectId);
    if (!access) return;
    const loaded = await getDeckDocument(access.projectId, req.params.deckId);
    const card = loaded.deck?.nodes.find(node => node.id === req.params.cardId);
    if (!card || card.kind !== 'agent' || card.enabled === false
      || card.runtime?.kind !== 'hermes' || !card.runtime.profile) {
      return res.status(404).json({ ok: false, error: 'saved_hermes_card_not_found' });
    }
    if (card._cardRevisionId !== revision) {
      return res.status(409).json({ ok: false, error: 'card_revision_stale' });
    }
    const profile = card.runtime.profile;
    if (loaded.deck!.nodes.filter(node => node.runtime?.profile === profile).length !== 1) {
      return res.status(409).json({ ok: false, error: 'card_profile_ambiguous' });
    }
    const tools = card.runtimeOptions?.tools || [];
    if (!Array.isArray(tools) || tools.some(tool => typeof tool !== 'string')) {
      return res.status(409).json({ ok: false, error: 'card_tool_selection_invalid' });
    }
    const url = resolveInternalMcpUrl();
    const bearerToken = createInternalMcpBearer({ kind: 'card-runtime',
      ownerUserId: access.ownerUserId, projectId: access.projectId,
      deckId: req.params.deckId, profile });
    // No token is persisted here. Hermes owns its profile credential storage;
    // each MCP call resolves current membership and grants from the saved Card.
    return res.json({ ok: true, cardId: card.id, cardRevisionId: revision, profile,
      serverName: 'liquidaity', url, bearerToken, tools });
  } catch {
    return res.status(500).json({ ok: false, error: 'card_app_tools_setup_failed' });
  }
});

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
  const { document, expectedRevision, removeCardId } = req.body || {};
  if (!document || typeof document !== 'object') {
    return res.status(400).json({ ok: false, error: 'document_required' });
  }
  if (removeCardId !== undefined && (typeof removeCardId !== 'string' || !removeCardId.trim())) {
    return res.status(400).json({ ok: false, error: 'remove_card_id_invalid' });
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
        ...(removeCardId === undefined ? {} : { removeCardId }),
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
          : message.startsWith('deck_integrity_') || message.startsWith('card_removal_')
            || message === 'card_deletion_requires_explicit_operation'
            || message === 'system_card_removal_forbidden'
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
