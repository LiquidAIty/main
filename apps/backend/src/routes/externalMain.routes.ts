import { Router } from 'express';

import { resolveExternalIdentityMainGrant } from '../auth/externalIdentityGrantStore';
import { DEFAULT_PROJECT_DECK_ID } from '../decks/defaultProjectDeck';
import { getDeckDocument } from '../decks/store';
import { internalMcpProcessSecretAuthorized } from '../services/mcp/internalMcpAuth';

export const externalMainRoutes = Router();

externalMainRoutes.post('/context', async (req, res) => {
  if (!internalMcpProcessSecretAuthorized(req.headers['x-liquidaity-internal-mcp-secret'])) {
    return res.status(403).json({ ok: false, error: 'internal_mcp_authorization_required' });
  }
  const issuer = String(req.body?.issuer || '').trim();
  const subject = String(req.body?.subject || '').trim();
  if (!issuer || !subject) {
    return res.status(400).json({ ok: false, error: 'verified_issuer_and_subject_required' });
  }
  try {
    const grant = await resolveExternalIdentityMainGrant(issuer, subject);
    if (!grant) {
      return res.status(403).json({ ok: false, error: 'external_identity_grant_required' });
    }
    const { deck } = await getDeckDocument(grant.projectId, DEFAULT_PROJECT_DECK_ID);
    const mainCards = (deck?.nodes || []).filter((card) => {
      const saved = card.runtimeOptions as (
        typeof card.runtimeOptions & { enabled?: boolean }
      );
      return card.runtime.kind === 'hermes'
        && card.runtime.mode === 'main'
        && (card as typeof card & { enabled?: boolean }).enabled !== false
        && saved?.enabled !== false;
    });
    if (mainCards.length !== 1) {
      return res.status(409).json({ ok: false, error: 'persisted_main_chat_unavailable' });
    }
    const conversationId = `external-mcp:${grant.grantId}`;
    return res.json({
      ok: true,
      context: {
        projectId: grant.projectId,
        deckId: DEFAULT_PROJECT_DECK_ID,
        conversationId,
        parentRunId: `external-main:${grant.grantId}`,
        mainCardId: mainCards[0].id,
      },
    });
  } catch (error) {
    return res.status(502).json({
      ok: false,
      error: error instanceof Error ? error.message : 'external_main_context_failed',
    });
  }
});

export default externalMainRoutes;
